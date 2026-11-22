import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  TimeSpan,
  UploadRecord,
  UploadSessionRecord,
  WaveformPeak,
} from '../types/pipeline.ts';
import { timestampStore } from '../db/timestampStore.ts';

const execFileAsync = promisify(execFile);

const DATA_ROOT = path.resolve(process.cwd(), '.alexura_data');
const UPLOAD_ROOT = path.resolve(DATA_ROOT, 'uploads');
const STEM_ROOT = path.resolve(DATA_ROOT, 'stems');
const TMP_ROOT = path.resolve(DATA_ROOT, 'tmp');
const CHUNK_ROOT = path.resolve(TMP_ROOT, 'chunks');
const WORKER_SCRIPT = path.resolve(process.cwd(), 'backend', 'audio_worker.py');

export const MAX_UPLOAD_BYTES = 250 * 1024 * 1024; // 250 MB
export const RECOMMENDED_CHUNK_BYTES = 4 * 1024 * 1024; // 4 MB
export const TEMP_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

const ALLOWED_EXTENSIONS = new Set(['.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.webm']);

const EXT_TO_MIME: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
};

let cleanupTimerStarted = false;
const sessionLocks = new Map<string, Promise<unknown>>();

function withSessionLock<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
  const prev = sessionLocks.get(sessionId) || Promise.resolve();
  const next = prev.then(task, task);
  sessionLocks.set(
    sessionId,
    next.finally(() => {
      if (sessionLocks.get(sessionId) === next) {
        sessionLocks.delete(sessionId);
      }
    }),
  );
  return next;
}

function sanitizeId(raw: string): string {
  return String(raw || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

export function confinePath(rootDir: string, unsafeTarget: string): string {
  const resolvedRoot = path.resolve(rootDir);
  const resolved = path.resolve(resolvedRoot, path.basename(unsafeTarget));
  if (!resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error('path_traversal_blocked');
  }
  return resolved;
}

export function verifyAudioMagicBytes(buf: Buffer, ext: string): boolean {
  if (!buf || buf.length < 12) return false;
  // RIFF....WAVE
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x41 &&
    buf[10] === 0x56 &&
    buf[11] === 0x45
  ) {
    return true;
  }
  // ID3v2 or MPEG Audio frame sync (MP3 / AAC ADTS)
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true;
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return true;
  // FLAC
  if (buf[0] === 0x66 && buf[1] === 0x4c && buf[2] === 0x61 && buf[3] === 0x43) return true;
  // OggS
  if (buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) return true;
  // ISO-BMFF 'ftyp' (M4A / MP4 audio)
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return true;
  // WebM EBML header
  if (
    ext === '.webm' &&
    buf[0] === 0x1a &&
    buf[1] === 0x45 &&
    buf[2] === 0xdf &&
    buf[3] === 0xa3
  ) {
    return true;
  }
  return false;
}

async function computeFileSha256Stream(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const rs = fsSync.createReadStream(filePath);
    rs.on('data', (chunk) => hash.update(chunk));
    rs.on('end', () => resolve(hash.digest('hex')));
    rs.on('error', reject);
  });
}

async function readHeadBytes(filePath: string, length = 64): Promise<Buffer> {
  const fh = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

async function moveFileSafe(srcPath: string, dstPath: string): Promise<void> {
  try {
    await fs.rename(srcPath, dstPath);
  } catch (err: any) {
    if (err?.code === 'EXDEV') {
      await fs.copyFile(srcPath, dstPath);
      await fs.unlink(srcPath);
    } else {
      throw err;
    }
  }
}

async function probeAudioWithPython(audioPath: string): Promise<{
  durationSec: number;
  sampleRate: number;
  channels: number;
  waveformPeaks: WaveformPeak[];
  vocalSegments: TimeSpan[];
}> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'python3',
      [WORKER_SCRIPT, 'probe'],
      { maxBuffer: 15 * 1024 * 1024, timeout: 180000 },
      (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(stderr?.trim() || err.message));
        }
        try {
          const parsed = JSON.parse(stdout || '{}');
          if (!parsed.ok) return reject(new Error(parsed.error || 'audio_probe_failed'));
          resolve({
            durationSec: Number(parsed.durationSec || 0),
            sampleRate: Number(parsed.sampleRate || 16000),
            channels: Number(parsed.channels || 1),
            waveformPeaks: Array.isArray(parsed.waveformPeaks) ? parsed.waveformPeaks : [],
            vocalSegments: Array.isArray(parsed.vocalSegments) ? parsed.vocalSegments : [],
          });
        } catch (parseErr: any) {
          reject(new Error(`probe_json_error:${parseErr?.message}`));
        }
      },
    );
    child.stdin?.write(JSON.stringify({ audioPath }));
    child.stdin?.end();
  });
}

export async function ensureStorageDirs(): Promise<void> {
  await fs.mkdir(UPLOAD_ROOT, { recursive: true, mode: 0o750 });
  await fs.mkdir(STEM_ROOT, { recursive: true, mode: 0o750 });
  await fs.mkdir(TMP_ROOT, { recursive: true, mode: 0o700 });
  await fs.mkdir(CHUNK_ROOT, { recursive: true, mode: 0o700 });
}

export async function createSecureTempDir(prefix: string): Promise<string> {
  await ensureStorageDirs();
  const cleanPrefix = sanitizeId(prefix).slice(0, 32) || 'tmp';
  const dirName = `${cleanPrefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const dirPath = confinePath(TMP_ROOT, dirName);
  await fs.mkdir(dirPath, { recursive: true, mode: 0o700 });
  return dirPath;
}

export async function removeTempPathSafe(targetPath: string | undefined | null): Promise<void> {
  if (!targetPath) return;
  const resolvedRoot = path.resolve(TMP_ROOT);
  const resolved = path.resolve(targetPath);
  if (!resolved.startsWith(resolvedRoot + path.sep)) {
    return;
  }
  await fs.rm(resolved, { recursive: true, force: true }).catch(() => {});
}

export async function sweepExpiredTempStorage(ttlMs = TEMP_TTL_MS): Promise<{ removed: number }> {
  await ensureStorageDirs();
  const cutoff = Date.now() - Math.max(60_000, ttlMs);
  let removed = 0;

  const sweepFolder = async (folder: string, skipNames: Set<string> = new Set()) => {
    const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (skipNames.has(entry.name)) continue;
      const fullPath = confinePath(folder, entry.name);
      try {
        const st = await fs.stat(fullPath);
        if (st.mtimeMs < cutoff) {
          await fs.rm(fullPath, { recursive: true, force: true });
          removed++;
        }
      } catch {
        // Ignore transient concurrent removal
      }
    }
  };

  await sweepFolder(TMP_ROOT, new Set(['chunks']));
  await sweepFolder(CHUNK_ROOT);
  await sweepFolder(STEM_ROOT);
  return { removed };
}

export function startTempCleanupScheduler(): void {
  if (cleanupTimerStarted) return;
  cleanupTimerStarted = true;
  void sweepExpiredTempStorage().catch(() => {});
  const timer = setInterval(() => {
    void sweepExpiredTempStorage().catch(() => {});
  }, 30 * 60 * 1000);
  timer.unref?.();
}

export async function checkWorkerTools(): Promise<{ pythonAvailable: boolean; ffmpegAvailable: boolean }> {
  let pythonAvailable = false;
  let ffmpegAvailable = false;
  try {
    await execFileAsync('python3', ['--version'], { timeout: 3000 });
    pythonAvailable = true;
  } catch {
    pythonAvailable = false;
  }
  try {
    await execFileAsync('ffmpeg', ['-version'], { timeout: 3000 });
    ffmpegAvailable = true;
  } catch {
    ffmpegAvailable = false;
  }
  return { pythonAvailable, ffmpegAvailable };
}

async function findVerifiedDuplicateBySha256(sha256: string): Promise<UploadRecord | null> {
  const existing = await timestampStore.findUploadBySha256(sha256);
  if (!existing) return null;
  try {
    const safePath = confinePath(UPLOAD_ROOT, existing.storagePath);
    await fs.access(safePath);
    return { ...existing, deduplicated: true };
  } catch {
    return null;
  }
}

async function finalizeTempAudioToUploadStore(params: {
  tempFilePath: string;
  originalFilename: string;
  declaredMime?: string;
  byteSize: number;
  sha256?: string;
}): Promise<UploadRecord> {
  await ensureStorageDirs();
  const safeBase = path.basename(String(params.originalFilename || 'track.wav')).slice(0, 180);
  const ext = path.extname(safeBase).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error('unsupported_audio_extension');
  }
  if (!params.byteSize || params.byteSize <= 0 || params.byteSize > MAX_UPLOAD_BYTES) {
    throw new Error('invalid_audio_size');
  }

  const head = await readHeadBytes(params.tempFilePath, 64);
  if (!verifyAudioMagicBytes(head, ext)) {
    throw new Error('invalid_audio_magic_header');
  }

  const sha256 = params.sha256 || (await computeFileSha256Stream(params.tempFilePath));
  const dup = await findVerifiedDuplicateBySha256(sha256);
  if (dup) {
    return dup;
  }

  const uploadId = `upl_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const targetPath = confinePath(UPLOAD_ROOT, `${uploadId}${ext}`);
  await moveFileSafe(params.tempFilePath, targetPath);

  try {
    const probe = await probeAudioWithPython(targetPath);
    const mimeType = EXT_TO_MIME[ext] || String(params.declaredMime || 'audio/mpeg').slice(0, 80);
    const record: UploadRecord = {
      id: uploadId,
      filename: safeBase,
      mimeType,
      byteSize: params.byteSize,
      sha256,
      durationSec: probe.durationSec,
      sampleRate: probe.sampleRate,
      channels: probe.channels,
      waveformPeaks: probe.waveformPeaks,
      vocalSegments: probe.vocalSegments,
      storagePath: targetPath,
      createdAt: new Date().toISOString(),
      deduplicated: false,
    };
    return await timestampStore.saveUpload(record);
  } catch (err) {
    await fs.unlink(targetPath).catch(() => {});
    throw err;
  }
}

export async function saveValidatedUpload(params: {
  buffer: Buffer;
  originalFilename: string;
  declaredMime?: string;
}): Promise<UploadRecord> {
  await ensureStorageDirs();
  const safeBase = path.basename(String(params.originalFilename || 'track.wav')).slice(0, 180);
  const ext = path.extname(safeBase).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error('unsupported_audio_extension');
  }
  if (!params.buffer || params.buffer.length === 0 || params.buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error('invalid_audio_size');
  }
  if (!verifyAudioMagicBytes(params.buffer, ext)) {
    throw new Error('invalid_audio_magic_header');
  }

  const sha256 = crypto.createHash('sha256').update(params.buffer).digest('hex');
  const dup = await findVerifiedDuplicateBySha256(sha256);
  if (dup) {
    return dup;
  }

  const tempDir = await createSecureTempDir('upl');
  const tmpFile = confinePath(tempDir, `raw${ext}`);
  try {
    await fs.writeFile(tmpFile, params.buffer, { mode: 0o600 });
    return await finalizeTempAudioToUploadStore({
      tempFilePath: tmpFile,
      originalFilename: safeBase,
      declaredMime: params.declaredMime,
      byteSize: params.buffer.length,
      sha256,
    });
  } finally {
    await removeTempPathSafe(tempDir);
  }
}

export async function saveValidatedStreamUpload(params: {
  stream: Readable;
  originalFilename: string;
  declaredMime?: string;
}): Promise<UploadRecord> {
  await ensureStorageDirs();
  const safeBase = path.basename(String(params.originalFilename || 'track.wav')).slice(0, 180);
  const ext = path.extname(safeBase).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error('unsupported_audio_extension');
  }

  const tempDir = await createSecureTempDir('stream');
  const tmpFile = confinePath(tempDir, `stream${ext}`);
  try {
    const hash = crypto.createHash('sha256');
    let byteSize = 0;

    await new Promise<void>((resolve, reject) => {
      const ws = fsSync.createWriteStream(tmpFile, { mode: 0o600 });
      let failed = false;
      const fail = (err: Error) => {
        if (failed) return;
        failed = true;
        params.stream.destroy();
        ws.destroy();
        reject(err);
      };
      params.stream.on('data', (chunk: Buffer) => {
        byteSize += chunk.length;
        if (byteSize > MAX_UPLOAD_BYTES) {
          fail(new Error('invalid_audio_size'));
          return;
        }
        hash.update(chunk);
        if (!ws.write(chunk)) {
          params.stream.pause();
          ws.once('drain', () => params.stream.resume());
        }
      });
      params.stream.on('end', () => {
        if (!failed) ws.end();
      });
      params.stream.on('error', (err) => fail(err));
      ws.on('finish', () => {
        if (!failed) resolve();
      });
      ws.on('error', (err) => fail(err));
    });

    const sha256 = hash.digest('hex');
    return await finalizeTempAudioToUploadStore({
      tempFilePath: tmpFile,
      originalFilename: safeBase,
      declaredMime: params.declaredMime,
      byteSize,
      sha256,
    });
  } finally {
    await removeTempPathSafe(tempDir);
  }
}

export async function initChunkedUploadSession(params: {
  filename: string;
  mimeType?: string;
  expectedBytes?: number;
}): Promise<UploadSessionRecord> {
  await ensureStorageDirs();
  const safeBase = path.basename(String(params.filename || 'track.wav')).slice(0, 180);
  const ext = path.extname(safeBase).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error('unsupported_audio_extension');
  }
  const expectedBytes = Number(params.expectedBytes || 0);
  if (expectedBytes < 0 || expectedBytes > MAX_UPLOAD_BYTES) {
    throw new Error('invalid_audio_size');
  }

  const sessionId = `ses_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const sessionDir = confinePath(CHUNK_ROOT, sessionId);
  await fs.mkdir(sessionDir, { recursive: true, mode: 0o700 });

  const now = new Date().toISOString();
  const meta: UploadSessionRecord = {
    sessionId,
    filename: safeBase,
    mimeType: EXT_TO_MIME[ext] || String(params.mimeType || 'audio/mpeg').slice(0, 80),
    expectedBytes,
    receivedBytes: 0,
    chunkCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  await fs.writeFile(confinePath(sessionDir, 'payload.bin'), Buffer.alloc(0), { mode: 0o600 });
  await fs.writeFile(confinePath(sessionDir, 'meta.json'), JSON.stringify(meta), { mode: 0o600 });
  return meta;
}

export async function appendUploadChunk(
  sessionId: string,
  chunkBuffer: Buffer,
  chunkIndex?: number,
): Promise<{ receivedBytes: number; chunkCount: number; chunkIndex: number }> {
  const cleanSession = sanitizeId(sessionId);
  if (!cleanSession) throw new Error('invalid_session_id');
  if (!chunkBuffer || chunkBuffer.length === 0) throw new Error('empty_chunk');

  return withSessionLock(cleanSession, async () => {
    const sessionDir = confinePath(CHUNK_ROOT, cleanSession);
    const metaPath = confinePath(sessionDir, 'meta.json');
    const payloadPath = confinePath(sessionDir, 'payload.bin');

    let meta: UploadSessionRecord;
    try {
      meta = JSON.parse(await fs.readFile(metaPath, 'utf-8')) as UploadSessionRecord;
    } catch {
      throw new Error('upload_session_not_found');
    }

    const nextBytes = meta.receivedBytes + chunkBuffer.length;
    if (nextBytes > MAX_UPLOAD_BYTES) {
      throw new Error('invalid_audio_size');
    }

    await fs.appendFile(payloadPath, chunkBuffer);
    meta.receivedBytes = nextBytes;
    meta.chunkCount += 1;
    meta.updatedAt = new Date().toISOString();
    await fs.writeFile(metaPath, JSON.stringify(meta), { mode: 0o600 });

    return {
      receivedBytes: meta.receivedBytes,
      chunkCount: meta.chunkCount,
      chunkIndex: typeof chunkIndex === 'number' && chunkIndex >= 0 ? chunkIndex : meta.chunkCount - 1,
    };
  });
}

export async function finalizeChunkedUploadSession(sessionId: string): Promise<UploadRecord> {
  const cleanSession = sanitizeId(sessionId);
  if (!cleanSession) throw new Error('invalid_session_id');

  return withSessionLock(cleanSession, async () => {
    const sessionDir = confinePath(CHUNK_ROOT, cleanSession);
    const metaPath = confinePath(sessionDir, 'meta.json');
    const payloadPath = confinePath(sessionDir, 'payload.bin');

    let meta: UploadSessionRecord;
    try {
      meta = JSON.parse(await fs.readFile(metaPath, 'utf-8')) as UploadSessionRecord;
    } catch {
      throw new Error('upload_session_not_found');
    }

    try {
      const stat = await fs.stat(payloadPath);
      return await finalizeTempAudioToUploadStore({
        tempFilePath: payloadPath,
        originalFilename: meta.filename,
        declaredMime: meta.mimeType,
        byteSize: stat.size,
      });
    } finally {
      await removeTempPathSafe(sessionDir);
    }
  });
}

export async function getSafeUploadAudioPath(
  uploadId: string,
): Promise<{ record: UploadRecord; filePath: string } | null> {
  const cleanId = sanitizeId(uploadId);
  if (!cleanId) return null;
  const rec = await timestampStore.getUpload(cleanId);
  if (!rec) return null;
  const safePath = confinePath(UPLOAD_ROOT, rec.storagePath);
  try {
    await fs.access(safePath);
    return { record: rec, filePath: safePath };
  } catch {
    return null;
  }
}

export function getStemOutputPath(uploadId: string, tempDir?: string): string {
  const cleanId = sanitizeId(uploadId);
  if (tempDir) {
    const resolvedRoot = path.resolve(TMP_ROOT);
    const resolvedDir = path.resolve(tempDir);
    if (!resolvedDir.startsWith(resolvedRoot + path.sep)) {
      throw new Error('path_traversal_blocked');
    }
    return confinePath(resolvedDir, `${cleanId}_vocal.wav`);
  }
  return confinePath(STEM_ROOT, `${cleanId}_vocal.wav`);
}
