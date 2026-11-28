"""Modular lyrics worker bridging TaskManager, PipelineOrchestrator, and segment remapping."""

from __future__ import annotations

from typing import Any, Dict, Optional

from ..core.config import Settings, get_settings
from ..core.task_manager import TaskManager
from ..schemas.jobs import AnalyzeSongRequest, ProcessingJob
from ..services.alignment_service import AlignmentService


async def process_lyrics_job(
    job_id: str,
    req: AnalyzeSongRequest,
    settings: Optional[Settings] = None,
) -> ProcessingJob:
    manager = TaskManager(settings=settings or get_settings())
    return await manager.run_job(job_id, req)


def remap_worker_segment(
    segment: Dict[str, Any],
    mapping: Dict[str, Any],
) -> Dict[str, Any]:
    return AlignmentService.remap_segment(segment, mapping)
