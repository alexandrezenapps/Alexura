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
}

export const SynchronizedLyricsDisplay: React.FC<SynchronizedLyricsDisplayProps> = ({
  document,
  currentTimeSeconds,
  saving = false,
  onSeek,
  onSaveDocument,
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
                <Edit3 className="h-3.5 w-3.5" />
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
          <div className="rounded-lg border border-dashed border-white/10 bg-zinc-950/60 px-6 py-12 text-center">
            <p className="text-sm font-medium text-zinc-300">No LyricsDocument Active</p>
            <p className="mt-1 text-xs text-zinc-500">
              Start an audio upload &amp; Phase 1 analysis job to prepare the normalized schema.
            </p>
          </div>
        ) : segmentsToRender.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 bg-zinc-950/60 px-6 py-10 text-center text-xs text-zinc-400">
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
                    'rounded-lg border px-4 py-3 transition-colors',
                    isActive
                      ? 'border-sky-400/50 bg-sky-400/10'
                      : 'border-white/7 bg-zinc-950/80 hover:border-white/15',
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500">
                    <div className="flex items-center gap-2">
                      <span className="axr-tc text-zinc-400">#{String(seg.index + 1).padStart(2, '0')}</span>
                      <span>{seg.sectionType}</span>
                      <span>·</span>
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
                          'axr-tc text-[11px]',
                          hasTiming
                            ? 'text-sky-400 hover:underline cursor-pointer'
                            : 'text-zinc-500 cursor-default',
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
                            ? 'italic text-zinc-500'
                            : isActive
                              ? 'text-white'
                              : 'text-zinc-200',
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
                            return (
                              <span
                                key={word.wordId}
                                title={
                                  word.startSeconds !== null
                                    ? `${word.startSeconds.toFixed(2)}s - ${word.endSeconds?.toFixed(2)}s`
                                    : 'Unaligned word (Phase 1 — no fake timestamp)'
                                }
                                className={cn(
                                  'rounded px-1.5 py-0.5 text-xs border',
                                  wordActive
                                    ? 'border-sky-400/60 bg-sky-400/20 text-white'
                                    : 'border-white/7 bg-zinc-900/70 text-zinc-300',
                                )}
                              >
                                {word.text}
                              </span>
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
          <div className="flex items-center justify-between border-t border-white/6 pt-2.5 text-[11px] text-zinc-500">
            <span className="flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-emerald-400" />
              No fabricated word timestamps — unaligned tokens show `--:--.--`
            </span>
            <span className="axr-tc">schema v{document.schemaVersion}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
