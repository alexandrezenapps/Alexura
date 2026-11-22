import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  FileAudio,
  Loader2,
  Minimize2,
  RotateCcw,
  Server,
  ShieldCheck,
  Upload,
  Zap,
} from 'lucide-react';
import type {
  PipelineCapabilities,
  PipelineJobRecord,
  UploadProgressInfo,
  UploadRecord,
} from '../types/pipeline';

interface PipelineWorkbenchProps {
  capabilities: PipelineCapabilities | null;
  upload: UploadRecord | null;
  job: PipelineJobRecord | null;
  recentJobs: PipelineJobRecord[];
  title: string;
  artist: string;
  lang: string;
  lyricsInput: string;
  enableSeparation: boolean;
  useGeminiAsr: boolean;
  bypassCache: boolean;
  uploading: boolean;
  retrying: boolean;
  standalone?: boolean;
  uploadProgress: UploadProgressInfo | null;
  errorMsg: string | null;
  onTitleChange: (v: string) => void;
  onArtistChange: (v: string) => void;
  onLangChange: (v: string) => void;
  onLyricsInputChange: (v: string) => void;
  onToggleSeparation: (v: boolean) => void;
  onToggleGeminiAsr: (v: boolean) => void;
  onToggleBypassCache: (v: boolean) => void;
  onUploadFile: (file: File) => void;
  onLaunchJob: () => void;
  onRetryJob: (jobId: string) => void;
  onImportFromMainStudio: () => void;
  onMinimizeBackground?: () => void;
}

const STAGE_LABELS: Record<string, string> = {
  queued: 'En file d’attente asynchrone',
  validating_audio: 'Validation & cache d’analyse',
  separating_vocals: 'Extraction / séparation vocale isolée',
  transcribing_lyrics: 'Reconnaissance vocale & paroles',
  aligning_timestamps: 'Alignement temporel mot par mot',
  validating_confidence: 'Calibration de confiance acoustique',
  persisting: 'Enregistrement base structurée SQLite',
  completed: 'Pipeline terminé',
  error: 'Échec du traitement',
};

function formatMb(bytes: number): string {
  return (Math.max(0, bytes) / (1024 * 1024)).toFixed(1);
}

export const PipelineWorkbench: React.FC<PipelineWorkbenchProps> = ({
  capabilities,
  upload,
  job,
  recentJobs,
  title,
  artist,
  lang,
  lyricsInput,
  enableSeparation,
  useGeminiAsr,
  bypassCache,
  uploading,
  retrying,
  standalone,
  uploadProgress,
  errorMsg,
  onTitleChange,
  onArtistChange,
  onLangChange,
  onLyricsInputChange,
  onToggleSeparation,
  onToggleGeminiAsr,
  onToggleBypassCache,
  onUploadFile,
  onLaunchJob,
  onRetryJob,
  onImportFromMainStudio,
  onMinimizeBackground,
}) => {
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onUploadFile(f);
  };

  const isRunning = job && (job.status === 'queued' || job.status === 'running');
  const maxMb = capabilities?.maxUploadBytes
    ? Math.round(capabilities.maxUploadBytes / (1024 * 1024))
    : 250;

  return (
    <div className="axr-workbench-grid">
      <section className="axr-panel">
        <div className="axr-panel-head">
          <div>
            <h3>1. Import audio sécurisé &amp; File asynchrone</h3>
            <p className="axr-muted">
              Transfert par blocs &amp; flux sécurisé (WAV, MP3, M4A, FLAC, OGG, WEBM · max{' '}
              {maxMb} Mo) préservant l’audio original.
            </p>
          </div>
          <button type="button" className="axr-btn" onClick={onImportFromMainStudio}>
            Importer du studio principal
          </button>
        </div>

        <label
          className={`axr-dropzone ${dragOver ? 'is-drag' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <input
            type="file"
            accept=".wav,.mp3,.m4a,.aac,.flac,.ogg,.webm,audio/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUploadFile(f);
            }}
            hidden
          />
          {uploading ? <Loader2 size={22} className="axr-spin" /> : <Upload size={22} />}
          <div>
            <strong>
              {uploading
                ? uploadProgress?.phase === 'probing'
                  ? 'Analyse FFmpeg & extraction de forme d’onde en cours…'
                  : `Envoi sécurisé en cours (${uploadProgress?.percent ?? 0}%)…`
                : 'Déposez un morceau (court ou complet) ou cliquez pour importer'}
            </strong>
            <span>
              Original intact garanti · Déduplication SHA-256 · Streaming HTTP Range pour Web Audio API
            </span>
          </div>
        </label>

        {uploading && uploadProgress && (
          <div className="axr-upload-prog">
            <div className="axr-job-top">
              <span className="axr-muted">
                {uploadProgress.phase === 'probing'
                  ? 'Vérification binaire & profil acoustique 100 Hz'
                  : `${formatMb(uploadProgress.loadedBytes)} / ${formatMb(uploadProgress.totalBytes)} Mo transférés`}
              </span>
              <span className="axr-tc">{uploadProgress.percent}%</span>
            </div>
            <div className="axr-progress-track">
              <div className="axr-progress-fill" style={{ width: `${uploadProgress.percent}%` }} />
            </div>
          </div>
        )}

        {upload && (
          <div className="axr-upload-summary">
            <FileAudio size={16} />
            <span className="axr-file-name">{upload.filename}</span>
            <span className="axr-status is-ok axr-badge-inline" title="Fichier original jamais altéré">
              <ShieldCheck size={12} /> Original intact
            </span>
            {upload.deduplicated && (
              <span className="axr-status is-neutral" title="Déjà stocké à l’identique (SHA-256)">
                Dédupliqué
              </span>
            )}
            <span className="axr-tc">{upload.durationSec.toFixed(2)}s</span>
            <span className="axr-tc axr-muted">{upload.sampleRate} Hz</span>
            <span className="axr-tc axr-muted">
              {(upload.byteSize / (1024 * 1024)).toFixed(2)} Mo
            </span>
          </div>
        )}

        <div className="axr-form-grid">
          <label className="axr-field">
            <span>Titre du morceau</span>
            <input
              type="text"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder="Titre"
            />
          </label>
          <label className="axr-field">
            <span>Artiste</span>
            <input
              type="text"
              value={artist}
              onChange={(e) => onArtistChange(e.target.value)}
              placeholder="Artiste"
            />
          </label>
          <label className="axr-field">
            <span>Langue cible / indice</span>
            <select value={lang} onChange={(e) => onLangChange(e.target.value)}>
              <option value="auto">Détection automatique / Multilingue</option>
              <option value="fr">Français</option>
              <option value="en">English</option>
              <option value="zh-Hans">中文 (简体)</option>
              <option value="zh-Hant">中文 (繁體)</option>
              <option value="ja">日本語</option>
              <option value="ko">한국어</option>
              <option value="es">Español</option>
            </select>
          </label>
        </div>

        <label className="axr-field">
          <span>
            Paroles de référence (optionnel — si fourni, alignement forcé direct sur ces paroles)
          </span>
          <textarea
            rows={4}
            value={lyricsInput}
            onChange={(e) => onLyricsInputChange(e.target.value)}
            placeholder="Collez vos paroles ici pour un alignement acoustique rapide, ou laissez vide pour la transcription Gemini + alignement."
          />
        </label>

        <div className="axr-toggles">
          <label className="axr-chk">
            <input
              type="checkbox"
              checked={enableSeparation}
              onChange={(e) => onToggleSeparation(e.target.checked)}
            />
            <span>Pré-isolation vocale (dossier temp isolé)</span>
          </label>
          <label className="axr-chk">
            <input
              type="checkbox"
              checked={useGeminiAsr}
              onChange={(e) => onToggleGeminiAsr(e.target.checked)}
            />
            <span>Transcription Gemini (fenêtres automatiques sur longs titres)</span>
          </label>
          <label className="axr-chk">
            <input
              type="checkbox"
              checked={bypassCache}
              onChange={(e) => onToggleBypassCache(e.target.checked)}
            />
            <span>Ignorer le cache d’analyse (forcer recalcul)</span>
          </label>
        </div>

        <div className="axr-actions-row">
          <button
            type="button"
            className="axr-btn axr-btn-primary"
            disabled={!upload || Boolean(isRunning) || uploading}
            onClick={onLaunchJob}
          >
            {isRunning ? <Loader2 size={15} className="axr-spin" /> : <Activity size={15} />}
            <span>
              {isRunning ? 'Traitement en arrière-plan…' : 'Lancer le job asynchrone'}
            </span>
          </button>

          {!standalone && isRunning && onMinimizeBackground && (
            <button type="button" className="axr-btn" onClick={onMinimizeBackground}>
              <Minimize2 size={14} />
              <span>Continuer en arrière-plan</span>
            </button>
          )}
        </div>

        {errorMsg && (
          <div className="axr-alert axr-alert-error" role="alert">
            <AlertTriangle size={15} />
            <span>{errorMsg}</span>
          </div>
        )}

        {job && (
          <div className="axr-job-box">
            <div className="axr-job-top">
              <div className="axr-job-meta">
                <strong>{STAGE_LABELS[job.stage] || job.stage}</strong>
                {job.cachedHit && (
                  <span className="axr-status is-ok axr-badge-inline">
                    <Zap size={11} /> Cache instantané
                  </span>
                )}
                {Number(job.retryCount || 0) > 0 && (
                  <span className="axr-status is-warn">
                    Relances : {job.retryCount}
                  </span>
                )}
                {job.windowProgress && (
                  <span className="axr-status is-neutral axr-tc">
                    Fenêtre {job.windowProgress.current}/{job.windowProgress.total}
                  </span>
                )}
              </div>
              <span className="axr-tc">{job.progress}%</span>
            </div>
            <div className="axr-progress-track">
              <div
                className={`axr-progress-fill ${job.status === 'failed' ? 'is-err' : ''}`}
                style={{ width: `${job.progress}%` }}
              />
            </div>
            {job.stageDetail && <div className="axr-muted">{job.stageDetail}</div>}
            {job.error && (
              <div className="axr-job-err-row">
                <p className="axr-job-err">{job.error}</p>
                {job.status === 'failed' && (
                  <button
                    type="button"
                    className="axr-btn"
                    disabled={retrying}
                    onClick={() => onRetryJob(job.id)}
                  >
                    <RotateCcw size={13} className={retrying ? 'axr-spin' : ''} />
                    <span>Réessayer ce job</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {recentJobs.length > 0 && (
          <div className="axr-recent-jobs">
            <div className="axr-recent-head">File récente des traitements en arrière-plan</div>
            <div className="axr-recent-list">
              {recentJobs.slice(0, 4).map((rj) => (
                <div key={rj.id} className="axr-recent-item">
                  <span className="axr-tc">{rj.id.slice(0, 12)}</span>
                  <span className="axr-muted">{STAGE_LABELS[rj.stage] || rj.stage}</span>
                  <span
                    className={`axr-status ${
                      rj.status === 'completed'
                        ? 'is-ok'
                        : rj.status === 'failed'
                          ? 'is-warn'
                          : 'is-neutral'
                    }`}
                  >
                    {rj.status === 'completed'
                      ? rj.cachedHit
                        ? 'cache 100%'
                        : '100%'
                      : rj.status === 'failed'
                        ? 'échec'
                        : `${rj.progress}%`}
                  </span>
                  {rj.status === 'failed' && (
                    <button
                      type="button"
                      className="axr-mini-btn"
                      disabled={retrying}
                      onClick={() => onRetryJob(rj.id)}
                    >
                      Relancer
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="axr-panel">
        <div className="axr-panel-head">
          <div>
            <h3>2. Architecture IA, Cache &amp; Scalabilité</h3>
            <p className="axr-muted">
              Workers bornés non bloquants, stockage temporaire isolé (0700 + purge TTL) et aucune altération de l’audio original.
            </p>
          </div>
          <Server size={18} className="axr-muted" />
        </div>

        {!capabilities ? (
          <div className="axr-muted">Chargement des capacités backend…</div>
        ) : (
          <div className="axr-cap-list">
            <div className="axr-cap-item">
              <div className="axr-cap-title">
                <Cpu size={15} />
                <strong>Google Gemini API (Compréhension &amp; Transcription)</strong>
                <span className={`axr-status ${capabilities.geminiConfigured ? 'is-ok' : 'is-warn'}`}>
                  {capabilities.geminiConfigured ? capabilities.geminiAudioModel : 'Clé absente'}
                </span>
              </div>
              <p>{capabilities.providers.audioUnderstanding.note}</p>
            </div>

            <div className="axr-cap-item">
              <div className="axr-cap-title">
                <Activity size={15} />
                <strong>Séparation vocale (`VocalSeparationProvider`)</strong>
                <span
                  className={`axr-status ${
                    capabilities.providers.vocalSeparation.isNeural ? 'is-ok' : 'is-neutral'
                  }`}
                >
                  {capabilities.providers.vocalSeparation.active}
                </span>
              </div>
              <p>{capabilities.providers.vocalSeparation.note}</p>
            </div>

            <div className="axr-cap-item">
              <div className="axr-cap-title">
                <Activity size={15} />
                <strong>ASR chanté (`SingingAsrProvider`)</strong>
                <span
                  className={`axr-status ${
                    capabilities.providers.singingAsr.externalConfigured
                      ? 'is-ok'
                      : capabilities.geminiConfigured
                        ? 'is-neutral'
                        : 'is-warn'
                  }`}
                >
                  {capabilities.providers.singingAsr.active}
                </span>
              </div>
              <p>{capabilities.providers.singingAsr.note}</p>
            </div>

            <div className="axr-cap-item">
              <div className="axr-cap-title">
                <CheckCircle2 size={15} />
                <strong>Alignement forcé mot/phonème (`ForcedAlignmentProvider`)</strong>
                <span
                  className={`axr-status ${
                    capabilities.providers.forcedAlignment.isNeuralPhonemeAligner
                      ? 'is-ok'
                      : 'is-neutral'
                  }`}
                >
                  {capabilities.providers.forcedAlignment.active}
                </span>
              </div>
              <p>{capabilities.providers.forcedAlignment.note}</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
