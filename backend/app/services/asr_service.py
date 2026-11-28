"""Singing ASR service orchestrating primary recognition, quality check, fallback routing, and aligner handoff."""

from __future__ import annotations

from pathlib import Path
from typing import Any, List, Optional

from ..adapters.asr_service import (
    GeminiASRAdapter as UnifiedGeminiASRAdapter,
    LocalSingingASRAdapter as UnifiedLocalSingingASRAdapter,
    ModelRoutingStrategy,
    SingingASRAdapter as UnifiedSingingASRAdapter,
    WhisperSingingAdapter,
)
from ..adapters.singing_asr import SingingASRAdapter, UnconfiguredSingingASRAdapter
from ..core.config import Settings, get_settings
from ..schemas.lyrics import LyricSegment


class ASRService:
    def __init__(
        self,
        settings: Optional[Settings] = None,
        adapter: Optional[SingingASRAdapter] = None,
        primary_adapter: Optional[UnifiedSingingASRAdapter] = None,
        fallback_adapters: Optional[List[UnifiedSingingASRAdapter]] = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.adapter = adapter or UnconfiguredSingingASRAdapter(
            endpoint_configured=bool(self.settings.singing_asr_endpoint),
            gemini_configured=self.settings.gemini_configured,
        )
        primary = primary_adapter or UnifiedGeminiASRAdapter(api_key=self.settings.gemini_api_key)
        fallbacks = (
            fallback_adapters
            if fallback_adapters is not None
            else [WhisperSingingAdapter(), UnifiedLocalSingingASRAdapter()]
        )
        self.router = ModelRoutingStrategy(primary=primary, fallbacks=fallbacks)

    async def transcribe(
        self,
        audio_path: Path,
        language_hint: str = "auto",
        draft_lyrics_text: Optional[str] = None,
    ) -> List[LyricSegment]:
        return await self.adapter.transcribe_singing(
            audio_path=audio_path,
            language_hint=language_hint,
            draft_lyrics_text=draft_lyrics_text,
        )

    async def transcribe_with_routing(
        self,
        audio_path: str | Path,
        language: Optional[str] = None,
        expected_duration: Optional[float] = None,
    ) -> dict[str, Any]:
        return await self.router.transcribe_with_routing(
            audio_path=str(audio_path),
            language=language,
            expected_duration=expected_duration,
        )
