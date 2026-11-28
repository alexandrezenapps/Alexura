/**
 * Typed REST Client for Alexura AI Lyrics Sync Engine (/api/v1/*).
 * Clean separation from backend: never contains Gemini or external AI API keys.
 */

import type {
  AdapterReportMap,
  AudioAssetRecord,
  LyricSegment,
  LyricsDocument,
  ProcessingJob,
} from '@/types/lyrics';

const API_BASE =
  (typeof import.meta !== 'undefined' &&
    (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE_URL) ||
  '';

export function apiUrl(path: string): string {
  const base = API_BASE.replace(/\/$/, '');
  return `${base}${path}`;
}

async function parseJsonResponse<T>(resp: Response): Promise<T> {
  const text = await resp.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new Error(`Invalid JSON response (${resp.status})`);
  }
  if (!resp.ok || data.success === false) {
    const errMsg = String(data.detail || data.error || `HTTP ${resp.status}`);
    throw new Error(errMsg);
  }
  return data as T;
}

export const syncEngineApi = {
  async getAdapters(): Promise<AdapterReportMap> {
    const res = await fetch(apiUrl('/api/v1/adapters'));
    const json = await parseJsonResponse<{ adapters: AdapterReportMap }>(res);
    return json.adapters;
  },

  async uploadAudio(file: File): Promise<AudioAssetRecord> {
    const form = new FormData();
    form.append('file', file, file.name);
    const res = await fetch(apiUrl('/api/v1/audio/upload'), {
      method: 'POST',
      body: form,
    });
    const json = await parseJsonResponse<{ audio: AudioAssetRecord }>(res);
    return json.audio;
  },

  async analyzeSong(payload: {
    audioId: string;
    title?: string;
    artist?: string;
    languageHint?: string;
    draftLyricsText?: string;
    enableVocalSeparation?: boolean;
  }): Promise<ProcessingJob> {
    const res = await fetch(apiUrl('/api/v1/jobs/analyze'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await parseJsonResponse<{ job: ProcessingJob }>(res);
    return json.job;
  },

  async getJobStatus(jobId: string): Promise<ProcessingJob> {
    const res = await fetch(apiUrl(`/api/v1/jobs/${encodeURIComponent(jobId)}`));
    const json = await parseJsonResponse<{ job: ProcessingJob }>(res);
    return json.job;
  },

  async listJobs(): Promise<ProcessingJob[]> {
    const res = await fetch(apiUrl('/api/v1/jobs'));
    const json = await parseJsonResponse<{ jobs: ProcessingJob[] }>(res);
    return json.jobs || [];
  },

  async getLyricsDocument(documentId: string): Promise<LyricsDocument> {
    const res = await fetch(apiUrl(`/api/v1/lyrics/${encodeURIComponent(documentId)}`));
    const json = await parseJsonResponse<{ document: LyricsDocument }>(res);
    return json.document;
  },

  async listLyricsDocuments(): Promise<LyricsDocument[]> {
    const res = await fetch(apiUrl('/api/v1/lyrics'));
    const json = await parseJsonResponse<{ documents: LyricsDocument[] }>(res);
    return json.documents || [];
  },

  async updateLyricsDocument(
    documentId: string,
    payload: {
      title?: string;
      artist?: string;
      primaryLanguage?: string;
      alignmentStatus?: LyricsDocument['alignmentStatus'];
      segments: LyricSegment[];
    },
  ): Promise<LyricsDocument> {
    const res = await fetch(apiUrl(`/api/v1/lyrics/${encodeURIComponent(documentId)}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await parseJsonResponse<{ document: LyricsDocument }>(res);
    return json.document;
  },
};
