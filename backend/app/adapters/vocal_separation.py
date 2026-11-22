"""
Modular Vocal Separation Adapter Interface (Phase 1 Foundation).
Prepared for Demucs / MDX-Net / external stem separation microservices in Phase 2.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .base import AdapterCapabilityInfo, AdapterStatus


@dataclass(frozen=True)
class VocalSeparationResult:
    performed: bool
    vocalStemPath: Optional[str]
    accompanimentStemPath: Optional[str]
    preservesOriginalAudio: bool
    note: str


class VocalSeparationAdapter(ABC):
    """Abstract interface for vocal/instrumental source separation."""

    @abstractmethod
    def describe_capability(self) -> AdapterCapabilityInfo:
        """Report honest runtime readiness and configuration state."""

    @abstractmethod
    async def separate_vocals(self, audio_path: Path, output_dir: Path) -> VocalSeparationResult:
        """Separate vocals cleanly without altering the original uploaded audio file."""


class UnconfiguredVocalSeparationAdapter(VocalSeparationAdapter):
    """Default Phase 1 adapter reporting unconfigured external neural stem separation."""

    def __init__(self, endpoint_url: str = "") -> None:
        self._endpoint_url = endpoint_url.strip()

    def describe_capability(self) -> AdapterCapabilityInfo:
        return AdapterCapabilityInfo(
            name="VocalSeparationAdapter",
            adapterClass="UnconfiguredVocalSeparationAdapter",
            implementation="phase1_interface_only",
            status=AdapterStatus.UNCONFIGURED,
            isImplementedForProduction=False,
            note=(
                "Phase 1 stub adapter. Original audio timeline is preserved untouched; "
                "Demucs/MDX vocal stem extraction plugs in during Phase 2."
            ),
            phaseTarget="Phase 2 (Demucs / MDX-Net)",
        )

    async def separate_vocals(self, audio_path: Path, output_dir: Path) -> VocalSeparationResult:
        return VocalSeparationResult(
            performed=False,
            vocalStemPath=None,
            accompanimentStemPath=None,
            preservesOriginalAudio=True,
            note="Phase 1 stub: vocal separation skipped; original audio preserved.",
        )


class DevMockVocalSeparationAdapter(VocalSeparationAdapter):
    """Explicitly labeled development mock for local pipeline flow testing."""

    def describe_capability(self) -> AdapterCapabilityInfo:
        return AdapterCapabilityInfo(
            name="VocalSeparationAdapter",
            adapterClass="DevMockVocalSeparationAdapter",
            implementation="development_mock",
            status=AdapterStatus.DEVELOPMENT_MOCK,
            isImplementedForProduction=False,
            note="Development mock adapter — passes through original audio without stem synthesis.",
            phaseTarget="Phase 2",
        )

    async def separate_vocals(self, audio_path: Path, output_dir: Path) -> VocalSeparationResult:
        return VocalSeparationResult(
            performed=False,
            vocalStemPath=None,
            accompanimentStemPath=None,
            preservesOriginalAudio=True,
            note="Development mock: no stem generated in Phase 1.",
        )
