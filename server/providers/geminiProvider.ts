import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { GoogleGenAI, Type } from '@google/genai';
import type { SingingAsrProvider, SingingAsrResult } from './interfaces.ts';
import type { SyncedLineRecord } from '../types/pipeline.ts';
import {
  confinePath,
  createSecureTempDir,
  removeTempPathSafe,
} from '../storage/fileStore.ts';

const WORKER_SCRIPT = path.resolve(process.cwd(), 'backend', 'audio_worker.py');
const WINDOW_DURATION_SEC = 110;
const SINGLE_PASS_MAX_BYTES = 14 * 1024 * 1024;
const SINGLE_PASS_MAX_SEC = 125;

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function guessMime(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.m4a')) return 'audio/mp4';
  if (lower.endsWith('.flac')) return 'audio/flac';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  if (lower.endsWith('.webm')) return 'audio/webm';
  return 'audio/mpeg';
}

function isNonRetryableGeminiError(err: any): boolean {
  const msg = String(err?.message || err || '').toLowerCase();
  const code = Number(err?.code || err?.statusCode || 0);
  const statusStr = String(err?.status || '').toUpperCase();
  if (
    msg.includes('gemini_api_key_not_configured') ||
    msg.includes('permission_denied') ||
    msg.includes('billing') ||
    msg.includes('free tier') ||
    msg.includes('api_key_invalid') ||
    msg.includes('invalid_argument') ||
    statusStr === 'PERMISSION_DENIED' ||
    statusStr === 'UNAUTHENTICATED' ||
    statusStr === 'INVALID_ARGUMENT' ||
    statusStr === 'NOT_FOUND'
  ) {
    return true;
  }
  if (code === 400 || code === 401 || code === 403 || code === 404) {
    return true;
  }
  return false;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    maxRetries?: number;
    baseDelayMs?: number;
    onRetry?: (attempt: number, maxRetries: number, errorMessage: string) => void | Promise<void>;
  } = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 900;
  let lastErr: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (attempt >= maxRetries || isNonRetryableGeminiError(err)) {
        throw err;
      }
      const nextAttempt = attempt + 1;
      const errMsg = String(err?.message || err || 'transient_error').slice(0, 180);
      await opts.onRetry?.(nextAttempt, maxRetries, errMsg);
      const jitter = Math.floor(Math.random() * 260);
      const waitMs = baseDelayMs * Math.pow(2, attempt) + jitter;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

function sliceAudioWindowWithPython(
  audioPath: string,
  outWavPath: string,
  startSec: number,
  durationSec: number,
): Promise<{ slicePath: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'python3',
      [WORKER_SCRIPT, 'slice'],
      { maxBuffer: 5 * 1024 * 1024, timeout: 120000 },
      (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(stderr?.trim() || err.message));
        }
        try {
          const parsed = JSON.parse(stdout || '{}');
          if (!parsed.ok) return reject(new Error(parsed.error || 'slice_failed'));
          resolve({ slicePath: String(parsed.slicePath || outWavPath) });
        } catch (parseErr: any) {
          reject(new Error(`slice_json_error:${parseErr?.message}`));
        }
      },
    );
    child.stdin?.write(JSON.stringify({ audioPath, outWavPath, startSec, durationSec }));
    child.stdin?.end();
  });
}

function tokenizeLineDraft(text: string, lineStart: number, lineEnd: number, speaker: string) {
  const tokens =
    text.match(
      /[A-Za-zÀ-ÿ\u1e00-\u1eff0-9'’\-]+[,.;:!?…]?|[\u4e00-\u9fff\u3400-\u4dbf]|[\u3040-\u309f\u30a0-\u30ff][\u3041\u3043\u3045\u3047\u3049\u3063\u3083\u3085\u3087\u308e\u30a1\u30a3\u30a5\u30a7\u30a9\u30c3\u30e3\u30e5\u30e7\u30ee\u30fc]?|[\uac00-\ud7af]|[^\s]/g,
    ) || [text];
  const dur = Math.max(0.2, lineEnd - lineStart);
  const step = dur / Math.max(1, tokens.length);
  return tokens.map((tk, i) => ({
    wordIndex: i,
    text: tk,
    start: +(lineStart + i * step).toFixed(3),
    end: +(lineStart + (i + 1) * step).toFixed(3),
    recognitionConfidence: 0.78,
    alignmentConfidence: 0.52,
    audioClarity: 0.72,
    vocalOverlap: 0.12,
    qualityTier: 'MEDIUM' as const,
    speaker,
    flags: ['uncertain_boundary'],
    provenance: 'text_draft_estimate' as const,
  }));
}

async function transcribeSingleWindow(params: {
  ai: GoogleGenAI;
  filePath: string;
  windowStartSec: number;
  windowDurationSec: number;
  totalDurationSec: number;
  langHint: string;
  onRetry?: (attempt: number, maxRetries: number, errorMessage: string) => void | Promise<void>;
}): Promise<{
  transcriptText: string;
  language: string;
  detectedLanguages: string[];
  detectedSpeakers: string[];
  audioType: string;
  title?: string;
  artist?: string;
  draftLines: SyncedLineRecord[];
}> {
  const rawBuf = await fs.readFile(params.filePath);
  if (rawBuf.length > 18 * 1024 * 1024) {
    throw new Error('audio_window_exceeds_inline_gemini_limit');
  }
  const base64Audio = rawBuf.toString('base64');
  const mimeType = guessMime(params.filePath);
  const winDur = Math.max(0.5, params.windowDurationSec);

  const transcribeResp = await withRetry(
    () =>
      params.ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Audio,
              },
            },
            {
              text: `Transcribe the vocals/lyrics heard in this audio clip (clip duration: ${winDur.toFixed(2)}s, language hint: ${params.langHint || 'auto'}). Keep original sung language(s) verbatim without translating. Mark unintelligible passages as [UNCLEAR] and instrumental-only sections as [INSTRUMENTAL]. Do not hallucinate lyrics.`,
            },
          ],
        },
      }),
    { maxRetries: 3, baseDelayMs: 900, onRetry: params.onRetry },
  );

  const transcriptText = String(transcribeResp.text || '').trim();

  const structureResp = await withRetry(
    () =>
      params.ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [
          {
            inlineData: {
              mimeType,
              data: base64Audio,
            },
          },
          {
            text: `Given this verbatim transcript and audio clip (clip duration ${winDur.toFixed(2)}s starting at 0.000s relative to this clip), organize it into chronological lyric lines with estimated phrase [start, end] seconds strictly within [0, ${winDur.toFixed(2)}].
Transcript:
${transcriptText || '[No clear lyrics detected]'}

Output strict JSON with language, detectedLanguages, detectedSpeakers, audioType ("singing"|"speech"|"instrumental"|"combination"), and lines.`,
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              audioType: { type: Type.STRING },
              language: { type: Type.STRING },
              detectedLanguages: { type: Type.ARRAY, items: { type: Type.STRING } },
              detectedSpeakers: { type: Type.ARRAY, items: { type: Type.STRING } },
              title: { type: Type.STRING },
              artist: { type: Type.STRING },
              lines: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    text: { type: Type.STRING },
                    start: { type: Type.NUMBER },
                    end: { type: Type.NUMBER },
                    section: { type: Type.STRING },
                    vocalType: { type: Type.STRING },
                    language: { type: Type.STRING },
                    speaker: { type: Type.STRING },
                    recognitionConfidence: { type: Type.NUMBER },
                  },
                  required: ['text', 'start', 'end'],
                },
              },
            },
            required: ['audioType', 'language', 'lines'],
          },
        },
      }),
    { maxRetries: 3, baseDelayMs: 900, onRetry: params.onRetry },
  );

  const parsed = JSON.parse(structureResp.text || '{}');
  const rawLines = Array.isArray(parsed.lines) ? parsed.lines : [];
  const off = Math.max(0, params.windowStartSec);
  const absMax = Math.max(off + winDur, params.totalDurationSec || off + winDur);
  let prevEnd = off;

  const draftLines: SyncedLineRecord[] = rawLines
    .map((l: any, idx: number): SyncedLineRecord | null => {
      const text = String(l?.text || '').trim();
      if (!text) return null;
      const relStart = Math.max(0, Math.min(winDur - 0.1, Number(l?.start) || 0));
      const relEnd = Math.max(relStart + 0.15, Math.min(winDur, Number(l?.end) || relStart + 2.4));
      const start = +Math.max(prevEnd, Math.min(absMax - 0.1, off + relStart)).toFixed(3);
      const end = +Math.max(start + 0.15, Math.min(absMax, off + relEnd)).toFixed(3);
      prevEnd = end;
      const speaker = String(l?.speaker || 'Lead').trim() || 'Lead';
      const recConf = Math.max(0.15, Math.min(0.95, Number(l?.recognitionConfidence) || 0.8));
      return {
        lineIndex: idx,
        text,
        start,
        end,
        section: String(l?.section || 'verse').toLowerCase(),
        vocalType: String(l?.vocalType || 'singing').toLowerCase(),
        language: String(l?.language || parsed.language || params.langHint || 'auto'),
        speaker,
        recognitionConfidence: recConf,
        alignmentConfidence: 0.55,
        flags: /\[unclear/i.test(text) ? ['uncertain_word'] : ['uncertain_boundary'],
        provenance: 'gemini_transcribe_plus_dsp',
        words: /^\[(?:instrumental|interlude)/i.test(text)
          ? []
          : tokenizeLineDraft(text, start, end, speaker),
      };
    })
    .filter((x: SyncedLineRecord | null): x is SyncedLineRecord => x !== null);

  return {
    transcriptText,
    language: String(parsed.language || params.langHint || 'auto'),
    detectedLanguages: Array.isArray(parsed.detectedLanguages) ? parsed.detectedLanguages : [],
    detectedSpeakers: Array.isArray(parsed.detectedSpeakers) ? parsed.detectedSpeakers : ['Lead'],
    audioType: String(parsed.audioType || 'singing'),
    title: parsed.title ? String(parsed.title) : undefined,
    artist: parsed.artist ? String(parsed.artist) : undefined,
    draftLines,
  };
}

export class GeminiSingingAsrProvider implements SingingAsrProvider {
  readonly id = 'google-genai:gemini-3.5-transcribe';

  isConfigured(): boolean {
    return Boolean((process.env.GEMINI_API_KEY || '').trim());
  }

  async transcribe(params: {
    audioPath: string;
    vocalStemPath?: string;
    langHint: string;
    durationSec: number;
    tempDir?: string;
    onProgress?: (detail: string, currentWindow?: number, totalWindows?: number) => void | Promise<void>;
    onRetry?: (attempt: number, maxRetries: number, errorMessage: string) => void | Promise<void>;
  }): Promise<SingingAsrResult> {
    const ai = getGeminiClient();
    if (!ai) {
      throw new Error('gemini_api_key_not_configured');
    }

    const activePath = params.vocalStemPath || params.audioPath;
    const stat = await fs.stat(activePath);
    const totalDur = Math.max(1, params.durationSec || 1);

    // Fast path for short clips that fit comfortably inside Gemini inline limits
    if (totalDur <= SINGLE_PASS_MAX_SEC && stat.size <= SINGLE_PASS_MAX_BYTES) {
      await params.onProgress?.('Transcription Gemini (extrait direct)', 1, 1);
      const single = await transcribeSingleWindow({
        ai,
        filePath: activePath,
        windowStartSec: 0,
        windowDurationSec: totalDur,
        totalDurationSec: totalDur,
        langHint: params.langHint,
        onRetry: params.onRetry,
      });
      return {
        ...single,
        engine: this.id,
      };
    }

    // Windowed processing for full-length songs & large audio tracks
    const windows: Array<{ startSec: number; durationSec: number }> = [];
    let cursor = 0;
    while (cursor < totalDur) {
      const remaining = totalDur - cursor;
      if (remaining <= WINDOW_DURATION_SEC + 15) {
        windows.push({ startSec: cursor, durationSec: remaining });
        break;
      }
      windows.push({ startSec: cursor, durationSec: WINDOW_DURATION_SEC });
      cursor += WINDOW_DURATION_SEC;
    }

    const ownsTemp = !params.tempDir;
    const sliceDir = params.tempDir || (await createSecureTempDir('gemwin'));

    try {
      const allLines: SyncedLineRecord[] = [];
      const transcriptParts: string[] = [];
      const langSet = new Set<string>();
      const speakerSet = new Set<string>();
      let primaryLang = params.langHint || 'auto';
      let audioType = 'singing';
      let resolvedTitle: string | undefined;
      let resolvedArtist: string | undefined;

      for (let i = 0; i < windows.length; i++) {
        const win = windows[i];
        await params.onProgress?.(
          `Transcription Gemini fenêtre ${i + 1}/${windows.length} (${win.startSec.toFixed(0)}s–${(win.startSec + win.durationSec).toFixed(0)}s)`,
          i + 1,
          windows.length,
        );
        const sliceOut = confinePath(sliceDir, `win_${i}.wav`);
        try {
          await sliceAudioWindowWithPython(activePath, sliceOut, win.startSec, win.durationSec);
          const partRes = await transcribeSingleWindow({
            ai,
            filePath: sliceOut,
            windowStartSec: win.startSec,
            windowDurationSec: win.durationSec,
            totalDurationSec: totalDur,
            langHint: params.langHint,
            onRetry: params.onRetry,
          });
          if (partRes.transcriptText) transcriptParts.push(partRes.transcriptText);
          if (i === 0 && partRes.language && partRes.language !== 'auto') {
            primaryLang = partRes.language;
          }
          if (partRes.audioType) audioType = partRes.audioType;
          if (!resolvedTitle && partRes.title) resolvedTitle = partRes.title;
          if (!resolvedArtist && partRes.artist) resolvedArtist = partRes.artist;
          partRes.detectedLanguages.forEach((l) => l && langSet.add(l));
          partRes.detectedSpeakers.forEach((s) => s && speakerSet.add(s));

          partRes.draftLines.forEach((ln) => {
            allLines.push({
              ...ln,
              lineIndex: allLines.length,
            });
          });
        } finally {
          await fs.unlink(sliceOut).catch(() => {});
        }
      }

      return {
        transcriptText: transcriptParts.join('\n'),
        language: primaryLang,
        detectedLanguages: Array.from(langSet),
        detectedSpeakers: speakerSet.size > 0 ? Array.from(speakerSet) : ['Lead'],
        audioType,
        title: resolvedTitle,
        artist: resolvedArtist,
        draftLines: allLines,
        engine: `${this.id}:windowed_${windows.length}x`,
      };
    } finally {
      if (ownsTemp) {
        await removeTempPathSafe(sliceDir);
      }
    }
  }
}
