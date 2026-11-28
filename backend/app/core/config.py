"""
Server-side configuration for the Alexura AI Lyrics Sync Engine.
All API keys and external microservice endpoints MUST stay in server-side
environment variables and MUST NEVER be exposed to frontend client bundles.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    app_name: str = "Alexura AI Lyrics Sync Engine"
    api_version: str = "1.0.0"
    phase: str = "phase_1_foundation"
    log_level: str = os.environ.get("ALEXURA_LOG_LEVEL", "INFO")
    data_dir: Path = Path(
        os.environ.get("ALEXURA_DATA_DIR") or str(Path(__file__).resolve().parents[2] / "storage")
    ).resolve()
    max_upload_bytes: int = int(os.environ.get("MAX_UPLOAD_MB", "100")) * 1024 * 1024
    # Server-side secrets & external adapter URLs (never leaked to frontend)
    gemini_api_key: str = os.environ.get("GEMINI_API_KEY", "")
    singing_asr_endpoint: str = os.environ.get("SINGING_ASR_ENDPOINT", "")
    vocal_separation_endpoint: str = os.environ.get("VOCAL_SEPARATION_ENDPOINT", "")
    forced_alignment_endpoint: str = os.environ.get("FORCED_ALIGNMENT_ENDPOINT", "")
    allowed_origins: tuple[str, ...] = (
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    )

    @property
    def gemini_configured(self) -> bool:
        val = self.gemini_api_key.strip()
        return bool(val and val != "MY_GEMINI_API_KEY")


def get_settings() -> Settings:
    cfg = Settings()
    cfg.data_dir.mkdir(parents=True, exist_ok=True)
    (cfg.data_dir / "audio").mkdir(parents=True, exist_ok=True)
    (cfg.data_dir / "jobs").mkdir(parents=True, exist_ok=True)
    (cfg.data_dir / "lyrics").mkdir(parents=True, exist_ok=True)
    return cfg
