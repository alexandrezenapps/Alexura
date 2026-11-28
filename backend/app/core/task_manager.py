"""Background task coordinator for Alexura AI Lyrics Sync Engine."""

from __future__ import annotations

from typing import List, Optional

from ..core.config import Settings, get_settings
from ..schemas.jobs import AnalyzeSongRequest, ProcessingJob
from ..services.storage import Phase1StorageService
from ..workers.pipeline_worker import PipelineOrchestrator


class TaskManager:
    """Coordinates queued pipeline jobs and exposes status queries."""

    def __init__(
        self,
        settings: Optional[Settings] = None,
        storage: Optional[Phase1StorageService] = None,
        orchestrator: Optional[PipelineOrchestrator] = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.storage = storage or Phase1StorageService(self.settings)
        self.orchestrator = orchestrator or PipelineOrchestrator(
            settings=self.settings,
            storage=self.storage,
        )

    def create_job(self, req: AnalyzeSongRequest) -> ProcessingJob:
        return self.orchestrator.create_queued_job(req)

    async def run_job(self, job_id: str, req: AnalyzeSongRequest) -> ProcessingJob:
        return await self.orchestrator.execute_job(job_id, req)

    def get_job(self, job_id: str) -> Optional[ProcessingJob]:
        return self.storage.get_job(job_id)

    def list_jobs(self, limit: int = 25) -> List[ProcessingJob]:
        return self.storage.list_jobs(limit)
