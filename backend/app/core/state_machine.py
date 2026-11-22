"""
Canonical Processing Pipeline State Machine for Phase 1 & Phase 2.
All pipeline states and allowed transitions live here as the single source of truth.
"""

from __future__ import annotations

from enum import Enum
from typing import Dict, FrozenSet, Tuple


class ProcessingPipelineState(str, Enum):
    QUEUED = "queued"
    VALIDATING = "validating"
    ANALYZING = "analyzing"
    SEPARATING_VOCALS = "separating_vocals"
    TRANSCRIBING = "transcribing"
    ALIGNING = "aligning"
    VALIDATING_ALIGNMENT = "validating_alignment"
    COMPLETED = "completed"
    FAILED = "failed"


PIPELINE_STAGE_ORDER: Tuple[ProcessingPipelineState, ...] = (
    ProcessingPipelineState.QUEUED,
    ProcessingPipelineState.VALIDATING,
    ProcessingPipelineState.ANALYZING,
    ProcessingPipelineState.SEPARATING_VOCALS,
    ProcessingPipelineState.TRANSCRIBING,
    ProcessingPipelineState.ALIGNING,
    ProcessingPipelineState.VALIDATING_ALIGNMENT,
    ProcessingPipelineState.COMPLETED,
)

STAGE_PROGRESS_PERCENT: Dict[ProcessingPipelineState, int] = {
    ProcessingPipelineState.QUEUED: 0,
    ProcessingPipelineState.VALIDATING: 12,
    ProcessingPipelineState.ANALYZING: 25,
    ProcessingPipelineState.SEPARATING_VOCALS: 40,
    ProcessingPipelineState.TRANSCRIBING: 60,
    ProcessingPipelineState.ALIGNING: 78,
    ProcessingPipelineState.VALIDATING_ALIGNMENT: 92,
    ProcessingPipelineState.COMPLETED: 100,
    ProcessingPipelineState.FAILED: 100,
}

# Explicit finite-state-machine transitions:
# Every active stage may proceed sequentially or fail cleanly.
# Skipping vocal separation -> transcribing is allowed when separation is disabled or stubbed.
ALLOWED_JOB_TRANSITIONS: Dict[ProcessingPipelineState, FrozenSet[ProcessingPipelineState]] = {
    ProcessingPipelineState.QUEUED: frozenset({
        ProcessingPipelineState.VALIDATING,
        ProcessingPipelineState.FAILED,
    }),
    ProcessingPipelineState.VALIDATING: frozenset({
        ProcessingPipelineState.ANALYZING,
        ProcessingPipelineState.FAILED,
    }),
    ProcessingPipelineState.ANALYZING: frozenset({
        ProcessingPipelineState.SEPARATING_VOCALS,
        ProcessingPipelineState.TRANSCRIBING,
        ProcessingPipelineState.FAILED,
    }),
    ProcessingPipelineState.SEPARATING_VOCALS: frozenset({
        ProcessingPipelineState.TRANSCRIBING,
        ProcessingPipelineState.FAILED,
    }),
    ProcessingPipelineState.TRANSCRIBING: frozenset({
        ProcessingPipelineState.ALIGNING,
        ProcessingPipelineState.FAILED,
    }),
    ProcessingPipelineState.ALIGNING: frozenset({
        ProcessingPipelineState.VALIDATING_ALIGNMENT,
        ProcessingPipelineState.FAILED,
    }),
    ProcessingPipelineState.VALIDATING_ALIGNMENT: frozenset({
        ProcessingPipelineState.COMPLETED,
        ProcessingPipelineState.FAILED,
    }),
    ProcessingPipelineState.COMPLETED: frozenset(),
    ProcessingPipelineState.FAILED: frozenset({
        ProcessingPipelineState.QUEUED,  # Explicit manual retry
    }),
}


class InvalidJobTransitionError(ValueError):
    """Raised when attempting an illegal ProcessingJob state transition."""


def can_transition_job_state(
    current: ProcessingPipelineState | str,
    target: ProcessingPipelineState | str,
) -> bool:
    cur_state = ProcessingPipelineState(current)
    tgt_state = ProcessingPipelineState(target)
    return tgt_state in ALLOWED_JOB_TRANSITIONS[cur_state]


def assert_valid_job_transition(
    current: ProcessingPipelineState | str,
    target: ProcessingPipelineState | str,
) -> ProcessingPipelineState:
    cur_state = ProcessingPipelineState(current)
    tgt_state = ProcessingPipelineState(target)
    if tgt_state not in ALLOWED_JOB_TRANSITIONS[cur_state]:
        raise InvalidJobTransitionError(
            f"Illegal pipeline transition from '{cur_state.value}' to '{tgt_state.value}'."
        )
    return tgt_state
