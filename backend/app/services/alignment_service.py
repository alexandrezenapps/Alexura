"""
Forced Alignment & Segment Coordinate Remapping Service.
Maps slice/analysis-space timestamps strictly back onto the original audio timeline.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

from ..adapters.forced_alignment import ForcedAlignmentAdapter, UnconfiguredForcedAlignmentAdapter
from ..core.config import Settings, get_settings
from ..core.validation_rules import (
    ValidationIssue,
    remap_analysis_timestamp_to_original,
    remap_segment_alignment_to_original,
    validate_analysis_segment_mapping,
)
from ..schemas.lyrics import LyricSegment


class AlignmentService:
    def __init__(
        self,
        settings: Optional[Settings] = None,
        adapter: Optional[ForcedAlignmentAdapter] = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.adapter = adapter or UnconfiguredForcedAlignmentAdapter(
            endpoint_url=self.settings.forced_alignment_endpoint
        )

    async def align_segments(
        self,
        audio_path: Path,
        segments: List[LyricSegment],
        vocal_stem_path: Optional[Path] = None,
    ) -> List[LyricSegment]:
        return await self.adapter.align_segments(
            audio_path=audio_path,
            segments=segments,
            vocal_stem_path=vocal_stem_path,
        )

    @staticmethod
    def validate_mapping(
        mapping: Dict[str, Any],
        original_duration: Optional[float] = None,
    ) -> List[ValidationIssue]:
        return validate_analysis_segment_mapping(mapping, original_duration=original_duration)

    @staticmethod
    def remap_timestamp(analysis_time_sec: float, mapping: Dict[str, Any]) -> float:
        return remap_analysis_timestamp_to_original(analysis_time_sec, mapping)

    @staticmethod
    def remap_segment(
        segment: Dict[str, Any],
        mapping: Dict[str, Any],
    ) -> Dict[str, Any]:
        return remap_segment_alignment_to_original(segment, mapping)
