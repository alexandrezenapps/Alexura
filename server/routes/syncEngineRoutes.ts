/**
 * Express /api/v1 Phase 1 REST Router mirroring the Python FastAPI contract.
 * Keeps Port 3000 live preview functional immediately while maintaining exact schema parity
 * with `backend/app/api/routes.py` (`LyricsDocument`, `LyricSegment`, `LyricWord`, `LyricUnit`, `ProcessingJob`).
 */

import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  transitionProcessingJob,
  validateLyricsDocument,
  type AdapterReportMap,
  type AudioAssetRecord,
  type LyricSegment,
  type LyricUnit,
  type LyricWord,
  type LyricsDocument,
  type ProcessingJob,
} from '../../frontend/src/types/lyrics.ts';

const DATA_ROOT = path.resolve(
  process.env.ALEXURA_DATA_DIR || path.join(process.cwd(), '.alexura_data', 'phase1'),
);
const AUDIO_DIR = path.join(DATA_ROOT, 'audio');
const JOBS_DIR = path.join(DATA_ROOT, 'jobs');
const LYRICS_DIR = path.join(DATA_ROOT, 'lyrics');
const ALLOWED_EXTS = new Set(['.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.webm']);
const MAX_UPLOAD_BYTES = Math.max(10, Number(process.env.MAX_UPLOAD_MB || 100)) * 1024 * 1024;

function ensureDirs(): void {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  fs.mkdirSync(JOBS_DIR, { recursive: true });
  fs.mkdirSync(LYRICS_DIR, { recursive: true });
}

function safeChild(dir: string, filename: string): string {
  const clean = path.basename(filename);
  const resolved = path.resolve(dir, clean);
  if (!resolved.startsWith(path.resolve(dir) + path.sep)) {
    throw new Error('invalid_storage_path');
  }
  return resolved;
}

function hasValidAudioMagic(head: Buffer, ext: string): boolean {
  if (head.length < 4) return false;
  if (head.subarray(0, 4).equals(Buffer.from('RIFF')) && head.length >= 12 && head.subarray(8, 12).equals(Buffer.from('WAVE'))) {
    return true;
  }
  if (head.subarray(0, 3).equals(Buffer.from('ID3')) || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) {
    return true;
  }
  if (head.subarray(0, 4).equals(Buffer.from('fLaC')) || head.subarray(0, 4).equals(Buffer.from('OggS'))) {
    return true;
  }
  if (head.length >= 8 && head.subarray(4, 8).equals(Buffer.from('ftyp'))) {
    return true;
  }
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3 && ext === '.webm') {
    return true;
  }
  return false;
}

function parseMultipartSingleFile(body: Buffer, contentType: string): {
  filename: string;
  mimeType: string;
  fileBuffer: Buffer;
} | null {
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  if (!m) return null;
  const boundary = m[1] || m[2];
  const delim = Buffer.from(`--${boundary}`);
  const firstIdx = body.indexOf(delim);
  if (firstIdx === -1) return null;

  let cursor = firstIdx + delim.length;
  while (cursor < body.length) {
    if (body.subarray(cursor, cursor + 2).equals(Buffer.from('--'))) break;
    if (body.subarray(cursor, cursor + 2).equals(Buffer.from('\r\n'))) cursor += 2;
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), cursor);
    if (headerEnd === -1) break;
    const headersText = body.subarray(cursor, headerEnd).toString('utf8');
    const dataStart = headerEnd + 4;
    const nextBoundary = body.indexOf(delim, dataStart);
    if (nextBoundary === -1) break;
    const dataEnd = nextBoundary - 2; // strip trailing CRLF before boundary
    const dispMatch = /filename="([^"]*)"/i.exec(headersText);
    if (dispMatch) {
      const ctMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headersText);
      return {
        filename: dispMatch[1] || 'audio.wav',
        mimeType: (ctMatch?.[1] || 'application/octet-stream').trim(),
        fileBuffer: body.subarray(dataStart, Math.max(dataStart, dataEnd)),
      };
    }
    cursor = nextBoundary + delim.length;
  }
  return null;
}

function buildPhase1AdaptersReport(): AdapterReportMap {
  const geminiKey = String(process.env.GEMINI_API_KEY || '').trim();
  const geminiConfigured = Boolean(geminiKey && geminiKey !== 'MY_GEMINI_API_KEY');
  return {
    vocalSeparation: {
      name: 'VocalSeparationAdapter',
      adapterClass: 'UnconfiguredVocalSeparationAdapter',
      implementation: 'phase1_interface_only',
      status: 'unconfigured_adapter',
      isImplementedForProduction: false,
      note: 'Phase 1 stub adapter. Original audio timeline preserved untouched; Demucs/MDX connects in Phase 2.',
      phaseTarget: 'Phase 2 (Demucs / MDX-Net)',
    },
    singingAsr: {
      name: 'SingingASRAdapter',
      adapterClass: 'UnconfiguredSingingASRAdapter',
      implementation: 'phase1_interface_only',
      status: 'unconfigured_adapter',
      isImplementedForProduction: false,
      note: 'Phase 1 stub adapter. Does not fabricate lyrics recognition; structured draft segments only.',
      phaseTarget: 'Phase 2 (Gemini Audio + Singing ASR)',
    },
    forcedAlignment: {
      name: 'ForcedAlignmentAdapter',
      adapterClass: 'UnconfiguredForcedAlignmentAdapter',
      implementation: 'phase1_interface_only',
      status: 'unconfigured_adapter',
      isImplementedForProduction: false,
      note: 'Phase 1 stub adapter. Tokenizes LyricWord & LyricUnit with strictly null timestamps (zero fake timings).',
      phaseTarget: 'Phase 2 (CTC Forced Alignment)',
    },
    lyricsValidation: {
      name: 'LyricsValidationService',
      adapterClass: 'LyricsValidationService',
      implementation: 'schema_and_timestamp_validator',
      status: 'ready',
      isImplementedForProduction: true,
      note: 'Active normalized schema, monotonic timestamp, and second-based invariant validator.',
      phaseTarget: 'Phase 1 + Phase 2',
    },
    secretsProtected: true,
    geminiServerConfigured: geminiConfigured,
  };
}

function tokenizeUnalignedSegment(
  segmentId: string,
  text: string,
  speaker: string | null,
): LyricWord[] {
  const matches =
    text.match(/[A-Za-zÀ-ÿ0-9'’\-]+|[\u4e00-\u9fff]|[\u3040-\u30ff]|[\uac00-\ud7af]/g) || [];
  return matches.map((tok, wIdx) => {
    const units: LyricUnit[] = Array.from(tok).map((ch, uIdx) => ({
      unitId: `${segmentId}_w${String(wIdx).padStart(3, '0')}_u${String(uIdx).padStart(2, '0')}`,
      text: ch,
      unitType: 'character',
      startSeconds: null,
      endSeconds: null,
      confidence: null,
      alignmentState: 'unaligned',
    }));
    return {
      wordId: `${segmentId}_w${String(wIdx).padStart(3, '0')}`,
      text: tok,
      startSeconds: null,
      endSeconds: null,
      confidence: null,
      alignmentState: 'unaligned',
      speaker,
      flags: ['unaligned_phase1'],
      units,
    };
  });
}

function runPhase1BackgroundPipeline(
  jobId: string,
  params: {
    audioId: string;
    title?: string;
    artist?: string;
    languageHint: string;
    draftLyricsText?: string;
    enableVocalSeparation: boolean;
  },
): void {
  const saveJob = (job: ProcessingJob) => {
    fs.writeFileSync(safeChild(JOBS_DIR, `${job.jobId}.json`), JSON.stringify(job, null, 2));
  };

  setTimeout(() => {
    try {
      const jobPath = safeChild(JOBS_DIR, `${jobId}.json`);
      let job = JSON.parse(fs.readFileSync(jobPath, 'utf8')) as ProcessingJob;

      job = transitionProcessingJob(job, 'validating', 'Validating uploaded audio asset.');
      saveJob(job);

      const audioMetaPath = safeChild(AUDIO_DIR, `${params.audioId}.json`);
      if (!fs.existsSync(audioMetaPath)) {
        job = transitionProcessingJob(job, 'failed', 'Original audio missing.', 'audio_not_found');
        saveJob(job);
        return;
      }
      const audio = JSON.parse(fs.readFileSync(audioMetaPath, 'utf8')) as AudioAssetRecord & {
        storagePath: string;
      };

      job = transitionProcessingJob(job, 'analyzing', 'Phase 1 metadata & timeline preservation.');
      saveJob(job);

      if (params.enableVocalSeparation) {
        job = transitionProcessingJob(
          job,
          'separating_vocals',
          'Invoking VocalSeparationAdapter (Phase 1 stub).',
        );
        saveJob(job);
      }

      job = transitionProcessingJob(
        job,
        'transcribing',
        'Invoking SingingASRAdapter (Phase 1 stub — no fake recognition).',
      );
      saveJob(job);

      const lines = (params.draftLyricsText || '')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);

      const rawSegments: LyricSegment[] =
        lines.length > 0
          ? lines.map((line, idx) => ({
              segmentId: `seg_${String(idx).padStart(3, '0')}`,
              index: idx,
              text: line,
              startSeconds: null,
              endSeconds: null,
              language: params.languageHint === 'auto' ? null : params.languageHint,
              sectionType: 'verse',
              vocalType: 'lead',
              speaker: 'Lead',
              confidence: null,
              alignmentState: 'unaligned',
              isPlaceholder: false,
              words: [],
            }))
          : [
              {
                segmentId: 'seg_000',
                index: 0,
                text: '[Phase 1 Placeholder — Connect SingingASRAdapter in Phase 2 or enter lyrics manually]',
                startSeconds: null,
                endSeconds: null,
                language: params.languageHint === 'auto' ? null : params.languageHint,
                sectionType: 'other',
                vocalType: 'lead',
                speaker: 'Lead',
                confidence: null,
                alignmentState: 'unaligned',
                isPlaceholder: true,
                words: [],
              },
            ];

      job = transitionProcessingJob(
        job,
        'aligning',
        'Invoking ForcedAlignmentAdapter (Phase 1 tokenization — null timestamps).',
      );
      saveJob(job);

      const structuredSegments = rawSegments.map((seg) => ({
        ...seg,
        words: seg.isPlaceholder
          ? []
          : tokenizeUnalignedSegment(seg.segmentId, seg.text, seg.speaker || 'Lead'),
      }));

      job = transitionProcessingJob(
        job,
        'validating_alignment',
        'Validating normalized LyricsDocument schema.',
      );
      saveJob(job);

      const now = new Date().toISOString();
      const doc: LyricsDocument = {
        schemaVersion: '1.0.0',
        documentId: job.documentId || `lyr_${crypto.randomBytes(7).toString('hex')}`,
        audioId: audio.audioId,
        jobId: job.jobId,
        title: (params.title || path.parse(audio.filename).name).slice(0, 240),
        artist: (params.artist || '').slice(0, 240),
        primaryLanguage: params.languageHint || 'auto',
        detectedLanguages: params.languageHint === 'auto' ? [] : [params.languageHint],
        durationSeconds: audio.durationSeconds || 0,
        timelineOriginSeconds: 0,
        preservesOriginalAudio: true,
        alignmentStatus: lines.length > 0 ? 'unaligned' : 'phase1_placeholder',
        source: lines.length > 0 ? 'manual_editor' : 'phase1_stub',
        metadata: {
          phase: 'phase_1_foundation',
          adapters: buildPhase1AdaptersReport(),
        },
        segments: structuredSegments,
        createdAt: now,
        updatedAt: now,
      };

      const report = validateLyricsDocument(doc);
      if (!report.valid) {
        job = transitionProcessingJob(
          job,
          'failed',
          'Normalized schema validation failed.',
          report.issues[0]?.message || 'schema_validation_failed',
        );
        saveJob(job);
        return;
      }

      fs.writeFileSync(
        safeChild(LYRICS_DIR, `${doc.documentId}.json`),
        JSON.stringify(doc, null, 2),
      );

      job = transitionProcessingJob(
        job,
        'completed',
        'Phase 1 pipeline completed cleanly without simulated timestamps.',
      );
      saveJob(job);
    } catch (err: any) {
      try {
        const jobPath = safeChild(JOBS_DIR, `${jobId}.json`);
        const cur = JSON.parse(fs.readFileSync(jobPath, 'utf8')) as ProcessingJob;
        if (cur.state !== 'completed' && cur.state !== 'failed') {
          const failed = transitionProcessingJob(
            cur,
            'failed',
            'Pipeline error',
            err?.message || 'pipeline_error',
          );
          saveJob(failed);
        }
      } catch {
        // ignore
      }
    }
  }, 40);
}

export function createSyncEngineV1Router(): express.Router {
  ensureDirs();
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'Alexura AI Lyrics Sync Engine',
      phase: 'phase_1_foundation',
      adapters: buildPhase1AdaptersReport(),
    });
  });

  router.get('/adapters', (_req, res) => {
    res.json({
      success: true,
      adapters: buildPhase1AdaptersReport(),
    });
  });

  router.get('/schemas/lyrics', (_req, res) => {
    const schemaPath = path.resolve(process.cwd(), 'schemas', 'lyrics.schema.json');
    if (!fs.existsSync(schemaPath)) {
      return res.status(404).json({ success: false, error: 'schema_not_found' });
    }
    res.type('application/json').send(fs.readFileSync(schemaPath, 'utf8'));
  });

  router.post(
    '/audio/upload',
    express.raw({ type: '*/*', limit: '105mb' }),
    (req, res) => {
      try {
        ensureDirs();
        const ct = String(req.headers['content-type'] || '');
        const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

        let filename = 'audio.wav';
        let mimeType = 'application/octet-stream';
        let fileBuf = body;

        if (ct.includes('multipart/form-data')) {
          const parsed = parseMultipartSingleFile(body, ct);
          if (!parsed) {
            return res.status(400).json({ success: false, detail: 'invalid_multipart_payload' });
          }
          filename = parsed.filename;
          mimeType = parsed.mimeType;
          fileBuf = parsed.fileBuffer;
        } else if (req.headers['x-file-name']) {
          filename = decodeURIComponent(String(req.headers['x-file-name']));
          mimeType = ct || mimeType;
        }

        const safeName = path.basename(filename).slice(0, 200);
        const ext = path.extname(safeName).toLowerCase();
        if (!ALLOWED_EXTS.has(ext)) {
          return res.status(400).json({ success: false, detail: 'unsupported_audio_extension' });
        }
        if (!fileBuf.length || fileBuf.length > MAX_UPLOAD_BYTES) {
          return res.status(400).json({ success: false, detail: 'invalid_audio_size' });
        }
        if (!hasValidAudioMagic(fileBuf.subarray(0, 16), ext)) {
          return res.status(400).json({ success: false, detail: 'invalid_audio_magic_header' });
        }

        const audioId = `aud_${crypto.randomBytes(8).toString('hex')}`;
        const storagePath = safeChild(AUDIO_DIR, `${audioId}${ext}`);
        fs.writeFileSync(storagePath, fileBuf);

        const asset: AudioAssetRecord & { storagePath: string } = {
          audioId,
          filename: safeName,
          mimeType,
          byteSize: fileBuf.length,
          sha256: crypto.createHash('sha256').update(fileBuf).digest('hex'),
          durationSeconds: 0,
          sampleRateHz: 0,
          channels: 0,
          storagePath,
          audioUrl: `/api/v1/audio/${audioId}/stream`,
          createdAt: new Date().toISOString(),
        };

        fs.writeFileSync(
          safeChild(AUDIO_DIR, `${audioId}.json`),
          JSON.stringify(asset, null, 2),
        );

        const { storagePath: _hidden, ...publicAsset } = asset;
        return res.status(201).json({ success: true, audio: publicAsset });
      } catch (err: any) {
        return res.status(500).json({ success: false, detail: err?.message || 'upload_error' });
      }
    },
  );

  router.get('/audio/:audioId', (req, res) => {
    try {
      const metaPath = safeChild(AUDIO_DIR, `${req.params.audioId}.json`);
      if (!fs.existsSync(metaPath)) {
        return res.status(404).json({ success: false, detail: 'audio_not_found' });
      }
      const { storagePath: _hidden, ...publicAsset } = JSON.parse(
        fs.readFileSync(metaPath, 'utf8'),
      );
      return res.json({ success: true, audio: publicAsset });
    } catch {
      return res.status(404).json({ success: false, detail: 'audio_not_found' });
    }
  });

  router.get('/audio/:audioId/stream', (req, res) => {
    try {
      const metaPath = safeChild(AUDIO_DIR, `${req.params.audioId}.json`);
      if (!fs.existsSync(metaPath)) {
        return res.status(404).json({ success: false, detail: 'audio_not_found' });
      }
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const audioPath = path.resolve(String(meta.storagePath || ''));
      if (!audioPath.startsWith(path.resolve(AUDIO_DIR) + path.sep) || !fs.existsSync(audioPath)) {
        return res.status(404).json({ success: false, detail: 'audio_file_missing' });
      }
      const stat = fs.statSync(audioPath);
      const total = stat.size;
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', meta.mimeType || 'audio/mpeg');
      const range = req.headers.range;
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
        fs.createReadStream(audioPath, { start, end }).pipe(res);
      } else {
        res.setHeader('Content-Length', String(total));
        fs.createReadStream(audioPath).pipe(res);
      }
    } catch {
      return res.status(500).json({ success: false, detail: 'stream_error' });
    }
  });

  router.post('/jobs/analyze', (req, res) => {
    try {
      ensureDirs();
      const { audioId, title, artist, languageHint, draftLyricsText, enableVocalSeparation } =
        req.body || {};
      if (!audioId || typeof audioId !== 'string') {
        return res.status(400).json({ success: false, detail: 'missing_audio_id' });
      }
      const metaPath = safeChild(AUDIO_DIR, `${audioId}.json`);
      if (!fs.existsSync(metaPath)) {
        return res.status(404).json({ success: false, detail: 'audio_not_found' });
      }

      const now = new Date().toISOString();
      const job: ProcessingJob = {
        jobId: `job_${crypto.randomBytes(7).toString('hex')}`,
        audioId,
        documentId: `lyr_${crypto.randomBytes(7).toString('hex')}`,
        state: 'queued',
        progressPercent: 0,
        languageHint: String(languageHint || 'auto').slice(0, 32),
        enableVocalSeparation: enableVocalSeparation !== false,
        phaseMode: 'phase_1_architecture_foundation',
        adapterReport: buildPhase1AdaptersReport(),
        transitions: [],
        error: null,
        createdAt: now,
        updatedAt: now,
      };
      fs.writeFileSync(safeChild(JOBS_DIR, `${job.jobId}.json`), JSON.stringify(job, null, 2));

      runPhase1BackgroundPipeline(job.jobId, {
        audioId,
        title: title ? String(title) : undefined,
        artist: artist ? String(artist) : undefined,
        languageHint: job.languageHint,
        draftLyricsText: typeof draftLyricsText === 'string' ? draftLyricsText : undefined,
        enableVocalSeparation: job.enableVocalSeparation,
      });

      return res.status(202).json({ success: true, job });
    } catch (err: any) {
      return res.status(500).json({ success: false, detail: err?.message || 'job_create_failed' });
    }
  });

  router.get('/jobs', (_req, res) => {
    ensureDirs();
    const files = fs
      .readdirSync(JOBS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => path.join(JOBS_DIR, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      .slice(0, 25);
    const jobs = files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
    res.json({ success: true, jobs });
  });

  router.get('/jobs/:jobId', (req, res) => {
    try {
      const p = safeChild(JOBS_DIR, `${req.params.jobId}.json`);
      if (!fs.existsSync(p)) {
        return res.status(404).json({ success: false, detail: 'job_not_found' });
      }
      return res.json({ success: true, job: JSON.parse(fs.readFileSync(p, 'utf8')) });
    } catch {
      return res.status(404).json({ success: false, detail: 'job_not_found' });
    }
  });

  router.get('/lyrics', (_req, res) => {
    ensureDirs();
    const files = fs
      .readdirSync(LYRICS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => path.join(LYRICS_DIR, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      .slice(0, 25);
    const documents = files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
    res.json({ success: true, documents });
  });

  router.get('/lyrics/:documentId', (req, res) => {
    try {
      const p = safeChild(LYRICS_DIR, `${req.params.documentId}.json`);
      if (!fs.existsSync(p)) {
        return res.status(404).json({ success: false, detail: 'lyrics_document_not_found' });
      }
      return res.json({ success: true, document: JSON.parse(fs.readFileSync(p, 'utf8')) });
    } catch {
      return res.status(404).json({ success: false, detail: 'lyrics_document_not_found' });
    }
  });

  router.put('/lyrics/:documentId', (req, res) => {
    try {
      const p = safeChild(LYRICS_DIR, `${req.params.documentId}.json`);
      if (!fs.existsSync(p)) {
        return res.status(404).json({ success: false, detail: 'lyrics_document_not_found' });
      }
      const existing = JSON.parse(fs.readFileSync(p, 'utf8')) as LyricsDocument;
      const body = req.body || {};
      if (!Array.isArray(body.segments)) {
        return res.status(422).json({ success: false, detail: 'segments must be an array' });
      }

      const updated: LyricsDocument = {
        ...existing,
        title: typeof body.title === 'string' ? body.title.slice(0, 240) : existing.title,
        artist: typeof body.artist === 'string' ? body.artist.slice(0, 240) : existing.artist,
        primaryLanguage:
          typeof body.primaryLanguage === 'string'
            ? body.primaryLanguage.slice(0, 32)
            : existing.primaryLanguage,
        alignmentStatus:
          typeof body.alignmentStatus === 'string' ? body.alignmentStatus : 'partial_manual',
        source: 'manual_editor',
        segments: body.segments,
        updatedAt: new Date().toISOString(),
      };

      const validation = validateLyricsDocument(updated);
      if (!validation.valid) {
        return res.status(422).json({
          success: false,
          detail: `${validation.issues[0].path}: ${validation.issues[0].message}`,
          issues: validation.issues,
        });
      }

      fs.writeFileSync(p, JSON.stringify(updated, null, 2));
      return res.json({ success: true, document: updated });
    } catch (err: any) {
      return res.status(500).json({ success: false, detail: err?.message || 'lyrics_update_failed' });
    }
  });

  return router;
}
