"""Modular projects & canonical lyrics export router (/api/v1/projects/*, /api/v1/lyrics/*)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException

from ..core.config import Settings, get_settings
from ..schemas.lyrics import LyricsDocument, LyricsUpdateRequest
from ..services.storage import Phase1StorageService
from ..services.validation_service import ValidationService

router = APIRouter(prefix="/api/v1", tags=["projects"])


def _get_storage(settings: Settings = Depends(get_settings)) -> Phase1StorageService:
    return Phase1StorageService(settings)


@router.get("/projects")
def list_projects(storage: Phase1StorageService = Depends(_get_storage)) -> Dict[str, Any]:
    docs = storage.list_lyrics(25)
    projects = [
        {
            "documentId": d.documentId,
            "song_id": d.audioId or d.documentId,
            "title": d.title,
            "artist": d.artist,
            "language": d.primaryLanguage,
            "durationSeconds": d.durationSeconds,
            "alignmentStatus": d.alignmentStatus,
            "updatedAt": d.updatedAt,
        }
        for d in docs
    ]
    return {"success": True, "projects": projects}


@router.get("/projects/{document_id}")
def get_project_detail(
    document_id: str,
    storage: Phase1StorageService = Depends(_get_storage),
) -> Dict[str, Any]:
    doc = storage.get_lyrics(document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="project_not_found")
    validator = ValidationService()
    return {
        "success": True,
        "document": doc.model_dump(),
        "song_alignment": validator.to_canonical_song(doc.model_dump()),
    }


@router.get("/lyrics")
def list_lyrics_documents(storage: Phase1StorageService = Depends(_get_storage)) -> Dict[str, Any]:
    return {"success": True, "documents": [d.model_dump() for d in storage.list_lyrics(25)]}


@router.get("/lyrics/{document_id}")
def get_lyrics_document(
    document_id: str,
    storage: Phase1StorageService = Depends(_get_storage),
) -> Dict[str, Any]:
    doc = storage.get_lyrics(document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="lyrics_document_not_found")
    return {"success": True, "document": doc.model_dump()}


@router.get("/lyrics/{document_id}/canonical")
def get_canonical_song_alignment(
    document_id: str,
    storage: Phase1StorageService = Depends(_get_storage),
) -> Dict[str, Any]:
    doc = storage.get_lyrics(document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="lyrics_document_not_found")
    validator = ValidationService()
    return validator.to_canonical_song(doc.model_dump())


@router.put("/lyrics/{document_id}")
def edit_lyrics_document(
    document_id: str,
    req: LyricsUpdateRequest,
    storage: Phase1StorageService = Depends(_get_storage),
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

    validator = ValidationService()
    report = validator.validate_document(updated.model_dump())
    if not report.valid:
        raise HTTPException(status_code=422, detail=report.issues[0].message)

    saved = storage.save_lyrics(updated)
    return {"success": True, "document": saved.model_dump()}
