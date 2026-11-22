import React, { useEffect, useRef } from 'react';
import type { SyncedLine, TimeSpan, WaveformPeak } from '../types/pipeline';

interface WaveformCanvasProps {
  peaks: WaveformPeak[];
  vocalSegments: TimeSpan[];
  lines: SyncedLine[];
  durationSec: number;
  currentTime: number;
  spectrumBins: number[];
  onSeek: (sec: number) => void;
}

export const WaveformCanvas: React.FC<WaveformCanvasProps> = ({
  peaks,
  vocalSegments,
  lines,
  durationSec,
  currentTime,
  spectrumBins,
  onSeek,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = canvas.clientWidth || 720;
    const height = canvas.clientHeight || 128;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.scale(dpr, dpr);

    // Background studio slate
    ctx.fillStyle = '#090b10';
    ctx.fillRect(0, 0, width, height);

    // Subtle horizontal gridlines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (const frac of [0.25, 0.5, 0.75]) {
      const y = Math.round(height * frac) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const safeDur = Math.max(0.1, durationSec || 1);

    // Vocal segment acoustic spans
    ctx.fillStyle = 'rgba(10, 132, 255, 0.08)';
    for (const seg of vocalSegments) {
      const x0 = (seg.start / safeDur) * width;
      const x1 = (seg.end / safeDur) * width;
      if (x1 > x0) {
        ctx.fillRect(x0, 0, Math.max(1.5, x1 - x0), height);
      }
    }

    // Lyric line boundary ticks at bottom edge
    for (const ln of lines) {
      const x = (ln.start / safeDur) * width;
      const hasUncertain = ln.words?.some((w) => w.qualityTier === 'LOW');
      ctx.fillStyle = hasUncertain ? 'rgba(245, 158, 11, 0.78)' : 'rgba(214, 180, 106, 0.55)';
      ctx.fillRect(x, height - 6, 2, 6);
    }

    // Live subtle FFT spectrum underlay behind waveform when playing
    if (spectrumBins.length > 0) {
      const barW = width / spectrumBins.length;
      ctx.fillStyle = 'rgba(56, 189, 248, 0.09)';
      spectrumBins.forEach((v, i) => {
        const bh = v * height * 0.42;
        ctx.fillRect(i * barW, height - bh, Math.max(1, barW - 2), bh);
      });
    }

    // Waveform peaks
    const midY = height * 0.5;
    const maxAmp = height * 0.42;
    const progressRatio = Math.max(0, Math.min(1, currentTime / safeDur));
    const count = peaks.length;

    if (count > 0) {
      const barStep = width / count;
      const barW = Math.max(1.2, barStep * 0.72);
      for (let i = 0; i < count; i++) {
        const p = peaks[i];
        const x = i * barStep;
        const played = i / count <= progressRatio;
        const amp = Math.max(0.025, Math.min(1, Math.max(Math.abs(p.min), Math.abs(p.max))));
        const hTop = amp * maxAmp;
        ctx.fillStyle = played ? '#38bdf8' : 'rgba(226, 232, 240, 0.28)';
        ctx.fillRect(x, midY - hTop, barW, hTop * 2);

        const rmsH = Math.min(maxAmp, p.rms * maxAmp * 1.15);
        ctx.fillStyle = played ? '#0a84ff' : 'rgba(214, 180, 106, 0.34)';
        ctx.fillRect(x, midY - rmsH, barW, rmsH * 2);
      }
    } else {
      ctx.fillStyle = 'rgba(148, 163, 184, 0.45)';
      ctx.font = '12px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Chargez un fichier audio pour afficher la forme d’onde acoustique', width / 2, midY + 4);
    }

    // Playhead needle
    if (durationSec > 0) {
      const px = Math.max(0, Math.min(width - 1, progressRatio * width));
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
      ctx.stroke();

      ctx.fillStyle = '#0a84ff';
      ctx.beginPath();
      ctx.arc(px, 7, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }, [peaks, vocalSegments, lines, durationSec, currentTime, spectrumBins]);

  const handlePointerSeek = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || durationSec <= 0) return;
    const rect = canvas.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (ev.clientX - rect.left) / Math.max(1, rect.width)));
    onSeek(frac * durationSec);
  };

  return (
    <div className="axr-wave-wrap">
      <canvas
        ref={canvasRef}
        onClick={handlePointerSeek}
        className="axr-wave-canvas"
        aria-label="Forme d'onde interactive — cliquez pour naviguer dans le morceau"
      />
    </div>
  );
};
