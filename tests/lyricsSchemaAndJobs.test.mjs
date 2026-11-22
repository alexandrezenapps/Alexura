import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PIPELINE_STAGE_ORDER,
  canTransitionJobState,
  transitionProcessingJob,
  validateLyricsDocument,
} from '../frontend/src/types/lyrics.ts';

function makeValidDoc(overrides = {}) {
  return {
    schemaVersion: '1.0.0',
    documentId: 'lyr_ts_001',
    audioId: 'aud_ts_001',
    jobId: 'job_ts_001',
    title: 'Phase 1 Track',
    artist: 'Alexura Studio',
    primaryLanguage: 'fr',
    detectedLanguages: ['fr'],
    durationSeconds: 120.5,
    timelineOriginSeconds: 0,
    preservesOriginalAudio: true,
    alignmentStatus: 'unaligned',
    source: 'phase1_stub',
    segments: [
      {
        segmentId: 'seg_000',
        index: 0,
        text: 'Sous la lune',
        startSeconds: null,
        endSeconds: null,
        sectionType: 'verse',
        vocalType: 'lead',
        alignmentState: 'unaligned',
        words: [
          {
            wordId: 'seg_000_w000',
            text: 'Sous',
            startSeconds: null,
            endSeconds: null,
            confidence: null,
            alignmentState: 'unaligned',
            flags: ['unaligned_phase1'],
            units: [
              {
                unitId: 'seg_000_w000_u00',
                text: 'S',
                unitType: 'character',
                startSeconds: null,
                endSeconds: null,
                confidence: null,
                alignmentState: 'unaligned',
              },
            ],
          },
        ],
      },
    ],
    createdAt: '2026-11-21T00:00:00.000Z',
    updatedAt: '2026-11-21T00:00:00.000Z',
    ...overrides,
  };
}

test('Normalized TS LyricsDocument validates unaligned Phase 1 document cleanly', () => {
  const res = validateLyricsDocument(makeValidDoc());
  assert.equal(res.valid, true);
  assert.equal(res.segmentCount, 1);
  assert.equal(res.unalignedWordCount, 1);
});

test('Normalized TS LyricsDocument rejects negative or out-of-order word timestamps', () => {
  const bad = makeValidDoc({
    segments: [
      {
        segmentId: 'seg_000',
        index: 0,
        text: 'Sous la lune',
        startSeconds: 2.0,
        endSeconds: 4.0,
        sectionType: 'verse',
        vocalType: 'lead',
        alignmentState: 'manual',
        words: [
          {
            wordId: 'seg_000_w000',
            text: 'Sous',
            startSeconds: 1.5, // invalid: precedes segment start
            endSeconds: 2.5,
            confidence: null,
            alignmentState: 'manual',
            flags: [],
            units: [],
          },
        ],
      },
    ],
  });
  const res = validateLyricsDocument(bad);
  assert.equal(res.valid, false);
  assert.equal(res.issues[0].code, 'word_before_segment_start');
});

test('ProcessingJob transitions through all 9 valid states and blocks illegal jumps', () => {
  let job = {
    jobId: 'job_ts_001',
    audioId: 'aud_ts_001',
    documentId: 'lyr_ts_001',
    state: 'queued',
    progressPercent: 0,
    languageHint: 'auto',
    enableVocalSeparation: true,
    phaseMode: 'phase_1_architecture_foundation',
    transitions: [],
    error: null,
    createdAt: '2026-11-21T00:00:00.000Z',
    updatedAt: '2026-11-21T00:00:00.000Z',
  };

  for (let i = 1; i < PIPELINE_STAGE_ORDER.length; i += 1) {
    job = transitionProcessingJob(job, PIPELINE_STAGE_ORDER[i], 'ok');
  }
  assert.equal(job.state, 'completed');
  assert.equal(job.progressPercent, 100);
  assert.equal(canTransitionJobState('completed', 'queued'), false);

  assert.throws(() => {
    transitionProcessingJob(job, 'validating', 'illegal revert');
  }, /Illegal pipeline transition/);
});
