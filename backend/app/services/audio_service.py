"""Audio ingestion & original timeline validation service."""

from __future__ import annotations

from typing import Optional

from ..core.config import Settings, get_settings
from ..schemas.jobs import AudioAssetRecord
from .storage import Phase1StorageService


class AudioService:
    """Preserves original uploaded audio bytes untouched on disk."""

    def __init__(
        self,
        settings: Optional[Settings] = None,
        storage: Optional[Phase1StorageService] = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.storage = storage or Phase1StorageService(self.settings)

    def ingest_bytes(
        self,
        raw_bytes: bytes,
        filename: str,
        mime_type: str = "audio/mpeg",
    ) -> AudioAssetRecord:
        return self.storage.save_uploaded_audio(
            raw_bytes=raw_bytes,
            original_filename=filename,
            mime_type=mime_type,
        )

    def get_asset(self, audio_id: str) -> Optional[AudioAssetRecord]:
        return self.storage.get_audio(audio_id)
