import React, { useRef, useState } from 'react';
import {
  CheckCircle2,
  FileAudio,
  Info,
  Loader2,
  PlayCircle,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import {
  PIPELINE_STAGE_ORDER,
  type AudioAssetRecord,
  type ProcessingJob,
  type ProcessingPipelineState,
} from '@/types/lyrics';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface UploadScreenProps {
  uploadedAudio: AudioAssetRecord | null;
  activeJob: ProcessingJob | null;
  title: string;
  artist: string;
  languageHint: string;
  draftLyricsText: string;
  enableVocalSeparation: boolean;
  uploading: boolean;
  analyzing: boolean;
  errorMsg: string | null;
  onTitleChange: (val: string) => void;
  onArtistChange: (val: string) => void;
  onLanguageHintChange: (val: string) => void;
  onDraftLyricsChange: (val: string) => void;
  onToggleVocalSeparation: (val: boolean) => void;
  onUploadFile: (file: File) => void;
  onStartAnalysis: () => void;
  onOpenStage?: () => void;
}

const STAGE_LABELS: Record<ProcessingPipelineState, string> = {
  queued: 'Queued',
  validating: 'Validating',
  analyzing: 'Analyzing',
  separating_vocals: 'Separating Vocals',
  transcribing: 'Transcribing',
  aligning: 'Aligning',
  validating_alignment: 'Validating Alignment',
  completed: 'Completed',
  failed: 'Failed',
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const UploadScreen: React.FC<UploadScreenProps> = ({
  uploadedAudio,
  activeJob,
  title,
  artist,
  languageHint,
  draftLyricsText,
  enableVocalSeparation,
  uploading,
  analyzing,
  errorMsg,
  onTitleChange,
  onArtistChange,
  onLanguageHintChange,
  onDraftLyricsChange,
  onToggleVocalSeparation,
  onUploadFile,
  onStartAnalysis,
  onOpenStage,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) {
      onUploadFile(file);
    }
  };

  const currentStageIdx = activeJob ? PIPELINE_STAGE_ORDER.indexOf(activeJob.state) : -1;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <Card className="lg:col-span-7">
        <CardHeader>
          <CardTitle>Audio Ingestion &amp; Track Metadata</CardTitle>
          <CardDescription>
            Original audio bytes and timeline origin (0.000s) are preserved untouched.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            role="button"
            tabIndex={0}
            aria-label="Drop audio file or click to select"
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              handleFiles(e.dataTransfer.files);
            }}
            className={cn(
              'flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-9 text-center transition-colors cursor-pointer',
              dragging
                ? 'border-sky-400 bg-sky-500/8'
                : 'border-white/15 bg-zinc-950/70 hover:border-white/30 hover:bg-zinc-900/50',
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".wav,.mp3,.m4a,.aac,.flac,.ogg,.webm,audio/*"
              className="hidden"
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-zinc-900 text-sky-400">
              {uploading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <UploadCloud className="h-5 w-5" />
              )}
            </div>
            <p className="text-sm font-medium text-zinc-100">
              {uploading
                ? 'Validating audio signature and storing original file...'
                : 'Drop audio file here or browse from studio storage'}
            </p>
            <p className="mt-1 text-[11px] text-zinc-500">
              WAV, MP3, FLAC, M4A, AAC, OGG, WebM · Preserved 1:1 on backend disk
            </p>
          </div>

          {uploadedAudio && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/8 bg-zinc-950 px-3.5 py-2.5 text-xs">
              <div className="flex items-center gap-2.5 min-w-0">
                <FileAudio className="h-4 w-4 shrink-0 text-sky-400" />
                <div className="min-w-0">
                  <div className="truncate font-medium text-zinc-100">
                    {uploadedAudio.filename}
                  </div>
                  <div className="axr-tc text-[11px] text-zinc-500">
                    {uploadedAudio.audioId} · {formatBytes(uploadedAudio.byteSize)} · SHA-256{' '}
                    {uploadedAudio.sha256.slice(0, 10)}
                  </div>
                </div>
              </div>
              <span className="axr-tc text-[11px] text-emerald-400">Original Ready</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="space-y-1.5 text-xs">
              <span className="block text-[11px] font-medium text-zinc-400">Song Title</span>
              <Input
                value={title}
                onChange={(e) => onTitleChange(e.target.value)}
                placeholder="Track title"
              />
            </label>
            <label className="space-y-1.5 text-xs">
              <span className="block text-[11px] font-medium text-zinc-400">Artist</span>
              <Input
                value={artist}
                onChange={(e) => onArtistChange(e.target.value)}
                placeholder="Artist name"
              />
            </label>
            <label className="space-y-1.5 text-xs">
              <span className="block text-[11px] font-medium text-zinc-400">Language Hint</span>
              <select
                value={languageHint}
                onChange={(e) => onLanguageHintChange(e.target.value)}
                className="flex h-9 w-full rounded-lg border border-white/10 bg-zinc-950 px-3 text-xs text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70"
              >
                <option value="auto">Auto-detect</option>
                <option value="fr">Français (fr)</option>
                <option value="en">English (en)</option>
                <option value="zh-Hans">中文 简体 (zh-Hans)</option>
                <option value="zh-Hant">中文 繁體 (zh-Hant)</option>
                <option value="ja">日本語 (ja)</option>
                <option value="ko">한국어 (ko)</option>
                <option value="es">Español (es)</option>
              </select>
            </label>
          </div>

          <label className="block space-y-1.5 text-xs">
            <span className="flex items-center justify-between text-[11px] font-medium text-zinc-400">
              <span>Optional Draft Lyrics (one segment per line)</span>
              <span className="text-zinc-500">Unaligned until Phase 2 / manual edit</span>
            </span>
            <Textarea
              value={draftLyricsText}
              onChange={(e) => onDraftLyricsChange(e.target.value)}
              placeholder="Paste optional draft lyrics lines here. Phase 1 structures segments & word units with null timestamps (no fake AI timestamps)."
              rows={4}
            />
          </label>

          <label className="flex items-center justify-between rounded-lg border border-white/8 bg-zinc-950/60 px-3.5 py-2.5 text-xs cursor-pointer">
            <div>
              <div className="font-medium text-zinc-200">
                Include Vocal Separation Stage (Phase 1 Stub Adapter)
              </div>
              <div className="text-[11px] text-zinc-500">
                Routes job through `separating_vocals` state without altering original audio.
              </div>
            </div>
            <input
              type="checkbox"
              checked={enableVocalSeparation}
              onChange={(e) => onToggleVocalSeparation(e.target.checked)}
              className="h-4 w-4 accent-sky-400"
            />
          </label>

          {errorMsg && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button
              type="button"
              onClick={onStartAnalysis}
              disabled={!uploadedAudio || uploading || analyzing}
            >
              {analyzing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Running Phase 1 Pipeline...</span>
                </>
              ) : (
                <span>Initialize Phase 1 Analysis Job</span>
              )}
            </Button>

            {activeJob?.state === 'completed' && onOpenStage && (
              <Button type="button" variant="secondary" onClick={onOpenStage}>
                <PlayCircle className="h-3.5 w-3.5" />
                <span>Open Player &amp; Lyrics View</span>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-5">
        <CardHeader>
          <CardTitle>Pipeline Execution State Machine</CardTitle>
          <CardDescription>
            9-stage finite-state lifecycle backed by modular adapter interfaces.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="info">
            <Info className="h-4 w-4 shrink-0 mt-0.5 text-sky-400" />
            <div className="space-y-1">
              <div className="font-semibold text-zinc-100">Phase 1 Foundation Mode</div>
              <p className="text-[11px] leading-relaxed text-zinc-300">
                Unimplemented AI models run as explicit Phase 1 stubs. No fake word timestamps
                or simulated lyrics recognition are generated.
              </p>
            </div>
          </Alert>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">
                Status:{' '}
                <span className="axr-tc font-medium text-zinc-100">
                  {activeJob ? activeJob.state : 'idle'}
                </span>
              </span>
              <span className="axr-tc text-zinc-300">
                {activeJob ? `${activeJob.progressPercent}%` : '0%'}
              </span>
            </div>
            <Progress value={activeJob?.progressPercent || 0} />
          </div>

          <ol className="space-y-1.5 pt-1">
            {PIPELINE_STAGE_ORDER.map((stage, idx) => {
              const isCurrent = activeJob?.state === stage;
              const isFailed = activeJob?.state === 'failed';
              const isDone =
                activeJob?.state === 'completed' ||
                (currentStageIdx > idx && !isFailed);
              return (
                <li
                  key={stage}
                  className={cn(
                    'flex items-center justify-between rounded-lg border px-3 py-2 text-xs',
                    isCurrent
                      ? 'border-sky-400/40 bg-sky-400/10 text-zinc-100'
                      : isDone
                        ? 'border-white/8 bg-zinc-950/80 text-zinc-300'
                        : 'border-white/5 bg-zinc-950/35 text-zinc-500',
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    {isDone ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    ) : isCurrent ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />
                    ) : (
                      <span className="h-2 w-2 rounded-full bg-zinc-700" />
                    )}
                    <span className="font-medium">{STAGE_LABELS[stage]}</span>
                  </div>
                  <span className="axr-tc text-[10px] text-zinc-500">{stage}</span>
                </li>
              );
            })}
            {activeJob?.state === 'failed' && (
              <li className="flex items-center justify-between rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                <div className="flex items-center gap-2">
                  <XCircle className="h-3.5 w-3.5 text-red-400" />
                  <span className="font-medium">Failed</span>
                </div>
                <span className="axr-tc text-[10px]">failed</span>
              </li>
            )}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
};
