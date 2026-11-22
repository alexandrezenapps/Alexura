import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  ConfidenceTier,
  SyncedLineRecord,
  SyncedWordRecord,
  ValidationSummary,
} from '../types/pipeline.ts';
import type {
  ConfidenceValidator,
  ForcedAlignmentProvider,
  ForcedAlignmentResult,
  VocalSeparationProvider,
  VocalSeparationResult,
} from './interfaces.ts';
import { getStemOutputPath } from '../storage/fileStore.ts';

const WORKER_SCRIPT = path.resolve(process.cwd(), 'backend', 'audio_worker.py');

function runAudioWorker<T = any>(command: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'python3',
      [WORKER_SCRIPT, command],
      { maxBuffer: 25 * 1024 * 1024, timeout: 240000 },
      (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(stderr?.trim() || err.message));
        }
        try {
          const parsed = JSON.parse(stdout || '{}');
          if (!parsed.ok) return reject(new Error(parsed.error || `worker_failed:${command}`));
          resolve(parsed as T);
        } catch (parseErr: any) {
          reject(new Error(`worker_invalid_json:${parseErr?.message}`));
        }
      },
    );
    child.stdin?.write(JSON.stringify(payload ?? {}));
    child.stdin?.end();
  });
}

/**
 * Local signal-processing fallback for center-channel vocal isolation.
 * Explicitly declares `isNeural = false` so the UI knows it uses Mid/Side + bandpass DSP
 * rather than neural source separation (Demucs / BS-RoFormer).
 */
export class DspCenterVocalSeparator implements VocalSeparationProvider {
  readonly id = 'dsp_center_bandpass';
  readonly isNeural = false;

  isConfigured(): boolean {
    return true;
  }

  async separate(
    audioPath: string,
    uploadId: string,
    tempDir?: string,
  ): Promise<VocalSeparationResult> {
    const outWavPath = getStemOutputPath(uploadId, tempDir);
    const res = await runAudioWorker<{ stemPath: string; engine: string }>('separate', {
      audioPath,
      outWavPath,
    });
    let stemBase64: string | undefined;
    try {
      const stat = await fs.stat(res.stemPath);
      if (stat.size <= 14 * 1024 * 1024) {
        const buf = await fs.readFile(res.stemPath);
        stemBase64 = buf.toString('base64');
      }
    } catch {
      stemBase64 = undefined;
    }
    return {
      stemPath: res.stemPath,
      stemBase64,
      engine: res.engine || this.id,
      isNeural: false,
    };
  }
}

/**
 * Local 10ms acoustic envelope + dynamic-programming aligner.
 * Explicitly declares `isNeuralPhonemeAligner = false` and marks words `dsp_acoustic_viterbi`.
 */
export class DspAcousticForcedAligner implements ForcedAlignmentProvider {
  readonly id = 'dsp_acoustic_viterbi';
  readonly isNeuralPhonemeAligner = false;

  isConfigured(): boolean {
    return true;
  }

  async align(params: {
    audioPath: string;
    vocalStemPath?: string;
    lines: SyncedLineRecord[];
    langHint: string;
  }): Promise<ForcedAlignmentResult> {
    const targetAudio = params.vocalStemPath || params.audioPath;
    const res = await runAudioWorker<{
      durationSec: number;
      waveformPeaks: any[];
      vocalSegments: any[];
      alignedLines: Array<{ index: number; text: string; start: number; end: number; words: any[] }>;
    }>('align', {
      audioPath: targetAudio,
      lines: params.lines.map((l) => ({
        text: l.text,
        start: l.start,
        end: l.end,
        words: l.words,
      })),
    });

    const mergedLines: SyncedLineRecord[] = params.lines.map((orig, idx) => {
      const hit = res.alignedLines.find((al) => al.index === idx);
      if (!hit || !Array.isArray(hit.words) || hit.words.length === 0) {
        return orig;
      }
      const words: SyncedWordRecord[] = hit.words.map((w, wi) => {
        const prevW = orig.words[wi];
        const recConf = prevW
          ? Math.min(prevW.recognitionConfidence, w.recognitionConfidence)
          : w.recognitionConfidence;
        return {
          wordIndex: wi,
          text: w.text,
          start: w.start,
          end: w.end,
          recognitionConfidence: recConf,
          alignmentConfidence: w.alignmentConfidence,
          audioClarity: w.audioClarity,
          vocalOverlap: w.vocalOverlap,
          qualityTier: w.qualityTier as ConfidenceTier,
          speaker: prevW?.speaker || orig.speaker || 'Lead',
          flags: Array.from(new Set([...(prevW?.flags || []), ...(w.flags || [])])),
          phonemes: prevW?.phonemes,
          chars: prevW?.chars,
          provenance: 'dsp_acoustic_viterbi',
        };
      });
      return {
        ...orig,
        lineIndex: idx,
        provenance: 'dsp_acoustic_viterbi',
        alignmentConfidence:
          words.reduce((a, b) => a + b.alignmentConfidence, 0) / Math.max(1, words.length),
        words,
      };
    });

    return {
      lines: mergedLines,
      waveformPeaks: res.waveformPeaks,
      vocalSegments: res.vocalSegments,
      durationSec: res.durationSec,
      provenance: 'dsp_acoustic_viterbi',
      engine: this.id,
      isNeuralPhonemeAligner: false,
    };
  }
}

export class AcousticConfidenceValidator implements ConfidenceValidator {
  validateAndSummarize(lines: SyncedLineRecord[]): {
    lines: SyncedLineRecord[];
    summary: ValidationSummary;
  } {
    let totalWords = 0;
    let highConfidenceWords = 0;
    let mediumConfidenceWords = 0;
    let lowConfidenceWords = 0;
    let uncertainWords = 0;
    let missingWords = 0;
    let misrecognizedWords = 0;
    let overlappingWords = 0;
    let uncertainBoundaries = 0;

    const validated = lines.map((ln, lIdx) => {
      const safeStart = Math.max(0, Number(ln.start) || 0);
      const safeEnd = Math.max(safeStart + 0.05, Number(ln.end) || safeStart + 1.5);
      const words = (ln.words || []).map((w, wIdx) => {
        totalWords++;
        const f = new Set(w.flags || []);
        if (w.recognitionConfidence < 0.72) f.add('uncertain_word');
        if (w.alignmentConfidence < 0.68) f.add('uncertain_boundary');
        if (w.vocalOverlap > 0.42) f.add('overlapping_vocals');

        if (f.has('uncertain_word')) uncertainWords++;
        if (f.has('missing_word')) missingWords++;
        if (f.has('misrecognized_word')) misrecognizedWords++;
        if (f.has('overlapping_vocals')) overlappingWords++;
        if (f.has('uncertain_boundary')) uncertainBoundaries++;

        // Enforce honest ceiling: automated non-human alignment is capped <= 0.96
        const cap =
          w.provenance === 'human_verified'
            ? 1.0
            : w.provenance === 'external_forced_aligner'
              ? 0.96
              : 0.89;
        const alignConf = Math.min(cap, Math.max(0.05, Number(w.alignmentConfidence) || 0.6));
        const recConf = Math.min(0.96, Math.max(0.05, Number(w.recognitionConfidence) || 0.75));
        const overall = 0.42 * recConf + 0.38 * alignConf + 0.2 * (w.audioClarity || 0.7);

        let tier: ConfidenceTier = 'MEDIUM';
        if (
          overall >= 0.78 &&
          !f.has('uncertain_word') &&
          !f.has('uncertain_boundary') &&
          w.vocalOverlap <= 0.35
        ) {
          tier = 'HIGH';
          highConfidenceWords++;
        } else if (overall < 0.58 || f.has('misrecognized_word') || w.audioClarity < 0.45) {
          tier = 'LOW';
          lowConfidenceWords++;
        } else {
          mediumConfidenceWords++;
        }

        return {
          ...w,
          wordIndex: wIdx,
          start: +Math.max(safeStart, w.start).toFixed(3),
          end: +Math.min(safeEnd, Math.max(w.start + 0.02, w.end)).toFixed(3),
          recognitionConfidence: +recConf.toFixed(3),
          alignmentConfidence: +alignConf.toFixed(3),
          qualityTier: tier,
          flags: Array.from(f),
        };
      });

      return {
        ...ln,
        lineIndex: lIdx,
        start: +safeStart.toFixed(3),
        end: +safeEnd.toFixed(3),
        words,
      };
    });

    return {
      lines: validated,
      summary: {
        totalWords,
        highConfidenceWords,
        mediumConfidenceWords,
        lowConfidenceWords,
        uncertainWords,
        missingWords,
        misrecognizedWords,
        overlappingWords,
        uncertainBoundaries,
      },
    };
  }
}
