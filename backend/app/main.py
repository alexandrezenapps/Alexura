"""
Alexura AI Lyrics Sync Engine — FastAPI Application Entrypoint.
Launch locally with:
  uvicorn backend.app.main:app --reload --port 8000
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api.routes import router as v1_router
from .core.config import get_settings
from .core.logging import get_logger

settings = get_settings()
logger = get_logger("alexura.api", settings.log_level)

app = FastAPI(
    title=settings.app_name,
    version=settings.api_version,
    description=(
        "Phase 1 Architecture Foundation for AI Lyrics Recognition, Forced Alignment, "
        "and Karaoke Synchronization. All timestamps are in seconds relative to original audio."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.allowed_origins),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-File-Name", "X-Chunk-Index"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error on %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse(
        status_code=500,
        content={"success": False, "error": "internal_server_error"},
    )


app.include_router(v1_router)
