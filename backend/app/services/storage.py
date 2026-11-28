"""
Secure path-confined file & JSON persistence service for uploaded audio,
ProcessingJob records, and normalized LyricsDocument records.
Preserves untouched original uploaded audio bytes cleanly.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from pathlib import Path
from typing import List, Optional

from ..audio_service import (
    ALLOWED_AUDIO_EXTENSIONS,
    extract_audio_metadata,
    get_media_type,
    has_valid_audio_magic,
)
from ..core.config import Settings
from ..schemas.jobs import AudioAssetRecord, ProcessingJob
from ..schemas.lyrics import LyricsDocument


class AudioValidationError(ValueError):
    """Raised when an uploaded audio file fails extension, size, or magic-byte checks."""


class Phase1StorageService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.audio_dir = (settings.data_dir / "audio").resolve()
        self.jobs_dir = (settings.data_dir / "jobs").resolve()
        self.lyrics_dir = (settings.data_dir / "lyrics").resolve()
        for d in (self.audio_dir, self.jobs_dir, self.lyrics_dir):
            d.mkdir(parents=True, exist_ok=True)

    def _safe_child(self, root: Path, filename: str) -> Path:
        clean_name = Path(filename).name
        if not clean_name or clean_name in {".", ".."}:
            raise AudioValidationError("invalid_storage_path")
        target = (root / clean_name).resolve()
        if not target.is_relative_to(root.resolve()):
            raise AudioValidationError("invalid_storage_path")
        return target

    def save_uploaded_audio(
        self,
        raw_bytes: bytes,
        original_filename: str,
        mime_type: str = "audio/mpeg",
    ) -> AudioAssetRecord:
        safe_name = Path(original_filename or "track.wav").name[:200]
        ext = Path(safe_name).suffix.lower()
        if ext not in ALLOWED_AUDIO_EXTENSIONS:
            raise AudioValidationError("unsupported_audio_extension")
        if not raw_bytes:
            raise AudioValidationError("empty_audio_payload")
        if len(raw_bytes) > self.settings.max_upload_bytes:
            raise AudioValidationError("audio_exceeds_max_upload_size")
        if not has_valid_audio_magic(raw_bytes[:16], ext):
            raise AudioValidationError("invalid_audio_magic_header")

        audio_id = f"aud_{uuid.uuid4().hex[:16]}"
        audio_path = self._safe_child(self.audio_dir, f"{audio_id}{ext}")
        audio_path.write_bytes(raw_bytes)

        audio_meta = extract_audio_metadata(raw_bytes, ext)
        resolved_mime = (mime_type or "").strip()
        if not resolved_mime or resolved_mime == "application/octet-stream":
            resolved_mime = get_media_type(ext)
        meta = AudioAssetRecord(
            audioId=audio_id,
            filename=safe_name,
            mimeType=resolved_mime,
            byteSize=len(raw_bytes),
            sha256=hashlib.sha256(raw_bytes).hexdigest(),
            durationSeconds=audio_meta.duration_seconds,
            sampleRateHz=audio_meta.sample_rate_hz,
            channels=audio_meta.channels,
            storagePath=str(audio_path),
            audioUrl=f"/api/v1/audio/{audio_id}/stream",
        )
        meta_path = self._safe_child(self.audio_dir, f"{audio_id}.json")
        meta_path.write_text(meta.model_dump_json(indent=2), encoding="utf-8")
        return meta

    def get_audio(self, audio_id: str) -> Optional[AudioAssetRecord]:
        if not audio_id or "/" in audio_id or "\\" in audio_id:
            return None
        meta_path = self._safe_child(self.audio_dir, f"{audio_id}.json")
        if not meta_path.exists():
            return None
        return AudioAssetRecord.model_validate_json(meta_path.read_text(encoding="utf-8"))

    def save_job(self, job: ProcessingJob) -> ProcessingJob:
        path = self._safe_child(self.jobs_dir, f"{job.jobId}.json")
        path.write_text(job.model_dump_json(indent=2), encoding="utf-8")
        return job

    def get_job(self, job_id: str) -> Optional[ProcessingJob]:
        if not job_id or "/" in job_id or "\\" in job_id:
            return None
        path = self._safe_child(self.jobs_dir, f"{job_id}.json")
        if not path.exists():
            return None
        return ProcessingJob.model_validate_json(path.read_text(encoding="utf-8"))

    def list_jobs(self, limit: int = 25) -> List[ProcessingJob]:
        items: List[ProcessingJob] = []
        for p in sorted(self.jobs_dir.glob("*.json"), key=lambda f: f.stat().st_mtime, reverse=True):
            try:
                items.append(ProcessingJob.model_validate_json(p.read_text(encoding="utf-8")))
                if len(items) >= limit:
                    break
            except Exception:
                continue
        return items

    def save_lyrics(self, doc: LyricsDocument) -> LyricsDocument:
        path = self._safe_child(self.lyrics_dir, f"{doc.documentId}.json")
        path.write_text(doc.model_dump_json(indent=2), encoding="utf-8")
        return doc

    def get_lyrics(self, document_id: str) -> Optional[LyricsDocument]:
        if not document_id or "/" in document_id or "\\" in document_id:
            return None
        path = self._safe_child(self.lyrics_dir, f"{document_id}.json")
        if not path.exists():
            return None
        return LyricsDocument.model_validate_json(path.read_text(encoding="utf-8"))

    def list_lyrics(self, limit: int = 25) -> List[LyricsDocument]:
        items: List[LyricsDocument] = []
        for p in sorted(self.lyrics_dir.glob("*.json"), key=lambda f: f.stat().st_mtime, reverse=True):
            try:
                items.append(LyricsDocument.model_validate_json(p.read_text(encoding="utf-8")))
                if len(items) >= limit:
                    break
            except Exception:
                continue
        return items

    @staticmethod
    def load_normalized_json_schema() -> dict:
        schema_path = Path(__file__).resolve().parents[3] / "schemas" / "lyrics.schema.json"
        return json.loads(schema_path.read_text(encoding="utf-8"))
