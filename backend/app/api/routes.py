"""
FastAPI v1 REST Routes for the Alexura AI Lyrics Sync Engine (Phase 1):
- Audio upload endpoint
- Song analysis endpoint
- Processing job status endpoint
- Lyrics retrieval endpoint
- Lyrics editing endpoint
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from ..core.config import Settings, get_settings
from ..schemas.jobs import AnalyzeSongRequest, ProcessingJob
from ..schemas.lyrics import AlignedLyricsDocument, LyricsDocument, LyricsUpdateRequest
from ..services.storage import AudioValidationError, Phase1StorageService
from ..workers.pipeline_worker import PipelineOrchestrator

router = APIRouter(prefix="/api/v1", tags=["sync-engine-v1"])


def _get_storage(settings: Settings = Depends(get_settings)) -> Phase1StorageService:
    return Phase1StorageService(settings)


def _get_orchestrator(
    settings: Settings = Depends(get_settings),
    storage: Phase1StorageService = Depends(_get_storage),
) -> PipelineOrchestrator:
    return PipelineOrchestrator(settings=settings, storage=storage)


@router.get("/health")
def health(
    settings: Settings = Depends(get_settings),
    orchestrator: PipelineOrchestrator = Depends(_get_orchestrator),
) -> Dict[str, Any]:
    return {
        "ok": True,
        "service": settings.app_name,
        "phase": settings.phase,
        "adapters": orchestrator.describe_adapters(),
    }


@router.get("/adapters")
def adapter_status(
    orchestrator: PipelineOrchestrator = Depends(_get_orchestrator),
) -> Dict[str, Any]:
    return {"success": True, "adapters": orchestrator.describe_adapters()}


@router.get("/schemas/lyrics")
def normalized_lyrics_schema() -> Dict[str, Any]:
    return Phase1StorageService.load_normalized_json_schema()


@router.post("/audio/upload", status_code=201)
async def upload_audio(
    file: UploadFile = File(...),
    settings: Settings = Depends(get_settings),
    storage: Phase1StorageService = Depends(_get_storage),
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
        asset = storage.save_uploaded_audio(
            raw_bytes=bytes(buf),
            original_filename=file.filename or "audio.wav",
            mime_type=file.content_type or "application/octet-stream",
        )
        return {"success": True, "audio": asset.model_dump()}
    except AudioValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/audio")
def list_uploaded_audio(
    settings: Settings = Depends(get_settings),
) -> Dict[str, Any]:
    from ..audio_service import AudioUploadService

    svc = AudioUploadService(
        storage_root=settings.data_dir,
        max_upload_bytes=settings.max_upload_bytes,
    )
    return {"success": True, "audioAssets": svc.list_audio(25)}


@router.get("/audio/{audio_id}")
def get_audio_metadata(
    audio_id: str,
    storage: Phase1StorageService = Depends(_get_storage),
) -> Dict[str, Any]:
    asset = storage.get_audio(audio_id)
    if not asset:
        raise HTTPException(status_code=404, detail="audio_not_found")
    return {"success": True, "audio": asset.model_dump()}


@router.get("/audio/{audio_id}/stream")
def stream_original_audio(
    audio_id: str,
    storage: Phase1StorageService = Depends(_get_storage),
) -> FileResponse:
    asset = storage.get_audio(audio_id)
    if not asset:
        raise HTTPException(status_code=404, detail="audio_not_found")
    resolved_audio = Path(asset.storagePath).resolve()
    if not resolved_audio.is_relative_to(storage.audio_dir.resolve()) or not resolved_audio.exists():
        raise HTTPException(status_code=404, detail="audio_not_found")
    return FileResponse(
        path=resolved_audio,
        media_type=asset.mimeType,
        filename=asset.filename,
    )


@router.post("/jobs/analyze", status_code=202)
def analyze_song(
    req: AnalyzeSongRequest,
    background_tasks: BackgroundTasks,
    storage: Phase1StorageService = Depends(_get_storage),
    orchestrator: PipelineOrchestrator = Depends(_get_orchestrator),
) -> Dict[str, Any]:
    audio = storage.get_audio(req.audioId)
    if not audio:
        raise HTTPException(status_code=404, detail="audio_not_found")
    job: ProcessingJob = orchestrator.create_queued_job(req)
    background_tasks.add_task(orchestrator.execute_job, job.jobId, req)
    return {"success": True, "job": job.model_dump()}


@router.get("/jobs")
def list_jobs(
    format: str | None = None,
    storage: Phase1StorageService = Depends(_get_storage),
) -> Dict[str, Any]:
    raw_jobs = storage.list_jobs(25)
    jobs = (
        [j.to_canonical().model_dump(exclude_none=True) for j in raw_jobs]
        if format == "canonical"
        else [j.model_dump() for j in raw_jobs]
    )
    return {"success": True, "jobs": jobs}


@router.get("/jobs/{job_id}")
def get_job_status(
    job_id: str,
    format: str | None = None,
    storage: Phase1StorageService = Depends(_get_storage),
) -> Dict[str, Any]:
    job = storage.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job_not_found")
    if format == "canonical":
        return job.to_canonical().model_dump(exclude_none=True)
    return {"success": True, "job": job.model_dump()}


@router.get("/jobs/{job_id}/canonical")
def get_canonical_job_status(
    job_id: str,
    storage: Phase1StorageService = Depends(_get_storage),
) -> Dict[str, Any]:
    job = storage.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job_not_found")
    return job.to_canonical().model_dump(exclude_none=True)


@router.get("/lyrics")
def list_lyrics_documents(storage: Phase1StorageService = Depends(_get_storage)) -> Dict[str, Any]:
    docs = [d.model_dump() for d in storage.list_lyrics(25)]
    return {"success": True, "documents": docs}


@router.get("/lyrics/{document_id}")
def get_lyrics_document(
    document_id: str,
    storage: Phase1StorageService = Depends(_get_storage),
) -> Dict[str, Any]:
    doc = storage.get_lyrics(document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="lyrics_document_not_found")
    return {"success": True, "document": doc.model_dump()}


@router.put("/lyrics/{document_id}")
def edit_lyrics_document(
    document_id: str,
    req: LyricsUpdateRequest,
    storage: Phase1StorageService = Depends(_get_storage),
    orchestrator: PipelineOrchestrator = Depends(_get_orchestrator),
) -> Dict[str, Any]:
    existing = storage.get_lyrics(document_id)
    if not existing:
        raise HTTPException(status_code=404, detail="lyrics_document_not_found")

    try:
        updated = LyricsDocument(
            **{
                **existing.model_dump(),
                "title": req.title if req.title is not None else existing.title,
                "artist": req.artist if req.artist is not None else existing.artist,
                "primaryLanguage": (
                    req.primaryLanguage
                    if req.primaryLanguage is not None
                    else existing.primaryLanguage
                ),
                "alignmentStatus": (
                    req.alignmentStatus
                    if req.alignmentStatus is not None
                    else "partial_manual"
                ),
                "source": "manual_editor",
                "segments": [seg.model_dump() for seg in req.segments],
                "updatedAt": datetime.now(timezone.utc).isoformat(),
            }
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    report = orchestrator.validation_service.validate(updated)
    if not report.valid:
        raise HTTPException(status_code=422, detail=report.issues[0].message)

    saved = storage.save_lyrics(updated)
    return {"success": True, "document": saved.model_dump()}


@router.get("/lyrics/{document_id}/canonical")
def get_canonical_lyrics(
    document_id: str,
    storage: Phase1StorageService = Depends(_get_storage),
) -> Dict[str, Any]:
    doc = storage.get_lyrics(document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="lyrics_document_not_found")
    from ..services.validation_service import ValidationService

    return ValidationService().to_canonical_song(doc.model_dump())


@router.get("/lyrics/{document_id}/aligned")
def get_aligned_lyrics(
    document_id: str,
    storage: Phase1StorageService = Depends(_get_storage),
) -> Dict[str, Any]:
    doc = storage.get_lyrics(document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="lyrics_document_not_found")
    from ..services.validation_service import ValidationService

    return ValidationService().to_aligned_lyrics(doc.model_dump())


@router.put("/lyrics/{document_id}/aligned")
def update_aligned_lyrics(
    document_id: str,
    req: AlignedLyricsDocument,
    storage: Phase1StorageService = Depends(_get_storage),
) -> Dict[str, Any]:
    existing = storage.get_lyrics(document_id)
    if not existing:
        raise HTTPException(status_code=404, detail="lyrics_document_not_found")
    from ..services.validation_service import ValidationService

    svc = ValidationService()
    payload = req.model_dump(exclude_none=True)
    report = svc.validate_aligned_lyrics(payload)
    if not report.valid:
        raise HTTPException(status_code=422, detail=report.issues[0].message)

    converted_dict = svc.from_aligned_lyrics(payload, document_id=existing.documentId)
    converted_dict["createdAt"] = existing.createdAt
    converted_dict["jobId"] = existing.jobId
    converted_dict["title"] = existing.title
    converted_dict["artist"] = existing.artist
    converted_dict["version"] = max(existing.version + 1, int(payload.get("version", 1)))
    saved = storage.save_lyrics(LyricsDocument(**converted_dict))
    return {
        "success": True,
        "document": saved.model_dump(),
        "aligned": svc.to_aligned_lyrics(saved.model_dump()),
    }


@router.post("/lyrics/import-aligned", status_code=201)
def import_aligned_lyrics(
    req: AlignedLyricsDocument,
    storage: Phase1StorageService = Depends(_get_storage),
) -> Dict[str, Any]:
    from ..services.validation_service import ValidationService

    svc = ValidationService()
    payload = req.model_dump(exclude_none=True)
    report = svc.validate_aligned_lyrics(payload)
    if not report.valid:
        raise HTTPException(status_code=422, detail=report.issues[0].message)

    converted = LyricsDocument(**svc.from_aligned_lyrics(payload))
    saved = storage.save_lyrics(converted)
    return {
        "success": True,
        "document": saved.model_dump(),
        "aligned": svc.to_aligned_lyrics(saved.model_dump()),
    }


@router.get("/projects")
def list_projects(storage: Phase1StorageService = Depends(_get_storage)) -> Dict[str, Any]:
    docs = storage.list_lyrics(25)
    return {
        "success": True,
        "projects": [
            {
                "documentId": d.documentId,
                "song_id": d.audioId or d.documentId,
                "title": d.title,
                "artist": d.artist,
                "language": d.primaryLanguage,
                "durationSeconds": d.durationSeconds,
                "alignmentStatus": d.alignmentStatus,
                "version": d.version,
                "updatedAt": d.updatedAt,
            }
            for d in docs
        ],
    }


@router.get("/projects/{document_id}")
def get_project(
    document_id: str,
    storage: Phase1StorageService = Depends(_get_storage),
) -> Dict[str, Any]:
    doc = storage.get_lyrics(document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="project_not_found")
    from ..services.validation_service import ValidationService

    svc = ValidationService()
    return {
        "success": True,
        "document": doc.model_dump(),
        "song_alignment": svc.to_canonical_song(doc.model_dump()),
        "aligned_lyrics": svc.to_aligned_lyrics(doc.model_dump()),
    }

