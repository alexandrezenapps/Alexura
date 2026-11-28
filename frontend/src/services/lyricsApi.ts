/**
 * Modular Lyrics & Segment Remapping REST Client aligned with ai-lyrics-sync architecture.
 * Wraps syncEngineApi while adding canonical song_001 export, project inspection, and segment remapping.
 */

import { apiUrl, syncEngineApi } from '@/services/syncEngineApi';
import type {
  AlignedLyricsDocument,
  AnalysisSegmentMapping,
  CanonicalAlignmentSegment,
  CanonicalProcessingJob,
  CanonicalSongAlignmentDocument,
  LyricsDocument,
} from '@/types/lyrics';

export interface ProjectSummary {
  documentId: string;
  song_id: string;
  title: string;
  artist: string;
  language: string;
  durationSeconds: number;
  alignmentStatus: LyricsDocument['alignmentStatus'];
  updatedAt: string;
}

export const lyricsApi = {
  ...syncEngineApi,

  async listProjects(): Promise<ProjectSummary[]> {
    const res = await fetch(apiUrl('/api/v1/projects'));
    const json = await res.json();
    if (!res.ok || json.success === false) {
      throw new Error(String(json.detail || json.error || `HTTP ${res.status}`));
    }
    return json.projects || [];
  },

  async getProjectDetail(documentId: string): Promise<{
    document: LyricsDocument;
    song_alignment: CanonicalSongAlignmentDocument;
  }> {
    const res = await fetch(apiUrl(`/api/v1/projects/${encodeURIComponent(documentId)}`));
    const json = await res.json();
    if (!res.ok || json.success === false) {
      throw new Error(String(json.detail || json.error || `HTTP ${res.status}`));
    }
    return {
      document: json.document,
      song_alignment: json.song_alignment,
    };
  },

  async getCanonicalAlignment(documentId: string): Promise<CanonicalSongAlignmentDocument> {
    const res = await fetch(apiUrl(`/api/v1/lyrics/${encodeURIComponent(documentId)}/canonical`));
    const json = await res.json();
    if (!res.ok || json.success === false) {
      throw new Error(String(json.detail || json.error || `HTTP ${res.status}`));
    }
    return json as CanonicalSongAlignmentDocument;
  },

  async getCanonicalJobStatus(jobId: string): Promise<CanonicalProcessingJob> {
    const res = await fetch(apiUrl(`/api/v1/jobs/${encodeURIComponent(jobId)}/canonical`));
    const json = await res.json();
    if (!res.ok || json.success === false) {
      throw new Error(String(json.detail || json.error || `HTTP ${res.status}`));
    }
    return json as CanonicalProcessingJob;
  },

  async getAlignedLyrics(documentId: string): Promise<AlignedLyricsDocument> {
    const res = await fetch(apiUrl(`/api/v1/lyrics/${encodeURIComponent(documentId)}/aligned`));
    const json = await res.json();
    if (!res.ok || json.success === false) {
      throw new Error(String(json.detail || json.error || `HTTP ${res.status}`));
    }
    return json as AlignedLyricsDocument;
  },

  async updateAlignedLyrics(
    documentId: string,
    aligned: AlignedLyricsDocument,
  ): Promise<{ document: LyricsDocument; aligned: AlignedLyricsDocument }> {
    const res = await fetch(apiUrl(`/api/v1/lyrics/${encodeURIComponent(documentId)}/aligned`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(aligned),
    });
    const json = await res.json();
    if (!res.ok || json.success === false) {
      throw new Error(String(json.detail || json.error || `HTTP ${res.status}`));
    }
    return { document: json.document, aligned: json.aligned };
  },

  async importAlignedLyrics(
    aligned: AlignedLyricsDocument,
  ): Promise<{ document: LyricsDocument; aligned: AlignedLyricsDocument }> {
    const res = await fetch(apiUrl('/api/v1/lyrics/import-aligned'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(aligned),
    });
    const json = await res.json();
    if (!res.ok || json.success === false) {
      throw new Error(String(json.detail || json.error || `HTTP ${res.status}`));
    }
    return { document: json.document, aligned: json.aligned };
  },

  async remapAnalysisSegment(payload: {
    mapping: AnalysisSegmentMapping;
    audioDuration?: number;
    segment?: CanonicalAlignmentSegment;
    segments?: CanonicalAlignmentSegment[];
    analysisTimestamp?: number;
  }): Promise<{
    mapping: AnalysisSegmentMapping;
    segment?: CanonicalAlignmentSegment;
    segments?: CanonicalAlignmentSegment[];
    original_timestamp?: number;
    offset_seconds?: number;
  }> {
    const res = await fetch(apiUrl('/api/v1/jobs/remap-segment'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok || json.success === false) {
      throw new Error(String(json.detail || json.error || `HTTP ${res.status}`));
    }
    return json;
  },
};
