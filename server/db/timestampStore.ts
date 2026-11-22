import { execFile } from 'node:child_process';
import path from 'node:path';
import type {
  PipelineJobRecord,
  SongTimestampRecord,
  UploadRecord,
} from '../types/pipeline.ts';

const DB_SCRIPT = path.resolve(process.cwd(), 'backend', 'db.py');

function runDbAction<T = any>(action: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'python3',
      [DB_SCRIPT, action],
      { maxBuffer: 25 * 1024 * 1024, timeout: 25000 },
      (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(stderr?.trim() || err.message));
        }
        try {
          const parsed = JSON.parse(stdout || '{}');
          if (!parsed.ok) {
            return reject(new Error(parsed.error || `db_action_failed:${action}`));
          }
          resolve(parsed as T);
        } catch (parseErr: any) {
          reject(new Error(`db_invalid_json:${parseErr?.message || action}`));
        }
      },
    );
    child.stdin?.write(JSON.stringify(payload ?? {}));
    child.stdin?.end();
  });
}

export interface CachedAnalysisRecord {
  cacheKey: string;
  audioSha256: string;
  songId: string;
  hitCount: number;
  result: SongTimestampRecord;
  createdAt: string;
}

export const timestampStore = {
  async saveUpload(record: UploadRecord): Promise<UploadRecord> {
    const res = await runDbAction<{ ok: true; upload: UploadRecord }>('upsert_upload', record);
    return res.upload;
  },

  async getUpload(id: string): Promise<UploadRecord | null> {
    const res = await runDbAction<{ ok: true; upload: UploadRecord | null }>('get_upload', { id });
    return res.upload || null;
  },

  async findUploadBySha256(sha256: string): Promise<UploadRecord | null> {
    const res = await runDbAction<{ ok: true; upload: UploadRecord | null }>(
      'find_upload_by_sha256',
      { sha256 },
    );
    return res.upload || null;
  },

  async saveJob(job: PipelineJobRecord): Promise<PipelineJobRecord> {
    const res = await runDbAction<{ ok: true; job: PipelineJobRecord }>('upsert_job', job);
    return res.job;
  },

  async getJob(id: string): Promise<PipelineJobRecord | null> {
    const res = await runDbAction<{ ok: true; job: PipelineJobRecord | null }>('get_job', { id });
    return res.job || null;
  },

  async listJobs(limit = 25): Promise<PipelineJobRecord[]> {
    const res = await runDbAction<{ ok: true; jobs: PipelineJobRecord[] }>('list_jobs', { limit });
    return res.jobs || [];
  },

  async getCachedAnalysis(cacheKey: string): Promise<CachedAnalysisRecord | null> {
    const res = await runDbAction<{ ok: true; cache: CachedAnalysisRecord | null }>(
      'get_cached_analysis',
      { cacheKey },
    );
    return res.cache || null;
  },

  async saveCachedAnalysis(params: {
    cacheKey: string;
    audioSha256: string;
    paramsHash: string;
    songId: string;
    result: SongTimestampRecord;
  }): Promise<void> {
    await runDbAction<{ ok: true }>('save_cached_analysis', params);
  },

  async saveSongTimestamps(song: SongTimestampRecord): Promise<SongTimestampRecord> {
    const res = await runDbAction<{ ok: true; song: SongTimestampRecord }>('save_song_timestamps', song);
    return res.song;
  },

  async getSongTimestamps(songId: string): Promise<SongTimestampRecord | null> {
    const res = await runDbAction<{ ok: true; song: SongTimestampRecord | null }>('get_song_timestamps', { songId });
    return res.song || null;
  },

  async listSongs(limit = 40): Promise<Array<Omit<SongTimestampRecord, 'lines'> & { lineCount: number; wordCount: number }>> {
    const res = await runDbAction<{ ok: true; songs: any[] }>('list_songs', { limit });
    return res.songs || [];
  },

  async updateWordTimestamp(params: {
    songId: string;
    lineIndex: number;
    wordIndex: number;
    start: number;
    end: number;
    provenance?: string;
  }): Promise<SongTimestampRecord> {
    const res = await runDbAction<{ ok: true; song: SongTimestampRecord }>('update_word_timestamp', params);
    return res.song;
  },
};
