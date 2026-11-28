"""
Normalized Pydantic v2 JSON Schema for LyricsDocument, LyricSegment, LyricWord, and LyricUnit.
All timestamps are strictly represented in seconds (>= 0.0) relative to the original audio file.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, model_validator

from ..core.validation_rules import validate_lyrics_document_dict

UnitType = Literal["character", "syllable", "mora", "phoneme"]
ElementAlignmentState = Literal["unaligned", "manual", "aligned"]
DocumentAlignmentStatus = Literal[
    "unaligned",
    "phase1_placeholder",
    "partial_manual",
    "aligned",
    "validated",
]
DocumentSource = Literal[
    "phase1_stub",
    "manual_editor",
    "singing_asr_adapter",
    "forced_alignment_adapter",
]
SectionType = Literal[
    "intro",
    "verse",
    "pre_chorus",
    "chorus",
    "bridge",
    "outro",
    "instrumental",
    "speech",
    "other",
]
VocalType = Literal[
    "lead",
    "backing",
    "harmony",
    "overlapping",
    "speech",
    "instrumental",
    "unclear",
]


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class LyricUnit(BaseModel):
    unitId: str = Field(..., min_length=1)
    text: str = Field(..., min_length=1)
    unitType: UnitType = "character"
    startSeconds: Optional[float] = Field(
        default=None,
        ge=0.0,
        description="Start timestamp in seconds relative to original audio, or null when unaligned.",
    )
    endSeconds: Optional[float] = Field(
        default=None,
        ge=0.0,
        description="End timestamp in seconds relative to original audio, or null when unaligned.",
    )
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    alignmentState: ElementAlignmentState = "unaligned"


class LyricWord(BaseModel):
    wordId: str = Field(..., min_length=1)
    text: str = Field(..., min_length=1)
    startSeconds: Optional[float] = Field(
        default=None,
        ge=0.0,
        description="Start timestamp in seconds relative to original audio, or null when unaligned.",
    )
    endSeconds: Optional[float] = Field(
        default=None,
        ge=0.0,
        description="End timestamp in seconds relative to original audio, or null when unaligned.",
    )
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    alignmentConfidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    alignmentState: ElementAlignmentState = "unaligned"
    reviewRequired: Optional[bool] = None
    speaker: Optional[str] = None
    flags: List[str] = Field(default_factory=list)
    units: List[LyricUnit] = Field(default_factory=list)


class LyricSegment(BaseModel):
    segmentId: str = Field(..., min_length=1)
    index: int = Field(..., ge=0)
    text: str = Field(default="")
    startSeconds: Optional[float] = Field(
        default=None,
        ge=0.0,
        description="Segment start timestamp in seconds relative to original audio, or null when unaligned.",
    )
    endSeconds: Optional[float] = Field(
        default=None,
        ge=0.0,
        description="Segment end timestamp in seconds relative to original audio, or null when unaligned.",
    )
    language: Optional[str] = None
    sectionType: SectionType = "verse"
    vocalType: VocalType = "lead"
    speaker: Optional[str] = "Lead"
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    alignmentState: ElementAlignmentState = "unaligned"
    isPlaceholder: bool = False
    words: List[LyricWord] = Field(default_factory=list)


class LyricsDocument(BaseModel):
    schemaVersion: Literal["1.0.0"] = "1.0.0"
    documentId: str = Field(..., min_length=1)
    audioId: str = Field(..., min_length=1)
    jobId: Optional[str] = None
    title: str = Field(default="Untitled Track", max_length=240)
    artist: str = Field(default="", max_length=240)
    primaryLanguage: str = Field(default="auto")
    detectedLanguages: List[str] = Field(default_factory=list)
    durationSeconds: float = Field(default=0.0, ge=0.0)
    timelineOriginSeconds: Literal[0] = 0
    preservesOriginalAudio: Literal[True] = True
    alignmentStatus: DocumentAlignmentStatus = "phase1_placeholder"
    source: DocumentSource = "phase1_stub"
    version: int = Field(default=1, ge=1)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    segments: List[LyricSegment] = Field(default_factory=list)
    createdAt: str = Field(default_factory=_utc_now_iso)
    updatedAt: str = Field(default_factory=_utc_now_iso)

    @model_validator(mode="after")
    def validate_normalized_invariants(self) -> "LyricsDocument":
        report = validate_lyrics_document_dict(self.model_dump())
        if not report.valid:
            summary = "; ".join(f"{iss.path}: {iss.message}" for iss in report.issues[:5])
            raise ValueError(f"Normalized lyrics validation failed: {summary}")
        return self


class LyricsUpdateRequest(BaseModel):
    title: Optional[str] = Field(default=None, max_length=240)
    artist: Optional[str] = Field(default=None, max_length=240)
    primaryLanguage: Optional[str] = Field(default=None, max_length=32)
    alignmentStatus: Optional[DocumentAlignmentStatus] = None
    segments: List[LyricSegment]


class AnalysisSegmentMapping(BaseModel):
    analysis_segment_id: str = Field(..., min_length=1)
    analysis_start: float = Field(..., ge=0.0)
    analysis_end: float = Field(..., ge=0.0)
    original_start: float = Field(..., ge=0.0)
    original_end: float = Field(..., ge=0.0)

    @model_validator(mode="after")
    def validate_spans(self) -> "AnalysisSegmentMapping":
        if self.analysis_end <= self.analysis_start:
            raise ValueError("analysis_end must be > analysis_start")
        if self.original_end <= self.original_start:
            raise ValueError("original_end must be > original_start")
        return self


class CanonicalAlignmentUnit(BaseModel):
    text: str = Field(..., min_length=1)
    start: Optional[float] = Field(default=None, ge=0.0)
    end: Optional[float] = Field(default=None, ge=0.0)


class CanonicalAlignmentWord(BaseModel):
    id: str = Field(..., min_length=1)
    text: str = Field(..., min_length=1)
    start: Optional[float] = Field(default=None, ge=0.0)
    end: Optional[float] = Field(default=None, ge=0.0)
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    alignment_confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    units: List[CanonicalAlignmentUnit] = Field(default_factory=list)


class CanonicalAlignmentSegment(BaseModel):
    id: str = Field(..., min_length=1)
    text: str = Field(default="")
    start: Optional[float] = Field(default=None, ge=0.0)
    end: Optional[float] = Field(default=None, ge=0.0)
    words: List[CanonicalAlignmentWord] = Field(default_factory=list)


class CanonicalSongAlignmentDocument(BaseModel):
    song_id: str = Field(..., min_length=1)
    audio_duration: float = Field(..., ge=0.0)
    language: str = Field(default="auto", min_length=1)
    transcription_status: Literal["pending", "in_progress", "completed", "failed", "manual"] = "completed"
    alignment_status: Literal["unaligned", "partial", "completed", "validated", "failed"] = "unaligned"
    alignment_version: str = Field(default="v1", min_length=1)
    segments: List[CanonicalAlignmentSegment] = Field(default_factory=list)


class AlignedLyricUnit(BaseModel):
    id: str = Field(..., min_length=1)
    text: str = Field(..., min_length=1)
    start: float = Field(..., ge=0.0)
    end: float = Field(..., ge=0.0)
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)


class AlignedLyricWord(BaseModel):
    id: str = Field(..., min_length=1)
    text: str = Field(..., min_length=1)
    start: float = Field(..., ge=0.0)
    end: float = Field(..., ge=0.0)
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    alignmentConfidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    units: Optional[List[AlignedLyricUnit]] = None
    reviewRequired: Optional[bool] = None


class AlignedLyricSegment(BaseModel):
    id: str = Field(..., min_length=1)
    text: str = Field(default="")
    start: float = Field(..., ge=0.0)
    end: float = Field(..., ge=0.0)
    words: List[AlignedLyricWord] = Field(default_factory=list)


class AlignedLyricsDocument(BaseModel):
    songId: str = Field(..., min_length=1)
    duration: float = Field(..., ge=0.0)
    language: str = Field(default="auto", min_length=1)
    segments: List[AlignedLyricSegment] = Field(default_factory=list)
    version: int = Field(default=1, ge=1)

