import type {
  AlignmentProvenance,
  SyncedLineRecord,
  TimeSpan,
  ValidationSummary,
  WaveformPeak,
} from '../types/pipeline.ts';

export interface VocalSeparationResult {
  stemPath: string;
  stemBase64?: string;
  engine: string;
  isNeural: boolean;
}

export interface SingingAsrResult {
  transcriptText: string;
  language: string;
  detectedLanguages: string[];
  detectedSpeakers: string[];
  audioType: string;
  title?: string;
  artist?: string;
  draftLines: SyncedLineRecord[];
  engine: string;
}

export interface ForcedAlignmentResult {
  lines: SyncedLineRecord[];
  waveformPeaks?: WaveformPeak[];
  vocalSegments?: TimeSpan[];
  durationSec?: number;
  provenance: AlignmentProvenance;
  engine: string;
  isNeuralPhonemeAligner: boolean;
}

export interface VocalSeparationProvider {
  readonly id: string;
  readonly isNeural: boolean;
  isConfigured(): boolean;
  separate(audioPath: string, uploadId: string, tempDir?: string): Promise<VocalSeparationResult>;
}

export interface SingingAsrProvider {
  readonly id: string;
  isConfigured(): boolean;
  transcribe(params: {
    audioPath: string;
    vocalStemPath?: string;
    langHint: string;
    durationSec: number;
    tempDir?: string;
    onProgress?: (detail: string, currentWindow?: number, totalWindows?: number) => void | Promise<void>;
    onRetry?: (attempt: number, maxRetries: number, errorMessage: string) => void | Promise<void>;
  }): Promise<SingingAsrResult>;
}

export interface ForcedAlignmentProvider {
  readonly id: string;
  readonly isNeuralPhonemeAligner: boolean;
  isConfigured(): boolean;
  align(params: {
    audioPath: string;
    vocalStemPath?: string;
    lines: SyncedLineRecord[];
    langHint: string;
  }): Promise<ForcedAlignmentResult>;
}

export interface ConfidenceValidator {
  validateAndSummarize(lines: SyncedLineRecord[]): {
    lines: SyncedLineRecord[];
    summary: ValidationSummary;
  };
}
