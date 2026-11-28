import React, { useEffect, useRef, useState } from 'react';
import { AudioLines, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatSeconds } from '@/services/playbackClock';
import type { AnalysisSegmentMapping, LyricSegment } from '@/types/lyrics';

export interface WaveformTimelineProps {
  audioUrl?: string | null;
  durationSeconds: number;
  currentTimeSeconds: number;
  peaks?: number[];
  segments?: LyricSegment[];
  segmentMappings?: AnalysisSegmentMapping[];
  onSeek: (seconds: number) => void;
  onWaveSurferMountReady?: (container: HTMLDivElement | null) => void;
}

export const WaveformTimeline: React.FC<WaveformTimelineProps> = ({
  audioUrl,
  durationSeconds,
  currentTimeSeconds,
  peaks = [],
  segments = [],
  segmentMappings = [],
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
      className="rounded-xl border border-slate-200/10 bg-gradient-to-b from-[#101521]/95 to-[#0b0f18]/98 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_28px_-14px_rgba(0,0,0,0.65)]"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
          <AudioLines className="h-4 w-4 text-sky-400" />
          <span className="font-semibold text-slate-100">Waveform Timeline</span>
          <span className="text-slate-600">·</span>
          <span className="text-[11px] text-slate-400">
            WaveSurfer.js Phase 2 integration slot · Original coordinate frame (0.000s)
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setZoomFactor((z) => Math.max(1, z - 1))}
            disabled={zoomFactor <= 1}
            aria-label="Zoom out timeline"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <span className="axr-tc w-10 text-center text-[11px] text-slate-300">
            {zoomFactor}x
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setZoomFactor((z) => Math.min(8, z + 1))}
            disabled={zoomFactor >= 8}
            aria-label="Zoom in timeline"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="w-full overflow-x-auto rounded-lg border border-slate-200/10 bg-[#070a11] shadow-[inset_0_2px_8px_rgba(0,0,0,0.6)]">
        <div
          ref={containerRef}
          data-wavesurfer-container="true"
          data-audio-url={audioUrl || ''}
          data-zoom-factor={zoomFactor}
          onClick={handleClickTimeline}
          style={{ width: zoomFactor > 1 ? `${zoomFactor * 100}%` : '100%' }}
          className="relative h-24 overflow-hidden cursor-crosshair select-none"
        >
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-sky-400/12" />
          <div className="pointer-events-none absolute inset-y-0 left-1/4 w-px bg-slate-200/5" />
          <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-slate-200/5" />
          <div className="pointer-events-none absolute inset-y-0 left-3/4 w-px bg-slate-200/5" />

          {peaks.length > 0 && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-1 inset-y-2 flex items-center gap-[2px]"
            >
              {peaks.map((amp, i) => {
                const barPct = Math.max(6, Math.min(100, Math.round(amp * 100)));
                const barPosPct = ((i + 0.5) / peaks.length) * 100;
                const played = safeDur > 0 && barPosPct <= progressPct;
                return (
                  <div
                    key={i}
                    className={`flex-1 rounded-full transition-colors duration-75 ${
                      played ? 'bg-sky-400/65' : 'bg-slate-400/25'
                    }`}
                    style={{ height: `${barPct}%` }}
                  />
                );
              })}
            </div>
          )}

          {safeDur > 0 &&
            segments.map((seg) => {
              if (seg.startSeconds === null || seg.endSeconds === null) return null;
              const left = Math.max(0, Math.min(100, (seg.startSeconds / safeDur) * 100));
              const width = Math.max(
                0.4,
                Math.min(100 - left, ((seg.endSeconds - seg.startSeconds) / safeDur) * 100),
              );
              return (
                <div
                  key={seg.segmentId}
                  title={`${seg.segmentId}: ${seg.startSeconds.toFixed(2)}s - ${seg.endSeconds.toFixed(2)}s`}
                  className="pointer-events-none absolute bottom-1 top-1 rounded-sm border border-sky-400/20 bg-sky-500/10"
                  style={{ left: `${left}%`, width: `${width}%` }}
                />
              );
            })}

          {safeDur > 0 &&
            segmentMappings.map((map) => {
              const left = Math.max(0, Math.min(100, (map.original_start / safeDur) * 100));
              const width = Math.max(
                0.4,
                Math.min(100 - left, ((map.original_end - map.original_start) / safeDur) * 100),
              );
              return (
                <div
                  key={map.analysis_segment_id}
                  title={`${map.analysis_segment_id}: analysis [${map.analysis_start}s-${map.analysis_end}s] -> original [${map.original_start}s-${map.original_end}s]`}
                  className="pointer-events-none absolute bottom-0 h-1.5 bg-[#e8c97a]/70"
                  style={{ left: `${left}%`, width: `${width}%` }}
                />
              );
            })}

          {safeDur > 0 && (
            <div
              className="pointer-events-none absolute inset-y-0 w-0.5 bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.65)]"
              style={{ left: `${progressPct}%` }}
            />
          )}

          <div className="pointer-events-none relative z-10 flex h-full flex-col items-center justify-center px-4 text-center">
            <p className="rounded bg-[#070a11]/75 px-2 py-0.5 text-xs font-medium text-slate-200 backdrop-blur-[2px]">
              {audioUrl
                ? peaks.length > 0
                  ? 'Original audio & waveform envelope bound · Timeline markers reflect original seconds'
                  : 'Original audio bound · Timeline markers reflect original seconds'
                : 'Drop an audio track to bind timeline and inspect segment mapping'}
            </p>
            <p className="axr-tc mt-1 rounded bg-[#070a11]/75 px-2 py-0.5 text-[11px] text-slate-400">
              Origin 0.00s · Cursor {formatSeconds(safeDur > 0 ? currentTimeSeconds : 0)} /{' '}
              {formatSeconds(safeDur > 0 ? safeDur : null)}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};
