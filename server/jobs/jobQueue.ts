import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import type {
  PipelineCapabilities,
  PipelineJobRecord,
  SongTimestampRecord,
  SyncedLineRecord,
} from '../types/pipeline.ts';
import { timestampStore } from '../db/timestampStore.ts';
import {
  checkWorkerTools,
  createSecureTempDir,
  getSafeUploadAudioPath,
  MAX_UPLOAD_BYTES,
  RECOMMENDED_CHUNK_BYTES,
  removeTempPathSafe,
} from '../storage/fileStore.ts';
import { GeminiSingingAsrProvider } from '../providers/geminiProvider.ts';
import {
  AcousticConfidenceValidator,
  DspAcousticForcedAligner,
  DspCenterVocalSeparator,
} from '../providers/pythonDspProvider.ts';
import {
  ExternalForcedAlignmentAdapter,
  ExternalSingingAsrAdapter,
  ExternalVocalSeparationAdapter,
} from '../providers/externalAdapters.ts';

export const MAX_CONCURRENT_JOBS = 2;
const MAX_STAGE_RETRIES = 2;

export const jobEvents = new EventEmitter();
jobEvents.setMaxListeners(100);

const extSeparator = new ExternalVocalSeparationAdapter();
const extAsr = new ExternalSingingAsrAdapter();
const extAligner = new ExternalForcedAlignmentAdapter();
const dspSeparator = new DspCenterVocalSeparator();
const dspAligner = new DspAcousticForcedAligner();
const geminiAsr = new GeminiSingingAsrProvider();
const confidenceValidator = new AcousticConfidenceValidator();

interface QueuedJobTask {
  job: PipelineJobRecord;
  ctx: {
    audioPath: string;
    uploadDurationSec: number;
    uploadFilename: string;
    uploadSha256: string;
    songId?: string;
    title?: string;
    artist?: string;
    lang?: string;
    lyricsText?: string;
    enableSeparation?: boolean;
    useGeminiAsr?: boolean;
    bypassCache?: boolean;
  };
}

const pendingQueue: QueuedJobTask[] = [];
const activeJobIds = new Set<string>();

function drainQueue(): void {
  while (activeJobIds.size < MAX_CONCURRENT_JOBS && pendingQueue.length > 0) {
    const task = pendingQueue.shift();
    if (!task) continue;
    activeJobIds.add(task.job.id);
    setImmediate(() => {
      void processPipelineJob(task.job, task.ctx).finally(() => {
        activeJobIds.delete(task.job.id);
        drainQueue();
      });
    });
  }
}

export async function getPipelineCapabilities(): Promise<PipelineCapabilities> {
  const tools = await checkWorkerTools();
  const geminiConfigured = geminiAsr.isConfigured();
  const sepExt = extSeparator.isConfigured();
  const asrExt = extAsr.isConfigured();
  const alignExt = extAligner.isConfigured();

  return {
    runtime: 'node-express+python-worker',
    pythonAvailable: tools.pythonAvailable,
    ffmpegAvailable: tools.ffmpegAvailable,
    geminiConfigured,
    geminiAudioModel: 'gemini-3.5-transcribe',
    geminiReasoningModel: 'gemini-4-hydrogen',
    maxUploadBytes: MAX_UPLOAD_BYTES,
    recommendedChunkBytes: RECOMMENDED_CHUNK_BYTES,
    maxConcurrentJobs: MAX_CONCURRENT_JOBS,
    providers: {
      audioUnderstanding: {
        active: geminiConfigured
          ? 'google-genai:gemini-3.5-transcribe+gemini-4-hydrogen'
          : 'not_configured',
        status: geminiConfigured ? 'active' : 'not_configured',
        guaranteesExactWordForcedAlignment: false,
        note: 'Google Gemini handles multilingual audio understanding & draft transcription (chunked cleanly for long songs); exact singing word timestamps are delegated to specialized aligner adapters.',
      },
      vocalSeparation: {
        active: sepExt ? 'external_vocal_separator' : 'dsp_center_bandpass',
        status: sepExt ? 'active_external_neural' : 'active_dsp_fallback',
        externalConfigured: sepExt,
        isNeural: sepExt,
        note: sepExt
          ? 'External neural source-separation model endpoint connected via VOCAL_SEPARATION_ENDPOINT.'
          : 'Using streaming Python/ffmpeg Mid-Side bandpass DSP stem extraction into isolated temporary folders; attach VOCAL_SEPARATION_ENDPOINT for neural Demucs/RoFormer stems.',
      },
      singingAsr: {
        active: asrExt
          ? 'external_singing_asr'
          : geminiConfigured
            ? 'google-genai:gemini-3.5-transcribe'
            : 'not_configured',
        status: asrExt
          ? 'active_external_model'
          : geminiConfigured
            ? 'active_gemini_transcribe'
            : 'not_configured',
        externalConfigured: asrExt,
        note: asrExt
          ? 'External singing-aware ASR endpoint connected via SINGING_ASR_ENDPOINT.'
          : geminiConfigured
            ? 'Using Google Gemini (gemini-3.5-transcribe) with automatic retries and long-song window slicing; attach SINGING_ASR_ENDPOINT for specialized singing-ASR models.'
            : 'No GEMINI_API_KEY or SINGING_ASR_ENDPOINT configured; submit manual lyrics text to align acoustically.',
      },
      forcedAlignment: {
        active: alignExt ? 'external_forced_aligner' : 'dsp_acoustic_viterbi',
        status: alignExt ? 'active_external_aligner' : 'active_dsp_viterbi',
        externalConfigured: alignExt,
        isNeuralPhonemeAligner: alignExt,
        note: alignExt
          ? 'External phoneme/word forced aligner endpoint connected via FORCED_ALIGNMENT_ENDPOINT.'
          : 'Using constant-memory 100 Hz Python vocal-envelope & consonant-attack DP aligner (provenance: dsp_acoustic_viterbi); attach FORCED_ALIGNMENT_ENDPOINT for MFA/WhisperX.',
      },
    },
  };
}

function buildLinesFromManualLyrics(
  lyricsText: string,
  durationSec: number,
  lang: string,
): SyncedLineRecord[] {
  const cleanLines = lyricsText
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (cleanLines.length === 0) return [];
  const totalDur = Math.max(2, durationSec || cleanLines.length * 3.0);
  const step = totalDur / cleanLines.length;
  return cleanLines.map((text, idx) => {
    const start = +(idx * step).toFixed(3);
    const end = +((idx + 1) * step).toFixed(3);
    const toks =
      text.match(
        /[A-Za-zÀ-ÿ\u1e00-\u1eff0-9'’\-]+[,.;:!?…]?|[\u4e00-\u9fff\u3400-\u4dbf]|[\u3040-\u309f\u30a0-\u30ff][\u3041\u3043\u3045\u3047\u3049\u3063\u3083\u3085\u3087\u308e\u30a1\u30a3\u30a5\u30a7\u30a9\u30c3\u30e3\u30e5\u30e7\u30ee\u30fc]?|[\uac00-\ud7af]|[^\s]/g,
      ) || [text];
    const wStep = (end - start) / Math.max(1, toks.length);
    return {
      lineIndex: idx,
      text,
      start,
      end,
      section: 'verse',
      vocalType: /^\[(?:instrumental|interlude)/i.test(text) ? 'instrumental' : 'singing',
      language: lang || 'auto',
      speaker: 'Lead',
      recognitionConfidence: 0.94,
      alignmentConfidence: 0.55,
      flags: ['uncertain_boundary'],
      provenance: 'text_draft_estimate',
      words: toks.map((tk, wi) => ({
        wordIndex: wi,
        text: tk,
        start: +(start + wi * wStep).toFixed(3),
        end: +(start + (wi + 1) * wStep).toFixed(3),
        recognitionConfidence: 0.94,
        alignmentConfidence: 0.55,
        audioClarity: 0.72,
        vocalOverlap: 0.1,
        qualityTier: 'MEDIUM',
        speaker: 'Lead',
        flags: ['uncertain_boundary'],
        provenance: 'text_draft_estimate',
      })),
    };
  });
}

function isNonRetryableStageError(err: any): boolean {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('upload_not_found') ||
    msg.includes('no_lyrics_provided_and_no_asr_configured') ||
    msg.includes('gemini_api_key_not_configured') ||
    msg.includes('permission_denied') ||
    msg.includes('billing') ||
    msg.includes('invalid_audio') ||
    msg.includes('unsupported_audio') ||
    msg.includes('http_400') ||
    msg.includes('http_401') ||
    msg.includes('http_403') ||
    msg.includes('http_404')
  );
}

async function withStageRetry<T>(
  fn: () => Promise<T>,
  onRetry: (attempt: number, errorMessage: string) => Promise<void>,
): Promise<T> {
  let lastErr: any;
  for (let attempt = 0; attempt <= MAX_STAGE_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (attempt >= MAX_STAGE_RETRIES || isNonRetryableStageError(err)) {
        throw err;
      }
      const next = attempt + 1;
      await onRetry(next, String(err?.message || err || 'transient_error').slice(0, 140));
      const delayMs = 700 * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

function computeAnalysisCacheKey(params: {
  audioSha256: string;
  lang: string;
  enableSeparation: boolean;
  useGeminiAsr: boolean;
  lyricsText: string;
  sepEngine: string;
  asrEngine: string;
  alignEngine: string;
}): { cacheKey: string; paramsHash: string } {
  const lyricsHash = crypto.createHash('sha256').update(params.lyricsText.trim()).digest('hex');
  const paramsJson = JSON.stringify({
    lang: params.lang || 'auto',
    enableSeparation: params.enableSeparation,
    useGeminiAsr: params.useGeminiAsr,
    lyricsHash,
    sepEngine: params.sepEngine,
    asrEngine: params.asrEngine,
    alignEngine: params.alignEngine,
    v: 2,
  });
  const paramsHash = crypto.createHash('sha256').update(paramsJson).digest('hex');
  const cacheKey = crypto
    .createHash('sha256')
    .update(`${params.audioSha256}:${paramsHash}`)
    .digest('hex');
  return { cacheKey, paramsHash };
}

async function emitJobUpdate(job: PipelineJobRecord): Promise<PipelineJobRecord> {
  const saved = await timestampStore.saveJob(job);
  const enriched: PipelineJobRecord = {
    ...saved,
    stageDetail: job.stageDetail,
    windowProgress: job.windowProgress,
  };
  jobEvents.emit(`job:${enriched.id}`, enriched);
  jobEvents.emit('global', enriched);
  return enriched;
}

export async function listRecentJobs(limit = 25): Promise<PipelineJobRecord[]> {
  return timestampStore.listJobs(limit);
}

export async function enqueuePipelineJob(input: {
  uploadId: string;
  songId?: string;
  title?: string;
  artist?: string;
  lang?: string;
  lyricsText?: string;
  enableSeparation?: boolean;
  useGeminiAsr?: boolean;
  bypassCache?: boolean;
}): Promise<PipelineJobRecord> {
  const safeUpload = await getSafeUploadAudioPath(input.uploadId);
  if (!safeUpload) {
    throw new Error('upload_not_found');
  }
  const caps = await getPipelineCapabilities();
  const jobId = `job_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
  const now = new Date().toISOString();

  const requestParams: Record<string, unknown> = {
    songId: input.songId || null,
    title: input.title || '',
    artist: input.artist || '',
    lang: input.lang || 'auto',
    lyricsText: input.lyricsText || '',
    enableSeparation: input.enableSeparation !== false,
    useGeminiAsr: input.useGeminiAsr !== false,
    bypassCache: Boolean(input.bypassCache),
  };

  const initial: PipelineJobRecord = {
    id: jobId,
    uploadId: safeUpload.record.id,
    songId: input.songId || null,
    status: 'queued',
    stage: 'queued',
    progress: 5,
    lang: input.lang || 'auto',
    mode: 'modular_pipeline_v2',
    retryCount: 0,
    cachedHit: false,
    stageDetail:
      activeJobIds.size >= MAX_CONCURRENT_JOBS
        ? `En attente (${pendingQueue.length + 1} en file)`
        : 'Initialisation du worker asynchrone',
    requestParams,
    capabilities: caps,
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };

  await emitJobUpdate(initial);

  pendingQueue.push({
    job: initial,
    ctx: {
      audioPath: safeUpload.filePath,
      uploadDurationSec: safeUpload.record.durationSec,
      uploadFilename: safeUpload.record.filename,
      uploadSha256: safeUpload.record.sha256,
      songId: input.songId,
      title: input.title,
      artist: input.artist,
      lang: input.lang,
      lyricsText: input.lyricsText,
      enableSeparation: input.enableSeparation,
      useGeminiAsr: input.useGeminiAsr,
      bypassCache: Boolean(input.bypassCache),
    },
  });
  drainQueue();

  return initial;
}

export async function retryPipelineJob(jobId: string): Promise<PipelineJobRecord> {
  const prev = await timestampStore.getJob(jobId);
  if (!prev) {
    throw new Error('job_not_found');
  }
  const safeUpload = await getSafeUploadAudioPath(prev.uploadId);
  if (!safeUpload) {
    throw new Error('upload_not_found');
  }
  const rp = (prev.requestParams || {}) as Record<string, any>;
  const caps = await getPipelineCapabilities();
  const nextRetry = (prev.retryCount || 0) + 1;

  const resetJob: PipelineJobRecord = {
    ...prev,
    status: 'queued',
    stage: 'queued',
    progress: 5,
    retryCount: nextRetry,
    cachedHit: false,
    stageDetail: `Relance manuelle (tentative #${nextRetry})`,
    capabilities: caps,
    result: null,
    error: null,
    updatedAt: new Date().toISOString(),
  };

  await emitJobUpdate(resetJob);

  pendingQueue.push({
    job: resetJob,
    ctx: {
      audioPath: safeUpload.filePath,
      uploadDurationSec: safeUpload.record.durationSec,
      uploadFilename: safeUpload.record.filename,
      uploadSha256: safeUpload.record.sha256,
      songId: rp.songId || prev.songId || undefined,
      title: rp.title || undefined,
      artist: rp.artist || undefined,
      lang: rp.lang || prev.lang || 'auto',
      lyricsText: typeof rp.lyricsText === 'string' ? rp.lyricsText : undefined,
      enableSeparation: rp.enableSeparation !== false,
      useGeminiAsr: rp.useGeminiAsr !== false,
      bypassCache: Boolean(rp.bypassCache),
    },
  });
  drainQueue();

  return resetJob;
}

async function processPipelineJob(
  job: PipelineJobRecord,
  ctx: QueuedJobTask['ctx'],
): Promise<void> {
  let current: PipelineJobRecord = { ...job, status: 'running' };
  let jobTempDir: string | null = null;

  try {
    current = await emitJobUpdate({
      ...current,
      stage: 'validating_audio',
      progress: 12,
      stageDetail: 'Vérification de l’audio original et du cache d’analyse',
    });

    const manualHint = (ctx.lyricsText || '').trim();
    const sepProviderId =
      ctx.enableSeparation === false
        ? 'skipped'
        : extSeparator.isConfigured()
          ? extSeparator.id
          : dspSeparator.id;
    const asrProviderId =
      extAsr.isConfigured() && (!manualHint || ctx.useGeminiAsr !== false)
        ? extAsr.id
        : !manualHint && geminiAsr.isConfigured() && ctx.useGeminiAsr !== false
          ? geminiAsr.id
          : 'manual_lyrics';
    const alignProviderId = extAligner.isConfigured() ? extAligner.id : dspAligner.id;

    const { cacheKey, paramsHash } = computeAnalysisCacheKey({
      audioSha256: ctx.uploadSha256,
      lang: ctx.lang || 'auto',
      enableSeparation: ctx.enableSeparation !== false,
      useGeminiAsr: ctx.useGeminiAsr !== false,
      lyricsText: manualHint,
      sepEngine: sepProviderId,
      asrEngine: asrProviderId,
      alignEngine: alignProviderId,
    });

    const timelineIntegrity = {
      preservesOriginalAudio: true as const,
      timelineOriginSec: 0 as const,
      originalDurationSec: ctx.uploadDurationSec,
      originalSha256: ctx.uploadSha256,
      originalFilename: ctx.uploadFilename,
    };

    // Fast deterministic analysis cache lookup when audio & options match
    if (!ctx.bypassCache && ctx.uploadSha256) {
      const cached = await timestampStore.getCachedAnalysis(cacheKey);
      if (cached?.result) {
        const songId = ctx.songId || `song_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
        const resolvedTitle =
          ctx.title ||
          cached.result.title ||
          path.basename(ctx.uploadFilename, path.extname(ctx.uploadFilename));
        const clonedSong = await timestampStore.saveSongTimestamps({
          ...cached.result,
          songId,
          uploadId: job.uploadId,
          title: resolvedTitle,
          artist: ctx.artist ?? cached.result.artist ?? '',
          provenance: {
            ...cached.result.provenance,
            cached: true,
            cacheHits: cached.hitCount,
            timelineIntegrity,
          },
        });

        await emitJobUpdate({
          ...current,
          songId,
          status: 'completed',
          stage: 'completed',
          progress: 100,
          cachedHit: true,
          stageDetail: `Résultat servi instantanément depuis le cache (${cached.hitCount}×)`,
          result: clonedSong,
          error: null,
        });
        return;
      }
    }

    // Isolated 0o700 working directory for stems & slices; original upload is NEVER modified
    jobTempDir = await createSecureTempDir(`job_${job.id}`);

    // Stage 1: Vocal Separation (External Neural if configured, else streaming DSP Center Bandpass)
    let vocalStemPath: string | undefined;
    let separationEngine = 'skipped';
    let separationIsNeural = false;
    if (ctx.enableSeparation !== false) {
      current = await emitJobUpdate({
        ...current,
        stage: 'separating_vocals',
        progress: 26,
        stageDetail: 'Isolation du canal vocal dans dossier temporaire sécurisé',
      });
      const sep = await withStageRetry(
        () =>
          extSeparator.isConfigured()
            ? extSeparator.separate(ctx.audioPath, job.uploadId, jobTempDir || undefined)
            : dspSeparator.separate(ctx.audioPath, job.uploadId, jobTempDir || undefined),
        async (attempt, errMsg) => {
          current = await emitJobUpdate({
            ...current,
            retryCount: (current.retryCount || 0) + 1,
            stageDetail: `Nouvelle tentative séparation (${attempt}/${MAX_STAGE_RETRIES}): ${errMsg}`,
          });
        },
      );
      vocalStemPath = sep.stemPath;
      separationEngine = sep.engine;
      separationIsNeural = sep.isNeural;
    }

    // Stage 2: Singing Transcription (External Singing ASR > Gemini > Manual Lyrics Hint)
    current = await emitJobUpdate({
      ...current,
      stage: 'transcribing_lyrics',
      progress: 48,
      stageDetail: manualHint
        ? 'Préparation des paroles de référence fournies'
        : 'Analyse vocale et transcription multilingue',
    });

    let draftLines: SyncedLineRecord[] = [];
    let asrEngine = 'manual_lyrics';
    let detectedLanguages: string[] = ctx.lang && ctx.lang !== 'auto' ? [ctx.lang] : [];
    let detectedLanguage = ctx.lang || 'auto';
    let audioType = 'singing';
    let resolvedTitle =
      ctx.title || path.basename(ctx.uploadFilename, path.extname(ctx.uploadFilename));
    let resolvedArtist = ctx.artist || '';

    if (extAsr.isConfigured() && (!manualHint || ctx.useGeminiAsr !== false)) {
      const asr = await withStageRetry(
        () =>
          extAsr.transcribe({
            audioPath: ctx.audioPath,
            vocalStemPath,
            langHint: ctx.lang || 'auto',
            durationSec: ctx.uploadDurationSec,
          }),
        async (attempt, errMsg) => {
          current = await emitJobUpdate({
            ...current,
            retryCount: (current.retryCount || 0) + 1,
            stageDetail: `Nouvelle tentative ASR (${attempt}/${MAX_STAGE_RETRIES}): ${errMsg}`,
          });
        },
      );
      draftLines = asr.draftLines;
      asrEngine = asr.engine;
      detectedLanguages = asr.detectedLanguages;
      detectedLanguage = asr.language;
      audioType = asr.audioType;
    } else if (!manualHint && geminiAsr.isConfigured() && ctx.useGeminiAsr !== false) {
      const asr = await geminiAsr.transcribe({
        audioPath: ctx.audioPath,
        vocalStemPath,
        langHint: ctx.lang || 'auto',
        durationSec: ctx.uploadDurationSec,
        tempDir: jobTempDir || undefined,
        onProgress: async (detail, curWin, totalWin) => {
          const frac =
            totalWin && totalWin > 0 ? (Math.max(0, (curWin || 1) - 1) / totalWin) * 18 : 0;
          current = await emitJobUpdate({
            ...current,
            stage: 'transcribing_lyrics',
            progress: Math.min(68, Math.round(48 + frac)),
            stageDetail: detail,
            windowProgress:
              curWin && totalWin ? { current: curWin, total: totalWin } : undefined,
          });
        },
        onRetry: async (attempt, maxRetries, errMsg) => {
          current = await emitJobUpdate({
            ...current,
            retryCount: (current.retryCount || 0) + 1,
            stageDetail: `Backoff Gemini (${attempt}/${maxRetries}): ${errMsg}`,
          });
        },
      });
      draftLines = asr.draftLines;
      asrEngine = asr.engine;
      detectedLanguages = asr.detectedLanguages;
      detectedLanguage = asr.language;
      audioType = asr.audioType;
      if (asr.title && !ctx.title) resolvedTitle = asr.title;
      if (asr.artist && !ctx.artist) resolvedArtist = asr.artist;
    } else if (manualHint) {
      draftLines = buildLinesFromManualLyrics(
        manualHint,
        ctx.uploadDurationSec,
        ctx.lang || 'auto',
      );
    } else {
      throw new Error('no_lyrics_provided_and_no_asr_configured');
    }

    // Stage 3: Forced Alignment (External Neural Aligner if configured, else Python 100Hz DSP Viterbi)
    current = await emitJobUpdate({
      ...current,
      stage: 'aligning_timestamps',
      progress: 74,
      windowProgress: undefined,
      stageDetail: 'Alignement temporel mot par mot sur la timeline originale',
    });

    const alignRes = await withStageRetry(
      () =>
        extAligner.isConfigured()
          ? extAligner.align({
              audioPath: ctx.audioPath,
              vocalStemPath,
              lines: draftLines,
              langHint: detectedLanguage,
            })
          : dspAligner.align({
              audioPath: ctx.audioPath,
              vocalStemPath,
              lines: draftLines,
              langHint: detectedLanguage,
            }),
      async (attempt, errMsg) => {
        current = await emitJobUpdate({
          ...current,
          retryCount: (current.retryCount || 0) + 1,
          stageDetail: `Nouvelle tentative alignement (${attempt}/${MAX_STAGE_RETRIES}): ${errMsg}`,
        });
      },
    );

    // Stage 4: Confidence Validation & Calibration
    current = await emitJobUpdate({
      ...current,
      stage: 'validating_confidence',
      progress: 88,
      stageDetail: 'Validation acoustique et calibration des niveaux de confiance',
    });

    const { lines: validatedLines, summary } = confidenceValidator.validateAndSummarize(
      alignRes.lines,
    );

    // Stage 5: Persistent Structured Timestamp Storage (SQLite) & Analysis Cache
    current = await emitJobUpdate({
      ...current,
      stage: 'persisting',
      progress: 94,
      stageDetail: 'Sauvegarde SQLite et mise en cache de l’analyse',
    });

    const songId = ctx.songId || `song_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const songRecord: SongTimestampRecord = await timestampStore.saveSongTimestamps({
      songId,
      uploadId: job.uploadId,
      title: resolvedTitle,
      artist: resolvedArtist,
      language: detectedLanguage,
      detectedLanguages,
      audioType,
      durationSec: alignRes.durationSec || ctx.uploadDurationSec,
      bpm: 0,
      provenance: {
        vocalSeparation: separationEngine,
        vocalSeparationIsNeural: separationIsNeural,
        singingAsr: asrEngine,
        forcedAlignment: alignRes.engine,
        alignmentProvenance: alignRes.provenance,
        isNeuralPhonemeAligner: alignRes.isNeuralPhonemeAligner,
        cached: false,
        timelineIntegrity,
      },
      validationSummary: summary,
      lines: validatedLines,
    });

    await timestampStore
      .saveCachedAnalysis({
        cacheKey,
        audioSha256: ctx.uploadSha256,
        paramsHash,
        songId,
        result: songRecord,
      })
      .catch(() => {});

    await emitJobUpdate({
      ...current,
      songId,
      status: 'completed',
      stage: 'completed',
      progress: 100,
      cachedHit: false,
      stageDetail: `Pipeline terminé (${validatedLines.length} lignes · audio original intact)`,
      result: songRecord,
      error: null,
    });
  } catch (err: any) {
    await emitJobUpdate({
      ...current,
      status: 'failed',
      stage: 'error',
      progress: 100,
      stageDetail: 'Échec du pipeline — vous pouvez relancer sans ré-importer l’audio',
      error: String(err?.message || err || 'pipeline_error').slice(0, 300),
    });
  } finally {
    if (jobTempDir) {
      await removeTempPathSafe(jobTempDir);
    }
  }
}
