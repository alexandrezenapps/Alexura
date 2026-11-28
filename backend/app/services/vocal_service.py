"""Vocal separation orchestration service."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from ..adapters.vocal_separation import (
    UnconfiguredVocalSeparationAdapter,
    VocalSeparationAdapter,
    VocalSeparationResult,
)
from ..core.config import Settings, get_settings


class VocalService:
    def __init__(
        self,
        settings: Optional[Settings] = None,
        adapter: Optional[VocalSeparationAdapter] = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.adapter = adapter or UnconfiguredVocalSeparationAdapter(
            endpoint_url=self.settings.vocal_separation_endpoint
        )

    async def separate(self, audio_path: Path, output_dir: Path) -> VocalSeparationResult:
        return await self.adapter.separate_vocals(audio_path=audio_path, output_dir=output_dir)
