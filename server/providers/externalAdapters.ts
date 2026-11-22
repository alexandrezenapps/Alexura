import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  ForcedAlignmentProvider,
  ForcedAlignmentResult,
  SingingAsrProvider,
  SingingAsrResult,
  VocalSeparationProvider,
  VocalSeparationResult,
} from './interfaces.ts';
import type { SyncedLineRecord } from '../types/pipeline.ts';
import { getStemOutputPath } from '../storage/fileStore.ts';

export function validateExternalHttpsUrl(raw: string | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'https:') return null;
    const h = u.hostname.toLowerCase();
    if (
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h === '0.0.0.0' ||
      h === '::1' ||
      h.endsWith('.local') ||
      /^10\./.test(h) ||
      /^192\.168\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
      /^169\.254\./.test(h)
    ) {
      return null;
    }
    return u.toString();
  } catch {
    return null;
  }
}

export class ExternalVocalSeparationAdapter implements VocalSeparationProvider {
  readonly id = 'external_vocal_separator';
  readonly isNeural = true;

  private get endpoint(): string | null {
    return validateExternalHttpsUrl(process.env.VOCAL_SEPARATION_ENDPOINT);
  }

  isConfigured(): boolean {
    return Boolean(this.endpoint);
  }

  async separate(
    audioPath: string,
    uploadId: string,
    tempDir?: string,
  ): Promise<VocalSeparationResult> {
    const url = this.endpoint;
    if (!url) throw new Error('external_vocal_separation_not_configured');
    const audioBuf = await fs.readFile(audioPath);
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: path.basename(audioPath),
        audioBase64: audioBuf.toString('base64'),
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!resp.ok) throw new Error(`external_vocal_separation_http_${resp.status}`);
    const data: any = await resp.json();
    if (!data?.stemBase64) throw new Error('external_vocal_separation_missing_stem');
    const stemPath = getStemOutputPath(uploadId, tempDir);
    await fs.writeFile(stemPath, Buffer.from(String(data.stemBase64), 'base64'), { mode: 0o600 });
    return {
      stemPath,
      stemBase64: String(data.stemBase64),
      engine: String(data.model || this.id),
      isNeural: true,
    };
  }
}

export class ExternalSingingAsrAdapter implements SingingAsrProvider {
  readonly id = 'external_singing_asr';

  private get endpoint(): string | null {
    return validateExternalHttpsUrl(process.env.SINGING_ASR_ENDPOINT);
  }

  isConfigured(): boolean {
    return Boolean(this.endpoint);
  }

  async transcribe(params: {
    audioPath: string;
    vocalStemPath?: string;
    langHint: string;
    durationSec: number;
  }): Promise<SingingAsrResult> {
    const url = this.endpoint;
    if (!url) throw new Error('external_singing_asr_not_configured');
    const activePath = params.vocalStemPath || params.audioPath;
    const buf = await fs.readFile(activePath);
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lang: params.langHint,
        durationSec: params.durationSec,
        audioBase64: buf.toString('base64'),
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!resp.ok) throw new Error(`external_singing_asr_http_${resp.status}`);
    const data: any = await resp.json();
    return {
      transcriptText: String(data.transcriptText || ''),
      language: String(data.language || params.langHint || 'auto'),
      detectedLanguages: Array.isArray(data.detectedLanguages) ? data.detectedLanguages : [],
      detectedSpeakers: Array.isArray(data.detectedSpeakers) ? data.detectedSpeakers : ['Lead'],
      audioType: String(data.audioType || 'singing'),
      draftLines: Array.isArray(data.lines) ? data.lines : [],
      engine: String(data.model || this.id),
    };
  }
}

export class ExternalForcedAlignmentAdapter implements ForcedAlignmentProvider {
  readonly id = 'external_forced_aligner';
  readonly isNeuralPhonemeAligner = true;

  private get endpoint(): string | null {
    return validateExternalHttpsUrl(process.env.FORCED_ALIGNMENT_ENDPOINT);
  }

  isConfigured(): boolean {
    return Boolean(this.endpoint);
  }

  async align(params: {
    audioPath: string;
    vocalStemPath?: string;
    lines: SyncedLineRecord[];
    langHint: string;
  }): Promise<ForcedAlignmentResult> {
    const url = this.endpoint;
    if (!url) throw new Error('external_forced_alignment_not_configured');
    const activePath = params.vocalStemPath || params.audioPath;
    const buf = await fs.readFile(activePath);
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lang: params.langHint,
        audioBase64: buf.toString('base64'),
        lines: params.lines.map((l) => ({
          text: l.text,
          start: l.start,
          end: l.end,
        })),
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!resp.ok) throw new Error(`external_forced_alignment_http_${resp.status}`);
    const data: any = await resp.json();
    const lines: SyncedLineRecord[] = Array.isArray(data.lines)
      ? data.lines.map((ln: any, idx: number) => ({
          ...ln,
          lineIndex: idx,
          provenance: 'external_forced_aligner',
        }))
      : params.lines;
    return {
      lines,
      provenance: 'external_forced_aligner',
      engine: String(data.model || this.id),
      isNeuralPhonemeAligner: true,
    };
  }
}
