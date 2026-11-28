/**
 * Core TypeScript Data Types, Finite-State Machine & Validation Rules
 * for Alexura AI Lyrics Sync Engine (Phase 1 — Architecture Foundation).
 *
 * INVARIANT: All timestamps MUST use seconds (>= 0.0) relative to the
 * untouched original uploaded audio file (origin = 0.000s).
 * Unaligned elements MUST use `null` timestamps — NEVER fake word timings.
 */

import type {
  LyricSegment as AlignedLyricSegment,
  LyricUnit as AlignedLyricUnit,
  LyricWord as AlignedLyricWord,
  LyricsDocument as AlignedLyricsDocument,
} from './alignedLyrics';

export type {
  AlignedLyricSegment,
  AlignedLyricUnit,
  AlignedLyricWord,
  AlignedLyricsDocument,
};

export type ProcessingPipelineState =
  | 'queued'
  | 'validating'
  | 'analyzing'
  | 'separating_vocals'
  | 'transcribing'
  | 'aligning'
  | 'validating_alignment'
  | 'completed'
  | 'failed';

export type ProcessingStatus = ProcessingPipelineState;

export const PIPELINE_STAGE_ORDER: readonly ProcessingPipelineState[] = [
  'queued',
  'validating',
  'analyzing',
  'separating_vocals',
  'transcribing',
  'aligning',
  'validating_alignment',
  'completed',
] as const;

export const STAGE_PROGRESS_PERCENT: Record<ProcessingPipelineState, number> = {
  queued: 0,
  validating: 12,
  analyzing: 25,
  separating_vocals: 40,
  transcribing: 60,
  aligning: 78,
  validating_alignment: 92,
  completed: 100,
  failed: 100,
};

export const DEFAULT_JOB_STEP_MESSAGES: Record<ProcessingStatus, string> = {
  queued: 'Queued for processing',
  validating: 'Validating uploaded audio',
  analyzing: 'Analyzing audio timeline',
  separating_vocals: 'Separating vocal stems',
  transcribing: 'Transcribing singing lyrics',
  aligning: 'Aligning word boundaries',
  validating_alignment: 'Validating alignment bounds',
  completed: 'Processing completed',
  failed: 'Processing failed',
};

export const ALLOWED_JOB_TRANSITIONS: Record<
  ProcessingPipelineState,
  readonly ProcessingPipelineState[]
> = {
  queued: ['validating', 'failed'],
  validating: ['analyzing', 'failed'],
  analyzing: ['separating_vocals', 'transcribing', 'failed'],
  separating_vocals: ['transcribing', 'failed'],
  transcribing: ['aligning', 'failed'],
  aligning: ['validating_alignment', 'failed'],
  validating_alignment: ['completed', 'failed'],
  completed: [],
  failed: ['queued'],
};

export type UnitType = 'character' | 'syllable' | 'mora' | 'phoneme';
export type ElementAlignmentState = 'unaligned' | 'manual' | 'aligned';
export type DocumentAlignmentStatus =
  | 'unaligned'
  | 'phase1_placeholder'
  | 'partial_manual'
  | 'aligned'
  | 'validated';
export type DocumentSource =
  | 'phase1_stub'
  | 'manual_editor'
  | 'singing_asr_adapter'
  | 'forced_alignment_adapter';

export type SectionType =
  | 'intro'
  | 'verse'
  | 'pre_chorus'
  | 'chorus'
  | 'bridge'
  | 'outro'
  | 'instrumental'
  | 'speech'
  | 'other';

export type VocalType =
  | 'lead'
  | 'backing'
  | 'harmony'
  | 'overlapping'
  | 'speech'
  | 'instrumental'
  | 'unclear';

export interface LyricUnit {
  unitId: string;
  text: string;
  unitType: UnitType;
  /** Seconds relative to original audio, or null when unaligned. */
  startSeconds: number | null;
  /** Seconds relative to original audio, or null when unaligned. */
  endSeconds: number | null;
  confidence: number | null;
  alignmentState: ElementAlignmentState;
}

export interface LyricWord {
  wordId: string;
  text: string;
  /** Seconds relative to original audio, or null when unaligned (never fake timings). */
  startSeconds: number | null;
  /** Seconds relative to original audio, or null when unaligned. */
  endSeconds: number | null;
  confidence: number | null;
  alignmentConfidence?: number | null;
  alignmentState: ElementAlignmentState;
  reviewRequired?: boolean;
  speaker?: string | null;
  flags: string[];
  units: LyricUnit[];
}

export interface LyricSegment {
  segmentId: string;
  index: number;
  text: string;
  /** Seconds relative to original audio, or null when unaligned. */
  startSeconds: number | null;
  /** Seconds relative to original audio, or null when unaligned. */
  endSeconds: number | null;
  language?: string | null;
  sectionType: SectionType;
  vocalType: VocalType;
  speaker?: string | null;
  confidence: number | null;
  alignmentState: ElementAlignmentState;
  isPlaceholder?: boolean;
  words: LyricWord[];
}

export interface LyricsDocument {
  schemaVersion: '1.0.0';
  documentId: string;
  audioId: string;
  jobId: string | null;
  title: string;
  artist: string;
  primaryLanguage: string;
  detectedLanguages: string[];
  durationSeconds: number;
  timelineOriginSeconds: 0;
  preservesOriginalAudio: true;
  alignmentStatus: DocumentAlignmentStatus;
  source: DocumentSource;
  version?: number;
  metadata?: Record<string, unknown>;
  segments: LyricSegment[];
  createdAt: string;
  updatedAt: string;
}

export interface JobTransitionRecord {
  fromState: ProcessingPipelineState | null;
  toState: ProcessingPipelineState;
  message: string;
  timestamp: string;
}

export interface AdapterCapabilityInfo {
  name: string;
  adapterClass: string;
  implementation: string;
  status: 'unconfigured_adapter' | 'development_mock' | 'ready';
  isImplementedForProduction: boolean;
  note: string;
  phaseTarget: string;
}

export interface AsrRoutingStrategyInfo {
  interfaceClass: string;
  primaryModel: string;
  fallbackModels: string[];
  stages: string[];
}

export interface AdapterReportMap {
  vocalSeparation: AdapterCapabilityInfo;
  singingAsr: AdapterCapabilityInfo;
  forcedAlignment: AdapterCapabilityInfo;
  lyricsValidation: AdapterCapabilityInfo;
  secretsProtected: boolean;
  geminiServerConfigured: boolean;
  asrRouting?: AsrRoutingStrategyInfo;
}

export interface CanonicalProcessingJob {
  jobId: string;
  songId: string;
  status: ProcessingStatus;
  progress: number;
  currentStep: string;
  error?: string;
}

export interface ProcessingJob {
  jobId: string;
  audioId: string;
  songId?: string;
  documentId: string | null;
  state: ProcessingPipelineState;
  status?: ProcessingStatus;
  progressPercent: number;
  progress?: number;
  currentStep?: string;
  languageHint: string;
  enableVocalSeparation: boolean;
  phaseMode: string;
  adapterReport?: Partial<AdapterReportMap>;
  transitions: JobTransitionRecord[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AudioAssetRecord {
  audioId: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  durationSeconds: number;
  sampleRateHz: number;
  channels: number;
  bitDepth?: number;
  codecContainer?: string;
  waveformPeaks?: number[];
  audioUrl: string;
  createdAt: string;
}

export interface LyricsValidationIssue {
  code: string;
  path: string;
  message: string;
}

export interface LyricsValidationResult {
  valid: boolean;
  segmentCount: number;
  wordCount: number;
  unitCount: number;
  alignedSegmentCount: number;
  unalignedWordCount: number;
  issues: LyricsValidationIssue[];
}

export function canTransitionJobState(
  current: ProcessingPipelineState,
  target: ProcessingPipelineState,
): boolean {
  return ALLOWED_JOB_TRANSITIONS[current].includes(target);
}

export function transitionProcessingJob(
  job: ProcessingJob,
  nextState: ProcessingPipelineState,
  message = '',
  error: string | null = null,
): ProcessingJob {
  const currentState = job.status ?? job.state;
  if (!canTransitionJobState(currentState, nextState)) {
    throw new Error(
      `Illegal pipeline transition from '${currentState}' to '${nextState}'.`,
    );
  }
  const now = new Date().toISOString();
  const nextProgress = STAGE_PROGRESS_PERCENT[nextState];
  const resolvedStep =
    (message && message.trim()) || DEFAULT_JOB_STEP_MESSAGES[nextState];
  return {
    ...job,
    songId: job.songId || job.audioId,
    state: nextState,
    status: nextState,
    progressPercent: nextProgress,
    progress: nextProgress,
    currentStep: resolvedStep,
    error: nextState === 'queued' ? null : (error ?? job.error),
    transitions: [
      ...(job.transitions || []),
      {
        fromState: currentState,
        toState: nextState,
        message: resolvedStep,
        timestamp: now,
      },
    ],
    updatedAt: now,
  };
}

export function toCanonicalProcessingJob(job: ProcessingJob): CanonicalProcessingJob {
  const status: ProcessingStatus = job.status ?? job.state;
  const lastTransitionMsg =
    job.transitions && job.transitions.length > 0
      ? job.transitions[job.transitions.length - 1]?.message
      : '';
  const currentStep =
    (job.currentStep && job.currentStep.trim()) ||
    (lastTransitionMsg && lastTransitionMsg.trim()) ||
    DEFAULT_JOB_STEP_MESSAGES[status];
  const progress =
    typeof job.progress === 'number'
      ? job.progress
      : typeof job.progressPercent === 'number'
        ? job.progressPercent
        : STAGE_PROGRESS_PERCENT[status];

  const canonical: CanonicalProcessingJob = {
    jobId: job.jobId,
    songId: job.songId || job.audioId,
    status,
    progress: Math.max(0, Math.min(100, Math.round(progress))),
    currentStep,
  };
  if (job.error) {
    canonical.error = job.error;
  }
  return canonical;
}

const VALID_PROCESSING_STATUSES = new Set<string>(Object.keys(ALLOWED_JOB_TRANSITIONS));

export function validateCanonicalProcessingJob(
  job: CanonicalProcessingJob,
): LyricsValidationIssue[] {
  const issues: LyricsValidationIssue[] = [];
  if (!job || typeof job.jobId !== 'string' || !job.jobId.trim()) {
    issues.push({
      code: 'invalid_job_id',
      path: 'jobId',
      message: 'jobId must be a non-empty string.',
    });
  }
  if (!job || typeof job.songId !== 'string' || !job.songId.trim()) {
    issues.push({
      code: 'invalid_song_id',
      path: 'songId',
      message: 'songId must be a non-empty string.',
    });
  }
  if (!job || !VALID_PROCESSING_STATUSES.has(String(job.status))) {
    issues.push({
      code: 'invalid_processing_status',
      path: 'status',
      message: `status must be one of the 9 canonical ProcessingStatus states.`,
    });
  }
  if (
    !job ||
    typeof job.progress !== 'number' ||
    !Number.isFinite(job.progress) ||
    job.progress < 0 ||
    job.progress > 100
  ) {
    issues.push({
      code: 'invalid_progress_range',
      path: 'progress',
      message: 'progress must be a finite number between 0 and 100.',
    });
  }
  if (!job || typeof job.currentStep !== 'string' || !job.currentStep.trim()) {
    issues.push({
      code: 'invalid_current_step',
      path: 'currentStep',
      message: 'currentStep must be a non-empty string.',
    });
  }
  return issues;
}

function validateSpan(
  start: number | null,
  end: number | null,
  path: string,
  issues: LyricsValidationIssue[],
  maxDuration: number | null,
): void {
  if (start === null && end === null) return;
  if ((start === null) !== (end === null)) {
    issues.push({
      code: 'incomplete_timestamp_pair',
      path,
      message: 'Both startSeconds and endSeconds must be numbers or both null.',
    });
    return;
  }
  const s = start as number;
  const e = end as number;
  if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e < 0) {
    issues.push({
      code: 'negative_timestamp',
      path,
      message: `Timestamps must be finite numbers >= 0.0s (got ${s}, ${e}).`,
    });
  }
  if (e < s) {
    issues.push({
      code: 'inverted_timestamp_range',
      path,
      message: `endSeconds (${e}) must be >= startSeconds (${s}).`,
    });
  }
  if (maxDuration !== null && maxDuration > 0 && e > maxDuration + 0.05) {
    issues.push({
      code: 'timestamp_exceeds_duration',
      path,
      message: `endSeconds (${e}) exceeds audio durationSeconds (${maxDuration}).`,
    });
  }
}

export function validateLyricsDocument(doc: LyricsDocument): LyricsValidationResult {
  const issues: LyricsValidationIssue[] = [];

  if (doc.schemaVersion !== '1.0.0') {
    issues.push({
      code: 'unsupported_schema_version',
      path: 'schemaVersion',
      message: "schemaVersion must be '1.0.0'.",
    });
  }

  if (doc.timelineOriginSeconds !== 0) {
    issues.push({
      code: 'invalid_timeline_origin',
      path: 'timelineOriginSeconds',
      message: 'timelineOriginSeconds must be 0 relative to the original audio file.',
    });
  }

  if (!Number.isFinite(doc.durationSeconds) || doc.durationSeconds < 0) {
    issues.push({
      code: 'invalid_duration',
      path: 'durationSeconds',
      message: 'durationSeconds must be a non-negative number in seconds.',
    });
  }

  const maxDur = doc.durationSeconds > 0 ? doc.durationSeconds : null;
  let wordCount = 0;
  let unitCount = 0;
  let alignedSegmentCount = 0;
  let unalignedWordCount = 0;
  let prevSegEnd: number | null = null;

  for (let sIdx = 0; sIdx < doc.segments.length; sIdx += 1) {
    const seg = doc.segments[sIdx];
    const segPath = `segments[${sIdx}]`;
    validateSpan(seg.startSeconds, seg.endSeconds, segPath, issues, maxDur);

    if (seg.startSeconds !== null && seg.endSeconds !== null) {
      alignedSegmentCount += 1;
      if (prevSegEnd !== null && seg.startSeconds < prevSegEnd - 0.001) {
        issues.push({
          code: 'overlapping_or_non_monotonic_segment',
          path: segPath,
          message: `Segment startSeconds (${seg.startSeconds}s) precedes previous endSeconds (${prevSegEnd}s).`,
        });
      }
      prevSegEnd = seg.endSeconds;
    }

    let prevWordEnd: number | null = null;
    for (let wIdx = 0; wIdx < seg.words.length; wIdx += 1) {
      const word = seg.words[wIdx];
      wordCount += 1;
      const wPath = `${segPath}.words[${wIdx}]`;
      validateSpan(word.startSeconds, word.endSeconds, wPath, issues, maxDur);

      if (word.startSeconds === null && word.endSeconds === null) {
        unalignedWordCount += 1;
      } else if (word.startSeconds !== null && word.endSeconds !== null) {
        if (seg.startSeconds !== null && word.startSeconds < seg.startSeconds - 0.001) {
          issues.push({
            code: 'word_before_segment_start',
            path: wPath,
            message: 'Word startSeconds precedes segment startSeconds.',
          });
        }
        if (seg.endSeconds !== null && word.endSeconds > seg.endSeconds + 0.001) {
          issues.push({
            code: 'word_after_segment_end',
            path: wPath,
            message: 'Word endSeconds exceeds segment endSeconds.',
          });
        }
        if (prevWordEnd !== null && word.startSeconds < prevWordEnd - 0.001) {
          issues.push({
            code: 'overlapping_or_non_monotonic_word',
            path: wPath,
            message: 'Word startSeconds precedes prior word endSeconds.',
          });
        }
        prevWordEnd = word.endSeconds;
      }

      let prevUnitEnd: number | null = null;
      for (let uIdx = 0; uIdx < word.units.length; uIdx += 1) {
        const unit = word.units[uIdx];
        unitCount += 1;
        const uPath = `${wPath}.units[${uIdx}]`;
        validateSpan(unit.startSeconds, unit.endSeconds, uPath, issues, maxDur);
        if (unit.startSeconds !== null && unit.endSeconds !== null) {
          if (word.startSeconds !== null && unit.startSeconds < word.startSeconds - 0.001) {
            issues.push({
              code: 'unit_before_word_start',
              path: uPath,
              message: 'Unit startSeconds precedes parent word startSeconds.',
            });
          }
          if (word.endSeconds !== null && unit.endSeconds > word.endSeconds + 0.001) {
            issues.push({
              code: 'unit_after_word_end',
              path: uPath,
              message: 'Unit endSeconds exceeds parent word endSeconds.',
            });
          }
          if (prevUnitEnd !== null && unit.startSeconds < prevUnitEnd - 0.001) {
            issues.push({
              code: 'non_monotonic_unit',
              path: uPath,
              message: 'Unit startSeconds precedes prior unit endSeconds.',
            });
          }
          prevUnitEnd = unit.endSeconds;
        }
      }
    }
  }

  return {
    valid: issues.length === 0,
    segmentCount: doc.segments.length,
    wordCount,
    unitCount,
    alignedSegmentCount,
    unalignedWordCount,
    issues,
  };
}

/**
 * Segment coordinate mapping between an analysis slice/chunk and the untouched
 * original audio file timeline (seconds >= 0.0).
 */
export interface AnalysisSegmentMapping {
  analysis_segment_id: string;
  analysis_start: number;
  analysis_end: number;
  original_start: number;
  original_end: number;
}

export interface CanonicalAlignmentUnit {
  text: string;
  start: number | null;
  end: number | null;
}

export interface CanonicalAlignmentWord {
  id: string;
  text: string;
  start: number | null;
  end: number | null;
  confidence: number | null;
  alignment_confidence: number | null;
  units: CanonicalAlignmentUnit[];
}

export interface CanonicalAlignmentSegment {
  id: string;
  text: string;
  start: number | null;
  end: number | null;
  words: CanonicalAlignmentWord[];
}

export type CanonicalTranscriptionStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'manual';

export type CanonicalAlignmentStatus =
  | 'unaligned'
  | 'partial'
  | 'completed'
  | 'validated'
  | 'failed';

export interface CanonicalSongAlignmentDocument {
  song_id: string;
  audio_duration: number;
  language: string;
  transcription_status: CanonicalTranscriptionStatus;
  alignment_status: CanonicalAlignmentStatus;
  alignment_version: string;
  segments: CanonicalAlignmentSegment[];
}

function roundSec(val: number): number {
  return Math.round(val * 1000) / 1000;
}

export function validateAnalysisSegmentMapping(
  mapping: AnalysisSegmentMapping,
  originalDurationSeconds?: number,
): LyricsValidationIssue[] {
  const issues: LyricsValidationIssue[] = [];
  const id = String(mapping?.analysis_segment_id || '').trim();
  if (!id) {
    issues.push({
      code: 'invalid_analysis_segment_id',
      path: 'analysis_segment_id',
      message: 'analysis_segment_id must be a non-empty string.',
    });
  }
  const fields: Array<keyof Omit<AnalysisSegmentMapping, 'analysis_segment_id'>> = [
    'analysis_start',
    'analysis_end',
    'original_start',
    'original_end',
  ];
  for (const key of fields) {
    const v = mapping[key];
    if (!Number.isFinite(v) || v < 0) {
      issues.push({
        code: 'negative_or_invalid_mapping_timestamp',
        path: String(key),
        message: `${String(key)} must be a finite number >= 0.`,
      });
    }
  }
  if (
    Number.isFinite(mapping.analysis_start) &&
    Number.isFinite(mapping.analysis_end) &&
    mapping.analysis_end <= mapping.analysis_start
  ) {
    issues.push({
      code: 'invalid_analysis_span',
      path: 'analysis_end',
      message: `analysis_end (${mapping.analysis_end}) must be > analysis_start (${mapping.analysis_start}).`,
    });
  }
  if (
    Number.isFinite(mapping.original_start) &&
    Number.isFinite(mapping.original_end) &&
    mapping.original_end <= mapping.original_start
  ) {
    issues.push({
      code: 'invalid_original_span',
      path: 'original_end',
      message: `original_end (${mapping.original_end}) must be > original_start (${mapping.original_start}).`,
    });
  }
  if (
    typeof originalDurationSeconds === 'number' &&
    originalDurationSeconds > 0 &&
    Number.isFinite(mapping.original_end) &&
    mapping.original_end > originalDurationSeconds + 0.05
  ) {
    issues.push({
      code: 'mapping_exceeds_original_duration',
      path: 'original_end',
      message: `original_end (${mapping.original_end}) exceeds audio duration (${originalDurationSeconds}s).`,
    });
  }
  return issues;
}

/**
 * Remaps an analysis-timeline timestamp onto the original audio timeline using
 * linear interpolation within [analysis_start, analysis_end] -> [original_start, original_end].
 * For exact 1:1 slices (same span duration), this equals original_start + (t - analysis_start).
 */
export function remapAnalysisTimestampToOriginal(
  analysisTimeSec: number,
  mapping: AnalysisSegmentMapping,
): number {
  const analysisSpan = Math.max(1e-6, mapping.analysis_end - mapping.analysis_start);
  const originalSpan = Math.max(0, mapping.original_end - mapping.original_start);
  const ratio = (analysisTimeSec - mapping.analysis_start) / analysisSpan;
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  return roundSec(mapping.original_start + clampedRatio * originalSpan);
}

export function remapSegmentAlignmentToOriginal(
  segment: CanonicalAlignmentSegment,
  mapping: AnalysisSegmentMapping,
): CanonicalAlignmentSegment {
  const mapOpt = (v: number | null): number | null =>
    v === null || v === undefined ? null : remapAnalysisTimestampToOriginal(v, mapping);

  return {
    ...segment,
    start: mapOpt(segment.start),
    end: mapOpt(segment.end),
    words: (segment.words || []).map((word) => ({
      ...word,
      start: mapOpt(word.start),
      end: mapOpt(word.end),
      units: (word.units || []).map((unit) => ({
        ...unit,
        start: mapOpt(unit.start),
        end: mapOpt(unit.end),
      })),
    })),
  };
}

export function validateCanonicalSongAlignment(
  doc: CanonicalSongAlignmentDocument,
): LyricsValidationResult {
  const issues: LyricsValidationIssue[] = [];
  if (!doc || typeof doc.song_id !== 'string' || !doc.song_id.trim()) {
    issues.push({
      code: 'invalid_song_id',
      path: 'song_id',
      message: 'song_id must be a non-empty string.',
    });
  }
  if (!Number.isFinite(doc.audio_duration) || doc.audio_duration < 0) {
    issues.push({
      code: 'invalid_audio_duration',
      path: 'audio_duration',
      message: 'audio_duration must be a non-negative number in seconds.',
    });
  }
  const maxDur = doc.audio_duration > 0 ? doc.audio_duration : null;
  let wordCount = 0;
  let unitCount = 0;
  let alignedSegmentCount = 0;
  let unalignedWordCount = 0;
  let prevSegEnd: number | null = null;

  for (let sIdx = 0; sIdx < (doc.segments || []).length; sIdx += 1) {
    const seg = doc.segments[sIdx];
    const segPath = `segments[${sIdx}]`;
    validateSpan(seg.start, seg.end, segPath, issues, maxDur);
    if (seg.start !== null && seg.end !== null) {
      alignedSegmentCount += 1;
      if (prevSegEnd !== null && seg.start < prevSegEnd - 0.001) {
        issues.push({
          code: 'overlapping_or_non_monotonic_segment',
          path: segPath,
          message: `Segment start (${seg.start}s) precedes previous end (${prevSegEnd}s).`,
        });
      }
      prevSegEnd = seg.end;
    }

    let prevWordEnd: number | null = null;
    for (let wIdx = 0; wIdx < (seg.words || []).length; wIdx += 1) {
      const word = seg.words[wIdx];
      wordCount += 1;
      const wPath = `${segPath}.words[${wIdx}]`;
      validateSpan(word.start, word.end, wPath, issues, maxDur);

      for (const [k, v] of [
        ['confidence', word.confidence],
        ['alignment_confidence', word.alignment_confidence],
      ] as const) {
        if (v !== null && (!Number.isFinite(v) || v < 0 || v > 1)) {
          issues.push({
            code: 'invalid_confidence_range',
            path: `${wPath}.${k}`,
            message: `${k} must be between 0.0 and 1.0.`,
          });
        }
      }

      if (word.start === null && word.end === null) {
        unalignedWordCount += 1;
      } else if (word.start !== null && word.end !== null) {
        if (seg.start !== null && word.start < seg.start - 0.001) {
          issues.push({
            code: 'word_before_segment_start',
            path: wPath,
            message: 'Word start precedes segment start.',
          });
        }
        if (seg.end !== null && word.end > seg.end + 0.001) {
          issues.push({
            code: 'word_after_segment_end',
            path: wPath,
            message: 'Word end exceeds segment end.',
          });
        }
        if (prevWordEnd !== null && word.start < prevWordEnd - 0.001) {
          issues.push({
            code: 'overlapping_or_non_monotonic_word',
            path: wPath,
            message: 'Word start precedes prior word end.',
          });
        }
        prevWordEnd = word.end;
      }

      let prevUnitEnd: number | null = null;
      for (let uIdx = 0; uIdx < (word.units || []).length; uIdx += 1) {
        const unit = word.units[uIdx];
        unitCount += 1;
        const uPath = `${wPath}.units[${uIdx}]`;
        validateSpan(unit.start, unit.end, uPath, issues, maxDur);
        if (unit.start !== null && unit.end !== null) {
          if (word.start !== null && unit.start < word.start - 0.001) {
            issues.push({
              code: 'unit_before_word_start',
              path: uPath,
              message: 'Unit start precedes parent word start.',
            });
          }
          if (word.end !== null && unit.end > word.end + 0.001) {
            issues.push({
              code: 'unit_after_word_end',
              path: uPath,
              message: 'Unit end exceeds parent word end.',
            });
          }
          if (prevUnitEnd !== null && unit.start < prevUnitEnd - 0.001) {
            issues.push({
              code: 'non_monotonic_unit',
              path: uPath,
              message: 'Unit start precedes prior unit end.',
            });
          }
          prevUnitEnd = unit.end;
        }
      }
    }
  }

  return {
    valid: issues.length === 0,
    segmentCount: (doc.segments || []).length,
    wordCount,
    unitCount,
    alignedSegmentCount,
    unalignedWordCount,
    issues,
  };
}

export function toCanonicalSongAlignment(
  doc: LyricsDocument,
  options?: { alignmentVersion?: string },
): CanonicalSongAlignmentDocument {
  const alignmentStatusMap: Record<DocumentAlignmentStatus, CanonicalAlignmentStatus> = {
    unaligned: 'unaligned',
    phase1_placeholder: 'unaligned',
    partial_manual: 'partial',
    aligned: 'completed',
    validated: 'validated',
  };
  const transcriptionStatus: CanonicalTranscriptionStatus =
    doc.source === 'manual_editor'
      ? 'manual'
      : doc.source === 'phase1_stub' && doc.alignmentStatus === 'phase1_placeholder'
        ? 'pending'
        : 'completed';

  let wordSeq = 0;
  return {
    song_id: doc.audioId || doc.documentId,
    audio_duration: roundSec(doc.durationSeconds || 0),
    language: doc.primaryLanguage || 'auto',
    transcription_status: transcriptionStatus,
    alignment_status: alignmentStatusMap[doc.alignmentStatus] || 'unaligned',
    alignment_version: options?.alignmentVersion || 'v1',
    segments: (doc.segments || []).map((seg, sIdx) => ({
      id: seg.segmentId || `line_${String(sIdx + 1).padStart(3, '0')}`,
      text: seg.text,
      start: seg.startSeconds === null ? null : roundSec(seg.startSeconds),
      end: seg.endSeconds === null ? null : roundSec(seg.endSeconds),
      words: (seg.words || []).map((word) => {
        wordSeq += 1;
        return {
          id: word.wordId || `word_${String(wordSeq).padStart(3, '0')}`,
          text: word.text,
          start: word.startSeconds === null ? null : roundSec(word.startSeconds),
          end: word.endSeconds === null ? null : roundSec(word.endSeconds),
          confidence: word.confidence,
          alignment_confidence: word.confidence,
          units:
            word.units && word.units.length > 0
              ? word.units.map((u) => ({
                  text: u.text,
                  start: u.startSeconds === null ? null : roundSec(u.startSeconds),
                  end: u.endSeconds === null ? null : roundSec(u.endSeconds),
                }))
              : [
                  {
                    text: word.text,
                    start: word.startSeconds === null ? null : roundSec(word.startSeconds),
                    end: word.endSeconds === null ? null : roundSec(word.endSeconds),
                  },
                ],
        };
      }),
    })),
  };
}

export function fromCanonicalSongAlignment(
  canonical: CanonicalSongAlignmentDocument,
  options?: { documentId?: string; audioId?: string; title?: string; artist?: string },
): LyricsDocument {
  const now = new Date().toISOString();
  const statusMap: Record<CanonicalAlignmentStatus, DocumentAlignmentStatus> = {
    unaligned: 'unaligned',
    partial: 'partial_manual',
    completed: 'aligned',
    validated: 'validated',
    failed: 'unaligned',
  };

  return {
    schemaVersion: '1.0.0',
    documentId: options?.documentId || `lyr_${canonical.song_id}`,
    audioId: options?.audioId || canonical.song_id,
    jobId: null,
    title: options?.title || canonical.song_id,
    artist: options?.artist || '',
    primaryLanguage: canonical.language || 'auto',
    detectedLanguages: canonical.language && canonical.language !== 'auto' ? [canonical.language] : [],
    durationSeconds: canonical.audio_duration || 0,
    timelineOriginSeconds: 0,
    preservesOriginalAudio: true,
    alignmentStatus: statusMap[canonical.alignment_status] || 'unaligned',
    source:
      canonical.transcription_status === 'manual'
        ? 'manual_editor'
        : canonical.alignment_status === 'completed' || canonical.alignment_status === 'validated'
          ? 'forced_alignment_adapter'
          : 'singing_asr_adapter',
    metadata: {
      alignment_version: canonical.alignment_version,
      transcription_status: canonical.transcription_status,
    },
    segments: (canonical.segments || []).map((seg, sIdx) => ({
      segmentId: seg.id || `line_${String(sIdx + 1).padStart(3, '0')}`,
      index: sIdx,
      text: seg.text,
      startSeconds: seg.start,
      endSeconds: seg.end,
      language: canonical.language || 'auto',
      sectionType: 'verse',
      vocalType: 'lead',
      speaker: 'Lead',
      confidence: null,
      alignmentState: seg.start !== null && seg.end !== null ? 'aligned' : 'unaligned',
      isPlaceholder: false,
      words: (seg.words || []).map((w, wIdx) => ({
        wordId: w.id || `${seg.id || `line_${sIdx + 1}`}_w${String(wIdx + 1).padStart(3, '0')}`,
        text: w.text,
        startSeconds: w.start,
        endSeconds: w.end,
        confidence: w.alignment_confidence ?? w.confidence,
        alignmentConfidence: w.alignment_confidence ?? w.confidence,
        alignmentState: w.start !== null && w.end !== null ? 'aligned' : 'unaligned',
        speaker: 'Lead',
        flags: [],
        units: (w.units || []).map((u, uIdx) => ({
          unitId: `${w.id || `w${wIdx + 1}`}_u${String(uIdx + 1).padStart(2, '0')}`,
          text: u.text,
          unitType: 'character',
          startSeconds: u.start,
          endSeconds: u.end,
          confidence: w.alignment_confidence ?? w.confidence,
          alignmentState: u.start !== null && u.end !== null ? 'aligned' : 'unaligned',
        })),
      })),
    })),
    createdAt: now,
    updatedAt: now,
  };
}

export function validateAlignedLyricsDocument(
  doc: AlignedLyricsDocument,
): LyricsValidationResult & { reviewRequiredCount: number } {
  const issues: LyricsValidationIssue[] = [];
  if (!doc || typeof doc.songId !== 'string' || !doc.songId.trim()) {
    issues.push({
      code: 'invalid_song_id',
      path: 'songId',
      message: 'songId must be a non-empty string.',
    });
  }
  if (!Number.isFinite(doc?.duration) || doc.duration < 0) {
    issues.push({
      code: 'invalid_duration',
      path: 'duration',
      message: 'duration must be a non-negative number in seconds.',
    });
  }
  if (!doc || typeof doc.language !== 'string' || !doc.language.trim()) {
    issues.push({
      code: 'invalid_language',
      path: 'language',
      message: 'language must be a non-empty string.',
    });
  }
  if (!Number.isInteger(doc?.version) || doc.version < 1) {
    issues.push({
      code: 'invalid_version',
      path: 'version',
      message: 'version must be an integer >= 1.',
    });
  }

  const maxDur = doc?.duration > 0 ? doc.duration : null;
  let wordCount = 0;
  let unitCount = 0;
  let alignedSegmentCount = 0;
  let reviewRequiredCount = 0;
  let prevSegEnd: number | null = null;

  for (let sIdx = 0; sIdx < (doc?.segments || []).length; sIdx += 1) {
    const seg = doc.segments[sIdx];
    const segPath = `segments[${sIdx}]`;
    if (!seg.id || !String(seg.id).trim()) {
      issues.push({
        code: 'invalid_segment_id',
        path: `${segPath}.id`,
        message: 'Segment id must be a non-empty string.',
      });
    }
    if (
      typeof seg.start !== 'number' ||
      typeof seg.end !== 'number' ||
      !Number.isFinite(seg.start) ||
      !Number.isFinite(seg.end)
    ) {
      issues.push({
        code: 'incomplete_timestamp_pair',
        path: segPath,
        message: 'Segment start and end must be finite numbers in seconds.',
      });
      continue;
    }
    validateSpan(seg.start, seg.end, segPath, issues, maxDur);
    alignedSegmentCount += 1;
    if (prevSegEnd !== null && seg.start < prevSegEnd - 0.001) {
      issues.push({
        code: 'overlapping_or_non_monotonic_segment',
        path: segPath,
        message: `Segment start (${seg.start}s) precedes previous end (${prevSegEnd}s).`,
      });
    }
    prevSegEnd = seg.end;

    let prevWordEnd: number | null = null;
    for (let wIdx = 0; wIdx < (seg.words || []).length; wIdx += 1) {
      const word = seg.words[wIdx];
      wordCount += 1;
      const wPath = `${segPath}.words[${wIdx}]`;
      if (!word.id || !String(word.id).trim()) {
        issues.push({
          code: 'invalid_word_id',
          path: `${wPath}.id`,
          message: 'Word id must be a non-empty string.',
        });
      }
      if (word.reviewRequired) {
        reviewRequiredCount += 1;
      }
      if (
        typeof word.start !== 'number' ||
        typeof word.end !== 'number' ||
        !Number.isFinite(word.start) ||
        !Number.isFinite(word.end)
      ) {
        issues.push({
          code: 'incomplete_timestamp_pair',
          path: wPath,
          message: 'Word start and end must be finite numbers in seconds.',
        });
        continue;
      }
      validateSpan(word.start, word.end, wPath, issues, maxDur);
      for (const [k, v] of [
        ['confidence', word.confidence],
        ['alignmentConfidence', word.alignmentConfidence],
      ] as const) {
        if (v !== undefined && (!Number.isFinite(v) || v < 0 || v > 1)) {
          issues.push({
            code: 'invalid_confidence_range',
            path: `${wPath}.${k}`,
            message: `${k} must be between 0.0 and 1.0.`,
          });
        }
      }
      if (word.start < seg.start - 0.001) {
        issues.push({
          code: 'word_before_segment_start',
          path: wPath,
          message: 'Word start precedes segment start.',
        });
      }
      if (word.end > seg.end + 0.001) {
        issues.push({
          code: 'word_after_segment_end',
          path: wPath,
          message: 'Word end exceeds segment end.',
        });
      }
      if (prevWordEnd !== null && word.start < prevWordEnd - 0.001) {
        issues.push({
          code: 'overlapping_or_non_monotonic_word',
          path: wPath,
          message: 'Word start precedes prior word end.',
        });
      }
      prevWordEnd = word.end;

      let prevUnitEnd: number | null = null;
      for (let uIdx = 0; uIdx < (word.units || []).length; uIdx += 1) {
        const unit = word.units![uIdx];
        unitCount += 1;
        const uPath = `${wPath}.units[${uIdx}]`;
        if (
          typeof unit.start !== 'number' ||
          typeof unit.end !== 'number' ||
          !Number.isFinite(unit.start) ||
          !Number.isFinite(unit.end)
        ) {
          issues.push({
            code: 'incomplete_timestamp_pair',
            path: uPath,
            message: 'Unit start and end must be finite numbers in seconds.',
          });
          continue;
        }
        validateSpan(unit.start, unit.end, uPath, issues, maxDur);
        if (
          unit.confidence !== undefined &&
          (!Number.isFinite(unit.confidence) || unit.confidence < 0 || unit.confidence > 1)
        ) {
          issues.push({
            code: 'invalid_confidence_range',
            path: `${uPath}.confidence`,
            message: 'unit confidence must be between 0.0 and 1.0.',
          });
        }
        if (unit.start < word.start - 0.001) {
          issues.push({
            code: 'unit_before_word_start',
            path: uPath,
            message: 'Unit start precedes parent word start.',
          });
        }
        if (unit.end > word.end + 0.001) {
          issues.push({
            code: 'unit_after_word_end',
            path: uPath,
            message: 'Unit end exceeds parent word end.',
          });
        }
        if (prevUnitEnd !== null && unit.start < prevUnitEnd - 0.001) {
          issues.push({
            code: 'non_monotonic_unit',
            path: uPath,
            message: 'Unit start precedes prior unit end.',
          });
        }
        prevUnitEnd = unit.end;
      }
    }
  }

  return {
    valid: issues.length === 0,
    segmentCount: (doc?.segments || []).length,
    wordCount,
    unitCount,
    alignedSegmentCount,
    unalignedWordCount: 0,
    reviewRequiredCount,
    issues,
  };
}

export function toAlignedLyricsDocument(
  doc: LyricsDocument,
  options?: { version?: number; reviewThreshold?: number },
): AlignedLyricsDocument {
  const reviewThreshold = options?.reviewThreshold ?? 0.75;
  const metaVersion =
    typeof doc.version === 'number'
      ? doc.version
      : typeof doc.metadata?.version === 'number'
        ? doc.metadata.version
        : 1;
  let wordSeq = 0;

  return {
    songId: doc.audioId || doc.documentId,
    duration: roundSec(doc.durationSeconds || 0),
    language: doc.primaryLanguage || 'auto',
    version: Math.max(1, Math.round(options?.version ?? metaVersion)),
    segments: (doc.segments || []).map((seg, sIdx) => ({
      id: seg.segmentId || `seg_${String(sIdx + 1).padStart(3, '0')}`,
      text: seg.text,
      start: roundSec(seg.startSeconds ?? 0),
      end: roundSec(seg.endSeconds ?? seg.startSeconds ?? 0),
      words: (seg.words || []).map((w) => {
        wordSeq += 1;
        const conf = typeof w.confidence === 'number' ? w.confidence : undefined;
        const alignConf =
          typeof w.alignmentConfidence === 'number' ? w.alignmentConfidence : conf;
        const needsReview =
          typeof w.reviewRequired === 'boolean'
            ? w.reviewRequired
            : typeof alignConf === 'number'
              ? alignConf < reviewThreshold
              : undefined;

        const outWord: AlignedLyricWord = {
          id: w.wordId || `word_${String(wordSeq).padStart(3, '0')}`,
          text: w.text,
          start: roundSec(w.startSeconds ?? seg.startSeconds ?? 0),
          end: roundSec(w.endSeconds ?? w.startSeconds ?? seg.startSeconds ?? 0),
        };
        if (conf !== undefined) outWord.confidence = conf;
        if (alignConf !== undefined) outWord.alignmentConfidence = alignConf;
        if (needsReview !== undefined) outWord.reviewRequired = needsReview;
        if (w.units && w.units.length > 0) {
          outWord.units = w.units.map((u, uIdx) => {
            const outUnit: AlignedLyricUnit = {
              id: u.unitId || `${outWord.id}_u${String(uIdx + 1).padStart(2, '0')}`,
              text: u.text,
              start: roundSec(u.startSeconds ?? outWord.start),
              end: roundSec(u.endSeconds ?? u.startSeconds ?? outWord.end),
            };
            if (typeof u.confidence === 'number') {
              outUnit.confidence = u.confidence;
            }
            return outUnit;
          });
        }
        return outWord;
      }),
    })),
  };
}

export function fromAlignedLyricsDocument(
  aligned: AlignedLyricsDocument,
  options?: { documentId?: string; audioId?: string; title?: string; artist?: string },
): LyricsDocument {
  const now = new Date().toISOString();
  const safeVersion = Math.max(1, Math.round(aligned.version || 1));

  return {
    schemaVersion: '1.0.0',
    documentId: options?.documentId || `lyr_${aligned.songId}`,
    audioId: options?.audioId || aligned.songId,
    jobId: null,
    title: options?.title || aligned.songId,
    artist: options?.artist || '',
    primaryLanguage: aligned.language || 'auto',
    detectedLanguages:
      aligned.language && aligned.language !== 'auto' ? [aligned.language] : [],
    durationSeconds: roundSec(aligned.duration || 0),
    timelineOriginSeconds: 0,
    preservesOriginalAudio: true,
    alignmentStatus: aligned.segments.some((s) =>
      s.words?.some((w) => w.reviewRequired),
    )
      ? 'aligned'
      : 'validated',
    source: 'forced_alignment_adapter',
    version: safeVersion,
    metadata: {
      version: safeVersion,
      aligned_contract: 'camelCase_v1',
    },
    segments: (aligned.segments || []).map((seg, sIdx) => ({
      segmentId: seg.id || `seg_${String(sIdx + 1).padStart(3, '0')}`,
      index: sIdx,
      text: seg.text,
      startSeconds: roundSec(seg.start),
      endSeconds: roundSec(seg.end),
      language: aligned.language || 'auto',
      sectionType: 'verse',
      vocalType: 'lead',
      speaker: 'Lead',
      confidence: null,
      alignmentState: 'aligned',
      isPlaceholder: false,
      words: (seg.words || []).map((w, wIdx) => ({
        wordId: w.id || `${seg.id || `seg_${sIdx + 1}`}_w${String(wIdx + 1).padStart(3, '0')}`,
        text: w.text,
        startSeconds: roundSec(w.start),
        endSeconds: roundSec(w.end),
        confidence: w.confidence ?? w.alignmentConfidence ?? null,
        alignmentConfidence: w.alignmentConfidence ?? w.confidence ?? null,
        alignmentState: 'aligned',
        reviewRequired: Boolean(w.reviewRequired),
        speaker: 'Lead',
        flags: w.reviewRequired ? ['review_required'] : [],
        units: (w.units || []).map((u, uIdx) => ({
          unitId: u.id || `${w.id || `w${wIdx + 1}`}_u${String(uIdx + 1).padStart(2, '0')}`,
          text: u.text,
          unitType: 'character',
          startSeconds: roundSec(u.start),
          endSeconds: roundSec(u.end),
          confidence: u.confidence ?? w.confidence ?? null,
          alignmentState: 'aligned',
        })),
      })),
    })),
    createdAt: now,
    updatedAt: now,
  };
}

