"""
Modular Forced Alignment Adapter Interface (Phase 1 Foundation).
IMPORTANT RULE:
- Do NOT fabricate or linearly interpolate fake word timestamps in Phase 1.
- Word and unit timestamps MUST remain None (unaligned) until a real CTC/phoneme
  forced aligner or manual human edit supplies genuine audio timestamps.
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from pathlib import Path
from typing import List, Optional

from ..schemas.lyrics import LyricSegment, LyricUnit, LyricWord
from .base import AdapterCapabilityInfo, AdapterStatus

_TOKEN_RE = re.compile(
    r"[A-Za-zÀ-ÿ0-9'’\-]+|[\u4e00-\u9fff]|[\u3040-\u30ff]|[\uac00-\ud7af]"
)


def tokenize_segment_unaligned(segment: LyricSegment) -> List[LyricWord]:
    """
    Create normalized LyricWord & LyricUnit tokens with STRICTLY null timestamps.
    Prepares segment structure for future CTC forced alignment without faking timings.
    """
    if segment.isPlaceholder or not segment.text.strip():
        return []
    raw_tokens = _TOKEN_RE.findall(segment.text)
    words: List[LyricWord] = []
    for w_idx, tok in enumerate(raw_tokens):
        units = [
            LyricUnit(
                unitId=f"{segment.segmentId}_w{w_idx:03d}_u{u_idx:02d}",
                text=ch,
                unitType="character",
                startSeconds=None,
                endSeconds=None,
                confidence=None,
                alignmentState="unaligned",
            )
            for u_idx, ch in enumerate(tok)
        ]
        words.append(
            LyricWord(
                wordId=f"{segment.segmentId}_w{w_idx:03d}",
                text=tok,
                startSeconds=None,
                endSeconds=None,
                confidence=None,
                alignmentState="unaligned",
                speaker=segment.speaker,
                flags=["unaligned_phase1"],
                units=units,
            )
        )
    return words


class ForcedAlignmentAdapter(ABC):
    """Abstract interface for word-, syllable-, and character-level CTC forced alignment."""

    @abstractmethod
    def describe_capability(self) -> AdapterCapabilityInfo:
        """Report honest runtime readiness and configuration state."""

    @abstractmethod
    async def align_segments(
        self,
        audio_path: Path,
        segments: List[LyricSegment],
        vocal_stem_path: Optional[Path] = None,
    ) -> List[LyricSegment]:
        """Align lyric segments & tokens against the audio timeline (seconds)."""


class UnconfiguredForcedAlignmentAdapter(ForcedAlignmentAdapter):
    """Honest Phase 1 adapter that structures words/units while keeping timestamps null."""

    def __init__(self, endpoint_url: str = "") -> None:
        self._endpoint_url = endpoint_url.strip()

    def describe_capability(self) -> AdapterCapabilityInfo:
        return AdapterCapabilityInfo(
            name="ForcedAlignmentAdapter",
            adapterClass="UnconfiguredForcedAlignmentAdapter",
            implementation="phase1_interface_only",
            status=AdapterStatus.UNCONFIGURED,
            isImplementedForProduction=False,
            note=(
                "Phase 1 stub adapter. Prepares LyricWord and LyricUnit tokenization "
                "with null timestamps (never fabricates fake word timings). "
                "Phase 2 attaches CTC phoneme/character forced alignment."
            ),
            phaseTarget="Phase 2 (CTC Forced Alignment + Phoneme/Char Mapping)",
        )

    async def align_segments(
        self,
        audio_path: Path,
        segments: List[LyricSegment],
        vocal_stem_path: Optional[Path] = None,
    ) -> List[LyricSegment]:
        structured: List[LyricSegment] = []
        for seg in segments:
            words = seg.words if seg.words else tokenize_segment_unaligned(seg)
            structured.append(
                seg.model_copy(
                    update={
                        "words": words,
                        "alignmentState": seg.alignmentState,
                    }
                )
            )
        return structured


class DevMockForcedAlignmentAdapter(ForcedAlignmentAdapter):
    """Explicitly labeled Development Mock adapter (zero fake timestamps)."""

    def describe_capability(self) -> AdapterCapabilityInfo:
        return AdapterCapabilityInfo(
            name="ForcedAlignmentAdapter",
            adapterClass="DevMockForcedAlignmentAdapter",
            implementation="development_mock",
            status=AdapterStatus.DEVELOPMENT_MOCK,
            isImplementedForProduction=False,
            note="Development mock — structures tokens without fabricating word timestamps.",
            phaseTarget="Phase 2",
        )

    async def align_segments(
        self,
        audio_path: Path,
        segments: List[LyricSegment],
        vocal_stem_path: Optional[Path] = None,
    ) -> List[LyricSegment]:
        return await UnconfiguredForcedAlignmentAdapter().align_segments(
            audio_path=audio_path,
            segments=segments,
            vocal_stem_path=vocal_stem_path,
        )
