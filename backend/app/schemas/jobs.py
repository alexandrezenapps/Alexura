"""
Pydantic v2 models for uploaded audio assets, processing jobs, and pipeline state transitions.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, model_validator

from ..core.state_machine import (
    DEFAULT_JOB_STEP_MESSAGES,
    STAGE_PROGRESS_PERCENT,
    ProcessingPipelineState,
    ProcessingStatus,
    assert_valid_job_transition,
)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class AudioAssetRecord(BaseModel):
    audioId: str = Field(..., min_length=1)
    filename: str = Field(..., min_length=1, max_length=240)
    mimeType: str = Field(..., min_length=1)
    byteSize: int = Field(..., gt=0)
    sha256: str = Field(..., min_length=16)
    durationSeconds: float = Field(default=0.0, ge=0.0)
    sampleRateHz: int = Field(default=0, ge=0)
    channels: int = Field(default=0, ge=0)
    storagePath: str = Field(..., min_length=1)
    audioUrl: str = Field(..., min_length=1)
    createdAt: str = Field(default_factory=_utc_now_iso)


class JobTransitionRecord(BaseModel):
    fromState: Optional[ProcessingPipelineState] = None
    toState: ProcessingPipelineState
    message: str = ""
    timestamp: str = Field(default_factory=_utc_now_iso)


class CanonicalProcessingJob(BaseModel):
    jobId: str = Field(..., min_length=1)
    songId: str = Field(..., min_length=1)
    status: ProcessingStatus = ProcessingPipelineState.QUEUED
    progress: int = Field(default=0, ge=0, le=100)
    currentStep: str = Field(default=DEFAULT_JOB_STEP_MESSAGES[ProcessingPipelineState.QUEUED], min_length=1)
    error: Optional[str] = None


class ProcessingJob(BaseModel):
    jobId: str = Field(..., min_length=1)
    audioId: str = Field(..., min_length=1)
    songId: Optional[str] = None
    documentId: Optional[str] = None
    state: ProcessingPipelineState = ProcessingPipelineState.QUEUED
    status: Optional[ProcessingStatus] = None
    progressPercent: int = Field(default=0, ge=0, le=100)
    progress: Optional[int] = Field(default=None, ge=0, le=100)
    currentStep: Optional[str] = None
    languageHint: str = Field(default="auto")
    enableVocalSeparation: bool = True
    phaseMode: str = Field(default="phase_1_stub_adapters")
    adapterReport: Dict[str, Any] = Field(default_factory=dict)
    transitions: List[JobTransitionRecord] = Field(default_factory=list)
    error: Optional[str] = None
    createdAt: str = Field(default_factory=_utc_now_iso)
    updatedAt: str = Field(default_factory=_utc_now_iso)

    @model_validator(mode="after")
    def _sync_canonical_fields(self) -> "ProcessingJob":
        if not self.songId:
            self.songId = self.audioId
        if self.status is None:
            self.status = self.state
        if self.progress is None:
            self.progress = self.progressPercent
        if not self.currentStep:
            last_msg = self.transitions[-1].message if self.transitions else ""
            self.currentStep = (last_msg or "").strip() or DEFAULT_JOB_STEP_MESSAGES[self.status]
        return self

    def transition_to(
        self,
        next_state: ProcessingPipelineState,
        message: str = "",
        error: Optional[str] = None,
    ) -> "ProcessingJob":
        current_state = self.status or self.state
        assert_valid_job_transition(current_state, next_state)
        prev = current_state
        next_progress = STAGE_PROGRESS_PERCENT[next_state]
        resolved_step = (message or "").strip() or DEFAULT_JOB_STEP_MESSAGES[next_state]
        self.songId = self.songId or self.audioId
        self.state = next_state
        self.status = next_state
        self.progressPercent = next_progress
        self.progress = next_progress
        self.currentStep = resolved_step
        if error is not None:
            self.error = error
        elif next_state == ProcessingPipelineState.QUEUED:
            self.error = None
        self.transitions.append(
            JobTransitionRecord(
                fromState=prev,
                toState=next_state,
                message=resolved_step,
            )
        )
        self.updatedAt = _utc_now_iso()
        return self

    def to_canonical(self) -> CanonicalProcessingJob:
        active_status = self.status or self.state
        active_progress = self.progress if self.progress is not None else self.progressPercent
        active_step = (
            (self.currentStep or "").strip()
            or (self.transitions[-1].message.strip() if self.transitions and self.transitions[-1].message else "")
            or DEFAULT_JOB_STEP_MESSAGES[active_status]
        )
        return CanonicalProcessingJob(
            jobId=self.jobId,
            songId=self.songId or self.audioId,
            status=active_status,
            progress=active_progress,
            currentStep=active_step,
            error=self.error,
        )


class AnalyzeSongRequest(BaseModel):
    audioId: str = Field(..., min_length=1)
    title: Optional[str] = Field(default=None, max_length=240)
    artist: Optional[str] = Field(default=None, max_length=240)
    languageHint: str = Field(default="auto", max_length=32)
    draftLyricsText: Optional[str] = None
    enableVocalSeparation: bool = True
