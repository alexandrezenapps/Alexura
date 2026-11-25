// server.ts
import express3 from "express";
import path9 from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI as GoogleGenAI3, Type as Type3 } from "@google/genai";

// server/routes/pipelineRoutes.ts
import express from "express";
import fs5 from "node:fs";

// server/storage/fileStore.ts
import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path2 from "node:path";
import { execFile as execFile2 } from "node:child_process";
import { promisify } from "node:util";

// server/db/timestampStore.ts
import { execFile } from "node:child_process";
import path from "node:path";
var DB_SCRIPT = path.resolve(process.cwd(), "backend", "db.py");
function runDbAction(action, payload) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "python3",
      [DB_SCRIPT, action],
      { maxBuffer: 25 * 1024 * 1024, timeout: 25e3 },
      (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(stderr?.trim() || err.message));
        }
        try {
          const parsed = JSON.parse(stdout || "{}");
          if (!parsed.ok) {
            return reject(new Error(parsed.error || `db_action_failed:${action}`));
          }
          resolve(parsed);
        } catch (parseErr) {
          reject(new Error(`db_invalid_json:${parseErr?.message || action}`));
        }
      }
    );
    child.stdin?.write(JSON.stringify(payload ?? {}));
    child.stdin?.end();
  });
}
var timestampStore = {
  async saveUpload(record) {
    const res = await runDbAction("upsert_upload", record);
    return res.upload;
  },
  async getUpload(id) {
    const res = await runDbAction("get_upload", { id });
    return res.upload || null;
  },
  async findUploadBySha256(sha256) {
    const res = await runDbAction(
      "find_upload_by_sha256",
      { sha256 }
    );
    return res.upload || null;
  },
  async saveJob(job) {
    const res = await runDbAction("upsert_job", job);
    return res.job;
  },
  async getJob(id) {
    const res = await runDbAction("get_job", { id });
    return res.job || null;
  },
  async listJobs(limit = 25) {
    const res = await runDbAction("list_jobs", { limit });
    return res.jobs || [];
  },
  async getCachedAnalysis(cacheKey) {
    const res = await runDbAction(
      "get_cached_analysis",
      { cacheKey }
    );
    return res.cache || null;
  },
  async saveCachedAnalysis(params) {
    await runDbAction("save_cached_analysis", params);
  },
  async saveSongTimestamps(song) {
    const res = await runDbAction("save_song_timestamps", song);
    return res.song;
  },
  async getSongTimestamps(songId) {
    const res = await runDbAction("get_song_timestamps", { songId });
    return res.song || null;
  },
  async listSongs(limit = 40) {
    const res = await runDbAction("list_songs", { limit });
    return res.songs || [];
  },
  async updateWordTimestamp(params) {
    const res = await runDbAction("update_word_timestamp", params);
    return res.song;
  }
};

// server/storage/fileStore.ts
var execFileAsync = promisify(execFile2);
var DATA_ROOT = path2.resolve(process.cwd(), ".alexura_data");
var UPLOAD_ROOT = path2.resolve(DATA_ROOT, "uploads");
var STEM_ROOT = path2.resolve(DATA_ROOT, "stems");
var TMP_ROOT = path2.resolve(DATA_ROOT, "tmp");
var CHUNK_ROOT = path2.resolve(TMP_ROOT, "chunks");
var WORKER_SCRIPT = path2.resolve(process.cwd(), "backend", "audio_worker.py");
var MAX_UPLOAD_BYTES = 250 * 1024 * 1024;
var RECOMMENDED_CHUNK_BYTES = 4 * 1024 * 1024;
var TEMP_TTL_MS = 2 * 60 * 60 * 1e3;
var ALLOWED_EXTENSIONS = /* @__PURE__ */ new Set([".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".webm"]);
var EXT_TO_MIME = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".webm": "audio/webm"
};
var cleanupTimerStarted = false;
var sessionLocks = /* @__PURE__ */ new Map();
function withSessionLock(sessionId, task) {
  const prev = sessionLocks.get(sessionId) || Promise.resolve();
  const next = prev.then(task, task);
  sessionLocks.set(
    sessionId,
    next.finally(() => {
      if (sessionLocks.get(sessionId) === next) {
        sessionLocks.delete(sessionId);
      }
    })
  );
  return next;
}
function sanitizeId(raw) {
  return String(raw || "").replace(/[^a-zA-Z0-9_-]/g, "");
}
function confinePath(rootDir, unsafeTarget) {
  const resolvedRoot = path2.resolve(rootDir);
  const resolved = path2.resolve(resolvedRoot, path2.basename(unsafeTarget));
  if (!resolved.startsWith(resolvedRoot + path2.sep)) {
    throw new Error("path_traversal_blocked");
  }
  return resolved;
}
function verifyAudioMagicBytes(buf, ext) {
  if (!buf || buf.length < 12) return false;
  if (buf[0] === 82 && buf[1] === 73 && buf[2] === 70 && buf[3] === 70 && buf[8] === 87 && buf[9] === 65 && buf[10] === 86 && buf[11] === 69) {
    return true;
  }
  if (buf[0] === 73 && buf[1] === 68 && buf[2] === 51) return true;
  if (buf[0] === 255 && (buf[1] & 224) === 224) return true;
  if (buf[0] === 102 && buf[1] === 76 && buf[2] === 97 && buf[3] === 67) return true;
  if (buf[0] === 79 && buf[1] === 103 && buf[2] === 103 && buf[3] === 83) return true;
  if (buf[4] === 102 && buf[5] === 116 && buf[6] === 121 && buf[7] === 112) return true;
  if (ext === ".webm" && buf[0] === 26 && buf[1] === 69 && buf[2] === 223 && buf[3] === 163) {
    return true;
  }
  return false;
}
async function computeFileSha256Stream(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const rs = fsSync.createReadStream(filePath);
    rs.on("data", (chunk) => hash.update(chunk));
    rs.on("end", () => resolve(hash.digest("hex")));
    rs.on("error", reject);
  });
}
async function readHeadBytes(filePath, length = 64) {
  const fh = await fs.open(filePath, "r");
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}
async function moveFileSafe(srcPath, dstPath) {
  try {
    await fs.rename(srcPath, dstPath);
  } catch (err) {
    if (err?.code === "EXDEV") {
      await fs.copyFile(srcPath, dstPath);
      await fs.unlink(srcPath);
    } else {
      throw err;
    }
  }
}
async function probeAudioWithPython(audioPath) {
  return new Promise((resolve, reject) => {
    const child = execFile2(
      "python3",
      [WORKER_SCRIPT, "probe"],
      { maxBuffer: 15 * 1024 * 1024, timeout: 18e4 },
      (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(stderr?.trim() || err.message));
        }
        try {
          const parsed = JSON.parse(stdout || "{}");
          if (!parsed.ok) return reject(new Error(parsed.error || "audio_probe_failed"));
          resolve({
            durationSec: Number(parsed.durationSec || 0),
            sampleRate: Number(parsed.sampleRate || 16e3),
            channels: Number(parsed.channels || 1),
            waveformPeaks: Array.isArray(parsed.waveformPeaks) ? parsed.waveformPeaks : [],
            vocalSegments: Array.isArray(parsed.vocalSegments) ? parsed.vocalSegments : []
          });
        } catch (parseErr) {
          reject(new Error(`probe_json_error:${parseErr?.message}`));
        }
      }
    );
    child.stdin?.write(JSON.stringify({ audioPath }));
    child.stdin?.end();
  });
}
async function ensureStorageDirs() {
  await fs.mkdir(UPLOAD_ROOT, { recursive: true, mode: 488 });
  await fs.mkdir(STEM_ROOT, { recursive: true, mode: 488 });
  await fs.mkdir(TMP_ROOT, { recursive: true, mode: 448 });
  await fs.mkdir(CHUNK_ROOT, { recursive: true, mode: 448 });
}
async function createSecureTempDir(prefix) {
  await ensureStorageDirs();
  const cleanPrefix = sanitizeId(prefix).slice(0, 32) || "tmp";
  const dirName = `${cleanPrefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const dirPath = confinePath(TMP_ROOT, dirName);
  await fs.mkdir(dirPath, { recursive: true, mode: 448 });
  return dirPath;
}
async function removeTempPathSafe(targetPath) {
  if (!targetPath) return;
  const resolvedRoot = path2.resolve(TMP_ROOT);
  const resolved = path2.resolve(targetPath);
  if (!resolved.startsWith(resolvedRoot + path2.sep)) {
    return;
  }
  await fs.rm(resolved, { recursive: true, force: true }).catch(() => {
  });
}
async function sweepExpiredTempStorage(ttlMs = TEMP_TTL_MS) {
  await ensureStorageDirs();
  const cutoff = Date.now() - Math.max(6e4, ttlMs);
  let removed = 0;
  const sweepFolder = async (folder, skipNames = /* @__PURE__ */ new Set()) => {
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
      }
    }
  };
  await sweepFolder(TMP_ROOT, /* @__PURE__ */ new Set(["chunks"]));
  await sweepFolder(CHUNK_ROOT);
  await sweepFolder(STEM_ROOT);
  return { removed };
}
function startTempCleanupScheduler() {
  if (cleanupTimerStarted) return;
  cleanupTimerStarted = true;
  void sweepExpiredTempStorage().catch(() => {
  });
  const timer = setInterval(() => {
    void sweepExpiredTempStorage().catch(() => {
    });
  }, 30 * 60 * 1e3);
  timer.unref?.();
}
async function checkWorkerTools() {
  let pythonAvailable = false;
  let ffmpegAvailable = false;
  try {
    await execFileAsync("python3", ["--version"], { timeout: 3e3 });
    pythonAvailable = true;
  } catch {
    pythonAvailable = false;
  }
  try {
    await execFileAsync("ffmpeg", ["-version"], { timeout: 3e3 });
    ffmpegAvailable = true;
  } catch {
    ffmpegAvailable = false;
  }
  return { pythonAvailable, ffmpegAvailable };
}
async function findVerifiedDuplicateBySha256(sha256) {
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
async function finalizeTempAudioToUploadStore(params) {
  await ensureStorageDirs();
  const safeBase = path2.basename(String(params.originalFilename || "track.wav")).slice(0, 180);
  const ext = path2.extname(safeBase).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error("unsupported_audio_extension");
  }
  if (!params.byteSize || params.byteSize <= 0 || params.byteSize > MAX_UPLOAD_BYTES) {
    throw new Error("invalid_audio_size");
  }
  const head = await readHeadBytes(params.tempFilePath, 64);
  if (!verifyAudioMagicBytes(head, ext)) {
    throw new Error("invalid_audio_magic_header");
  }
  const sha256 = params.sha256 || await computeFileSha256Stream(params.tempFilePath);
  const dup = await findVerifiedDuplicateBySha256(sha256);
  if (dup) {
    return dup;
  }
  const uploadId = `upl_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const targetPath = confinePath(UPLOAD_ROOT, `${uploadId}${ext}`);
  await moveFileSafe(params.tempFilePath, targetPath);
  try {
    const probe = await probeAudioWithPython(targetPath);
    const mimeType = EXT_TO_MIME[ext] || String(params.declaredMime || "audio/mpeg").slice(0, 80);
    const record = {
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
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      deduplicated: false
    };
    return await timestampStore.saveUpload(record);
  } catch (err) {
    await fs.unlink(targetPath).catch(() => {
    });
    throw err;
  }
}
async function saveValidatedUpload(params) {
  await ensureStorageDirs();
  const safeBase = path2.basename(String(params.originalFilename || "track.wav")).slice(0, 180);
  const ext = path2.extname(safeBase).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error("unsupported_audio_extension");
  }
  if (!params.buffer || params.buffer.length === 0 || params.buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error("invalid_audio_size");
  }
  if (!verifyAudioMagicBytes(params.buffer, ext)) {
    throw new Error("invalid_audio_magic_header");
  }
  const sha256 = crypto.createHash("sha256").update(params.buffer).digest("hex");
  const dup = await findVerifiedDuplicateBySha256(sha256);
  if (dup) {
    return dup;
  }
  const tempDir = await createSecureTempDir("upl");
  const tmpFile = confinePath(tempDir, `raw${ext}`);
  try {
    await fs.writeFile(tmpFile, params.buffer, { mode: 384 });
    return await finalizeTempAudioToUploadStore({
      tempFilePath: tmpFile,
      originalFilename: safeBase,
      declaredMime: params.declaredMime,
      byteSize: params.buffer.length,
      sha256
    });
  } finally {
    await removeTempPathSafe(tempDir);
  }
}
async function saveValidatedStreamUpload(params) {
  await ensureStorageDirs();
  const safeBase = path2.basename(String(params.originalFilename || "track.wav")).slice(0, 180);
  const ext = path2.extname(safeBase).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error("unsupported_audio_extension");
  }
  const tempDir = await createSecureTempDir("stream");
  const tmpFile = confinePath(tempDir, `stream${ext}`);
  try {
    const hash = crypto.createHash("sha256");
    let byteSize = 0;
    await new Promise((resolve, reject) => {
      const ws = fsSync.createWriteStream(tmpFile, { mode: 384 });
      let failed = false;
      const fail = (err) => {
        if (failed) return;
        failed = true;
        params.stream.destroy();
        ws.destroy();
        reject(err);
      };
      params.stream.on("data", (chunk) => {
        byteSize += chunk.length;
        if (byteSize > MAX_UPLOAD_BYTES) {
          fail(new Error("invalid_audio_size"));
          return;
        }
        hash.update(chunk);
        if (!ws.write(chunk)) {
          params.stream.pause();
          ws.once("drain", () => params.stream.resume());
        }
      });
      params.stream.on("end", () => {
        if (!failed) ws.end();
      });
      params.stream.on("error", (err) => fail(err));
      ws.on("finish", () => {
        if (!failed) resolve();
      });
      ws.on("error", (err) => fail(err));
    });
    const sha256 = hash.digest("hex");
    return await finalizeTempAudioToUploadStore({
      tempFilePath: tmpFile,
      originalFilename: safeBase,
      declaredMime: params.declaredMime,
      byteSize,
      sha256
    });
  } finally {
    await removeTempPathSafe(tempDir);
  }
}
async function initChunkedUploadSession(params) {
  await ensureStorageDirs();
  const safeBase = path2.basename(String(params.filename || "track.wav")).slice(0, 180);
  const ext = path2.extname(safeBase).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error("unsupported_audio_extension");
  }
  const expectedBytes = Number(params.expectedBytes || 0);
  if (expectedBytes < 0 || expectedBytes > MAX_UPLOAD_BYTES) {
    throw new Error("invalid_audio_size");
  }
  const sessionId = `ses_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const sessionDir = confinePath(CHUNK_ROOT, sessionId);
  await fs.mkdir(sessionDir, { recursive: true, mode: 448 });
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const meta = {
    sessionId,
    filename: safeBase,
    mimeType: EXT_TO_MIME[ext] || String(params.mimeType || "audio/mpeg").slice(0, 80),
    expectedBytes,
    receivedBytes: 0,
    chunkCount: 0,
    createdAt: now,
    updatedAt: now
  };
  await fs.writeFile(confinePath(sessionDir, "payload.bin"), Buffer.alloc(0), { mode: 384 });
  await fs.writeFile(confinePath(sessionDir, "meta.json"), JSON.stringify(meta), { mode: 384 });
  return meta;
}
async function appendUploadChunk(sessionId, chunkBuffer, chunkIndex) {
  const cleanSession = sanitizeId(sessionId);
  if (!cleanSession) throw new Error("invalid_session_id");
  if (!chunkBuffer || chunkBuffer.length === 0) throw new Error("empty_chunk");
  return withSessionLock(cleanSession, async () => {
    const sessionDir = confinePath(CHUNK_ROOT, cleanSession);
    const metaPath = confinePath(sessionDir, "meta.json");
    const payloadPath = confinePath(sessionDir, "payload.bin");
    let meta;
    try {
      meta = JSON.parse(await fs.readFile(metaPath, "utf-8"));
    } catch {
      throw new Error("upload_session_not_found");
    }
    const nextBytes = meta.receivedBytes + chunkBuffer.length;
    if (nextBytes > MAX_UPLOAD_BYTES) {
      throw new Error("invalid_audio_size");
    }
    await fs.appendFile(payloadPath, chunkBuffer);
    meta.receivedBytes = nextBytes;
    meta.chunkCount += 1;
    meta.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await fs.writeFile(metaPath, JSON.stringify(meta), { mode: 384 });
    return {
      receivedBytes: meta.receivedBytes,
      chunkCount: meta.chunkCount,
      chunkIndex: typeof chunkIndex === "number" && chunkIndex >= 0 ? chunkIndex : meta.chunkCount - 1
    };
  });
}
async function finalizeChunkedUploadSession(sessionId) {
  const cleanSession = sanitizeId(sessionId);
  if (!cleanSession) throw new Error("invalid_session_id");
  return withSessionLock(cleanSession, async () => {
    const sessionDir = confinePath(CHUNK_ROOT, cleanSession);
    const metaPath = confinePath(sessionDir, "meta.json");
    const payloadPath = confinePath(sessionDir, "payload.bin");
    let meta;
    try {
      meta = JSON.parse(await fs.readFile(metaPath, "utf-8"));
    } catch {
      throw new Error("upload_session_not_found");
    }
    try {
      const stat = await fs.stat(payloadPath);
      return await finalizeTempAudioToUploadStore({
        tempFilePath: payloadPath,
        originalFilename: meta.filename,
        declaredMime: meta.mimeType,
        byteSize: stat.size
      });
    } finally {
      await removeTempPathSafe(sessionDir);
    }
  });
}
async function getSafeUploadAudioPath(uploadId) {
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
function getStemOutputPath(uploadId, tempDir) {
  const cleanId = sanitizeId(uploadId);
  if (tempDir) {
    const resolvedRoot = path2.resolve(TMP_ROOT);
    const resolvedDir = path2.resolve(tempDir);
    if (!resolvedDir.startsWith(resolvedRoot + path2.sep)) {
      throw new Error("path_traversal_blocked");
    }
    return confinePath(resolvedDir, `${cleanId}_vocal.wav`);
  }
  return confinePath(STEM_ROOT, `${cleanId}_vocal.wav`);
}

// server/jobs/jobQueue.ts
import crypto2 from "node:crypto";
import { EventEmitter } from "node:events";
import path6 from "node:path";

// server/providers/geminiProvider.ts
import { execFile as execFile3 } from "node:child_process";
import fs2 from "node:fs/promises";
import path3 from "node:path";
import { GoogleGenAI, Type } from "@google/genai";
var WORKER_SCRIPT2 = path3.resolve(process.cwd(), "backend", "audio_worker.py");
var WINDOW_DURATION_SEC = 110;
var SINGLE_PASS_MAX_BYTES = 14 * 1024 * 1024;
var SINGLE_PASS_MAX_SEC = 125;
function getGeminiClient() {
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
}
function guessMime(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".flac")) return "audio/flac";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".webm")) return "audio/webm";
  return "audio/mpeg";
}
function isNonRetryableGeminiError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  const code = Number(err?.code || err?.statusCode || 0);
  const statusStr = String(err?.status || "").toUpperCase();
  if (msg.includes("gemini_api_key_not_configured") || msg.includes("permission_denied") || msg.includes("billing") || msg.includes("free tier") || msg.includes("api_key_invalid") || msg.includes("invalid_argument") || statusStr === "PERMISSION_DENIED" || statusStr === "UNAUTHENTICATED" || statusStr === "INVALID_ARGUMENT" || statusStr === "NOT_FOUND") {
    return true;
  }
  if (code === 400 || code === 401 || code === 403 || code === 404) {
    return true;
  }
  return false;
}
async function withRetry(fn, opts = {}) {
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 900;
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= maxRetries || isNonRetryableGeminiError(err)) {
        throw err;
      }
      const nextAttempt = attempt + 1;
      const errMsg = String(err?.message || err || "transient_error").slice(0, 180);
      await opts.onRetry?.(nextAttempt, maxRetries, errMsg);
      const jitter = Math.floor(Math.random() * 260);
      const waitMs = baseDelayMs * Math.pow(2, attempt) + jitter;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}
function sliceAudioWindowWithPython(audioPath, outWavPath, startSec, durationSec) {
  return new Promise((resolve, reject) => {
    const child = execFile3(
      "python3",
      [WORKER_SCRIPT2, "slice"],
      { maxBuffer: 5 * 1024 * 1024, timeout: 12e4 },
      (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(stderr?.trim() || err.message));
        }
        try {
          const parsed = JSON.parse(stdout || "{}");
          if (!parsed.ok) return reject(new Error(parsed.error || "slice_failed"));
          resolve({ slicePath: String(parsed.slicePath || outWavPath) });
        } catch (parseErr) {
          reject(new Error(`slice_json_error:${parseErr?.message}`));
        }
      }
    );
    child.stdin?.write(JSON.stringify({ audioPath, outWavPath, startSec, durationSec }));
    child.stdin?.end();
  });
}
function tokenizeLineDraft(text, lineStart, lineEnd, speaker) {
  const tokens = text.match(
    /[A-Za-zÀ-ÿ\u1e00-\u1eff0-9'’\-]+[,.;:!?…]?|[\u4e00-\u9fff\u3400-\u4dbf]|[\u3040-\u309f\u30a0-\u30ff][\u3041\u3043\u3045\u3047\u3049\u3063\u3083\u3085\u3087\u308e\u30a1\u30a3\u30a5\u30a7\u30a9\u30c3\u30e3\u30e5\u30e7\u30ee\u30fc]?|[\uac00-\ud7af]|[^\s]/g
  ) || [text];
  const dur = Math.max(0.2, lineEnd - lineStart);
  const step = dur / Math.max(1, tokens.length);
  return tokens.map((tk, i) => ({
    wordIndex: i,
    text: tk,
    start: +(lineStart + i * step).toFixed(3),
    end: +(lineStart + (i + 1) * step).toFixed(3),
    recognitionConfidence: 0.78,
    alignmentConfidence: 0.52,
    audioClarity: 0.72,
    vocalOverlap: 0.12,
    qualityTier: "MEDIUM",
    speaker,
    flags: ["uncertain_boundary"],
    provenance: "text_draft_estimate"
  }));
}
async function transcribeSingleWindow(params) {
  const rawBuf = await fs2.readFile(params.filePath);
  if (rawBuf.length > 18 * 1024 * 1024) {
    throw new Error("audio_window_exceeds_inline_gemini_limit");
  }
  const base64Audio = rawBuf.toString("base64");
  const mimeType = guessMime(params.filePath);
  const winDur = Math.max(0.5, params.windowDurationSec);
  const transcribeResp = await withRetry(
    () => params.ai.models.generateContent({
      model: "gemini-3.5-transcribe",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64Audio
            }
          },
          {
            text: `Transcribe the vocals/lyrics heard in this audio clip (clip duration: ${winDur.toFixed(2)}s, language hint: ${params.langHint || "auto"}). Keep original sung language(s) verbatim without translating. Mark unintelligible passages as [UNCLEAR] and instrumental-only sections as [INSTRUMENTAL]. Do not hallucinate lyrics.`
          }
        ]
      }
    }),
    { maxRetries: 3, baseDelayMs: 900, onRetry: params.onRetry }
  );
  const transcriptText = String(transcribeResp.text || "").trim();
  const structureResp = await withRetry(
    () => params.ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: [
        {
          inlineData: {
            mimeType,
            data: base64Audio
          }
        },
        {
          text: `Given this verbatim transcript and audio clip (clip duration ${winDur.toFixed(2)}s starting at 0.000s relative to this clip), organize it into chronological lyric lines with estimated phrase [start, end] seconds strictly within [0, ${winDur.toFixed(2)}].
Transcript:
${transcriptText || "[No clear lyrics detected]"}

Output strict JSON with language, detectedLanguages, detectedSpeakers, audioType ("singing"|"speech"|"instrumental"|"combination"), and lines.`
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            audioType: { type: Type.STRING },
            language: { type: Type.STRING },
            detectedLanguages: { type: Type.ARRAY, items: { type: Type.STRING } },
            detectedSpeakers: { type: Type.ARRAY, items: { type: Type.STRING } },
            title: { type: Type.STRING },
            artist: { type: Type.STRING },
            lines: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: { type: Type.STRING },
                  start: { type: Type.NUMBER },
                  end: { type: Type.NUMBER },
                  section: { type: Type.STRING },
                  vocalType: { type: Type.STRING },
                  language: { type: Type.STRING },
                  speaker: { type: Type.STRING },
                  recognitionConfidence: { type: Type.NUMBER }
                },
                required: ["text", "start", "end"]
              }
            }
          },
          required: ["audioType", "language", "lines"]
        }
      }
    }),
    { maxRetries: 3, baseDelayMs: 900, onRetry: params.onRetry }
  );
  const parsed = JSON.parse(structureResp.text || "{}");
  const rawLines = Array.isArray(parsed.lines) ? parsed.lines : [];
  const off = Math.max(0, params.windowStartSec);
  const absMax = Math.max(off + winDur, params.totalDurationSec || off + winDur);
  let prevEnd = off;
  const draftLines = rawLines.map((l, idx) => {
    const text = String(l?.text || "").trim();
    if (!text) return null;
    const relStart = Math.max(0, Math.min(winDur - 0.1, Number(l?.start) || 0));
    const relEnd = Math.max(relStart + 0.15, Math.min(winDur, Number(l?.end) || relStart + 2.4));
    const start = +Math.max(prevEnd, Math.min(absMax - 0.1, off + relStart)).toFixed(3);
    const end = +Math.max(start + 0.15, Math.min(absMax, off + relEnd)).toFixed(3);
    prevEnd = end;
    const speaker = String(l?.speaker || "Lead").trim() || "Lead";
    const recConf = Math.max(0.15, Math.min(0.95, Number(l?.recognitionConfidence) || 0.8));
    return {
      lineIndex: idx,
      text,
      start,
      end,
      section: String(l?.section || "verse").toLowerCase(),
      vocalType: String(l?.vocalType || "singing").toLowerCase(),
      language: String(l?.language || parsed.language || params.langHint || "auto"),
      speaker,
      recognitionConfidence: recConf,
      alignmentConfidence: 0.55,
      flags: /\[unclear/i.test(text) ? ["uncertain_word"] : ["uncertain_boundary"],
      provenance: "gemini_transcribe_plus_dsp",
      words: /^\[(?:instrumental|interlude)/i.test(text) ? [] : tokenizeLineDraft(text, start, end, speaker)
    };
  }).filter((x) => x !== null);
  return {
    transcriptText,
    language: String(parsed.language || params.langHint || "auto"),
    detectedLanguages: Array.isArray(parsed.detectedLanguages) ? parsed.detectedLanguages : [],
    detectedSpeakers: Array.isArray(parsed.detectedSpeakers) ? parsed.detectedSpeakers : ["Lead"],
    audioType: String(parsed.audioType || "singing"),
    title: parsed.title ? String(parsed.title) : void 0,
    artist: parsed.artist ? String(parsed.artist) : void 0,
    draftLines
  };
}
var GeminiSingingAsrProvider = class {
  constructor() {
    this.id = "google-genai:gemini-3.5-transcribe";
  }
  isConfigured() {
    return Boolean((process.env.GEMINI_API_KEY || "").trim());
  }
  async transcribe(params) {
    const ai2 = getGeminiClient();
    if (!ai2) {
      throw new Error("gemini_api_key_not_configured");
    }
    const activePath = params.vocalStemPath || params.audioPath;
    const stat = await fs2.stat(activePath);
    const totalDur = Math.max(1, params.durationSec || 1);
    if (totalDur <= SINGLE_PASS_MAX_SEC && stat.size <= SINGLE_PASS_MAX_BYTES) {
      await params.onProgress?.("Transcription Gemini (extrait direct)", 1, 1);
      const single = await transcribeSingleWindow({
        ai: ai2,
        filePath: activePath,
        windowStartSec: 0,
        windowDurationSec: totalDur,
        totalDurationSec: totalDur,
        langHint: params.langHint,
        onRetry: params.onRetry
      });
      return {
        ...single,
        engine: this.id
      };
    }
    const windows = [];
    let cursor = 0;
    while (cursor < totalDur) {
      const remaining = totalDur - cursor;
      if (remaining <= WINDOW_DURATION_SEC + 15) {
        windows.push({ startSec: cursor, durationSec: remaining });
        break;
      }
      windows.push({ startSec: cursor, durationSec: WINDOW_DURATION_SEC });
      cursor += WINDOW_DURATION_SEC;
    }
    const ownsTemp = !params.tempDir;
    const sliceDir = params.tempDir || await createSecureTempDir("gemwin");
    try {
      const allLines = [];
      const transcriptParts = [];
      const langSet = /* @__PURE__ */ new Set();
      const speakerSet = /* @__PURE__ */ new Set();
      let primaryLang = params.langHint || "auto";
      let audioType = "singing";
      let resolvedTitle;
      let resolvedArtist;
      for (let i = 0; i < windows.length; i++) {
        const win = windows[i];
        await params.onProgress?.(
          `Transcription Gemini fen\xEAtre ${i + 1}/${windows.length} (${win.startSec.toFixed(0)}s\u2013${(win.startSec + win.durationSec).toFixed(0)}s)`,
          i + 1,
          windows.length
        );
        const sliceOut = confinePath(sliceDir, `win_${i}.wav`);
        try {
          await sliceAudioWindowWithPython(activePath, sliceOut, win.startSec, win.durationSec);
          const partRes = await transcribeSingleWindow({
            ai: ai2,
            filePath: sliceOut,
            windowStartSec: win.startSec,
            windowDurationSec: win.durationSec,
            totalDurationSec: totalDur,
            langHint: params.langHint,
            onRetry: params.onRetry
          });
          if (partRes.transcriptText) transcriptParts.push(partRes.transcriptText);
          if (i === 0 && partRes.language && partRes.language !== "auto") {
            primaryLang = partRes.language;
          }
          if (partRes.audioType) audioType = partRes.audioType;
          if (!resolvedTitle && partRes.title) resolvedTitle = partRes.title;
          if (!resolvedArtist && partRes.artist) resolvedArtist = partRes.artist;
          partRes.detectedLanguages.forEach((l) => l && langSet.add(l));
          partRes.detectedSpeakers.forEach((s) => s && speakerSet.add(s));
          partRes.draftLines.forEach((ln) => {
            allLines.push({
              ...ln,
              lineIndex: allLines.length
            });
          });
        } finally {
          await fs2.unlink(sliceOut).catch(() => {
          });
        }
      }
      return {
        transcriptText: transcriptParts.join("\n"),
        language: primaryLang,
        detectedLanguages: Array.from(langSet),
        detectedSpeakers: speakerSet.size > 0 ? Array.from(speakerSet) : ["Lead"],
        audioType,
        title: resolvedTitle,
        artist: resolvedArtist,
        draftLines: allLines,
        engine: `${this.id}:windowed_${windows.length}x`
      };
    } finally {
      if (ownsTemp) {
        await removeTempPathSafe(sliceDir);
      }
    }
  }
};

// server/providers/pythonDspProvider.ts
import { execFile as execFile4 } from "node:child_process";
import fs3 from "node:fs/promises";
import path4 from "node:path";
var WORKER_SCRIPT3 = path4.resolve(process.cwd(), "backend", "audio_worker.py");
function runAudioWorker(command, payload) {
  return new Promise((resolve, reject) => {
    const child = execFile4(
      "python3",
      [WORKER_SCRIPT3, command],
      { maxBuffer: 25 * 1024 * 1024, timeout: 24e4 },
      (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(stderr?.trim() || err.message));
        }
        try {
          const parsed = JSON.parse(stdout || "{}");
          if (!parsed.ok) return reject(new Error(parsed.error || `worker_failed:${command}`));
          resolve(parsed);
        } catch (parseErr) {
          reject(new Error(`worker_invalid_json:${parseErr?.message}`));
        }
      }
    );
    child.stdin?.write(JSON.stringify(payload ?? {}));
    child.stdin?.end();
  });
}
var DspCenterVocalSeparator = class {
  constructor() {
    this.id = "dsp_center_bandpass";
    this.isNeural = false;
  }
  isConfigured() {
    return true;
  }
  async separate(audioPath, uploadId, tempDir) {
    const outWavPath = getStemOutputPath(uploadId, tempDir);
    const res = await runAudioWorker("separate", {
      audioPath,
      outWavPath
    });
    let stemBase64;
    try {
      const stat = await fs3.stat(res.stemPath);
      if (stat.size <= 14 * 1024 * 1024) {
        const buf = await fs3.readFile(res.stemPath);
        stemBase64 = buf.toString("base64");
      }
    } catch {
      stemBase64 = void 0;
    }
    return {
      stemPath: res.stemPath,
      stemBase64,
      engine: res.engine || this.id,
      isNeural: false
    };
  }
};
var DspAcousticForcedAligner = class {
  constructor() {
    this.id = "dsp_acoustic_viterbi";
    this.isNeuralPhonemeAligner = false;
  }
  isConfigured() {
    return true;
  }
  async align(params) {
    const targetAudio = params.vocalStemPath || params.audioPath;
    const res = await runAudioWorker("align", {
      audioPath: targetAudio,
      lines: params.lines.map((l) => ({
        text: l.text,
        start: l.start,
        end: l.end,
        words: l.words
      }))
    });
    const mergedLines = params.lines.map((orig, idx) => {
      const hit = res.alignedLines.find((al) => al.index === idx);
      if (!hit || !Array.isArray(hit.words) || hit.words.length === 0) {
        return orig;
      }
      const words = hit.words.map((w, wi) => {
        const prevW = orig.words[wi];
        const recConf = prevW ? Math.min(prevW.recognitionConfidence, w.recognitionConfidence) : w.recognitionConfidence;
        return {
          wordIndex: wi,
          text: w.text,
          start: w.start,
          end: w.end,
          recognitionConfidence: recConf,
          alignmentConfidence: w.alignmentConfidence,
          audioClarity: w.audioClarity,
          vocalOverlap: w.vocalOverlap,
          qualityTier: w.qualityTier,
          speaker: prevW?.speaker || orig.speaker || "Lead",
          flags: Array.from(/* @__PURE__ */ new Set([...prevW?.flags || [], ...w.flags || []])),
          phonemes: prevW?.phonemes,
          chars: prevW?.chars,
          provenance: "dsp_acoustic_viterbi"
        };
      });
      return {
        ...orig,
        lineIndex: idx,
        provenance: "dsp_acoustic_viterbi",
        alignmentConfidence: words.reduce((a, b) => a + b.alignmentConfidence, 0) / Math.max(1, words.length),
        words
      };
    });
    return {
      lines: mergedLines,
      waveformPeaks: res.waveformPeaks,
      vocalSegments: res.vocalSegments,
      durationSec: res.durationSec,
      provenance: "dsp_acoustic_viterbi",
      engine: this.id,
      isNeuralPhonemeAligner: false
    };
  }
};
var AcousticConfidenceValidator = class {
  validateAndSummarize(lines) {
    let totalWords = 0;
    let highConfidenceWords = 0;
    let mediumConfidenceWords = 0;
    let lowConfidenceWords = 0;
    let uncertainWords = 0;
    let missingWords = 0;
    let misrecognizedWords = 0;
    let overlappingWords = 0;
    let uncertainBoundaries = 0;
    const validated = lines.map((ln, lIdx) => {
      const safeStart = Math.max(0, Number(ln.start) || 0);
      const safeEnd = Math.max(safeStart + 0.05, Number(ln.end) || safeStart + 1.5);
      const words = (ln.words || []).map((w, wIdx) => {
        totalWords++;
        const f = new Set(w.flags || []);
        if (w.recognitionConfidence < 0.72) f.add("uncertain_word");
        if (w.alignmentConfidence < 0.68) f.add("uncertain_boundary");
        if (w.vocalOverlap > 0.42) f.add("overlapping_vocals");
        if (f.has("uncertain_word")) uncertainWords++;
        if (f.has("missing_word")) missingWords++;
        if (f.has("misrecognized_word")) misrecognizedWords++;
        if (f.has("overlapping_vocals")) overlappingWords++;
        if (f.has("uncertain_boundary")) uncertainBoundaries++;
        const cap = w.provenance === "human_verified" ? 1 : w.provenance === "external_forced_aligner" ? 0.96 : 0.89;
        const alignConf = Math.min(cap, Math.max(0.05, Number(w.alignmentConfidence) || 0.6));
        const recConf = Math.min(0.96, Math.max(0.05, Number(w.recognitionConfidence) || 0.75));
        const overall = 0.42 * recConf + 0.38 * alignConf + 0.2 * (w.audioClarity || 0.7);
        let tier = "MEDIUM";
        if (overall >= 0.78 && !f.has("uncertain_word") && !f.has("uncertain_boundary") && w.vocalOverlap <= 0.35) {
          tier = "HIGH";
          highConfidenceWords++;
        } else if (overall < 0.58 || f.has("misrecognized_word") || w.audioClarity < 0.45) {
          tier = "LOW";
          lowConfidenceWords++;
        } else {
          mediumConfidenceWords++;
        }
        return {
          ...w,
          wordIndex: wIdx,
          start: +Math.max(safeStart, w.start).toFixed(3),
          end: +Math.min(safeEnd, Math.max(w.start + 0.02, w.end)).toFixed(3),
          recognitionConfidence: +recConf.toFixed(3),
          alignmentConfidence: +alignConf.toFixed(3),
          qualityTier: tier,
          flags: Array.from(f)
        };
      });
      return {
        ...ln,
        lineIndex: lIdx,
        start: +safeStart.toFixed(3),
        end: +safeEnd.toFixed(3),
        words
      };
    });
    return {
      lines: validated,
      summary: {
        totalWords,
        highConfidenceWords,
        mediumConfidenceWords,
        lowConfidenceWords,
        uncertainWords,
        missingWords,
        misrecognizedWords,
        overlappingWords,
        uncertainBoundaries
      }
    };
  }
};

// server/providers/externalAdapters.ts
import fs4 from "node:fs/promises";
import path5 from "node:path";
function validateExternalHttpsUrl(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "https:") return null;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h === "::1" || h.endsWith(".local") || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h)) {
      return null;
    }
    return u.toString();
  } catch {
    return null;
  }
}
var ExternalVocalSeparationAdapter = class {
  constructor() {
    this.id = "external_vocal_separator";
    this.isNeural = true;
  }
  get endpoint() {
    return validateExternalHttpsUrl(process.env.VOCAL_SEPARATION_ENDPOINT);
  }
  isConfigured() {
    return Boolean(this.endpoint);
  }
  async separate(audioPath, uploadId, tempDir) {
    const url = this.endpoint;
    if (!url) throw new Error("external_vocal_separation_not_configured");
    const audioBuf = await fs4.readFile(audioPath);
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: path5.basename(audioPath),
        audioBase64: audioBuf.toString("base64")
      }),
      signal: AbortSignal.timeout(12e4)
    });
    if (!resp.ok) throw new Error(`external_vocal_separation_http_${resp.status}`);
    const data = await resp.json();
    if (!data?.stemBase64) throw new Error("external_vocal_separation_missing_stem");
    const stemPath = getStemOutputPath(uploadId, tempDir);
    await fs4.writeFile(stemPath, Buffer.from(String(data.stemBase64), "base64"), { mode: 384 });
    return {
      stemPath,
      stemBase64: String(data.stemBase64),
      engine: String(data.model || this.id),
      isNeural: true
    };
  }
};
var ExternalSingingAsrAdapter = class {
  constructor() {
    this.id = "external_singing_asr";
  }
  get endpoint() {
    return validateExternalHttpsUrl(process.env.SINGING_ASR_ENDPOINT);
  }
  isConfigured() {
    return Boolean(this.endpoint);
  }
  async transcribe(params) {
    const url = this.endpoint;
    if (!url) throw new Error("external_singing_asr_not_configured");
    const activePath = params.vocalStemPath || params.audioPath;
    const buf = await fs4.readFile(activePath);
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lang: params.langHint,
        durationSec: params.durationSec,
        audioBase64: buf.toString("base64")
      }),
      signal: AbortSignal.timeout(12e4)
    });
    if (!resp.ok) throw new Error(`external_singing_asr_http_${resp.status}`);
    const data = await resp.json();
    return {
      transcriptText: String(data.transcriptText || ""),
      language: String(data.language || params.langHint || "auto"),
      detectedLanguages: Array.isArray(data.detectedLanguages) ? data.detectedLanguages : [],
      detectedSpeakers: Array.isArray(data.detectedSpeakers) ? data.detectedSpeakers : ["Lead"],
      audioType: String(data.audioType || "singing"),
      draftLines: Array.isArray(data.lines) ? data.lines : [],
      engine: String(data.model || this.id)
    };
  }
};
var ExternalForcedAlignmentAdapter = class {
  constructor() {
    this.id = "external_forced_aligner";
    this.isNeuralPhonemeAligner = true;
  }
  get endpoint() {
    return validateExternalHttpsUrl(process.env.FORCED_ALIGNMENT_ENDPOINT);
  }
  isConfigured() {
    return Boolean(this.endpoint);
  }
  async align(params) {
    const url = this.endpoint;
    if (!url) throw new Error("external_forced_alignment_not_configured");
    const activePath = params.vocalStemPath || params.audioPath;
    const buf = await fs4.readFile(activePath);
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lang: params.langHint,
        audioBase64: buf.toString("base64"),
        lines: params.lines.map((l) => ({
          text: l.text,
          start: l.start,
          end: l.end
        }))
      }),
      signal: AbortSignal.timeout(12e4)
    });
    if (!resp.ok) throw new Error(`external_forced_alignment_http_${resp.status}`);
    const data = await resp.json();
    const lines = Array.isArray(data.lines) ? data.lines.map((ln, idx) => ({
      ...ln,
      lineIndex: idx,
      provenance: "external_forced_aligner"
    })) : params.lines;
    return {
      lines,
      provenance: "external_forced_aligner",
      engine: String(data.model || this.id),
      isNeuralPhonemeAligner: true
    };
  }
};

// server/jobs/jobQueue.ts
var MAX_CONCURRENT_JOBS = 2;
var MAX_STAGE_RETRIES = 2;
var jobEvents = new EventEmitter();
jobEvents.setMaxListeners(100);
var extSeparator = new ExternalVocalSeparationAdapter();
var extAsr = new ExternalSingingAsrAdapter();
var extAligner = new ExternalForcedAlignmentAdapter();
var dspSeparator = new DspCenterVocalSeparator();
var dspAligner = new DspAcousticForcedAligner();
var geminiAsr = new GeminiSingingAsrProvider();
var confidenceValidator = new AcousticConfidenceValidator();
var pendingQueue = [];
var activeJobIds = /* @__PURE__ */ new Set();
function drainQueue() {
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
async function getPipelineCapabilities() {
  const tools = await checkWorkerTools();
  const geminiConfigured = geminiAsr.isConfigured();
  const sepExt = extSeparator.isConfigured();
  const asrExt = extAsr.isConfigured();
  const alignExt = extAligner.isConfigured();
  return {
    runtime: "node-express+python-worker",
    pythonAvailable: tools.pythonAvailable,
    ffmpegAvailable: tools.ffmpegAvailable,
    geminiConfigured,
    geminiAudioModel: "gemini-3.5-transcribe",
    geminiReasoningModel: "gemini-4-hydrogen",
    maxUploadBytes: MAX_UPLOAD_BYTES,
    recommendedChunkBytes: RECOMMENDED_CHUNK_BYTES,
    maxConcurrentJobs: MAX_CONCURRENT_JOBS,
    providers: {
      audioUnderstanding: {
        active: geminiConfigured ? "google-genai:gemini-3.5-transcribe+gemini-4-hydrogen" : "not_configured",
        status: geminiConfigured ? "active" : "not_configured",
        guaranteesExactWordForcedAlignment: false,
        note: "Google Gemini handles multilingual audio understanding & draft transcription (chunked cleanly for long songs); exact singing word timestamps are delegated to specialized aligner adapters."
      },
      vocalSeparation: {
        active: sepExt ? "external_vocal_separator" : "dsp_center_bandpass",
        status: sepExt ? "active_external_neural" : "active_dsp_fallback",
        externalConfigured: sepExt,
        isNeural: sepExt,
        note: sepExt ? "External neural source-separation model endpoint connected via VOCAL_SEPARATION_ENDPOINT." : "Using streaming Python/ffmpeg Mid-Side bandpass DSP stem extraction into isolated temporary folders; attach VOCAL_SEPARATION_ENDPOINT for neural Demucs/RoFormer stems."
      },
      singingAsr: {
        active: asrExt ? "external_singing_asr" : geminiConfigured ? "google-genai:gemini-3.5-transcribe" : "not_configured",
        status: asrExt ? "active_external_model" : geminiConfigured ? "active_gemini_transcribe" : "not_configured",
        externalConfigured: asrExt,
        note: asrExt ? "External singing-aware ASR endpoint connected via SINGING_ASR_ENDPOINT." : geminiConfigured ? "Using Google Gemini (gemini-3.5-transcribe) with automatic retries and long-song window slicing; attach SINGING_ASR_ENDPOINT for specialized singing-ASR models." : "No GEMINI_API_KEY or SINGING_ASR_ENDPOINT configured; submit manual lyrics text to align acoustically."
      },
      forcedAlignment: {
        active: alignExt ? "external_forced_aligner" : "dsp_acoustic_viterbi",
        status: alignExt ? "active_external_aligner" : "active_dsp_viterbi",
        externalConfigured: alignExt,
        isNeuralPhonemeAligner: alignExt,
        note: alignExt ? "External phoneme/word forced aligner endpoint connected via FORCED_ALIGNMENT_ENDPOINT." : "Using constant-memory 100 Hz Python vocal-envelope & consonant-attack DP aligner (provenance: dsp_acoustic_viterbi); attach FORCED_ALIGNMENT_ENDPOINT for MFA/WhisperX."
      }
    }
  };
}
function buildLinesFromManualLyrics(lyricsText, durationSec, lang) {
  const cleanLines = lyricsText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (cleanLines.length === 0) return [];
  const totalDur = Math.max(2, durationSec || cleanLines.length * 3);
  const step = totalDur / cleanLines.length;
  return cleanLines.map((text, idx) => {
    const start = +(idx * step).toFixed(3);
    const end = +((idx + 1) * step).toFixed(3);
    const toks = text.match(
      /[A-Za-zÀ-ÿ\u1e00-\u1eff0-9'’\-]+[,.;:!?…]?|[\u4e00-\u9fff\u3400-\u4dbf]|[\u3040-\u309f\u30a0-\u30ff][\u3041\u3043\u3045\u3047\u3049\u3063\u3083\u3085\u3087\u308e\u30a1\u30a3\u30a5\u30a7\u30a9\u30c3\u30e3\u30e5\u30e7\u30ee\u30fc]?|[\uac00-\ud7af]|[^\s]/g
    ) || [text];
    const wStep = (end - start) / Math.max(1, toks.length);
    return {
      lineIndex: idx,
      text,
      start,
      end,
      section: "verse",
      vocalType: /^\[(?:instrumental|interlude)/i.test(text) ? "instrumental" : "singing",
      language: lang || "auto",
      speaker: "Lead",
      recognitionConfidence: 0.94,
      alignmentConfidence: 0.55,
      flags: ["uncertain_boundary"],
      provenance: "text_draft_estimate",
      words: toks.map((tk, wi) => ({
        wordIndex: wi,
        text: tk,
        start: +(start + wi * wStep).toFixed(3),
        end: +(start + (wi + 1) * wStep).toFixed(3),
        recognitionConfidence: 0.94,
        alignmentConfidence: 0.55,
        audioClarity: 0.72,
        vocalOverlap: 0.1,
        qualityTier: "MEDIUM",
        speaker: "Lead",
        flags: ["uncertain_boundary"],
        provenance: "text_draft_estimate"
      }))
    };
  });
}
function isNonRetryableStageError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("upload_not_found") || msg.includes("no_lyrics_provided_and_no_asr_configured") || msg.includes("gemini_api_key_not_configured") || msg.includes("permission_denied") || msg.includes("billing") || msg.includes("invalid_audio") || msg.includes("unsupported_audio") || msg.includes("http_400") || msg.includes("http_401") || msg.includes("http_403") || msg.includes("http_404");
}
async function withStageRetry(fn, onRetry) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_STAGE_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= MAX_STAGE_RETRIES || isNonRetryableStageError(err)) {
        throw err;
      }
      const next = attempt + 1;
      await onRetry(next, String(err?.message || err || "transient_error").slice(0, 140));
      const delayMs = 700 * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}
function computeAnalysisCacheKey(params) {
  const lyricsHash = crypto2.createHash("sha256").update(params.lyricsText.trim()).digest("hex");
  const paramsJson = JSON.stringify({
    lang: params.lang || "auto",
    enableSeparation: params.enableSeparation,
    useGeminiAsr: params.useGeminiAsr,
    lyricsHash,
    sepEngine: params.sepEngine,
    asrEngine: params.asrEngine,
    alignEngine: params.alignEngine,
    v: 2
  });
  const paramsHash = crypto2.createHash("sha256").update(paramsJson).digest("hex");
  const cacheKey = crypto2.createHash("sha256").update(`${params.audioSha256}:${paramsHash}`).digest("hex");
  return { cacheKey, paramsHash };
}
async function emitJobUpdate(job) {
  const saved = await timestampStore.saveJob(job);
  const enriched = {
    ...saved,
    stageDetail: job.stageDetail,
    windowProgress: job.windowProgress
  };
  jobEvents.emit(`job:${enriched.id}`, enriched);
  jobEvents.emit("global", enriched);
  return enriched;
}
async function listRecentJobs(limit = 25) {
  return timestampStore.listJobs(limit);
}
async function enqueuePipelineJob(input) {
  const safeUpload = await getSafeUploadAudioPath(input.uploadId);
  if (!safeUpload) {
    throw new Error("upload_not_found");
  }
  const caps = await getPipelineCapabilities();
  const jobId = `job_${crypto2.randomUUID().replace(/-/g, "").slice(0, 14)}`;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const requestParams = {
    songId: input.songId || null,
    title: input.title || "",
    artist: input.artist || "",
    lang: input.lang || "auto",
    lyricsText: input.lyricsText || "",
    enableSeparation: input.enableSeparation !== false,
    useGeminiAsr: input.useGeminiAsr !== false,
    bypassCache: Boolean(input.bypassCache)
  };
  const initial = {
    id: jobId,
    uploadId: safeUpload.record.id,
    songId: input.songId || null,
    status: "queued",
    stage: "queued",
    progress: 5,
    lang: input.lang || "auto",
    mode: "modular_pipeline_v2",
    retryCount: 0,
    cachedHit: false,
    stageDetail: activeJobIds.size >= MAX_CONCURRENT_JOBS ? `En attente (${pendingQueue.length + 1} en file)` : "Initialisation du worker asynchrone",
    requestParams,
    capabilities: caps,
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now
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
      bypassCache: Boolean(input.bypassCache)
    }
  });
  drainQueue();
  return initial;
}
async function retryPipelineJob(jobId) {
  const prev = await timestampStore.getJob(jobId);
  if (!prev) {
    throw new Error("job_not_found");
  }
  const safeUpload = await getSafeUploadAudioPath(prev.uploadId);
  if (!safeUpload) {
    throw new Error("upload_not_found");
  }
  const rp = prev.requestParams || {};
  const caps = await getPipelineCapabilities();
  const nextRetry = (prev.retryCount || 0) + 1;
  const resetJob = {
    ...prev,
    status: "queued",
    stage: "queued",
    progress: 5,
    retryCount: nextRetry,
    cachedHit: false,
    stageDetail: `Relance manuelle (tentative #${nextRetry})`,
    capabilities: caps,
    result: null,
    error: null,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  await emitJobUpdate(resetJob);
  pendingQueue.push({
    job: resetJob,
    ctx: {
      audioPath: safeUpload.filePath,
      uploadDurationSec: safeUpload.record.durationSec,
      uploadFilename: safeUpload.record.filename,
      uploadSha256: safeUpload.record.sha256,
      songId: rp.songId || prev.songId || void 0,
      title: rp.title || void 0,
      artist: rp.artist || void 0,
      lang: rp.lang || prev.lang || "auto",
      lyricsText: typeof rp.lyricsText === "string" ? rp.lyricsText : void 0,
      enableSeparation: rp.enableSeparation !== false,
      useGeminiAsr: rp.useGeminiAsr !== false,
      bypassCache: Boolean(rp.bypassCache)
    }
  });
  drainQueue();
  return resetJob;
}
async function processPipelineJob(job, ctx) {
  let current = { ...job, status: "running" };
  let jobTempDir = null;
  try {
    current = await emitJobUpdate({
      ...current,
      stage: "validating_audio",
      progress: 12,
      stageDetail: "V\xE9rification de l\u2019audio original et du cache d\u2019analyse"
    });
    const manualHint = (ctx.lyricsText || "").trim();
    const sepProviderId = ctx.enableSeparation === false ? "skipped" : extSeparator.isConfigured() ? extSeparator.id : dspSeparator.id;
    const asrProviderId = extAsr.isConfigured() && (!manualHint || ctx.useGeminiAsr !== false) ? extAsr.id : !manualHint && geminiAsr.isConfigured() && ctx.useGeminiAsr !== false ? geminiAsr.id : "manual_lyrics";
    const alignProviderId = extAligner.isConfigured() ? extAligner.id : dspAligner.id;
    const { cacheKey, paramsHash } = computeAnalysisCacheKey({
      audioSha256: ctx.uploadSha256,
      lang: ctx.lang || "auto",
      enableSeparation: ctx.enableSeparation !== false,
      useGeminiAsr: ctx.useGeminiAsr !== false,
      lyricsText: manualHint,
      sepEngine: sepProviderId,
      asrEngine: asrProviderId,
      alignEngine: alignProviderId
    });
    const timelineIntegrity = {
      preservesOriginalAudio: true,
      timelineOriginSec: 0,
      originalDurationSec: ctx.uploadDurationSec,
      originalSha256: ctx.uploadSha256,
      originalFilename: ctx.uploadFilename
    };
    if (!ctx.bypassCache && ctx.uploadSha256) {
      const cached = await timestampStore.getCachedAnalysis(cacheKey);
      if (cached?.result) {
        const songId2 = ctx.songId || `song_${crypto2.randomUUID().replace(/-/g, "").slice(0, 12)}`;
        const resolvedTitle2 = ctx.title || cached.result.title || path6.basename(ctx.uploadFilename, path6.extname(ctx.uploadFilename));
        const clonedSong = await timestampStore.saveSongTimestamps({
          ...cached.result,
          songId: songId2,
          uploadId: job.uploadId,
          title: resolvedTitle2,
          artist: ctx.artist ?? cached.result.artist ?? "",
          provenance: {
            ...cached.result.provenance,
            cached: true,
            cacheHits: cached.hitCount,
            timelineIntegrity
          }
        });
        await emitJobUpdate({
          ...current,
          songId: songId2,
          status: "completed",
          stage: "completed",
          progress: 100,
          cachedHit: true,
          stageDetail: `R\xE9sultat servi instantan\xE9ment depuis le cache (${cached.hitCount}\xD7)`,
          result: clonedSong,
          error: null
        });
        return;
      }
    }
    jobTempDir = await createSecureTempDir(`job_${job.id}`);
    let vocalStemPath;
    let separationEngine = "skipped";
    let separationIsNeural = false;
    if (ctx.enableSeparation !== false) {
      current = await emitJobUpdate({
        ...current,
        stage: "separating_vocals",
        progress: 26,
        stageDetail: "Isolation du canal vocal dans dossier temporaire s\xE9curis\xE9"
      });
      const sep = await withStageRetry(
        () => extSeparator.isConfigured() ? extSeparator.separate(ctx.audioPath, job.uploadId, jobTempDir || void 0) : dspSeparator.separate(ctx.audioPath, job.uploadId, jobTempDir || void 0),
        async (attempt, errMsg) => {
          current = await emitJobUpdate({
            ...current,
            retryCount: (current.retryCount || 0) + 1,
            stageDetail: `Nouvelle tentative s\xE9paration (${attempt}/${MAX_STAGE_RETRIES}): ${errMsg}`
          });
        }
      );
      vocalStemPath = sep.stemPath;
      separationEngine = sep.engine;
      separationIsNeural = sep.isNeural;
    }
    current = await emitJobUpdate({
      ...current,
      stage: "transcribing_lyrics",
      progress: 48,
      stageDetail: manualHint ? "Pr\xE9paration des paroles de r\xE9f\xE9rence fournies" : "Analyse vocale et transcription multilingue"
    });
    let draftLines = [];
    let asrEngine = "manual_lyrics";
    let detectedLanguages = ctx.lang && ctx.lang !== "auto" ? [ctx.lang] : [];
    let detectedLanguage = ctx.lang || "auto";
    let audioType = "singing";
    let resolvedTitle = ctx.title || path6.basename(ctx.uploadFilename, path6.extname(ctx.uploadFilename));
    let resolvedArtist = ctx.artist || "";
    if (extAsr.isConfigured() && (!manualHint || ctx.useGeminiAsr !== false)) {
      const asr = await withStageRetry(
        () => extAsr.transcribe({
          audioPath: ctx.audioPath,
          vocalStemPath,
          langHint: ctx.lang || "auto",
          durationSec: ctx.uploadDurationSec
        }),
        async (attempt, errMsg) => {
          current = await emitJobUpdate({
            ...current,
            retryCount: (current.retryCount || 0) + 1,
            stageDetail: `Nouvelle tentative ASR (${attempt}/${MAX_STAGE_RETRIES}): ${errMsg}`
          });
        }
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
        langHint: ctx.lang || "auto",
        durationSec: ctx.uploadDurationSec,
        tempDir: jobTempDir || void 0,
        onProgress: async (detail, curWin, totalWin) => {
          const frac = totalWin && totalWin > 0 ? Math.max(0, (curWin || 1) - 1) / totalWin * 18 : 0;
          current = await emitJobUpdate({
            ...current,
            stage: "transcribing_lyrics",
            progress: Math.min(68, Math.round(48 + frac)),
            stageDetail: detail,
            windowProgress: curWin && totalWin ? { current: curWin, total: totalWin } : void 0
          });
        },
        onRetry: async (attempt, maxRetries, errMsg) => {
          current = await emitJobUpdate({
            ...current,
            retryCount: (current.retryCount || 0) + 1,
            stageDetail: `Backoff Gemini (${attempt}/${maxRetries}): ${errMsg}`
          });
        }
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
        ctx.lang || "auto"
      );
    } else {
      throw new Error("no_lyrics_provided_and_no_asr_configured");
    }
    current = await emitJobUpdate({
      ...current,
      stage: "aligning_timestamps",
      progress: 74,
      windowProgress: void 0,
      stageDetail: "Alignement temporel mot par mot sur la timeline originale"
    });
    const alignRes = await withStageRetry(
      () => extAligner.isConfigured() ? extAligner.align({
        audioPath: ctx.audioPath,
        vocalStemPath,
        lines: draftLines,
        langHint: detectedLanguage
      }) : dspAligner.align({
        audioPath: ctx.audioPath,
        vocalStemPath,
        lines: draftLines,
        langHint: detectedLanguage
      }),
      async (attempt, errMsg) => {
        current = await emitJobUpdate({
          ...current,
          retryCount: (current.retryCount || 0) + 1,
          stageDetail: `Nouvelle tentative alignement (${attempt}/${MAX_STAGE_RETRIES}): ${errMsg}`
        });
      }
    );
    current = await emitJobUpdate({
      ...current,
      stage: "validating_confidence",
      progress: 88,
      stageDetail: "Validation acoustique et calibration des niveaux de confiance"
    });
    const { lines: validatedLines, summary } = confidenceValidator.validateAndSummarize(
      alignRes.lines
    );
    current = await emitJobUpdate({
      ...current,
      stage: "persisting",
      progress: 94,
      stageDetail: "Sauvegarde SQLite et mise en cache de l\u2019analyse"
    });
    const songId = ctx.songId || `song_${crypto2.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const songRecord = await timestampStore.saveSongTimestamps({
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
        timelineIntegrity
      },
      validationSummary: summary,
      lines: validatedLines
    });
    await timestampStore.saveCachedAnalysis({
      cacheKey,
      audioSha256: ctx.uploadSha256,
      paramsHash,
      songId,
      result: songRecord
    }).catch(() => {
    });
    await emitJobUpdate({
      ...current,
      songId,
      status: "completed",
      stage: "completed",
      progress: 100,
      cachedHit: false,
      stageDetail: `Pipeline termin\xE9 (${validatedLines.length} lignes \xB7 audio original intact)`,
      result: songRecord,
      error: null
    });
  } catch (err) {
    await emitJobUpdate({
      ...current,
      status: "failed",
      stage: "error",
      progress: 100,
      stageDetail: "\xC9chec du pipeline \u2014 vous pouvez relancer sans r\xE9-importer l\u2019audio",
      error: String(err?.message || err || "pipeline_error").slice(0, 300)
    });
  } finally {
    if (jobTempDir) {
      await removeTempPathSafe(jobTempDir);
    }
  }
}

// server/routes/pipelineRoutes.ts
var validator = new AcousticConfidenceValidator();
function decodeHeaderFilename(rawHeader, fallback = "audio.wav") {
  const raw = String(rawHeader || fallback);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
function createPipelineRouter() {
  const router = express.Router();
  startTempCleanupScheduler();
  router.get("/capabilities", async (_req, res) => {
    try {
      const capabilities = await getPipelineCapabilities();
      res.json({ success: true, capabilities });
    } catch (err) {
      res.status(500).json({ success: false, error: err?.message || "capabilities_error" });
    }
  });
  router.post("/uploads/init", async (req, res) => {
    try {
      const { filename, mimeType, expectedBytes } = req.body || {};
      const session = await initChunkedUploadSession({
        filename: String(filename || "track.wav"),
        mimeType: mimeType ? String(mimeType) : void 0,
        expectedBytes: expectedBytes !== void 0 ? Number(expectedBytes) : 0
      });
      res.status(201).json({
        success: true,
        session,
        maxUploadBytes: MAX_UPLOAD_BYTES,
        recommendedChunkBytes: RECOMMENDED_CHUNK_BYTES
      });
    } catch (err) {
      const msg = String(err?.message || "upload_init_failed");
      const status = msg.startsWith("invalid_") || msg.startsWith("unsupported_") ? 400 : 500;
      res.status(status).json({ success: false, error: msg });
    }
  });
  router.put(
    "/uploads/:sessionId/chunk",
    express.raw({
      type: "*/*",
      limit: "16mb"
    }),
    async (req, res) => {
      try {
        const rawBuf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        const chunkIndexHeader = req.headers["x-chunk-index"];
        const chunkIndex = chunkIndexHeader !== void 0 ? Number(chunkIndexHeader) : void 0;
        const result = await appendUploadChunk(req.params.sessionId, rawBuf, chunkIndex);
        res.json({ success: true, ...result });
      } catch (err) {
        const msg = String(err?.message || "chunk_upload_failed");
        const status = msg === "upload_session_not_found" ? 404 : msg.startsWith("invalid_") || msg === "empty_chunk" ? 400 : 500;
        res.status(status).json({ success: false, error: msg });
      }
    }
  );
  router.post("/uploads/:sessionId/complete", async (req, res) => {
    try {
      const upload = await finalizeChunkedUploadSession(req.params.sessionId);
      res.status(201).json({
        success: true,
        upload,
        deduplicated: Boolean(upload.deduplicated)
      });
    } catch (err) {
      const msg = String(err?.message || "upload_finalize_failed");
      const status = msg === "upload_session_not_found" ? 404 : msg.startsWith("invalid_") || msg.startsWith("unsupported_") ? 400 : 500;
      res.status(status).json({ success: false, error: msg });
    }
  });
  router.post("/uploads/stream", async (req, res) => {
    try {
      const decodedName = decodeHeaderFilename(req.headers["x-file-name"], "audio.wav");
      const upload = await saveValidatedStreamUpload({
        stream: req,
        originalFilename: decodedName,
        declaredMime: String(req.headers["content-type"] || "")
      });
      res.status(201).json({
        success: true,
        upload,
        deduplicated: Boolean(upload.deduplicated)
      });
    } catch (err) {
      const msg = String(err?.message || "stream_upload_failed");
      const status = msg.startsWith("invalid_") || msg.startsWith("unsupported_") ? 400 : 500;
      res.status(status).json({ success: false, error: msg });
    }
  });
  router.post(
    "/uploads/raw",
    express.raw({
      type: ["application/octet-stream", "audio/*"],
      limit: "36mb"
    }),
    async (req, res) => {
      try {
        const rawBuf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        const decodedName = decodeHeaderFilename(req.headers["x-file-name"], "audio.wav");
        const upload = await saveValidatedUpload({
          buffer: rawBuf,
          originalFilename: decodedName,
          declaredMime: String(req.headers["content-type"] || "")
        });
        res.status(201).json({
          success: true,
          upload,
          deduplicated: Boolean(upload.deduplicated)
        });
      } catch (err) {
        const msg = String(err?.message || "upload_failed");
        const status = msg.startsWith("invalid_") || msg.startsWith("unsupported_") ? 400 : 500;
        res.status(status).json({ success: false, error: msg });
      }
    }
  );
  router.post("/uploads", async (req, res) => {
    try {
      const { filename, mimeType, audioBase64 } = req.body || {};
      if (!audioBase64 || typeof audioBase64 !== "string") {
        return res.status(400).json({ success: false, error: "missing_audio_payload" });
      }
      const cleanB64 = audioBase64.includes(",") ? audioBase64.split(",").pop() || "" : audioBase64;
      const buf = Buffer.from(cleanB64, "base64");
      const upload = await saveValidatedUpload({
        buffer: buf,
        originalFilename: String(filename || "track.wav"),
        declaredMime: String(mimeType || "")
      });
      res.status(201).json({
        success: true,
        upload,
        deduplicated: Boolean(upload.deduplicated)
      });
    } catch (err) {
      const msg = String(err?.message || "upload_failed");
      const status = msg.startsWith("invalid_") || msg.startsWith("unsupported_") ? 400 : 500;
      res.status(status).json({ success: false, error: msg });
    }
  });
  router.get("/uploads/:uploadId", async (req, res) => {
    try {
      const hit = await getSafeUploadAudioPath(req.params.uploadId);
      if (!hit) return res.status(404).json({ success: false, error: "upload_not_found" });
      res.json({ success: true, upload: hit.record });
    } catch (err) {
      res.status(500).json({ success: false, error: err?.message || "upload_lookup_failed" });
    }
  });
  router.get("/uploads/:uploadId/audio", async (req, res) => {
    try {
      const hit = await getSafeUploadAudioPath(req.params.uploadId);
      if (!hit) return res.status(404).json({ success: false, error: "upload_not_found" });
      const stat = fs5.statSync(hit.filePath);
      const total = stat.size;
      const range = req.headers.range;
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Type", hit.record.mimeType || "audio/mpeg");
      if (range && range.startsWith("bytes=")) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = Math.max(0, parseInt(parts[0], 10) || 0);
        const end = parts[1] ? Math.min(total - 1, parseInt(parts[1], 10)) : total - 1;
        if (start >= total || end < start) {
          res.status(416).setHeader("Content-Range", `bytes */${total}`).end();
          return;
        }
        res.status(206);
        res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
        res.setHeader("Content-Length", String(end - start + 1));
        fs5.createReadStream(hit.filePath, { start, end }).pipe(res);
      } else {
        res.setHeader("Content-Length", String(total));
        fs5.createReadStream(hit.filePath).pipe(res);
      }
    } catch (err) {
      res.status(500).json({ success: false, error: err?.message || "audio_stream_error" });
    }
  });
  router.post("/jobs", async (req, res) => {
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
        bypassCache
      } = req.body || {};
      if (!uploadId || typeof uploadId !== "string") {
        return res.status(400).json({ success: false, error: "missing_upload_id" });
      }
      const job = await enqueuePipelineJob({
        uploadId,
        songId: songId ? String(songId) : void 0,
        title: title ? String(title) : void 0,
        artist: artist ? String(artist) : void 0,
        lang: lang ? String(lang) : "auto",
        lyricsText: typeof lyricsText === "string" ? lyricsText : void 0,
        enableSeparation: enableSeparation !== false,
        useGeminiAsr: useGeminiAsr !== false,
        bypassCache: Boolean(bypassCache)
      });
      res.status(202).json({ success: true, job });
    } catch (err) {
      const msg = String(err?.message || "job_create_failed");
      res.status(msg === "upload_not_found" ? 404 : 500).json({ success: false, error: msg });
    }
  });
  router.get("/jobs", async (_req, res) => {
    try {
      const jobs = await listRecentJobs(25);
      res.json({ success: true, jobs });
    } catch (err) {
      res.status(500).json({ success: false, error: err?.message || "jobs_list_failed" });
    }
  });
  router.get("/jobs/events", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    const snapshot = await listRecentJobs(12).catch(() => []);
    for (const j of snapshot.slice(0, 5)) {
      res.write(`data: ${JSON.stringify(j)}

`);
    }
    const onGlobalUpdate = (payload) => {
      res.write(`data: ${JSON.stringify(payload)}

`);
    };
    const heartbeat = setInterval(() => {
      res.write(": ping\n\n");
    }, 15e3);
    const cleanup = () => {
      clearInterval(heartbeat);
      jobEvents.off("global", onGlobalUpdate);
    };
    jobEvents.on("global", onGlobalUpdate);
    req.on("close", cleanup);
  });
  router.get("/jobs/:jobId", async (req, res) => {
    try {
      const job = await timestampStore.getJob(req.params.jobId);
      if (!job) return res.status(404).json({ success: false, error: "job_not_found" });
      res.json({ success: true, job });
    } catch (err) {
      res.status(500).json({ success: false, error: err?.message || "job_lookup_failed" });
    }
  });
  router.post("/jobs/:jobId/retry", async (req, res) => {
    try {
      const job = await retryPipelineJob(req.params.jobId);
      res.status(202).json({ success: true, job });
    } catch (err) {
      const msg = String(err?.message || "job_retry_failed");
      const status = msg === "job_not_found" || msg === "upload_not_found" ? 404 : 500;
      res.status(status).json({ success: false, error: msg });
    }
  });
  router.get("/jobs/:jobId/events", async (req, res) => {
    const jobId = req.params.jobId;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    const current = await timestampStore.getJob(jobId).catch(() => null);
    if (current) {
      res.write(`data: ${JSON.stringify(current)}

`);
      if (current.status === "completed" || current.status === "failed") {
        res.end();
        return;
      }
    }
    const onUpdate = (payload) => {
      res.write(`data: ${JSON.stringify(payload)}

`);
      if (payload.status === "completed" || payload.status === "failed") {
        cleanup();
        res.end();
      }
    };
    const listenerName = `job:${jobId}`;
    const heartbeat = setInterval(() => {
      res.write(": ping\n\n");
    }, 15e3);
    const cleanup = () => {
      clearInterval(heartbeat);
      jobEvents.off(listenerName, onUpdate);
    };
    jobEvents.on(listenerName, onUpdate);
    req.on("close", cleanup);
  });
  router.get("/songs", async (_req, res) => {
    try {
      const songs = await timestampStore.listSongs(40);
      res.json({ success: true, songs });
    } catch (err) {
      res.status(500).json({ success: false, error: err?.message || "songs_list_failed" });
    }
  });
  router.get("/songs/:songId/timestamps", async (req, res) => {
    try {
      const song = await timestampStore.getSongTimestamps(req.params.songId);
      if (!song) return res.status(404).json({ success: false, error: "song_not_found" });
      res.json({ success: true, song });
    } catch (err) {
      res.status(500).json({ success: false, error: err?.message || "song_lookup_failed" });
    }
  });
  router.put("/songs/:songId/timestamps", async (req, res) => {
    try {
      const body = req.body || {};
      const lines = Array.isArray(body.lines) ? body.lines : [];
      const validated = validator.validateAndSummarize(lines);
      const saved = await timestampStore.saveSongTimestamps({
        songId: req.params.songId,
        uploadId: body.uploadId || null,
        title: String(body.title || "Sans titre").slice(0, 200),
        artist: String(body.artist || "").slice(0, 200),
        language: String(body.language || "auto").slice(0, 32),
        detectedLanguages: Array.isArray(body.detectedLanguages) ? body.detectedLanguages : [],
        audioType: String(body.audioType || "singing").slice(0, 32),
        durationSec: Number(body.durationSec || 0),
        bpm: Number(body.bpm || 0),
        provenance: body.provenance || { source: "manual_or_studio_sync" },
        validationSummary: validated.summary,
        lines: validated.lines
      });
      res.json({ success: true, song: saved });
    } catch (err) {
      res.status(500).json({ success: false, error: err?.message || "song_save_failed" });
    }
  });
  router.patch("/songs/:songId/words/:lineIndex/:wordIndex", async (req, res) => {
    try {
      const lineIndex = Number(req.params.lineIndex);
      const wordIndex = Number(req.params.wordIndex);
      const start = Number(req.body?.start);
      const end = Number(req.body?.end);
      if (!Number.isInteger(lineIndex) || !Number.isInteger(wordIndex) || !Number.isFinite(start) || !Number.isFinite(end)) {
        return res.status(400).json({ success: false, error: "invalid_timestamp_params" });
      }
      const song = await timestampStore.updateWordTimestamp({
        songId: req.params.songId,
        lineIndex,
        wordIndex,
        start,
        end,
        provenance: "human_verified"
      });
      res.json({ success: true, song });
    } catch (err) {
      const msg = String(err?.message || "word_update_failed");
      res.status(msg === "word_not_found" ? 404 : 500).json({ success: false, error: msg });
    }
  });
  return router;
}

// server/routes/syncEngineRoutes.ts
import express2 from "express";
import crypto3 from "node:crypto";
import fs6 from "node:fs";
import path7 from "node:path";

// frontend/src/types/lyrics.ts
var STAGE_PROGRESS_PERCENT = {
  queued: 0,
  validating: 12,
  analyzing: 25,
  separating_vocals: 40,
  transcribing: 60,
  aligning: 78,
  validating_alignment: 92,
  completed: 100,
  failed: 100
};
var ALLOWED_JOB_TRANSITIONS = {
  queued: ["validating", "failed"],
  validating: ["analyzing", "failed"],
  analyzing: ["separating_vocals", "transcribing", "failed"],
  separating_vocals: ["transcribing", "failed"],
  transcribing: ["aligning", "failed"],
  aligning: ["validating_alignment", "failed"],
  validating_alignment: ["completed", "failed"],
  completed: [],
  failed: ["queued"]
};
function canTransitionJobState(current, target) {
  return ALLOWED_JOB_TRANSITIONS[current].includes(target);
}
function transitionProcessingJob(job, nextState, message = "", error = null) {
  if (!canTransitionJobState(job.state, nextState)) {
    throw new Error(
      `Illegal pipeline transition from '${job.state}' to '${nextState}'.`
    );
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    ...job,
    state: nextState,
    progressPercent: STAGE_PROGRESS_PERCENT[nextState],
    error: nextState === "queued" ? null : error ?? job.error,
    transitions: [
      ...job.transitions,
      {
        fromState: job.state,
        toState: nextState,
        message,
        timestamp: now
      }
    ],
    updatedAt: now
  };
}
function validateSpan(start, end, path10, issues, maxDuration) {
  if (start === null && end === null) return;
  if (start === null !== (end === null)) {
    issues.push({
      code: "incomplete_timestamp_pair",
      path: path10,
      message: "Both startSeconds and endSeconds must be numbers or both null."
    });
    return;
  }
  const s = start;
  const e = end;
  if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e < 0) {
    issues.push({
      code: "negative_timestamp",
      path: path10,
      message: `Timestamps must be finite numbers >= 0.0s (got ${s}, ${e}).`
    });
  }
  if (e < s) {
    issues.push({
      code: "inverted_timestamp_range",
      path: path10,
      message: `endSeconds (${e}) must be >= startSeconds (${s}).`
    });
  }
  if (maxDuration !== null && maxDuration > 0 && e > maxDuration + 0.05) {
    issues.push({
      code: "timestamp_exceeds_duration",
      path: path10,
      message: `endSeconds (${e}) exceeds audio durationSeconds (${maxDuration}).`
    });
  }
}
function validateLyricsDocument(doc) {
  const issues = [];
  if (doc.schemaVersion !== "1.0.0") {
    issues.push({
      code: "unsupported_schema_version",
      path: "schemaVersion",
      message: "schemaVersion must be '1.0.0'."
    });
  }
  if (doc.timelineOriginSeconds !== 0) {
    issues.push({
      code: "invalid_timeline_origin",
      path: "timelineOriginSeconds",
      message: "timelineOriginSeconds must be 0 relative to the original audio file."
    });
  }
  if (!Number.isFinite(doc.durationSeconds) || doc.durationSeconds < 0) {
    issues.push({
      code: "invalid_duration",
      path: "durationSeconds",
      message: "durationSeconds must be a non-negative number in seconds."
    });
  }
  const maxDur = doc.durationSeconds > 0 ? doc.durationSeconds : null;
  let wordCount = 0;
  let unitCount = 0;
  let alignedSegmentCount = 0;
  let unalignedWordCount = 0;
  let prevSegEnd = null;
  for (let sIdx = 0; sIdx < doc.segments.length; sIdx += 1) {
    const seg = doc.segments[sIdx];
    const segPath = `segments[${sIdx}]`;
    validateSpan(seg.startSeconds, seg.endSeconds, segPath, issues, maxDur);
    if (seg.startSeconds !== null && seg.endSeconds !== null) {
      alignedSegmentCount += 1;
      if (prevSegEnd !== null && seg.startSeconds < prevSegEnd - 1e-3) {
        issues.push({
          code: "overlapping_or_non_monotonic_segment",
          path: segPath,
          message: `Segment startSeconds (${seg.startSeconds}s) precedes previous endSeconds (${prevSegEnd}s).`
        });
      }
      prevSegEnd = seg.endSeconds;
    }
    let prevWordEnd = null;
    for (let wIdx = 0; wIdx < seg.words.length; wIdx += 1) {
      const word = seg.words[wIdx];
      wordCount += 1;
      const wPath = `${segPath}.words[${wIdx}]`;
      validateSpan(word.startSeconds, word.endSeconds, wPath, issues, maxDur);
      if (word.startSeconds === null && word.endSeconds === null) {
        unalignedWordCount += 1;
      } else if (word.startSeconds !== null && word.endSeconds !== null) {
        if (seg.startSeconds !== null && word.startSeconds < seg.startSeconds - 1e-3) {
          issues.push({
            code: "word_before_segment_start",
            path: wPath,
            message: "Word startSeconds precedes segment startSeconds."
          });
        }
        if (seg.endSeconds !== null && word.endSeconds > seg.endSeconds + 1e-3) {
          issues.push({
            code: "word_after_segment_end",
            path: wPath,
            message: "Word endSeconds exceeds segment endSeconds."
          });
        }
        if (prevWordEnd !== null && word.startSeconds < prevWordEnd - 1e-3) {
          issues.push({
            code: "overlapping_or_non_monotonic_word",
            path: wPath,
            message: "Word startSeconds precedes prior word endSeconds."
          });
        }
        prevWordEnd = word.endSeconds;
      }
      let prevUnitEnd = null;
      for (let uIdx = 0; uIdx < word.units.length; uIdx += 1) {
        const unit = word.units[uIdx];
        unitCount += 1;
        const uPath = `${wPath}.units[${uIdx}]`;
        validateSpan(unit.startSeconds, unit.endSeconds, uPath, issues, maxDur);
        if (unit.startSeconds !== null && unit.endSeconds !== null) {
          if (word.startSeconds !== null && unit.startSeconds < word.startSeconds - 1e-3) {
            issues.push({
              code: "unit_before_word_start",
              path: uPath,
              message: "Unit startSeconds precedes parent word startSeconds."
            });
          }
          if (word.endSeconds !== null && unit.endSeconds > word.endSeconds + 1e-3) {
            issues.push({
              code: "unit_after_word_end",
              path: uPath,
              message: "Unit endSeconds exceeds parent word endSeconds."
            });
          }
          if (prevUnitEnd !== null && unit.startSeconds < prevUnitEnd - 1e-3) {
            issues.push({
              code: "non_monotonic_unit",
              path: uPath,
              message: "Unit startSeconds precedes prior unit endSeconds."
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
    issues
  };
}

// server/routes/syncEngineRoutes.ts
var DATA_ROOT2 = path7.resolve(
  process.env.ALEXURA_DATA_DIR || path7.join(process.cwd(), ".alexura_data", "phase1")
);
var AUDIO_DIR = path7.join(DATA_ROOT2, "audio");
var JOBS_DIR = path7.join(DATA_ROOT2, "jobs");
var LYRICS_DIR = path7.join(DATA_ROOT2, "lyrics");
var ALLOWED_EXTS = /* @__PURE__ */ new Set([".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".webm"]);
var MAX_UPLOAD_BYTES2 = Math.max(10, Number(process.env.MAX_UPLOAD_MB || 100)) * 1024 * 1024;
function ensureDirs() {
  fs6.mkdirSync(AUDIO_DIR, { recursive: true });
  fs6.mkdirSync(JOBS_DIR, { recursive: true });
  fs6.mkdirSync(LYRICS_DIR, { recursive: true });
}
function safeChild(dir, filename) {
  const clean = path7.basename(filename);
  const resolved = path7.resolve(dir, clean);
  if (!resolved.startsWith(path7.resolve(dir) + path7.sep)) {
    throw new Error("invalid_storage_path");
  }
  return resolved;
}
function hasValidAudioMagic(head, ext) {
  if (head.length < 4) return false;
  if (head.subarray(0, 4).equals(Buffer.from("RIFF")) && head.length >= 12 && head.subarray(8, 12).equals(Buffer.from("WAVE"))) {
    return true;
  }
  if (head.subarray(0, 3).equals(Buffer.from("ID3")) || head[0] === 255 && (head[1] & 224) === 224) {
    return true;
  }
  if (head.subarray(0, 4).equals(Buffer.from("fLaC")) || head.subarray(0, 4).equals(Buffer.from("OggS"))) {
    return true;
  }
  if (head.length >= 8 && head.subarray(4, 8).equals(Buffer.from("ftyp"))) {
    return true;
  }
  if (head[0] === 26 && head[1] === 69 && head[2] === 223 && head[3] === 163 && ext === ".webm") {
    return true;
  }
  return false;
}
function parseMultipartSingleFile(body, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  if (!m) return null;
  const boundary = m[1] || m[2];
  const delim = Buffer.from(`--${boundary}`);
  const firstIdx = body.indexOf(delim);
  if (firstIdx === -1) return null;
  let cursor = firstIdx + delim.length;
  while (cursor < body.length) {
    if (body.subarray(cursor, cursor + 2).equals(Buffer.from("--"))) break;
    if (body.subarray(cursor, cursor + 2).equals(Buffer.from("\r\n"))) cursor += 2;
    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), cursor);
    if (headerEnd === -1) break;
    const headersText = body.subarray(cursor, headerEnd).toString("utf8");
    const dataStart = headerEnd + 4;
    const nextBoundary = body.indexOf(delim, dataStart);
    if (nextBoundary === -1) break;
    const dataEnd = nextBoundary - 2;
    const dispMatch = /filename="([^"]*)"/i.exec(headersText);
    if (dispMatch) {
      const ctMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headersText);
      return {
        filename: dispMatch[1] || "audio.wav",
        mimeType: (ctMatch?.[1] || "application/octet-stream").trim(),
        fileBuffer: body.subarray(dataStart, Math.max(dataStart, dataEnd))
      };
    }
    cursor = nextBoundary + delim.length;
  }
  return null;
}
function buildPhase1AdaptersReport() {
  const geminiKey = String(process.env.GEMINI_API_KEY || "").trim();
  const geminiConfigured = Boolean(geminiKey && geminiKey !== "MY_GEMINI_API_KEY");
  return {
    vocalSeparation: {
      name: "VocalSeparationAdapter",
      adapterClass: "UnconfiguredVocalSeparationAdapter",
      implementation: "phase1_interface_only",
      status: "unconfigured_adapter",
      isImplementedForProduction: false,
      note: "Phase 1 stub adapter. Original audio timeline preserved untouched; Demucs/MDX connects in Phase 2.",
      phaseTarget: "Phase 2 (Demucs / MDX-Net)"
    },
    singingAsr: {
      name: "SingingASRAdapter",
      adapterClass: "UnconfiguredSingingASRAdapter",
      implementation: "phase1_interface_only",
      status: "unconfigured_adapter",
      isImplementedForProduction: false,
      note: "Phase 1 stub adapter. Does not fabricate lyrics recognition; structured draft segments only.",
      phaseTarget: "Phase 2 (Gemini Audio + Singing ASR)"
    },
    forcedAlignment: {
      name: "ForcedAlignmentAdapter",
      adapterClass: "UnconfiguredForcedAlignmentAdapter",
      implementation: "phase1_interface_only",
      status: "unconfigured_adapter",
      isImplementedForProduction: false,
      note: "Phase 1 stub adapter. Tokenizes LyricWord & LyricUnit with strictly null timestamps (zero fake timings).",
      phaseTarget: "Phase 2 (CTC Forced Alignment)"
    },
    lyricsValidation: {
      name: "LyricsValidationService",
      adapterClass: "LyricsValidationService",
      implementation: "schema_and_timestamp_validator",
      status: "ready",
      isImplementedForProduction: true,
      note: "Active normalized schema, monotonic timestamp, and second-based invariant validator.",
      phaseTarget: "Phase 1 + Phase 2"
    },
    secretsProtected: true,
    geminiServerConfigured: geminiConfigured
  };
}
function tokenizeUnalignedSegment(segmentId, text, speaker) {
  const matches = text.match(/[A-Za-zÀ-ÿ0-9'’\-]+|[\u4e00-\u9fff]|[\u3040-\u30ff]|[\uac00-\ud7af]/g) || [];
  return matches.map((tok, wIdx) => {
    const units = Array.from(tok).map((ch, uIdx) => ({
      unitId: `${segmentId}_w${String(wIdx).padStart(3, "0")}_u${String(uIdx).padStart(2, "0")}`,
      text: ch,
      unitType: "character",
      startSeconds: null,
      endSeconds: null,
      confidence: null,
      alignmentState: "unaligned"
    }));
    return {
      wordId: `${segmentId}_w${String(wIdx).padStart(3, "0")}`,
      text: tok,
      startSeconds: null,
      endSeconds: null,
      confidence: null,
      alignmentState: "unaligned",
      speaker,
      flags: ["unaligned_phase1"],
      units
    };
  });
}
function runPhase1BackgroundPipeline(jobId, params) {
  const saveJob = (job) => {
    fs6.writeFileSync(safeChild(JOBS_DIR, `${job.jobId}.json`), JSON.stringify(job, null, 2));
  };
  setTimeout(() => {
    try {
      const jobPath = safeChild(JOBS_DIR, `${jobId}.json`);
      let job = JSON.parse(fs6.readFileSync(jobPath, "utf8"));
      job = transitionProcessingJob(job, "validating", "Validating uploaded audio asset.");
      saveJob(job);
      const audioMetaPath = safeChild(AUDIO_DIR, `${params.audioId}.json`);
      if (!fs6.existsSync(audioMetaPath)) {
        job = transitionProcessingJob(job, "failed", "Original audio missing.", "audio_not_found");
        saveJob(job);
        return;
      }
      const audio = JSON.parse(fs6.readFileSync(audioMetaPath, "utf8"));
      job = transitionProcessingJob(job, "analyzing", "Phase 1 metadata & timeline preservation.");
      saveJob(job);
      if (params.enableVocalSeparation) {
        job = transitionProcessingJob(
          job,
          "separating_vocals",
          "Invoking VocalSeparationAdapter (Phase 1 stub)."
        );
        saveJob(job);
      }
      job = transitionProcessingJob(
        job,
        "transcribing",
        "Invoking SingingASRAdapter (Phase 1 stub \u2014 no fake recognition)."
      );
      saveJob(job);
      const lines = (params.draftLyricsText || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const rawSegments = lines.length > 0 ? lines.map((line, idx) => ({
        segmentId: `seg_${String(idx).padStart(3, "0")}`,
        index: idx,
        text: line,
        startSeconds: null,
        endSeconds: null,
        language: params.languageHint === "auto" ? null : params.languageHint,
        sectionType: "verse",
        vocalType: "lead",
        speaker: "Lead",
        confidence: null,
        alignmentState: "unaligned",
        isPlaceholder: false,
        words: []
      })) : [
        {
          segmentId: "seg_000",
          index: 0,
          text: "[Phase 1 Placeholder \u2014 Connect SingingASRAdapter in Phase 2 or enter lyrics manually]",
          startSeconds: null,
          endSeconds: null,
          language: params.languageHint === "auto" ? null : params.languageHint,
          sectionType: "other",
          vocalType: "lead",
          speaker: "Lead",
          confidence: null,
          alignmentState: "unaligned",
          isPlaceholder: true,
          words: []
        }
      ];
      job = transitionProcessingJob(
        job,
        "aligning",
        "Invoking ForcedAlignmentAdapter (Phase 1 tokenization \u2014 null timestamps)."
      );
      saveJob(job);
      const structuredSegments = rawSegments.map((seg) => ({
        ...seg,
        words: seg.isPlaceholder ? [] : tokenizeUnalignedSegment(seg.segmentId, seg.text, seg.speaker || "Lead")
      }));
      job = transitionProcessingJob(
        job,
        "validating_alignment",
        "Validating normalized LyricsDocument schema."
      );
      saveJob(job);
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const doc = {
        schemaVersion: "1.0.0",
        documentId: job.documentId || `lyr_${crypto3.randomBytes(7).toString("hex")}`,
        audioId: audio.audioId,
        jobId: job.jobId,
        title: (params.title || path7.parse(audio.filename).name).slice(0, 240),
        artist: (params.artist || "").slice(0, 240),
        primaryLanguage: params.languageHint || "auto",
        detectedLanguages: params.languageHint === "auto" ? [] : [params.languageHint],
        durationSeconds: audio.durationSeconds || 0,
        timelineOriginSeconds: 0,
        preservesOriginalAudio: true,
        alignmentStatus: lines.length > 0 ? "unaligned" : "phase1_placeholder",
        source: lines.length > 0 ? "manual_editor" : "phase1_stub",
        metadata: {
          phase: "phase_1_foundation",
          adapters: buildPhase1AdaptersReport()
        },
        segments: structuredSegments,
        createdAt: now,
        updatedAt: now
      };
      const report = validateLyricsDocument(doc);
      if (!report.valid) {
        job = transitionProcessingJob(
          job,
          "failed",
          "Normalized schema validation failed.",
          report.issues[0]?.message || "schema_validation_failed"
        );
        saveJob(job);
        return;
      }
      fs6.writeFileSync(
        safeChild(LYRICS_DIR, `${doc.documentId}.json`),
        JSON.stringify(doc, null, 2)
      );
      job = transitionProcessingJob(
        job,
        "completed",
        "Phase 1 pipeline completed cleanly without simulated timestamps."
      );
      saveJob(job);
    } catch (err) {
      try {
        const jobPath = safeChild(JOBS_DIR, `${jobId}.json`);
        const cur = JSON.parse(fs6.readFileSync(jobPath, "utf8"));
        if (cur.state !== "completed" && cur.state !== "failed") {
          const failed = transitionProcessingJob(
            cur,
            "failed",
            "Pipeline error",
            err?.message || "pipeline_error"
          );
          saveJob(failed);
        }
      } catch {
      }
    }
  }, 40);
}
function createSyncEngineV1Router() {
  ensureDirs();
  const router = express2.Router();
  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "Alexura AI Lyrics Sync Engine",
      phase: "phase_1_foundation",
      adapters: buildPhase1AdaptersReport()
    });
  });
  router.get("/adapters", (_req, res) => {
    res.json({
      success: true,
      adapters: buildPhase1AdaptersReport()
    });
  });
  router.get("/schemas/lyrics", (_req, res) => {
    const schemaPath = path7.resolve(process.cwd(), "schemas", "lyrics.schema.json");
    if (!fs6.existsSync(schemaPath)) {
      return res.status(404).json({ success: false, error: "schema_not_found" });
    }
    res.type("application/json").send(fs6.readFileSync(schemaPath, "utf8"));
  });
  router.post(
    "/audio/upload",
    express2.raw({ type: "*/*", limit: "105mb" }),
    (req, res) => {
      try {
        ensureDirs();
        const ct = String(req.headers["content-type"] || "");
        const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        let filename = "audio.wav";
        let mimeType = "application/octet-stream";
        let fileBuf = body;
        if (ct.includes("multipart/form-data")) {
          const parsed = parseMultipartSingleFile(body, ct);
          if (!parsed) {
            return res.status(400).json({ success: false, detail: "invalid_multipart_payload" });
          }
          filename = parsed.filename;
          mimeType = parsed.mimeType;
          fileBuf = parsed.fileBuffer;
        } else if (req.headers["x-file-name"]) {
          filename = decodeURIComponent(String(req.headers["x-file-name"]));
          mimeType = ct || mimeType;
        }
        const safeName = path7.basename(filename).slice(0, 200);
        const ext = path7.extname(safeName).toLowerCase();
        if (!ALLOWED_EXTS.has(ext)) {
          return res.status(400).json({ success: false, detail: "unsupported_audio_extension" });
        }
        if (!fileBuf.length || fileBuf.length > MAX_UPLOAD_BYTES2) {
          return res.status(400).json({ success: false, detail: "invalid_audio_size" });
        }
        if (!hasValidAudioMagic(fileBuf.subarray(0, 16), ext)) {
          return res.status(400).json({ success: false, detail: "invalid_audio_magic_header" });
        }
        const audioId = `aud_${crypto3.randomBytes(8).toString("hex")}`;
        const storagePath = safeChild(AUDIO_DIR, `${audioId}${ext}`);
        fs6.writeFileSync(storagePath, fileBuf);
        const asset = {
          audioId,
          filename: safeName,
          mimeType,
          byteSize: fileBuf.length,
          sha256: crypto3.createHash("sha256").update(fileBuf).digest("hex"),
          durationSeconds: 0,
          sampleRateHz: 0,
          channels: 0,
          storagePath,
          audioUrl: `/api/v1/audio/${audioId}/stream`,
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        fs6.writeFileSync(
          safeChild(AUDIO_DIR, `${audioId}.json`),
          JSON.stringify(asset, null, 2)
        );
        const { storagePath: _hidden, ...publicAsset } = asset;
        return res.status(201).json({ success: true, audio: publicAsset });
      } catch (err) {
        return res.status(500).json({ success: false, detail: err?.message || "upload_error" });
      }
    }
  );
  router.get("/audio/:audioId", (req, res) => {
    try {
      const metaPath = safeChild(AUDIO_DIR, `${req.params.audioId}.json`);
      if (!fs6.existsSync(metaPath)) {
        return res.status(404).json({ success: false, detail: "audio_not_found" });
      }
      const { storagePath: _hidden, ...publicAsset } = JSON.parse(
        fs6.readFileSync(metaPath, "utf8")
      );
      return res.json({ success: true, audio: publicAsset });
    } catch {
      return res.status(404).json({ success: false, detail: "audio_not_found" });
    }
  });
  router.get("/audio/:audioId/stream", (req, res) => {
    try {
      const metaPath = safeChild(AUDIO_DIR, `${req.params.audioId}.json`);
      if (!fs6.existsSync(metaPath)) {
        return res.status(404).json({ success: false, detail: "audio_not_found" });
      }
      const meta = JSON.parse(fs6.readFileSync(metaPath, "utf8"));
      const audioPath = path7.resolve(String(meta.storagePath || ""));
      if (!audioPath.startsWith(path7.resolve(AUDIO_DIR) + path7.sep) || !fs6.existsSync(audioPath)) {
        return res.status(404).json({ success: false, detail: "audio_file_missing" });
      }
      const stat = fs6.statSync(audioPath);
      const total = stat.size;
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Type", meta.mimeType || "audio/mpeg");
      const range = req.headers.range;
      if (range && range.startsWith("bytes=")) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = Math.max(0, parseInt(parts[0], 10) || 0);
        const end = parts[1] ? Math.min(total - 1, parseInt(parts[1], 10)) : total - 1;
        if (start >= total || end < start) {
          res.status(416).setHeader("Content-Range", `bytes */${total}`).end();
          return;
        }
        res.status(206);
        res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
        res.setHeader("Content-Length", String(end - start + 1));
        fs6.createReadStream(audioPath, { start, end }).pipe(res);
      } else {
        res.setHeader("Content-Length", String(total));
        fs6.createReadStream(audioPath).pipe(res);
      }
    } catch {
      return res.status(500).json({ success: false, detail: "stream_error" });
    }
  });
  router.post("/jobs/analyze", (req, res) => {
    try {
      ensureDirs();
      const { audioId, title, artist, languageHint, draftLyricsText, enableVocalSeparation } = req.body || {};
      if (!audioId || typeof audioId !== "string") {
        return res.status(400).json({ success: false, detail: "missing_audio_id" });
      }
      const metaPath = safeChild(AUDIO_DIR, `${audioId}.json`);
      if (!fs6.existsSync(metaPath)) {
        return res.status(404).json({ success: false, detail: "audio_not_found" });
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const job = {
        jobId: `job_${crypto3.randomBytes(7).toString("hex")}`,
        audioId,
        documentId: `lyr_${crypto3.randomBytes(7).toString("hex")}`,
        state: "queued",
        progressPercent: 0,
        languageHint: String(languageHint || "auto").slice(0, 32),
        enableVocalSeparation: enableVocalSeparation !== false,
        phaseMode: "phase_1_architecture_foundation",
        adapterReport: buildPhase1AdaptersReport(),
        transitions: [],
        error: null,
        createdAt: now,
        updatedAt: now
      };
      fs6.writeFileSync(safeChild(JOBS_DIR, `${job.jobId}.json`), JSON.stringify(job, null, 2));
      runPhase1BackgroundPipeline(job.jobId, {
        audioId,
        title: title ? String(title) : void 0,
        artist: artist ? String(artist) : void 0,
        languageHint: job.languageHint,
        draftLyricsText: typeof draftLyricsText === "string" ? draftLyricsText : void 0,
        enableVocalSeparation: job.enableVocalSeparation
      });
      return res.status(202).json({ success: true, job });
    } catch (err) {
      return res.status(500).json({ success: false, detail: err?.message || "job_create_failed" });
    }
  });
  router.get("/jobs", (_req, res) => {
    ensureDirs();
    const files = fs6.readdirSync(JOBS_DIR).filter((f) => f.endsWith(".json")).map((f) => path7.join(JOBS_DIR, f)).sort((a, b) => fs6.statSync(b).mtimeMs - fs6.statSync(a).mtimeMs).slice(0, 25);
    const jobs = files.map((f) => JSON.parse(fs6.readFileSync(f, "utf8")));
    res.json({ success: true, jobs });
  });
  router.get("/jobs/:jobId", (req, res) => {
    try {
      const p = safeChild(JOBS_DIR, `${req.params.jobId}.json`);
      if (!fs6.existsSync(p)) {
        return res.status(404).json({ success: false, detail: "job_not_found" });
      }
      return res.json({ success: true, job: JSON.parse(fs6.readFileSync(p, "utf8")) });
    } catch {
      return res.status(404).json({ success: false, detail: "job_not_found" });
    }
  });
  router.get("/lyrics", (_req, res) => {
    ensureDirs();
    const files = fs6.readdirSync(LYRICS_DIR).filter((f) => f.endsWith(".json")).map((f) => path7.join(LYRICS_DIR, f)).sort((a, b) => fs6.statSync(b).mtimeMs - fs6.statSync(a).mtimeMs).slice(0, 25);
    const documents = files.map((f) => JSON.parse(fs6.readFileSync(f, "utf8")));
    res.json({ success: true, documents });
  });
  router.get("/lyrics/:documentId", (req, res) => {
    try {
      const p = safeChild(LYRICS_DIR, `${req.params.documentId}.json`);
      if (!fs6.existsSync(p)) {
        return res.status(404).json({ success: false, detail: "lyrics_document_not_found" });
      }
      return res.json({ success: true, document: JSON.parse(fs6.readFileSync(p, "utf8")) });
    } catch {
      return res.status(404).json({ success: false, detail: "lyrics_document_not_found" });
    }
  });
  router.put("/lyrics/:documentId", (req, res) => {
    try {
      const p = safeChild(LYRICS_DIR, `${req.params.documentId}.json`);
      if (!fs6.existsSync(p)) {
        return res.status(404).json({ success: false, detail: "lyrics_document_not_found" });
      }
      const existing = JSON.parse(fs6.readFileSync(p, "utf8"));
      const body = req.body || {};
      if (!Array.isArray(body.segments)) {
        return res.status(422).json({ success: false, detail: "segments must be an array" });
      }
      const updated = {
        ...existing,
        title: typeof body.title === "string" ? body.title.slice(0, 240) : existing.title,
        artist: typeof body.artist === "string" ? body.artist.slice(0, 240) : existing.artist,
        primaryLanguage: typeof body.primaryLanguage === "string" ? body.primaryLanguage.slice(0, 32) : existing.primaryLanguage,
        alignmentStatus: typeof body.alignmentStatus === "string" ? body.alignmentStatus : "partial_manual",
        source: "manual_editor",
        segments: body.segments,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      const validation = validateLyricsDocument(updated);
      if (!validation.valid) {
        return res.status(422).json({
          success: false,
          detail: `${validation.issues[0].path}: ${validation.issues[0].message}`,
          issues: validation.issues
        });
      }
      fs6.writeFileSync(p, JSON.stringify(updated, null, 2));
      return res.json({ success: true, document: updated });
    } catch (err) {
      return res.status(500).json({ success: false, detail: err?.message || "lyrics_update_failed" });
    }
  });
  return router;
}

// server/services/whisperEngine.ts
import { spawn } from "node:child_process";
import path8 from "node:path";

// server/services/mandarinTools.ts
var TRAD_TO_SIMP_PAIR_LIST = "\u611B\u7231 \u6200\u604B \u5922\u68A6 \u8072\u58F0 \u97FF\u54CD \u807D\u542C \u8AAA\u8BF4 \u8A71\u8BDD \u8A9E\u8BED \u8A5E\u8BCD \u98A8\u98CE \u96F2\u4E91 \u96FB\u7535 \u9583\u95EA \u6DDA\u6CEA \u50B7\u4F24 \u6A02\u4E50 \u6B61\u6B22 \u96E3\u96BE \u904E\u8FC7 \u4F86\u6765 \u958B\u5F00 \u95DC\u5173 \u9580\u95E8 \u6642\u65F6 \u9593\u95F4 \u9418\u949F \u9EDE\u70B9 \u908A\u8FB9 \u9060\u8FDC \u88E1\u91CC \u5F8C\u540E \u73FE\u73B0 \u9084\u8FD8 \u9019\u8FD9 \u500B\u4E2A \u5011\u4EEC \u59B3\u4F60 \u8AB0\u8C01 \u9EBC\u4E48 \u55CE\u5417 \u932F\u9519 \u5C0D\u5BF9 \u70BA\u4E3A \u8207\u4E0E \u8B93\u8BA9 \u7D66\u7ED9 \u5F9E\u4ECE \u570B\u56FD \u5BEB\u5199 \u8B80\u8BFB \u756B\u753B \u898B\u89C1 \u8996\u89C6 \u89BA\u89C9 \u8A8D\u8BA4 \u8B58\u8BC6 \u9078\u9009 \u64C7\u62E9 \u6C7A\u51B3 \u8B8A\u53D8 \u63DB\u6362 \u727D\u7275 \u81C9\u8138 \u767C\u53D1 \u982D\u5934 \u9AD4\u4F53 \u52D5\u52A8 \u975C\u9759 \u98DB\u98DE \u9032\u8FDB \u5C0B\u5BFB \u8D0F\u8D62 \u8F38\u8F93 \u6230\u6218 \u722D\u4E89 \u8B77\u62A4 \u5E6B\u5E2E \u8B1D\u8C22 \u8ACB\u8BF7 \u554F\u95EE \u61C9\u5E94 \u8A72\u8BE5 \u9808\u987B \u7E3D\u603B \u7D93\u7ECF \u5C07\u5C06 \u537B\u5374 \u96D6\u867D \u4E26\u5E76 \u7121\u65E0 \u6C92\u6CA1 \u50C5\u4EC5 \u5BE6\u5B9E \u969B\u9645 \u842C\u4E07 \u5104\u4EBF \u5169\u4E24 \u96D9\u53CC \u55AE\u5355 \u7368\u72EC \u865B\u865A \u6EFF\u6EE1 \u8F15\u8F7B \u5F37\u5F3A \u9E79\u54B8 \u9BAE\u9C9C \u8277\u8273 \u721B\u70C2 \u69AE\u8363 \u83EF\u534E \u9E97\u4E3D \u7D14\u7EAF \u6F54\u6D01 \u6DE8\u51C0 \u6FC1\u6D4A \u6DFA\u6D45 \u9059\u9065 \u5BEC\u5BBD \u5EE3\u5E7F \u5713\u5706 \u5F4E\u5F2F \u65B7\u65AD \u7E8C\u7EED \u9023\u8FDE \u7D50\u7ED3 \u7D42\u7EC8 \u820A\u65E7 \u6B72\u5C81 \u97FB\u97F5 \u8ABF\u8C03 \u7DDA\u7EBF \u6A23\u6837 \u7A2E\u79CD \u985E\u7C7B \u689D\u6761 \u5F35\u5F20 \u9846\u9897 \u9663\u9635 \u5834\u573A \u9801\u9875 \u66F8\u4E66 \u7D19\u7EB8 \u7B46\u7B14 \u865F\u53F7 \u78BC\u7801 \u5716\u56FE \u93E1\u955C \u71C8\u706F \u71D2\u70E7 \u7159\u70DF \u5875\u5C18 \u9435\u94C1 \u92FC\u94A2 \u5BF6\u5B9D \u8C9D\u8D1D \u947D\u94BB \u8ECA\u8F66 \u6A5F\u673A \u8F2A\u8F6E \u7063\u6E7E \u5CF6\u5C9B \u7058\u6EE9 \u51CD\u51BB \u98C4\u98D8 \u8F1D\u8F89 \u6EAB\u6E29 \u64C1\u62E5 \u639B\u6302 \u7661\u75F4 \u760B\u75AF \u61FC\u60E7 \u6182\u5FE7 \u9B31\u90C1 \u60B6\u95F7 \u7169\u70E6 \u60F1\u607C \u6190\u601C \u5805\u575A \u57F7\u6267 \u8AA0\u8BDA \u7FA9\u4E49 \u79AE\u793C \u9748\u7075 \u8E5F\u8FF9 \u8DE1\u8FF9 \u7DE3\u7F18 \u904B\u8FD0 \u6578\u6570 \u6046\u6052 \u66AB\u6682 \u6B77\u5386 \u9A57\u9A8C \u89F8\u89E6 \u88DC\u8865 \u5275\u521B \u7DE8\u7F16 \u7E54\u7EC7 \u7E6A\u7ED8 \u6E67\u6D8C \u8CBC\u8D34 \u7DCA\u7D27 \u9B06\u677E \u91CB\u91CA \u61F7\u6000 \u6E96\u51C6 \u5099\u5907 \u7E7C\u7EE7 \u6557\u8D25 \u52DD\u80DC \u8CA0\u8D1F \u8CAC\u8D23 \u64D4\u62C5 \u7576\u5F53 \u8AFE\u8BFA \u7D04\u7EA6 \u6703\u4F1A \u6B78\u5F52 \u8F49\u8F6C \u8D95\u8D76 \u84CB\u76D6 \u9396\u9501 \u9470\u94A5 \u555F\u542F \u6416\u6447 \u64FA\u6446 \u8569\u8361 \u7BC0\u8282 \u8A69\u8BD7 \u614B\u6001 \u6C23\u6C14 \u984F\u989C \u559A\u5524 \u5606\u53F9 \u8AD2\u8C05 \u9867\u987E".split(/\s+/);
var TO_SIMPLIFIED = {};
var TO_TRADITIONAL = {};
for (const pair of TRAD_TO_SIMP_PAIR_LIST) {
  if (pair.length === 2 && pair[0] !== pair[1]) {
    const tr = pair[0];
    const si = pair[1];
    TO_SIMPLIFIED[tr] = si;
    if (!TO_TRADITIONAL[si]) TO_TRADITIONAL[si] = tr;
  }
}
TO_SIMPLIFIED["\u9AEE"] = "\u53D1";
TO_SIMPLIFIED["\u88E1"] = "\u91CC";
TO_SIMPLIFIED["\u88CF"] = "\u91CC";
TO_SIMPLIFIED["\u65BC"] = "\u4E8E";
TO_SIMPLIFIED["\u9EBC"] = "\u4E48";
TO_SIMPLIFIED["\u8457"] = "\u7740";
TO_SIMPLIFIED["\u9858"] = "\u613F";
TO_SIMPLIFIED["\u5EE3"] = "\u5E7F";
TO_SIMPLIFIED["\u96F2"] = "\u4E91";
TO_SIMPLIFIED["\u9EB5"] = "\u9762";
function containsHanzi(text) {
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(String(text || ""));
}
function normalizeHanziBase(ch) {
  const c = String(ch || "").trim();
  return TO_SIMPLIFIED[c] || c;
}
function detectMandarinScript(text) {
  let tradHits = 0;
  let simpHits = 0;
  for (const ch of String(text || "")) {
    if (TO_SIMPLIFIED[ch] && !TO_TRADITIONAL[ch]) tradHits++;
    else if (TO_TRADITIONAL[ch] && !TO_SIMPLIFIED[ch]) simpHits++;
  }
  return tradHits > simpHits ? "zh-Hant" : "zh-Hans";
}
function harmonizeMandarinScript(text, targetScript) {
  const map = targetScript === "zh-Hant" ? TO_TRADITIONAL : TO_SIMPLIFIED;
  let out = "";
  for (const ch of String(text || "")) {
    out += map[ch] || ch;
  }
  return out;
}
var PINYIN_GROUPS = {
  a: "\u554A\u963F\u5475",
  ai: "\u7231\u611B\u54C0\u5509\u57C3\u6328\u54CE\u764C\u77EE\u827E\u788D",
  an: "\u5B89\u6697\u5CB8\u6309\u6848\u5B89\u80FA\u6697",
  ang: "\u6602",
  ao: "\u50B2\u5965\u71AC\u8884\u62D7",
  ba: "\u5427\u628A\u516B\u7238\u5DF4\u62D4\u7F62\u9738\u575D\u82AD\u75A4",
  bai: "\u767D\u767E\u8D25\u64FA\u6446\u62DC\u67CF",
  ban: "\u534A\u529E\u4F34\u8FA6\u822C\u73ED\u677F\u7248\u642C\u62CC\u6591",
  bang: "\u5E2E\u5E6B\u65C1\u508D\u699C\u68D2\u7ED1\u78C5",
  bao: "\u62B1\u5B9D\u5BF6\u4FDD\u62A5\u5305\u8584\u7206\u66B4\u9971\u5265",
  bei: "\u88AB\u60B2\u5317\u80CC\u676F\u8D1D\u8C9D\u5907\u5099\u500D\u8F88\u7891",
  ben: "\u672C\u5954\u7B28",
  beng: "\u5D29\u8E66",
  bi: "\u6BD4\u7B14\u7B46\u5FC5\u6BD5\u95ED\u58C1\u907F\u9F3B\u903C\u78A7\u5F7C",
  bian: "\u8FB9\u908A\u53D8\u8B8A\u904D\u4FBF\u7F16\u7DE8\u8FA9\u8FA8",
  biao: "\u8868\u6807\u6A19\u98D8\u8868",
  bie: "\u522B\u5225\u618B",
  bin: "\u6EE8\u5BBE",
  bing: "\u51B0\u5E76\u4E26\u75C5\u5175\u997C",
  bo: "\u6CE2\u64AD\u6CCA\u535A\u62E8\u73BB\u7483",
  bu: "\u4E0D\u6B65\u90E8\u5E03\u8865\u88DC\u6355\u6016",
  ca: "\u64E6",
  cai: "\u624D\u731C\u5F69\u91C7\u83DC\u8D22",
  can: "\u6B8B\u60E8\u9910\u53C2",
  cang: "\u85CF\u82CD\u6CA7\u4ED3",
  cao: "\u8349\u64CD",
  ce: "\u6D4B\u518C\u4FA7\u7B56",
  ceng: "\u66FE\u5C42",
  cha: "\u8336\u5DEE\u67E5\u63D2\u5BDF",
  chai: "\u62C6",
  chan: "\u7F20\u98A4\u4EA7",
  chang: "\u5531\u5E38\u957F\u9577\u573A\u5834\u80A0\u5C1D\u507F",
  chao: "\u6F6E\u671D\u8D85\u5435\u6284",
  che: "\u8F66\u8ECA\u5F7B\u64A4\u626F",
  chen: "\u6C89\u6668\u5C18\u5875\u9648\u8D81\u79F0\u886C",
  cheng: "\u6210\u57CE\u627F\u7A0B\u8BDA\u8AA0\u79F0\u4E58\u6491\u6A59",
  chi: "\u5403\u6301\u75F4\u7661\u8FDF\u6C60\u5C3A\u7FC5\u8D64",
  chong: "\u51B2\u91CD\u5145\u866B\u5BA0\u5D07",
  chou: "\u6101\u62BD\u4E11\u81ED",
  chu: "\u51FA\u521D\u9664\u5904\u89E6\u89F8\u695A\u7840\u50A8",
  chuan: "\u7A7F\u4F20\u50B3\u8239\u5DDD\u5598\u4E32",
  chuang: "\u7A97\u5E8A\u521B\u5275\u95EF",
  chui: "\u5439\u5782\u9524",
  chun: "\u6625\u7EAF\u7D14\u5507",
  ci: "\u8BCD\u8A5E\u6B64\u523A\u6B21\u8F9E\u8FAD\u74F7\u6148",
  cong: "\u4ECE\u5F9E\u5306\u806A",
  cu: "\u7C97\u4FC3\u918B",
  cuan: "\u7A9C",
  cui: "\u8106\u788E\u50AC\u7FE0",
  cun: "\u5B58\u6751\u5BF8",
  cuo: "\u9519\u932F\u63AA",
  da: "\u5927\u7B54\u6253\u8FBE\u642D",
  dai: "\u5E26\u5E36\u4EE3\u5F85\u6234\u888B\u5446",
  dan: "\u4F46\u5355\u55AE\u6DE1\u62C5\u64D4\u5F39\u86CB\u8BDE",
  dang: "\u5F53\u7576\u6321\u64CB\u8361\u8569\u515A",
  dao: "\u5230\u9053\u5012\u5C9B\u5CF6\u5200\u5BFC\u76D7",
  de: "\u7684\u5F97\u5FB7",
  deng: "\u7B49\u706F\u71C8\u767B",
  di: "\u5730\u7B2C\u5E95\u4F4E\u6EF4\u5E1D\u5F1F\u9012\u654C",
  dian: "\u70B9\u9EDE\u7535\u96FB\u5E97\u57AB\u5178\u98A0",
  diao: "\u6389\u8C03\u8ABF\u540A\u96D5",
  die: "\u8776\u8DCC\u53E0",
  ding: "\u5B9A\u8BA2\u9876\u76EF\u53EE",
  diu: "\u4E22",
  dong: "\u52A8\u52D5\u4E1C\u51AC\u61C2\u6D1E\u51BB\u51CD",
  dou: "\u90FD\u6597\u6296\u8C46\u8BFB",
  du: "\u72EC\u7368\u5EA6\u8BFB\u8B80\u6E21\u6BD2\u8D4C\u5835",
  duan: "\u65AD\u65B7\u77ED\u6BB5\u7AEF",
  dui: "\u5BF9\u5C0D\u961F\u5806\u5151",
  dun: "\u987F\u8E72\u76FE",
  duo: "\u591A\u6735\u8EB2\u593A\u5815",
  e: "\u6076\u997F\u9E45\u989D\u54E6",
  en: "\u6069\u55EF",
  er: "\u800C\u513F\u8033\u4E8C\u5C14",
  fa: "\u53D1\u767C\u6CD5\u7F5A\u4E4F\u4F10",
  fan: "\u7E41\u70E6\u7169\u53CD\u996D\u7FFB\u72AF\u51E1\u8303",
  fang: "\u653E\u65B9\u9632\u623F\u8BBF\u82B3\u4EFF",
  fei: "\u98DE\u98DB\u975E\u80A5\u8D39\u5E9F\u80BA\u5561",
  fen: "\u5206\u7C89\u4EFD\u7EB7\u594B\u6124",
  feng: "\u98CE\u98A8\u5C01\u75AF\u760B\u5CF0\u950B\u4E30\u9022",
  fo: "\u4F5B",
  fou: "\u5426",
  fu: "\u798F\u5E45\u8D1F\u8CA0\u590D\u670D\u4ED8\u6276\u6D6E\u7B26\u5BCC\u5E9C\u7236\u592B",
  gai: "\u8BE5\u8A72\u6539\u76D6\u84CB\u6982",
  gan: "\u611F\u6562\u5E72\u7518\u809D\u8D76\u8D95",
  gang: "\u521A\u94A2\u92FC\u6E2F\u5C97",
  gao: "\u9AD8\u544A\u641E\u818F",
  ge: "\u6B4C\u4E2A\u500B\u5404\u54E5\u9694\u683C\u5272",
  gei: "\u7ED9\u7D66",
  gen: "\u8DDF\u6839",
  geng: "\u66F4\u8015",
  gong: "\u5171\u516C\u529F\u5DE5\u653B\u5BAB\u4F9B",
  gou: "\u591F\u6784\u72D7\u6C9F\u52FE",
  gu: "\u5B64\u6545\u987E\u9867\u53E4\u9F13\u9AA8\u8C37\u56FA",
  gua: "\u6302\u639B\u522E\u74DC",
  guai: "\u602A\u4E56",
  guan: "\u5173\u95DC\u89C2\u7BA1\u5B98\u60EF\u9986",
  guang: "\u5149\u5E7F\u5EE3\u901B",
  gui: "\u5F52\u6B78\u8D35\u9B3C\u8F68",
  gun: "\u6EDA",
  guo: "\u8FC7\u904E\u56FD\u570B\u679C\u9505\u88F9",
  ha: "\u54C8",
  hai: "\u6D77\u8FD8\u9084\u5BB3\u5B69",
  han: "\u5BD2\u558A\u542B\u6C57\u6C49\u61BE",
  hang: "\u884C\u822A",
  hao: "\u597D\u53F7\u865F\u6BEB\u8C6A\u6D69",
  he: "\u548C\u6CB3\u5408\u559D\u4F55\u9ED1\u8377\u76D2",
  hei: "\u9ED1\u563F",
  hen: "\u5F88\u6068\u75D5",
  heng: "\u6A2A\u6052\u6046\u54FC",
  hong: "\u7EA2\u7D05\u8679\u5B8F\u6D2A\u8F70",
  hou: "\u540E\u5F8C\u5019\u539A\u7334",
  hu: "\u547C\u6E56\u62A4\u8B77\u72D0\u864E\u80E1\u4E4E\u4E92\u5FFD",
  hua: "\u82B1\u753B\u756B\u8BDD\u8A71\u534E\u83EF\u6ED1\u5316",
  huai: "\u574F\u58DE\u6000\u61F7",
  huan: "\u6B22\u6B61\u8FD8\u6362\u63DB\u5E7B\u73AF",
  huang: "\u9EC4\u614C\u8352\u7687\u6643",
  hui: "\u56DE\u4F1A\u6703\u7070\u6325\u8F89\u8F1D\u6094\u6BC1\u6C47\u7ED8\u7E6A",
  hun: "\u660F\u9B42\u5A5A\u6DF7",
  huo: "\u6216\u706B\u6D3B\u8D27\u83B7",
  ji: "\u8BB0\u8A18\u5DF1\u51E0\u5BC2\u5B63\u8FF9\u8E5F\u8DE1\u6781\u673A\u6A5F\u9E21\u6025\u96C6\u7EA7\u9645\u969B\u7ED9\u53CA\u51FB\u6FC0\u6324",
  jia: "\u5BB6\u5047\u52A0\u4EF7\u67B6\u9A7E\u7532",
  jian: "\u89C1\u898B\u95F4\u9593\u575A\u5805\u7B80\u4EF6\u5EFA\u6E10\u80A9\u5251",
  jiang: "\u5C06\u5C07\u6C5F\u8BB2\u964D\u5F3A",
  jiao: "\u53EB\u89D2\u89C9\u6559\u4EA4\u7126\u9A84\u5A07\u80F6",
  jie: "\u754C\u4ECB\u63A5\u7ED3\u7D50\u501F\u8282\u7BC0\u8857\u59D0\u89E3\u6D01\u6F54",
  jin: "\u4ECA\u7D27\u7DCA\u8FD1\u8FDB\u9032\u91D1\u5C3D\u4EC5\u50C5\u65A4",
  jing: "\u7ECF\u7D93\u9759\u975C\u955C\u93E1\u51C0\u6DE8\u666F\u60CA\u7CBE\u7ADF\u8B66",
  jiu: "\u5C31\u4E45\u9152\u65E7\u820A\u6551\u4E5D\u7A76",
  ju: "\u805A\u53E5\u4E3E\u62D2\u5C40\u5267\u5177\u5C45\u5DE8",
  juan: "\u5377\u5026",
  jue: "\u89C9\u89BA\u51B3\u6C7A\u7EDD\u6398",
  jun: "\u519B\u541B\u5747",
  ka: "\u5361\u5496",
  kai: "\u5F00\u958B",
  kan: "\u770B\u780D\u520A",
  kang: "\u5EB7\u6297",
  kao: "\u9760\u8003\u70E4",
  ke: "\u53EF\u523B\u514B\u79D1\u5BA2\u9897\u9846\u6E34\u8BFE",
  ken: "\u80AF",
  kong: "\u7A7A\u6050\u5B54\u63A7",
  kou: "\u53E3\u6263",
  ku: "\u54ED\u82E6\u5E93\u88E4\u9177",
  kua: "\u8DE8\u5938",
  kuai: "\u5FEB\u5757\u7B77",
  kuan: "\u5BBD\u5BEC\u6B3E",
  kuang: "\u72C2\u51B5\u6846\u77FF",
  kui: "\u4E8F\u6127",
  kun: "\u56F0\u6606",
  kuo: "\u9614\u6269",
  la: "\u5566\u62C9\u8FA3\u8721",
  lai: "\u6765\u4F86\u8D56",
  lan: "\u84DD\u85CD\u61D2\u70C2\u721B\u62E6\u7BEE",
  lang: "\u6D6A\u6717\u72FC\u5ECA",
  lao: "\u8001\u52B3\u7262",
  le: "\u4E86\u4E50\u6A02\u52D2",
  lei: "\u6CEA\u6DDA\u7D2F\u7C7B\u985E\u96F7",
  leng: "\u51B7",
  li: "\u79BB\u96E2\u91CC\u88E1\u529B\u7ACB\u4E3D\u9E97\u7406\u793C\u79AE\u5386\u6B77\u5229\u4F8B\u52B1",
  lian: "\u604B\u6200\u8138\u81C9\u8FDE\u9023\u7EC3\u70BC\u601C\u6190",
  liang: "\u4EAE\u51C9\u6DBC\u4E24\u5169\u91CF\u826F\u7CAE",
  liao: "\u804A\u4E86\u8FBD\u7597\u6599",
  lie: "\u70C8\u88C2\u730E",
  lin: "\u6797\u6DCB\u4E34\u90BB",
  ling: "\u7075\u9748\u96F6\u94C3\u9886\u53E6\u4EE4",
  liu: "\u6D41\u7559\u516D\u67F3",
  long: "\u9F99\u7B3C\u6D53",
  lou: "\u697C\u6F0F\u9732",
  lu: "\u8DEF\u9732\u9E7F\u5F55\u7EFF\u9646",
  luan: "\u4E71\u5375",
  lue: "\u7565",
  lun: "\u8F6E\u8F2A\u8BBA",
  luo: "\u843D\u7F57\u841D",
  lv: "\u7EFF\u7DA0\u65C5\u5F8B\u5C65",
  ma: "\u5417\u55CE\u561B\u5988\u9A6C\u9A82\u9EBB",
  mai: "\u4E70\u5356\u8FC8\u57CB",
  man: "\u6162\u6F2B\u6EE1\u6EFF\u7792",
  mang: "\u5FD9\u76F2\u832B\u8292",
  mao: "\u732B\u6BDB\u5E3D\u8C8C\u5192",
  me: "\u4E48\u9EBC",
  mei: "\u7F8E\u6CA1\u6C92\u6BCF\u59B9\u7709\u6885\u5A92\u7164",
  men: "\u4EEC\u5011\u95E8\u9580\u95F7\u60B6",
  meng: "\u68A6\u5922\u731B\u8499\u840C",
  mi: "\u8FF7\u5BC6\u79D8\u871C\u7C73",
  mian: "\u9762\u9EB5\u7720\u7EF5\u514D",
  miao: "\u79D2\u63CF\u5999\u5E99",
  mie: "\u706D",
  min: "\u6C11\u654F",
  ming: "\u660E\u540D\u547D\u9E23",
  mo: "\u5BDE\u83AB\u9ED8\u78E8\u62B9\u6478\u9B54\u672B\u6A21",
  mou: "\u67D0\u8C0B",
  mu: "\u76EE\u6728\u6BCD\u5E55\u6155\u5893\u7267",
  na: "\u90A3\u54EA\u62FF\u7EB3\u5450",
  nai: "\u8010\u5976\u4E43",
  nan: "\u96BE\u96E3\u5357\u7537",
  nao: "\u607C\u60F1\u8111\u95F9",
  ne: "\u5462",
  nei: "\u5185",
  nen: "\u5AE9",
  neng: "\u80FD",
  ni: "\u4F60\u59B3\u5462\u6CE5\u9006\u62DF\u9713",
  nian: "\u5FF5\u5E74\u7C98",
  niang: "\u5A18",
  niao: "\u9E1F",
  nie: "\u634F",
  nin: "\u60A8",
  ning: "\u5B81\u51DD",
  niu: "\u725B\u626D",
  nong: "\u6D53\u5F04",
  nu: "\u6012\u52AA\u5973",
  nuan: "\u6696",
  nuo: "\u8BFA\u8AFE",
  nv: "\u5973",
  o: "\u54E6",
  ou: "\u5076\u6B27",
  pa: "\u6015\u722C\u8DB4",
  pai: "\u62CD\u6392\u6D3E\u724C",
  pan: "\u76FC\u76D8\u5224",
  pang: "\u65C1\u80D6",
  pao: "\u8DD1\u629B\u6CE1\u70AE",
  pei: "\u966A\u914D\u4F69",
  pen: "\u55B7",
  peng: "\u670B\u78B0\u6367\u68DA",
  pi: "\u76AE\u75B2\u813E\u6279\u62AB",
  pian: "\u7247\u9A97\u504F\u7BC7",
  piao: "\u98D8\u98C4\u7968\u6F02",
  pie: "\u6487",
  pin: "\u62FC\u54C1\u8D2B",
  ping: "\u5E73\u74F6\u8BC4\u51ED",
  po: "\u7834\u6CCA\u5761",
  pou: "\u5256",
  pu: "\u666E\u6251\u94FA",
  qi: "\u8D77\u671F\u4E03\u5947\u5176\u6C14\u6C23\u9F50\u5F03\u4F01\u542F\u555F\u6CE3\u59BB",
  qia: "\u6070",
  qian: "\u524D\u7275\u727D\u5343\u6D45\u6DFA\u94B1\u6B20\u7B7E",
  qiang: "\u5F3A\u5F37\u5899\u62A2\u67AA",
  qiao: "\u6865\u6A4B\u6084\u6572\u77A7\u5DE7",
  qie: "\u5207\u4E14\u7A83\u602F",
  qin: "\u4EB2\u89AA\u7434\u52E4\u4FB5",
  qing: "\u60C5\u6674\u6E05\u9752\u8F7B\u8F15\u8BF7\u8ACB\u503E",
  qiong: "\u7A77",
  qiu: "\u79CB\u6C42\u7403",
  qu: "\u53BB\u66F2\u53D6\u8DA3\u533A\u9A71",
  quan: "\u5168\u6CC9\u529D\u5708",
  que: "\u5374\u537B\u7F3A\u786E",
  qun: "\u7FA4\u88D9",
  ran: "\u7136\u71C3\u67D3",
  rang: "\u8BA9\u8B93\u56B7",
  rao: "\u7ED5\u7E5E",
  re: "\u70ED\u71B1\u60F9",
  ren: "\u4EBA\u8BA4\u8A8D\u5FCD\u4EFB\u4EC1",
  reng: "\u4ECD\u6254",
  ri: "\u65E5",
  rong: "\u5BB9\u8363\u69AE\u878D\u6EB6",
  rou: "\u67D4\u8089",
  ru: "\u5982\u5165\u4E73",
  ruan: "\u8F6F",
  rui: "\u9510\u745E",
  run: "\u6DA6",
  ruo: "\u82E5\u5F31",
  sa: "\u6D12\u6492",
  sai: "\u8D5B",
  san: "\u6563\u4E09\u4F1E\u5098",
  sang: "\u4E27\u6851",
  sao: "\u626B\u9A9A",
  se: "\u8272\u6DA9",
  sen: "\u68EE",
  sha: "\u50BB\u6C99\u6740",
  shai: "\u6652",
  shan: "\u5C71\u95EA\u9583\u5584\u6247\u886B",
  shang: "\u4F24\u50B7\u4E0A\u5C1A\u8D4F\u5546",
  shao: "\u5C11\u70E7\u71D2\u7A0D",
  she: "\u820D\u8BBE\u793E\u5C04\u86C7",
  shei: "\u8C01\u8AB0",
  shen: "\u6DF1\u8EAB\u795E\u4EC0\u4F38\u5BA1",
  sheng: "\u58F0\u8072\u751F\u5347\u80DC\u52DD\u5269\u5723",
  shi: "\u662F\u4E8B\u65F6\u6642\u4E16\u5341\u5B9E\u5BE6\u8BC6\u8B58\u59CB\u8BD5\u8A93\u5931\u5BA4\u5E02\u89C6\u8996\u6E7F\u8BD7\u8A69\u77F3",
  shou: "\u624B\u5B88\u53D7\u6536\u9996\u7626\u719F",
  shu: "\u4E66\u66F8\u6570\u6578\u6811\u6A39\u8F93\u8F38\u719F\u675F\u5C5E",
  shua: "\u5237",
  shuai: "\u8870\u7529\u5E05",
  shuan: "\u62F4",
  shuang: "\u53CC\u96D9\u971C\u723D",
  shui: "\u6C34\u8C01\u8AB0\u7761\u7A0E",
  shun: "\u987A\u77AC",
  shuo: "\u8BF4\u8AAA\u7855",
  si: "\u601D\u6B7B\u4F3C\u79C1\u4E1D\u56DB\u53F8\u6495",
  song: "\u9001\u677E\u9B06\u9882",
  sou: "\u641C",
  su: "\u8BC9\u8A34\u901F\u7D20\u82CF\u5BBF",
  suan: "\u7B97\u9178",
  sui: "\u5C81\u6B72\u788E\u968F\u867D\u96D6",
  sun: "\u635F\u5B59",
  suo: "\u6240\u9501\u9396\u7F29",
  ta: "\u4ED6\u5979\u5B83\u8E0F\u5854",
  tai: "\u592A\u53F0\u6001\u614B\u62AC",
  tan: "\u8C08\u8AC7\u53F9\u5606\u63A2\u5F39\u8D2A",
  tang: "\u6DCC\u8EBA\u7CD6\u6C64\u5802",
  tao: "\u9003\u8BA8\u5957\u6843",
  te: "\u7279",
  teng: "\u75BC\u817E",
  ti: "\u4F53\u9AD4\u63D0\u9898\u66FF\u8E22",
  tian: "\u5929\u751C\u7530\u586B\u6DFB",
  tiao: "\u8DF3\u8C03\u689D\u6761\u6311",
  tie: "\u8D34\u8CBC\u94C1\u9435",
  ting: "\u542C\u807D\u505C\u633A\u5EAD",
  tong: "\u75DB\u540C\u901A\u7AE5\u94DC\u9285\u7EDF",
  tou: "\u5934\u982D\u900F\u5077\u6295",
  tu: "\u56FE\u5716\u571F\u7A81\u6D82\u5410\u5F92",
  tuan: "\u56E2",
  tui: "\u9000\u63A8\u817F",
  tun: "\u541E",
  tuo: "\u8131\u812B\u62D6\u59A5",
  wa: "\u54C7\u6316\u74E6",
  wai: "\u5916\u6B6A",
  wan: "\u665A\u4E07\u842C\u5B8C\u5F2F\u5F4E\u73A9\u633D\u7897",
  wang: "\u5FD8\u671B\u5F80\u738B\u7F51",
  wei: "\u4E3A\u70BA\u5FAE\u552F\u4F4D\u672A\u5473\u5A01\u56F4\u59D4\u6170\u5C3E",
  wen: "\u6E29\u6EAB\u95EE\u554F\u6587\u7A33\u543B\u95FB",
  wo: "\u6211\u63E1\u7A9D",
  wu: "\u65E0\u7121\u7269\u4E94\u96FE\u9727\u821E\u5348\u609F\u8BEF\u5C4B",
  xi: "\u897F\u5E0C\u606F\u60DC\u559C\u5438\u7EC6\u5915\u6D17\u5E2D\u4E60",
  xia: "\u4E0B\u590F\u5413\u971E\u778E",
  xian: "\u5148\u73B0\u73FE\u7EBF\u7DDA\u9C9C\u9BAE\u4ED9\u663E\u9669\u9650",
  xiang: "\u60F3\u76F8\u9999\u5411\u54CD\u97FF\u50CF\u8C61\u4E61",
  xiao: "\u7B11\u5C0F\u6D88\u6548\u6653\u5BB5",
  xie: "\u5199\u5BEB\u8C22\u8B1D\u4E9B\u978B\u659C\u643A",
  xin: "\u5FC3\u65B0\u4FE1\u6B23\u8F9B",
  xing: "\u661F\u884C\u5E78\u9192\u6027\u5F62\u5174",
  xiong: "\u80F8\u5144\u96C4",
  xiu: "\u4F11\u4FEE\u7F9E\u8896",
  xu: "\u9700\u987B\u8A31\u8BB8\u865A\u865B\u7EED\u7E8C\u5E8F",
  xuan: "\u9009\u9078\u65CB\u60AC",
  xue: "\u96EA\u5B66\u8840",
  xun: "\u5BFB\u5C0B\u8BAD\u8FC5",
  ya: "\u5440\u538B\u96C5\u7259\u4E9A",
  yan: "\u773C\u70DF\u7159\u989C\u984F\u8A00\u6F14\u4E25\u5EF6\u538C",
  yang: "\u9633\u967D\u6837\u6A23\u7F8A\u6D0B\u626C\u517B",
  yao: "\u8981\u9065\u9059\u6447\u6416\u836F\u54AC\u8170\u8000",
  ye: "\u591C\u4E5F\u53F6\u8449\u4E1A\u9875\u9801\u91CE",
  yi: "\u4E00\u4EE5\u5DF2\u610F\u5FC6\u61B6\u4F9D\u79FB\u7591\u8863\u4E49\u6613\u5F02\u4EBF\u5104",
  yin: "\u56E0\u97F3\u9634\u9670\u5F15\u94F6\u9280\u9690\u5370\u996E",
  ying: "\u5F71\u5E94\u61C9\u8FCE\u82F1\u6620\u8D62\u8D0F\u786C\u6A31",
  yong: "\u6C38\u62E5\u64C1\u7528\u52C7",
  you: "\u6709\u53CB\u53C8\u7531\u6E38\u6CB9\u4F18\u5FE7\u6182\u72B9",
  yu: "\u96E8\u4E0E\u8207\u8BED\u8A9E\u5B87\u4E8E\u65BC\u9047\u4F59\u6B32\u6108\u6109",
  yuan: "\u8FDC\u9060\u613F\u9858\u7F18\u7DE3\u5143\u539F\u5706\u5712\u56ED",
  yue: "\u6708\u8D8A\u7EA6\u7D04\u4E50\u60A6",
  yun: "\u4E91\u96F2\u8FD0\u904B\u97F5\u97FB\u6655\u5141",
  za: "\u6742\u7838",
  zai: "\u5728\u518D\u8F7D",
  zan: "\u6682\u66AB\u8D5E",
  zang: "\u810F\u846C",
  zao: "\u65E9\u9020\u906D\u7CDF",
  ze: "\u5219\u8D23\u8CAC\u62E9\u6FA4",
  zen: "\u600E",
  zeng: "\u589E\u66FE",
  zha: "\u624E\u70B8",
  zhai: "\u6458\u7A84",
  zhan: "\u7AD9\u6218\u6230\u5C55\u5360",
  zhang: "\u5F20\u5F35\u957F\u638C\u6DA8\u8D26",
  zhao: "\u627E\u7167\u62DB\u7740\u671D",
  zhe: "\u8FD9\u9019\u7740\u8457\u6298\u906E",
  zhen: "\u771F\u73CD\u9635\u9663\u9707\u9488",
  zheng: "\u6B63\u4E89\u722D\u6574\u8BC1\u7741",
  zhi: "\u53EA\u77E5\u76F4\u503C\u4E4B\u6307\u7EB8\u7D19\u6B62\u81F3\u6CBB\u5FD7\u652F\u679D",
  zhong: "\u4E2D\u7EC8\u7D42\u949F\u9418\u91CD\u79CD\u7A2E\u4F17",
  zhou: "\u5468\u6D32\u663C",
  zhu: "\u4F4F\u795D\u6CE8\u4E3B\u52A9\u67F1\u73E0\u7AF9\u732A",
  zhua: "\u6293",
  zhuan: "\u8F6C\u8F49\u4E13\u7816",
  zhuang: "\u88C5\u649E\u58EE\u72B6",
  zhui: "\u8FFD\u5760",
  zhun: "\u51C6\u6E96",
  zhuo: "\u684C\u6349",
  zi: "\u81EA\u5B57\u5B50\u7D2B\u8D44\u4ED4",
  zong: "\u603B\u7E3D\u7EB5",
  zou: "\u8D70",
  zu: "\u8DB3\u7EC4\u963B\u79DF\u7956",
  zuan: "\u94BB\u947D",
  zui: "\u6700\u9189\u5634",
  zun: "\u5C0A\u9075",
  zuo: "\u505A\u4F5C\u5750\u5EA7\u6628"
};
var HANZI_TO_PINYIN = {};
for (const [py, chars] of Object.entries(PINYIN_GROUPS)) {
  for (const ch of chars) {
    if (!HANZI_TO_PINYIN[ch]) {
      HANZI_TO_PINYIN[ch] = py;
    }
  }
}
function mandarinCharToPinyin(ch) {
  const clean = String(ch || "").trim();
  if (!clean) return "";
  if (HANZI_TO_PINYIN[clean]) return HANZI_TO_PINYIN[clean];
  const simp = TO_SIMPLIFIED[clean];
  if (simp && HANZI_TO_PINYIN[simp]) return HANZI_TO_PINYIN[simp];
  return "";
}
function pinyinPhoneticSim(pyA, pyB) {
  if (!pyA || !pyB) return 0;
  if (pyA === pyB) return 0.92;
  const normFuzzy = (p) => p.replace(/^zh/, "z").replace(/^ch/, "c").replace(/^sh/, "s").replace(/^n/, "l").replace(/ing$/, "in").replace(/eng$/, "en").replace(/ang$/, "an");
  if (normFuzzy(pyA) === normFuzzy(pyB)) return 0.84;
  return 0;
}
function mandarinCharSimilarity(a, b) {
  const ca = normalizeHanziBase(a.replace(/[，。！？、；：…,.!?;:]/g, ""));
  const cb = normalizeHanziBase(b.replace(/[，。！？、；：…,.!?;:]/g, ""));
  if (!ca || !cb) return 0;
  if (ca === cb) return 1;
  if (ca.length === 1 && cb.length === 1) {
    const pa = mandarinCharToPinyin(ca);
    const pb = mandarinCharToPinyin(cb);
    return pinyinPhoneticSim(pa, pb);
  }
  return 0;
}
var ZH_COLLOCATION_FIXES = {
  // Casual / phonetic typos -> correct Simplified Chinese
  \u56E0\u4F4D: "\u56E0\u4E3A",
  \u6240\u5DF2: "\u6240\u4EE5",
  \u4E00\u503C: "\u4E00\u76F4",
  \u4EE5\u7ECF: "\u5DF2\u7ECF",
  \u5DF2\u524D: "\u4EE5\u524D",
  \u5DF2\u540E: "\u4EE5\u540E",
  \u65F6\u4FAF: "\u65F6\u5019",
  \u65F6\u540E: "\u65F6\u5019",
  \u5728\u89C1: "\u518D\u89C1",
  \u5728\u6B21: "\u518D\u6B21",
  \u5728\u8BF4: "\u518D\u8BF4",
  \u5728\u4E5F: "\u518D\u4E5F",
  \u73B0\u518D: "\u73B0\u5728",
  \u89C9\u7684: "\u89C9\u5F97",
  \u56E0\u8BE5: "\u5E94\u8BE5",
  \u867D\u71C3: "\u867D\u7136",
  \u4F46\u4E8B: "\u4F46\u662F",
  \u5982\u8FC7: "\u5982\u679C",
  \u6216\u7740: "\u6216\u8005",
  \u975E\u957F: "\u975E\u5E38",
  \u6CA1\u6CB9: "\u6CA1\u6709",
  \u4EC0\u83AB: "\u4EC0\u4E48",
  \u600E\u83AB: "\u600E\u4E48",
  \u4E3A\u4EC0\u83AB: "\u4E3A\u4EC0\u4E48",
  \u5FEB\u843D: "\u5FEB\u4E50",
  \u5E78\u5E45: "\u5E78\u798F",
  \u5E78\u8914: "\u5E78\u798F",
  \u6E29\u6CB9: "\u6E29\u67D4",
  \u5FAE\u6548: "\u5FAE\u7B11",
  \u773C\u7D2F: "\u773C\u6CEA",
  \u68A6\u76F8: "\u68A6\u60F3",
  \u56DE\u4EBF: "\u56DE\u5FC6",
  \u4E16\u4ECB: "\u4E16\u754C",
  \u5B9E\u95F4: "\u65F6\u95F4",
  \u6C38\u613F: "\u6C38\u8FDC",
  \u6C38\u8FD0: "\u6C38\u8FDC",
  \u6C38\u6562: "\u52C7\u6562",
  \u575A\u9A70: "\u575A\u6301",
  \u611F\u4E1C: "\u611F\u52A8",
  \u5B89\u51C0: "\u5B89\u9759",
  \u5B64\u8BFB: "\u5B64\u72EC",
  \u8BB0\u5BDE: "\u5BC2\u5BDE",
  \u966A\u529E: "\u966A\u4F34",
  \u771F\u60DC: "\u73CD\u60DC",
  \u671B\u8BB0: "\u5FD8\u8BB0",
  \u6210\u8BFA: "\u627F\u8BFA",
  \u7B49\u4EE3: "\u7B49\u5F85",
  \u7B49\u5E26: "\u7B49\u5F85",
  \u76F8\u5FC3: "\u76F8\u4FE1",
  \u5E0C\u5FD8: "\u5E0C\u671B",
  \u611F\u89D2: "\u611F\u89C9",
  \u8EAB\u97F3: "\u58F0\u97F3",
  \u54E5\u8BCD: "\u6B4C\u8BCD",
  \u6B4C\u8F9E: "\u6B4C\u8BCD",
  \u9009\u5F8B: "\u65CB\u5F8B",
  \u540D\u5929: "\u660E\u5929",
  \u4F5C\u5929: "\u6628\u5929",
  \u4ECA\u6DFB: "\u4ECA\u5929",
  \u670B\u6709: "\u670B\u53CB",
  \u4FDD\u8D1D: "\u5B9D\u8D1D",
  \u4EB2\u54C0: "\u4EB2\u7231",
  \u6D6A\u6162: "\u6D6A\u6F2B",
  \u7F8E\u529B: "\u7F8E\u4E3D",
  \u8F7B\u6625: "\u9752\u6625",
  \u6768\u5149: "\u9633\u5149",
  \u6E29\u66A7: "\u6E29\u6696",
  \u540D\u767D: "\u660E\u767D",
  \u51B3\u8BA2: "\u51B3\u5B9A",
  \u4E00\u8BA2: "\u4E00\u5B9A",
  \u4E00\u7F8A: "\u4E00\u6837",
  \u4E00\u4F01: "\u4E00\u8D77",
  \u4E00\u7A83: "\u4E00\u5207",
  \u597D\u8C61: "\u597D\u50CF",
  \u4EE5\u5FAE: "\u4EE5\u4E3A",
  \u559C\u7FFB: "\u559C\u6B22",
  \u4E0D\u5AE9: "\u4E0D\u80FD",
  \u4E0D\u836F: "\u4E0D\u8981",
  \u770B\u4EF6: "\u770B\u89C1",
  \u542C\u4EF6: "\u542C\u89C1",
  \u5FC3\u8C03: "\u5FC3\u8DF3",
  \u771F\u5730: "\u771F\u7684",
  \u62DB\u987E: "\u7167\u987E",
  \u4FDD\u7D27: "\u62B1\u7D27",
  \u9632\u624B: "\u653E\u624B",
  \u56DE\u6295: "\u56DE\u5934",
  \u7ECF\u679C: "\u7ECF\u8FC7",
  \u8BE5\u53D8: "\u6539\u53D8",
  \u4ECE\u94B1: "\u4ECE\u524D",
  \u77E5\u524D: "\u4E4B\u524D",
  \u505A\u68A6: "\u505A\u68A6",
  \u5728\u4F5C: "\u5728\u505A",
  \u5FC5\u9700\u8981: "\u5FC5\u987B\u8981",
  \u5149\u5FD9: "\u5149\u8292",
  \u5FC3\u5149: "\u661F\u5149",
  \u6708\u51C9: "\u6708\u4EAE",
  \u6E05\u6E05: "\u8F7B\u8F7B",
  \u6F2B\u6F2B: "\u6162\u6162",
  \u597D\u53F7: "\u597D\u597D",
  \u5B50\u7EC6: "\u4ED4\u7EC6",
  \u7EC8\u65BC: "\u7EC8\u4E8E",
  \u751A\u4E48: "\u4EC0\u4E48"
};
var ZH_LEXICON_RAW = "\u56E0\u4E3A \u6240\u4EE5 \u4E00\u76F4 \u4EE5\u524D \u4EE5\u540E \u5DF2\u7ECF \u65F6\u5019 \u518D\u89C1 \u518D\u6B21 \u518D\u8BF4 \u518D\u4E5F \u73B0\u5728 \u89C9\u5F97 \u5E94\u8BE5 \u867D\u7136 \u4F46\u662F \u5982\u679C \u6216\u8005 \u975E\u5E38 \u6CA1\u6709 \u4EC0\u4E48 \u600E\u4E48 \u5FEB\u4E50 \u5E78\u798F \u6E29\u67D4 \u5FAE\u7B11 \u773C\u6CEA \u68A6\u60F3 \u601D\u5FF5 \u56DE\u5FC6 \u4E16\u754C \u65F6\u95F4 \u6C38\u8FDC \u4ECE\u524D \u52C7\u6562 \u575A\u6301 \u611F\u52A8 \u5B89\u9759 \u5B64\u72EC \u5BC2\u5BDE \u966A\u4F34 \u73CD\u60DC \u79BB\u5F00 \u5FD8\u8BB0 \u627F\u8BFA \u7B49\u5F85 \u76F8\u4FE1 \u5E0C\u671B \u5149\u8292 \u661F\u5149 \u661F\u7A7A \u6708\u4EAE \u5929\u7A7A \u5FAE\u98CE \u58F0\u97F3 \u6B4C\u8BCD \u65CB\u5F8B \u660E\u5929 \u6628\u5929 \u4ECA\u5929 \u670B\u53CB \u5B9D\u8D1D \u4EB2\u7231 \u6D6A\u6F2B \u7F8E\u4E3D \u9752\u6625 \u9633\u5149 \u6E29\u6696 \u7167\u987E \u62B1\u7D27 \u653E\u624B \u56DE\u5934 \u6539\u53D8 \u660E\u767D \u51B3\u5B9A \u5176\u5B9E \u7EC8\u4E8E \u4E00\u5B9A \u4E00\u5207 \u4E00\u6837 \u4E00\u8D77 \u770B\u89C1 \u542C\u89C1 \u611F\u89C9 \u5FC3\u8DF3 \u559C\u6B22 \u7231\u4E0A \u7231\u4F60 \u60F3\u4F60 \u7B49\u4F60 \u62E5\u6709 \u5931\u53BB \u53D1\u73B0 \u77E5\u9053 \u5F00\u59CB \u7ED3\u675F \u7EE7\u7EED \u8FC7\u53BB \u672A\u6765 \u751F\u547D \u751F\u6D3B \u4EBA\u751F \u7075\u9B42 \u5FC3\u4E2D \u5FC3\u91CC \u773C\u91CC \u8EAB\u8FB9 \u5929\u8FB9 \u6D77\u8FB9 \u57CE\u5E02 \u8857\u5934 \u96E8\u591C \u9ED1\u591C \u591C\u665A \u6E05\u6668 \u9EC4\u660F \u6D41\u661F \u8774\u8776 \u82B1\u6735 \u843D\u53F6 \u6D77\u6D0B \u5FAE\u5149 \u95EA\u70C1 \u547C\u5438 \u79D8\u5BC6 \u5947\u8FF9 \u529B\u91CF \u81EA\u7531 \u98DE\u7FD4 \u5954\u8DD1 \u8FFD\u9010 \u5BFB\u627E \u5B88\u5019 \u4F9D\u9760 \u7275\u624B \u62E5\u62B1 \u6D41\u6CEA \u54ED\u6CE3 \u6B22\u7B11 \u751C\u871C \u75DB\u82E6 \u60B2\u4F24 \u5FE7\u4F24 \u5FC3\u75DB \u5FC3\u788E \u9519\u8FC7 \u9047\u89C1 \u76F8\u9022 \u91CD\u9022 \u5206\u79BB \u544A\u522B \u795D\u798F \u7948\u7977 \u613F\u671B \u98CE\u666F \u753B\u9762 \u8BB0\u5FC6 \u6545\u4E8B \u65E5\u8BB0 \u5199\u4FE1 \u8BD7\u6B4C \u97F3\u4E50 \u8282\u594F \u8282\u62CD \u821E\u53F0 \u706F\u5149 \u638C\u58F0 \u5C81\u6708 \u65F6\u5149 \u5E74\u534E \u5B63\u8282 \u6625\u5929 \u590F\u5929 \u79CB\u5929 \u51AC\u5929 \u767D\u96EA \u7EC6\u96E8 \u5F69\u8679 \u4E91\u6735 \u592A\u9633 \u671D\u971E \u665A\u971E \u665A\u98CE \u5BD2\u98CE \u6625\u98CE \u79CB\u98CE \u96EA\u82B1 \u70DF\u706B \u9713\u8679 \u8DEF\u53E3 \u8F66\u7AD9 \u8FDC\u65B9 \u5BB6\u4E61 \u6545\u4E61 \u4E2D\u56FD \u4E2D\u6587 \u5317\u4EAC \u4E0A\u6D77 \u53F0\u5317 \u9999\u6E2F \u5730\u7403 \u5B87\u5B99 \u94F6\u6CB3 \u661F\u6CB3 \u5929\u6DAF \u6D77\u89D2 \u77AC\u95F4 \u6C38\u6052 \u771F\u5B9E \u6E05\u9192 \u6C89\u9189 \u8FF7\u832B \u575A\u5B9A \u8BA4\u771F \u4ED4\u7EC6 \u7B80\u5355 \u590D\u6742 \u666E\u901A \u7279\u522B \u5B8C\u7F8E \u9057\u61BE \u540E\u6094 \u539F\u8C05 \u611F\u8C22 \u8C22\u8C22 \u5BF9\u4E0D\u8D77 \u6CA1\u5173\u7CFB \u4E3A\u4EC0\u4E48 \u5168\u4E16\u754C \u4E00\u8F88\u5B50 \u4E00\u77AC\u95F4 \u4E0D\u80FD \u4E0D\u8981 \u4EE5\u4E3A \u53EA\u80FD \u53EA\u6709 \u53EA\u8981 \u53EA\u8981\u6709 \u597D\u597D \u6162\u6162 \u8F7B\u8F7B \u6084\u6084 \u6E10\u6E10 \u7A81\u7136 \u5FFD\u7136 \u8FD8\u662F \u8FD8\u662F\u4F1A \u8FD8\u662F\u4F60 \u4E0D\u662F \u4E0D\u518D \u4E0D\u60F3 \u4E0D\u6562 \u4E0D\u61C2 \u4E0D\u89C1 \u4E00\u70B9 \u4E00\u8D77\u8D70 \u7231\u8FC7 \u9519\u8FC7 \u7ECF\u8FC7 \u8D70\u8FC7 \u5531\u51FA \u8BF4\u51FA \u542C\u89C1\u4F60 \u770B\u89C1\u4F60 \u53EA\u8981\u4F60 \u5929\u6C14 \u771F\u597D \u5F88\u597D \u6BCF\u5929 \u5929\u5929 \u4F60\u597D \u8BB0\u5F97 \u5F00\u5FC3 \u7F8E\u597D \u76F8\u7231 \u76F8\u4F34 \u6C38\u8FDC\u7231\u4F60 \u5728\u4E4E \u5728\u610F \u5FC3\u52A8 \u611F\u52A8 \u5FC3\u613F \u7F18\u5206 \u73CD\u60DC\u4F60 \u5B88\u62A4 \u4E00\u76F4\u90FD\u5728";
var ZH_COMMON_WORDS = new Set(ZH_LEXICON_RAW.split(/\s+/).filter(Boolean));
for (const w of Array.from(ZH_COMMON_WORDS)) {
  const trad = harmonizeMandarinScript(w, "zh-Hant");
  if (trad !== w) ZH_COMMON_WORDS.add(trad);
}
function fixMandarinCollocationsAndPunctuation(rawLine, targetScript = "auto") {
  let line = String(rawLine || "").trim();
  const changes = [];
  if (!line || !containsHanzi(line)) {
    return { correctedLine: line, changes };
  }
  const spaceCleaned = line.replace(/([\u4e00-\u9fff\u3400-\u4dbf])\s+(?=[\u4e00-\u9fff\u3400-\u4dbf，。！？；：、])/g, "$1").replace(/([\u4e00-\u9fff\u3400-\u4dbf])\s+([,.!?;:])(?=\s|$|[\u4e00-\u9fff])/g, "$1$2").replace(/([，。！？；：])\s+/g, "$1");
  if (spaceCleaned !== line) {
    line = spaceCleaned;
  }
  if (targetScript === "zh-Hans" || targetScript === "zh-Hant") {
    const harmonized = harmonizeMandarinScript(line, targetScript);
    if (harmonized !== line) {
      const charsBefore = Array.from(line);
      const charsAfter = Array.from(harmonized);
      for (let i = 0; i < Math.min(charsBefore.length, charsAfter.length); i++) {
        if (charsBefore[i] !== charsAfter[i]) {
          changes.push({ original: charsBefore[i], corrected: charsAfter[i], source: "orthography" });
        }
      }
      line = harmonized;
    }
  }
  const effectiveScript = targetScript === "auto" ? detectMandarinScript(line) : targetScript;
  for (const [wrong, rightBase] of Object.entries(ZH_COLLOCATION_FIXES)) {
    if (wrong === rightBase) continue;
    if (wrong === "\u6E05\u6E05" || wrong === "\u6F2B\u6F2B") continue;
    if (effectiveScript === "zh-Hant" && (wrong === "\u7D42\u65BC" || wrong === "\u751A\u4E48")) continue;
    const right = effectiveScript === "zh-Hant" ? harmonizeMandarinScript(rightBase, "zh-Hant") : rightBase;
    if (line.includes(wrong) && wrong !== right) {
      line = line.split(wrong).join(right);
      changes.push({ original: wrong, corrected: right, source: "orthography" });
    }
    const wrongTrad = harmonizeMandarinScript(wrong, "zh-Hant");
    if (wrongTrad !== wrong && line.includes(wrongTrad) && wrongTrad !== right) {
      line = line.split(wrongTrad).join(right);
      changes.push({ original: wrongTrad, corrected: right, source: "orthography" });
    }
  }
  return { correctedLine: line, changes };
}
function evaluateMandarinVoiceRepair(userCharRaw, prevCharInLine, nextCharInLine, voiceCharRaw, voiceConf, targetScript = "auto") {
  const punctTail = (userCharRaw.match(/[，。！？、；：…,.!?;:]+$/) || [""])[0];
  const uCh = punctTail ? userCharRaw.slice(0, -punctTail.length) : userCharRaw;
  const vCleanRaw = String(voiceCharRaw || "").replace(/[，。！？、；：…,.!?;:\s]/g, "");
  if (uCh.length !== 1 || !containsHanzi(uCh) || !vCleanRaw || !containsHanzi(vCleanRaw)) {
    return { shouldReplace: false, finalChar: userCharRaw };
  }
  const vCh0 = Array.from(vCleanRaw)[0];
  const effScript = targetScript === "auto" ? detectMandarinScript(`${prevCharInLine}${uCh}${nextCharInLine}`) : targetScript;
  const vCh = harmonizeMandarinScript(vCh0, effScript);
  if (normalizeHanziBase(uCh) === normalizeHanziBase(vCh)) {
    return { shouldReplace: false, finalChar: userCharRaw };
  }
  const pySim = mandarinCharSimilarity(uCh, vCh);
  if (voiceConf < 0.78 || pySim < 0.8) {
    return { shouldReplace: false, finalChar: userCharRaw };
  }
  const prevC = prevCharInLine.replace(/[，。！？、；：…,.!?;:\s]/g, "");
  const nextC = nextCharInLine.replace(/[，。！？、；：…,.!?;:\s]/g, "");
  const userHasLeftWord = Boolean(prevC && ZH_COMMON_WORDS.has(`${prevC}${uCh}`));
  const userHasRightWord = Boolean(nextC && ZH_COMMON_WORDS.has(`${uCh}${nextC}`));
  if (userHasLeftWord || userHasRightWord) {
    return { shouldReplace: false, finalChar: userCharRaw };
  }
  const voiceFormsLeftWord = Boolean(prevC && ZH_COMMON_WORDS.has(`${prevC}${vCh}`));
  const voiceFormsRightWord = Boolean(nextC && ZH_COMMON_WORDS.has(`${vCh}${nextC}`));
  if (voiceFormsLeftWord || voiceFormsRightWord) {
    return { shouldReplace: true, finalChar: `${vCh}${punctTail}` };
  }
  return { shouldReplace: false, finalChar: userCharRaw };
}

// server/services/lyricSpellReconciler.ts
var FR_UNAMBIGUOUS_FIXES = {
  // Contractions & elisions
  jai: "j'ai",
  taime: "t'aime",
  maime: "m'aime",
  saime: "s'aime",
  laime: "l'aime",
  naime: "n'aime",
  jetaime: "je t'aime",
  cest: "c'est",
  nest: "n'est",
  sest: "s'est",
  quil: "qu'il",
  quils: "qu'ils",
  quon: "qu'on",
  dun: "d'un",
  dune: "d'une",
  aujourdhui: "aujourd'hui",
  jusqua: "jusqu'\xE0",
  lavenir: "l'avenir",
  lamour: "l'amour",
  lespoir: "l'espoir",
  lhistoire: "l'histoire",
  linstant: "l'instant",
  lombre: "l'ombre",
  letoile: "l'\xE9toile",
  lunivers: "l'univers",
  lhorizon: "l'horizon",
  lorizon: "l'horizon",
  parceque: "parce que",
  parsque: "parce que",
  biensur: "bien s\xFBr",
  peutetre: "peut-\xEAtre",
  beaucoups: "beaucoup",
  daccord: "d'accord",
  quelquun: "quelqu'un",
  quelqun: "quelqu'un",
  questce: "qu'est-ce",
  jen: "j'en",
  ten: "t'en",
  sen: "s'en",
  nen: "n'en",
  lenfer: "l'enfer",
  lautre: "l'autre",
  // Ligatures & unambiguous French diacritics / common typos
  coeur: "c\u0153ur",
  coeurs: "c\u0153urs",
  soeur: "s\u0153ur",
  soeurs: "s\u0153urs",
  voeu: "v\u0153u",
  voeux: "v\u0153ux",
  oeuvre: "\u0153uvre",
  oeuvres: "\u0153uvres",
  etre: "\xEAtre",
  ete: "\xE9t\xE9",
  etait: "\xE9tait",
  etaient: "\xE9taient",
  etais: "\xE9tais",
  reves: "r\xEAves",
  rever: "r\xEAver",
  revee: "r\xEAv\xE9e",
  reverie: "r\xEAverie",
  fenetre: "fen\xEAtre",
  fenetres: "fen\xEAtres",
  tempete: "temp\xEAte",
  tempetes: "temp\xEAtes",
  arreter: "arr\xEAter",
  arrete: "arr\xEAte",
  bientot: "bient\xF4t",
  plutot: "plut\xF4t",
  chateau: "ch\xE2teau",
  lumiere: "lumi\xE8re",
  lumieres: "lumi\xE8res",
  riviere: "rivi\xE8re",
  rivieres: "rivi\xE8res",
  priere: "pri\xE8re",
  prieres: "pri\xE8res",
  poussiere: "poussi\xE8re",
  premiere: "premi\xE8re",
  premieres: "premi\xE8res",
  derniere: "derni\xE8re",
  dernieres: "derni\xE8res",
  entiere: "enti\xE8re",
  entieres: "enti\xE8res",
  mystere: "myst\xE8re",
  mysteres: "myst\xE8res",
  planete: "plan\xE8te",
  planetes: "plan\xE8tes",
  probleme: "probl\xE8me",
  problemes: "probl\xE8mes",
  systeme: "syst\xE8me",
  poeme: "po\xE8me",
  poemes: "po\xE8mes",
  chaine: "cha\xEEne",
  chaines: "cha\xEEnes",
  colere: "col\xE8re",
  misere: "mis\xE8re",
  galere: "gal\xE8re",
  fievre: "fi\xE8vre",
  levre: "l\xE8vre",
  levres: "l\xE8vres",
  deja: "d\xE9j\xE0",
  voila: "voil\xE0",
  etoile: "\xE9toile",
  etoiles: "\xE9toiles",
  ephemere: "\xE9ph\xE9m\xE8re",
  melodie: "m\xE9lodie",
  melodies: "m\xE9lodies",
  poesie: "po\xE9sie",
  verite: "v\xE9rit\xE9",
  liberte: "libert\xE9",
  beaute: "beaut\xE9",
  eternite: "\xE9ternit\xE9",
  realite: "r\xE9alit\xE9",
  clarte: "clart\xE9",
  obscurite: "obscurit\xE9",
  fierte: "fiert\xE9",
  pensee: "pens\xE9e",
  pensees: "pens\xE9es",
  annee: "ann\xE9e",
  annees: "ann\xE9es",
  soiree: "soir\xE9e",
  soirees: "soir\xE9es",
  journee: "journ\xE9e",
  journees: "journ\xE9es",
  matinee: "matin\xE9e",
  destinee: "destin\xE9e",
  memoire: "m\xE9moire",
  memoires: "m\xE9moires",
  emotion: "\xE9motion",
  emotions: "\xE9motions",
  ecrire: "\xE9crire",
  ecoute: "\xE9coute",
  ecoutes: "\xE9coutes",
  ecouter: "\xE9couter",
  echappe: "\xE9chappe",
  echapper: "\xE9chapper",
  egare: "\xE9gar\xE9",
  egaree: "\xE9gar\xE9e",
  efface: "effac\xE9",
  effacer: "effacer",
  eclat: "\xE9clat",
  eclats: "\xE9clats",
  esperer: "esp\xE9rer",
  espere: "esp\xE8re",
  esperance: "esp\xE9rance",
  eternel: "\xE9ternel",
  eternelle: "\xE9ternelle",
  etincelle: "\xE9tincelle",
  etincelles: "\xE9tincelles",
  eveille: "\xE9veille",
  eveiller: "\xE9veiller",
  toujour: "toujours",
  jamai: "jamais",
  parol: "parole",
  parols: "paroles",
  musike: "musique",
  musik: "musique",
  silance: "silence",
  douceure: "douceur",
  douleure: "douleur",
  bonheure: "bonheur",
  malheure: "malheur",
  amoure: "amour",
  soleile: "soleil",
  magnific: "magnifique",
  magnifik: "magnifique",
  incroiab: "incroyable",
  incroiable: "incroyable",
  orthografe: "orthographe",
  ortographe: "orthographe",
  sincro: "synchro",
  syncro: "synchro",
  recois: "re\xE7ois",
  recoit: "re\xE7oit",
  garcon: "gar\xE7on",
  francais: "fran\xE7ais",
  francaise: "fran\xE7aise",
  ca: "\xE7a",
  brule: "br\xFBle",
  bruler: "br\xFBler",
  derriere: "derri\xE8re",
  reveille: "r\xE9veille",
  reveiller: "r\xE9veiller",
  repond: "r\xE9pond",
  reponds: "r\xE9ponds",
  reponse: "r\xE9ponse",
  desole: "d\xE9sol\xE9",
  desolee: "d\xE9sol\xE9e",
  malgre: "malgr\xE9",
  etrange: "\xE9trange",
  etranger: "\xE9tranger",
  ecris: "\xE9cris",
  ecrit: "\xE9crit",
  separe: "s\xE9pare",
  separee: "s\xE9par\xE9e",
  dechirer: "d\xE9chirer",
  dechire: "d\xE9chire",
  desir: "d\xE9sir",
  desirs: "d\xE9sirs",
  tresor: "tr\xE9sor",
  tresors: "tr\xE9sors",
  celeste: "c\xE9leste",
  legere: "l\xE9g\xE8re",
  leger: "l\xE9ger",
  fidele: "fid\xE8le",
  connaitre: "conna\xEEtre",
  paraitre: "para\xEEtre",
  disparaitre: "dispara\xEEtre",
  apparaitre: "appara\xEEtre"
};
var FR_CONTEXT_ONLY_FIXES = {
  reve: "r\xEAve",
  fete: "f\xEAte",
  fetes: "f\xEAtes",
  tete: "t\xEAte",
  tetes: "t\xEAtes",
  meme: "m\xEAme",
  memes: "m\xEAmes",
  ame: "\xE2me",
  ames: "\xE2mes",
  grace: "gr\xE2ce",
  mere: "m\xE8re",
  pere: "p\xE8re",
  frere: "fr\xE8re",
  freres: "fr\xE8res",
  tres: "tr\xE8s",
  apres: "apr\xE8s",
  pres: "pr\xE8s",
  aupres: "aupr\xE8s",
  scene: "sc\xE8ne",
  scenes: "sc\xE8nes",
  creation: "cr\xE9ation",
  generation: "g\xE9n\xE9ration",
  foret: "for\xEAt",
  forets: "for\xEAts",
  sil: "s'il",
  ny: "n'y",
  ou: "o\xF9",
  desire: "d\xE9sire",
  presence: "pr\xE9sence",
  experience: "exp\xE9rience",
  different: "diff\xE9rent",
  difference: "diff\xE9rence",
  sincere: "sinc\xE8re",
  severe: "s\xE9v\xE8re",
  role: "r\xF4le"
};
var EN_FIXES = {
  dont: "don't",
  cant: "can't",
  wont: "won't",
  didnt: "didn't",
  isnt: "isn't",
  arent: "aren't",
  wasnt: "wasn't",
  werent: "weren't",
  wouldnt: "wouldn't",
  couldnt: "couldn't",
  shouldnt: "shouldn't",
  havent: "haven't",
  hasnt: "hasn't",
  youre: "you're",
  youve: "you've",
  youll: "you'll",
  youd: "you'd",
  theyre: "they're",
  theyve: "they've",
  theyll: "they'll",
  thats: "that's",
  whats: "what's",
  wheres: "where's",
  whos: "who's",
  theres: "there's",
  heres: "here's",
  ive: "I've",
  tonite: "tonight",
  throu: "through",
  throught: "thought",
  beutiful: "beautiful",
  beautifull: "beautiful",
  forevr: "forever",
  forver: "forever",
  togehter: "together",
  togther: "together",
  recieve: "receive",
  beleive: "believe",
  seperate: "separate",
  definately: "definitely",
  untill: "until",
  teh: "the",
  adn: "and",
  becuase: "because",
  beacuse: "because",
  becuz: "because",
  rythm: "rhythm",
  rythms: "rhythms",
  melodi: "melody",
  felo: "fellow",
  hartbeat: "heartbeat",
  heartbeatt: "heartbeat",
  tommorow: "tomorrow",
  tomorow: "tomorrow",
  realy: "really",
  alon: "alone",
  alwys: "always",
  doesnt: "doesn't",
  shes: "she's",
  wat: "what",
  thnk: "thank",
  thnks: "thanks",
  freind: "friend",
  freinds: "friends",
  thier: "their",
  wiht: "with",
  nite: "night",
  amerika: "America"
};
var EN_CONTEXT_ONLY_FIXES = {
  im: "I'm"
};
function applyCasePattern(template, replacement) {
  if (!template) return replacement;
  const letters = template.replace(/[^A-Za-zÀ-ÿ]/g, "");
  if (letters.length > 1 && letters === letters.toUpperCase()) {
    return replacement.toUpperCase();
  }
  if (/^[A-ZÀ-ÖØ-Þ]/.test(template) && /^[a-zà-öø-ÿ]/.test(replacement)) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}
function looksFrenchLine(line, langHint = "auto") {
  const h = String(langHint || "auto").toLowerCase();
  if (h.startsWith("fr")) return true;
  const s = ` ${String(line || "").toLowerCase()} `;
  if (/[éèêëàâçùûüîïôœ]/.test(s)) return true;
  if (/\b(?:je|tu|il|elle|nous|vous|ils|elles|mon|ton|son|ma|ta|sa|mes|tes|ses|le|la|les|un|une|des|dans|avec|pour|sur|sous|sans|mais|comme|quand|tout|tous|est|suis|etre|cest|jai|coeur|lumiere|amour|chanson|voix|nuit|jour|rien|toujours|jamais)\b/.test(s)) {
    return true;
  }
  return false;
}
function looksEnglishLine(line, langHint = "auto") {
  const h = String(langHint || "auto").toLowerCase();
  if (h.startsWith("en")) return true;
  const s = ` ${String(line || "").toLowerCase()} `;
  if (/\b(?:i|you|we|they|the|and|with|for|from|this|that|your|my|our|love|night|heart|song|voice|feel|know|never|always|when|where|what|dont|cant|wont|youre|thats|im)\b/.test(s)) {
    return true;
  }
  return false;
}
function detectLyricsLanguage(lines, hintLang = "auto") {
  const h = String(hintLang || "auto").trim();
  if (h && h !== "auto" && h !== "multi") return h;
  const joined = lines.join("\n");
  if (containsHanzi(joined)) return detectMandarinScript(joined);
  if (/[\u3040-\u30ff]/.test(joined)) return "ja";
  if (/[\uac00-\ud7af]/.test(joined)) return "ko";
  const frHits = lines.filter((l) => looksFrenchLine(l, "auto")).length;
  const enHits = lines.filter((l) => looksEnglishLine(l, "auto")).length;
  if (frHits > 0 && enHits > 0 && Math.abs(frHits - enHits) <= 1) return "multi";
  if (frHits >= enHits && frHits > 0) return "fr";
  if (enHits > 0) return "en";
  return "auto";
}
function analyzeAndFixOrthography(rawLines, langHint = "auto") {
  const originalLines = rawLines.map((l) => String(l || ""));
  const detectedLanguage = detectLyricsLanguage(originalLines, langHint);
  const changes = [];
  const targetZhScript = langHint === "zh-Hans" || langHint === "zh" ? "zh-Hans" : langHint === "zh-Hant" ? "zh-Hant" : "auto";
  const correctedLines = originalLines.map((line, lineIdx) => {
    let trimmed = line.trim();
    if (!trimmed) return "";
    if (/^\[[^\]]+\]$/.test(trimmed)) return trimmed;
    if (containsHanzi(trimmed)) {
      const zhAudit = fixMandarinCollocationsAndPunctuation(trimmed, targetZhScript);
      if (zhAudit.correctedLine !== trimmed) {
        trimmed = zhAudit.correctedLine;
        zhAudit.changes.forEach((zc, zi) => {
          changes.push({
            lineIdx,
            wordIdx: zi,
            original: zc.original,
            corrected: zc.corrected,
            source: zc.source
          });
        });
      }
    }
    const isFr = looksFrenchLine(trimmed, detectedLanguage);
    const isEn = looksEnglishLine(trimmed, detectedLanguage);
    const parts = trimmed.split(/(\s+)/);
    let wordIdx = 0;
    for (let pi = 0; pi < parts.length; pi++) {
      const part = parts[pi];
      if (!part || /^\s+$/.test(part)) continue;
      const m = part.match(/^([¿¡"«'(\[]*)([A-Za-zÀ-ÿ\u0100-\u024f0-9'’\-]+)([.,!?;:…»"')\]♪♫]*)$/);
      if (!m) {
        wordIdx++;
        continue;
      }
      const [, prefix, core, suffix] = m;
      const lower = core.toLowerCase();
      let fixedCore = null;
      if (FR_UNAMBIGUOUS_FIXES[lower]) {
        fixedCore = FR_UNAMBIGUOUS_FIXES[lower];
      } else if (isFr && FR_CONTEXT_ONLY_FIXES[lower] && !(lower === "ou" && !isFr)) {
        if (lower !== "ou") {
          fixedCore = FR_CONTEXT_ONLY_FIXES[lower];
        }
      } else if (EN_FIXES[lower]) {
        fixedCore = EN_FIXES[lower];
      } else if (isEn && EN_CONTEXT_ONLY_FIXES[lower]) {
        fixedCore = EN_CONTEXT_ONLY_FIXES[lower];
      }
      if (fixedCore && fixedCore.toLowerCase() !== core.toLowerCase()) {
        const cased = applyCasePattern(core, fixedCore);
        const replacement = `${prefix}${cased}${suffix}`;
        if (replacement !== part) {
          parts[pi] = replacement;
          changes.push({
            lineIdx,
            wordIdx,
            original: part,
            corrected: replacement,
            source: "orthography"
          });
        }
      } else if (fixedCore && fixedCore !== core) {
        const cased = applyCasePattern(core, fixedCore);
        const replacement = `${prefix}${cased}${suffix}`;
        if (replacement !== part) {
          parts[pi] = replacement;
          changes.push({
            lineIdx,
            wordIdx,
            original: part,
            corrected: replacement,
            source: "orthography"
          });
        }
      }
      wordIdx++;
    }
    let rebuilt = parts.join("").replace(/[ \t]{2,}/g, " ").replace(/\s+([.,])/g, "$1").trim();
    if (/^[a-zà-öø-ÿ]/.test(rebuilt)) {
      const cap = rebuilt.charAt(0).toUpperCase() + rebuilt.slice(1);
      if (cap !== rebuilt) {
        rebuilt = cap;
      }
    }
    return rebuilt;
  });
  return {
    originalLines,
    correctedLines,
    correctedText: correctedLines.join("\n"),
    changes,
    detectedLanguage,
    spellingFixCount: changes.length
  };
}
function normAlpha(s) {
  return String(s || "").toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, "");
}
function editDistance(a, b) {
  const la = a.length, lb = b.length;
  const dp = Array.from({ length: la + 1 }, (_, i) => i);
  for (let j = 1; j <= lb; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= la; i++) {
      const tmp = dp[i];
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[la];
}
function evaluateVoiceWordRepair(userWordRaw, voiceWordRaw, phoneticSim, voiceRecConf, langHint = "auto", prevToken = "", nextToken = "") {
  const uCore = String(userWordRaw || "").trim();
  const wRaw = String(voiceWordRaw || "").trim();
  if (!uCore || !wRaw) return { shouldReplace: false, finalWord: uCore, reason: "none" };
  const wOrth = analyzeAndFixOrthography([wRaw], langHint).correctedLines[0] || wRaw;
  const wClean = wOrth.replace(/^[^A-Za-zÀ-ÿ0-9\u4e00-\u9fff]+|[^A-Za-zÀ-ÿ0-9\u4e00-\u9fff'’\-]+$/g, "");
  if (!wClean) return { shouldReplace: false, finalWord: uCore, reason: "none" };
  const uPunctTail = (uCore.match(/[.,!?;:…，。！？、；：]+$/) || [""])[0];
  const uCoreNoPunct = uPunctTail ? uCore.slice(0, -uPunctTail.length) : uCore;
  if (containsHanzi(uCoreNoPunct) && containsHanzi(wClean)) {
    const zhScript = langHint === "zh-Hans" || langHint === "zh" ? "zh-Hans" : langHint === "zh-Hant" ? "zh-Hant" : "auto";
    const zhRep = evaluateMandarinVoiceRepair(uCore, prevToken, nextToken, wClean, voiceRecConf, zhScript);
    if (zhRep.shouldReplace) {
      return { shouldReplace: true, finalWord: zhRep.finalChar, reason: "voice_phonetic" };
    }
    return { shouldReplace: false, finalWord: uCore, reason: "none" };
  }
  const nu = normAlpha(uCoreNoPunct);
  const nw = normAlpha(wClean);
  if (!nu || !nw) return { shouldReplace: false, finalWord: uCore, reason: "none" };
  if (nu === nw) {
    const uHasAccentOrApos = /[À-ÿ'’œæ]/.test(uCoreNoPunct);
    const wHasAccentOrApos = /[À-ÿ'’œæ]/.test(wClean);
    if (!uHasAccentOrApos && wHasAccentOrApos) {
      return {
        shouldReplace: true,
        finalWord: `${applyCasePattern(uCoreNoPunct, wClean)}${uPunctTail}`,
        reason: "voice_phonetic"
      };
    }
    return { shouldReplace: false, finalWord: uCore, reason: "none" };
  }
  const dist = editDistance(nu, nw);
  const maxLen = Math.max(nu.length, nw.length);
  const closeEdit = maxLen >= 4 && dist <= 2 || maxLen >= 7 && dist <= 3;
  const isCjk = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(nw);
  if (voiceRecConf >= 0.78 && !isCjk && phoneticSim >= 0.72 && closeEdit) {
    const onlySuffixDiff = nu.startsWith(nw) && /^(?:s|e|es|ed|er|ing|ly|ent)$/.test(nu.slice(nw.length)) || nw.startsWith(nu) && /^(?:s|e|es)$/.test(nw.slice(nu.length)) && voiceRecConf < 0.9;
    if (onlySuffixDiff) {
      return { shouldReplace: false, finalWord: uCore, reason: "none" };
    }
    return {
      shouldReplace: true,
      finalWord: `${applyCasePattern(uCoreNoPunct, wClean)}${uPunctTail}`,
      reason: "voice_phonetic"
    };
  }
  return { shouldReplace: false, finalWord: uCore, reason: "none" };
}

// server/services/whisperEngine.ts
var LANG_TO_WHISPER = {
  fr: "french",
  en: "english",
  "zh-hans": "chinese",
  "zh-hant": "chinese",
  zh: "chinese",
  ja: "japanese",
  ko: "korean",
  es: "spanish",
  de: "german",
  it: "italian",
  pt: "portuguese",
  ar: "arabic",
  ru: "russian",
  vi: "vietnamese",
  id: "indonesian",
  th: "thai"
};
var HALLUCINATION_PATTERNS = [
  /sous-titres?\s+(?:r[ée]alis[ée]s?|par|d['’])/i,
  /amara\.org/i,
  /merci\s+d['’]avoir\s+regard[ée]/i,
  /thank\s+you\s+for\s+watching/i,
  /thanks?\s+for\s+watching/i,
  /please\s+subscribe/i,
  /abonne[rz]?-?vous/i,
  /请不吝点赞|订阅.*频道|转发.*打赏|明镜与点点|优优独播剧场|感谢收看|谢谢观看|中文字幕|字幕提供|字幕制作/,
  /^[.\s,!?…\-♪♫*。，！？、；：]+$/,
  /^(?:you|hmm|uh|ah|oh)\.?$/i
];
var pipelinePromise = null;
var cachedReady = false;
function isWhisperWarm() {
  return cachedReady;
}
async function getWhisperPipeline() {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = path8.resolve(process.cwd(), ".cache/huggingface");
      const asr = await pipeline("automatic-speech-recognition", "Xenova/whisper-base", {
        dtype: { encoder_model: "q8", decoder_model_merged: "q8" }
      });
      cachedReady = true;
      return asr;
    })().catch((err) => {
      pipelinePromise = null;
      cachedReady = false;
      throw err;
    });
  }
  return pipelinePromise;
}
function warmupWhisper() {
  getWhisperPipeline().catch(() => {
  });
}
function decodeWavFallback(wavBuf) {
  if (wavBuf.length < 44) return null;
  if (wavBuf.toString("ascii", 0, 4) !== "RIFF" || wavBuf.toString("ascii", 8, 12) !== "WAVE") {
    return null;
  }
  let offset = 12;
  let channels = 1;
  let sampleRate = 16e3;
  let bitsPerSample = 16;
  let audioFormat = 1;
  let dataStart = -1;
  let dataSize = 0;
  while (offset + 8 <= wavBuf.length) {
    const chunkId = wavBuf.toString("ascii", offset, offset + 4);
    const chunkSize = wavBuf.readUInt32LE(offset + 4);
    if (chunkId === "fmt " && offset + 24 <= wavBuf.length) {
      audioFormat = wavBuf.readUInt16LE(offset + 8);
      channels = wavBuf.readUInt16LE(offset + 10);
      sampleRate = wavBuf.readUInt32LE(offset + 12);
      bitsPerSample = wavBuf.readUInt16LE(offset + 22);
    } else if (chunkId === "data") {
      dataStart = offset + 8;
      dataSize = Math.min(chunkSize, wavBuf.length - dataStart);
      break;
    }
    offset += 8 + chunkSize + chunkSize % 2;
  }
  if (dataStart < 0 || dataSize <= 0) return null;
  const bytesPerSample = Math.max(1, bitsPerSample >> 3);
  const frameSize = bytesPerSample * Math.max(1, channels);
  const numFrames = Math.floor(dataSize / frameSize);
  const rawMono = new Float32Array(numFrames);
  for (let i = 0; i < numFrames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const p = dataStart + i * frameSize + c * bytesPerSample;
      if (audioFormat === 3 && bitsPerSample === 32 && p + 4 <= wavBuf.length) {
        sum += wavBuf.readFloatLE(p);
      } else if (bitsPerSample === 16 && p + 2 <= wavBuf.length) {
        sum += wavBuf.readInt16LE(p) / 32768;
      } else if (bitsPerSample === 8 && p < wavBuf.length) {
        sum += (wavBuf.readUInt8(p) - 128) / 128;
      }
    }
    rawMono[i] = Math.max(-1, Math.min(1, sum / Math.max(1, channels)));
  }
  if (sampleRate === 16e3) return { pcm: rawMono, sampleRate: 16e3 };
  const targetLen = Math.max(1, Math.floor(numFrames / sampleRate * 16e3));
  const resampled = new Float32Array(targetLen);
  const step = sampleRate / 16e3;
  for (let i = 0; i < targetLen; i++) {
    const idx = i * step;
    const i0 = Math.floor(idx);
    const i1 = Math.min(numFrames - 1, i0 + 1);
    const frac = idx - i0;
    resampled[i] = rawMono[i0] * (1 - frac) + rawMono[i1] * frac;
  }
  return { pcm: resampled, sampleRate: 16e3 };
}
async function isolateVocalsPcm16k(audioBase64, separatedVocalBase64, preferIsolated = true) {
  const chosenB64 = preferIsolated && separatedVocalBase64 ? separatedVocalBase64 : audioBase64;
  const inputBuf = Buffer.from(chosenB64, "base64");
  if (!inputBuf.length) return new Float32Array(0);
  try {
    const pcmBuf = await new Promise((resolve, reject) => {
      const chunks = [];
      const errChunks = [];
      const ff = spawn("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-af",
        "highpass=f=95,lowpass=f=7500,afftdn=nf=-20,dynaudnorm=f=120:g=7",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "f32le",
        "pipe:1"
      ], { stdio: ["pipe", "pipe", "pipe"] });
      const killTimer = setTimeout(() => {
        try {
          ff.kill("SIGKILL");
        } catch {
        }
        reject(new Error("ffmpeg timeout"));
      }, 25e3);
      ff.stdout.on("data", (d) => chunks.push(d));
      ff.stderr.on("data", (d) => errChunks.push(d));
      ff.on("error", (err) => {
        clearTimeout(killTimer);
        reject(err);
      });
      ff.on("close", (code) => {
        clearTimeout(killTimer);
        const out2 = Buffer.concat(chunks);
        if (code === 0 && out2.length >= 4) {
          resolve(out2);
        } else {
          reject(new Error(Buffer.concat(errChunks).toString("utf8") || `ffmpeg exit ${code}`));
        }
      });
      ff.stdin.on("error", () => {
      });
      ff.stdin.end(inputBuf);
    });
    const nSamples = Math.floor(pcmBuf.length / 4);
    const out = new Float32Array(nSamples);
    for (let i = 0; i < nSamples; i++) {
      out[i] = pcmBuf.readFloatLE(i * 4);
    }
    return out;
  } catch {
    const parsed = decodeWavFallback(inputBuf);
    return parsed ? parsed.pcm : new Float32Array(0);
  }
}
function measureRms(pcm, startSec, endSec, sr = 16e3) {
  if (!pcm.length) return 0;
  const i0 = Math.max(0, Math.floor(startSec * sr));
  const i1 = Math.min(pcm.length, Math.ceil(endSec * sr));
  if (i1 <= i0) return 0;
  let sum = 0;
  for (let i = i0; i < i1; i++) {
    sum += pcm[i] * pcm[i];
  }
  return Math.sqrt(sum / (i1 - i0));
}
function isHallucinatedFragment(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  return HALLUCINATION_PATTERNS.some((rx) => rx.test(t));
}
function inferPrimaryScriptLang(text, hintLang = "auto") {
  if (hintLang && hintLang !== "auto" && hintLang !== "multi") return hintLang;
  const s = String(text || "");
  if (/[\u4e00-\u9fff]/.test(s)) return "zh-Hans";
  if (/[\u3040-\u30ff]/.test(s)) return "ja";
  if (/[\uac00-\ud7af]/.test(s)) return "ko";
  if (/[éèêëàâçùûüîïôœ]/i.test(s)) return "fr";
  if (/[ñáéíóú¿¡]/i.test(s)) return "es";
  if (/[äöüß]/i.test(s)) return "de";
  return "en";
}
function buildKaraokeLinesFromWhisperChunks(rawChunks, pcm, offsetSec = 0, clipDurationSec = 30, hintLang = "auto") {
  const cleanTokens = [];
  let prevEnd = 0;
  for (const ch of rawChunks) {
    const rawTxt = String(ch?.text || "").replace(/\s+/g, " ").trim();
    if (!rawTxt || isHallucinatedFragment(rawTxt)) continue;
    const ts = Array.isArray(ch?.timestamp) ? ch.timestamp : [null, null];
    let s = typeof ts[0] === "number" && Number.isFinite(ts[0]) ? Math.max(0, ts[0]) : prevEnd;
    if (s < prevEnd) s = prevEnd;
    let e = typeof ts[1] === "number" && Number.isFinite(ts[1]) ? Math.max(s + 0.06, ts[1]) : Math.min(clipDurationSec, s + 0.35);
    e = Math.max(s + 0.04, Math.min(clipDurationSec, e));
    prevEnd = e;
    const segRms = measureRms(pcm, s, e);
    if (segRms < 4e-3 && cleanTokens.length > 0 && rawTxt.length <= 2) continue;
    const clarity = Math.min(0.95, Math.max(0.45, 0.55 + Math.min(0.4, segRms * 4.5)));
    const recConf = Math.min(0.95, Math.max(0.68, 0.78 + Math.min(0.16, segRms * 2.2)));
    const rawSubTokens = rawTxt.match(/[A-Za-zÀ-ÿ\u0100-\u024f\u1e00-\u1eff0-9'’\-]+[,.;:!?…]?|[\u4e00-\u9fff\u3400-\u4dbf][、。，．！？]?|[\u3040-\u309f\u30a0-\u30ff]+|[\uac00-\ud7af]+|[^\s]/g) || [rawTxt];
    const subTokens = [];
    for (const st of rawSubTokens) {
      if (/^[.,!?;:…、。，．！？]+$/.test(st) && subTokens.length) {
        subTokens[subTokens.length - 1] += st;
      } else {
        subTokens.push(st);
      }
    }
    if (subTokens.length === 1) {
      cleanTokens.push({ text: subTokens[0], start: s, end: e, conf: recConf, clarity });
    } else {
      const weights = subTokens.map((tk) => estimateTokenAcousticWeight(tk));
      const totW = weights.reduce((a, b) => a + b, 0) || subTokens.length;
      let cur = s;
      subTokens.forEach((tk, idx) => {
        const dur = weights[idx] / totW * (e - s);
        const ws = cur;
        cur += dur;
        const we = idx === subTokens.length - 1 ? e : Math.max(ws + 0.03, cur);
        cleanTokens.push({ text: tk, start: ws, end: we, conf: recConf, clarity });
      });
    }
  }
  if (!cleanTokens.length) return [];
  const dedupedTokens = [];
  for (const tk of cleanTokens) {
    const nCur = tk.text.toLowerCase().replace(/[^a-z0-9à-ÿ\u4e00-\u9fff]/g, "");
    const dLen = dedupedTokens.length;
    if (dLen >= 2 && nCur && nCur.length <= 12 && dedupedTokens[dLen - 1].text.toLowerCase().replace(/[^a-z0-9à-ÿ\u4e00-\u9fff]/g, "") === nCur && dedupedTokens[dLen - 2].text.toLowerCase().replace(/[^a-z0-9à-ÿ\u4e00-\u9fff]/g, "") === nCur && tk.start - dedupedTokens[dLen - 1].end < 0.35) {
      continue;
    }
    dedupedTokens.push(tk);
  }
  const isCjkLike = (t) => /^[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff]/.test(t);
  const groups = [];
  let curGroup = [];
  for (let i = 0; i < dedupedTokens.length; i++) {
    const tk = dedupedTokens[i];
    const prev = curGroup[curGroup.length - 1];
    const gap = prev ? tk.start - prev.end : 0;
    const isGroupCjk = curGroup.some((x) => isCjkLike(x.text));
    const curChars = curGroup.reduce((sum, x) => sum + x.text.length, 0);
    const curDur = curGroup.length ? tk.end - curGroup[0].start : 0;
    const prevEndsSentence = prev ? /[.!?。！？…]$/.test(prev.text) : false;
    const prevEndsClause = prev ? /[,;:，；、]$/.test(prev.text) && curGroup.length >= (isGroupCjk ? 4 : 3) : false;
    const charCap = isGroupCjk ? 18 : 44;
    const wordCap = isGroupCjk ? 16 : 9;
    if (curGroup.length > 0 && (gap >= 0.4 || prevEndsSentence || prevEndsClause || curGroup.length >= wordCap || curChars >= charCap || curDur >= 4.4)) {
      groups.push(curGroup);
      curGroup = [];
    }
    curGroup.push(tk);
  }
  if (curGroup.length) groups.push(curGroup);
  return groups.map((grp) => {
    const startAbs = +(grp[0].start + offsetSec).toFixed(3);
    const endAbs = +(Math.max(grp[0].start + 0.12, grp[grp.length - 1].end) + offsetSec).toFixed(3);
    let lineText = "";
    grp.forEach((tk, i) => {
      if (i === 0) lineText += tk.text;
      else if (isCjkLike(tk.text) && isCjkLike(grp[i - 1].text)) lineText += tk.text;
      else if (/^[,.;:!?…，。！？]$/.test(tk.text)) lineText += tk.text;
      else lineText += " " + tk.text;
    });
    lineText = lineText.trim();
    const avgRec = +(grp.reduce((a, x) => a + x.conf, 0) / grp.length).toFixed(3);
    const langDetected = inferPrimaryScriptLang(lineText, hintLang);
    const words = grp.map((tk) => ({
      text: tk.text,
      start: +(tk.start + offsetSec).toFixed(3),
      end: +(Math.max(tk.start + 0.025, tk.end) + offsetSec).toFixed(3),
      recognitionConfidence: +tk.conf.toFixed(3),
      alignmentConfidence: 0.87,
      audioClarity: +tk.clarity.toFixed(3),
      vocalOverlap: 0.12,
      speaker: "Lead",
      flags: tk.conf < 0.72 ? ["uncertain_word"] : []
    }));
    return {
      text: lineText,
      start: startAbs,
      end: endAbs,
      section: "verse",
      vocalType: "singing",
      language: langDetected,
      speaker: "Lead",
      recognitionConfidence: avgRec,
      alignmentConfidence: 0.87,
      isRepeatedChorus: false,
      backingText: "",
      unclear: false,
      isInstrumentalSection: false,
      flags: avgRec < 0.72 ? ["uncertain_word"] : [],
      validationNote: "",
      words
    };
  });
}
async function transcribeWithWhisper(params) {
  const { audioBase64, separatedVocalBase64, lang = "auto", chunkStartSec = 0, chunkDurationSec = 30, onProgress } = params;
  const offsetSec = Math.max(0, Number(chunkStartSec) || 0);
  onProgress?.({ stage: 2, event: "stage", payload: { label: "separation" } });
  let pcm = await isolateVocalsPcm16k(audioBase64, separatedVocalBase64, true);
  if (!pcm.length) {
    return {
      success: false,
      audioType: "instrumental",
      language: lang,
      detectedLanguages: [],
      detectedSpeakers: [],
      hasBackingVocals: false,
      hasUnclearSections: false,
      hasInstrumentalSections: false,
      hasRepeatedChorus: false,
      isInstrumental: true,
      lines: [],
      rawTranscript: "",
      engine: "whisper-base-q8"
    };
  }
  const clipDur = Math.max(0.5, pcm.length / 16e3 || Number(chunkDurationSec) || 30);
  const clipRms = measureRms(pcm, 0, clipDur);
  if (clipRms < 5e-3 && separatedVocalBase64) {
    const rawPcm = await isolateVocalsPcm16k(audioBase64, void 0, false);
    if (rawPcm.length && measureRms(rawPcm, 0, rawPcm.length / 16e3) > clipRms * 1.4) {
      pcm = rawPcm;
    }
  }
  const finalRms = measureRms(pcm, 0, pcm.length / 16e3);
  if (finalRms < 3e-3) {
    return {
      success: true,
      audioType: "instrumental",
      language: "instrumental",
      detectedLanguages: [],
      detectedSpeakers: [],
      hasBackingVocals: false,
      hasUnclearSections: false,
      hasInstrumentalSections: true,
      hasRepeatedChorus: false,
      isInstrumental: true,
      lines: [],
      rawTranscript: "",
      engine: "whisper-base-q8"
    };
  }
  onProgress?.({ stage: 3, event: "stage", payload: { label: "transcribing" } });
  const asr = await getWhisperPipeline();
  const whisperLang = LANG_TO_WHISPER[String(lang || "auto").toLowerCase()];
  const runInfer = async (timestampMode) => {
    return asr(pcm, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: timestampMode,
      task: "transcribe",
      condition_on_previous_text: false,
      no_speech_threshold: 0.58,
      compression_ratio_threshold: 2.4,
      ...whisperLang ? { language: whisperLang } : {}
    });
  };
  let output;
  try {
    output = await runInfer("word");
  } catch {
    output = await runInfer(true);
  }
  const rawText = String(output?.text || "").trim();
  const chunks = Array.isArray(output?.chunks) ? output.chunks : [];
  const lines = buildKaraokeLinesFromWhisperChunks(chunks, pcm, offsetSec, clipDur, lang);
  if (lines.length) {
    const joinedAll = lines.map((l) => l.text).join("\n");
    const effectiveOrthLang = lang === "auto" && containsHanzi(joinedAll) ? detectMandarinScript(joinedAll) : lang;
    const orth = analyzeAndFixOrthography(lines.map((l) => l.text), effectiveOrthLang);
    lines.forEach((ln, li) => {
      const polished = orth.correctedLines[li];
      if (!polished || polished === ln.text) return;
      ln.text = polished;
      const newToks = tokenizeLineText(polished);
      if (newToks.length === ln.words.length) {
        newToks.forEach((tk, wi) => {
          ln.words[wi].text = tk;
        });
      } else if (newToks.length) {
        const s0 = ln.start;
        const e0 = Math.max(s0 + 0.08, ln.end);
        const weights = newToks.map((tk) => Math.max(1, tk.length));
        const tot = weights.reduce((a, b) => a + b, 0) || newToks.length;
        let cur = s0;
        ln.words = newToks.map((tk, wi) => {
          const dur = weights[wi] / tot * (e0 - s0);
          const ws = +cur.toFixed(3);
          cur += dur;
          const we = wi === newToks.length - 1 ? e0 : +Math.max(ws + 0.025, cur).toFixed(3);
          return {
            text: tk,
            start: ws,
            end: we,
            recognitionConfidence: ln.recognitionConfidence,
            alignmentConfidence: ln.alignmentConfidence,
            audioClarity: 0.78,
            vocalOverlap: 0.12,
            speaker: ln.speaker || "Lead",
            flags: []
          };
        });
      }
    });
  }
  const previewLines = lines.map((l) => l.text).filter(Boolean);
  if (previewLines.length) {
    onProgress?.({
      stage: 3,
      event: "transcript_preview",
      payload: { transcript: previewLines.join("\n"), previewLines, offsetSec }
    });
  }
  const detectedLangSet = /* @__PURE__ */ new Set();
  lines.forEach((l) => {
    if (l.language && l.language !== "auto" && l.language !== "instrumental") detectedLangSet.add(l.language);
  });
  const primaryLang = detectedLangSet.size === 1 ? Array.from(detectedLangSet)[0] : detectedLangSet.size > 1 ? "multi" : lang !== "auto" ? lang : inferPrimaryScriptLang(rawText, "en");
  const isPureInst = lines.length === 0;
  return {
    success: true,
    audioType: isPureInst ? "instrumental" : "singing",
    language: isPureInst ? "instrumental" : primaryLang,
    detectedLanguages: Array.from(detectedLangSet),
    detectedSpeakers: isPureInst ? [] : ["Lead"],
    hasBackingVocals: false,
    hasUnclearSections: false,
    hasInstrumentalSections: isPureInst,
    hasRepeatedChorus: false,
    isInstrumental: isPureInst,
    lines,
    rawTranscript: previewLines.join("\n") || rawText,
    engine: "whisper-base-q8+ffmpeg-vocal-stem"
  };
}
function estimateTokenAcousticWeight(tk) {
  const clean = String(tk || "").replace(/[^A-Za-zÀ-ÿ\u0100-\u024f\u1e00-\u1eff0-9\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/g, "");
  if (!clean) return 0.35;
  if (/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/.test(clean)) {
    return Math.max(0.95, [...clean].length * 1.25);
  }
  const vowels = clean.match(/[aeiouyàâäéèêëîïôöùûüÿæœ]+/gi);
  const syl = vowels ? vowels.length : 1;
  return Math.max(0.65, syl * 0.92 + clean.length * 0.14);
}
function normTok(s) {
  return String(s || "").toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, "");
}
function tokenizeLineText(text) {
  return String(text || "").match(
    /[¿¡"«'(\[]?[A-Za-zÀ-ÿ\u0100-\u024f\u1e00-\u1eff0-9]+(?:['’\-][A-Za-zÀ-ÿ\u0100-\u024f\u1e00-\u1eff0-9]+)*[,.;:!?…»"')\]♪♫]*|[\u4e00-\u9fff\u3400-\u4dbf][、。，．！？…]?|[\u3040-\u309f\u30a0-\u30ff][\u3041\u3043\u3045\u3047\u3049\u3063\u3083\u3085\u3087\u308e\u30a1\u30a3\u30a5\u30a7\u30a9\u30c3\u30e3\u30e5\u30e7\u30ee\u30fc]*|[\uac00-\ud7af]+|[^\s]/g
  ) || [];
}
function joinLineTokens(tokens) {
  const isCjkLike = (t) => /^[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff]/.test(t);
  let out = "";
  tokens.forEach((tk, i) => {
    if (i === 0) out += tk;
    else if (isCjkLike(tk) && isCjkLike(tokens[i - 1])) out += tk;
    else if (/^[.,!?;:…，。！？»"')\]♪♫]+$/.test(tk)) out += tk;
    else out += " " + tk;
  });
  out = out.trim();
  if (/^[a-zà-öø-ÿ]/.test(out)) {
    out = out.charAt(0).toUpperCase() + out.slice(1);
  }
  return out;
}
function levenshteinSim(na, nb) {
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return Math.max(0.72, Math.min(na.length, nb.length) / Math.max(na.length, nb.length));
  const la = na.length, lb = nb.length;
  const dp = Array.from({ length: la + 1 }, (_, i) => i);
  for (let j = 1; j <= lb; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= la; i++) {
      const tmp = dp[i];
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (na[i - 1] === nb[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return Math.max(0, 1 - dp[la] / Math.max(la, lb));
}
function phoneticKey(tok) {
  const n = normTok(tok);
  if (!n || /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(n)) return n;
  return n.replace(/eaux?/g, "o").replace(/au/g, "o").replace(/ou/g, "u").replace(/ph/g, "f").replace(/qu/g, "k").replace(/ch/g, "sh").replace(/(?:ai|ei|er|ez|et)$/g, "e").replace(/([a-z])\1+/g, "$1").replace(/(?:ent|es|e|s)$/g, (m, off) => off > 2 ? "" : m);
}
function tokenSimilarity(a, b) {
  if (containsHanzi(a) && containsHanzi(b)) {
    const zhSim = mandarinCharSimilarity(a, b);
    if (zhSim > 0) return zhSim;
  }
  const na = normTok(a);
  const nb = normTok(b);
  if (!na || !nb) return 0;
  const lexSim = levenshteinSim(na, nb);
  if (lexSim >= 0.92) return lexSim;
  const pa = phoneticKey(a);
  const pb = phoneticKey(b);
  const phoSim = pa && pb ? levenshteinSim(pa, pb) * 0.9 : 0;
  return Math.max(lexSim, phoSim);
}
async function alignLyricsWithWhisperDTW(params) {
  const { audioBase64, separatedVocalBase64, lines, lang = "auto", vocalSegments = [], onProgress } = params;
  const inputEntries = lines.map((ln, k) => ({
    lineIdx: typeof ln.i === "number" ? ln.i : typeof ln.index === "number" ? ln.index : k,
    rawText: String(ln.text || "").trim()
  }));
  const preAudit = analyzeAndFixOrthography(inputEntries.map((e) => e.rawText), lang);
  const allCorrections = preAudit.changes.map((ch) => ({
    ...ch,
    lineIdx: inputEntries[ch.lineIdx]?.lineIdx ?? ch.lineIdx
  }));
  onProgress?.({
    stage: 1,
    step: "orthography",
    pct: 14,
    label: "Analyse orthographe & extraction vocale\u2026",
    spellingFixCount: allCorrections.length
  });
  const workingLineTexts = /* @__PURE__ */ new Map();
  inputEntries.forEach((e, k) => {
    if (e.rawText && !/^\[interlude/i.test(e.rawText)) {
      workingLineTexts.set(e.lineIdx, preAudit.correctedLines[k] || e.rawText);
    }
  });
  const buildCorrectedPayload = () => {
    const correctedLinesObj = {};
    inputEntries.forEach((e) => {
      const cur = workingLineTexts.get(e.lineIdx);
      if (cur && cur !== e.rawText) {
        correctedLinesObj[e.lineIdx] = cur;
      }
    });
    const correctedText = inputEntries.map((e) => workingLineTexts.get(e.lineIdx) || e.rawText).join("\n");
    return { correctedLines: correctedLinesObj, correctedText };
  };
  onProgress?.({
    stage: 2,
    step: "vocal_isolation",
    pct: 28,
    label: "Isolation vocale & d\xE9codage de la voix chant\xE9e\u2026",
    spellingFixCount: allCorrections.length
  });
  const recognized = await transcribeWithWhisper({
    audioBase64,
    separatedVocalBase64,
    lang: preAudit.detectedLanguage !== "auto" ? preAudit.detectedLanguage : lang,
    chunkStartSec: 0,
    chunkDurationSec: 300
  });
  onProgress?.({
    stage: 3,
    step: "asr_decode",
    pct: 50,
    label: "Voix d\xE9cod\xE9e \u2014 alignement mot \xE0 mot en direct\u2026",
    recognizedLines: recognized.lines.slice(0, 24).map((rl) => ({ text: rl.text, start: rl.start, end: rl.end }))
  });
  const asrWords = recognized.lines.flatMap((l) => l.words || []);
  if (!asrWords.length) {
    const cp2 = buildCorrectedPayload();
    return {
      success: false,
      matchedCount: 0,
      matchRatio: 0,
      lineTimes: {},
      wordTimes: {},
      lineMeta: {},
      lineMatchRatios: {},
      stretchedLineIndices: [],
      corrections: allCorrections,
      spellingFixCount: allCorrections.length,
      correctedLines: cp2.correctedLines,
      correctedText: cp2.correctedText,
      divergences: [],
      detectedLanguage: preAudit.detectedLanguage,
      recognizedLines: recognized.lines,
      recognizedTranscript: recognized.rawTranscript,
      engine: recognized.engine
    };
  }
  const flatUser = [];
  const lineTokensMap = /* @__PURE__ */ new Map();
  for (const entry of inputEntries) {
    const txt = workingLineTexts.get(entry.lineIdx);
    if (!txt || /^\[interlude/i.test(txt)) continue;
    const toks = tokenizeLineText(txt);
    lineTokensMap.set(entry.lineIdx, toks);
    toks.forEach((tk, ti) => flatUser.push({ lineIdx: entry.lineIdx, tokIdx: ti, text: tk }));
  }
  if (!flatUser.length) {
    const cp2 = buildCorrectedPayload();
    return {
      success: false,
      matchedCount: 0,
      matchRatio: 0,
      lineTimes: {},
      wordTimes: {},
      lineMeta: {},
      lineMatchRatios: {},
      stretchedLineIndices: [],
      corrections: allCorrections,
      spellingFixCount: allCorrections.length,
      correctedLines: cp2.correctedLines,
      correctedText: cp2.correctedText,
      divergences: [],
      detectedLanguage: preAudit.detectedLanguage,
      recognizedLines: recognized.lines,
      recognizedTranscript: recognized.rawTranscript,
      engine: recognized.engine
    };
  }
  const M = flatUser.length;
  const N = asrWords.length;
  const dp = new Float32Array((M + 1) * (N + 1));
  const ptr = new Uint8Array((M + 1) * (N + 1));
  const idx = (r2, c2) => r2 * (N + 1) + c2;
  for (let i2 = 1; i2 <= M; i2++) {
    dp[idx(i2, 0)] = -0.15 * i2;
    ptr[idx(i2, 0)] = 2;
  }
  for (let j = 1; j <= N; j++) {
    dp[idx(0, j)] = 0;
    ptr[idx(0, j)] = 3;
  }
  for (let i2 = 1; i2 <= M; i2++) {
    for (let j = 1; j <= N; j++) {
      const sim = tokenSimilarity(flatUser[i2 - 1].text, asrWords[j - 1].text);
      const matchScore = sim >= 0.52 ? sim * 1.45 : -0.4;
      const dScore = dp[idx(i2 - 1, j - 1)] + matchScore;
      const uScore = dp[idx(i2 - 1, j)] - 0.15;
      const lScore = dp[idx(i2, j - 1)] - 0.06;
      if (dScore >= uScore && dScore >= lScore) {
        dp[idx(i2, j)] = dScore;
        ptr[idx(i2, j)] = 1;
      } else if (uScore >= lScore) {
        dp[idx(i2, j)] = uScore;
        ptr[idx(i2, j)] = 2;
      } else {
        dp[idx(i2, j)] = lScore;
        ptr[idx(i2, j)] = 3;
      }
    }
  }
  const anchorMatch = new Array(M).fill(null);
  const anchorAsrIdx = new Int32Array(M).fill(-1);
  const anchorSim = new Float32Array(M);
  let bestEndCol = N;
  let bestEndScore = dp[idx(M, N)];
  const minEndCol = Math.min(N, Math.max(1, Math.floor(M * 0.4)));
  for (let j = minEndCol; j <= N; j++) {
    if (dp[idx(M, j)] > bestEndScore) {
      bestEndScore = dp[idx(M, j)];
      bestEndCol = j;
    }
  }
  let r = M, c = bestEndCol;
  while (r > 0 || c > 0) {
    const p = ptr[idx(r, c)];
    if (p === 1 && r > 0 && c > 0) {
      const sim = tokenSimilarity(flatUser[r - 1].text, asrWords[c - 1].text);
      if (sim >= 0.52) {
        anchorAsrIdx[r - 1] = c - 1;
        anchorSim[r - 1] = sim;
        anchorMatch[r - 1] = {
          start: asrWords[c - 1].start,
          end: asrWords[c - 1].end,
          conf: +(0.72 + 0.24 * sim).toFixed(3)
        };
      }
      r--;
      c--;
    } else if (p === 2 && r > 0) {
      r--;
    } else if (c > 0) {
      c--;
    } else {
      break;
    }
  }
  const matchedCount = anchorMatch.filter(Boolean).length;
  const matchRatio = +(matchedCount / Math.max(1, M)).toFixed(3);
  onProgress?.({
    stage: 4,
    step: "dtw_matching",
    pct: 66,
    label: `Coordination DTW : ${matchedCount}/${M} mots ancr\xE9s sur la voix\u2026`,
    matchedCount,
    totalTokens: M
  });
  if (matchedCount === 0) {
    const cp2 = buildCorrectedPayload();
    return {
      success: false,
      matchedCount: 0,
      matchRatio: 0,
      lineTimes: {},
      wordTimes: {},
      lineMeta: {},
      lineMatchRatios: {},
      stretchedLineIndices: [],
      corrections: allCorrections,
      spellingFixCount: allCorrections.length,
      correctedLines: cp2.correctedLines,
      correctedText: cp2.correctedText,
      divergences: [],
      detectedLanguage: preAudit.detectedLanguage,
      recognizedLines: recognized.lines,
      recognizedTranscript: recognized.rawTranscript,
      engine: recognized.engine
    };
  }
  const repairLangHint = preAudit.detectedLanguage !== "auto" ? preAudit.detectedLanguage : lang;
  const repairedLinesSet = /* @__PURE__ */ new Set();
  for (let ui = 0; ui < M; ui++) {
    const aIdx = anchorAsrIdx[ui];
    if (aIdx < 0) continue;
    const asrW = asrWords[aIdx];
    const u = flatUser[ui];
    const toks = lineTokensMap.get(u.lineIdx) || [];
    const prevTok = u.tokIdx > 0 ? toks[u.tokIdx - 1] || "" : "";
    const nextTok = u.tokIdx + 1 < toks.length ? toks[u.tokIdx + 1] || "" : "";
    const repair = evaluateVoiceWordRepair(
      u.text,
      asrW.text,
      anchorSim[ui],
      asrW.recognitionConfidence,
      repairLangHint,
      prevTok,
      nextTok
    );
    if (repair.shouldReplace && repair.finalWord && repair.finalWord !== u.text) {
      const prevText = u.text;
      u.text = repair.finalWord;
      if (toks && toks[u.tokIdx] !== void 0) {
        toks[u.tokIdx] = repair.finalWord;
      }
      repairedLinesSet.add(u.lineIdx);
      if (anchorMatch[ui]) {
        anchorMatch[ui].conf = Math.max(anchorMatch[ui].conf, 0.86);
      }
      const existingFix = allCorrections.find(
        (c2) => c2.lineIdx === u.lineIdx && (c2.wordIdx === u.tokIdx || c2.corrected.toLowerCase() === prevText.toLowerCase())
      );
      if (existingFix) {
        existingFix.corrected = repair.finalWord;
        existingFix.source = "voice_phonetic";
        existingFix.start = asrW.start;
      } else {
        allCorrections.push({
          lineIdx: u.lineIdx,
          wordIdx: u.tokIdx,
          original: prevText,
          corrected: repair.finalWord,
          source: "voice_phonetic",
          start: asrW.start
        });
      }
    }
  }
  for (const li of repairedLinesSet) {
    const toks = lineTokensMap.get(li);
    if (toks && toks.length) {
      workingLineTexts.set(li, joinLineTokens(toks));
    }
  }
  const maxAudioEnd = asrWords[asrWords.length - 1].end;
  const resolvedTimes = new Array(M);
  const cleanVadSegs = Array.isArray(vocalSegments) ? vocalSegments.map((s) => ({ start: Number(s?.start) || 0, end: Number(s?.end) || 0 })).filter((s) => s.end > s.start).sort((a, b) => a.start - b.start) : [];
  const stretchedLineSet = /* @__PURE__ */ new Set();
  let i = 0;
  while (i < M) {
    if (anchorMatch[i]) {
      resolvedTimes[i] = anchorMatch[i];
      i++;
      continue;
    }
    let j = i;
    while (j < M && !anchorMatch[j]) j++;
    const unanchoredCount = j - i;
    const rawLeft = i > 0 ? resolvedTimes[i - 1].end + 0.01 : Math.max(0, asrWords[0].start - 0.38 * unanchoredCount);
    const hasRightAnchor = j < M && anchorMatch[j] != null;
    const rawRightBound = hasRightAnchor ? Math.max(rawLeft + 0.04, anchorMatch[j].start - 0.01) : Math.max(rawLeft + 0.35 * unanchoredCount, maxAudioEnd);
    let effLeft = rawLeft;
    let effRight = rawRightBound;
    let wasGapStretched = false;
    const rawGapDur = effRight - effLeft;
    const expectedNaturalDur = Math.max(0.4, unanchoredCount * 0.42);
    if (rawGapDur > Math.max(5.5, expectedNaturalDur * 2.2)) {
      const vadInside = cleanVadSegs.filter((vs) => vs.end > rawLeft + 0.05 && vs.start < rawRightBound - 0.05);
      if (vadInside.length) {
        effLeft = Math.max(rawLeft, vadInside[0].start);
        effRight = Math.min(rawRightBound, vadInside[vadInside.length - 1].end);
      } else {
        effRight = Math.min(rawRightBound, effLeft + expectedNaturalDur);
        wasGapStretched = true;
      }
    }
    const span = hasRightAnchor ? Math.max(0.02 * unanchoredCount, effRight - effLeft) : Math.max(0.12 * unanchoredCount, effRight - effLeft);
    const weights = flatUser.slice(i, j).map((u) => estimateTokenAcousticWeight(u.text));
    const sumW = weights.reduce((a, b) => a + b, 0) || unanchoredCount;
    let cur = effLeft;
    for (let u = i; u < j; u++) {
      const d = weights[u - i] / sumW * span;
      const ws = +cur.toFixed(3);
      cur += d;
      const maxCap = hasRightAnchor ? rawRightBound : cur + 0.05;
      const we = +Math.min(maxCap, Math.max(ws + 0.02, cur)).toFixed(3);
      resolvedTimes[u] = { start: ws, end: we, conf: wasGapStretched ? 0.56 : 0.74, stretched: wasGapStretched };
      if (wasGapStretched) stretchedLineSet.add(flatUser[u].lineIdx);
    }
    i = j;
  }
  const lineTimes = {};
  const wordTimes = {};
  const lineMeta = {};
  const lineMatchRatios = {};
  const perLine = /* @__PURE__ */ new Map();
  const lineAnchorHits = /* @__PURE__ */ new Map();
  flatUser.forEach((u, ui) => {
    const rt = resolvedTimes[ui];
    if (!perLine.has(u.lineIdx)) perLine.set(u.lineIdx, []);
    perLine.get(u.lineIdx).push({
      text: u.text,
      start: rt.start,
      end: rt.end,
      recognitionConfidence: rt.conf,
      alignmentConfidence: rt.conf,
      speaker: "Lead",
      flags: rt.conf < 0.72 ? ["uncertain_boundary"] : []
    });
    const st = lineAnchorHits.get(u.lineIdx) || { hit: 0, total: 0 };
    st.total++;
    if (anchorMatch[ui]) st.hit++;
    lineAnchorHits.set(u.lineIdx, st);
  });
  const divergences = [];
  const totalPerLines = Math.max(1, perLine.size);
  let resolvedLineNum = 0;
  let batchLineTimes = {};
  let batchWordTimes = {};
  const batchStride = Math.max(1, Math.min(4, Math.ceil(totalPerLines / 5)));
  for (const [lineIdx, wArr] of perLine.entries()) {
    if (!wArr.length) continue;
    const ls = wArr[0].start;
    const le = wArr[wArr.length - 1].end;
    lineTimes[lineIdx] = ls;
    wordTimes[lineIdx] = wArr;
    batchLineTimes[lineIdx] = ls;
    batchWordTimes[lineIdx] = wArr;
    resolvedLineNum++;
    const avgC = +(wArr.reduce((s, w) => s + w.alignmentConfidence, 0) / wArr.length).toFixed(3);
    const lineFixes = allCorrections.filter((c2) => c2.lineIdx === lineIdx);
    const hitStat = lineAnchorHits.get(lineIdx) || { hit: 0, total: 1 };
    const lineMatchRatio = +(hitStat.hit / Math.max(1, hitStat.total)).toFixed(3);
    lineMatchRatios[lineIdx] = lineMatchRatio;
    lineMeta[lineIdx] = {
      speaker: "Lead",
      recognitionConfidence: avgC,
      alignmentConfidence: avgC,
      flags: avgC < 0.75 || stretchedLineSet.has(lineIdx) ? ["uncertain_boundary"] : [],
      validationNote: lineFixes.length ? `Whisper DTW + ${lineFixes.length} correction(s)` : stretchedLineSet.has(lineIdx) ? "Whisper DTW (zone instrumentale incertaine)" : "Whisper Neural DTW Alignment"
    };
    if (onProgress && (resolvedLineNum % batchStride === 0 || resolvedLineNum === totalPerLines)) {
      const pct = Math.min(86, Math.round(68 + resolvedLineNum / totalPerLines * 18));
      onProgress({
        stage: 5,
        step: "moment_refinement",
        pct,
        label: `Coordination instant par instant (${resolvedLineNum}/${totalPerLines} phrases)\u2026`,
        matchedCount,
        totalTokens: M,
        partialLineTimes: batchLineTimes,
        partialWordTimes: batchWordTimes
      });
      batchLineTimes = {};
      batchWordTimes = {};
    }
    const overlappingRec = recognized.lines.filter((rl) => {
      const ov = Math.min(le, rl.end) - Math.max(ls, rl.start);
      const minD = Math.max(0.15, Math.min(le - ls, Math.max(0.2, rl.end - rl.start)));
      return ov >= 0.12 || ov / minD >= 0.35;
    }).map((rl) => rl.text).join(" ").trim();
    const rawEntry = inputEntries.find((e) => e.lineIdx === lineIdx);
    const corrLineTxt = workingLineTexts.get(lineIdx) || rawEntry?.rawText || "";
    if (lineFixes.some((f) => f.source === "voice_phonetic")) {
      divergences.push({
        lineIdx,
        type: "word_replaced_by_voice",
        userText: rawEntry?.rawText || corrLineTxt,
        heardText: overlappingRec || corrLineTxt,
        start: ls,
        end: le
      });
    } else if (lineFixes.length > 0) {
      divergences.push({
        lineIdx,
        type: "spelling_fixed",
        userText: rawEntry?.rawText || corrLineTxt,
        heardText: overlappingRec || corrLineTxt,
        start: ls,
        end: le
      });
    } else if (lineMatchRatio < 0.6 && overlappingRec) {
      divergences.push({
        lineIdx,
        type: "divergent_phrase",
        userText: rawEntry?.rawText || corrLineTxt,
        heardText: overlappingRec,
        start: ls,
        end: le
      });
    }
  }
  const cp = buildCorrectedPayload();
  return {
    success: Object.keys(lineTimes).length > 0,
    matchedCount,
    matchRatio,
    lineTimes,
    wordTimes,
    lineMeta,
    lineMatchRatios,
    stretchedLineIndices: Array.from(stretchedLineSet),
    corrections: allCorrections,
    spellingFixCount: allCorrections.length,
    correctedLines: cp.correctedLines,
    correctedText: cp.correctedText,
    divergences,
    detectedLanguage: preAudit.detectedLanguage,
    recognizedLines: recognized.lines,
    recognizedTranscript: recognized.rawTranscript,
    engine: recognized.engine + "+neural-dtw+orthography"
  };
}

// server/services/aiLyricReformulator.ts
import { Type as Type2 } from "@google/genai";
function normComparison(s) {
  return String(s || "").toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, "");
}
function stripPunctEdge(s) {
  return String(s || "").trim().replace(/^[.,!?;:…，。！？、；：\s]+|[.,!?;:…，。！？、；：\s]+$/g, "");
}
function overlappingHeardForLine(ln, recognizedLines, divergences = []) {
  const divMatch = divergences.find((d) => d.lineIdx === ln.lineIdx && d.heardText);
  const ls = Number(ln.start) || 0;
  const le = Math.max(ls + 0.3, Number(ln.end) || ls + 2.5);
  const positiveHits = recognizedLines.map((rl) => {
    const ov = Math.min(le, rl.end) - Math.max(ls, rl.start);
    const minDur = Math.max(0.15, Math.min(le - ls, Math.max(0.2, rl.end - rl.start)));
    return { rl, ov, ratio: ov / minDur };
  }).filter((x) => x.rl.text.trim() && (x.ov >= 0.15 || x.ratio >= 0.35)).sort((a, b) => a.rl.start - b.rl.start);
  const hits = positiveHits.length ? positiveHits.map((x) => x.rl) : recognizedLines.filter((rl) => rl.end >= ls - 0.25 && rl.start <= le + 0.25 && rl.text.trim()).sort((a, b) => {
    const mid = (ls + le) / 2;
    return Math.abs((a.start + a.end) / 2 - mid) - Math.abs((b.start + b.end) / 2 - mid);
  }).slice(0, 1);
  const heardText = hits.length ? hits.map((h) => h.text.trim()).join(" ").trim() : (divMatch?.heardText || "").trim();
  const avgRecConf = hits.length ? hits.reduce((sum, h) => sum + (Number(h.recognitionConfidence) || 0.85), 0) / hits.length : 0.82;
  return { heardText, avgRecConf };
}
function buildDeterministicReformulation(ln, heardText, avgRecConf, lang) {
  const origClean = stripPunctEdge(ln.text);
  const heardClean = stripPunctEdge(heardText);
  if (!origClean || !heardClean) return null;
  const nOrig = normComparison(origClean);
  const nHeard = normComparison(heardClean);
  if (!nOrig || !nHeard || nOrig === nHeard) return null;
  const lineMatch = typeof ln.matchRatio === "number" ? ln.matchRatio : 0.5;
  const lineStart = +(Number(ln.start) || 0).toFixed(3);
  const lineEnd = +Math.max(lineStart + 0.3, Number(ln.end) || lineStart + 2.5).toFixed(3);
  const clauses = heardClean.split(/[，。,.!?！？\n]+/).map((s) => s.trim()).filter(Boolean);
  let bestClause = heardClean;
  if (clauses.length > 1) {
    let bestScore = -1;
    const origChars = Array.from(nOrig);
    for (const cl of clauses) {
      const nCl = normComparison(cl);
      if (!nCl) continue;
      let shared = 0;
      if (containsHanzi(origClean) && containsHanzi(cl)) {
        for (const ch of origChars) {
          for (const hc of Array.from(nCl)) {
            if (mandarinCharSimilarity(ch, hc) >= 0.8) {
              shared++;
              break;
            }
          }
        }
      } else {
        const setH = new Set(cl.toLowerCase().split(/\s+/));
        for (const w of origClean.toLowerCase().split(/\s+/)) {
          if (setH.has(w)) shared += 2;
        }
      }
      const lenRatio = 1 - Math.min(0.6, Math.abs(nCl.length - nOrig.length) / Math.max(4, nOrig.length));
      const score = shared + lenRatio * 2;
      if (score > bestScore) {
        bestScore = score;
        bestClause = cl;
      }
    }
  }
  const candidate = bestClause || heardClean;
  if (!candidate || normComparison(candidate) === nOrig) return null;
  const origToks = containsHanzi(origClean) ? Array.from(nOrig) : origClean.toLowerCase().split(/\s+/).filter(Boolean);
  const candToks = containsHanzi(candidate) ? Array.from(normComparison(candidate)) : candidate.toLowerCase().split(/\s+/).filter(Boolean);
  let differenceType = "phonetic_mondegreen";
  let differenceSummary = "Reformul\xE9 d\u2019apr\xE8s la prononciation vocale entendue";
  if (lineMatch < 0.25) {
    differenceType = "semantic_mismatch";
    differenceSummary = "Paroles chant\xE9es diff\xE9rentes du texte d\u2019origine";
  } else if (candToks.length > origToks.length + 1) {
    differenceType = "missing_words";
    differenceSummary = "Mots chant\xE9s manquants dans le texte original";
  } else if (origToks.length > candToks.length + 1) {
    differenceType = "extra_words";
    differenceSummary = "Mots en trop par rapport \xE0 la voix chant\xE9e";
  }
  const isZh = lang.toLowerCase().startsWith("zh") || containsHanzi(origClean);
  if (isZh && containsHanzi(candidate)) {
    const scriptOrig = detectMandarinScript(origClean);
    const scriptCand = detectMandarinScript(candidate);
    if (scriptOrig !== scriptCand) {
      differenceType = "script_mismatch";
      differenceSummary = "Script / homophones align\xE9s sur la voix mandarin";
    }
  }
  if (avgRecConf < 0.62 && lineMatch >= 0.45) return null;
  return {
    lineIdx: ln.lineIdx,
    originalText: ln.text,
    heardText: candidate,
    reformulatedText: candidate,
    differenceType,
    differenceSummary,
    confidence: +Math.min(0.95, Math.max(0.55, avgRecConf)).toFixed(3),
    start: lineStart,
    end: lineEnd,
    engine: "whisper+phonetic-reconciler"
  };
}
function detectUnresolvableProblems(userLines, recognizedLines, vocalSegments, reformulations, stretchedLineIndices, overallMatchRatio, durationSec) {
  const problems = [];
  const reformMap = new Map(reformulations.map((r) => [r.lineIdx, r]));
  const stretchedSet = new Set(stretchedLineIndices);
  const nonInterludes = userLines.filter((l) => !l.interlude && l.text.trim());
  if (nonInterludes.length >= 4 && overallMatchRatio > 0.15 && overallMatchRatio < 0.72) {
    const lowStart = nonInterludes.slice(0, 2).every((l) => (l.matchRatio ?? 1) < 0.25);
    const lowEnd = nonInterludes.slice(-2).every((l) => (l.matchRatio ?? 1) < 0.25);
    if (lowStart || lowEnd) {
      const anchor = lowStart ? nonInterludes[0] : nonInterludes[nonInterludes.length - 1];
      problems.push({
        id: `prob_offset_${anchor.lineIdx}`,
        lineIdx: anchor.lineIdx,
        start: +(Number(anchor.start) || 0).toFixed(3),
        end: +(Number(anchor.end) || 2).toFixed(3),
        severity: "high",
        category: "desynced_snippet_offset",
        title: lowStart ? "Intro ou couplet d\xE9cal\xE9 au d\xE9but" : "Fin de paroles hors extrait audio",
        description: lowStart ? "Les premi\xE8res lignes coll\xE9es ne correspondent pas au d\xE9but de la voix dans l\u2019audio (couplet saut\xE9 ou intro longue)." : "Les derni\xE8res lignes d\xE9passent la portion vocale reconnue dans la piste audio.",
        suggestedFix: "V\xE9rifiez si votre texte inclut un couplet absent de cet extrait ou appliquez les reformulations IA.",
        actionType: reformMap.has(anchor.lineIdx) ? "apply_reformulation" : "seek_inspect"
      });
    }
  }
  if (!recognizedLines.length && nonInterludes.length > 0) {
    problems.push({
      id: "prob_unvoiced_track",
      lineIdx: nonInterludes[0].lineIdx,
      start: 0,
      end: Math.min(durationSec || 5, 5),
      severity: "high",
      category: "empty_or_unvoiced",
      title: "Voix principale tr\xE8s faible ou piste instrumentale",
      description: "Le mod\xE8le vocal n\u2019a pas pu isoler de paroles intelligibles sur cette piste (mix trop dense ou instrumental).",
      suggestedFix: "Utilisez la dict\xE9e micro en direct ou v\xE9rifiez que le fichier audio contient bien la piste chant\xE9e.",
      actionType: "mic_dictate"
    });
    return problems;
  }
  for (const ln of nonInterludes) {
    const ls = +(Number(ln.start) || 0).toFixed(3);
    const le = +Math.max(ls + 0.25, Number(ln.end) || ls + 2).toFixed(3);
    const dur = le - ls;
    const matchR = typeof ln.matchRatio === "number" ? ln.matchRatio : 1;
    const conf = typeof ln.confidence === "number" ? ln.confidence : 0.85;
    const flags = Array.isArray(ln.flags) ? ln.flags : [];
    const hasReform = reformMap.has(ln.lineIdx);
    if (stretchedSet.has(ln.lineIdx) || dur > 7.5 && matchR < 0.35) {
      problems.push({
        id: `prob_gap_${ln.lineIdx}`,
        lineIdx: ln.lineIdx,
        start: ls,
        end: le,
        severity: "medium",
        category: "instrumental_gap_stretch",
        title: `Passage sur pause / instrumental (${dur.toFixed(1)}s)`,
        description: `Ligne #${ln.lineIdx + 1} (\xAB ${ln.text.slice(0, 32)} \xBB) non ancr\xE9e dans une zone instrumentale ou silencieuse : risque de d\xE9rive rythmique.`,
        suggestedFix: "R\xE9-analysez ce segment ou ajustez le point d\u2019entr\xE9e \xE0 l\u2019oreille.",
        actionType: "reanalyze_segment"
      });
      continue;
    }
    if (matchR < 0.25) {
      problems.push({
        id: `prob_mismatch_${ln.lineIdx}`,
        lineIdx: ln.lineIdx,
        start: ls,
        end: le,
        severity: "high",
        category: "complete_text_audio_mismatch",
        title: `\xC9cart important voix / texte (ligne #${ln.lineIdx + 1})`,
        description: hasReform ? `Le texte saisi (\xAB ${ln.text.slice(0, 32)} \xBB) diverge nettement de la voix entendue (\xAB ${reformMap.get(ln.lineIdx).reformulatedText.slice(0, 32)} \xBB).` : `Impossible de relier de fa\xE7on fiable la ligne #${ln.lineIdx + 1} \xE0 la voix entendue \xE0 cet instant.`,
        suggestedFix: hasReform ? "Appliquez la reformulation IA ou r\xE9-\xE9coutez ce passage." : "R\xE9-analysez ce segment ou corrigez cette phrase au micro.",
        actionType: hasReform ? "apply_reformulation" : "reanalyze_segment"
      });
      continue;
    }
    if (conf < 0.68 || flags.includes("uncertain_boundary") || flags.includes("uncertain_word")) {
      const hasVocalWindow = !vocalSegments.length || vocalSegments.some((vs) => vs.end >= ls - 0.5 && vs.start <= le + 0.5);
      problems.push({
        id: `prob_clarity_${ln.lineIdx}`,
        lineIdx: ln.lineIdx,
        start: ls,
        end: le,
        severity: "medium",
        category: hasVocalWindow ? "low_vocal_clarity" : "empty_or_unvoiced",
        title: `Confiance vocale faible sur ligne #${ln.lineIdx + 1}`,
        description: `Articulation masqu\xE9e par l\u2019accompagnement ou chevauchement de ch\u0153urs (indice ${Math.round(conf * 100)}%).`,
        suggestedFix: "Lancez une r\xE9-analyse cibl\xE9e haute pr\xE9cision sur ce segment.",
        actionType: "reanalyze_segment"
      });
    }
  }
  return problems.slice(0, 24);
}
async function reconcileAndReformulateLyrics(params) {
  const {
    ai: ai2 = null,
    userLines = [],
    recognizedLines = [],
    vocalSegments = [],
    divergences = [],
    lang = "auto",
    durationSec = 0,
    matchRatio = 1,
    lineMatchRatios = {},
    stretchedLineIndices = []
  } = params;
  const enrichedLines = userLines.map((ln) => ({
    ...ln,
    matchRatio: typeof ln.matchRatio === "number" ? ln.matchRatio : typeof lineMatchRatios[ln.lineIdx] === "number" ? lineMatchRatios[ln.lineIdx] : 1
  }));
  const candidatePairs = [];
  for (const ln of enrichedLines) {
    if (ln.interlude || !ln.text.trim() || /^\[[^\]]+\]$/.test(ln.text.trim())) continue;
    const { heardText, avgRecConf } = overlappingHeardForLine(ln, recognizedLines, divergences);
    const hasDivergence = divergences.some((d) => d.lineIdx === ln.lineIdx && d.type !== "spelling_fixed");
    const ratio = ln.matchRatio ?? 1;
    const differs = heardText && normComparison(heardText) !== normComparison(ln.text);
    if (differs && (ratio < 0.78 || hasDivergence || (ln.confidence ?? 1) < 0.78)) {
      candidatePairs.push({ line: ln, heardText, avgRecConf });
    }
  }
  let reformulations = [];
  let engineUsed = "whisper+phonetic-reconciler";
  if (ai2 && candidatePairs.length > 0) {
    try {
      const payloadForAi = candidatePairs.slice(0, 30).map((cp) => ({
        lineIdx: cp.line.lineIdx,
        originalText: cp.line.text,
        heardByVoiceASR: cp.heardText,
        startSec: +(Number(cp.line.start) || 0).toFixed(2),
        endSec: +(Number(cp.line.end) || 0).toFixed(2),
        matchRatio: +(cp.line.matchRatio ?? 0.5).toFixed(2)
      }));
      const prompt = `You are a bilingual/multilingual expert lyric editor & phonetician (French, English, Mandarin Chinese zh-Hans/zh-Hant, etc.).
Compare each ORIGINAL user lyric line with what was actually HEARD in the vocal track (heardByVoiceASR).
Language hint: ${lang || "auto"}.

RULES:
1. Reformulate ONLY lines where there is a genuine audible difference, phonetic mondegreen, wrong homophone (e.g. Mandarin Pinyin confusion or French/English spelling error), missing/extra sung words, or phrasing mismatch between originalText and heardByVoiceASR.
2. Keep the authentic language & script of the song (Simplified vs Traditional Chinese, proper French accents & apostrophes, natural English contractions).
3. If originalText and heardByVoiceASR mean practically the same thing or heardByVoiceASR is clearly fragmentary/noisy noise, do NOT output a reformulation for that line.
4. Keep "differenceSummary" very concise (under 10 words, in French unless song language is clearly English or Mandarin, or in clear French studio terms).

Candidate divergent lines:
${JSON.stringify(payloadForAi, null, 2)}`;
      const response = await ai2.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type2.OBJECT,
            properties: {
              reformulations: {
                type: Type2.ARRAY,
                items: {
                  type: Type2.OBJECT,
                  properties: {
                    lineIdx: { type: Type2.INTEGER },
                    reformulatedText: { type: Type2.STRING },
                    differenceType: { type: Type2.STRING },
                    differenceSummary: { type: Type2.STRING },
                    confidence: { type: Type2.NUMBER }
                  },
                  required: ["lineIdx", "reformulatedText", "differenceType", "differenceSummary"]
                }
              }
            },
            required: ["reformulations"]
          }
        }
      });
      const parsed = JSON.parse(response.text || "{}");
      const items = Array.isArray(parsed?.reformulations) ? parsed.reformulations : [];
      const cpMap = new Map(candidatePairs.map((cp) => [cp.line.lineIdx, cp]));
      for (const item of items) {
        const cp = cpMap.get(Number(item?.lineIdx));
        const nextTxt = String(item?.reformulatedText || "").trim();
        if (!cp || !nextTxt || normComparison(nextTxt) === normComparison(cp.line.text)) continue;
        const ls = +(Number(cp.line.start) || 0).toFixed(3);
        const le = +Math.max(ls + 0.3, Number(cp.line.end) || ls + 2.5).toFixed(3);
        const validTypes = [
          "orthography",
          "phonetic_mondegreen",
          "missing_words",
          "extra_words",
          "semantic_mismatch",
          "script_mismatch"
        ];
        const dType = validTypes.includes(item.differenceType) ? item.differenceType : "semantic_mismatch";
        reformulations.push({
          lineIdx: cp.line.lineIdx,
          originalText: cp.line.text,
          heardText: cp.heardText,
          reformulatedText: nextTxt,
          differenceType: dType,
          differenceSummary: String(item.differenceSummary || "Reformulation IA d\u2019apr\xE8s la voix").slice(0, 140),
          confidence: +Math.min(0.97, Math.max(0.55, Number(item.confidence) || 0.86)).toFixed(3),
          start: ls,
          end: le,
          engine: "gemini-4-hydrogen"
        });
      }
      engineUsed = "gemini-4-hydrogen+whisper";
    } catch {
      reformulations = [];
    }
  }
  if (!reformulations.length && candidatePairs.length > 0) {
    for (const cp of candidatePairs) {
      const det = buildDeterministicReformulation(cp.line, cp.heardText, cp.avgRecConf, lang);
      if (det) reformulations.push(det);
    }
  }
  const unresolvableProblems = detectUnresolvableProblems(
    enrichedLines,
    recognizedLines,
    vocalSegments,
    reformulations,
    stretchedLineIndices,
    matchRatio,
    durationSec
  );
  const nonInterludeTotal = enrichedLines.filter((l) => !l.interlude && l.text.trim()).length;
  const alignedLines = enrichedLines.filter((l) => !l.interlude && l.text.trim() && (l.matchRatio ?? 1) >= 0.45).length;
  const divergentLines = candidatePairs.length;
  const overallQuality = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        matchRatio * 75 + (nonInterludeTotal ? alignedLines / nonInterludeTotal : 1) * 25 - unresolvableProblems.filter((p) => p.severity === "high").length * 6
      )
    )
  );
  return {
    success: true,
    engineUsed,
    reformulations,
    unresolvableProblems,
    summary: {
      totalLines: nonInterludeTotal,
      alignedLines,
      divergentLines,
      reformulatedCount: reformulations.length,
      unresolvableCount: unresolvableProblems.length,
      overallQuality,
      engineUsed
    }
  };
}

// server.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = path9.dirname(__filename);
var app = express3();
var portArgIndex = process.argv.indexOf("--port");
var cliPort = portArgIndex !== -1 ? Number(process.argv[portArgIndex + 1]) : null;
var PORT = cliPort || Number(process.env.APP_PORT) || 3e3;
var HOST = "0.0.0.0";
var ai = process.env.GEMINI_API_KEY ? new GoogleGenAI3({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build"
    }
  }
}) : null;
app.use(express3.json({ limit: "35mb" }));
app.use("/api", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-File-Name, X-Chunk-Index");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
});
app.use("/api/v1", createSyncEngineV1Router());
app.use("/api/v2", createPipelineRouter());
function validateHttpsTarget(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "https:") return null;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h === "::1" || h.endsWith(".local") || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h)) {
      return null;
    }
    return u.toString();
  } catch {
    return null;
  }
}
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    app: "Alexura",
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    whisperReady: isWhisperWarm(),
    neuralAsrAvailable: true,
    firebaseConfigured: true,
    vercelConnected: Boolean(process.env.VERCEL || process.env.VERCEL_URL || process.env.EXTERNAL_APP_URL || process.env.VERCEL_DEPLOY_HOOK_URL),
    vercelUrl: process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : process.env.EXTERNAL_APP_URL || "",
    bridgeConfigured: Boolean(process.env.EXTERNAL_APP_URL || process.env.VERCEL_DEPLOY_HOOK_URL),
    endpoints: [
      "/api/health",
      "/api/v2/capabilities",
      "/api/v2/uploads",
      "/api/v2/jobs",
      "/api/v2/songs",
      "/api/weather",
      "/api/weather/search",
      "/api/transcribe-lyrics",
      "/api/transcribe-lyrics/stream",
      "/api/transcribe-voice-clip",
      "/api/audit-lyrics",
      "/api/align-vocals",
      "/api/align-vocals/stream",
      "/api/reconcile-lyrics",
      "/api/reanalyze-segment",
      "/api/qc-auto-perform",
      "/api/translate-lyrics",
      "/api/bridge"
    ]
  });
});
app.post("/api/bridge", async (req, res) => {
  const { action, targetUrl, payload } = req.body || {};
  const explicitTarget = validateHttpsTarget(targetUrl);
  const envTarget = action === "deploy" ? process.env.VERCEL_DEPLOY_HOOK_URL : process.env.EXTERNAL_APP_URL;
  const target = explicitTarget || (envTarget ? validateHttpsTarget(envTarget) : null);
  if (!target) {
    return res.status(200).json({
      success: false,
      reason: action === "deploy" ? "vercel_deploy_hook_not_configured" : action === "ping" ? "vercel_url_not_configured" : "external_app_url_not_configured"
    });
  }
  try {
    if (action === "ping") {
      const u = new URL(target);
      const pingUrl = u.pathname === "/" ? `${u.origin}/api/health` : u.toString();
      const upstream2 = await fetch(pingUrl, { method: "GET" });
      const text2 = await upstream2.text();
      return res.json({
        success: upstream2.ok,
        status: upstream2.status,
        url: pingUrl,
        response: text2.slice(0, 500)
      });
    }
    const upstream = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? { source: "Alexura", timestamp: (/* @__PURE__ */ new Date()).toISOString() })
    });
    const text = await upstream.text();
    return res.json({ success: upstream.ok, status: upstream.status, response: text.slice(0, 500) });
  } catch (err) {
    return res.status(502).json({
      success: false,
      reason: "upstream_unreachable",
      message: err?.message || String(err)
    });
  }
});
function clampConf(val, fallback = 0.84) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return +Math.max(0.05, Math.min(0.98, n)).toFixed(3);
}
function classifyWordTierServer(recConf, alignConf, clarity, overlap, flags) {
  const f = new Set(flags || []);
  const hasUnc = f.has("uncertain_word") || f.has("misrecognized_word") || f.has("missing_word");
  const hasBnd = f.has("uncertain_boundary");
  const overlapPenalty = overlap > 0.45 ? 0.14 : overlap > 0.25 ? 0.06 : 0;
  const clarityPenalty = clarity < 0.45 ? 0.16 : clarity < 0.65 ? 0.06 : 0;
  const overall = Math.max(0.05, Math.min(0.97, +(0.42 * recConf + 0.36 * alignConf + 0.22 * clarity - overlapPenalty - clarityPenalty).toFixed(3)));
  const uncertainty = +Math.max(0.02, Math.min(0.95, 1 - overall)).toFixed(3);
  let tier = "MEDIUM";
  if (!hasUnc && !hasBnd && overlap <= 0.35 && clarity >= 0.65 && recConf >= 0.78 && alignConf >= 0.78 && overall >= 0.78) {
    tier = "HIGH";
  } else if (hasUnc || recConf < 0.65 || alignConf < 0.62 || clarity < 0.45 || overall < 0.58) {
    tier = "LOW";
  }
  return { overall, uncertainty, tier };
}
function buildCharTimingsServer(wordText, start, end, rawChars) {
  const chars = Array.from(wordText);
  const n = chars.length;
  if (!n || end <= start) return chars.map((ch) => ({ ch, start, end }));
  if (Array.isArray(rawChars) && rawChars.length === n) {
    let cPrev = start;
    const out = [];
    for (let i = 0; i < n; i++) {
      const rc = rawChars[i];
      let cs = Number(rc?.start);
      let ce = Number(rc?.end);
      cs = Number.isFinite(cs) ? Math.max(cPrev, Math.min(end - 4e-3, cs)) : cPrev;
      ce = Number.isFinite(ce) ? Math.min(end, Math.max(cs + 4e-3, ce)) : i === n - 1 ? end : Math.min(end, cs + Math.max(0.01, (end - cs) / (n - i)));
      if (i === n - 1) ce = end;
      cs = +cs.toFixed(3);
      ce = +Math.max(cs + 4e-3, ce).toFixed(3);
      cPrev = ce;
      out.push({ ch: chars[i], start: cs, end: ce });
    }
    return out;
  }
  const weights = chars.map((ch) => {
    if (/[aeiouyàâäéèêëîïôöùûüÿæœ]/i.test(ch)) return 1.35;
    if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(ch)) return 1.4;
    if (/[a-zA-Z0-9À-ÿ]/.test(ch)) return 0.9;
    return 0.3;
  });
  const total = weights.reduce((a, b) => a + b, 0) || n;
  const dur = end - start;
  let cur = start;
  return chars.map((ch, idx) => {
    const step = weights[idx] / total * dur;
    const cs = +cur.toFixed(3);
    cur += step;
    const ce = idx === n - 1 ? +end.toFixed(3) : +Math.max(cs + 8e-3, cur).toFixed(3);
    return { ch, start: cs, end: ce };
  });
}
var VALID_WORD_FLAGS = /* @__PURE__ */ new Set([
  "uncertain_word",
  "missing_word",
  "misrecognized_word",
  "overlapping_vocals",
  "uncertain_boundary"
]);
function normalizeFlagsList(rawFlags, recConf, alignConf, vocalType, isUnclear) {
  const set = /* @__PURE__ */ new Set();
  if (Array.isArray(rawFlags)) {
    for (const f of rawFlags) {
      const s = String(f || "").trim().toLowerCase();
      if (VALID_WORD_FLAGS.has(s)) set.add(s);
    }
  }
  if (isUnclear || recConf < 0.72) set.add("uncertain_word");
  if (recConf < 0.52 && !isUnclear) set.add("misrecognized_word");
  if (alignConf < 0.7) set.add("uncertain_boundary");
  if (vocalType === "overlapping" || vocalType === "harmony" || vocalType === "backing") set.add("overlapping_vocals");
  return Array.from(set);
}
function normalizeKaraokeLines(rawLines, chunkOffsetSec = 0) {
  const out = [];
  const off = Math.max(0, Number(chunkOffsetSec) || 0);
  let prevEnd = off;
  for (const l of rawLines) {
    const vocalTypeRaw = String(l?.vocalType || "singing").toLowerCase();
    const isInst = vocalTypeRaw === "instrumental" || Boolean(l?.isInstrumentalSection);
    const isUnclear = Boolean(l?.unclear) || vocalTypeRaw === "unclear";
    let text = String(l?.text || "").trim();
    if (!text && isInst) text = "[INSTRUMENTAL]";
    if (!text && isUnclear) text = "[Unclear vocal]";
    if (!text) continue;
    let start = Math.max(prevEnd, (Number(l?.start) || 0) + off);
    let end = Math.max(start + 0.12, (Number(l?.end) || start - off + 2) + off);
    start = +start.toFixed(3);
    end = +end.toFixed(3);
    prevEnd = end;
    const section = String(l?.section || (isInst ? "instrumental" : "verse")).toLowerCase();
    const backingText = l?.backingText ? String(l.backingText).trim() : "";
    const language = l?.language ? String(l.language).trim() : "";
    const isRepeatedChorus = Boolean(l?.isRepeatedChorus) || section === "chorus";
    const lineSpeaker = String(l?.speaker || (vocalTypeRaw === "backing" || vocalTypeRaw === "harmony" ? "Backing" : vocalTypeRaw === "speech" ? "Speaker" : "Lead")).trim();
    const lineRecConf = clampConf(l?.recognitionConfidence, isUnclear ? 0.35 : 0.92);
    const lineAlignConf = clampConf(l?.alignmentConfidence, isUnclear ? 0.45 : 0.9);
    const lineFlags = normalizeFlagsList(l?.flags, lineRecConf, lineAlignConf, vocalTypeRaw, isUnclear);
    const validationNote = l?.validationNote ? String(l.validationNote).trim() : "";
    if (isInst) {
      out.push({
        text: "[INSTRUMENTAL]",
        start,
        end,
        section: section || "instrumental",
        vocalType: "instrumental",
        language,
        speaker: "Instrumental",
        recognitionConfidence: 0.96,
        alignmentConfidence: 0.95,
        isRepeatedChorus: false,
        backingText: "",
        unclear: false,
        isInstrumentalSection: true,
        flags: [],
        validationNote: "",
        words: []
      });
      continue;
    }
    const rawWords = Array.isArray(l?.words) ? l.words : [];
    const words = [];
    if (rawWords.length > 0) {
      let wPrev = start;
      for (let wi = 0; wi < rawWords.length; wi++) {
        const w = rawWords[wi];
        const wText = String(w?.text || "").trim();
        if (!wText) continue;
        let ws = Number(w?.start);
        let we = Number(w?.end);
        ws = Number.isFinite(ws) ? ws + off : wPrev;
        if (ws < wPrev) ws = wPrev;
        if (ws > end - 0.02) ws = Math.max(start, end - 0.02);
        we = Number.isFinite(we) ? we + off : NaN;
        if (!Number.isFinite(we) || we <= ws) we = ws + Math.max(0.04, (end - ws) / Math.max(1, rawWords.length - wi));
        if (we > end) we = end;
        ws = +ws.toFixed(3);
        we = +Math.max(ws + 0.015, we).toFixed(3);
        wPrev = we;
        const shiftedChars = Array.isArray(w?.chars) ? w.chars.map((ch) => ({
          ch: ch?.ch,
          start: Number.isFinite(Number(ch?.start)) ? Number(ch.start) + off : void 0,
          end: Number.isFinite(Number(ch?.end)) ? Number(ch.end) + off : void 0
        })) : void 0;
        const shiftedPhonemes = Array.isArray(w?.phonemes) ? w.phonemes.map((ph) => ({
          unit: String(ph?.unit || "").trim(),
          start: +Math.max(ws, Math.min(we, (Number(ph?.start) || 0) + off)).toFixed(3),
          end: +Math.max(ws + 5e-3, Math.min(we, (Number(ph?.end) || 0) + off)).toFixed(3)
        })).filter((ph) => ph.unit) : void 0;
        const wRec = clampConf(w?.recognitionConfidence, lineRecConf);
        const wAlign = clampConf(w?.alignmentConfidence, lineAlignConf);
        const wSpk = String(w?.speaker || lineSpeaker).trim();
        const wUnclear = isUnclear || /\[unclear/i.test(wText);
        const wClarity = clampConf(w?.audioClarity, wUnclear ? 0.32 : 0.78);
        const wOverlap = +Math.max(0, Math.min(1, Number(w?.vocalOverlap ?? (vocalTypeRaw === "overlapping" || vocalTypeRaw === "harmony" || vocalTypeRaw === "backing" ? 0.68 : 0.08)))).toFixed(3);
        const wFlags = normalizeFlagsList(w?.flags, wRec, wAlign, vocalTypeRaw, wUnclear);
        const qMeta = classifyWordTierServer(wRec, wAlign, wClarity, wOverlap, wFlags);
        words.push({
          text: wText,
          start: ws,
          end: we,
          chars: buildCharTimingsServer(wText, ws, we, shiftedChars),
          phonemes: shiftedPhonemes && shiftedPhonemes.length ? shiftedPhonemes : void 0,
          recognitionConfidence: wRec,
          alignmentConfidence: wAlign,
          audioClarity: wClarity,
          vocalOverlap: wOverlap,
          recognitionUncertainty: qMeta.uncertainty,
          qualityTier: qMeta.tier,
          speaker: wSpk,
          flags: wFlags
        });
      }
    }
    if (!words.length) {
      const tokens = text.match(/[A-Za-zÀ-ÿ\u1e00-\u1eff0-9'’\-]+[,.;:!?…]?|[\u4e00-\u9fff\u3400-\u4dbf]|[\u3040-\u309f\u30a0-\u30ff][\u3041\u3043\u3045\u3047\u3049\u3063\u3083\u3085\u3087\u308e\u30a1\u30a3\u30a5\u30a7\u30a9\u30c3\u30e3\u30e5\u30e7\u30ee\u30fc]?|[\uac00-\ud7af]|[^\s]/g) || [text];
      const weights = tokens.map((tk) => Math.max(0.8, tk.replace(/[^A-Za-zÀ-ÿ\u1e00-\u1eff0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, "").length));
      const totalW = weights.reduce((a, b) => a + b, 0) || tokens.length;
      let cur = start;
      tokens.forEach((tk, wi) => {
        const dur = weights[wi] / totalW * (end - start);
        const ws = +cur.toFixed(3);
        cur += dur;
        const we = wi === tokens.length - 1 ? end : +Math.max(ws + 0.015, cur).toFixed(3);
        const wAlign = +Math.max(0.45, Math.min(0.92, lineAlignConf * 0.78)).toFixed(3);
        const wClarity = isUnclear ? 0.35 : 0.74;
        const wOverlap = vocalTypeRaw === "overlapping" || vocalTypeRaw === "harmony" || vocalTypeRaw === "backing" ? 0.65 : 0.1;
        const wFlags = normalizeFlagsList(lineFlags, lineRecConf, wAlign, vocalTypeRaw, isUnclear);
        const qMeta = classifyWordTierServer(lineRecConf, wAlign, wClarity, wOverlap, wFlags);
        words.push({
          text: tk,
          start: ws,
          end: we,
          chars: buildCharTimingsServer(tk, ws, we),
          recognitionConfidence: lineRecConf,
          alignmentConfidence: wAlign,
          audioClarity: wClarity,
          vocalOverlap: wOverlap,
          recognitionUncertainty: qMeta.uncertainty,
          qualityTier: qMeta.tier,
          speaker: lineSpeaker,
          flags: wFlags
        });
      });
    }
    out.push({
      text,
      start,
      end,
      section,
      vocalType: isUnclear ? "unclear" : vocalTypeRaw,
      language,
      speaker: lineSpeaker,
      recognitionConfidence: lineRecConf,
      alignmentConfidence: lineAlignConf,
      isRepeatedChorus,
      backingText,
      unclear: isUnclear,
      isInstrumentalSection: false,
      flags: lineFlags,
      validationNote,
      words
    });
  }
  return out;
}
function summarizeValidation(lines, missingGaps = []) {
  let uncertainWords = 0;
  let misrecognizedWords = 0;
  let overlappingWords = 0;
  let uncertainBoundaries = 0;
  let highConfidenceWords = 0;
  let mediumConfidenceWords = 0;
  let lowConfidenceWords = 0;
  let totalWords = 0;
  for (const ln of lines) {
    for (const w of ln.words || []) {
      totalWords++;
      const f = new Set(w.flags || []);
      if (f.has("uncertain_word")) uncertainWords++;
      if (f.has("misrecognized_word")) misrecognizedWords++;
      if (f.has("overlapping_vocals")) overlappingWords++;
      if (f.has("uncertain_boundary")) uncertainBoundaries++;
      const tier = w.qualityTier || classifyWordTierServer(
        Number(w.recognitionConfidence ?? 0.8),
        Number(w.alignmentConfidence ?? 0.78),
        Number(w.audioClarity ?? 0.75),
        Number(w.vocalOverlap ?? 0.1),
        w.flags || []
      ).tier;
      if (tier === "HIGH") highConfidenceWords++;
      else if (tier === "LOW") lowConfidenceWords++;
      else mediumConfidenceWords++;
    }
  }
  return {
    totalWords,
    highConfidenceWords,
    mediumConfidenceWords,
    lowConfidenceWords,
    uncertainWords,
    missingWords: Array.isArray(missingGaps) ? missingGaps.length : 0,
    misrecognizedWords,
    overlappingWords,
    uncertainBoundaries,
    missingVocalGaps: Array.isArray(missingGaps) ? missingGaps : []
  };
}
app.post("/api/audit-lyrics", (req, res) => {
  try {
    const { lyrics, lines, lang } = req.body || {};
    const entries = Array.isArray(lines) && lines.length ? lines.map((l, k) => ({
      lineIdx: typeof l?.i === "number" ? l.i : typeof l?.index === "number" ? l.index : k,
      rawText: typeof l === "string" ? l : String(l?.text || "")
    })) : String(lyrics || "").split(/\r?\n/).map((t, k) => ({ lineIdx: k, rawText: t }));
    const report = analyzeAndFixOrthography(entries.map((e) => e.rawText), String(lang || "auto"));
    const correctedLines = {};
    entries.forEach((e, k) => {
      const nextTxt = report.correctedLines[k];
      if (nextTxt && nextTxt.trim() !== e.rawText.trim()) {
        correctedLines[e.lineIdx] = nextTxt;
      }
    });
    const changes = report.changes.map((ch) => ({
      ...ch,
      lineIdx: entries[ch.lineIdx]?.lineIdx ?? ch.lineIdx
    }));
    return res.json({
      success: true,
      detectedLanguage: report.detectedLanguage,
      spellingFixCount: changes.length,
      changes,
      correctedLines,
      correctedText: report.correctedText
    });
  } catch (err) {
    return res.status(200).json({
      success: false,
      reason: "audit_error",
      message: (err?.message || String(err || "")).slice(0, 200)
    });
  }
});
app.post("/api/reconcile-lyrics", async (req, res) => {
  try {
    const {
      lines,
      recognizedLines,
      vocalSegments,
      divergences,
      corrections,
      lang,
      durationSec,
      matchRatio,
      lineMatchRatios,
      stretchedLineIndices
    } = req.body || {};
    if (!Array.isArray(lines) || !lines.length) {
      return res.status(200).json({ success: false, reason: "missing_lines", reformulations: [], unresolvableProblems: [] });
    }
    const userLines = lines.map((l, idx) => ({
      lineIdx: typeof l?.lineIdx === "number" ? l.lineIdx : typeof l?.i === "number" ? l.i : typeof l?.index === "number" ? l.index : idx,
      text: String(l?.text || ""),
      start: Number(l?.start) || 0,
      end: Number(l?.end) || 0,
      confidence: typeof l?.confidence === "number" ? l.confidence : void 0,
      matchRatio: typeof l?.matchRatio === "number" ? l.matchRatio : void 0,
      flags: Array.isArray(l?.flags) ? l.flags : [],
      interlude: Boolean(l?.interlude)
    }));
    const result = await reconcileAndReformulateLyrics({
      ai,
      userLines,
      recognizedLines: Array.isArray(recognizedLines) ? recognizedLines : [],
      vocalSegments: Array.isArray(vocalSegments) ? vocalSegments : [],
      divergences: Array.isArray(divergences) ? divergences : [],
      corrections: Array.isArray(corrections) ? corrections : [],
      lang: String(lang || "auto"),
      durationSec: Number(durationSec) || 0,
      matchRatio: typeof matchRatio === "number" ? matchRatio : 1,
      lineMatchRatios: lineMatchRatios && typeof lineMatchRatios === "object" ? lineMatchRatios : {},
      stretchedLineIndices: Array.isArray(stretchedLineIndices) ? stretchedLineIndices : []
    });
    return res.json(result);
  } catch (err) {
    return res.status(200).json({
      success: false,
      reason: "reconcile_error",
      message: (err?.message || String(err || "")).slice(0, 300),
      reformulations: [],
      unresolvableProblems: []
    });
  }
});
async function runVocalSyncPipeline(body, onProgress) {
  const { audioBase64, separatedVocalBase64, lines, lang, vocalSegments, durationSec } = body || {};
  if (!audioBase64 || !Array.isArray(lines) || !lines.length) {
    return { success: false, reason: "missing_input" };
  }
  const runWhisperAlignFallback = async (geminiErrReason) => {
    try {
      const dtwRes = await alignLyricsWithWhisperDTW({
        audioBase64,
        separatedVocalBase64,
        lines,
        lang: lang || "auto",
        vocalSegments: Array.isArray(vocalSegments) ? vocalSegments : [],
        onProgress: (evt) => {
          onProgress?.({ event: "progress", payload: evt });
        }
      });
      const recLinesNorm = Array.isArray(dtwRes.recognizedLines) && dtwRes.recognizedLines.length ? normalizeKaraokeLines(dtwRes.recognizedLines, 0) : [];
      const userLinesForReconcile = lines.map((l, k) => {
        const li = typeof l?.i === "number" ? l.i : typeof l?.index === "number" ? l.index : k;
        const wArr = dtwRes.wordTimes[li] || [];
        const ls = dtwRes.lineTimes[li] ?? (wArr[0]?.start ?? 0);
        const le = wArr.length ? wArr[wArr.length - 1].end : ls + 2;
        const meta = dtwRes.lineMeta[li] || {};
        return {
          lineIdx: li,
          text: dtwRes.correctedLines[li] || String(l?.text || ""),
          start: ls,
          end: le,
          confidence: meta.alignmentConfidence ?? 0.85,
          matchRatio: dtwRes.lineMatchRatios?.[li] ?? dtwRes.matchRatio,
          flags: Array.isArray(meta.flags) ? meta.flags : [],
          interlude: /^\[interlude/i.test(String(l?.text || "").trim())
        };
      });
      onProgress?.({
        event: "progress",
        payload: {
          stage: 6,
          step: "reformulation",
          pct: 92,
          label: "Diagnostic & validation finale voix-paroles\u2026",
          matchedCount: dtwRes.matchedCount
        }
      });
      const reconcile = await reconcileAndReformulateLyrics({
        ai,
        userLines: userLinesForReconcile,
        recognizedLines: recLinesNorm.map((rl) => ({
          text: rl.text,
          start: rl.start,
          end: rl.end,
          recognitionConfidence: rl.recognitionConfidence
        })),
        vocalSegments: Array.isArray(vocalSegments) ? vocalSegments : [],
        divergences: dtwRes.divergences,
        corrections: dtwRes.corrections,
        lang: dtwRes.detectedLanguage !== "auto" ? dtwRes.detectedLanguage : String(lang || "auto"),
        durationSec: Number(durationSec) || 0,
        matchRatio: dtwRes.matchRatio,
        lineMatchRatios: dtwRes.lineMatchRatios,
        stretchedLineIndices: dtwRes.stretchedLineIndices
      });
      if (dtwRes.success && Object.keys(dtwRes.lineTimes).length > 0) {
        return {
          success: true,
          source: "neural_whisper_dtw",
          engine: dtwRes.engine,
          matchedCount: dtwRes.matchedCount,
          matchRatio: dtwRes.matchRatio,
          lineTimes: dtwRes.lineTimes,
          wordTimes: dtwRes.wordTimes,
          lineMeta: dtwRes.lineMeta,
          lineMatchRatios: dtwRes.lineMatchRatios,
          corrections: dtwRes.corrections,
          spellingFixCount: dtwRes.spellingFixCount,
          correctedLines: dtwRes.correctedLines,
          correctedText: dtwRes.correctedText,
          divergences: dtwRes.divergences,
          reformulations: reconcile.reformulations,
          unresolvableProblems: reconcile.unresolvableProblems,
          reconcileSummary: reconcile.summary,
          detectedLanguage: dtwRes.detectedLanguage,
          recognizedLines: recLinesNorm,
          recognizedTranscript: recLinesNorm.length ? dtwRes.recognizedTranscript : ""
        };
      }
      return {
        success: false,
        reason: geminiErrReason || "no_vocal_match",
        matchedCount: 0,
        matchRatio: 0,
        corrections: dtwRes.corrections,
        spellingFixCount: dtwRes.spellingFixCount,
        correctedLines: dtwRes.correctedLines,
        correctedText: dtwRes.correctedText,
        divergences: dtwRes.divergences,
        reformulations: reconcile.reformulations,
        unresolvableProblems: reconcile.unresolvableProblems,
        reconcileSummary: reconcile.summary,
        detectedLanguage: dtwRes.detectedLanguage,
        recognizedLines: recLinesNorm,
        recognizedTranscript: dtwRes.recognizedTranscript || "",
        requiresBilling: false
      };
    } catch (wErr) {
      return {
        success: false,
        reason: "alignment_error",
        requiresBilling: false,
        message: (wErr?.message || String(wErr || "")).slice(0, 300)
      };
    }
  };
  if (!ai) {
    return runWhisperAlignFallback();
  }
  try {
    onProgress?.({
      event: "progress",
      payload: { stage: 1, step: "orthography", pct: 12, label: "Analyse orthographe & extraction vocale\u2026" }
    });
    const cleanSegs = Array.isArray(vocalSegments) ? vocalSegments.slice(0, 48).map((s) => `[${(Number(s?.start) || 0).toFixed(2)}..${(Number(s?.end) || 0).toFixed(2)}]`).join(", ") : "";
    const segHint = cleanSegs ? `
Acoustic vocal activity windows (seconds): ${cleanSegs}.` : "";
    const prompt = `You are a singing-aware forced-alignment phonetician and lyric validator executing Stages 4-6.
Analyze BOTH the original mix reference${separatedVocalBase64 ? " AND the center-isolated vocal stem provided" : ""}. Language hint: ${lang || "auto"}.${segHint}
Ordered list of lyric lines to align:
${JSON.stringify(lines, null, 2)}

CRITICAL SINGING-AWARE ALIGNMENT & VALIDATION RULES:
- Distinguish actual SINGING performance (sustained vowels, vibrato, melisma, vocal onsets) from ordinary speech or musical beats.
- NEVER divide line duration equally among words, NEVER estimate blindly from character length, and NEVER snap onto accompaniment beats instead of vocal attacks.
- For Chinese, Japanese, and Korean, output individual Chinese character / kana mora / Hangul syllable boundaries accurately.
- Preserve silent pauses and breath gaps cleanly between lines and words.
- Stage 6 Validation: Compare provided lyrics honestly against singing audio and flag any of:
  "uncertain_word", "missing_word", "misrecognized_word", "overlapping_vocals", "uncertain_boundary".`;
    const contentParts = [
      {
        inlineData: {
          mimeType: "audio/wav",
          data: audioBase64
        }
      }
    ];
    if (separatedVocalBase64) {
      contentParts.push({
        inlineData: {
          mimeType: "audio/wav",
          data: separatedVocalBase64
        }
      });
    }
    contentParts.push({ text: prompt });
    const response = await ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: contentParts,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type3.OBJECT,
          properties: {
            alignments: {
              type: Type3.ARRAY,
              items: {
                type: Type3.OBJECT,
                properties: {
                  index: { type: Type3.INTEGER },
                  start: { type: Type3.NUMBER },
                  end: { type: Type3.NUMBER },
                  speaker: { type: Type3.STRING },
                  recognitionConfidence: { type: Type3.NUMBER },
                  alignmentConfidence: { type: Type3.NUMBER },
                  flags: { type: Type3.ARRAY, items: { type: Type3.STRING } },
                  validationNote: { type: Type3.STRING },
                  words: {
                    type: Type3.ARRAY,
                    items: {
                      type: Type3.OBJECT,
                      properties: {
                        text: { type: Type3.STRING },
                        start: { type: Type3.NUMBER },
                        end: { type: Type3.NUMBER },
                        recognitionConfidence: { type: Type3.NUMBER },
                        alignmentConfidence: { type: Type3.NUMBER },
                        speaker: { type: Type3.STRING },
                        flags: { type: Type3.ARRAY, items: { type: Type3.STRING } }
                      },
                      required: ["text", "start", "end"]
                    }
                  }
                },
                required: ["index", "start", "end"]
              }
            }
          },
          required: ["alignments"]
        }
      }
    });
    const parsed = JSON.parse(response.text || "{}");
    const lineTimes = {};
    const wordTimes = {};
    const lineMeta = {};
    if (parsed.alignments && Array.isArray(parsed.alignments)) {
      const sorted = parsed.alignments.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      const normalized = normalizeKaraokeLines(
        sorted.map((item) => ({
          text: lines.find((l) => l.i === item.index || l.index === item.index)?.text || (item.words || []).map((w) => w.text).join(" "),
          start: item.start,
          end: item.end,
          speaker: item.speaker,
          recognitionConfidence: item.recognitionConfidence,
          alignmentConfidence: item.alignmentConfidence,
          flags: item.flags,
          validationNote: item.validationNote,
          words: item.words
        }))
      );
      sorted.forEach((item, idx) => {
        if (typeof item.index === "number" && typeof item.start === "number" && normalized[idx]) {
          lineTimes[item.index] = normalized[idx].start;
          wordTimes[item.index] = normalized[idx].words;
          lineMeta[item.index] = {
            speaker: normalized[idx].speaker,
            recognitionConfidence: normalized[idx].recognitionConfidence,
            alignmentConfidence: normalized[idx].alignmentConfidence,
            flags: normalized[idx].flags,
            validationNote: normalized[idx].validationNote
          };
        }
      });
    }
    const preAudit = analyzeAndFixOrthography(lines.map((l) => String(l?.text || "")), String(lang || "auto"));
    const correctedLines = {};
    lines.forEach((l, k) => {
      const li = typeof l?.i === "number" ? l.i : typeof l?.index === "number" ? l.index : k;
      const nextTxt = preAudit.correctedLines[k];
      if (nextTxt && nextTxt.trim() !== String(l?.text || "").trim()) {
        correctedLines[li] = nextTxt;
      }
    });
    const corrections = preAudit.changes.map((ch) => ({
      ...ch,
      lineIdx: typeof lines[ch.lineIdx]?.i === "number" ? lines[ch.lineIdx].i : ch.lineIdx
    }));
    const userLinesGem = lines.map((l, k) => {
      const li = typeof l?.i === "number" ? l.i : typeof l?.index === "number" ? l.index : k;
      const wArr = wordTimes[li] || [];
      const ls = lineTimes[li] ?? (wArr[0]?.start ?? 0);
      const le = wArr.length ? wArr[wArr.length - 1].end : ls + 2;
      const meta = lineMeta[li] || {};
      return {
        lineIdx: li,
        text: correctedLines[li] || String(l?.text || ""),
        start: ls,
        end: le,
        confidence: meta.alignmentConfidence ?? 0.88,
        matchRatio: (meta.flags || []).includes("misrecognized_word") ? 0.3 : 1,
        flags: Array.isArray(meta.flags) ? meta.flags : [],
        interlude: /^\[interlude/i.test(String(l?.text || "").trim())
      };
    });
    onProgress?.({
      event: "progress",
      payload: {
        stage: 5,
        step: "moment_refinement",
        pct: 76,
        label: "Alignement vocal confirm\xE9 \u2014 coordination instant par instant\u2026",
        partialLineTimes: lineTimes,
        partialWordTimes: wordTimes
      }
    });
    const gemRecLines = (parsed.alignments || []).map((a) => ({
      text: (a.words || []).map((w) => w.text).join(" ").trim(),
      start: Number(a.start) || 0,
      end: Number(a.end) || 0,
      recognitionConfidence: Number(a.recognitionConfidence) || 0.88
    })).filter((r) => r.text);
    onProgress?.({
      event: "progress",
      payload: { stage: 6, step: "reformulation", pct: 92, label: "Diagnostic & validation finale voix-paroles\u2026" }
    });
    const reconcile = await reconcileAndReformulateLyrics({
      ai,
      userLines: userLinesGem,
      recognizedLines: gemRecLines,
      vocalSegments: Array.isArray(vocalSegments) ? vocalSegments : [],
      divergences: [],
      corrections,
      lang: preAudit.detectedLanguage !== "auto" ? preAudit.detectedLanguage : String(lang || "auto"),
      durationSec: Number(durationSec) || 0,
      matchRatio: 1
    });
    return {
      success: true,
      source: "gemini_cloud",
      lineTimes,
      wordTimes,
      lineMeta,
      corrections,
      spellingFixCount: corrections.length,
      correctedLines,
      correctedText: preAudit.correctedText,
      reformulations: reconcile.reformulations,
      unresolvableProblems: reconcile.unresolvableProblems,
      reconcileSummary: reconcile.summary,
      recognizedLines: gemRecLines,
      detectedLanguage: preAudit.detectedLanguage
    };
  } catch (err) {
    const msg = err?.message || String(err || "");
    const isBilling = msg.includes("billing") || msg.includes("free tier") || err?.status === "PERMISSION_DENIED" || err?.code === 403;
    return runWhisperAlignFallback(isBilling ? "billing_fallback_whisper" : "alignment_fallback_whisper");
  }
}
app.post("/api/align-vocals", async (req, res) => {
  try {
    const result = await runVocalSyncPipeline(req.body);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(200).json({
      success: false,
      reason: "alignment_error",
      requiresBilling: false,
      message: (err?.message || String(err || "")).slice(0, 300)
    });
  }
});
app.post("/api/align-vocals/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  let closed = false;
  res.on("close", () => {
    if (!res.writableEnded) closed = true;
  });
  try {
    const result = await runVocalSyncPipeline(req.body, (evt) => {
      if (closed) return;
      sendSseEvent(res, evt.event, evt.payload || {});
    });
    if (!closed) {
      if (result && result.success) {
        sendSseEvent(res, "result", result);
      } else {
        sendSseEvent(res, "error", result || { success: false, reason: "alignment_error" });
      }
      res.end();
    }
  } catch (err) {
    if (!closed) {
      sendSseEvent(res, "error", {
        success: false,
        reason: "alignment_error",
        requiresBilling: false,
        message: (err?.message || String(err || "")).slice(0, 300)
      });
      res.end();
    }
  }
});
function parseTranscriptLinesForRecovery(transcript, vocalSegments = [], chunkDurationSec = 30, offsetSec = 0, hintLang = "auto") {
  const rawLines = String(transcript || "").split(/\r?\n/).map((s) => s.replace(/^\s*(?:\[\d{1,2}:\d{2}(?:\.\d+)?\]\s*)+/, "").trim()).filter((s) => s && !/^\[?(?:INSTRUMENTAL|UNCLEAR)\]?$/i.test(s));
  if (!rawLines.length) return [];
  const segs = Array.isArray(vocalSegments) && vocalSegments.length ? vocalSegments.filter((s) => Number.isFinite(Number(s?.start)) && Number.isFinite(Number(s?.end)) && Number(s.end) > Number(s.start)) : [];
  const totalSpan = Math.max(2, Number(chunkDurationSec) || 30);
  const out = [];
  rawLines.forEach((lineText, i) => {
    let speaker = "Lead";
    let cleanText = lineText;
    const spMatch = cleanText.match(/^\[?(Lead|Singer\s*\d+|Backing|Harmony|Speaker)\s*:\s*\]?\s*(.+)$/i);
    if (spMatch) {
      speaker = spMatch[1].trim();
      cleanText = spMatch[2].trim();
    }
    const seg = segs[i];
    const startRel = seg ? Math.max(0, Number(seg.start) - offsetSec) : i / rawLines.length * totalSpan;
    const endRel = seg ? Math.max(startRel + 0.35, Number(seg.end) - offsetSec) : Math.max(startRel + 0.5, (i + 1) / rawLines.length * totalSpan);
    out.push({
      text: cleanText,
      start: +startRel.toFixed(3),
      end: +endRel.toFixed(3),
      section: "verse",
      vocalType: "singing",
      language: hintLang && hintLang !== "auto" && hintLang !== "multi" ? hintLang : "",
      speaker,
      recognitionConfidence: 0.88,
      alignmentConfidence: 0.72,
      flags: ["uncertain_boundary"],
      words: []
    });
  });
  return out;
}
async function runWhisperFallbackPipeline(body, onProgress) {
  const {
    audioBase64,
    separatedVocalBase64,
    lang,
    chunkStartSec,
    chunkDurationSec,
    duration
  } = body || {};
  const offsetSec = Math.max(0, Number(chunkStartSec) || 0);
  const winDur = Math.max(1, Number(chunkDurationSec) || Number(duration) || 30);
  const wRes = await transcribeWithWhisper({
    audioBase64,
    separatedVocalBase64,
    lang: lang || "auto",
    chunkStartSec: offsetSec,
    chunkDurationSec: winDur,
    onProgress
  });
  onProgress?.({ stage: 4, event: "stage", payload: { label: "aligning" } });
  const lines = normalizeKaraokeLines(wRes.lines, 0);
  const validationSummary = summarizeValidation(lines, []);
  return {
    success: true,
    engine: "neural_whisper",
    needsClientAcousticAlign: false,
    audioType: wRes.audioType,
    language: wRes.language,
    detectedLanguages: wRes.detectedLanguages,
    detectedSpeakers: wRes.detectedSpeakers,
    hasBackingVocals: wRes.hasBackingVocals,
    hasUnclearSections: wRes.hasUnclearSections,
    hasInstrumentalSections: wRes.hasInstrumentalSections,
    hasRepeatedChorus: wRes.hasRepeatedChorus,
    title: "",
    artist: "",
    isInstrumental: wRes.isInstrumental,
    sections: [],
    validationSummary,
    pipelineModels: {
      separation: separatedVocalBase64 ? "client_mid_side+ffmpeg_vocal_stem" : "ffmpeg_vocal_bandpass_stem",
      transcription: "whisper-base-q8",
      forcedAlignment: "whisper_word_timestamps+10ms_viterbi"
    },
    lines
  };
}
async function runSingingTranscriptionPipeline(body, onProgress) {
  const {
    audioBase64,
    separatedVocalBase64,
    lang,
    audioFormat,
    duration,
    sampleRate,
    chunkStartSec,
    chunkDurationSec,
    preprocessingSummary,
    vocalSegments
  } = body || {};
  if (!audioBase64) {
    return { success: false, reason: "no_audio" };
  }
  if (!ai) {
    return runWhisperFallbackPipeline(body, onProgress);
  }
  const offsetSec = Math.max(0, Number(chunkStartSec) || 0);
  const winDur = Math.max(1, Number(chunkDurationSec) || Number(duration) || 30);
  const cleanSegments = Array.isArray(vocalSegments) ? vocalSegments.slice(0, 48).map((s) => ({
    start: +Math.max(0, (Number(s?.start) || 0) - offsetSec).toFixed(2),
    end: +Math.max(0.2, (Number(s?.end) || 0) - offsetSec).toFixed(2)
  })).filter((s) => s.end > s.start) : [];
  onProgress?.({ stage: 3, event: "stage", payload: { label: "transcribing" } });
  let vocalTranscript = "";
  try {
    const segHint = cleanSegments.length ? `
Detected acoustic vocal windows in this clip (relative seconds): ${cleanSegments.slice(0, 18).map((s) => `${s.start}-${s.end}`).join(", ")}.` : "";
    const transcribeParts = [
      {
        inlineData: {
          mimeType: "audio/wav",
          data: separatedVocalBase64 || audioBase64
        }
      },
      {
        text: `Listen carefully to this audio recording as a specialized multilingual SINGING & SPEECH recognition model (format: ${audioFormat || "audio"}, original sample rate: ${sampleRate || "unknown"}Hz, window duration: ${winDur}s${separatedVocalBase64 ? ", vocal-enhanced stem provided" : ""}).${segHint}
1. Process actual SINGING voices (sustained notes, vibrato, melisma, high belting, rap, spoken intros/outros) AND clear speech, NOT just casual conversation cadence.
2. Output EVERY sung or spoken line verbatim on its own line in its exact original language & native script (English, French, Chinese Mandarin/Cantonese, Spanish, German, Japanese, Korean, Italian, Portuguese, etc.; hint: ${lang && lang !== "auto" && lang !== "multi" ? lang : "auto-detect multilingual & code-switching"}).
3. NEVER translate lyrics during transcription. Preserve contractions, French accents, CJK characters, ad-libs, and ALL repeated choruses accurately.
4. Keep line breaks matched to natural sung phrasing so each line is crisp and ready for karaoke synchronization.
5. Mark pure non-vocal instrumental passages as [INSTRUMENTAL]. If a brief phrase is genuinely masked/inaudible, mark [UNCLEAR] instead of inventing words.`
      }
    ];
    const transcribeResp = await ai.models.generateContent({
      model: "gemini-3.5-transcribe",
      contents: transcribeParts
    });
    vocalTranscript = String(transcribeResp.text || "").trim();
    if (vocalTranscript) {
      const previewLines = vocalTranscript.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      onProgress?.({
        stage: 3,
        event: "transcript_preview",
        payload: { transcript: vocalTranscript, previewLines, offsetSec }
      });
    }
  } catch (tErr) {
    const tMsg = tErr?.message || String(tErr || "");
    if (tMsg.includes("billing") || tMsg.includes("free tier") || errIsPermissionDenied(tErr)) {
      return runWhisperFallbackPipeline(body, onProgress);
    }
  }
  onProgress?.({ stage: 4, event: "stage", payload: { label: "aligning" } });
  const stage1Hint = preprocessingSummary ? `
Stage 1-2 acoustic map: sampleRate=${preprocessingSummary.sampleRate || sampleRate}Hz, silenceCount=${preprocessingSummary.silenceCount ?? 0}, vocalSegments=${preprocessingSummary.vocalPhraseCount ?? cleanSegments.length}, instrumentalGaps=${preprocessingSummary.instrumentalGapCount ?? 0}.` : "";
  const segAnchorText = cleanSegments.length ? `
Acoustic vocal intervals (rel sec): ${cleanSegments.slice(0, 24).map((s) => `[${s.start}..${s.end}]`).join(", ")}.` : "";
  const alignPrompt = `You are a singing-aware forced-alignment phonetician and lyric validator executing Stages 4-6.
Analyze the original mix${separatedVocalBase64 ? " AND center-vocal stem" : ""}.${vocalTranscript ? `

Stage 3 verbatim singing transcript (verify and align accurately):
${vocalTranscript}
` : ""}${stage1Hint}${segAnchorText}
Preserve timeline starting at 0.000s of this audio window (${winDur}s total). Output strict structured JSON:
1. "audioType": "singing" | "speech" | "instrumental" | "combination".
2. "language": primary BCP-47 code ("en","fr","zh-Hans","zh-Hant","es","de","ja","ko","it","pt","multi", or "instrumental"). Hint: ${lang || "auto"}.
3. "detectedLanguages": array of ALL distinct BCP-47 languages sung/spoken.
4. "detectedSpeakers": array of active performers (e.g. ["Lead"], ["Lead","Backing"]).
5. "hasBackingVocals", "hasUnclearSections", "hasInstrumentalSections", "hasRepeatedChorus": booleans.
6. "sections": ordered sections { "type", "label", "start", "end", "isRepeat" }.
7. "missingVocalGaps": array of { "start", "end", "reason" } only when audible singing cannot be deciphered.
8. "lines": chronological array covering EVERY sung line, speech phrase, or instrumental break:
   - "text": Exact verbatim lyric in original script, "[INSTRUMENTAL]", or "[Unclear vocal]".
   - "start" & "end": Exact vocal onset & release timestamps in seconds (3 decimals).
   - "section", "vocalType", "language", "speaker", "recognitionConfidence" (0..1), "alignmentConfidence" (0..1), "flags", "validationNote", "isRepeatedChorus", "backingText", "unclear".
   - "words": aligned tokens (for Chinese output EVERY individual character as a token; for Japanese/Korean syllable/mora clusters): { "text", "start", "end", "recognitionConfidence", "alignmentConfidence", "speaker", "flags" }.
9. "title" & "artist": only if clearly identified, else "".`;
  const alignContents = [
    {
      inlineData: {
        mimeType: "audio/wav",
        data: audioBase64
      }
    }
  ];
  if (separatedVocalBase64) {
    alignContents.push({
      inlineData: {
        mimeType: "audio/wav",
        data: separatedVocalBase64
      }
    });
  }
  alignContents.push({ text: alignPrompt });
  let parsed = null;
  let usedStageARecovery = false;
  try {
    const response = await ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: alignContents,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type3.OBJECT,
          properties: {
            audioType: { type: Type3.STRING },
            language: { type: Type3.STRING },
            detectedLanguages: { type: Type3.ARRAY, items: { type: Type3.STRING } },
            detectedSpeakers: { type: Type3.ARRAY, items: { type: Type3.STRING } },
            hasBackingVocals: { type: Type3.BOOLEAN },
            hasUnclearSections: { type: Type3.BOOLEAN },
            hasInstrumentalSections: { type: Type3.BOOLEAN },
            hasRepeatedChorus: { type: Type3.BOOLEAN },
            title: { type: Type3.STRING },
            artist: { type: Type3.STRING },
            isInstrumental: { type: Type3.BOOLEAN },
            missingVocalGaps: {
              type: Type3.ARRAY,
              items: {
                type: Type3.OBJECT,
                properties: {
                  start: { type: Type3.NUMBER },
                  end: { type: Type3.NUMBER },
                  reason: { type: Type3.STRING }
                },
                required: ["start", "end"]
              }
            },
            sections: {
              type: Type3.ARRAY,
              items: {
                type: Type3.OBJECT,
                properties: {
                  type: { type: Type3.STRING },
                  label: { type: Type3.STRING },
                  start: { type: Type3.NUMBER },
                  end: { type: Type3.NUMBER },
                  isRepeat: { type: Type3.BOOLEAN }
                },
                required: ["type", "start", "end"]
              }
            },
            lines: {
              type: Type3.ARRAY,
              items: {
                type: Type3.OBJECT,
                properties: {
                  text: { type: Type3.STRING },
                  start: { type: Type3.NUMBER },
                  end: { type: Type3.NUMBER },
                  section: { type: Type3.STRING },
                  vocalType: { type: Type3.STRING },
                  language: { type: Type3.STRING },
                  speaker: { type: Type3.STRING },
                  recognitionConfidence: { type: Type3.NUMBER },
                  alignmentConfidence: { type: Type3.NUMBER },
                  flags: { type: Type3.ARRAY, items: { type: Type3.STRING } },
                  validationNote: { type: Type3.STRING },
                  isRepeatedChorus: { type: Type3.BOOLEAN },
                  backingText: { type: Type3.STRING },
                  unclear: { type: Type3.BOOLEAN },
                  words: {
                    type: Type3.ARRAY,
                    items: {
                      type: Type3.OBJECT,
                      properties: {
                        text: { type: Type3.STRING },
                        start: { type: Type3.NUMBER },
                        end: { type: Type3.NUMBER },
                        recognitionConfidence: { type: Type3.NUMBER },
                        alignmentConfidence: { type: Type3.NUMBER },
                        speaker: { type: Type3.STRING },
                        flags: { type: Type3.ARRAY, items: { type: Type3.STRING } }
                      },
                      required: ["text", "start", "end"]
                    }
                  }
                },
                required: ["text", "start", "end", "words"]
              }
            }
          },
          required: ["audioType", "language", "lines"]
        }
      }
    });
    parsed = JSON.parse(response.text || "{}");
  } catch (alignErr) {
    const aMsg = alignErr?.message || String(alignErr || "");
    if (aMsg.includes("billing") || aMsg.includes("free tier") || errIsPermissionDenied(alignErr)) {
      return runWhisperFallbackPipeline(body, onProgress);
    }
    if (vocalTranscript) {
      const recovered = parseTranscriptLinesForRecovery(vocalTranscript, cleanSegments, winDur, offsetSec, lang);
      if (recovered.length) {
        usedStageARecovery = true;
        parsed = {
          audioType: "singing",
          language: lang && lang !== "auto" ? lang : "auto",
          lines: recovered
        };
      }
    }
    if (!parsed) throw alignErr;
  }
  const rawLines = Array.isArray(parsed?.lines) ? parsed.lines : [];
  const lines = normalizeKaraokeLines(rawLines, offsetSec);
  const missingVocalGaps = Array.isArray(parsed?.missingVocalGaps) ? parsed.missingVocalGaps.map((g) => ({
    start: +Math.max(0, (Number(g?.start) || 0) + offsetSec).toFixed(3),
    end: +Math.max(0.1, (Number(g?.end) || 0) + offsetSec).toFixed(3),
    reason: String(g?.reason || "unintelligible_or_missing_vocal").slice(0, 120)
  })) : [];
  const sections = Array.isArray(parsed?.sections) ? parsed.sections.map((sec) => ({
    type: String(sec?.type || "other").toLowerCase(),
    label: String(sec?.label || sec?.type || ""),
    start: +Math.max(0, (Number(sec?.start) || 0) + offsetSec).toFixed(3),
    end: +Math.max(0.1, (Number(sec?.end) || 0) + offsetSec).toFixed(3),
    isRepeat: Boolean(sec?.isRepeat)
  })) : [];
  const detectedLanguages = Array.isArray(parsed?.detectedLanguages) && parsed.detectedLanguages.length ? parsed.detectedLanguages.filter(Boolean) : parsed?.language && parsed.language !== "auto" && parsed.language !== "instrumental" ? [parsed.language] : [];
  const speakerSet = new Set(Array.isArray(parsed?.detectedSpeakers) ? parsed.detectedSpeakers.filter(Boolean) : []);
  lines.forEach((ln) => {
    if (ln.speaker && ln.speaker !== "Instrumental") speakerSet.add(ln.speaker);
    (ln.words || []).forEach((w) => {
      if (w.speaker) speakerSet.add(w.speaker);
    });
  });
  const validationSummary = summarizeValidation(lines, missingVocalGaps);
  return {
    success: true,
    needsClientAcousticAlign: usedStageARecovery,
    audioType: String(parsed?.audioType || (parsed?.isInstrumental ? "instrumental" : "singing")).toLowerCase(),
    language: parsed?.language || "auto",
    detectedLanguages,
    detectedSpeakers: Array.from(speakerSet),
    hasBackingVocals: Boolean(parsed?.hasBackingVocals || lines.some((l) => l.backingText || l.vocalType === "backing" || l.vocalType === "harmony" || l.vocalType === "overlapping")),
    hasUnclearSections: Boolean(parsed?.hasUnclearSections || validationSummary.uncertainWords > 0 || lines.some((l) => l.unclear)),
    hasInstrumentalSections: Boolean(parsed?.hasInstrumentalSections || parsed?.isInstrumental || lines.some((l) => l.isInstrumentalSection)),
    hasRepeatedChorus: Boolean(parsed?.hasRepeatedChorus || lines.some((l) => l.isRepeatedChorus) || sections.some((s) => s.isRepeat)),
    title: parsed?.title || "",
    artist: parsed?.artist || "",
    isInstrumental: Boolean(parsed?.isInstrumental || parsed?.audioType === "instrumental"),
    sections,
    validationSummary,
    pipelineModels: {
      separation: separatedVocalBase64 ? "client_mid_side_formant_stem" : "single_channel_formant_filter",
      transcription: vocalTranscript ? "gemini-3.5-transcribe" : "gemini-4-hydrogen",
      forcedAlignment: usedStageARecovery ? "client_10ms_vocal_onset_aligner" : "gemini-4-hydrogen+phoneme_10ms_viterbi"
    },
    lines
  };
}
function errIsPermissionDenied(err) {
  return err?.status === "PERMISSION_DENIED" || err?.code === 403 || err?.status === 403;
}
function sendSseEvent(res, event, data) {
  res.write(`event: ${event}
data: ${JSON.stringify(data)}

`);
}
app.post("/api/transcribe-lyrics", async (req, res) => {
  try {
    const result = await runSingingTranscriptionPipeline(req.body);
    return res.status(200).json(result);
  } catch (err) {
    const msg = err?.message || String(err || "");
    const isBilling = msg.includes("billing") || msg.includes("free tier") || errIsPermissionDenied(err);
    return res.status(200).json({
      success: false,
      reason: isBilling ? "billing_required" : "transcription_error",
      requiresBilling: isBilling,
      message: msg.slice(0, 300)
    });
  }
});
app.post("/api/transcribe-lyrics/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  let closed = false;
  res.on("close", () => {
    if (!res.writableEnded) closed = true;
  });
  try {
    const result = await runSingingTranscriptionPipeline(req.body, (evt) => {
      if (closed) return;
      sendSseEvent(res, evt.event, { stage: evt.stage, ...evt.payload || {} });
    });
    if (!closed) {
      if (result && result.success) {
        sendSseEvent(res, "result", result);
      } else {
        sendSseEvent(res, "error", result || { success: false, reason: "transcription_error" });
      }
      res.end();
    }
  } catch (err) {
    if (!closed) {
      const msg = err?.message || String(err || "");
      const isBilling = msg.includes("billing") || msg.includes("free tier") || errIsPermissionDenied(err);
      sendSseEvent(res, "error", {
        success: false,
        reason: isBilling ? "billing_required" : "transcription_error",
        requiresBilling: isBilling,
        message: msg.slice(0, 300)
      });
      res.end();
    }
  }
});
app.post("/api/transcribe-voice-clip", async (req, res) => {
  try {
    const { audioBase64, lang } = req.body || {};
    if (!audioBase64) {
      return res.status(400).json({ success: false, reason: "missing_audio" });
    }
    const wRes = await transcribeWithWhisper({
      audioBase64,
      lang: lang || "auto",
      chunkStartSec: 0,
      chunkDurationSec: 45
    });
    const lines = normalizeKaraokeLines(wRes.lines, 0);
    return res.json({
      success: true,
      engine: wRes.engine,
      language: wRes.language,
      isInstrumental: wRes.isInstrumental,
      transcript: wRes.rawTranscript,
      lines
    });
  } catch (err) {
    return res.status(200).json({
      success: false,
      reason: "voice_clip_error",
      message: (err?.message || String(err || "")).slice(0, 300)
    });
  }
});
app.post("/api/reanalyze-segment", async (req, res) => {
  const {
    audioBase64,
    separatedVocalBase64,
    startSec,
    endSec,
    existingWords,
    qualityConditions,
    lang
  } = req.body || {};
  if (!audioBase64) {
    return res.status(200).json({ success: false, reason: "missing_audio" });
  }
  const offsetSec = Math.max(0, Number(startSec) || 0);
  const segDur = Math.max(0.2, (Number(endSec) || offsetSec + 2) - offsetSec);
  const runWhisperReanalyzeFallback = async () => {
    try {
      const wRes = await transcribeWithWhisper({
        audioBase64,
        separatedVocalBase64,
        lang: lang || "auto",
        chunkStartSec: offsetSec,
        chunkDurationSec: segDur
      });
      const lines = normalizeKaraokeLines(wRes.lines, 0);
      return res.json({
        success: true,
        engine: wRes.engine,
        lines,
        focusTranscript: wRes.rawTranscript
      });
    } catch (wErr) {
      return res.status(200).json({
        success: false,
        reason: "reanalysis_error",
        requiresBilling: false,
        message: (wErr?.message || String(wErr || "")).slice(0, 300)
      });
    }
  };
  if (!ai) {
    return runWhisperReanalyzeFallback();
  }
  try {
    const condDesc = qualityConditions ? `noise=${qualityConditions.isNoisy ? "YES" : "no"}, distortion=${qualityConditions.isDistorted ? "YES" : "no"}, reverb=${qualityConditions.isReverberated ? "YES" : "no"}, overlappingVocals=${qualityConditions.hasOverlappingSingers ? "YES" : "no"}` : "standard";
    let focusTranscript = "";
    try {
      const tResp = await ai.models.generateContent({
        model: "gemini-3.5-transcribe",
        contents: [
          {
            inlineData: {
              mimeType: "audio/wav",
              data: separatedVocalBase64 || audioBase64
            }
          },
          {
            text: `Re-listen with extreme care to this ${segDur.toFixed(2)}s singing excerpt flagged as low-confidence (${condDesc}). Language hint: ${lang || "auto"}.
Previous candidate words (may contain errors or timing drift): ${JSON.stringify((existingWords || []).map((w) => w.text || "")).slice(0, 800)}.
Transcribe ONLY what is genuinely audible in the singing voice. Mark ambiguous syllables honestly as [UNCLEAR]\u2014never invent words and never exaggerate certainty.`
          }
        ]
      });
      focusTranscript = String(tResp.text || "").trim();
    } catch (tErr) {
      const tMsg = tErr?.message || String(tErr || "");
      if (tMsg.includes("billing") || tMsg.includes("free tier") || tErr?.status === "PERMISSION_DENIED" || tErr?.code === 403) {
        throw tErr;
      }
    }
    const alignResp = await ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: [
        { inlineData: { mimeType: "audio/wav", data: audioBase64 } },
        ...separatedVocalBase64 ? [{ inlineData: { mimeType: "audio/wav", data: separatedVocalBase64 } }] : [],
        {
          text: `Perform accuracy-first phonetic re-alignment of this short ${segDur.toFixed(2)}s excerpt (timeline starts at 0.000s inside this clip).
Acoustic conditions: ${condDesc}.
${focusTranscript ? `Focused vocal transcript:
${focusTranscript}
` : ""}Existing low-confidence tokens with relative hints:
${JSON.stringify((existingWords || []).map((w) => ({ text: w.text, start: +Math.max(0, (Number(w.start) || 0) - offsetSec).toFixed(3), end: +Math.max(0, (Number(w.end) || 0) - offsetSec).toFixed(3) })), null, 2)}

Rules:
- Accuracy is strictly more important than speed.
- Re-anchor word & phoneme boundaries directly to true sung vocal energy & consonant attacks.
- Never claim 1.0 (100%) confidence automatically; cap honest scores <= 0.96, and reduce scores whenever noise, reverb, distortion, or overlapping vocals obscure the articulation.
- Output JSON with "lines": [{ "text", "start", "end", "vocalType", "speaker", "recognitionConfidence", "alignmentConfidence", "flags", "words": [{ "text", "start", "end", "recognitionConfidence", "alignmentConfidence", "audioClarity", "vocalOverlap", "flags", "phonemes": [{"unit","start","end"}], "chars": [{"ch","start","end"}] }] }].`
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type3.OBJECT,
          properties: {
            lines: {
              type: Type3.ARRAY,
              items: {
                type: Type3.OBJECT,
                properties: {
                  text: { type: Type3.STRING },
                  start: { type: Type3.NUMBER },
                  end: { type: Type3.NUMBER },
                  vocalType: { type: Type3.STRING },
                  speaker: { type: Type3.STRING },
                  recognitionConfidence: { type: Type3.NUMBER },
                  alignmentConfidence: { type: Type3.NUMBER },
                  flags: { type: Type3.ARRAY, items: { type: Type3.STRING } },
                  words: {
                    type: Type3.ARRAY,
                    items: {
                      type: Type3.OBJECT,
                      properties: {
                        text: { type: Type3.STRING },
                        start: { type: Type3.NUMBER },
                        end: { type: Type3.NUMBER },
                        recognitionConfidence: { type: Type3.NUMBER },
                        alignmentConfidence: { type: Type3.NUMBER },
                        audioClarity: { type: Type3.NUMBER },
                        vocalOverlap: { type: Type3.NUMBER },
                        flags: { type: Type3.ARRAY, items: { type: Type3.STRING } }
                      },
                      required: ["text", "start", "end"]
                    }
                  }
                },
                required: ["text", "start", "end", "words"]
              }
            }
          },
          required: ["lines"]
        }
      }
    });
    const parsed = JSON.parse(alignResp.text || "{}");
    const lines = normalizeKaraokeLines(Array.isArray(parsed.lines) ? parsed.lines : [], offsetSec);
    return res.json({ success: true, lines, focusTranscript });
  } catch (err) {
    const msg = err?.message || String(err || "");
    const isBilling = msg.includes("billing") || msg.includes("free tier") || err?.status === "PERMISSION_DENIED" || err?.code === 403;
    if (isBilling) {
      return runWhisperReanalyzeFallback();
    }
    return runWhisperReanalyzeFallback();
  }
});
app.post("/api/qc-auto-perform", async (req, res) => {
  const {
    lines = [],
    coordinationAudit = {},
    audioSlices = [],
    vocalSegments = [],
    qualityConditions = null,
    globalOffsetMs = 0,
    typesetLeadActive = false,
    lang = "auto",
    uiLang = "fr"
  } = req.body || {};
  const inputLines = Array.isArray(lines) ? lines : [];
  if (!inputLines.length) {
    return res.status(400).json({ success: false, reason: "missing_lines", aiStatus: "unavailable" });
  }
  const isFr = String(uiLang || "fr").toLowerCase().startsWith("fr");
  const isJa = String(uiLang || "").toLowerCase().startsWith("ja");
  const classifyAiError = (err) => {
    const rawMsg = String(err?.message || err || "");
    const lower = rawMsg.toLowerCase();
    const statusCode = Number(err?.statusCode || err?.code || 0);
    const statusStr = String(err?.status || "");
    const requiresBilling = statusCode === 403 || statusCode === 429 || statusStr === "PERMISSION_DENIED" || statusStr === "RESOURCE_EXHAUSTED" || lower.includes("billing") || lower.includes("quota") || lower.includes("free tier");
    const requiresApiKey = statusCode === 400 || lower.includes("api_key_invalid") || lower.includes("api key not valid");
    return {
      statusCode,
      requiresBilling,
      requiresApiKey,
      message: rawMsg.slice(0, 220)
    };
  };
  try {
    const orthoReport = analyzeAndFixOrthography(
      inputLines.map((l) => String(l?.text || "")),
      String(lang || "auto")
    );
    const orthographyFixes = [];
    inputLines.forEach((ln, k) => {
      const li = Number.isInteger(Number(ln?.index)) ? Number(ln.index) : k;
      const fixedTxt = orthoReport.correctedLines[k];
      if (fixedTxt && fixedTxt.trim() && fixedTxt.trim() !== String(ln?.text || "").trim()) {
        orthographyFixes.push({
          lineIdx: li,
          text: fixedTxt.trim(),
          fixes: orthoReport.changes.filter((c) => c.lineIdx === k).length || 1
        });
      }
    });
    const slices = Array.isArray(audioSlices) ? audioSlices.slice(0, 5) : [];
    const repairedSlices = [];
    const aiErrors = [];
    const condDesc = qualityConditions ? `noise=${qualityConditions.isNoisy ? "YES" : "no"}, distortion=${qualityConditions.isDistorted ? "YES" : "no"}, reverb=${qualityConditions.isReverberated ? "YES" : "no"}, overlap=${qualityConditions.hasOverlappingSingers ? "YES" : "no"}` : "standard";
    const processSlice = async (sl) => {
      const lineIdx = Number(sl?.lineIdx);
      const audioBase64 = String(sl?.audioBase64 || "");
      if (!Number.isFinite(lineIdx) || !audioBase64 || audioBase64.length > 65e5) return null;
      const sepRaw = String(sl?.separatedVocalBase64 || "");
      const separatedVocalBase64 = sepRaw.length <= 65e5 ? sepRaw : "";
      const offsetSec = Math.max(0, Number(sl?.startSec) || 0);
      const segDur = Math.max(0.25, Math.min(18, (Number(sl?.endSec) || offsetSec + 2) - offsetSec));
      const existingWords = Array.isArray(sl?.existingWords) ? sl.existingWords.slice(0, 48) : [];
      const needsTranscriptRefresh = Boolean(sl?.needsTranscriptRefresh);
      let handledByAi = false;
      if (ai) {
        try {
          let focusTranscript = "";
          if (needsTranscriptRefresh) {
            try {
              const tResp = await ai.models.generateContent({
                model: "gemini-3.5-transcribe",
                contents: [
                  {
                    inlineData: {
                      mimeType: "audio/wav",
                      data: separatedVocalBase64 || audioBase64
                    }
                  },
                  {
                    text: `Listen closely to this ${segDur.toFixed(2)}s vocal excerpt (language hint: ${lang || "auto"}).
Candidate lyric tokens: ${JSON.stringify(existingWords.map((w) => w.text || "")).slice(0, 600)}.
Transcribe strictly what the singer actually sings; preserve authentic spelling and mark genuinely unintelligible syllables [UNCLEAR].`
                  }
                ]
              });
              focusTranscript = String(tResp.text || "").trim();
            } catch (tErr) {
              aiErrors.push(classifyAiError(tErr));
              focusTranscript = "";
            }
          }
          const alignResp = await ai.models.generateContent({
            model: "gemini-4-hydrogen",
            contents: [
              { inlineData: { mimeType: "audio/wav", data: audioBase64 } },
              ...separatedVocalBase64 ? [{ inlineData: { mimeType: "audio/wav", data: separatedVocalBase64 } }] : [],
              {
                text: `Re-anchor every sung word & phoneme precisely in this ${segDur.toFixed(2)}s excerpt (timeline starts at 0.000s relative to this clip).
Acoustic environment: ${condDesc}.
${focusTranscript ? `Clarified vocal transcript:
${focusTranscript}
` : ""}Target lyric words (relative seconds hints):
${JSON.stringify(existingWords.map((w) => ({
                  text: w.text,
                  start: +Math.max(0, (Number(w.start) || 0) - offsetSec).toFixed(3),
                  end: +Math.max(0.05, (Number(w.end) || 0) - offsetSec).toFixed(3)
                })), null, 2)}

Rules:
- Lock every word onset accurately onto the sung consonant/vowel attack in the audio.
- Keep smooth natural karaoke flow between connected syllables while preserving authentic breath pauses.
- Calibrate honest scores strictly <= 0.96.
- Return JSON { "lines": [{ "text", "start", "end", "recognitionConfidence", "alignmentConfidence", "flags", "words": [{ "text", "start", "end", "recognitionConfidence", "alignmentConfidence", "audioClarity", "vocalOverlap", "flags" }] }] }.`
              }
            ],
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type3.OBJECT,
                properties: {
                  lines: {
                    type: Type3.ARRAY,
                    items: {
                      type: Type3.OBJECT,
                      properties: {
                        text: { type: Type3.STRING },
                        start: { type: Type3.NUMBER },
                        end: { type: Type3.NUMBER },
                        recognitionConfidence: { type: Type3.NUMBER },
                        alignmentConfidence: { type: Type3.NUMBER },
                        flags: { type: Type3.ARRAY, items: { type: Type3.STRING } },
                        words: {
                          type: Type3.ARRAY,
                          items: {
                            type: Type3.OBJECT,
                            properties: {
                              text: { type: Type3.STRING },
                              start: { type: Type3.NUMBER },
                              end: { type: Type3.NUMBER },
                              recognitionConfidence: { type: Type3.NUMBER },
                              alignmentConfidence: { type: Type3.NUMBER },
                              audioClarity: { type: Type3.NUMBER },
                              vocalOverlap: { type: Type3.NUMBER },
                              flags: { type: Type3.ARRAY, items: { type: Type3.STRING } }
                            },
                            required: ["text", "start", "end"]
                          }
                        }
                      },
                      required: ["text", "start", "end", "words"]
                    }
                  }
                },
                required: ["lines"]
              }
            }
          });
          const parsedSlice = JSON.parse(alignResp.text || "{}");
          const normLines = normalizeKaraokeLines(Array.isArray(parsedSlice.lines) ? parsedSlice.lines : [], offsetSec);
          if (normLines.length) {
            handledByAi = true;
            return {
              lineIdx,
              focusTranscript,
              lines: normLines,
              engine: "gemini-4-hydrogen"
            };
          }
        } catch (aiErr) {
          aiErrors.push(classifyAiError(aiErr));
          handledByAi = false;
        }
      }
      if (!handledByAi) {
        try {
          const wRes = await transcribeWithWhisper({
            audioBase64,
            separatedVocalBase64,
            lang: lang || "auto",
            chunkStartSec: offsetSec,
            chunkDurationSec: segDur
          });
          const normLines = normalizeKaraokeLines(wRes.lines || [], 0);
          if (normLines.length) {
            return {
              lineIdx,
              focusTranscript: wRes.rawTranscript || "",
              lines: normLines,
              engine: wRes.engine || "neural_whisper"
            };
          }
        } catch {
        }
      }
      return null;
    };
    const SLICE_CONCURRENCY = 3;
    for (let i = 0; i < slices.length; i += SLICE_CONCURRENCY) {
      const batch = slices.slice(i, i + SLICE_CONCURRENCY);
      const batchRes = await Promise.all(batch.map(processSlice));
      for (const item of batchRes) {
        if (item) repairedSlices.push(item);
      }
    }
    const measuredMedianDriftMs = Math.round(Number(coordinationAudit?.medianVideoDriftMs) || 0);
    const measuredAbsErrMs = Math.round(Number(coordinationAudit?.avgAbsErrMs) || 0);
    const lowWordsCount = Math.round(Number(coordinationAudit?.lowConfCount) || 0);
    const overlapCount = Math.round(Number(coordinationAudit?.overlapCount) || 0);
    const microGapCount = Math.round(Number(coordinationAudit?.microGapCount) || 0);
    let recommendedOffsetAdjustMs = Math.abs(measuredMedianDriftMs) >= 20 ? Math.max(-180, Math.min(180, -measuredMedianDriftMs)) : 0;
    let coordinationDiagnosis = isFr ? Math.abs(measuredMedianDriftMs) >= 20 ? `D\xE9calage syst\xE9matique voix\u2194vid\xE9o de ${measuredMedianDriftMs > 0 ? "+" : ""}${measuredMedianDriftMs} ms d\xE9tect\xE9 (erreur moyenne \xB1${measuredAbsErrMs} ms).` : `Coordination globale voix\u2194vid\xE9o stable (\xB1${measuredAbsErrMs} ms), affinage des mots faibles et fluidit\xE9 karaok\xE9.` : isJa ? `\u97F3\u58F0\u3068\u52D5\u753B\u5B57\u5E55\u306E\u5EA7\u6A19\u8AA4\u5DEE \xB1${measuredAbsErrMs}ms \u3092\u691C\u51FA\u3057\u3001\u4F4E\u4FE1\u983C\u30EF\u30FC\u30C9\u3068\u9077\u79FB\u3092\u6700\u9069\u5316\u3057\u307E\u3057\u305F\u3002` : `Detected ${measuredMedianDriftMs >= 0 ? "+" : ""}${measuredMedianDriftMs} ms systematic voice-to-video drift (\xB1${measuredAbsErrMs} ms mean error).`;
    let optimizationSummary = isFr ? `Recalibrage pr\xE9cis sur les attaques vocales, correction de ${lowWordsCount} mot(s) faible(s) et lissage des transitions vid\xE9o.` : isJa ? `\u58F0\u306E\u30A2\u30BF\u30C3\u30AF\u57FA\u6E96\u3067\u518D\u30A2\u30F3\u30AB\u30FC\u3057\u3001${lowWordsCount}\u8A9E\u306E\u4F4E\u4FE1\u983C\u30C8\u30FC\u30AF\u30F3\u3068\u8868\u793A\u9077\u79FB\u3092\u6ED1\u3089\u304B\u306B\u88DC\u6B63\u3002` : `Re-anchored onto vocal attacks, repaired ${lowWordsCount} weak token(s), and smoothed video sweep flow.`;
    let auditAiSucceeded = false;
    if (ai) {
      try {
        const lineDigest = inputLines.slice(0, 48).map((ln, idx) => ({
          index: Number.isInteger(Number(ln?.index)) ? Number(ln.index) : idx,
          text: String(ln?.text || "").slice(0, 90),
          start: +(Number(ln?.start) || 0).toFixed(3),
          end: +(Number(ln?.end) || 0).toFixed(3),
          avgDriftMs: Math.round(Number(ln?.avgDriftMs) || 0),
          lowWords: Math.round(Number(ln?.lowWords) || 0),
          flags: Array.isArray(ln?.flags) ? ln.flags.slice(0, 5) : []
        }));
        const auditResp = await ai.models.generateContent({
          model: "gemini-4-hydrogen",
          contents: [
            {
              text: `You are an expert Karaoke Motion & Vocal Synchronization Quality Engineer.
Evaluate the coordination between SUNG VOICE in audio vs LYRICS DISPLAYED ON VIDEO, and return an automated calibration & quality diagnosis.

Telemetry:
- uiLanguage: ${uiLang}
- lyricLanguage: ${lang || "auto"}
- currentGlobalOffsetMs: ${Math.round(Number(globalOffsetMs) || 0)}
- typesetReadAhead200msEnabled: ${Boolean(typesetLeadActive)}
- measuredMedianVoiceToVideoDriftMs: ${measuredMedianDriftMs} (positive means video lyrics appear AFTER singer starts; negative means lyrics appear BEFORE singer starts, already compensating for any active read-ahead lead)
- measuredMeanAbsTimingErrorMs: ${measuredAbsErrMs}
- lowConfidenceWords: ${lowWordsCount}
- overlappingWordsOrBoundaries: ${overlapCount}
- choppyMicroGaps: ${microGapCount}
- acousticConditions: ${JSON.stringify(qualityConditions || {})}
- orthographyFixCount: ${orthographyFixes.length}
- reanalyzedVocalSlicesCount: ${repairedSlices.length}
- activeVocalSegmentsSample: ${JSON.stringify((Array.isArray(vocalSegments) ? vocalSegments : []).slice(0, 12))}

Per-line summary:
${JSON.stringify(lineDigest)}

Output strict JSON with:
- "recommendedOffsetAdjustMs": integer in [-180, 180] (set 0 if |measuredMedianVoiceToVideoDriftMs| < 18, or roughly -measuredMedianVoiceToVideoDriftMs to center video display onto true vocal attack)
- "coordinationDiagnosis": 1 concise natural sentence (${isFr ? "in French" : isJa ? "in Japanese" : "in English"}) summarizing what was found between singing timing, video display, and low-confidence segments.
- "optimizationSummary": 1 concise natural sentence (${isFr ? "in French" : isJa ? "in Japanese" : "in English"}) summarizing how precision and karaoke fluidity are restored.`
            }
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type3.OBJECT,
              properties: {
                recommendedOffsetAdjustMs: { type: Type3.INTEGER },
                coordinationDiagnosis: { type: Type3.STRING },
                optimizationSummary: { type: Type3.STRING }
              },
              required: ["recommendedOffsetAdjustMs", "coordinationDiagnosis", "optimizationSummary"]
            }
          }
        });
        const parsedAudit = JSON.parse(auditResp.text || "{}");
        if (Number.isFinite(Number(parsedAudit?.recommendedOffsetAdjustMs))) {
          const recOff = Math.round(Number(parsedAudit.recommendedOffsetAdjustMs));
          recommendedOffsetAdjustMs = Math.abs(recOff) >= 16 ? Math.max(-180, Math.min(180, recOff)) : 0;
        }
        if (typeof parsedAudit?.coordinationDiagnosis === "string" && parsedAudit.coordinationDiagnosis.trim()) {
          coordinationDiagnosis = parsedAudit.coordinationDiagnosis.trim().slice(0, 260);
        }
        if (typeof parsedAudit?.optimizationSummary === "string" && parsedAudit.optimizationSummary.trim()) {
          optimizationSummary = parsedAudit.optimizationSummary.trim().slice(0, 260);
        }
        auditAiSucceeded = true;
      } catch (auditErr) {
        aiErrors.push(classifyAiError(auditErr));
      }
    }
    const usedGemini = auditAiSucceeded || repairedSlices.some((s) => s.engine.startsWith("gemini"));
    const hasBillingIssue = aiErrors.some((e) => e.requiresBilling);
    const hasKeyIssue = aiErrors.some((e) => e.requiresApiKey);
    const aiStatus = !ai ? "unavailable" : usedGemini && !aiErrors.length ? "ok" : usedGemini ? "partial" : "degraded";
    const engineUsed = usedGemini ? "gemini-4-hydrogen" : "whisper+acoustic";
    return res.json({
      success: true,
      engineUsed,
      aiStatus,
      requiresBilling: hasBillingIssue,
      requiresApiKey: hasKeyIssue,
      aiError: aiErrors.length ? aiErrors[0].message : !ai ? "GEMINI_API_KEY missing on server" : null,
      orthographyFixes,
      repairedSlices,
      recommendedOffsetAdjustMs,
      coordinationDiagnosis,
      optimizationSummary
    });
  } catch (err) {
    const info = classifyAiError(err);
    return res.status(500).json({
      success: false,
      reason: "qc_auto_error",
      aiStatus: "degraded",
      requiresBilling: info.requiresBilling,
      requiresApiKey: info.requiresApiKey,
      message: info.message
    });
  }
});
app.post("/api/translate-lyrics", async (req, res) => {
  try {
    const { lines, targetLang } = req.body || {};
    const target = String(targetLang || "en").trim();
    const inputLines = Array.isArray(lines) ? lines : [];
    if (!inputLines.length) {
      return res.json({ success: true, targetLang: target, detectedSourceLanguages: [], translations: [] });
    }
    if (!ai) {
      return res.status(200).json({ success: false, reason: "ai_not_configured" });
    }
    const langNames = {
      en: "English",
      fr: "French (Fran\xE7ais)",
      "zh-Hans": "Simplified Chinese Mandarin (\u7B80\u4F53\u4E2D\u6587)",
      "zh-Hant": "Traditional Chinese Mandarin (\u7E41\u9AD4\u4E2D\u6587)",
      es: "Spanish (Espa\xF1ol)",
      de: "German (Deutsch)",
      ja: "Japanese (\u65E5\u672C\u8A9E)",
      ko: "Korean (\uD55C\uAD6D\uC5B4)",
      it: "Italian (Italiano)",
      pt: "Portuguese (Portugu\xEAs)"
    };
    const targetLabel = langNames[target] || target;
    const payloadLines = inputLines.map((l, i) => ({
      index: Number.isInteger(Number(l?.index)) ? Number(l.index) : i,
      text: String(l?.text || ""),
      language: String(l?.language || ""),
      interlude: Boolean(l?.interlude)
    }));
    const resp = await ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: [
        {
          text: `Translate these synchronized song lyric lines accurately into ${targetLabel} (target code: "${target}").
Requirements:
- Keep the EXACT array indices provided; NEVER add, remove, merge, or split lines.
- Songs may mix multiple languages across lines or within a line (code-switching); detect each line's actual source language ("sourceLanguage") accurately.
- Preserve lyrical meaning, emotion, and natural singable subtitle conciseness so it fits cleanly on the shared timeline.
- If a line is marked "interlude": true or starts with "[interlude" / "[INSTRUMENTAL]" / "[Unclear", return an empty string "" for "translatedText".
- If a line is already in ${targetLabel}, refine or keep it naturally without adding notes or explanations.

Lines JSON:
${JSON.stringify(payloadLines)}`
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type3.OBJECT,
          properties: {
            detectedSourceLanguages: {
              type: Type3.ARRAY,
              items: { type: Type3.STRING }
            },
            translations: {
              type: Type3.ARRAY,
              items: {
                type: Type3.OBJECT,
                properties: {
                  index: { type: Type3.INTEGER },
                  sourceLanguage: { type: Type3.STRING },
                  translatedText: { type: Type3.STRING }
                },
                required: ["index", "sourceLanguage", "translatedText"]
              }
            }
          },
          required: ["detectedSourceLanguages", "translations"]
        }
      }
    });
    const parsed = JSON.parse(resp.text || "{}");
    const trList = Array.isArray(parsed.translations) ? parsed.translations : [];
    const byIdx = /* @__PURE__ */ new Map();
    for (const t of trList) {
      if (t && Number.isInteger(Number(t.index))) {
        byIdx.set(Number(t.index), t);
      }
    }
    const normalized = payloadLines.map((src) => {
      if (src.interlude || !src.text.trim() || /^\[(?:interlude|instrumental|間奏|间奏|간주)/i.test(src.text.trim())) {
        return { index: src.index, sourceLanguage: src.language || "", translatedText: "" };
      }
      const hit = byIdx.get(src.index);
      return {
        index: src.index,
        sourceLanguage: String(hit?.sourceLanguage || src.language || "").trim(),
        translatedText: String(hit?.translatedText || "").trim()
      };
    });
    return res.json({
      success: true,
      targetLang: target,
      detectedSourceLanguages: Array.isArray(parsed.detectedSourceLanguages) ? parsed.detectedSourceLanguages : [],
      translations: normalized
    });
  } catch (err) {
    const msg = err?.message || String(err || "");
    const isBilling = msg.includes("billing") || msg.includes("free tier") || err?.status === "PERMISSION_DENIED" || err?.code === 403;
    return res.status(200).json({
      success: false,
      reason: isBilling ? "billing_required" : "translation_error",
      requiresBilling: isBilling,
      message: msg.slice(0, 300)
    });
  }
});
var GMP_SOLUTION_ID = "gmp_mcp_codeassist_v1_aistudio";
var weatherCache = /* @__PURE__ */ new Map();
var WEATHER_CACHE_TTL_MS = 5 * 60 * 1e3;
function getMapsApiKey() {
  const raw = (process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.MAPS_API_KEY || "").replace(/^["']|["']$/g, "").trim();
  if (!raw || /^(MY_|YOUR_|PLACEHOLDER|REPLACE_ME)/i.test(raw)) return "";
  return raw;
}
function isGmpQuotaError(status, body) {
  if (status === 429) return true;
  const errStatus = body?.error?.status;
  if (errStatus === "RESOURCE_EXHAUSTED") return true;
  return false;
}
async function fetchJsonWithGmp(url, init = {}) {
  const headers = {
    "X-Goog-Maps-Solution-ID": GMP_SOLUTION_ID,
    ...init.headers || {}
  };
  const resp = await fetch(url, { ...init, headers });
  let data = null;
  try {
    data = await resp.json();
  } catch {
    data = null;
  }
  return {
    ok: resp.ok,
    status: resp.status,
    quotaExceeded: isGmpQuotaError(resp.status, data),
    data
  };
}
function degreesToCardinal(deg) {
  if (!Number.isFinite(deg)) return "";
  const dirs = [
    "NORTH",
    "NORTH_NORTHEAST",
    "NORTHEAST",
    "EAST_NORTHEAST",
    "EAST",
    "EAST_SOUTHEAST",
    "SOUTHEAST",
    "SOUTH_SOUTHEAST",
    "SOUTH",
    "SOUTH_SOUTHWEST",
    "SOUTHWEST",
    "WEST_SOUTHWEST",
    "WEST",
    "WEST_NORTHWEST",
    "NORTHWEST",
    "NORTH_NORTHWEST"
  ];
  const idx = Math.round((deg % 360 + 360) % 360 / 22.5) % 16;
  return dirs[idx] || "NORTH";
}
function wmoToConditionType(code, isDay = true) {
  const c = Math.round(Number(code));
  if (c === 0) return { type: "CLEAR", descFr: isDay ? "Ensoleill\xE9" : "Ciel d\xE9gag\xE9", descEn: isDay ? "Sunny" : "Clear night" };
  if (c === 1) return { type: "MOSTLY_CLEAR", descFr: isDay ? "Peu nuageux" : "Ciel peu nuageux", descEn: isDay ? "Mostly sunny" : "Mostly clear" };
  if (c === 2) return { type: "PARTLY_CLOUDY", descFr: "Partiellement nuageux", descEn: "Partly cloudy" };
  if (c === 3) return { type: "OVERCAST", descFr: "Couvert", descEn: "Overcast" };
  if (c === 45 || c === 48) return { type: "FOG", descFr: "Brouillard", descEn: "Fog" };
  if (c >= 51 && c <= 57) return { type: "LIGHT_RAIN", descFr: "Bruine l\xE9g\xE8re", descEn: "Light drizzle" };
  if (c === 61 || c === 80) return { type: "LIGHT_RAIN", descFr: "Pluie l\xE9g\xE8re", descEn: "Light rain" };
  if (c === 63 || c === 81) return { type: "RAIN", descFr: "Pluie mod\xE9r\xE9e", descEn: "Rain" };
  if (c === 65 || c === 82) return { type: "HEAVY_RAIN", descFr: "Forte pluie", descEn: "Heavy rain" };
  if (c === 66 || c === 67) return { type: "WIND_AND_RAIN", descFr: "Pluie vergla\xE7ante", descEn: "Freezing rain" };
  if (c === 71 || c === 77 || c === 85) return { type: "LIGHT_SNOW", descFr: "Neige l\xE9g\xE8re", descEn: "Light snow" };
  if (c === 73) return { type: "SNOW", descFr: "Neige", descEn: "Snow" };
  if (c === 75 || c === 86) return { type: "HEAVY_SNOW", descFr: "Forte neige", descEn: "Heavy snow" };
  if (c >= 95 && c <= 99) return { type: "THUNDERSTORM", descFr: "Orage", descEn: "Thunderstorm" };
  return { type: "PARTLY_CLOUDY", descFr: "Temps variable", descEn: "Partly cloudy" };
}
function extractLocationSummary(geoData, lat, lng) {
  const results = Array.isArray(geoData?.results) ? geoData.results : [];
  if (!results.length) {
    return {
      shortName: "",
      locality: "",
      neighborhood: "",
      region: "",
      country: "",
      formattedAddress: `${lat.toFixed(4)}, ${lng.toFixed(4)}`
    };
  }
  const comps = [];
  for (const r of results) {
    if (Array.isArray(r.addressComponents)) {
      for (const c of r.addressComponents) comps.push(c);
    }
  }
  const findComp = (...types) => {
    for (const t of types) {
      const hit = comps.find((c) => Array.isArray(c.types) && c.types.includes(t));
      if (hit?.longText || hit?.shortText) return String(hit.longText || hit.shortText);
    }
    return "";
  };
  const neighborhood = findComp("sublocality_level_1", "sublocality", "neighborhood", "route");
  const locality = findComp("locality", "postal_town", "administrative_area_level_2");
  const region = findComp("administrative_area_level_1");
  const country = findComp("country");
  const shortParts = [neighborhood && neighborhood !== locality ? neighborhood : "", locality || region || country].filter(Boolean);
  const shortName = shortParts.length ? shortParts.join(" \xB7 ") : results[0]?.formattedAddress || `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
  const formattedAddress = String(results[0]?.formattedAddress || shortName);
  return {
    shortName,
    locality: locality || region || "",
    neighborhood,
    region,
    country,
    formattedAddress
  };
}
async function reverseGeocodeFallback(lat, lng, lang) {
  const locLang = String(lang || "fr").toLowerCase().startsWith("en") ? "en" : "fr";
  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lng)}&localityLanguage=${encodeURIComponent(locLang)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(4500) });
    if (resp.ok) {
      const d = await resp.json();
      const locality = String(d?.city || d?.locality || "").trim();
      const region = String(d?.principalSubdivision || "").trim();
      const country = String(d?.countryName || "").trim();
      const shortName = locality || region || country;
      if (shortName) {
        const formattedAddress = [locality, region && region !== locality ? region : "", country].filter(Boolean).join(", ");
        return {
          shortName,
          locality,
          neighborhood: "",
          region,
          country,
          formattedAddress: formattedAddress || shortName
        };
      }
    }
  } catch {
  }
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&accept-language=${encodeURIComponent(locLang)}`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "AlexuraMotionStudio/1.0" },
      signal: AbortSignal.timeout(4500)
    });
    if (resp.ok) {
      const d = await resp.json();
      const a = d?.address || {};
      const locality = String(a.city || a.town || a.village || a.municipality || "").trim();
      const neighborhood = String(a.suburb || a.city_district || a.neighbourhood || "").trim();
      const region = String(a.state || a.region || "").trim();
      const country = String(a.country || "").trim();
      const shortParts = [neighborhood && neighborhood !== locality ? neighborhood : "", locality || region || country].filter(Boolean);
      const shortName = shortParts.join(" \xB7 ") || String(d?.display_name || "").split(",").slice(0, 2).join(",").trim();
      if (shortName) {
        return {
          shortName,
          locality: locality || region || "",
          neighborhood,
          region,
          country,
          formattedAddress: String(d?.display_name || shortName)
        };
      }
    }
  } catch {
  }
  return {
    shortName: `${lat.toFixed(3)}, ${lng.toFixed(3)}`,
    locality: "",
    neighborhood: "",
    region: "",
    country: "",
    formattedAddress: `${lat.toFixed(4)}, ${lng.toFixed(4)}`
  };
}
function pollenGrainsToUpi(grains) {
  if (!Number.isFinite(grains) || grains <= 1) return { value: 0, categoryFr: "Tr\xE8s faible", categoryEn: "Very Low" };
  if (grains <= 10) return { value: 1, categoryFr: "Faible", categoryEn: "Low" };
  if (grains <= 35) return { value: 2, categoryFr: "Mod\xE9r\xE9", categoryEn: "Moderate" };
  if (grains <= 80) return { value: 3, categoryFr: "\xC9lev\xE9", categoryEn: "High" };
  if (grains <= 160) return { value: 4, categoryFr: "Tr\xE8s \xE9lev\xE9", categoryEn: "Very High" };
  return { value: 5, categoryFr: "Extr\xEAme", categoryEn: "Extreme" };
}
function classifyEaqi(eaqi, usAqi, isFr) {
  const hasEaqi = Number.isFinite(eaqi);
  const hasUs = Number.isFinite(usAqi);
  const score = hasEaqi ? Math.round(eaqi) : hasUs ? Math.round(usAqi) : NaN;
  if (hasEaqi) {
    if (eaqi <= 20) return { score, cat: isFr ? "Excellente qualit\xE9 de l\u2019air" : "Excellent air quality", advice: isFr ? "Air pur, id\xE9al pour toutes les activit\xE9s ext\xE9rieures." : "Clean air, ideal for all outdoor activities." };
    if (eaqi <= 40) return { score, cat: isFr ? "Bonne qualit\xE9 de l\u2019air" : "Good air quality", advice: isFr ? "Conditions atmosph\xE9riques favorables en ext\xE9rieur." : "Good outdoor atmospheric conditions." };
    if (eaqi <= 60) return { score, cat: isFr ? "Qualit\xE9 de l\u2019air mod\xE9r\xE9e" : "Moderate air quality", advice: isFr ? "Qualit\xE9 correcte ; les personnes tr\xE8s sensibles peuvent limiter l\u2019effort prolong\xE9." : "Moderate quality; sensitive individuals should moderate prolonged exertion." };
    if (eaqi <= 80) return { score, cat: isFr ? "Qualit\xE9 de l\u2019air m\xE9diocre" : "Poor air quality", advice: isFr ? "R\xE9duisez les efforts intenses en plein air si vous ressentez une g\xEAne." : "Reduce intense outdoor activity if respiratory discomfort occurs." };
    return { score, cat: isFr ? "Mauvaise qualit\xE9 de l\u2019air" : "Very poor air quality", advice: isFr ? "\xC9vitez les activit\xE9s sportives ext\xE9rieures prolong\xE9es." : "Avoid prolonged outdoor physical exertion." };
  }
  if (hasUs) {
    if (usAqi <= 50) return { score, cat: isFr ? "Bonne qualit\xE9 de l\u2019air" : "Good air quality", advice: isFr ? "Air pur, id\xE9al pour les activit\xE9s ext\xE9rieures." : "Clean air, ideal for outdoor activities." };
    if (usAqi <= 100) return { score, cat: isFr ? "Qualit\xE9 de l\u2019air mod\xE9r\xE9e" : "Moderate air quality", advice: isFr ? "Qualit\xE9 acceptable pour la plupart des personnes." : "Acceptable air quality for most people." };
    return { score, cat: isFr ? "Qualit\xE9 de l\u2019air d\xE9grad\xE9e" : "Unhealthy air quality", advice: isFr ? "Limitez les efforts prolong\xE9s en ext\xE9rieur." : "Limit prolonged outdoor exertion." };
  }
  return { score: NaN, cat: isFr ? "Qualit\xE9 mod\xE9r\xE9e" : "Moderate air quality", advice: "" };
}
async function fetchOpenMeteoWeatherAndForecast(lat, lng, lang) {
  const isFr = !String(lang || "fr").toLowerCase().startsWith("en");
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lng));
    url.searchParams.set(
      "current",
      "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,dew_point_2m,precipitation_probability"
    );
    url.searchParams.set("hourly", "uv_index,precipitation_probability");
    url.searchParams.set(
      "daily",
      "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,uv_index_max,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,relative_humidity_2m_mean"
    );
    url.searchParams.set("wind_speed_unit", "kmh");
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("forecast_days", "7");
    const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(7e3) });
    if (!resp.ok) return { current: null, forecastDays: [] };
    const om = await resp.json();
    const curRaw = om?.current || null;
    let current = null;
    if (curRaw && curRaw.temperature_2m != null) {
      const isDay = curRaw.is_day !== 0;
      const cond = wmoToConditionType(Number(curRaw.weather_code ?? 2), isDay);
      let uvVal = curRaw.uv_index != null ? Number(curRaw.uv_index) : NaN;
      if (!Number.isFinite(uvVal) && Array.isArray(om?.hourly?.time) && Array.isArray(om?.hourly?.uv_index)) {
        const hourPrefix = String(curRaw.time || "").slice(0, 13);
        const hIdx = om.hourly.time.findIndex((t) => String(t).startsWith(hourPrefix));
        if (hIdx >= 0 && om.hourly.uv_index[hIdx] != null) {
          uvVal = Number(om.hourly.uv_index[hIdx]);
        }
      }
      const windDeg = Number(curRaw.wind_direction_10m);
      const windSpd = Number(curRaw.wind_speed_10m);
      const windGust = Number(curRaw.wind_gusts_10m);
      const dewVal = Number(curRaw.dew_point_2m);
      const rainProb = Number(curRaw.precipitation_probability);
      const humVal = Number(curRaw.relative_humidity_2m);
      const feelsVal = Number(curRaw.apparent_temperature);
      const cloudVal = Number(curRaw.cloud_cover);
      current = {
        currentTime: curRaw.time || (/* @__PURE__ */ new Date()).toISOString(),
        source: "open-meteo",
        timeZone: om?.timezone ? { id: String(om.timezone) } : void 0,
        isDaytime: isDay,
        weatherCondition: {
          type: cond.type,
          description: { text: isFr ? cond.descFr : cond.descEn, languageCode: lang }
        },
        temperature: { degrees: Number(curRaw.temperature_2m), unit: "CELSIUS" },
        feelsLikeTemperature: Number.isFinite(feelsVal) ? { degrees: feelsVal, unit: "CELSIUS" } : void 0,
        dewPoint: Number.isFinite(dewVal) ? { degrees: dewVal, unit: "CELSIUS" } : void 0,
        relativeHumidity: Number.isFinite(humVal) ? humVal : void 0,
        uvIndex: Number.isFinite(uvVal) ? uvVal : void 0,
        precipitation: Number.isFinite(rainProb) ? { probability: { percent: rainProb, type: "RAIN" } } : void 0,
        wind: {
          direction: {
            degrees: Number.isFinite(windDeg) ? windDeg : 0,
            cardinal: degreesToCardinal(windDeg)
          },
          speed: { value: Number.isFinite(windSpd) ? windSpd : 0, unit: "KILOMETERS_PER_HOUR" },
          gust: Number.isFinite(windGust) ? { value: windGust, unit: "KILOMETERS_PER_HOUR" } : void 0
        },
        cloudCover: Number.isFinite(cloudVal) ? cloudVal : void 0
      };
    }
    const daily = om?.daily || {};
    const dDates = Array.isArray(daily.time) ? daily.time : [];
    const forecastDays = dDates.slice(0, 7).map((isoDate, i) => {
      const [year, month, day] = String(isoDate).split("-").map(Number);
      const dCond = wmoToConditionType(Number(daily.weather_code?.[i] ?? 2), true);
      const wDir = Number(daily.wind_direction_10m_dominant?.[i]);
      const wSpd = Number(daily.wind_speed_10m_max?.[i]);
      const wGust = Number(daily.wind_gusts_10m_max?.[i]);
      const humMean = Number(daily.relative_humidity_2m_mean?.[i]);
      const uvMax = Number(daily.uv_index_max?.[i]);
      const rainMax = Number(daily.precipitation_probability_max?.[i]);
      return {
        source: "open-meteo",
        displayDate: { year, month, day },
        maxTemperature: daily.temperature_2m_max?.[i] != null ? { degrees: Number(daily.temperature_2m_max[i]), unit: "CELSIUS" } : void 0,
        minTemperature: daily.temperature_2m_min?.[i] != null ? { degrees: Number(daily.temperature_2m_min[i]), unit: "CELSIUS" } : void 0,
        daytimeForecast: {
          weatherCondition: {
            type: dCond.type,
            description: { text: isFr ? dCond.descFr : dCond.descEn, languageCode: lang }
          },
          relativeHumidity: Number.isFinite(humMean) ? Math.round(humMean) : void 0,
          uvIndex: Number.isFinite(uvMax) ? Math.round(uvMax) : void 0,
          precipitation: {
            probability: { percent: Number.isFinite(rainMax) ? Math.round(rainMax) : 0, type: "RAIN" }
          },
          wind: {
            direction: {
              degrees: Number.isFinite(wDir) ? wDir : 0,
              cardinal: degreesToCardinal(wDir)
            },
            speed: { value: Number.isFinite(wSpd) ? wSpd : 0, unit: "KILOMETERS_PER_HOUR" },
            gust: Number.isFinite(wGust) ? { value: wGust, unit: "KILOMETERS_PER_HOUR" } : void 0
          }
        }
      };
    });
    return { current, forecastDays };
  } catch {
    return { current: null, forecastDays: [] };
  }
}
async function fetchOpenMeteoAtmosphericFallback(lat, lng, lang) {
  const isFr = !String(lang || "fr").toLowerCase().startsWith("en");
  try {
    const url = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lng));
    url.searchParams.set("current", "us_aqi,european_aqi,pm2_5,pm10,nitrogen_dioxide,ozone,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen");
    url.searchParams.set("hourly", "alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen");
    url.searchParams.set("forecast_days", "5");
    url.searchParams.set("timezone", "auto");
    const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(7e3) });
    if (!resp.ok) return { aqi: null, pollen: null };
    const om = await resp.json();
    const cur = om?.current || {};
    const pm25 = cur.pm2_5 != null ? Number(cur.pm2_5) : NaN;
    const pm10 = cur.pm10 != null ? Number(cur.pm10) : NaN;
    const no2 = cur.nitrogen_dioxide != null ? Number(cur.nitrogen_dioxide) : NaN;
    const o3 = cur.ozone != null ? Number(cur.ozone) : NaN;
    const eaqi = cur.european_aqi != null ? Number(cur.european_aqi) : NaN;
    const usAqi = cur.us_aqi != null ? Number(cur.us_aqi) : NaN;
    const pollutantsRaw = [
      { code: "pm25", ratio: Number.isFinite(pm25) ? pm25 / 15 : 0, val: pm25 },
      { code: "pm10", ratio: Number.isFinite(pm10) ? pm10 / 45 : 0, val: pm10 },
      { code: "no2", ratio: Number.isFinite(no2) ? no2 / 25 : 0, val: no2 },
      { code: "o3", ratio: Number.isFinite(o3) ? o3 / 100 : 0, val: o3 }
    ].sort((a, b) => b.ratio - a.ratio);
    const dominantPollutant = pollutantsRaw[0]?.code || "pm25";
    const aqiMeta = classifyEaqi(eaqi, usAqi, isFr);
    const aqi = Number.isFinite(aqiMeta.score) ? {
      dateTime: cur.time || (/* @__PURE__ */ new Date()).toISOString(),
      source: "open-meteo",
      indexes: [
        {
          code: Number.isFinite(eaqi) ? "eaqi" : "usa_epa",
          displayName: Number.isFinite(eaqi) ? "European AQI" : "US AQI",
          aqi: aqiMeta.score,
          aqiDisplay: String(aqiMeta.score),
          category: aqiMeta.cat,
          dominantPollutant
        }
      ],
      healthRecommendations: {
        generalPopulation: aqiMeta.advice
      }
    } : null;
    const hTimes = Array.isArray(om?.hourly?.time) ? om.hourly.time : [];
    const byDay = /* @__PURE__ */ new Map();
    const addReading = (dateKey, field, v) => {
      if (!byDay.has(dateKey)) {
        byDay.set(dateKey, { grass: 0, tree: 0, weed: 0, plants: {} });
      }
      const b = byDay.get(dateKey);
      const val = Number.isFinite(v) ? v : 0;
      if (field === "grass_pollen") b.grass = Math.max(b.grass, val);
      else if (field === "birch_pollen" || field === "alder_pollen" || field === "olive_pollen") {
        b.tree = Math.max(b.tree, val);
        b.plants[field] = Math.max(b.plants[field] || 0, val);
      } else {
        b.weed = Math.max(b.weed, val);
        b.plants[field] = Math.max(b.plants[field] || 0, val);
      }
    };
    const pFields = ["grass_pollen", "birch_pollen", "alder_pollen", "olive_pollen", "mugwort_pollen", "ragweed_pollen"];
    hTimes.forEach((iso, idx) => {
      const dateKey = String(iso).slice(0, 10);
      for (const f of pFields) {
        const arr = om?.hourly?.[f];
        if (Array.isArray(arr) && arr[idx] != null) addReading(dateKey, f, Number(arr[idx]));
      }
    });
    const dailyInfo = Array.from(byDay.entries()).slice(0, 5).map(([dateKey, agg]) => {
      const [yy, mm, dd] = dateKey.split("-").map(Number);
      const gU = pollenGrainsToUpi(agg.grass);
      const tU = pollenGrainsToUpi(agg.tree);
      const wU = pollenGrainsToUpi(agg.weed);
      const maxUpi = Math.max(gU.value, tU.value, wU.value);
      const advice = maxUpi === 0 ? isFr ? "Niveau de pollen tr\xE8s faible aujourd\u2019hui." : "Very low pollen levels today." : maxUpi <= 2 ? isFr ? "Allerg\xE8nes faibles \xE0 mod\xE9r\xE9s ; a\xE9rez plut\xF4t le matin." : "Low to moderate pollen; ventilate indoors in early morning." : isFr ? "Pic pollinique actif : rincez vos yeux/cheveux et limitez l\u2019a\xE9ration l\u2019apr\xE8s-midi." : "Active pollen peak: rinse hair and keep windows closed in afternoon.";
      return {
        date: { year: yy, month: mm, day: dd },
        pollenTypeInfo: [
          {
            code: "GRASS",
            displayName: isFr ? "Gramin\xE9es" : "Grass",
            inSeason: agg.grass > 0,
            indexInfo: { value: gU.value, category: isFr ? gU.categoryFr : gU.categoryEn },
            healthRecommendations: [advice]
          },
          {
            code: "TREE",
            displayName: isFr ? "Arbres" : "Tree",
            inSeason: agg.tree > 0,
            indexInfo: { value: tU.value, category: isFr ? tU.categoryFr : tU.categoryEn }
          },
          {
            code: "WEED",
            displayName: isFr ? "Herbac\xE9es" : "Weed",
            inSeason: agg.weed > 0,
            indexInfo: { value: wU.value, category: isFr ? wU.categoryFr : wU.categoryEn }
          }
        ],
        plantInfo: Object.entries(agg.plants).filter(([, gv]) => gv > 1).map(([k, gv]) => ({
          code: k.toUpperCase(),
          displayName: k.replace("_pollen", "").replace("_", " "),
          inSeason: true,
          indexInfo: { value: pollenGrainsToUpi(gv).value }
        }))
      };
    });
    const pollen = dailyInfo.length ? { source: "open-meteo", dailyInfo } : null;
    return { aqi, pollen };
  } catch {
    return { aqi: null, pollen: null };
  }
}
app.get("/api/weather/locate", async (req, res) => {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const rawIp = fwd || req.socket?.remoteAddress || "";
  const cleanIp = rawIp.replace(/^::ffff:/, "");
  const isPrivate = !cleanIp || cleanIp === "127.0.0.1" || cleanIp === "::1" || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(cleanIp);
  if (!isPrivate) {
    try {
      const geoUrl = `https://get.geojs.io/v1/ip/geo/${encodeURIComponent(cleanIp)}.json`;
      const resp = await fetch(geoUrl, { signal: AbortSignal.timeout(3e3) });
      if (resp.ok) {
        const d = await resp.json();
        const lat = Number(d?.latitude);
        const lng = Number(d?.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          return res.json({
            success: true,
            source: "ip",
            lat,
            lng,
            city: d?.city || d?.region || d?.country || "",
            country: d?.country || ""
          });
        }
      }
    } catch {
    }
  }
  return res.json({
    success: true,
    source: "default",
    lat: 48.8566,
    lng: 2.3522,
    city: "Paris",
    country: "France"
  });
});
app.get("/api/weather", async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const lang = String(req.query.lang || "fr").trim().slice(0, 10) || "fr";
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ success: false, reason: "invalid_coordinates" });
  }
  const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)},${lang}`;
  const cached = weatherCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return res.json({ ...cached.payload, cached: true });
  }
  const mapsKey = getMapsApiKey();
  let cur = null;
  let forecastDays = [];
  let aqi = null;
  let pollen = null;
  let location = {
    shortName: "",
    locality: "",
    neighborhood: "",
    region: "",
    country: "",
    formattedAddress: `${lat.toFixed(4)}, ${lng.toFixed(4)}`
  };
  let quotaExceeded = false;
  try {
    if (mapsKey) {
      const curUrl = new URL("https://weather.googleapis.com/v1/currentConditions:lookup");
      curUrl.searchParams.set("key", mapsKey);
      curUrl.searchParams.set("location.latitude", String(lat));
      curUrl.searchParams.set("location.longitude", String(lng));
      curUrl.searchParams.set("unitsSystem", "METRIC");
      const daysUrl = new URL("https://weather.googleapis.com/v1/forecast/days:lookup");
      daysUrl.searchParams.set("key", mapsKey);
      daysUrl.searchParams.set("location.latitude", String(lat));
      daysUrl.searchParams.set("location.longitude", String(lng));
      daysUrl.searchParams.set("days", "7");
      daysUrl.searchParams.set("pageSize", "7");
      daysUrl.searchParams.set("unitsSystem", "METRIC");
      const aqiUrl = `https://airquality.googleapis.com/v1/currentConditions:lookup?key=${encodeURIComponent(mapsKey)}`;
      const pollenUrl = new URL("https://pollen.googleapis.com/v1/forecast:lookup");
      pollenUrl.searchParams.set("key", mapsKey);
      pollenUrl.searchParams.set("location.latitude", String(lat));
      pollenUrl.searchParams.set("location.longitude", String(lng));
      pollenUrl.searchParams.set("days", "5");
      pollenUrl.searchParams.set("plantsDescription", "false");
      pollenUrl.searchParams.set("languageCode", lang);
      const geoUrl = new URL("https://geocode.googleapis.com/v4/geocode/location");
      geoUrl.searchParams.set("location.latitude", String(lat));
      geoUrl.searchParams.set("location.longitude", String(lng));
      geoUrl.searchParams.set("languageCode", lang);
      const [curRes, daysRes, aqiRes, pollenRes, geoRes] = await Promise.all([
        fetchJsonWithGmp(curUrl.toString()),
        fetchJsonWithGmp(daysUrl.toString()),
        fetchJsonWithGmp(aqiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            universalAqi: true,
            location: { latitude: lat, longitude: lng },
            extraComputations: [
              "HEALTH_RECOMMENDATIONS",
              "DOMINANT_POLLUTANT_CONCENTRATION",
              "POLLUTANT_CONCENTRATION",
              "LOCAL_AQI"
            ],
            languageCode: lang
          })
        }),
        fetchJsonWithGmp(pollenUrl.toString()),
        fetchJsonWithGmp(geoUrl.toString(), {
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": mapsKey,
            "X-Goog-FieldMask": "results.placeId,results.formattedAddress,results.addressComponents,results.types,plusCode"
          }
        })
      ]);
      quotaExceeded = Boolean(
        curRes.quotaExceeded || daysRes.quotaExceeded || aqiRes.quotaExceeded || pollenRes.quotaExceeded || geoRes.quotaExceeded
      );
      if (curRes.ok && curRes.data) cur = curRes.data;
      if (daysRes.ok && Array.isArray(daysRes.data?.forecastDays)) {
        forecastDays = daysRes.data.forecastDays.slice();
        if (daysRes.data?.nextPageToken && forecastDays.length < 7) {
          const p2Url = new URL(daysUrl.toString());
          p2Url.searchParams.set("pageToken", String(daysRes.data.nextPageToken));
          const p2Res = await fetchJsonWithGmp(p2Url.toString());
          if (p2Res.ok && Array.isArray(p2Res.data?.forecastDays)) {
            forecastDays = forecastDays.concat(p2Res.data.forecastDays).slice(0, 7);
          }
        }
      }
      let finalAqiRes = aqiRes;
      if (!finalAqiRes.ok && !finalAqiRes.quotaExceeded && finalAqiRes.status === 400 && curRes.ok) {
        finalAqiRes = await fetchJsonWithGmp(aqiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            universalAqi: true,
            location: { latitude: lat, longitude: lng }
          })
        });
      }
      if (finalAqiRes.ok && finalAqiRes.data) aqi = finalAqiRes.data;
      if (pollenRes.ok && pollenRes.data) pollen = pollenRes.data;
      if (geoRes.ok && geoRes.data) {
        location = extractLocationSummary(geoRes.data, lat, lng);
      }
    }
    const needsWx = !cur || !forecastDays.length;
    const needsAtmo = !aqi || !pollen;
    const needsGeo = !location.shortName;
    const [omWx, omAtmo, fbGeo] = await Promise.all([
      needsWx ? fetchOpenMeteoWeatherAndForecast(lat, lng, lang) : Promise.resolve({ current: null, forecastDays: [] }),
      needsAtmo ? fetchOpenMeteoAtmosphericFallback(lat, lng, lang) : Promise.resolve({ aqi: null, pollen: null }),
      needsGeo ? reverseGeocodeFallback(lat, lng, lang) : Promise.resolve(null)
    ]);
    if (!cur && omWx.current) cur = omWx.current;
    if (!forecastDays.length && omWx.forecastDays.length) forecastDays = omWx.forecastDays;
    if (!aqi && omAtmo.aqi) aqi = omAtmo.aqi;
    if (!pollen && omAtmo.pollen) pollen = omAtmo.pollen;
    if (!location.shortName && fbGeo) location = fbGeo;
    if (!cur && !forecastDays.length && !aqi) {
      return res.status(quotaExceeded ? 429 : 200).json({
        success: false,
        quotaExceeded,
        reason: quotaExceeded ? "quota_exceeded" : "weather_unavailable"
      });
    }
    const payload = {
      success: true,
      quotaExceeded,
      fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
      coordinates: { lat: +lat.toFixed(5), lng: +lng.toFixed(5) },
      location,
      current: cur,
      forecastDays,
      airQuality: aqi,
      pollen
    };
    if (weatherCache.size > 100) {
      const firstKey = weatherCache.keys().next().value;
      if (firstKey) weatherCache.delete(firstKey);
    }
    weatherCache.set(cacheKey, {
      expiresAt: Date.now() + WEATHER_CACHE_TTL_MS,
      payload
    });
    return res.json(payload);
  } catch (err) {
    return res.status(502).json({
      success: false,
      reason: "weather_proxy_error",
      message: err?.message || String(err)
    });
  }
});
app.get("/api/weather/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const lang = String(req.query.lang || "fr").trim().slice(0, 10) || "fr";
  if (!q) {
    return res.status(400).json({ success: false, reason: "missing_query" });
  }
  const mapsKey = getMapsApiKey();
  let quotaExceeded = false;
  try {
    if (mapsKey) {
      const geoUrl = new URL(`https://geocode.googleapis.com/v4/geocode/address/${encodeURIComponent(q)}`);
      geoUrl.searchParams.set("languageCode", lang);
      const geoRes = await fetchJsonWithGmp(geoUrl.toString(), {
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": mapsKey,
          "X-Goog-FieldMask": "results.placeId,results.location,results.formattedAddress,results.addressComponents"
        }
      });
      if (geoRes.quotaExceeded) quotaExceeded = true;
      const first = Array.isArray(geoRes.data?.results) ? geoRes.data.results[0] : null;
      if (first?.location && Number.isFinite(first.location.latitude) && Number.isFinite(first.location.longitude)) {
        const summary = extractLocationSummary(geoRes.data, first.location.latitude, first.location.longitude);
        return res.json({
          success: true,
          quotaExceeded,
          lat: first.location.latitude,
          lng: first.location.longitude,
          location: summary
        });
      }
    }
    const omGeo = new URL("https://geocoding-api.open-meteo.com/v1/search");
    omGeo.searchParams.set("name", q);
    omGeo.searchParams.set("count", "1");
    omGeo.searchParams.set("language", String(lang).startsWith("en") ? "en" : "fr");
    omGeo.searchParams.set("format", "json");
    const omResp = await fetch(omGeo.toString(), { signal: AbortSignal.timeout(5e3) });
    if (omResp.ok) {
      const omData = await omResp.json();
      const hit = Array.isArray(omData?.results) ? omData.results[0] : null;
      if (hit && Number.isFinite(Number(hit.latitude)) && Number.isFinite(Number(hit.longitude))) {
        const name = String(hit.name || q);
        const region = String(hit.admin1 || "");
        const country = String(hit.country || "");
        return res.json({
          success: true,
          quotaExceeded,
          lat: Number(hit.latitude),
          lng: Number(hit.longitude),
          location: {
            shortName: name,
            locality: name,
            neighborhood: "",
            region,
            country,
            formattedAddress: [name, region, country].filter(Boolean).join(", ")
          }
        });
      }
    }
    return res.status(200).json({ success: false, quotaExceeded, reason: "location_not_found" });
  } catch (err) {
    return res.status(502).json({
      success: false,
      reason: "geocode_search_error",
      message: err?.message || String(err)
    });
  }
});
var editions = ["fr", "en", "ja", "zh-hant", "zh-hans", "ko", "id", "vi"];
app.get("/", (req, res) => {
  const lang = String(req.query.lang || "").toLowerCase();
  if (lang && editions.includes(lang)) {
    return res.redirect(`/${lang}/`);
  }
  res.sendFile(path9.join(__dirname, "index.html"));
});
app.get(["/studio", "/studio/"], (req, res) => {
  if (!req.path.endsWith("/")) {
    return res.redirect(301, "/studio/");
  }
  res.sendFile(path9.join(__dirname, "studio", "index.html"));
});
for (const ed of editions) {
  app.get([`/${ed}`, `/${ed}/`], (req, res) => {
    if (!req.path.endsWith("/")) {
      return res.redirect(301, `/${ed}/`);
    }
    res.sendFile(path9.join(__dirname, ed, "index.html"));
  });
}
app.use(express3.static(__dirname, {
  extensions: ["html"],
  index: false
}));
app.use((req, res) => {
  res.sendFile(path9.join(__dirname, "fr", "index.html"));
});
app.listen(PORT, HOST, () => {
  console.log(`Alexura server running at http://${HOST}:${PORT}`);
  setTimeout(() => warmupWhisper(), 1200);
});
