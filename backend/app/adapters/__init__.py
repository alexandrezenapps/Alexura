"""Modular AI & validation service adapters for the Alexura Sync Engine."""

from __future__ import annotations

from .asr_service import (
    CustomModelAdapter,
    GeminiASRAdapter as UnifiedGeminiASRAdapter,
    LocalSingingASRAdapter as UnifiedLocalSingingASRAdapter,
    ModelRoutingStrategy,
    SingingASRAdapter as UnifiedSingingASRAdapter,
    TranscriptionQualityReport,
    WhisperSingingAdapter,
    assess_transcription_quality,
    build_aligner_input,
    normalize_transcription_payload,
)
from .base import AdapterCapabilityInfo, AdapterStatus
from .vocal_separation import (
    DevMockVocalSeparationAdapter,
    UnconfiguredVocalSeparationAdapter,
    VocalSeparationAdapter,
)

__all__ = [
    "AdapterCapabilityInfo",
    "AdapterStatus",
    "CustomModelAdapter",
    "DevMockVocalSeparationAdapter",
    "ModelRoutingStrategy",
    "TranscriptionQualityReport",
    "UnconfiguredVocalSeparationAdapter",
    "UnifiedGeminiASRAdapter",
    "UnifiedLocalSingingASRAdapter",
    "UnifiedSingingASRAdapter",
    "VocalSeparationAdapter",
    "WhisperSingingAdapter",
    "assess_transcription_quality",
    "build_aligner_input",
    "normalize_transcription_payload",
]

try:
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

    __all__.extend(
        [
            "DevMockForcedAlignmentAdapter",
            "DevMockSingingASRAdapter",
            "ForcedAlignmentAdapter",
            "LyricsValidationService",
            "SingingASRAdapter",
            "UnconfiguredForcedAlignmentAdapter",
            "UnconfiguredSingingASRAdapter",
        ]
    )
except ImportError:
    # Allows pure-Python tests (without pydantic) to import backend.app.adapters.asr_service cleanly.
    pass
