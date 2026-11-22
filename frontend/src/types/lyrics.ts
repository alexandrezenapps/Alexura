/**
 * Core TypeScript Data Types, Finite-State Machine & Validation Rules
 * for Alexura AI Lyrics Sync Engine (Phase 1 — Architecture Foundation).
 *
 * INVARIANT: All timestamps MUST use seconds (>= 0.0) relative to the
 * untouched original uploaded audio file (origin = 0.000s).
 * Unaligned elements MUST use `null` timestamps — NEVER fake word timings.
 */

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
  alignmentState: ElementAlignmentState;
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

export interface AdapterReportMap {
  vocalSeparation: AdapterCapabilityInfo;
  singingAsr: AdapterCapabilityInfo;
  forcedAlignment: AdapterCapabilityInfo;
  lyricsValidation: AdapterCapabilityInfo;
  secretsProtected: boolean;
  geminiServerConfigured: boolean;
}

export interface ProcessingJob {
  jobId: string;
  audioId: string;
  documentId: string | null;
  state: ProcessingPipelineState;
  progressPercent: number;
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
  if (!canTransitionJobState(job.state, nextState)) {
    throw new Error(
      `Illegal pipeline transition from '${job.state}' to '${nextState}'.`,
    );
  }
  const now = new Date().toISOString();
  return {
    ...job,
    state: nextState,
    progressPercent: STAGE_PROGRESS_PERCENT[nextState],
    error: nextState === 'queued' ? null : (error ?? job.error),
    transitions: [
      ...job.transitions,
      {
        fromState: job.state,
        toState: nextState,
        message,
        timestamp: now,
      },
    ],
    updatedAt: now,
  };
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
