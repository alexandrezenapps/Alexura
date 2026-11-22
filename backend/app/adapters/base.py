"""Shared adapter status and capability contract."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import Enum
from typing import Any, Dict


class AdapterStatus(str, Enum):
    UNCONFIGURED = "unconfigured_adapter"
    DEVELOPMENT_MOCK = "development_mock"
    READY = "ready"


@dataclass(frozen=True)
class AdapterCapabilityInfo:
    name: str
    adapterClass: str
    implementation: str
    status: AdapterStatus
    isImplementedForProduction: bool
    note: str
    phaseTarget: str = "Phase 2"

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["status"] = self.status.value
        return data
