"""Modular upload router (/api/v1/audio/*) aligned with ai-lyrics-sync architecture."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from ..audio_service import AudioUploadService
from ..core.config import Settings, get_settings
from ..services.audio_service import AudioService
from ..services.storage import AudioValidationError

router = APIRouter(prefix="/api/v1", tags=["upload"])


def _get_audio_service(settings: Settings = Depends(get_settings)) -> AudioService:
    return AudioService(settings=settings)


@router.post("/audio/upload", status_code=201)
async def upload_audio(
    file: UploadFile = File(...),
    settings: Settings = Depends(get_settings),
    audio_service: AudioService = Depends(_get_audio_service),
) -> Dict[str, Any]:
    try:
        buf = bytearray()
        chunk_size = 1024 * 1024
        while True:
            chunk = await file.read(chunk_size)
            if not chunk:
                break
            if len(buf) + len(chunk) > settings.max_upload_bytes:
                raise AudioValidationError("audio_exceeds_max_upload_size")
            buf.extend(chunk)
        asset = audio_service.ingest_bytes(
            raw_bytes=bytes(buf),
            filename=file.filename or "audio.wav",
            mime_type=file.content_type or "application/octet-stream",
        )
        return {"success": True, "audio": asset.model_dump()}
    except AudioValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/audio")
def list_uploaded_audio(
    settings: Settings = Depends(get_settings),
) -> Dict[str, Any]:
    svc = AudioUploadService(
        storage_root=settings.data_dir,
        max_upload_bytes=settings.max_upload_bytes,
    )
    return {"success": True, "audioAssets": svc.list_audio(25)}


@router.get("/audio/{audio_id}")
def get_audio_metadata(
    audio_id: str,
    audio_service: AudioService = Depends(_get_audio_service),
) -> Dict[str, Any]:
    asset = audio_service.get_asset(audio_id)
    if not asset:
        raise HTTPException(status_code=404, detail="audio_not_found")
    return {"success": True, "audio": asset.model_dump()}


@router.get("/audio/{audio_id}/stream")
def stream_original_audio(
    audio_id: str,
    audio_service: AudioService = Depends(_get_audio_service),
) -> FileResponse:
    asset = audio_service.get_asset(audio_id)
    if not asset:
        raise HTTPException(status_code=404, detail="audio_not_found")
    resolved = Path(asset.storagePath).resolve()
    if not resolved.is_relative_to(audio_service.storage.audio_dir.resolve()) or not resolved.exists():
        raise HTTPException(status_code=404, detail="audio_not_found")
    return FileResponse(
        path=resolved,
        media_type=asset.mimeType,
        filename=asset.filename,
    )
