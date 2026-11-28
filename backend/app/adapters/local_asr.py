"""Local Singing ASR Adapter (Whisper / draft-preserving local fallback)."""

from __future__ import annotations

from pathlib import Path
from typing import Any, List, Optional

from ..schemas.lyrics import LyricSegment
from .asr_service import (
    LocalSingingASRAdapter as UnifiedLocalSingingASRAdapter,
    SingingASRAdapter as UnifiedSingingASRAdapter,
)
from .base import AdapterCapabilityInfo
from .singing_asr import SingingASRAdapter, UnconfiguredSingingASRAdapter


class LocalSingingASRAdapter(SingingASRAdapter, UnifiedSingingASRAdapter):
    def __init__(self, model_dir: str = "") -> None:
        self._unified = UnifiedLocalSingingASRAdapter(model_dir=model_dir)
        self._delegate = UnconfiguredSingingASRAdapter()

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
        return await self._delegate.transcribe_singing(
            audio_path=audio_path,
            language_hint=language_hint,
            draft_lyrics_text=draft_lyrics_text,
        )


LocalASRAdapter = LocalSingingASRAdapter
