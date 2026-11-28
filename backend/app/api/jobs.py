"""Modular jobs & segment remapping router (/api/v1/jobs/*)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from ..core.config import Settings, get_settings
from ..core.task_manager import TaskManager
from ..schemas.jobs import AnalyzeSongRequest, ProcessingJob
from ..schemas.lyrics import AnalysisSegmentMapping, CanonicalAlignmentSegment
from ..services.alignment_service import AlignmentService

router = APIRouter(prefix="/api/v1", tags=["jobs"])


class SegmentRemapRequest(BaseModel):
    mapping: AnalysisSegmentMapping
    audioDuration: Optional[float] = None
    segment: Optional[CanonicalAlignmentSegment] = None
    segments: Optional[List[CanonicalAlignmentSegment]] = None
    analysisTimestamp: Optional[float] = None


def _get_manager(settings: Settings = Depends(get_settings)) -> TaskManager:
    return TaskManager(settings=settings)


@router.post("/jobs/analyze", status_code=202)
def analyze_song(
    req: AnalyzeSongRequest,
    background_tasks: BackgroundTasks,
    manager: TaskManager = Depends(_get_manager),
) -> Dict[str, Any]:
    audio = manager.storage.get_audio(req.audioId)
    if not audio:
        raise HTTPException(status_code=404, detail="audio_not_found")
    job: ProcessingJob = manager.create_job(req)
    background_tasks.add_task(manager.run_job, job.jobId, req)
    return {"success": True, "job": job.model_dump()}


@router.post("/jobs/remap-segment")
def remap_segment(req: SegmentRemapRequest) -> Dict[str, Any]:
    mapping_dict = req.mapping.model_dump()
    issues = AlignmentService.validate_mapping(mapping_dict, original_duration=req.audioDuration)
    if issues:
        raise HTTPException(status_code=422, detail=f"{issues[0].path}: {issues[0].message}")

    if req.segment is not None:
        return {
            "success": True,
            "mapping": mapping_dict,
            "segment": AlignmentService.remap_segment(req.segment.model_dump(), mapping_dict),
        }
    if req.segments is not None:
        return {
            "success": True,
            "mapping": mapping_dict,
            "segments": [
                AlignmentService.remap_segment(s.model_dump(), mapping_dict) for s in req.segments
            ],
        }
    if req.analysisTimestamp is not None:
        return {
            "success": True,
            "mapping": mapping_dict,
            "original_timestamp": AlignmentService.remap_timestamp(
                req.analysisTimestamp, mapping_dict
            ),
        }
    return {
        "success": True,
        "mapping": mapping_dict,
        "offset_seconds": round(req.mapping.original_start - req.mapping.analysis_start, 3),
    }


@router.get("/jobs")
def list_jobs(
    format: Optional[str] = None,
    manager: TaskManager = Depends(_get_manager),
) -> Dict[str, Any]:
    jobs = manager.list_jobs(25)
    serialized = (
        [j.to_canonical().model_dump(exclude_none=True) for j in jobs]
        if format == "canonical"
        else [j.model_dump() for j in jobs]
    )
    return {"success": True, "jobs": serialized}


@router.get("/jobs/{job_id}")
def get_job_status(
    job_id: str,
    format: Optional[str] = None,
    manager: TaskManager = Depends(_get_manager),
) -> Dict[str, Any]:
    job = manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job_not_found")
    if format == "canonical":
        return job.to_canonical().model_dump(exclude_none=True)
    return {"success": True, "job": job.model_dump()}


@router.get("/jobs/{job_id}/canonical")
def get_canonical_job_status(
    job_id: str,
    manager: TaskManager = Depends(_get_manager),
) -> Dict[str, Any]:
    job = manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job_not_found")
    return job.to_canonical().model_dump(exclude_none=True)
