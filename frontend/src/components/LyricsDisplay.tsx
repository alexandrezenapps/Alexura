import React, { useMemo, useState } from 'react';
import { Code2, Download, FileUp, ShieldCheck } from 'lucide-react';
import { SynchronizedLyricsDisplay } from '@/components/SynchronizedLyricsDisplay';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  toAlignedLyricsDocument,
  toCanonicalSongAlignment,
  validateAlignedLyricsDocument,
  type AlignedLyricsDocument,
  type LyricSegment,
  type LyricsDocument,
} from '@/types/lyrics';

const SAMPLE_ALIGNED_PAYLOAD: AlignedLyricsDocument = {
  songId: 'song_001',
  duration: 185.42,
  language: 'en',
  version: 1,
  segments: [
    {
      id: 'seg_001',
      text: 'I still remember how you said love',
      start: 30.8,
      end: 33.1,
      words: [
        { id: 'word_001', text: 'I', start: 30.82, end: 31.05, confidence: 0.97, alignmentConfidence: 0.95 },
        { id: 'word_002', text: 'still', start: 31.08, end: 31.42, confidence: 0.96, alignmentConfidence: 0.91 },
        { id: 'word_003', text: 'remember', start: 31.45, end: 31.98, confidence: 0.93, alignmentConfidence: 0.72, reviewRequired: true },
        { id: 'word_004', text: 'said', start: 32.02, end: 32.39, confidence: 0.95, alignmentConfidence: 0.89 },
        {
          id: 'word_005',
          text: 'love',
          start: 32.417,
          end: 32.891,
          confidence: 0.98,
          alignmentConfidence: 0.96,
          units: [
            { id: 'word_005_u01', text: 'l', start: 32.417, end: 32.54, confidence: 0.97 },
            { id: 'word_005_u02', text: 'o', start: 32.541, end: 32.72, confidence: 0.98 },
            { id: 'word_005_u03', text: 've', start: 32.721, end: 32.891, confidence: 0.97 },
          ],
          reviewRequired: false,
        },
      ],
    },
  ],
};

export interface LyricsDisplayProps {
  document: LyricsDocument | null;
  currentTimeSeconds: number;
  saving?: boolean;
  onSeek: (seconds: number) => void;
  onSaveDocument?: (segments: LyricSegment[]) => void;
  onToggleWordReview?: (segmentId: string, wordId: string) => void;
  onImportAligned?: (aligned: AlignedLyricsDocument) => Promise<void> | void;
}

export const LyricsDisplay: React.FC<LyricsDisplayProps> = ({
  document,
  currentTimeSeconds,
  saving = false,
  onSeek,
  onSaveDocument,
  onToggleWordReview,
  onImportAligned,
}) => {
  const [contractFormat, setContractFormat] = useState<'aligned' | 'canonical'>('aligned');
  const [showJson, setShowJson] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState(() =>
    JSON.stringify(SAMPLE_ALIGNED_PAYLOAD, null, 2),
  );
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const canonical = useMemo(
    () => (document ? toCanonicalSongAlignment(document) : null),
    [document],
  );

  const aligned = useMemo(
    () => (document ? toAlignedLyricsDocument(document) : null),
    [document],
  );

  const reviewCount = useMemo(() => {
    if (!aligned) return 0;
    return aligned.segments.reduce(
      (sum, seg) => sum + seg.words.filter((w) => w.reviewRequired).length,
      0,
    );
  }, [aligned]);

  const handleDownloadJson = () => {
    if (typeof window === 'undefined') return;
    const payload = contractFormat === 'aligned' ? aligned : canonical;
    if (!payload) return;
    const suffix = contractFormat === 'aligned' ? `aligned.v${aligned?.version || 1}` : 'alignment.v1';
    const id = aligned?.songId || canonical?.song_id || 'song';
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = `${id}.${suffix}.json`;
    window.document.body.appendChild(a);
    a.click();
    window.document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSubmitImport = async () => {
    if (!onImportAligned) return;
    setImportError(null);
    let parsed: AlignedLyricsDocument;
    try {
      parsed = JSON.parse(importText) as AlignedLyricsDocument;
    } catch {
      setImportError('Invalid JSON syntax.');
      return;
    }
    const validation = validateAlignedLyricsDocument(parsed);
    if (!validation.valid) {
      setImportError(`${validation.issues[0].path}: ${validation.issues[0].message}`);
      return;
    }
    setImporting(true);
    try {
      await onImportAligned(parsed);
      setShowImport(false);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Aligned import failed.');
    } finally {
      setImporting(false);
    }
  };

  const activeJson = contractFormat === 'aligned' ? aligned : canonical;

  return (
    <div className="space-y-3">
      <SynchronizedLyricsDisplay
        document={document}
        currentTimeSeconds={currentTimeSeconds}
        saving={saving}
        onSeek={onSeek}
        onSaveDocument={onSaveDocument}
        onToggleWordReview={onToggleWordReview}
      />

      <div className="rounded-xl border border-slate-200/10 bg-[#0b0f18]/90 px-4 py-3 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
            <Code2 className="h-3.5 w-3.5 text-[#e8c97a]" />
            <span className="font-medium text-slate-100">Aligned Lyrics Contract</span>
            {aligned && (
              <>
                <span className="text-slate-600">·</span>
                <span className="axr-tc text-[11px] text-slate-400">
                  {aligned.songId} · v{aligned.version} · {aligned.language}
                </span>
                {reviewCount > 0 && (
                  <span className="text-[11px] font-medium text-amber-300">
                    · {reviewCount} review
                  </span>
                )}
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onImportAligned && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowImport((v) => !v)}
              >
                <FileUp className="h-3.5 w-3.5 text-sky-300" />
                <span>{showImport ? 'Close Import' : 'Import Aligned JSON'}</span>
              </Button>
            )}
            {activeJson && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setContractFormat((f) => (f === 'aligned' ? 'canonical' : 'aligned'))
                  }
                >
                  {contractFormat === 'aligned' ? 'Format: Aligned' : 'Format: Canonical v1'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowJson((v) => !v)}
                >
                  {showJson ? 'Hide JSON' : 'Inspect JSON'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleDownloadJson}
                >
                  <Download className="h-3.5 w-3.5 text-sky-300" />
                  <span>Export JSON</span>
                </Button>
              </>
            )}
          </div>
        </div>

        {showImport && onImportAligned && (
          <div className="space-y-2 border-t border-slate-200/8 pt-2.5">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>
                Paste Aligned LyricsDocument JSON (<code className="axr-tc text-slate-300">songId</code>,{' '}
                <code className="axr-tc text-slate-300">duration</code>,{' '}
                <code className="axr-tc text-slate-300">language</code>,{' '}
                <code className="axr-tc text-slate-300">segments</code>,{' '}
                <code className="axr-tc text-slate-300">version</code>)
              </span>
              <button
                type="button"
                onClick={() => {
                  setImportText(JSON.stringify(SAMPLE_ALIGNED_PAYLOAD, null, 2));
                  setImportError(null);
                }}
                className="text-sky-300 hover:text-white cursor-pointer"
              >
                Reset Sample (word_005: love)
              </button>
            </div>
            <Textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={8}
              className="axr-tc text-[11px] leading-relaxed"
            />
            {importError && (
              <Alert variant="destructive">
                <span>{importError}</span>
              </Alert>
            )}
            <div className="flex justify-end">
              <Button
                type="button"
                variant="emerald"
                size="sm"
                disabled={importing}
                onClick={() => void handleSubmitImport()}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>{importing ? 'Validating & Importing...' : 'Validate & Load Aligned Document'}</span>
              </Button>
            </div>
          </div>
        )}

        {showJson && activeJson && (
          <pre className="axr-tc max-h-64 overflow-auto rounded-lg border border-slate-200/10 bg-[#06080f] p-3 text-[11px] leading-relaxed text-slate-200">
            {JSON.stringify(activeJson, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
};
