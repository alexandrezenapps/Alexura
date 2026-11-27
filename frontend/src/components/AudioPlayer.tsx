import React from 'react';
import {
  Pause,
  Play,
  Repeat,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { formatSeconds, type PlaybackSnapshot } from '@/services/playbackClock';

interface AudioPlayerProps {
  snapshot: PlaybackSnapshot;
  title: string;
  artist: string;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onRateChange: (rate: number) => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onToggleLoop: () => void;
}

const SPEED_OPTIONS = [0.75, 0.85, 1, 1.15, 1.25, 1.5];

export const AudioPlayer: React.FC<AudioPlayerProps> = ({
  snapshot,
  title,
  artist,
  onTogglePlay,
  onSeek,
  onRateChange,
  onVolumeChange,
  onToggleMute,
  onToggleLoop,
}) => {
  const duration = Math.max(0, snapshot.duration);
  const currentTime = Math.max(0, Math.min(duration || snapshot.currentTime, snapshot.currentTime));

  return (
    <section
      aria-label="Audio Playback Transport"
      className="rounded-xl border border-slate-200/10 bg-gradient-to-b from-[#101521]/95 to-[#0b0f18]/98 px-4 py-3.5 sm:px-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_28px_-14px_rgba(0,0,0,0.65)]"
    >
      <div className="flex flex-col gap-3.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-50">
            {title || snapshot.sourceLabel || 'No Audio Loaded'}
          </div>
          <div className="truncate text-[11px] text-slate-400">
            {artist || (snapshot.ready ? 'Original Audio Timeline · HTML5 Audio API' : 'Upload or select a track to activate transport')}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!snapshot.ready}
            onClick={() => onSeek(currentTime - 5)}
            aria-label="Seek back 5 seconds"
          >
            <RotateCcw className="h-3.5 w-3.5 text-sky-300" />
            <span className="axr-tc">-5s</span>
          </Button>

          <Button
            type="button"
            variant="default"
            size="default"
            disabled={!snapshot.ready}
            onClick={onTogglePlay}
            aria-label={snapshot.playing ? 'Pause' : 'Play'}
            className="min-w-[96px]"
          >
            {snapshot.playing ? (
              <>
                <Pause className="h-4 w-4 fill-current" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="h-4 w-4 fill-current" />
                <span>Play</span>
              </>
            )}
          </Button>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!snapshot.ready}
            onClick={() => onSeek(currentTime + 5)}
            aria-label="Seek forward 5 seconds"
          >
            <RotateCw className="h-3.5 w-3.5 text-sky-300" />
            <span className="axr-tc">+5s</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={!snapshot.ready}
            onClick={onToggleLoop}
            aria-pressed={snapshot.loop}
            aria-label="Toggle loop"
            className={cn(
              snapshot.loop &&
                'border-sky-400/55 bg-gradient-to-b from-sky-500/24 to-sky-500/12 text-sky-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]',
            )}
          >
            <Repeat className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <span>Speed</span>
            <select
              value={String(snapshot.playbackRate)}
              disabled={!snapshot.ready}
              onChange={(e) => onRateChange(Number(e.target.value))}
              className="axr-tc h-8 rounded-md border border-slate-200/12 bg-[#080b12] px-2 text-[11px] text-slate-100 hover:border-slate-200/24 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70"
            >
              {SPEED_OPTIONS.map((rate) => (
                <option key={rate} value={String(rate)}>
                  {rate.toFixed(2)}x
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-2 min-w-[132px]">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={onToggleMute}
              aria-label={snapshot.muted ? 'Unmute' : 'Mute'}
              className="h-8 w-8"
            >
              {snapshot.muted || snapshot.volume === 0 ? (
                <VolumeX className="h-3.5 w-3.5 text-amber-300" />
              ) : (
                <Volume2 className="h-3.5 w-3.5 text-sky-300" />
              )}
            </Button>
            <Slider
              value={[snapshot.muted ? 0 : Math.round(snapshot.volume * 100)]}
              min={0}
              max={100}
              step={1}
              onValueChange={(vals) => onVolumeChange((vals[0] ?? 100) / 100)}
              aria-label="Playback Volume"
              className="w-24"
            />
          </div>
        </div>
      </div>

      <div className="mt-3.5 flex items-center gap-3">
        <span className="axr-tc w-16 text-[11px] font-medium text-slate-200">
          {formatSeconds(snapshot.ready ? currentTime : 0)}
        </span>
        <Slider
          value={[currentTime]}
          min={0}
          max={Math.max(0.1, duration)}
          step={0.01}
          disabled={!snapshot.ready}
          onValueChange={(vals) => onSeek(vals[0] ?? 0)}
          aria-label="Audio Seek Scrub Bar"
          className="flex-1"
        />
        <span className="axr-tc w-16 text-right text-[11px] text-slate-500">
          {formatSeconds(duration > 0 ? duration : null)}
        </span>
      </div>
    </section>
  );
};
