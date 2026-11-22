"""
Alexura Standalone FastAPI Audio & Forced-Alignment Backend Service.
Can be run directly (`uvicorn backend.fastapi_app:app --port 8000`) when Python FastAPI
dependencies are installed; mirrors the exact /api/v2/* contract served on port 3000.
"""

from __future__ import annotations

import hashlib
import os
import tempfile
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .app.api.routes import router as v1_router
from .audio_worker import cmd_align, cmd_probe, cmd_separate
from .db import (
    _connect,
    get_job,
    get_song_timestamps,
    get_upload,
    list_songs,
    save_song_timestamps,
    update_word_timestamp,
    upsert_job,
    upsert_upload,
)

UPLOAD_ROOT = Path(".alexura_data/uploads").resolve()
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
ALLOWED_EXTENSIONS = {".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".webm"}
MAX_UPLOAD_BYTES = 35 * 1024 * 1024

app = FastAPI(title="Alexura Audio Pipeline Service", version="2.0.0")
app.include_router(v1_router)


class CreateJobRequest(BaseModel):
    uploadId: str
    lang: str = "auto"
    title: str = ""
    artist: str = ""
    lyricsHint: Optional[str] = None
    enableSeparation: bool = True


class WordUpdateRequest(BaseModel):
    start: float
    end: float
    provenance: str = "human_verified"


def _has_valid_audio_magic(head: bytes, ext: str) -> bool:
    if len(head) < 4:
        return False
    if head[:4] == b"RIFF" and len(head) >= 12 and head[8:12] == b"WAVE":
        return True
    if head[:3] == b"ID3" or (head[0] == 0xFF and (head[1] & 0xE0) == 0xE0):
        return True
    if head[:4] == b"fLaC" or head[:4] == b"OggS":
        return True
    if len(head) >= 8 and head[4:8] == b"ftyp":
        return True
    if head[:4] == b"\x1a\x45\xdf\xa3" and ext == ".webm":
        return True
    return False


@app.get("/api/v2/capabilities")
def capabilities() -> Dict[str, Any]:
    return {
        "runtime": "python-fastapi",
        "geminiConfigured": bool(os.environ.get("GEMINI_API_KEY")),
        "providers": {
            "audioUnderstanding": {
                "active": "google-genai:gemini-3.5-transcribe" if os.environ.get("GEMINI_API_KEY") else "not_configured",
                "supportsSingingTranscription": bool(os.environ.get("GEMINI_API_KEY")),
                "guaranteesExactWordForcedAlignment": False,
            },
            "vocalSeparation": {
                "active": "external_endpoint" if os.environ.get("VOCAL_SEPARATION_ENDPOINT") else "dsp_center_bandpass",
                "externalConfigured": bool(os.environ.get("VOCAL_SEPARATION_ENDPOINT")),
                "isNeural": bool(os.environ.get("VOCAL_SEPARATION_ENDPOINT")),
            },
            "singingAsr": {
                "active": "external_endpoint" if os.environ.get("SINGING_ASR_ENDPOINT") else ("gemini-3.5-transcribe" if os.environ.get("GEMINI_API_KEY") else "not_configured"),
                "externalConfigured": bool(os.environ.get("SINGING_ASR_ENDPOINT")),
            },
            "forcedAlignment": {
                "active": "external_endpoint" if os.environ.get("FORCED_ALIGNMENT_ENDPOINT") else "dsp_acoustic_viterbi",
                "externalConfigured": bool(os.environ.get("FORCED_ALIGNMENT_ENDPOINT")),
                "isNeuralPhonemeAligner": bool(os.environ.get("FORCED_ALIGNMENT_ENDPOINT")),
            },
        },
    }


@app.post("/api/v2/uploads")
async def upload_audio(file: UploadFile = File(...)) -> Dict[str, Any]:
    raw_name = Path(file.filename or "track.wav").name
    ext = Path(raw_name).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="unsupported_audio_extension")

    raw = await file.read()
    if not raw or len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="invalid_audio_size")
    if not _has_valid_audio_magic(raw[:16], ext):
        raise HTTPException(status_code=400, detail="invalid_audio_magic_header")

    upload_id = f"upl_{uuid.uuid4().hex[:16]}"
    target = (UPLOAD_ROOT / f"{upload_id}{ext}").resolve()
    if not str(target).startswith(str(UPLOAD_ROOT)):
        raise HTTPException(status_code=400, detail="invalid_storage_path")
    target.write_bytes(raw)

    probe = cmd_probe({"audioPath": str(target)})
    sha = hashlib.sha256(raw).hexdigest()
    conn = _connect()
    try:
        record = upsert_upload(
            conn,
            {
                "id": upload_id,
                "filename": raw_name[:200],
                "mimeType": file.content_type or "audio/mpeg",
                "byteSize": len(raw),
                "sha256": sha,
                "durationSec": probe["durationSec"],
                "sampleRate": probe["sampleRate"],
                "channels": probe["channels"],
                "waveformPeaks": probe["waveformPeaks"],
                "vocalSegments": probe["vocalSegments"],
                "storagePath": str(target),
            },
        )
    finally:
        conn.close()
    return {"success": True, "upload": record}


@app.get("/api/v2/uploads/{upload_id}/audio")
def stream_audio(upload_id: str) -> FileResponse:
    conn = _connect()
    try:
        rec = get_upload(conn, upload_id)
    finally:
        conn.close()
    if not rec:
        raise HTTPException(status_code=404, detail="upload_not_found")
    p = Path(rec["storagePath"]).resolve()
    if not str(p).startswith(str(UPLOAD_ROOT)) or not p.exists():
        raise HTTPException(status_code=404, detail="audio_file_missing")
    return FileResponse(str(p), media_type=rec["mimeType"], filename=rec["filename"])


def _run_background_job(job_id: str, req: CreateJobRequest) -> None:
    conn = _connect()
    try:
        up = get_upload(conn, req.uploadId)
        if not up:
            upsert_job(conn, {"id": job_id, "uploadId": req.uploadId, "status": "failed", "stage": "error", "progress": 100, "error": "upload_not_found"})
            return

        if req.enableSeparation:
            upsert_job(conn, {"id": job_id, "uploadId": req.uploadId, "status": "running", "stage": "separating_vocals", "progress": 30})
            stem_out = str((UPLOAD_ROOT / f"{req.uploadId}_vocal.wav").resolve())
            cmd_separate({"audioPath": up["storagePath"], "outWavPath": stem_out})

        upsert_job(conn, {"id": job_id, "uploadId": req.uploadId, "status": "running", "stage": "aligning_timestamps", "progress": 70})
        seed_lines: List[Dict[str, Any]] = []
        if req.lyricsHint:
            raw_lines = [ln.strip() for ln in req.lyricsHint.splitlines() if ln.strip()]
            step = up["durationSec"] / max(1, len(raw_lines))
            for i, txt in enumerate(raw_lines):
                seed_lines.append({"text": txt, "start": round(i * step, 3), "end": round((i + 1) * step, 3)})

        aligned = cmd_align({"audioPath": up["storagePath"], "lines": seed_lines})
        song_id = f"song_{uuid.uuid4().hex[:12]}"
        song = save_song_timestamps(
            conn,
            {
                "songId": song_id,
                "uploadId": req.uploadId,
                "title": req.title or Path(up["filename"]).stem,
                "artist": req.artist,
                "language": req.lang,
                "durationSec": up["durationSec"],
                "provenance": {"forcedAlignment": "dsp_acoustic_viterbi"},
                "lines": aligned["alignedLines"],
            },
        )
        upsert_job(conn, {"id": job_id, "uploadId": req.uploadId, "songId": song_id, "status": "completed", "stage": "completed", "progress": 100, "result": song})
    finally:
        conn.close()


@app.post("/api/v2/jobs")
def create_job(req: CreateJobRequest, bg: BackgroundTasks) -> Dict[str, Any]:
    job_id = f"job_{uuid.uuid4().hex[:14]}"
    conn = _connect()
    try:
        job = upsert_job(conn, {"id": job_id, "uploadId": req.uploadId, "status": "queued", "stage": "queued", "progress": 5, "lang": req.lang})
    finally:
        conn.close()
    bg.add_task(_run_background_job, job_id, req)
    return {"success": True, "job": job}


@app.get("/api/v2/jobs/{job_id}")
def read_job(job_id: str) -> Dict[str, Any]:
    conn = _connect()
    try:
        job = get_job(conn, job_id)
    finally:
        conn.close()
    if not job:
        raise HTTPException(status_code=404, detail="job_not_found")
    return {"success": True, "job": job}


@app.get("/api/v2/songs")
def read_songs() -> Dict[str, Any]:
    conn = _connect()
    try:
        return {"success": True, "songs": list_songs(conn)}
    finally:
        conn.close()


@app.get("/api/v2/songs/{song_id}/timestamps")
def read_song_timestamps(song_id: str) -> Dict[str, Any]:
    conn = _connect()
    try:
        song = get_song_timestamps(conn, song_id)
    finally:
        conn.close()
    if not song:
        raise HTTPException(status_code=404, detail="song_not_found")
    return {"success": True, "song": song}


@app.patch("/api/v2/songs/{song_id}/words/{line_idx}/{word_idx}")
def patch_word(song_id: str, line_idx: int, word_idx: int, req: WordUpdateRequest) -> Dict[str, Any]:
    conn = _connect()
    try:
        song = update_word_timestamp(
            conn,
            {"songId": song_id, "lineIndex": line_idx, "wordIndex": word_idx, "start": req.start, "end": req.end, "provenance": req.provenance},
        )
        return {"success": True, "song": song}
    finally:
        conn.close()
