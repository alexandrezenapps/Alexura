"""Modular AI & validation service adapters for the Alexura Sync Engine."""

from .base import AdapterCapabilityInfo, AdapterStatus
from .forced_alignment import (
    DevMockForcedAlignmentAdapter,
    ForcedAlignmentAdapter,
    UnconfiguredForcedAlignmentAdapter,
)
from .singing_asr import (
    DevMockSingingASRAdapter,
    SingingASRAdapter,
    UnconfiguredSingingASRAdapter,
)
from .validation_service import LyricsValidationService
from .vocal_separation import (
    DevMockVocalSeparationAdapter,
    UnconfiguredVocalSeparationAdapter,
    VocalSeparationAdapter,
)

__all__ = [
    "AdapterCapabilityInfo",
    "AdapterStatus",
    "DevMockForcedAlignmentAdapter",
    "DevMockSingingASRAdapter",
    "DevMockVocalSeparationAdapter",
    "ForcedAlignmentAdapter",
    "LyricsValidationService",
    "SingingASRAdapter",
    "UnconfiguredForcedAlignmentAdapter",
    "UnconfiguredSingingASRAdapter",
    "UnconfiguredVocalSeparationAdapter",
    "VocalSeparationAdapter",
]
