import React from 'react';
import type { ActiveSyncFrame } from '../services/syncEngine';
import { formatTimecode } from '../services/syncEngine';

interface KaraokeStagePreviewProps {
  title: string;
  artist: string;
  currentTime: number;
  frame: ActiveSyncFrame;
  onSeek: (sec: number) => void;
}

export const KaraokeStagePreview: React.FC<KaraokeStagePreviewProps> = ({
  title,
  artist,
  currentTime,
  frame,
  onSeek,
}) => {
  const activeLine = frame.line;
  const nextLine = frame.nextLine;

  return (
    <section className="axr-karaoke-stage" aria-label="Prévisualisation Karaoké temps réel">
      <div className="axr-stage-top">
        <div>
          <span className="axr-stage-kicker">MOTEUR DE SYNCHRO TEMPS RÉEL · WEB AUDIO</span>
          <h4>{title || 'Aucune piste chargée'}</h4>
          {artist && <span className="axr-muted">{artist}</span>}
        </div>
        <div className="axr-tc">{formatTimecode(currentTime)}</div>
      </div>

      <div className="axr-stage-lyrics">
        {!activeLine && !nextLine && (
          <p className="axr-stage-empty">
            Lancez un job d’alignement ou sélectionnez une chanson dans la base de timestamps pour démarrer le karaoké synchronisé.
          </p>
        )}

        {activeLine && (
          <div className="axr-stage-current">
            {activeLine.words && activeLine.words.length > 0 ? (
              activeLine.words.map((w, wi) => {
                const isPast = wi < frame.wordIndex;
                const isCur = wi === frame.wordIndex;
                const pct = isPast ? 100 : isCur ? Math.round(frame.wordProgress * 100) : 0;
                return (
                  <button
                    key={`${activeLine.lineIndex}-${wi}`}
                    type="button"
                    onClick={() => onSeek(w.start)}
                    className={`axr-karaoke-word ${isCur ? 'is-current' : isPast ? 'is-past' : ''} ${
                      w.qualityTier === 'LOW' ? 'is-lowconf' : ''
                    }`}
                    title={`Aller à ${w.start.toFixed(2)}s · ${w.provenance} (${Math.round(w.alignmentConfidence * 100)}%)`}
                  >
                    <span className="axr-word-fill" style={{ width: `${pct}%` }} aria-hidden="true">
                      {w.text}
                    </span>
                    <span className="axr-word-base">{w.text}</span>
                  </button>
                );
              })
            ) : (
              <span className="axr-stage-inst">{activeLine.text}</span>
            )}
          </div>
        )}

        {nextLine && (
          <button
            type="button"
            className="axr-stage-next"
            onClick={() => onSeek(nextLine.start)}
            title={`Aller à la phrase suivante (${nextLine.start.toFixed(2)}s)`}
          >
            {nextLine.text}
          </button>
        )}
      </div>
    </section>
  );
};
