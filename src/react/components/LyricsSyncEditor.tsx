import React, { useMemo, useState } from 'react';
import { CloudUpload, Download, Filter, Save, Send } from 'lucide-react';
import type { SongTimestampRecord, SyncedWord } from '../types/pipeline';
import { exportSyncedToLrc, exportSyncedToVtt } from '../services/syncEngine';

interface LyricsSyncEditorProps {
  song: SongTimestampRecord | null;
  activeLineIndex: number;
  activeWordIndex: number;
  savingDb: boolean;
  savingCloud: boolean;
  onSeek: (sec: number) => void;
  onNudgeWord: (lineIndex: number, wordIndex: number, field: 'start' | 'end', deltaSec: number) => void;
  onSaveToDatabase: () => void;
  onPushToMainCanvas: () => void;
  onSyncToFirestore: () => void;
}

function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const LyricsSyncEditor: React.FC<LyricsSyncEditorProps> = ({
  song,
  activeLineIndex,
  activeWordIndex,
  savingDb,
  savingCloud,
  onSeek,
  onNudgeWord,
  onSaveToDatabase,
  onPushToMainCanvas,
  onSyncToFirestore,
}) => {
  const [onlyUncertain, setOnlyUncertain] = useState(false);

  const visibleRows = useMemo(() => {
    if (!song) return [];
    const rows: Array<{ lineIdx: number; wordIdx: number; lineText: string; word: SyncedWord }> = [];
    song.lines.forEach((ln, lIdx) => {
      (ln.words || []).forEach((w, wIdx) => {
        if (onlyUncertain && w.qualityTier !== 'LOW' && w.flags.length === 0) return;
        rows.push({ lineIdx: lIdx, wordIdx: wIdx, lineText: ln.text, word: w });
      });
    });
    return rows;
  }, [song, onlyUncertain]);

  if (!song) {
    return (
      <section className="axr-panel">
        <h3>Base de timestamps structurée &amp; Éditeur de précision</h3>
        <p className="axr-muted">
          Aucun document temporel chargé. Lancez un traitement ou sélectionnez une chanson existante pour inspecter les timestamps par mot et leur provenance.
        </p>
      </section>
    );
  }

  const slug = (song.title || 'alexura').replace(/[^a-zA-Z0-9_-]+/g, '_');

  return (
    <section className="axr-panel">
      <div className="axr-panel-head">
        <div>
          <h3>Base de timestamps structurée · {song.title}</h3>
          <p className="axr-muted">
            {song.lines.length} lignes · {song.validationSummary?.totalWords || 0} mots ·{' '}
            {song.validationSummary?.highConfidenceWords || 0} fiables ·{' '}
            {song.validationSummary?.lowConfidenceWords || 0} à vérifier
          </p>
        </div>

        <div className="axr-actions-row">
          <button
            type="button"
            className={`axr-btn ${onlyUncertain ? 'is-active' : ''}`}
            onClick={() => setOnlyUncertain((v) => !v)}
          >
            <Filter size={14} />
            <span>{onlyUncertain ? 'Afficher tous' : 'Mots incertains'}</span>
          </button>

          <button
            type="button"
            className="axr-btn"
            onClick={() => downloadTextFile(`${slug}.lrc`, exportSyncedToLrc(song.lines, song.title, song.artist), 'text/plain;charset=utf-8')}
          >
            <Download size={14} />
            <span>LRC</span>
          </button>

          <button
            type="button"
            className="axr-btn"
            onClick={() => downloadTextFile(`${slug}.vtt`, exportSyncedToVtt(song.lines), 'text/vtt;charset=utf-8')}
          >
            <Download size={14} />
            <span>WebVTT</span>
          </button>

          <button type="button" className="axr-btn" onClick={onSaveToDatabase} disabled={savingDb}>
            <Save size={14} />
            <span>{savingDb ? 'Sauvegarde…' : 'Sauver SQLite'}</span>
          </button>

          <button type="button" className="axr-btn" onClick={onSyncToFirestore} disabled={savingCloud}>
            <CloudUpload size={14} />
            <span>{savingCloud ? 'Cloud…' : 'Firebase Timestamps'}</span>
          </button>

          <button type="button" className="axr-btn axr-btn-primary" onClick={onPushToMainCanvas}>
            <Send size={14} />
            <span>Appliquer à Alexura Studio</span>
          </button>
        </div>
      </div>

      <div className="axr-table-scroll">
        <table className="axr-ts-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Mot / Token</th>
              <th>Début (s)</th>
              <th>Fin (s)</th>
              <th>Confiance</th>
              <th>Provenance</th>
              <th>Calibrage</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(({ lineIdx, wordIdx, word }) => {
              const isPlayingWord = lineIdx === activeLineIndex && wordIdx === activeWordIndex;
              return (
                <tr key={`${lineIdx}-${wordIdx}`} className={isPlayingWord ? 'is-playing' : ''}>
                  <td className="axr-tc axr-muted">
                    L{lineIdx + 1}.{wordIdx + 1}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="axr-word-link"
                      onClick={() => onSeek(word.start)}
                      title="Écouter ce mot"
                    >
                      {word.text}
                    </button>
                  </td>
                  <td className="axr-tc">{word.start.toFixed(3)}</td>
                  <td className="axr-tc">{word.end.toFixed(3)}</td>
                  <td>
                    <span className={`axr-tier axr-tier-${word.qualityTier.toLowerCase()}`}>
                      {word.qualityTier} · {Math.round(word.alignmentConfidence * 100)}%
                    </span>
                  </td>
                  <td className="axr-prov">{word.provenance}</td>
                  <td>
                    <div className="axr-nudge-group">
                      <button
                        type="button"
                        className="axr-mini-btn"
                        onClick={() => onNudgeWord(lineIdx, wordIdx, 'start', -0.05)}
                        title="Début -50ms"
                      >
                        D-50ms
                      </button>
                      <button
                        type="button"
                        className="axr-mini-btn"
                        onClick={() => onNudgeWord(lineIdx, wordIdx, 'start', 0.05)}
                        title="Début +50ms"
                      >
                        D+50ms
                      </button>
                      <button
                        type="button"
                        className="axr-mini-btn"
                        onClick={() => onNudgeWord(lineIdx, wordIdx, 'end', -0.05)}
                        title="Fin -50ms"
                      >
                        F-50ms
                      </button>
                      <button
                        type="button"
                        className="axr-mini-btn"
                        onClick={() => onNudgeWord(lineIdx, wordIdx, 'end', 0.05)}
                        title="Fin +50ms"
                      >
                        F+50ms
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={7} className="axr-empty-cell">
                  Aucun mot ne correspond au filtre actif.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};
