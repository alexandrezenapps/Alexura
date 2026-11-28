import React, { useEffect, useRef, useState } from 'react';
import { Layers, Music2, Puzzle, RefreshCw, ServerCog, UploadCloud, X } from 'lucide-react';
import type {
  AdapterReportMap,
  AlignedLyricsDocument,
  AudioAssetRecord,
  LyricSegment,
  LyricsDocument,
  ProcessingJob,
} from '@/types/lyrics';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { lyricsApi } from '@/services/lyricsApi';
import { apiUrl } from '@/services/syncEngineApi';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AudioUploader } from '@/components/AudioUploader';
import { KaraokePlayer } from '@/components/KaraokePlayer';
import { WaveformTimeline } from '@/components/WaveformTimeline';
import { LyricsDisplay } from '@/components/LyricsDisplay';
import { PipelineAdaptersPanel } from '@/components/PipelineAdaptersPanel';
import { SkillsAdminPanel } from '@/components/SkillsAdminPanel';

export type StudioTabId = 'upload' | 'studio' | 'adapters' | 'skills';

export interface SyncEngineAppProps {
  onClose?: () => void;
  standalone?: boolean;
  initialTab?: StudioTabId;
}

export const App: React.FC<SyncEngineAppProps> = ({
  onClose,
  initialTab = 'upload',
}) => {
  const player = useAudioPlayer();
  const playback = player.snapshot;
  const [activeTab, setActiveTab] = useState<StudioTabId>(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const [adapters, setAdapters] = useState<AdapterReportMap | null>(null);
  const [uploadedAudio, setUploadedAudio] = useState<AudioAssetRecord | null>(null);
  const [activeJob, setActiveJob] = useState<ProcessingJob | null>(null);
  const [lyricsDoc, setLyricsDoc] = useState<LyricsDocument | null>(null);
  const [savedDocs, setSavedDocs] = useState<LyricsDocument[]>([]);

  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [languageHint, setLanguageHint] = useState('auto');
  const [draftLyricsText, setDraftLyricsText] = useState('');
  const [enableVocalSeparation, setEnableVocalSeparation] = useState(true);

  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [savingLyrics, setSavingLyrics] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const pollTimerRef = useRef<number | null>(null);

  const stopPolling = () => {
    if (pollTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const refreshSavedDocuments = async () => {
    try {
      const docs = await lyricsApi.listLyricsDocuments();
      setSavedDocs(docs);
    } catch {
      // Non-fatal
    }
  };

  useEffect(() => {
    void lyricsApi
      .getAdapters()
      .then(setAdapters)
      .catch(() => {});
    void refreshSavedDocuments();

    return () => {
      stopPolling();
    };
  }, []);

  const handleUploadFile = async (file: File) => {
    setErrorMsg(null);
    setUploading(true);
    stopPolling();
    setAnalyzing(false);
    try {
      player.pause();
      player.loadFromFile(file);
      setTitle(file.name.replace(/\.[^.]+$/, ''));
      const audio = await lyricsApi.uploadAudio(file);
      setUploadedAudio(audio);
      setActiveJob(null);
      setLyricsDoc((prev) => (prev && prev.audioId === audio.audioId ? prev : null));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Audio upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const pollJobUntilTerminal = (jobId: string) => {
    stopPolling();
    const check = async () => {
      try {
        const latest = await lyricsApi.getJobStatus(jobId);
        setActiveJob(latest);
        if (latest.state === 'completed') {
          stopPolling();
          setAnalyzing(false);
          if (latest.documentId) {
            const doc = await lyricsApi.getLyricsDocument(latest.documentId);
            setLyricsDoc(doc);
            void refreshSavedDocuments();
          }
        } else if (latest.state === 'failed') {
          stopPolling();
          setAnalyzing(false);
          setErrorMsg(latest.error || 'Phase 1 pipeline failed.');
        }
      } catch (err) {
        stopPolling();
        setAnalyzing(false);
        setErrorMsg(err instanceof Error ? err.message : 'Failed to poll job status.');
      }
    };

    void check();
    if (typeof window !== 'undefined') {
      pollTimerRef.current = window.setInterval(() => {
        void check();
      }, 350);
    }
  };

  const handleStartAnalysis = async () => {
    if (!uploadedAudio) return;
    setErrorMsg(null);
    setAnalyzing(true);
    try {
      const queued = await lyricsApi.analyzeSong({
        audioId: uploadedAudio.audioId,
        title: title.trim() || uploadedAudio.filename,
        artist: artist.trim(),
        languageHint,
        draftLyricsText: draftLyricsText.trim() || undefined,
        enableVocalSeparation,
      });
      setActiveJob(queued);
      pollJobUntilTerminal(queued.jobId);
    } catch (err) {
      setAnalyzing(false);
      setErrorMsg(err instanceof Error ? err.message : 'Unable to start analysis job.');
    }
  };

  const handleLoadSavedDocument = async (doc: LyricsDocument) => {
    setErrorMsg(null);
    setLyricsDoc(doc);
    setTitle(doc.title);
    setArtist(doc.artist);
    setLanguageHint(doc.primaryLanguage || 'auto');
    if (doc.audioId) {
      setUploadedAudio((prev) => (prev && prev.audioId === doc.audioId ? prev : null));
      player.loadFromUrl(
        apiUrl(`/api/v1/audio/${encodeURIComponent(doc.audioId)}/stream`),
        doc.title,
      );
    }
    setActiveTab('studio');
  };

  const handleSaveDocument = async (segments: LyricSegment[]) => {
    if (!lyricsDoc) return;
    setSavingLyrics(true);
    setErrorMsg(null);
    try {
      const updated = await lyricsApi.updateLyricsDocument(lyricsDoc.documentId, {
        title: title.trim() || lyricsDoc.title,
        artist: artist.trim(),
        primaryLanguage: languageHint,
        segments,
      });
      setLyricsDoc(updated);
      void refreshSavedDocuments();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update lyrics.');
    } finally {
      setSavingLyrics(false);
    }
  };

  const handleToggleWordReview = async (segmentId: string, wordId: string) => {
    if (!lyricsDoc) return;
    const nextSegments = lyricsDoc.segments.map((seg) =>
      seg.segmentId !== segmentId
        ? seg
        : {
            ...seg,
            words: seg.words.map((w) =>
              w.wordId !== wordId
                ? w
                : {
                    ...w,
                    reviewRequired: !w.reviewRequired,
                    flags: !w.reviewRequired
                      ? Array.from(new Set([...(w.flags || []), 'review_required']))
                      : (w.flags || []).filter((f) => f !== 'review_required'),
                  },
            ),
          },
    );
    await handleSaveDocument(nextSegments);
  };

  const handleImportAligned = async (aligned: AlignedLyricsDocument) => {
    setErrorMsg(null);
    const res = await lyricsApi.importAlignedLyrics(aligned);
    setLyricsDoc(res.document);
    setTitle(res.document.title);
    setArtist(res.document.artist);
    setLanguageHint(res.document.primaryLanguage || 'auto');
    void refreshSavedDocuments();
  };

  const activeDuration =
    playback.duration || uploadedAudio?.durationSeconds || lyricsDoc?.durationSeconds || 0;
  const activeAudioUrl =
    uploadedAudio?.audioUrl ||
    (lyricsDoc?.audioId ? apiUrl(`/api/v1/audio/${encodeURIComponent(lyricsDoc.audioId)}/stream`) : null);

  return (
    <div className="axr-studio-scope min-h-screen text-slate-100 flex flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200/10 bg-[#070a12]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8.5 w-8.5 items-center justify-center rounded-lg border border-[#deb96c]/40 bg-gradient-to-br from-[#12203a] via-[#0e1524] to-[#1a1622] text-[#f3deb0] shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_4px_12px_rgba(0,0,0,0.4)]">
              <Music2 className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-tight text-slate-50">
                Alexura · AI Lyrics Sync Engine
              </h1>
              <p className="text-[11px] text-slate-400">
                Studio Atelier · Normalized Schema &amp; Master Skills Architecture
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <Tabs
              value={activeTab}
              onValueChange={(val) => setActiveTab(val as StudioTabId)}
            >
              <TabsList>
                <TabsTrigger value="upload">
                  <UploadCloud className="h-3.5 w-3.5" />
                  <span>Upload &amp; Pipeline</span>
                </TabsTrigger>
                <TabsTrigger value="studio">
                  <Layers className="h-3.5 w-3.5" />
                  <span>Player &amp; Lyrics</span>
                </TabsTrigger>
                <TabsTrigger value="adapters">
                  <ServerCog className="h-3.5 w-3.5" />
                  <span>AI Adapters</span>
                </TabsTrigger>
                <TabsTrigger value="skills">
                  <Puzzle className="h-3.5 w-3.5" />
                  <span>Master Skills</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {onClose && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  player.pause();
                  onClose();
                }}
              >
                <X className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Close</span>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 space-y-5 px-4 py-5 sm:px-6">
        <KaraokePlayer
          snapshot={playback}
          document={lyricsDoc}
          title={title || lyricsDoc?.title || uploadedAudio?.filename || ''}
          artist={artist || lyricsDoc?.artist || ''}
          onTogglePlay={player.toggle}
          onSeek={player.seek}
          onRateChange={player.setPlaybackRate}
          onVolumeChange={player.setVolume}
          onToggleMute={player.toggleMute}
          onToggleLoop={() => player.setLoop(!playback.loop)}
        />

        <WaveformTimeline
          audioUrl={activeAudioUrl}
          durationSeconds={activeDuration}
          currentTimeSeconds={playback.currentTime}
          peaks={
            uploadedAudio && (!lyricsDoc || lyricsDoc.audioId === uploadedAudio.audioId)
              ? uploadedAudio.waveformPeaks
              : undefined
          }
          segments={lyricsDoc?.segments}
          onSeek={player.seek}
        />

        <Tabs
          value={activeTab}
          onValueChange={(val) => setActiveTab(val as StudioTabId)}
        >
          <TabsContent value="upload" className="mt-0">
            <AudioUploader
              uploadedAudio={uploadedAudio}
              activeJob={activeJob}
              title={title}
              artist={artist}
              languageHint={languageHint}
              draftLyricsText={draftLyricsText}
              enableVocalSeparation={enableVocalSeparation}
              uploading={uploading}
              analyzing={analyzing}
              errorMsg={errorMsg}
              onTitleChange={setTitle}
              onArtistChange={setArtist}
              onLanguageHintChange={setLanguageHint}
              onDraftLyricsChange={setDraftLyricsText}
              onToggleVocalSeparation={setEnableVocalSeparation}
              onUploadFile={(f) => void handleUploadFile(f)}
              onStartAnalysis={() => void handleStartAnalysis()}
              onOpenStage={() => setActiveTab('studio')}
            />
          </TabsContent>

          <TabsContent value="studio" className="mt-0">
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              <aside className="lg:col-span-4 rounded-xl border border-slate-200/10 bg-gradient-to-b from-[#101521]/95 to-[#0b0f18]/98 p-4 space-y-3 h-fit shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_28px_-14px_rgba(0,0,0,0.65)]">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-100">
                    Saved Lyrics Documents
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => void refreshSavedDocuments()}
                    aria-label="Refresh saved documents"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {savedDocs.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4">
                    No saved normalized documents yet. Upload an audio track to initialize one.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {savedDocs.map((doc) => (
                      <button
                        key={doc.documentId}
                        type="button"
                        onClick={() => void handleLoadSavedDocument(doc)}
                        className={`w-full rounded-lg border px-3 py-2 text-left transition-[background,border-color,color] duration-150 cursor-pointer ${
                          lyricsDoc?.documentId === doc.documentId
                            ? 'border-sky-400/55 bg-gradient-to-r from-sky-500/18 to-indigo-500/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                            : 'border-slate-200/8 bg-[#080b12]/80 text-slate-300 hover:border-slate-200/20 hover:bg-[#101624]'
                        }`}
                      >
                        <div className="truncate text-xs font-medium">{doc.title}</div>
                        <div className="axr-tc mt-0.5 text-[10px] text-slate-400">
                          {doc.segments.length} segments · {doc.alignmentStatus}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </aside>

              <div className="lg:col-span-8">
                <LyricsDisplay
                  document={lyricsDoc}
                  currentTimeSeconds={playback.currentTime}
                  saving={savingLyrics}
                  onSeek={player.seek}
                  onSaveDocument={(segments) => void handleSaveDocument(segments)}
                  onToggleWordReview={(segmentId, wordId) =>
                    void handleToggleWordReview(segmentId, wordId)
                  }
                  onImportAligned={handleImportAligned}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="adapters" className="mt-0">
            <PipelineAdaptersPanel adapters={adapters} />
          </TabsContent>

          <TabsContent value="skills" className="mt-0">
            <SkillsAdminPanel />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default App;
