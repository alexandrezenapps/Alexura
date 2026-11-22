"""
Background Pipeline Orchestrator for Phase 1 Architecture Foundation.
Executes strict finite-state-machine transitions across all 9 states:
  queued -> validating -> analyzing -> separating_vocals -> transcribing
  -> aligning -> validating_alignment -> completed (or failed)

CRITICAL PHASE 1 RULE:
- Never simulates real AI lyrics recognition or generates fake word timestamps.
- Produces an honest normalized LyricsDocument ready for manual editing or Phase 2 models.
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Dict

from ..adapters import (
    ForcedAlignmentAdapter,
    LyricsValidationService,
    SingingASRAdapter,
    UnconfiguredForcedAlignmentAdapter,
    UnconfiguredSingingASRAdapter,
    UnconfiguredVocalSeparationAdapter,
    VocalSeparationAdapter,
)
from ..core.config import Settings
from ..core.logging import get_logger
from ..core.state_machine import ProcessingPipelineState
from ..schemas.jobs import AnalyzeSongRequest, ProcessingJob
from ..schemas.lyrics import LyricsDocument
from ..services.storage import Phase1StorageService


class PipelineOrchestrator:
    def __init__(
        self,
        settings: Settings,
        storage: Phase1StorageService,
        separation_adapter: VocalSeparationAdapter | None = None,
        asr_adapter: SingingASRAdapter | None = None,
        alignment_adapter: ForcedAlignmentAdapter | None = None,
        validation_service: LyricsValidationService | None = None,
    ) -> None:
        self.settings = settings
        self.storage = storage
        self.logger = get_logger("alexura.worker", settings.log_level)
        self.separation_adapter = separation_adapter or UnconfiguredVocalSeparationAdapter(
            endpoint_url=settings.vocal_separation_endpoint
        )
        self.asr_adapter = asr_adapter or UnconfiguredSingingASRAdapter(
            endpoint_configured=bool(settings.singing_asr_endpoint),
            gemini_configured=settings.gemini_configured,
        )
        self.alignment_adapter = alignment_adapter or UnconfiguredForcedAlignmentAdapter(
            endpoint_url=settings.forced_alignment_endpoint
        )
        self.validation_service = validation_service or LyricsValidationService()

    def describe_adapters(self) -> Dict[str, dict]:
        return {
            "vocalSeparation": self.separation_adapter.describe_capability().to_dict(),
            "singingAsr": self.asr_adapter.describe_capability().to_dict(),
            "forcedAlignment": self.alignment_adapter.describe_capability().to_dict(),
            "lyricsValidation": self.validation_service.describe_capability().to_dict(),
            "secretsProtected": True,
            "geminiServerConfigured": self.settings.gemini_configured,
        }

    def create_queued_job(self, req: AnalyzeSongRequest) -> ProcessingJob:
        doc_id = f"lyr_{uuid.uuid4().hex[:14]}"
        job_id = f"job_{uuid.uuid4().hex[:14]}"
        job = ProcessingJob(
            jobId=job_id,
            audioId=req.audioId,
            documentId=doc_id,
            state=ProcessingPipelineState.QUEUED,
            progressPercent=0,
            languageHint=req.languageHint,
            enableVocalSeparation=req.enableVocalSeparation,
            phaseMode="phase_1_architecture_foundation",
            adapterReport=self.describe_adapters(),
        )
        return self.storage.save_job(job)

    async def execute_job(self, job_id: str, req: AnalyzeSongRequest) -> ProcessingJob:
        job = self.storage.get_job(job_id)
        if not job:
            raise KeyError(f"job_not_found:{job_id}")

        try:
            # 1. validating
            job.transition_to(ProcessingPipelineState.VALIDATING, "Validating original uploaded audio asset.")
            self.storage.save_job(job)
            audio = self.storage.get_audio(req.audioId)
            if not audio or not Path(audio.storagePath).exists():
                raise FileNotFoundError("original_audio_asset_missing")

            # 2. analyzing
            job.transition_to(
                ProcessingPipelineState.ANALYZING,
                "Phase 1 architecture pass: preserving original audio timeline.",
            )
            self.storage.save_job(job)
            audio_path = Path(audio.storagePath)

            # 3. separating_vocals (optional stage)
            vocal_stem_path = None
            if req.enableVocalSeparation:
                job.transition_to(
                    ProcessingPipelineState.SEPARATING_VOCALS,
                    "Invoking VocalSeparationAdapter (Phase 1 stub).",
                )
                self.storage.save_job(job)
                sep_res = await self.separation_adapter.separate_vocals(
                    audio_path=audio_path,
                    output_dir=audio_path.parent,
                )
                if sep_res.vocalStemPath:
                    vocal_stem_path = Path(sep_res.vocalStemPath)

            # 4. transcribing
            job.transition_to(
                ProcessingPipelineState.TRANSCRIBING,
                "Invoking SingingASRAdapter (Phase 1 stub — no fake recognition).",
            )
            self.storage.save_job(job)
            segments = await self.asr_adapter.transcribe_singing(
                audio_path=vocal_stem_path or audio_path,
                language_hint=req.languageHint,
                draft_lyrics_text=req.draftLyricsText,
            )

            # 5. aligning
            job.transition_to(
                ProcessingPipelineState.ALIGNING,
                "Invoking ForcedAlignmentAdapter (Phase 1 token structuring — null timestamps).",
            )
            self.storage.save_job(job)
            structured_segments = await self.alignment_adapter.align_segments(
                audio_path=audio_path,
                segments=segments,
                vocal_stem_path=vocal_stem_path,
            )

            # 6. validating_alignment
            job.transition_to(
                ProcessingPipelineState.VALIDATING_ALIGNMENT,
                "Validating normalized LyricsDocument JSON schema.",
            )
            self.storage.save_job(job)

            document = LyricsDocument(
                documentId=job.documentId or f"lyr_{uuid.uuid4().hex[:14]}",
                audioId=audio.audioId,
                jobId=job.jobId,
                title=req.title or Path(audio.filename).stem,
                artist=req.artist or "",
                primaryLanguage=req.languageHint or "auto",
                detectedLanguages=[] if req.languageHint == "auto" else [req.languageHint],
                durationSeconds=audio.durationSeconds,
                alignmentStatus="unaligned" if req.draftLyricsText else "phase1_placeholder",
                source="manual_editor" if req.draftLyricsText else "phase1_stub",
                metadata={
                    "phase": "phase_1_foundation",
                    "adapters": self.describe_adapters(),
                },
                segments=structured_segments,
            )
            report = self.validation_service.validate(document)
            if not report.valid:
                raise ValueError(f"Normalized schema validation failed: {report.issues[0].message}")

            self.storage.save_lyrics(document)

            # 7. completed
            job.transition_to(
                ProcessingPipelineState.COMPLETED,
                "Phase 1 pipeline completed cleanly without simulated timestamps.",
            )
            self.storage.save_job(job)
            self.logger.info("Job %s completed (document=%s)", job.jobId, document.documentId)
            return job
        except Exception as exc:
            self.logger.exception("Job %s failed: %s", job_id, exc)
            if job.state not in (ProcessingPipelineState.COMPLETED, ProcessingPipelineState.FAILED):
                job.transition_to(
                    ProcessingPipelineState.FAILED,
                    message="Pipeline execution failed.",
                    error=str(exc),
                )
                self.storage.save_job(job)
            return job
