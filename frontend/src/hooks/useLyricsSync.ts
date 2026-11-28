import { useMemo } from 'react';
import {
  toAlignedLyricsDocument,
  toCanonicalSongAlignment,
  type AlignedLyricsDocument,
  type CanonicalSongAlignmentDocument,
  type LyricSegment,
  type LyricWord,
  type LyricsDocument,
} from '@/types/lyrics';

export interface LyricsSyncState {
  activeSegmentIndex: number;
  activeSegment: LyricSegment | null;
  activeWordIndex: number;
  activeWord: LyricWord | null;
  activeUnitIndex: number;
  wordProgress: number;
  reviewRequiredCount: number;
  activeWordConfidence: number | null;
  canonical: CanonicalSongAlignmentDocument | null;
  aligned: AlignedLyricsDocument | null;
}

export function useLyricsSync(
  document: LyricsDocument | null,
  currentTimeSeconds: number,
): LyricsSyncState {
  const canonical = useMemo(
    () => (document ? toCanonicalSongAlignment(document) : null),
    [document],
  );

  const aligned = useMemo(
    () => (document ? toAlignedLyricsDocument(document) : null),
    [document],
  );

  const reviewRequiredCount = useMemo(() => {
    if (!aligned) return 0;
    let count = 0;
    for (const seg of aligned.segments) {
      for (const word of seg.words) {
        if (word.reviewRequired) count += 1;
      }
    }
    return count;
  }, [aligned]);

  return useMemo(() => {
    if (!document || !document.segments.length) {
      return {
        activeSegmentIndex: -1,
        activeSegment: null,
        activeWordIndex: -1,
        activeWord: null,
        activeUnitIndex: -1,
        wordProgress: 0,
        reviewRequiredCount,
        activeWordConfidence: null,
        canonical,
        aligned,
      };
    }

    const activeSegmentIndex = document.segments.findIndex(
      (seg) =>
        seg.startSeconds !== null &&
        seg.endSeconds !== null &&
        currentTimeSeconds >= seg.startSeconds &&
        currentTimeSeconds <= seg.endSeconds,
    );

    const activeSegment =
      activeSegmentIndex >= 0 ? document.segments[activeSegmentIndex] : null;

    let activeWordIndex = -1;
    let activeWord: LyricWord | null = null;
    let activeUnitIndex = -1;
    let wordProgress = 0;
    let activeWordConfidence: number | null = null;

    if (activeSegment && activeSegment.words.length > 0) {
      activeWordIndex = activeSegment.words.findIndex(
        (w) =>
          w.startSeconds !== null &&
          w.endSeconds !== null &&
          currentTimeSeconds >= w.startSeconds &&
          currentTimeSeconds <= w.endSeconds,
      );
      if (activeWordIndex >= 0) {
        activeWord = activeSegment.words[activeWordIndex];
        activeWordConfidence =
          activeWord.alignmentConfidence ?? activeWord.confidence ?? null;
        const wStart = activeWord.startSeconds ?? 0;
        const wEnd = activeWord.endSeconds ?? wStart;
        const span = Math.max(0.001, wEnd - wStart);
        wordProgress = Math.max(0, Math.min(1, (currentTimeSeconds - wStart) / span));

        if (activeWord.units.length > 0) {
          activeUnitIndex = activeWord.units.findIndex(
            (u) =>
              u.startSeconds !== null &&
              u.endSeconds !== null &&
              currentTimeSeconds >= u.startSeconds &&
              currentTimeSeconds <= u.endSeconds,
          );
        }
      }
    }

    return {
      activeSegmentIndex,
      activeSegment,
      activeWordIndex,
      activeWord,
      activeUnitIndex,
      wordProgress,
      reviewRequiredCount,
      activeWordConfidence,
      canonical,
      aligned,
    };
  }, [document, currentTimeSeconds, canonical, aligned, reviewRequiredCount]);
}
