"""
Alexura AI Lyrics Sync Engine — FastAPI Application Entrypoint.

Launch locally from `backend/`:
  cd backend
  uvicorn app.main:app --reload --port 8000

Or from repository root:
  uvicorn backend.app.main:app --reload --port 8000
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Dict

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse


def _load_dotenv_if_present() -> None:
    """Load optional backend/.env or root .env variables without external dependencies."""
    backend_dir = Path(__file__).resolve().parents[1]
    candidates = [backend_dir / ".env", backend_dir.parent / ".env"]
    for env_path in candidates:
        if not env_path.is_file():
            continue
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


_load_dotenv_if_present()

from .api.routes import router as v1_router  # noqa: E402
from .audio_service import AudioUploadService  # noqa: E402
from .core.config import get_settings  # noqa: E402
from .core.logging import get_logger  # noqa: E402

settings = get_settings()
logger = get_logger("alexura.api", settings.log_level)

raw_cors = os.environ.get("CORS_ALLOWED_ORIGINS", "").strip()
cors_origins = (
    [o.strip() for o in raw_cors.split(",") if o.strip()]
    if raw_cors
    else list(settings.allowed_origins)
)

app = FastAPI(
    title=settings.app_name,
    version=settings.api_version,
    description=(
        "Real Audio Upload Service & Phase 1 Architecture Foundation for AI Lyrics Recognition, "
        "Forced Alignment, and Karaoke Synchronization."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-File-Name", "X-Chunk-Index"],
)


@app.on_event("startup")
def _ensure_storage_ready() -> None:
    AudioUploadService(storage_root=settings.data_dir, max_upload_bytes=settings.max_upload_bytes)
    logger.info("Audio upload storage initialized at %s", settings.data_dir)


@app.get("/health")
def root_health() -> Dict[str, object]:
    return {
        "ok": True,
        "service": settings.app_name,
        "storageDir": str(settings.data_dir),
        "maxUploadMb": settings.max_upload_bytes // (1024 * 1024),
    }


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error on %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse(
        status_code=500,
        content={"success": False, "error": "internal_server_error"},
    )


app.include_router(v1_router)
