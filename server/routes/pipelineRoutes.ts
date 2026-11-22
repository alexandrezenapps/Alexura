import express from 'express';
import fs from 'node:fs';
import {
  appendUploadChunk,
  finalizeChunkedUploadSession,
  getSafeUploadAudioPath,
  initChunkedUploadSession,
  MAX_UPLOAD_BYTES,
  RECOMMENDED_CHUNK_BYTES,
  saveValidatedStreamUpload,
  saveValidatedUpload,
  startTempCleanupScheduler,
} from '../storage/fileStore.ts';
import { timestampStore } from '../db/timestampStore.ts';
import {
  enqueuePipelineJob,
  getPipelineCapabilities,
  jobEvents,
  listRecentJobs,
  retryPipelineJob,
} from '../jobs/jobQueue.ts';
import { AcousticConfidenceValidator } from '../providers/pythonDspProvider.ts';

const validator = new AcousticConfidenceValidator();

function decodeHeaderFilename(rawHeader: unknown, fallback = 'audio.wav'): string {
  const raw = String(rawHeader || fallback);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function createPipelineRouter(): express.Router {
  const router = express.Router();
  startTempCleanupScheduler();

  // Discover real server-side & external adapter capabilities honestly
  router.get('/capabilities', async (_req, res) => {
    try {
      const capabilities = await getPipelineCapabilities();
      res.json({ success: true, capabilities });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'capabilities_error' });
    }
  });

  // Chunked/Resumable large-file upload endpoints (up to 250 MB)
  router.post('/uploads/init', async (req, res) => {
    try {
      const { filename, mimeType, expectedBytes } = req.body || {};
      const session = await initChunkedUploadSession({
        filename: String(filename || 'track.wav'),
        mimeType: mimeType ? String(mimeType) : undefined,
        expectedBytes: expectedBytes !== undefined ? Number(expectedBytes) : 0,
      });
      res.status(201).json({
        success: true,
        session,
        maxUploadBytes: MAX_UPLOAD_BYTES,
        recommendedChunkBytes: RECOMMENDED_CHUNK_BYTES,
      });
    } catch (err: any) {
      const msg = String(err?.message || 'upload_init_failed');
      const status = msg.startsWith('invalid_') || msg.startsWith('unsupported_') ? 400 : 500;
      res.status(status).json({ success: false, error: msg });
    }
  });

  router.put(
    '/uploads/:sessionId/chunk',
    express.raw({
      type: '*/*',
      limit: '16mb',
    }),
    async (req, res) => {
      try {
        const rawBuf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        const chunkIndexHeader = req.headers['x-chunk-index'];
        const chunkIndex =
          chunkIndexHeader !== undefined ? Number(chunkIndexHeader) : undefined;
        const result = await appendUploadChunk(req.params.sessionId, rawBuf, chunkIndex);
        res.json({ success: true, ...result });
      } catch (err: any) {
        const msg = String(err?.message || 'chunk_upload_failed');
        const status =
          msg === 'upload_session_not_found'
            ? 404
            : msg.startsWith('invalid_') || msg === 'empty_chunk'
              ? 400
              : 500;
        res.status(status).json({ success: false, error: msg });
      }
    },
  );

  router.post('/uploads/:sessionId/complete', async (req, res) => {
    try {
      const upload = await finalizeChunkedUploadSession(req.params.sessionId);
      res.status(201).json({
        success: true,
        upload,
        deduplicated: Boolean(upload.deduplicated),
      });
    } catch (err: any) {
      const msg = String(err?.message || 'upload_finalize_failed');
      const status =
        msg === 'upload_session_not_found'
          ? 404
          : msg.startsWith('invalid_') || msg.startsWith('unsupported_')
            ? 400
            : 500;
      res.status(status).json({ success: false, error: msg });
    }
  });

  // Streaming upload directly to disk without buffering large tracks into Node RAM
  router.post('/uploads/stream', async (req, res) => {
    try {
      const decodedName = decodeHeaderFilename(req.headers['x-file-name'], 'audio.wav');
      const upload = await saveValidatedStreamUpload({
        stream: req,
        originalFilename: decodedName,
        declaredMime: String(req.headers['content-type'] || ''),
      });
      res.status(201).json({
        success: true,
        upload,
        deduplicated: Boolean(upload.deduplicated),
      });
    } catch (err: any) {
      const msg = String(err?.message || 'stream_upload_failed');
      const status = msg.startsWith('invalid_') || msg.startsWith('unsupported_') ? 400 : 500;
      res.status(status).json({ success: false, error: msg });
    }
  });

  // Direct raw binary upload convenience for small/medium tracks (`<= 35 MB`)
  router.post(
    '/uploads/raw',
    express.raw({
      type: ['application/octet-stream', 'audio/*'],
      limit: '36mb',
    }),
    async (req, res) => {
      try {
        const rawBuf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        const decodedName = decodeHeaderFilename(req.headers['x-file-name'], 'audio.wav');
        const upload = await saveValidatedUpload({
          buffer: rawBuf,
          originalFilename: decodedName,
          declaredMime: String(req.headers['content-type'] || ''),
        });
        res.status(201).json({
          success: true,
          upload,
          deduplicated: Boolean(upload.deduplicated),
        });
      } catch (err: any) {
        const msg = String(err?.message || 'upload_failed');
        const status = msg.startsWith('invalid_') || msg.startsWith('unsupported_') ? 400 : 500;
        res.status(status).json({ success: false, error: msg });
      }
    },
  );

  // Secure base64 JSON upload convenience endpoint
  router.post('/uploads', async (req, res) => {
    try {
      const { filename, mimeType, audioBase64 } = req.body || {};
      if (!audioBase64 || typeof audioBase64 !== 'string') {
        return res.status(400).json({ success: false, error: 'missing_audio_payload' });
      }
      const cleanB64 = audioBase64.includes(',') ? audioBase64.split(',').pop() || '' : audioBase64;
      const buf = Buffer.from(cleanB64, 'base64');
      const upload = await saveValidatedUpload({
        buffer: buf,
        originalFilename: String(filename || 'track.wav'),
        declaredMime: String(mimeType || ''),
      });
      res.status(201).json({
        success: true,
        upload,
        deduplicated: Boolean(upload.deduplicated),
      });
    } catch (err: any) {
      const msg = String(err?.message || 'upload_failed');
      const status = msg.startsWith('invalid_') || msg.startsWith('unsupported_') ? 400 : 500;
      res.status(status).json({ success: false, error: msg });
    }
  });

  router.get('/uploads/:uploadId', async (req, res) => {
    try {
      const hit = await getSafeUploadAudioPath(req.params.uploadId);
      if (!hit) return res.status(404).json({ success: false, error: 'upload_not_found' });
      res.json({ success: true, upload: hit.record });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'upload_lookup_failed' });
    }
  });

  // HTTP Range-capable streaming of the UNTOUCHED original uploaded audio
  router.get('/uploads/:uploadId/audio', async (req, res) => {
    try {
      const hit = await getSafeUploadAudioPath(req.params.uploadId);
      if (!hit) return res.status(404).json({ success: false, error: 'upload_not_found' });
      const stat = fs.statSync(hit.filePath);
      const total = stat.size;
      const range = req.headers.range;
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', hit.record.mimeType || 'audio/mpeg');
      if (range && range.startsWith('bytes=')) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = Math.max(0, parseInt(parts[0], 10) || 0);
        const end = parts[1] ? Math.min(total - 1, parseInt(parts[1], 10)) : total - 1;
        if (start >= total || end < start) {
          res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
          return;
        }
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
        res.setHeader('Content-Length', String(end - start + 1));
        fs.createReadStream(hit.filePath, { start, end }).pipe(res);
      } else {
        res.setHeader('Content-Length', String(total));
        fs.createReadStream(hit.filePath).pipe(res);
      }
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'audio_stream_error' });
    }
  });

  // Enqueue asynchronous pipeline job
  router.post('/jobs', async (req, res) => {
    try {
      const {
        uploadId,
        songId,
        title,
        artist,
        lang,
        lyricsText,
        enableSeparation,
        useGeminiAsr,
        bypassCache,
      } = req.body || {};
      if (!uploadId || typeof uploadId !== 'string') {
        return res.status(400).json({ success: false, error: 'missing_upload_id' });
      }
      const job = await enqueuePipelineJob({
        uploadId,
        songId: songId ? String(songId) : undefined,
        title: title ? String(title) : undefined,
        artist: artist ? String(artist) : undefined,
        lang: lang ? String(lang) : 'auto',
        lyricsText: typeof lyricsText === 'string' ? lyricsText : undefined,
        enableSeparation: enableSeparation !== false,
        useGeminiAsr: useGeminiAsr !== false,
        bypassCache: Boolean(bypassCache),
      });
      res.status(202).json({ success: true, job });
    } catch (err: any) {
      const msg = String(err?.message || 'job_create_failed');
      res.status(msg === 'upload_not_found' ? 404 : 500).json({ success: false, error: msg });
    }
  });

  // List recent jobs for background status tracking
  router.get('/jobs', async (_req, res) => {
    try {
      const jobs = await listRecentJobs(25);
      res.json({ success: true, jobs });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'jobs_list_failed' });
    }
  });

  // Global real-time SSE stream for all background job updates (MUST sit before /jobs/:jobId)
  router.get('/jobs/events', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const snapshot = await listRecentJobs(12).catch(() => []);
    for (const j of snapshot.slice(0, 5)) {
      res.write(`data: ${JSON.stringify(j)}\n\n`);
    }

    const onGlobalUpdate = (payload: any) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 15000);

    const cleanup = () => {
      clearInterval(heartbeat);
      jobEvents.off('global', onGlobalUpdate);
    };

    jobEvents.on('global', onGlobalUpdate);
    req.on('close', cleanup);
  });

  router.get('/jobs/:jobId', async (req, res) => {
    try {
      const job = await timestampStore.getJob(req.params.jobId);
      if (!job) return res.status(404).json({ success: false, error: 'job_not_found' });
      res.json({ success: true, job });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'job_lookup_failed' });
    }
  });

  // Manual retry endpoint preserving original uploaded audio
  router.post('/jobs/:jobId/retry', async (req, res) => {
    try {
      const job = await retryPipelineJob(req.params.jobId);
      res.status(202).json({ success: true, job });
    } catch (err: any) {
      const msg = String(err?.message || 'job_retry_failed');
      const status = msg === 'job_not_found' || msg === 'upload_not_found' ? 404 : 500;
      res.status(status).json({ success: false, error: msg });
    }
  });

  // Real-time Server-Sent Events (SSE) stream for a specific job
  router.get('/jobs/:jobId/events', async (req, res) => {
    const jobId = req.params.jobId;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const current = await timestampStore.getJob(jobId).catch(() => null);
    if (current) {
      res.write(`data: ${JSON.stringify(current)}\n\n`);
      if (current.status === 'completed' || current.status === 'failed') {
        res.end();
        return;
      }
    }

    const onUpdate = (payload: any) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
      if (payload.status === 'completed' || payload.status === 'failed') {
        cleanup();
        res.end();
      }
    };
    const listenerName = `job:${jobId}`;
    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 15000);

    const cleanup = () => {
      clearInterval(heartbeat);
      jobEvents.off(listenerName, onUpdate);
    };

    jobEvents.on(listenerName, onUpdate);
    req.on('close', cleanup);
  });

  // Structured Timestamp Database endpoints
  router.get('/songs', async (_req, res) => {
    try {
      const songs = await timestampStore.listSongs(40);
      res.json({ success: true, songs });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'songs_list_failed' });
    }
  });

  router.get('/songs/:songId/timestamps', async (req, res) => {
    try {
      const song = await timestampStore.getSongTimestamps(req.params.songId);
      if (!song) return res.status(404).json({ success: false, error: 'song_not_found' });
      res.json({ success: true, song });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'song_lookup_failed' });
    }
  });

  router.put('/songs/:songId/timestamps', async (req, res) => {
    try {
      const body = req.body || {};
      const lines = Array.isArray(body.lines) ? body.lines : [];
      const validated = validator.validateAndSummarize(lines);
      const saved = await timestampStore.saveSongTimestamps({
        songId: req.params.songId,
        uploadId: body.uploadId || null,
        title: String(body.title || 'Sans titre').slice(0, 200),
        artist: String(body.artist || '').slice(0, 200),
        language: String(body.language || 'auto').slice(0, 32),
        detectedLanguages: Array.isArray(body.detectedLanguages) ? body.detectedLanguages : [],
        audioType: String(body.audioType || 'singing').slice(0, 32),
        durationSec: Number(body.durationSec || 0),
        bpm: Number(body.bpm || 0),
        provenance: body.provenance || { source: 'manual_or_studio_sync' },
        validationSummary: validated.summary,
        lines: validated.lines,
      });
      res.json({ success: true, song: saved });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'song_save_failed' });
    }
  });

  router.patch('/songs/:songId/words/:lineIndex/:wordIndex', async (req, res) => {
    try {
      const lineIndex = Number(req.params.lineIndex);
      const wordIndex = Number(req.params.wordIndex);
      const start = Number(req.body?.start);
      const end = Number(req.body?.end);
      if (
        !Number.isInteger(lineIndex) ||
        !Number.isInteger(wordIndex) ||
        !Number.isFinite(start) ||
        !Number.isFinite(end)
      ) {
        return res.status(400).json({ success: false, error: 'invalid_timestamp_params' });
      }
      const song = await timestampStore.updateWordTimestamp({
        songId: req.params.songId,
        lineIndex,
        wordIndex,
        start,
        end,
        provenance: 'human_verified',
      });
      res.json({ success: true, song });
    } catch (err: any) {
      const msg = String(err?.message || 'word_update_failed');
      res.status(msg === 'word_not_found' ? 404 : 500).json({ success: false, error: msg });
    }
  });

  return router;
}
