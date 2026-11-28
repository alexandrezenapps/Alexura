import React, { useEffect, useState } from 'react';
import { Check, Edit3, Save, ShieldAlert } from 'lucide-react';
import {
  validateLyricsDocument,
  type LyricSegment,
  type LyricsDocument,
} from '@/types/lyrics';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formatSeconds } from '@/services/playbackClock';

interface SynchronizedLyricsDisplayProps {
  document: LyricsDocument | null;
  currentTimeSeconds: number;
  saving?: boolean;
  onSeek: (seconds: number) => void;
  onSaveDocument?: (segments: LyricSegment[]) => void;
  onToggleWordReview?: (segmentId: string, wordId: string) => void;
}

export const SynchronizedLyricsDisplay: React.FC<SynchronizedLyricsDisplayProps> = ({
  document,
  currentTimeSeconds,
  saving = false,
  onSeek,
  onSaveDocument,
  onToggleWordReview,
}) => {
  const [editMode, setEditMode] = useState(false);
  const [draftSegments, setDraftSegments] = useState<LyricSegment[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setDraftSegments(document?.segments || []);
    setValidationError(null);
  }, [document]);

  const segmentsToRender = editMode ? draftSegments : document?.segments || [];

  const activeSegmentIndex = segmentsToRender.findIndex(
    (seg) =>
      seg.startSeconds !== null &&
      seg.endSeconds !== null &&
      currentTimeSeconds >= seg.startSeconds &&
      currentTimeSeconds <= seg.endSeconds,
  );

  const handleSegmentTextChange = (idx: number, nextText: string) => {
    setDraftSegments((prev) =>
      prev.map((seg, i) =>
        i === idx
          ? {
              ...seg,
              text: nextText,
              isPlaceholder: false,
            }
          : seg,
      ),
    );
  };

  const handleSegmentTimeChange = (
    idx: number,
    field: 'startSeconds' | 'endSeconds',
    rawVal: string,
  ) => {
    const trimmed = rawVal.trim();
    const parsed = trimmed === '' ? null : Number(trimmed);
    setDraftSegments((prev) =>
      prev.map((seg, i) => {
        if (i !== idx) return seg;
        const updated = {
          ...seg,
          [field]: parsed !== null && Number.isFinite(parsed) ? parsed : null,
        };
        const aligned =
          updated.startSeconds !== null && updated.endSeconds !== null ? 'manual' : 'unaligned';
        return { ...updated, alignmentState: aligned };
      }),
    );
  };

  const handleSave = () => {
    if (!document || !onSaveDocument) return;
    const candidate: LyricsDocument = {
      ...document,
      segments: draftSegments,
    };
    const report = validateLyricsDocument(candidate);
    if (!report.valid) {
      setValidationError(`${report.issues[0].path}: ${report.issues[0].message}`);
      return;
    }
    setValidationError(null);
    onSaveDocument(draftSegments);
    setEditMode(false);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>Synchronized Lyrics Display &amp; Normalized Segments</CardTitle>
          <CardDescription>
            {document
              ? `${document.segments.length} segments · Status: ${document.alignmentStatus} · Timestamps in seconds relative to 0.000s`
              : 'Upload an audio file and run Phase 1 initialization to inspect or edit normalized lyrics'}
          </CardDescription>
        </div>

        {document && (
          <div className="flex items-center gap-2">
            {editMode ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDraftSegments(document.segments);
                    setValidationError(null);
                    setEditMode(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="emerald"
                  size="sm"
                  disabled={saving}
                  onClick={handleSave}
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>{saving ? 'Saving...' : 'Save Normalized'}</span>
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setEditMode(true)}
              >
                <Edit3 className="h-3.5 w-3.5 text-sky-300" />
                <span>Edit Lyrics</span>
              </Button>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {validationError && (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{validationError}</span>
          </Alert>
        )}

        {!document ? (
          <div className="rounded-xl border border-dashed border-slate-200/14 bg-[#080b12]/75 px-6 py-12 text-center">
            <p className="text-sm font-medium text-slate-200">No LyricsDocument Active</p>
            <p className="mt-1 text-xs text-slate-400">
              Start an audio upload &amp; Phase 1 analysis job to prepare the normalized schema.
            </p>
          </div>
        ) : segmentsToRender.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200/14 bg-[#080b12]/75 px-6 py-10 text-center text-xs text-slate-400">
            Document contains 0 segments.
          </div>
        ) : (
          <div className="max-h-[420px] space-y-2.5 overflow-y-auto pr-1">
            {segmentsToRender.map((seg, idx) => {
              const isActive = idx === activeSegmentIndex;
              const hasTiming = seg.startSeconds !== null && seg.endSeconds !== null;

              return (
                <div
                  key={seg.segmentId}
                  className={cn(
                    'rounded-lg border px-4 py-3 transition-[border-color,background-color,box-shadow] duration-150',
                    isActive
                      ? 'border-sky-400/55 bg-gradient-to-r from-sky-500/16 to-indigo-500/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                      : 'border-slate-200/8 bg-[#080b12]/85 hover:border-slate-200/18',
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                    <div className="flex items-center gap-2">
                      <span className="axr-tc font-semibold text-[#e8c97a]">
                        #{String(seg.index + 1).padStart(2, '0')}
                      </span>
                      <span>{seg.sectionType}</span>
                      <span className="text-slate-600">·</span>
                      <span>{seg.alignmentState}</span>
                    </div>

                    {editMode ? (
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="Start (s)"
                          value={seg.startSeconds ?? ''}
                          onChange={(e) =>
                            handleSegmentTimeChange(idx, 'startSeconds', e.target.value)
                          }
                          className="axr-tc h-7 w-24 px-2 text-[11px]"
                        />
                        <span>→</span>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="End (s)"
                          value={seg.endSeconds ?? ''}
                          onChange={(e) =>
                            handleSegmentTimeChange(idx, 'endSeconds', e.target.value)
                          }
                          className="axr-tc h-7 w-24 px-2 text-[11px]"
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={!hasTiming}
                        onClick={() => {
                          if (seg.startSeconds !== null) onSeek(seg.startSeconds);
                        }}
                        className={cn(
                          'axr-tc rounded-md px-1.5 py-0.5 text-[11px] transition-colors',
                          hasTiming
                            ? 'text-sky-300 hover:bg-sky-500/14 hover:text-white cursor-pointer'
                            : 'text-slate-500 cursor-default',
                        )}
                      >
                        {formatSeconds(seg.startSeconds)} → {formatSeconds(seg.endSeconds)}
                      </button>
                    )}
                  </div>

                  {editMode ? (
                    <Input
                      value={seg.text}
                      onChange={(e) => handleSegmentTextChange(idx, e.target.value)}
                      className="mt-2 text-sm"
                    />
                  ) : (
                    <div className="mt-2">
                      <p
                        className={cn(
                          'text-base font-medium leading-snug',
                          seg.isPlaceholder
                            ? 'italic text-slate-500'
                            : isActive
                              ? 'text-white'
                              : 'text-slate-100',
                        )}
                      >
                        {seg.text}
                      </p>

                      {seg.words.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {seg.words.map((word) => {
                            const wordActive =
                              word.startSeconds !== null &&
                              word.endSeconds !== null &&
                              currentTimeSeconds >= word.startSeconds &&
                              currentTimeSeconds <= word.endSeconds;
                            const canSeekWord = word.startSeconds !== null;
                            const alignConf = word.alignmentConfidence ?? word.confidence;
                            const needsReview = Boolean(word.reviewRequired);
                            return (
                              <div key={word.wordId} className="inline-flex items-center">
                                <button
                                  type="button"
                                  disabled={!canSeekWord}
                                  onClick={() => {
                                    if (word.startSeconds !== null) onSeek(word.startSeconds);
                                  }}
                                  title={
                                    word.startSeconds !== null
                                      ? `${word.wordId}: ${word.startSeconds.toFixed(3)}s - ${word.endSeconds?.toFixed(3)}s${
                                          typeof alignConf === 'number'
                                            ? ` · align ${(alignConf * 100).toFixed(0)}%`
                                            : ''
                                        }${needsReview ? ' · reviewRequired' : ''}`
                                      : 'Unaligned word (Phase 1 — no fake timestamp)'
                                  }
                                  className={cn(
                                    'px-1.5 py-0.5 text-xs border transition-colors',
                                    onToggleWordReview ? 'rounded-l' : 'rounded',
                                    canSeekWord
                                      ? 'cursor-pointer hover:border-sky-400/50'
                                      : 'cursor-default',
                                    wordActive
                                      ? 'border-sky-400/65 bg-sky-500/24 text-white'
                                      : needsReview
                                        ? 'border-amber-400/55 bg-amber-500/12 text-amber-200'
                                        : 'border-slate-200/8 bg-[#101624] text-slate-300',
                                  )}
                                >
                                  <span>{word.text}</span>
                                  {typeof alignConf === 'number' && (
                                    <span className="ml-1 text-[10px] opacity-65 axr-tc">
                                      {Math.round(alignConf * 100)}%
                                    </span>
                                  )}
                                </button>
                                {onToggleWordReview && (
                                  <button
                                    type="button"
                                    disabled={saving}
                                    onClick={() => onToggleWordReview(seg.segmentId, word.wordId)}
                                    title={
                                      needsReview
                                        ? 'Mark alignment reviewed'
                                        : 'Flag word for manual review'
                                    }
                                    className={cn(
                                      'rounded-r border border-l-0 px-1 py-0.5 text-[10px] transition-colors cursor-pointer',
                                      needsReview
                                        ? 'border-amber-400/55 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30'
                                        : 'border-slate-200/8 bg-[#0b101b] text-slate-500 hover:text-slate-200',
                                    )}
                                  >
                                    {needsReview ? '!' : '✓'}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {document && (
          <div className="flex items-center justify-between border-t border-slate-200/8 pt-2.5 text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-emerald-400" />
              No fabricated word timestamps — unaligned tokens show{' '}
              <code className="axr-tc text-slate-300">--:--.--</code>
            </span>
            <span className="axr-tc">schema v{document.schemaVersion}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
