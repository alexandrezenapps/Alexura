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
              'flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-9 text-center transition-[border-color,background-color,box-shadow] duration-150 cursor-pointer',
              dragging
                ? 'border-sky-400 bg-sky-500/12 shadow-[0_0_0_3px_rgba(20,139,255,0.16)]'
                : 'border-slate-200/16 bg-[#080b12]/90 hover:border-sky-400/45 hover:bg-[#0d1424]/75',
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
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-sky-400/28 bg-gradient-to-br from-sky-500/18 to-indigo-500/14 text-sky-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
              {uploading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <UploadCloud className="h-5 w-5" />
              )}
            </div>
            <p className="text-sm font-medium text-slate-100">
              {uploading
                ? 'Validating audio signature and storing original file...'
                : 'Drop audio file here or browse from studio storage'}
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              WAV, MP3, FLAC, M4A, AAC, OGG, WebM · Preserved 1:1 on backend disk
            </p>
          </div>

          {uploadedAudio && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-400/25 bg-emerald-500/8 px-3.5 py-2.5 text-xs">
              <div className="flex items-center gap-2.5 min-w-0">
                <FileAudio className="h-4 w-4 shrink-0 text-sky-400" />
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-100">
                    {uploadedAudio.filename}
                  </div>
                  <div className="axr-tc text-[11px] text-slate-400">
                    {uploadedAudio.audioId} · {formatBytes(uploadedAudio.byteSize)} · SHA-256{' '}
                    {uploadedAudio.sha256.slice(0, 10)}
                  </div>
                </div>
              </div>
              <span className="axr-tc inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Original Ready
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="space-y-1.5 text-xs">
              <span className="block text-[11px] font-medium text-slate-400">Song Title</span>
              <Input
                value={title}
                onChange={(e) => onTitleChange(e.target.value)}
                placeholder="Track title"
              />
            </label>
            <label className="space-y-1.5 text-xs">
              <span className="block text-[11px] font-medium text-slate-400">Artist</span>
              <Input
                value={artist}
                onChange={(e) => onArtistChange(e.target.value)}
                placeholder="Artist name"
              />
            </label>
            <label className="space-y-1.5 text-xs">
              <span className="block text-[11px] font-medium text-slate-400">Language Hint</span>
              <select
                value={languageHint}
                onChange={(e) => onLanguageHintChange(e.target.value)}
                className="flex h-9 w-full rounded-lg border border-slate-200/12 bg-[#080b12] px-3 text-xs text-slate-100 shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)] hover:border-slate-200/22 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70"
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
            <span className="flex items-center justify-between text-[11px] font-medium text-slate-400">
              <span>Optional Draft Lyrics (one segment per line)</span>
              <span className="text-slate-500">Unaligned until Phase 2 / manual edit</span>
            </span>
            <Textarea
              value={draftLyricsText}
              onChange={(e) => onDraftLyricsChange(e.target.value)}
              placeholder="Paste optional draft lyrics lines here. Phase 1 structures segments & word units with null timestamps (no fake AI timestamps)."
              rows={4}
            />
          </label>

          <label className="flex items-center justify-between rounded-lg border border-slate-200/10 bg-[#080b12]/80 px-3.5 py-2.5 text-xs cursor-pointer transition-colors hover:border-slate-200/20">
            <div>
              <div className="font-medium text-slate-100">
                Include Vocal Separation Stage (Phase 1 Stub Adapter)
              </div>
              <div className="text-[11px] text-slate-400">
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
              <Button type="button" variant="emerald" onClick={onOpenStage}>
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
            <Info className="h-4 w-4 shrink-0 mt-0.5 text-sky-300" />
            <div className="space-y-1">
              <div className="font-semibold text-slate-50">Phase 1 Foundation Mode</div>
              <p className="text-[11px] leading-relaxed text-slate-300">
                Unimplemented AI models run as explicit Phase 1 stubs. No fake word timestamps
                or simulated lyrics recognition are generated.
              </p>
            </div>
          </Alert>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">
                Status:{' '}
                <span className="axr-tc font-medium text-slate-100">
                  {activeJob ? activeJob.state : 'idle'}
                </span>
              </span>
              <span className="axr-tc text-sky-300">
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
                    'flex items-center justify-between rounded-lg border px-3 py-2 text-xs transition-colors',
                    isCurrent
                      ? 'border-sky-400/50 bg-gradient-to-r from-sky-500/18 to-indigo-500/10 text-white'
                      : isDone
                        ? 'border-emerald-400/20 bg-emerald-500/6 text-slate-200'
                        : 'border-slate-200/7 bg-[#080b12]/70 text-slate-500',
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    {isDone ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    ) : isCurrent ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />
                    ) : (
                      <span className="h-2 w-2 rounded-full bg-slate-700" />
                    )}
                    <span className="font-medium">{STAGE_LABELS[stage]}</span>
                  </div>
                  <span className="axr-tc text-[10px] text-slate-400">{stage}</span>
                </li>
              );
            })}
            {activeJob?.state === 'failed' && (
              <li className="flex items-center justify-between rounded-lg border border-red-400/45 bg-red-500/12 px-3 py-2 text-xs text-red-200">
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
