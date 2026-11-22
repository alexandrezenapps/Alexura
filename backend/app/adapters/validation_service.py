"""
Modular Lyrics Validation Service.
Validates normalized schema invariants, monotonic timestamps in seconds,
and prepares confidence & anomaly checks for Phase 2 alignment QA.
"""

from __future__ import annotations

from ..core.validation_rules import LyricsValidationReport, validate_lyrics_document_dict
from ..schemas.lyrics import LyricsDocument
from .base import AdapterCapabilityInfo, AdapterStatus


class LyricsValidationService:
    """Validates LyricsDocument timestamps (in seconds relative to original audio)."""

    def describe_capability(self) -> AdapterCapabilityInfo:
        return AdapterCapabilityInfo(
            name="LyricsValidationService",
            adapterClass="LyricsValidationService",
            implementation="schema_and_timestamp_validator",
            status=AdapterStatus.READY,
            isImplementedForProduction=True,
            note=(
                "Active schema, monotonicity, and second-based timestamp integrity validator. "
                "Acoustic confidence calibration expands in Phase 2."
            ),
            phaseTarget="Phase 1 (Schema & Bounds) + Phase 2 (Acoustic QA)",
        )

    def validate(self, document: LyricsDocument) -> LyricsValidationReport:
        return validate_lyrics_document_dict(document.model_dump())
