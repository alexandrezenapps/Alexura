import type {
  PipelineCapabilities,
  PipelineJobRecord,
  SongSummaryItem,
  SongTimestampRecord,
  SyncedLine,
  UploadProgressInfo,
  UploadRecord,
} from '../types/pipeline';

const CHUNK_THRESHOLD_BYTES = 8 * 1024 * 1024; // 8 MB
const DEFAULT_CHUNK_BYTES = 4 * 1024 * 1024; // 4 MB

async function uploadSmallWithProgress(
  file: File,
  onProgress?: (info: UploadProgressInfo) => void,
): Promise<UploadRecord> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/v2/uploads/raw', true);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && ev.total > 0) {
        const pct = Math.min(95, Math.round((ev.loaded / ev.total) * 95));
        onProgress?.({
          percent: pct,
          loadedBytes: ev.loaded,
          totalBytes: ev.total,
          phase: ev.loaded >= ev.total ? 'probing' : 'uploading',
        });
      }
    };

    xhr.upload.onload = () => {
      onProgress?.({
        percent: 96,
        loadedBytes: file.size,
        totalBytes: file.size,
        phase: 'probing',
      });
    };

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300 && data?.success) {
          onProgress?.({
            percent: 100,
            loadedBytes: file.size,
            totalBytes: file.size,
            phase: 'probing',
          });
          resolve(data.upload as UploadRecord);
        } else {
          reject(new Error(data?.error || 'upload_failed'));
        }
      } catch {
        reject(new Error('upload_invalid_response'));
      }
    };

    xhr.onerror = () => reject(new Error('upload_network_error'));
    xhr.send(file);
  });
}

async function uploadChunkWithRetry(
  sessionId: string,
  chunkBlob: Blob,
  chunkIndex: number,
  maxRetries = 2,
): Promise<void> {
  let lastErr: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetch(`/api/v2/uploads/${encodeURIComponent(sessionId)}/chunk`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Chunk-Index': String(chunkIndex),
        },
        body: chunkBlob,
      });
      const data = await resp.json();
      if (!resp.ok || !data?.success) {
        throw new Error(data?.error || `chunk_failed_${resp.status}`);
      }
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastErr;
}

async function uploadLargeChunked(
  file: File,
  onProgress?: (info: UploadProgressInfo) => void,
): Promise<UploadRecord> {
  const initResp = await fetch('/api/v2/uploads/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      expectedBytes: file.size,
    }),
  });
  const initData = await initResp.json();
  if (!initResp.ok || !initData?.success) {
    throw new Error(initData?.error || 'upload_init_failed');
  }

  const sessionId = String(initData.session.sessionId);
  const chunkBytes = Number(initData.recommendedChunkBytes || DEFAULT_CHUNK_BYTES);
  let offset = 0;
  let chunkIndex = 0;

  while (offset < file.size) {
    const end = Math.min(file.size, offset + chunkBytes);
    const slice = file.slice(offset, end);
    await uploadChunkWithRetry(sessionId, slice, chunkIndex);
    offset = end;
    chunkIndex += 1;
    const pct = Math.min(94, Math.round((offset / file.size) * 94));
    onProgress?.({
      percent: pct,
      loadedBytes: offset,
      totalBytes: file.size,
      phase: offset >= file.size ? 'probing' : 'uploading',
    });
  }

  onProgress?.({
    percent: 96,
    loadedBytes: file.size,
    totalBytes: file.size,
    phase: 'probing',
  });

  const completeResp = await fetch(`/api/v2/uploads/${encodeURIComponent(sessionId)}/complete`, {
    method: 'POST',
  });
  const completeData = await completeResp.json();
  if (!completeResp.ok || !completeData?.success) {
    throw new Error(completeData?.error || 'upload_complete_failed');
  }
  onProgress?.({
    percent: 100,
    loadedBytes: file.size,
    totalBytes: file.size,
    phase: 'probing',
  });
  return completeData.upload as UploadRecord;
}

export const pipelineApiClient = {
  async fetchCapabilities(): Promise<PipelineCapabilities> {
    const resp = await fetch('/api/v2/capabilities');
    const data = await resp.json();
    if (!resp.ok || !data.success) throw new Error(data.error || 'capabilities_failed');
    return data.capabilities as PipelineCapabilities;
  },

  async uploadAudioFile(
    file: File,
    onProgress?: (info: UploadProgressInfo) => void,
  ): Promise<UploadRecord> {
    onProgress?.({
      percent: 1,
      loadedBytes: 0,
      totalBytes: file.size,
      phase: 'uploading',
    });
    if (file.size > CHUNK_THRESHOLD_BYTES) {
      return uploadLargeChunked(file, onProgress);
    }
    return uploadSmallWithProgress(file, onProgress);
  },

  async createJob(params: {
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
    const resp = await fetch('/api/v2/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await resp.json();
    if (!resp.ok || !data.success) throw new Error(data.error || 'job_create_failed');
    return data.job as PipelineJobRecord;
  },

  async listJobs(): Promise<PipelineJobRecord[]> {
    const resp = await fetch('/api/v2/jobs');
    const data = await resp.json();
    if (!resp.ok || !data.success) throw new Error(data.error || 'jobs_list_failed');
    return (data.jobs || []) as PipelineJobRecord[];
  },

  async retryJob(jobId: string): Promise<PipelineJobRecord> {
    const resp = await fetch(`/api/v2/jobs/${encodeURIComponent(jobId)}/retry`, {
      method: 'POST',
    });
    const data = await resp.json();
    if (!resp.ok || !data.success) throw new Error(data.error || 'job_retry_failed');
    return data.job as PipelineJobRecord;
  },

  subscribeJobEvents(
    jobId: string,
    onUpdate: (job: PipelineJobRecord) => void,
    onError: (err: string) => void,
  ): () => void {
    const es = new EventSource(`/api/v2/jobs/${encodeURIComponent(jobId)}/events`);
    es.onmessage = (ev) => {
      try {
        const job = JSON.parse(ev.data) as PipelineJobRecord;
        onUpdate(job);
        if (job.status === 'completed' || job.status === 'failed') {
          es.close();
        }
      } catch {
        // Ignore keepalive glitch
      }
    };
    es.onerror = () => {
      es.close();
      void fetch(`/api/v2/jobs/${encodeURIComponent(jobId)}`)
        .then((r) => r.json())
        .then((d) => {
          if (d?.success && d.job) onUpdate(d.job as PipelineJobRecord);
          else onError('sse_disconnected');
        })
        .catch(() => onError('sse_disconnected'));
    };
    return () => es.close();
  },

  subscribeGlobalJobEvents(onUpdate: (job: PipelineJobRecord) => void): () => void {
    const es = new EventSource('/api/v2/jobs/events');
    es.onmessage = (ev) => {
      try {
        const job = JSON.parse(ev.data) as PipelineJobRecord;
        if (job?.id) onUpdate(job);
      } catch {
        // Ignore parse glitch
      }
    };
    return () => es.close();
  },

  async listSongs(): Promise<SongSummaryItem[]> {
    const resp = await fetch('/api/v2/songs');
    const data = await resp.json();
    if (!resp.ok || !data.success) throw new Error(data.error || 'songs_list_failed');
    return (data.songs || []) as SongSummaryItem[];
  },

  async getSongTimestamps(songId: string): Promise<SongTimestampRecord> {
    const resp = await fetch(`/api/v2/songs/${encodeURIComponent(songId)}/timestamps`);
    const data = await resp.json();
    if (!resp.ok || !data.success) throw new Error(data.error || 'song_not_found');
    return data.song as SongTimestampRecord;
  },

  async saveSongTimestamps(
    songId: string,
    payload: Partial<SongTimestampRecord> & { lines: SyncedLine[] },
  ): Promise<SongTimestampRecord> {
    const resp = await fetch(`/api/v2/songs/${encodeURIComponent(songId)}/timestamps`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok || !data.success) throw new Error(data.error || 'song_save_failed');
    return data.song as SongTimestampRecord;
  },

  async patchWordTimestamp(
    songId: string,
    lineIndex: number,
    wordIndex: number,
    start: number,
    end: number,
  ): Promise<SongTimestampRecord> {
    const resp = await fetch(
      `/api/v2/songs/${encodeURIComponent(songId)}/words/${lineIndex}/${wordIndex}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start, end, provenance: 'human_verified' }),
      },
    );
    const data = await resp.json();
    if (!resp.ok || !data.success) throw new Error(data.error || 'word_patch_failed');
    return data.song as SongTimestampRecord;
  },
};
