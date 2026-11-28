"""Gemini Singing ASR Adapter (server-side API key only)."""

from __future__ import annotations

from pathlib import Path
from typing import Any, List, Optional

from ..core.config import Settings, get_settings
from ..schemas.lyrics import LyricSegment
from .asr_service import (
    GeminiASRAdapter as UnifiedGeminiASRAdapter,
    SingingASRAdapter as UnifiedSingingASRAdapter,
)
from .base import AdapterCapabilityInfo
from .singing_asr import SingingASRAdapter, UnconfiguredSingingASRAdapter


class GeminiASRAdapter(SingingASRAdapter, UnifiedSingingASRAdapter):
    """Server-side Gemini audio transcription adapter implementing both unified transcribe() and Phase 1 pipeline interface."""

    def __init__(self, settings: Optional[Settings] = None) -> None:
        self.settings = settings or get_settings()
        self._unified = UnifiedGeminiASRAdapter(api_key=self.settings.gemini_api_key)
        self._fallback = UnconfiguredSingingASRAdapter(
            endpoint_configured=bool(self.settings.singing_asr_endpoint),
            gemini_configured=self.settings.gemini_configured,
        )

    def describe_capability(self) -> AdapterCapabilityInfo:
        return self._unified.describe_capability()

    async def transcribe(
        self,
        audio_path: str,
        language: str | None = None,
    ) -> dict[str, Any]:
        return await self._unified.transcribe(audio_path=audio_path, language=language)

    async def transcribe_singing(
        self,
        audio_path: Path,
        language_hint: str = "auto",
        draft_lyrics_text: Optional[str] = None,
    ) -> List[LyricSegment]:
        return await self._fallback.transcribe_singing(
            audio_path=audio_path,
            language_hint=language_hint,
            draft_lyrics_text=draft_lyrics_text,
        )
