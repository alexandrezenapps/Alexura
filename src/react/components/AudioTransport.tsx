import React from 'react';
import { Pause, Play, Repeat, RotateCcw, RotateCw, Volume2 } from 'lucide-react';
import type { AudioTransportSnapshot } from '../services/audioEngine';
import { formatTimecode } from '../services/syncEngine';

interface AudioTransportProps {
  snapshot: AudioTransportSnapshot;
  offsetSec: number;
  onTogglePlay: () => void;
  onSeek: (sec: number) => void;
  onRateChange: (rate: number) => void;
  onVolumeChange: (vol: number) => void;
  onToggleLoop: () => void;
  onOffsetChange: (sec: number) => void;
}

export const AudioTransport: React.FC<AudioTransportProps> = ({
  snapshot,
  offsetSec,
  onTogglePlay,
  onSeek,
  onRateChange,
  onVolumeChange,
  onToggleLoop,
  onOffsetChange,
}) => {
  const dur = Math.max(0, snapshot.duration);
  const cur = Math.max(0, Math.min(dur || snapshot.currentTime, snapshot.currentTime));

  return (
    <div className="axr-transport">
      <div className="axr-transport-controls">
        <button
          type="button"
          className="axr-btn axr-btn-icon"
          onClick={() => onSeek(cur - 5)}
          disabled={!snapshot.ready}
          title="Reculer de 5 secondes"
          aria-label="Reculer de 5 secondes"
        >
          <RotateCcw size={15} />
          <span className="axr-mini-n">5s</span>
        </button>

        <button
          type="button"
          className="axr-btn axr-btn-primary axr-btn-play"
          onClick={onTogglePlay}
          disabled={!snapshot.ready}
          title={snapshot.playing ? 'Mettre en pause' : 'Lire l’audio'}
          aria-label={snapshot.playing ? 'Mettre en pause' : 'Lire'}
        >
          {snapshot.playing ? <Pause size={17} /> : <Play size={17} />}
          <span>{snapshot.playing ? 'Pause' : 'Lecture'}</span>
        </button>

        <button
          type="button"
          className="axr-btn axr-btn-icon"
          onClick={() => onSeek(cur + 5)}
          disabled={!snapshot.ready}
          title="Avancer de 5 secondes"
          aria-label="Avancer de 5 secondes"
        >
          <RotateCw size={15} />
          <span className="axr-mini-n">5s</span>
        </button>

        <button
          type="button"
          className={`axr-btn axr-btn-icon ${snapshot.loop ? 'is-active' : ''}`}
          onClick={onToggleLoop}
          disabled={!snapshot.ready}
          title="Boucle de lecture"
          aria-pressed={snapshot.loop}
        >
          <Repeat size={14} />
        </button>
      </div>

      <div className="axr-transport-scrubber">
        <span className="axr-tc">{formatTimecode(cur)}</span>
        <input
          type="range"
          min={0}
          max={Math.max(0.1, dur)}
          step={0.01}
          value={cur}
          disabled={!snapshot.ready}
          onChange={(e) => onSeek(Number(e.target.value))}
          aria-label="Position temporelle"
          className="axr-range-grow"
        />
        <span className="axr-tc axr-muted">{formatTimecode(dur)}</span>
      </div>

      <div className="axr-transport-meta">
        <label className="axr-ctrl-inline" title="Vitesse de lecture HTML5 Audio (hauteur préservée)">
          <span>Vitesse</span>
          <select
            value={String(snapshot.playbackRate)}
            onChange={(e) => onRateChange(Number(e.target.value))}
            disabled={!snapshot.ready}
          >
            <option value="0.75">0.75x</option>
            <option value="0.85">0.85x</option>
            <option value="1">1.00x</option>
            <option value="1.15">1.15x</option>
            <option value="1.25">1.25x</option>
            <option value="1.5">1.50x</option>
          </select>
        </label>

        <label className="axr-ctrl-inline" title="Calibration d’avance/retard du moteur de synchro">
          <span>Décalage</span>
          <select
            value={String(offsetSec)}
            onChange={(e) => onOffsetChange(Number(e.target.value))}
          >
            <option value="-0.25">-250ms</option>
            <option value="-0.1">-100ms</option>
            <option value="0">0ms</option>
            <option value="0.1">+100ms</option>
            <option value="0.25">+250ms</option>
          </select>
        </label>

        <label className="axr-ctrl-inline axr-vol-ctrl" title="Volume Web Audio GainNode">
          <Volume2 size={14} />
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={snapshot.volume}
            onChange={(e) => onVolumeChange(Number(e.target.value))}
            aria-label="Volume"
          />
        </label>

        <div className="axr-vu" title="Niveau Web Audio AnalyserNode en direct" aria-hidden="true">
          <div className="axr-vu-fill" style={{ width: `${Math.round(snapshot.rmsLevel * 100)}%` }} />
        </div>
      </div>
    </div>
  );
};
