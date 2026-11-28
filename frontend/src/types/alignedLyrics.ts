/**
 * Millisecond-Precision Aligned Lyrics Schema Contract.
 * Represents word- and unit-level alignment payloads with seconds (e.g. 32.417)
 * relative to the untouched original audio timeline (origin = 0.000s).
 */

export interface LyricUnit {
  id: string;
  text: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface LyricWord {
  id: string;
  text: string;
  start: number;
  end: number;

  confidence?: number;
  alignmentConfidence?: number;

  units?: LyricUnit[];
  reviewRequired?: boolean;
}

export interface LyricSegment {
  id: string;
  text: string;
  start: number;
  end: number;
  words: LyricWord[];
}

export interface LyricsDocument {
  songId: string;
  duration: number;
  language: string;
  segments: LyricSegment[];
  version: number;
}
