import type { SyncedLine, SyncedWord } from '../types/pipeline';

export interface ActiveSyncFrame {
  lineIndex: number;
  line: SyncedLine | null;
  nextLine: SyncedLine | null;
  wordIndex: number;
  word: SyncedWord | null;
  wordProgress: number; // 0..1 within active word
  lineProgress: number; // 0..1 within active line
  inInstrumentalGap: boolean;
}

/**
 * Real-time binary-search + active-window lyric synchronization engine.
 * Evaluates current playback time (plus optional user latency offset) cleanly at 60fps.
 */
export function computeActiveSyncFrame(
  lines: SyncedLine[],
  playbackSec: number,
  offsetSec = 0,
): ActiveSyncFrame {
  const t = Math.max(0, playbackSec - offsetSec);
  if (!lines.length) {
    return {
      lineIndex: -1,
      line: null,
      nextLine: null,
      wordIndex: -1,
      word: null,
      wordProgress: 0,
      lineProgress: 0,
      inInstrumentalGap: false,
    };
  }

  let activeLineIdx = -1;
  // Binary search on line start
  let lo = 0;
  let hi = lines.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].start <= t) {
      activeLineIdx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (activeLineIdx >= 0 && t <= lines[activeLineIdx].end + 0.08) {
    const line = lines[activeLineIdx];
    const lineDur = Math.max(0.05, line.end - line.start);
    const lineProgress = Math.max(0, Math.min(1, (t - line.start) / lineDur));

    let wordIndex = -1;
    let word: SyncedWord | null = null;
    let wordProgress = 0;
    const words = line.words || [];
    for (let wi = 0; wi < words.length; wi++) {
      const w = words[wi];
      if (t >= w.start - 0.015 && t <= w.end + 0.025) {
        wordIndex = wi;
        word = w;
        const wDur = Math.max(0.03, w.end - w.start);
        wordProgress = Math.max(0, Math.min(1, (t - w.start) / wDur));
        break;
      }
      if (t > w.end) {
        wordIndex = wi;
      }
    }

    return {
      lineIndex: activeLineIdx,
      line,
      nextLine: lines[activeLineIdx + 1] || null,
      wordIndex,
      word,
      wordProgress,
      lineProgress,
      inInstrumentalGap: line.vocalType === 'instrumental',
    };
  }

  // Between lines or before first line: preview upcoming line cleanly
  const upcomingIdx = activeLineIdx + 1;
  return {
    lineIndex: -1,
    line: null,
    nextLine: lines[upcomingIdx] || null,
    wordIndex: -1,
    word: null,
    wordProgress: 0,
    lineProgress: 0,
    inInstrumentalGap: upcomingIdx < lines.length && upcomingIdx > 0,
  };
}

export function formatTimecode(sec: number): string {
  const s = Math.max(0, Number.isFinite(sec) ? sec : 0);
  const mins = Math.floor(s / 60);
  const secs = Math.floor(s % 60);
  const ms = Math.floor((s - Math.floor(s)) * 100);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}

export function exportSyncedToLrc(lines: SyncedLine[], title = 'Alexura Track', artist = ''): string {
  const head = [`[ti:${title}]`, ...(artist ? [`[ar:${artist}]`] : []), '[by:Alexura Studio]'];
  const rows = lines.map((ln) => {
    const mins = Math.floor(ln.start / 60);
    const secs = (ln.start % 60).toFixed(2).padStart(5, '0');
    const enhancedWords = ln.words?.length
      ? ln.words
          .map((w) => {
            const wm = Math.floor(w.start / 60);
            const ws = (w.start % 60).toFixed(2).padStart(5, '0');
            return `<${String(wm).padStart(2, '0')}:${ws}>${w.text}`;
          })
          .join(' ')
      : ln.text;
    return `[${String(mins).padStart(2, '0')}:${secs}]${enhancedWords}`;
  });
  return [...head, ...rows].join('\n');
}

export function exportSyncedToVtt(lines: SyncedLine[]): string {
  const fmtVtt = (t: number) => {
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = Math.floor(t % 60);
    const ms = Math.round((t - Math.floor(t)) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  };
  const cues = lines.map((ln, idx) => `${idx + 1}\n${fmtVtt(ln.start)} --> ${fmtVtt(ln.end)}\n${ln.text}`);
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}
