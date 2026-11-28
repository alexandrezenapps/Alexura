"""Unified Forced Alignment Adapter with segment-to-original coordinate remapping."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

from ..core.validation_rules import remap_segment_alignment_to_original
from ..schemas.lyrics import LyricSegment
from .base import AdapterCapabilityInfo
from .forced_alignment import ForcedAlignmentAdapter, UnconfiguredForcedAlignmentAdapter


class AlignerAdapter(ForcedAlignmentAdapter):
    def __init__(self, endpoint_url: str = "") -> None:
        self._delegate = UnconfiguredForcedAlignmentAdapter(endpoint_url=endpoint_url)

    def describe_capability(self) -> AdapterCapabilityInfo:
        return self._delegate.describe_capability()

    async def align_segments(
        self,
        audio_path: Path,
        segments: List[LyricSegment],
        vocal_stem_path: Optional[Path] = None,
    ) -> List[LyricSegment]:
        return await self._delegate.align_segments(
            audio_path=audio_path,
            segments=segments,
            vocal_stem_path=vocal_stem_path,
        )

    @staticmethod
    def remap_segment_to_original(
        segment: Dict[str, Any],
        mapping: Dict[str, Any],
    ) -> Dict[str, Any]:
        return remap_segment_alignment_to_original(segment, mapping)
