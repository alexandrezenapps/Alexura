import React, { useEffect, useRef, useState } from 'react';
import { AudioLines, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatSeconds } from '@/services/playbackClock';

interface WaveformTimelinePlaceholderProps {
  audioUrl?: string | null;
  durationSeconds: number;
  currentTimeSeconds: number;
  onSeek: (seconds: number) => void;
  /** Phase 2 WaveSurfer.js integration callback receiving the mount element */
  onWaveSurferMountReady?: (container: HTMLDivElement | null) => void;
}

export const WaveformTimelinePlaceholder: React.FC<WaveformTimelinePlaceholderProps> = ({
  audioUrl,
  durationSeconds,
  currentTimeSeconds,
  onSeek,
  onWaveSurferMountReady,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [zoomFactor, setZoomFactor] = useState(1);

  useEffect(() => {
    onWaveSurferMountReady?.(containerRef.current);
    return () => {
      onWaveSurferMountReady?.(null);
    };
  }, [onWaveSurferMountReady]);

  const safeDur = Math.max(0, durationSeconds);
  const progressPct =
    safeDur > 0 ? Math.max(0, Math.min(100, (currentTimeSeconds / safeDur) * 100)) : 0;

  const handleClickTimeline = (e: React.MouseEvent<HTMLDivElement>) => {
    if (safeDur <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    onSeek(frac * safeDur);
  };

  return (
    <section
      aria-label="Waveform Timeline Container"
      className="rounded-xl border border-white/9 bg-[#111114] p-4"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
          <AudioLines className="h-4 w-4 text-sky-400" />
          <span className="font-semibold text-zinc-100">Waveform Timeline</span>
          <span className="text-zinc-500">·</span>
          <span className="text-[11px] text-zinc-400">
            WaveSurfer.js integration slot (Phase 2)
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setZoomFactor((z) => Math.max(1, z - 1))}
            disabled={zoomFactor <= 1}
            aria-label="Zoom out timeline"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <span className="axr-tc w-10 text-center text-[11px] text-zinc-400">
            {zoomFactor}x
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setZoomFactor((z) => Math.min(8, z + 1))}
            disabled={zoomFactor >= 8}
            aria-label="Zoom in timeline"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Dedicated WaveSurfer.js mount host + clean interactive scrub bar */}
      <div
        ref={containerRef}
        data-wavesurfer-container="true"
        data-audio-url={audioUrl || ''}
        data-zoom-factor={zoomFactor}
        onClick={handleClickTimeline}
        className="relative h-24 w-full overflow-hidden rounded-lg border border-white/8 bg-zinc-950 cursor-crosshair select-none"
      >
        {/* Center reference line & second grid markers */}
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-white/7" />
        <div className="pointer-events-none absolute inset-y-0 left-1/4 w-px bg-white/4" />
        <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-white/4" />
        <div className="pointer-events-none absolute inset-y-0 left-3/4 w-px bg-white/4" />

        {/* Playhead needle synchronized strictly to HTML Audio currentTime */}
        {safeDur > 0 && (
          <div
            className="pointer-events-none absolute inset-y-0 w-0.5 bg-sky-400"
            style={{ left: `${progressPct}%` }}
          />
        )}

        <div className="pointer-events-none relative z-10 flex h-full flex-col items-center justify-center px-4 text-center">
          <p className="text-xs font-medium text-zinc-300">
            {audioUrl
              ? 'Original audio bound · WaveSurfer.js peak canvas mounts here in Phase 2'
              : 'Drop an audio track to bind timeline and prepare WaveSurfer.js decoding'}
          </p>
          <p className="axr-tc mt-1 text-[11px] text-zinc-500">
            Origin 0.00s · Cursor {formatSeconds(safeDur > 0 ? currentTimeSeconds : 0)} /{' '}
            {formatSeconds(safeDur > 0 ? safeDur : null)}
          </p>
        </div>
      </div>
    </section>
  );
};
