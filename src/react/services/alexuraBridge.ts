import type { SongTimestampRecord, SyncedLine } from '../types/pipeline';

interface AlexuraWindow extends Window {
  J?: {
    S?: {
      lyrics?: string;
      lineTimes?: Record<number, number>;
      wordTimes?: Record<number, Array<{ text: string; start: number; end: number }>>;
      project?: { title?: string; artist?: string; cloudSongId?: string };
      audio?: { file?: File; dur?: number };
    };
    uiApi?: {
      loadAudioFile?: (file: File, restored?: boolean) => Promise<void>;
      saveSyncedLyrics?: () => void;
      replan?: () => void;
      syncUI?: () => void;
      toast?: (msg: string) => void;
    };
  };
  AlexuraCloud?: {
    getUser?: () => { uid: string; displayName?: string | null; email?: string | null } | null;
    signInGoogle?: () => Promise<unknown>;
    saveSongToCloud?: (input: Record<string, unknown>, audioFile?: File | null) => Promise<{ songId: string }>;
    saveTimestampSnapshot?: (input: {
      songId: string;
      versionId?: string;
      uploadId?: string;
      language?: string;
      provenanceSummary: string;
      validationSummary?: Record<string, unknown>;
      lines: Array<Record<string, unknown>>;
    }) => Promise<{ versionId: string }>;
  };
}

export function readCurrentAlexuraProject(): {
  title: string;
  artist: string;
  lyricsText: string;
  audioFile: File | null;
  songId?: string;
} {
  const w = window as unknown as AlexuraWindow;
  const s = w.J?.S;
  return {
    title: String(s?.project?.title || ''),
    artist: String(s?.project?.artist || ''),
    lyricsText: String(s?.lyrics || ''),
    audioFile: s?.audio?.file || null,
    songId: s?.project?.cloudSongId,
  };
}

export function pushTimestampsToAlexuraStudio(song: SongTimestampRecord): boolean {
  const w = window as unknown as AlexuraWindow;
  const s = w.J?.S;
  if (!s) return false;
  const lyricsLines = song.lines.map((l) => l.text);
  s.lyrics = lyricsLines.join('\n');
  s.lineTimes = {};
  s.wordTimes = {};
  song.lines.forEach((ln, idx) => {
    s.lineTimes![idx] = ln.start;
    s.wordTimes![idx] = (ln.words || []).map((wd) => ({
      text: wd.text,
      start: wd.start,
      end: wd.end,
    }));
  });
  if (s.project) {
    if (song.title) s.project.title = song.title;
    if (song.artist) s.project.artist = song.artist;
  }
  const ta = document.getElementById('lyrics') as HTMLTextAreaElement | null;
  if (ta) {
    ta.value = s.lyrics;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  w.J?.uiApi?.replan?.();
  w.J?.uiApi?.syncUI?.();
  w.J?.uiApi?.toast?.(`Synchronisation React Studio appliquée (${song.lines.length} lignes)`);
  return true;
}

export async function pushAudioFileToAlexuraStudio(file: File): Promise<void> {
  const w = window as unknown as AlexuraWindow;
  if (w.J?.uiApi?.loadAudioFile) {
    await w.J.uiApi.loadAudioFile(file, false);
  }
}

export async function syncTimestampSnapshotToFirestore(song: SongTimestampRecord): Promise<{
  songId: string;
  versionId: string;
}> {
  const w = window as unknown as AlexuraWindow;
  const cloud = w.AlexuraCloud;
  if (!cloud?.saveTimestampSnapshot || !cloud?.saveSongToCloud) {
    throw new Error('FIREBASE_BRIDGE_UNAVAILABLE');
  }
  if (!cloud.getUser?.() && cloud.signInGoogle) {
    await cloud.signInGoogle();
  }
  if (!cloud.getUser?.()) {
    throw new Error('AUTH_REQUIRED');
  }
  const songRes = await cloud.saveSongToCloud({
    songId: song.songId,
    title: song.title || 'Sans titre',
    artist: song.artist || '',
    lyrics: song.lines.map((l) => l.text).join('\n'),
    lang: song.language || 'auto',
    duration: song.durationSec || 0,
    bpm: song.bpm || 0,
    project: {
      title: song.title || 'Sans titre',
      artist: song.artist || '',
      lineTimes: Object.fromEntries(song.lines.map((l, i) => [i, l.start])),
      wordTimes: Object.fromEntries(song.lines.map((l, i) => [i, l.words])),
      provenance: song.provenance,
    },
  });
  const provStr = String(
    (song.provenance as { alignmentProvenance?: string })?.alignmentProvenance || 'dsp_acoustic_viterbi',
  ).slice(0, 150);
  const snapRes = await cloud.saveTimestampSnapshot({
    songId: songRes.songId,
    uploadId: song.uploadId || undefined,
    language: song.language || 'auto',
    provenanceSummary: provStr,
    validationSummary: song.validationSummary as unknown as Record<string, unknown>,
    lines: song.lines as unknown as Array<Record<string, unknown>>,
  });
  return { songId: songRes.songId, versionId: snapRes.versionId };
}

export function isCloudAuthenticated(): boolean {
  const w = window as unknown as AlexuraWindow;
  return Boolean(w.AlexuraCloud?.getUser?.());
}

export async function signInWithGoogleForCloud(): Promise<boolean> {
  const w = window as unknown as AlexuraWindow;
  await w.AlexuraCloud?.signInGoogle?.();
  return Boolean(w.AlexuraCloud?.getUser?.());
}

export function flattenLinesWordsCount(lines: SyncedLine[]): number {
  return lines.reduce((acc, l) => acc + (l.words?.length || 0), 0);
}
