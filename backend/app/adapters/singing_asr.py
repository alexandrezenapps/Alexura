"""
Modular Singing-Aware Automatic Speech Recognition (ASR) Adapter Interface.
IMPORTANT: Phase 1 does NOT fake real AI singing recognition or emit fabricated transcripts.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from typing import List, Optional

from ..schemas.lyrics import LyricSegment
from .base import AdapterCapabilityInfo, AdapterStatus


class SingingASRAdapter(ABC):
    """Abstract interface for singing-aware transcription engines."""

    @abstractmethod
    def describe_capability(self) -> AdapterCapabilityInfo:
        """Report honest runtime readiness and configuration state."""

    @abstractmethod
    async def transcribe_singing(
        self,
        audio_path: Path,
        language_hint: str = "auto",
        draft_lyrics_text: Optional[str] = None,
    ) -> List[LyricSegment]:
        """Transcribe sung vocals or return explicit unaligned segments."""


class UnconfiguredSingingASRAdapter(SingingASRAdapter):
    """Honest default Phase 1 adapter when no external Singing ASR service is configured."""

    def __init__(self, endpoint_configured: bool = False, gemini_configured: bool = False) -> None:
        self._endpoint_configured = endpoint_configured
        self._gemini_configured = gemini_configured

    def describe_capability(self) -> AdapterCapabilityInfo:
        return AdapterCapabilityInfo(
            name="SingingASRAdapter",
            adapterClass="UnconfiguredSingingASRAdapter",
            implementation="phase1_interface_only",
            status=AdapterStatus.UNCONFIGURED,
            isImplementedForProduction=False,
            note=(
                "Phase 1 architecture adapter only. Real singing-aware ASR inference "
                "is deferred to Phase 2 (no fake lyrics recognition)."
            ),
            phaseTarget="Phase 2 (Gemini audio understanding + specialized Singing ASR)",
        )

    async def transcribe_singing(
        self,
        audio_path: Path,
        language_hint: str = "auto",
        draft_lyrics_text: Optional[str] = None,
    ) -> List[LyricSegment]:
        # Phase 1 preserves user-supplied draft lines as unaligned segments (null timestamps)
        # or returns an empty draft placeholder without fabricating AI-recognized lyrics.
        if draft_lyrics_text and draft_lyrics_text.strip():
            lines = [ln.strip() for ln in draft_lyrics_text.splitlines() if ln.strip()]
            return [
                LyricSegment(
                    segmentId=f"seg_{idx:03d}",
                    index=idx,
                    text=line,
                    startSeconds=None,
                    endSeconds=None,
                    language=None if language_hint == "auto" else language_hint,
                    sectionType="verse",
                    vocalType="lead",
                    alignmentState="unaligned",
                    isPlaceholder=False,
                    words=[],
                )
                for idx, line in enumerate(lines)
            ]

        return [
            LyricSegment(
                segmentId="seg_000",
                index=0,
                text="[Phase 1 Placeholder — Connect SingingASRAdapter in Phase 2 or enter lyrics manually]",
                startSeconds=None,
                endSeconds=None,
                language=None if language_hint == "auto" else language_hint,
                sectionType="other",
                vocalType="lead",
                alignmentState="unaligned",
                isPlaceholder=True,
                words=[],
            )
        ]


class DevMockSingingASRAdapter(SingingASRAdapter):
    """
    Explicitly labeled Development Mock adapter for local architecture testing.
    Does NOT generate fake word timestamps.
    """

    def describe_capability(self) -> AdapterCapabilityInfo:
        return AdapterCapabilityInfo(
            name="SingingASRAdapter",
            adapterClass="DevMockSingingASRAdapter",
            implementation="development_mock",
            status=AdapterStatus.DEVELOPMENT_MOCK,
            isImplementedForProduction=False,
            note="Development mock adapter — preserves user draft text with null timestamps.",
            phaseTarget="Phase 2",
        )

    async def transcribe_singing(
        self,
        audio_path: Path,
        language_hint: str = "auto",
        draft_lyrics_text: Optional[str] = None,
    ) -> List[LyricSegment]:
        fallback = UnconfiguredSingingASRAdapter()
        return await fallback.transcribe_singing(
            audio_path=audio_path,
            language_hint=language_hint,
            draft_lyrics_text=draft_lyrics_text,
        )
