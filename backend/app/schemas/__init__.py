"""Pydantic v2 request, response, and normalized domain schemas."""

from .jobs import (
    AnalyzeSongRequest,
    AudioAssetRecord,
    JobTransitionRecord,
    ProcessingJob,
)
from .lyrics import (
    LyricSegment,
    LyricsDocument,
    LyricsUpdateRequest,
    LyricUnit,
    LyricWord,
)

__all__ = [
    "AnalyzeSongRequest",
    "AudioAssetRecord",
    "JobTransitionRecord",
    "LyricSegment",
    "LyricsDocument",
    "LyricsUpdateRequest",
    "LyricUnit",
    "LyricWord",
    "ProcessingJob",
]
