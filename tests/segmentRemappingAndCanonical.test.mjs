import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import test from 'node:test';
import {
  fromAlignedLyricsDocument,
  fromCanonicalSongAlignment,
  remapAnalysisTimestampToOriginal,
  remapSegmentAlignmentToOriginal,
  toAlignedLyricsDocument,
  toCanonicalProcessingJob,
  toCanonicalSongAlignment,
  transitionProcessingJob,
  validateAlignedLyricsDocument,
  validateAnalysisSegmentMapping,
  validateCanonicalProcessingJob,
  validateCanonicalSongAlignment,
  validateLyricsDocument,
} from '../frontend/src/types/lyrics.ts';
import { createSyncEngineV1Router } from '../server/routes/syncEngineRoutes.ts';

const SAMPLE_SEGMENT_MAPPING = {
  analysis_segment_id: 'seg_002',
  analysis_start: 6.4,
  analysis_end: 14.1,
  original_start: 21.0,
  original_end: 28.7,
};

const SAMPLE_CANONICAL_SONG = {
  song_id: 'song_001',
  audio_duration: 185.42,
  language: 'zh',
  transcription_status: 'completed',
  alignment_status: 'completed',
  alignment_version: 'v1',
  segments: [
    {
      id: 'line_001',
      text: '我爱你',
      start: 12.32,
      end: 14.08,
      words: [
        {
          id: 'word_001',
          text: '我',
          start: 12.32,
          end: 12.61,
          confidence: 0.96,
          alignment_confidence: 0.92,
          units: [{ text: '我', start: 12.32, end: 12.61 }],
        },
        {
          id: 'word_002',
          text: '爱',
          start: 12.62,
          end: 13.15,
          confidence: 0.98,
          alignment_confidence: 0.94,
          units: [{ text: '爱', start: 12.62, end: 13.15 }],
        },
        {
          id: 'word_003',
          text: '你',
          start: 13.16,
          end: 14.08,
          confidence: 0.97,
          alignment_confidence: 0.89,
          units: [{ text: '你', start: 13.16, end: 14.08 }],
        },
      ],
    },
  ],
};

test('AnalysisSegmentMapping validates cleanly and remaps analysis -> original timestamps accurately', () => {
  assert.deepEqual(validateAnalysisSegmentMapping(SAMPLE_SEGMENT_MAPPING, 185.42), []);

  assert.equal(remapAnalysisTimestampToOriginal(6.4, SAMPLE_SEGMENT_MAPPING), 21.0);
  assert.equal(remapAnalysisTimestampToOriginal(14.1, SAMPLE_SEGMENT_MAPPING), 28.7);
  assert.equal(remapAnalysisTimestampToOriginal(10.25, SAMPLE_SEGMENT_MAPPING), 24.85);

  const remappedSeg = remapSegmentAlignmentToOriginal(
    {
      id: 'line_001',
      text: '我爱你',
      start: 7.4,
      end: 9.16,
      words: [
        {
          id: 'word_001',
          text: '我',
          start: 7.4,
          end: 7.69,
          confidence: 0.96,
          alignment_confidence: 0.92,
          units: [{ text: '我', start: 7.4, end: 7.69 }],
        },
      ],
    },
    SAMPLE_SEGMENT_MAPPING,
  );

  assert.equal(remappedSeg.start, 22.0);
  assert.equal(remappedSeg.end, 23.76);
  assert.equal(remappedSeg.words[0].start, 22.0);
  assert.equal(remappedSeg.words[0].units[0].end, 22.29);
});

test('CanonicalSongAlignmentDocument validates Chinese word/unit structure and converts losslessly with LyricsDocument', () => {
  const report = validateCanonicalSongAlignment(SAMPLE_CANONICAL_SONG);
  assert.equal(report.valid, true);
  assert.equal(report.segmentCount, 1);
  assert.equal(report.wordCount, 3);
  assert.equal(report.unitCount, 3);

  const normalized = fromCanonicalSongAlignment(SAMPLE_CANONICAL_SONG);
  const normReport = validateLyricsDocument(normalized);
  assert.equal(normReport.valid, true);
  assert.equal(normalized.primaryLanguage, 'zh');
  assert.equal(normalized.segments[0].words[1].text, '爱');

  const roundTrip = toCanonicalSongAlignment(normalized);
  assert.equal(roundTrip.song_id, 'song_001');
  assert.equal(roundTrip.audio_duration, 185.42);
  assert.equal(roundTrip.segments[0].words[2].text, '你');
  assert.equal(roundTrip.segments[0].words[2].start, 13.16);
});

test('Express /api/v1 router exposes schema discovery, projects, and /jobs/remap-segment cleanly', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', createSyncEngineV1Router());

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api/v1`;

  try {
    const schemaRes = await fetch(`${base}/schemas/song-alignment`);
    assert.equal(schemaRes.status, 200);
    const schemaJson = await schemaRes.json();
    assert.equal(schemaJson.title, 'CanonicalSongAlignmentDocument');

    const mapSchemaRes = await fetch(`${base}/schemas/segment-mapping`);
    assert.equal(mapSchemaRes.status, 200);

    const jobSchemaRes = await fetch(`${base}/schemas/processing-job`);
    assert.equal(jobSchemaRes.status, 200);
    const jobSchemaJson = await jobSchemaRes.json();
    assert.equal(jobSchemaJson.title, 'ProcessingJob');
    assert.deepEqual(jobSchemaJson.required, ['jobId', 'songId', 'status', 'progress', 'currentStep']);

    const remapRes = await fetch(`${base}/jobs/remap-segment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mapping: SAMPLE_SEGMENT_MAPPING,
        audioDuration: 185.42,
        segment: {
          id: 'line_001',
          text: '我爱你',
          start: 8.4,
          end: 10.1,
          words: [],
        },
      }),
    });
    assert.equal(remapRes.status, 200);
    const remapJson = await remapRes.json();
    assert.equal(remapJson.success, true);
    assert.equal(remapJson.segment.start, 23.0);
    assert.equal(remapJson.segment.end, 24.7);

    const badRes = await fetch(`${base}/jobs/remap-segment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mapping: {
          analysis_segment_id: 'seg_bad',
          analysis_start: 10,
          analysis_end: 5,
          original_start: 0,
          original_end: 5,
        },
      }),
    });
    assert.equal(badRes.status, 422);

    const alignedSchemaRes = await fetch(`${base}/schemas/aligned-lyrics`);
    assert.equal(alignedSchemaRes.status, 200);
    const alignedSchema = await alignedSchemaRes.json();
    assert.equal(alignedSchema.title, 'AlignedLyricsDocument');

    const sampleAligned = {
      songId: 'song_love_test',
      duration: 185.42,
      language: 'en',
      version: 1,
      segments: [
        {
          id: 'seg_001',
          text: 'love',
          start: 32.1,
          end: 33.0,
          words: [
            {
              id: 'word_005',
              text: 'love',
              start: 32.417,
              end: 32.891,
              confidence: 0.98,
              alignmentConfidence: 0.95,
              reviewRequired: false,
              units: [
                { id: 'word_005_u01', text: 'lo', start: 32.417, end: 32.65, confidence: 0.96 },
                { id: 'word_005_u02', text: 've', start: 32.651, end: 32.891, confidence: 0.97 },
              ],
            },
          ],
        },
      ],
    };

    const importRes = await fetch(`${base}/lyrics/import-aligned`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sampleAligned),
    });
    assert.equal(importRes.status, 201);
    const importJson = await importRes.json();
    assert.equal(importJson.success, true);
    assert.equal(importJson.aligned.segments[0].words[0].id, 'word_005');
    assert.equal(importJson.aligned.segments[0].words[0].start, 32.417);
    assert.equal(importJson.aligned.segments[0].words[0].end, 32.891);

    const docId = importJson.document.documentId;
    const getAlignedRes = await fetch(`${base}/lyrics/${docId}/aligned`);
    assert.equal(getAlignedRes.status, 200);
    const gotAligned = await getAlignedRes.json();
    assert.equal(gotAligned.songId, 'song_love_test');

    const putAlignedRes = await fetch(`${base}/lyrics/${docId}/aligned`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...sampleAligned,
        segments: [
          {
            ...sampleAligned.segments[0],
            words: [
              {
                ...sampleAligned.segments[0].words[0],
                reviewRequired: true,
              },
            ],
          },
        ],
      }),
    });
    assert.equal(putAlignedRes.status, 200);
    const putAlignedJson = await putAlignedRes.json();
    assert.equal(putAlignedJson.aligned.version, 2);
    assert.equal(putAlignedJson.aligned.segments[0].words[0].reviewRequired, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('AlignedLyricsDocument validates word_005 (love: 32.417-32.891), units, alignmentConfidence, and round-trips cleanly', () => {
  const aligned = {
    songId: 'song_001',
    duration: 185.42,
    language: 'en',
    version: 1,
    segments: [
      {
        id: 'seg_001',
        text: 'love',
        start: 32.4,
        end: 32.95,
        words: [
          {
            id: 'word_005',
            text: 'love',
            start: 32.417,
            end: 32.891,
            confidence: 0.98,
            alignmentConfidence: 0.71,
            reviewRequired: true,
            units: [
              { id: 'word_005_u01', text: 'lo', start: 32.417, end: 32.65, confidence: 0.95 },
              { id: 'word_005_u02', text: 've', start: 32.651, end: 32.891, confidence: 0.96 },
            ],
          },
        ],
      },
    ],
  };

  const validation = validateAlignedLyricsDocument(aligned);
  assert.equal(validation.valid, true);
  assert.equal(validation.reviewRequiredCount, 1);
  assert.equal(validation.unitCount, 2);

  const normalized = fromAlignedLyricsDocument(aligned);
  assert.equal(validateLyricsDocument(normalized).valid, true);
  assert.equal(normalized.segments[0].words[0].wordId, 'word_005');
  assert.equal(normalized.segments[0].words[0].startSeconds, 32.417);
  assert.equal(normalized.segments[0].words[0].endSeconds, 32.891);
  assert.equal(normalized.segments[0].words[0].reviewRequired, true);

  const back = toAlignedLyricsDocument(normalized);
  assert.equal(back.songId, 'song_001');
  assert.equal(back.version, 1);
  assert.equal(back.segments[0].words[0].start, 32.417);
  assert.equal(back.segments[0].words[0].end, 32.891);
  assert.equal(back.segments[0].words[0].alignmentConfidence, 0.71);
});

test('CanonicalProcessingJob validates exact job_001/song_001 contract and synchronizes transitionProcessingJob', () => {
  const sampleJob = {
    jobId: 'job_001',
    songId: 'song_001',
    status: 'aligning',
    progress: 72,
    currentStep: 'Aligning word boundaries',
  };
  assert.deepEqual(validateCanonicalProcessingJob(sampleJob), []);

  let job = {
    jobId: 'job_001',
    audioId: 'song_001',
    songId: 'song_001',
    documentId: 'lyr_001',
    state: 'queued',
    status: 'queued',
    progressPercent: 0,
    progress: 0,
    currentStep: 'Queued for processing',
    languageHint: 'zh',
    enableVocalSeparation: true,
    phaseMode: 'phase_1_architecture_foundation',
    transitions: [],
    error: null,
    createdAt: '2026-11-28T00:00:00.000Z',
    updatedAt: '2026-11-28T00:00:00.000Z',
  };
  job = transitionProcessingJob(job, 'validating');
  job = transitionProcessingJob(job, 'analyzing');
  job = transitionProcessingJob(job, 'separating_vocals');
  job = transitionProcessingJob(job, 'transcribing');
  job = transitionProcessingJob(job, 'aligning', 'Aligning word boundaries');

  assert.equal(job.status, 'aligning');
  assert.equal(job.currentStep, 'Aligning word boundaries');
  const canonical = toCanonicalProcessingJob(job);
  assert.equal(canonical.jobId, 'job_001');
  assert.equal(canonical.songId, 'song_001');
  assert.equal(canonical.status, 'aligning');
  assert.equal(canonical.currentStep, 'Aligning word boundaries');
  assert.equal(canonical.error, undefined);
  assert.deepEqual(validateCanonicalProcessingJob(canonical), []);
});
