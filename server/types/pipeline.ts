export type AlignmentProvenance =
  | 'external_forced_aligner'
  | 'gemini_transcribe_plus_dsp'
  | 'dsp_acoustic_viterbi'
  | 'human_verified'
  | 'text_draft_estimate';

export type ConfidenceTier = 'HIGH' | 'MEDIUM' | 'LOW';

export interface WaveformPeak {
  min: number;
  max: number;
  rms: number;
}

export interface TimeSpan {
  start: number;
  end: number;
}

export interface PhonemeSpan {
  unit: string;
  start: number;
  end: number;
}

export interface CharSpan {
  ch: string;
  start: number;
  end: number;
}

export interface SyncedWordRecord {
  wordIndex?: number;
  text: string;
  start: number;
  end: number;
  recognitionConfidence: number;
  alignmentConfidence: number;
  audioClarity: number;
  vocalOverlap: number;
  qualityTier: ConfidenceTier;
  speaker: string;
  flags: string[];
  phonemes?: PhonemeSpan[];
  chars?: CharSpan[];
  provenance: AlignmentProvenance;
}

export interface SyncedLineRecord {
  lineIndex?: number;
  text: string;
  start: number;
  end: number;
  section: string;
  vocalType: string;
  language: string;
  speaker: string;
  recognitionConfidence: number;
  alignmentConfidence: number;
  flags: string[];
  provenance: AlignmentProvenance;
  words: SyncedWordRecord[];
}

export interface UploadRecord {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  durationSec: number;
  sampleRate: number;
  channels: number;
  waveformPeaks: WaveformPeak[];
  vocalSegments: TimeSpan[];
  storagePath: string;
  createdAt: string;
  deduplicated?: boolean;
}

export interface UploadSessionRecord {
  sessionId: string;
  filename: string;
  mimeType: string;
  expectedBytes: number;
  receivedBytes: number;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineIntegrityInfo {
  preservesOriginalAudio: true;
  timelineOriginSec: 0;
  originalDurationSec: number;
  originalSha256: string;
  originalFilename: string;
}

export interface PipelineCapabilities {
  runtime: string;
  pythonAvailable: boolean;
  ffmpegAvailable: boolean;
  geminiConfigured: boolean;
  geminiAudioModel: string;
  geminiReasoningModel: string;
  maxUploadBytes?: number;
  recommendedChunkBytes?: number;
  maxConcurrentJobs?: number;
  providers: {
    audioUnderstanding: {
      active: string;
      status: 'active' | 'not_configured';
      guaranteesExactWordForcedAlignment: false;
      note: string;
    };
    vocalSeparation: {
      active: string;
      status: 'active_external_neural' | 'active_dsp_fallback';
      externalConfigured: boolean;
      isNeural: boolean;
      note: string;
    };
    singingAsr: {
      active: string;
      status: 'active_external_model' | 'active_gemini_transcribe' | 'not_configured';
      externalConfigured: boolean;
      note: string;
    };
    forcedAlignment: {
      active: string;
      status: 'active_external_aligner' | 'active_dsp_viterbi';
      externalConfigured: boolean;
      isNeuralPhonemeAligner: boolean;
      note: string;
    };
  };
}

export interface PipelineJobRecord {
  id: string;
  uploadId: string;
  songId: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed';
  stage:
    | 'queued'
    | 'validating_audio'
    | 'separating_vocals'
    | 'transcribing_lyrics'
    | 'aligning_timestamps'
    | 'validating_confidence'
    | 'persisting'
    | 'completed'
    | 'error';
  progress: number;
  lang: string;
  mode: string;
  retryCount?: number;
  cachedHit?: boolean;
  stageDetail?: string;
  windowProgress?: { current: number; total: number };
  requestParams?: Record<string, unknown>;
  capabilities?: PipelineCapabilities;
  result?: SongTimestampRecord | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ValidationSummary {
  totalWords: number;
  highConfidenceWords: number;
  mediumConfidenceWords: number;
  lowConfidenceWords: number;
  uncertainWords: number;
  missingWords: number;
  misrecognizedWords: number;
  overlappingWords: number;
  uncertainBoundaries: number;
}

export interface SongTimestampRecord {
  songId: string;
  uploadId?: string | null;
  title: string;
  artist: string;
  language: string;
  detectedLanguages: string[];
  audioType: string;
  durationSec: number;
  bpm: number;
  provenance: Record<string, unknown> & {
    timelineIntegrity?: TimelineIntegrityInfo;
  };
  validationSummary: ValidationSummary;
  createdAt?: string;
  updatedAt?: string;
  lines: SyncedLineRecord[];
}
