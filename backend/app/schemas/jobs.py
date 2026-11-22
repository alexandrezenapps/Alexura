"""
Pydantic v2 models for uploaded audio assets, processing jobs, and pipeline state transitions.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from ..core.state_machine import (
    STAGE_PROGRESS_PERCENT,
    ProcessingPipelineState,
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


class ProcessingJob(BaseModel):
    jobId: str = Field(..., min_length=1)
    audioId: str = Field(..., min_length=1)
    documentId: Optional[str] = None
    state: ProcessingPipelineState = ProcessingPipelineState.QUEUED
    progressPercent: int = Field(default=0, ge=0, le=100)
    languageHint: str = Field(default="auto")
    enableVocalSeparation: bool = True
    phaseMode: str = Field(default="phase_1_stub_adapters")
    adapterReport: Dict[str, Any] = Field(default_factory=dict)
    transitions: List[JobTransitionRecord] = Field(default_factory=list)
    error: Optional[str] = None
    createdAt: str = Field(default_factory=_utc_now_iso)
    updatedAt: str = Field(default_factory=_utc_now_iso)

    def transition_to(
        self,
        next_state: ProcessingPipelineState,
        message: str = "",
        error: Optional[str] = None,
    ) -> "ProcessingJob":
        assert_valid_job_transition(self.state, next_state)
        prev = self.state
        self.state = next_state
        self.progressPercent = STAGE_PROGRESS_PERCENT[next_state]
        if error is not None:
            self.error = error
        elif next_state == ProcessingPipelineState.QUEUED:
            self.error = None
        self.transitions.append(
            JobTransitionRecord(
                fromState=prev,
                toState=next_state,
                message=message,
            )
        )
        self.updatedAt = _utc_now_iso()
        return self


class AnalyzeSongRequest(BaseModel):
    audioId: str = Field(..., min_length=1)
    title: Optional[str] = Field(default=None, max_length=240)
    artist: Optional[str] = Field(default=None, max_length=240)
    languageHint: str = Field(default="auto", max_length=32)
    draftLyricsText: Optional[str] = None
    enableVocalSeparation: bool = True
