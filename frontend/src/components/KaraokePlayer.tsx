import React from 'react';
import { AudioPlayer } from '@/components/AudioPlayer';
import { useLyricsSync } from '@/hooks/useLyricsSync';
import type { PlaybackSnapshot } from '@/services/playbackClock';
import type { LyricsDocument } from '@/types/lyrics';

export interface KaraokePlayerProps {
  snapshot: PlaybackSnapshot;
  document: LyricsDocument | null;
  title: string;
  artist: string;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onRateChange: (rate: number) => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onToggleLoop: () => void;
}

export const KaraokePlayer: React.FC<KaraokePlayerProps> = ({
  snapshot,
  document,
  title,
  artist,
  onTogglePlay,
  onSeek,
  onRateChange,
  onVolumeChange,
  onToggleMute,
  onToggleLoop,
}) => {
  const sync = useLyricsSync(document, snapshot.currentTime);

  return (
    <div className="space-y-2.5">
      <AudioPlayer
        snapshot={snapshot}
        title={title}
        artist={artist}
        onTogglePlay={onTogglePlay}
        onSeek={onSeek}
        onRateChange={onRateChange}
        onVolumeChange={onVolumeChange}
        onToggleMute={onToggleMute}
        onToggleLoop={onToggleLoop}
      />

      {sync.activeSegment && (
        <div
          aria-live="polite"
          className="rounded-xl border border-slate-200/10 bg-[#080b12]/90 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex flex-wrap items-baseline gap-1.5 text-sm font-medium text-slate-100">
            {sync.activeSegment.words.length > 0 ? (
              sync.activeSegment.words.map((word, wIdx) => {
                const isWordActive = wIdx === sync.activeWordIndex;
                const needsReview = Boolean(word.reviewRequired);
                const canSeekWord = word.startSeconds !== null;
                return (
                  <button
                    key={word.wordId}
                    type="button"
                    disabled={!canSeekWord}
                    onClick={() => {
                      if (word.startSeconds !== null) onSeek(word.startSeconds);
                    }}
                    title={
                      word.startSeconds !== null && word.endSeconds !== null
                        ? `${word.wordId}: ${word.startSeconds.toFixed(3)}s → ${word.endSeconds.toFixed(3)}s`
                        : word.wordId
                    }
                    className={[
                      'rounded px-1.5 py-0.5 transition-colors duration-150',
                      canSeekWord ? 'cursor-pointer hover:bg-sky-500/12' : 'cursor-default',
                      isWordActive
                        ? 'bg-sky-500/18 text-sky-300 font-semibold'
                        : needsReview
                          ? 'text-amber-200 underline decoration-amber-400/70 decoration-dotted underline-offset-4'
                          : 'text-slate-300',
                    ].join(' ')}
                  >
                    {word.text}
                  </button>
                );
              })
            ) : (
              <span>{sync.activeSegment.text}</span>
            )}
          </div>
          <span className="axr-tc tabular-nums text-[11px] text-slate-400">
            {sync.activeSegment.segmentId}
            {sync.activeWord
              ? ` · ${sync.activeWord.text}${
                  sync.activeWord.startSeconds !== null && sync.activeWord.endSeconds !== null
                    ? ` (${sync.activeWord.startSeconds.toFixed(3)}s–${sync.activeWord.endSeconds.toFixed(3)}s)`
                    : ''
                }${
                  sync.activeWordConfidence !== null
                    ? ` · ${Math.round(sync.activeWordConfidence * 100)}%`
                    : ''
                }`
              : ''}
          </span>
        </div>
      )}
    </div>
  );
};
