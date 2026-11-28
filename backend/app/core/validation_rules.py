"""
Pure validation rules for the normalized LyricsDocument JSON schema.
Shared by Pydantic models, LyricsValidationService, and unit tests.
All timestamps are validated strictly in seconds (>= 0.0) relative to original audio.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


class LyricsSchemaValidationError(ValueError):
    """Raised when a LyricsDocument violates normalized timestamp or hierarchy invariants."""


@dataclass
class ValidationIssue:
    code: str
    path: str
    message: str


@dataclass
class LyricsValidationReport:
    valid: bool
    segment_count: int
    word_count: int
    unit_count: int
    aligned_segment_count: int
    unaligned_word_count: int
    issues: List[ValidationIssue] = field(default_factory=list)


def _check_span(
    start: Optional[float],
    end: Optional[float],
    path: str,
    issues: List[ValidationIssue],
    max_duration: Optional[float] = None,
) -> None:
    if start is None and end is None:
        return
    if (start is None) != (end is None):
        issues.append(
            ValidationIssue(
                code="incomplete_timestamp_pair",
                path=path,
                message="Both startSeconds and endSeconds must be present together or both null.",
            )
        )
        return
    assert start is not None and end is not None
    if start < 0 or end < 0:
        issues.append(
            ValidationIssue(
                code="negative_timestamp",
                path=path,
                message=f"Timestamps must be >= 0.0s (got start={start}, end={end}).",
            )
        )
    if end < start:
        issues.append(
            ValidationIssue(
                code="inverted_timestamp_range",
                path=path,
                message=f"endSeconds ({end}) must be >= startSeconds ({start}).",
            )
        )
    if max_duration is not None and max_duration > 0 and end > max_duration + 0.05:
        issues.append(
            ValidationIssue(
                code="timestamp_exceeds_duration",
                path=path,
                message=f"endSeconds ({end}) exceeds audio duration ({max_duration}s).",
            )
        )


def validate_lyrics_document_dict(doc: Dict[str, Any]) -> LyricsValidationReport:
    issues: List[ValidationIssue] = []

    if doc.get("schemaVersion") != "1.0.0":
        issues.append(
            ValidationIssue(
                code="unsupported_schema_version",
                path="schemaVersion",
                message="schemaVersion must be '1.0.0'.",
            )
        )

    if doc.get("timelineOriginSeconds") not in (0, 0.0):
        issues.append(
            ValidationIssue(
                code="invalid_timeline_origin",
                path="timelineOriginSeconds",
                message="timelineOriginSeconds must be strictly 0.0 relative to original audio.",
            )
        )

    duration = doc.get("durationSeconds", 0.0)
    if not isinstance(duration, (int, float)) or duration < 0:
        issues.append(
            ValidationIssue(
                code="invalid_duration",
                path="durationSeconds",
                message="durationSeconds must be a non-negative number in seconds.",
            )
        )
        max_dur: Optional[float] = None
    else:
        max_dur = float(duration) if duration > 0 else None

    segments = doc.get("segments")
    if not isinstance(segments, list):
        issues.append(
            ValidationIssue(
                code="invalid_segments_list",
                path="segments",
                message="segments must be an array.",
            )
        )
        segments = []

    word_count = 0
    unit_count = 0
    aligned_segments = 0
    unaligned_words = 0
    prev_seg_end: Optional[float] = None

    for s_idx, seg in enumerate(segments):
        seg_path = f"segments[{s_idx}]"
        s_start = seg.get("startSeconds")
        s_end = seg.get("endSeconds")
        _check_span(s_start, s_end, seg_path, issues, max_duration=max_dur)

        if s_start is not None and s_end is not None:
            aligned_segments += 1
            if prev_seg_end is not None and s_start < prev_seg_end - 0.001:
                issues.append(
                    ValidationIssue(
                        code="overlapping_or_non_monotonic_segment",
                        path=seg_path,
                        message=(
                            f"Segment startSeconds ({s_start}s) precedes previous segment "
                            f"endSeconds ({prev_seg_end}s)."
                        ),
                    )
                )
            prev_seg_end = float(s_end)

        words = seg.get("words") or []
        prev_word_end: Optional[float] = None
        for w_idx, word in enumerate(words):
            word_count += 1
            w_path = f"{seg_path}.words[{w_idx}]"
            w_start = word.get("startSeconds")
            w_end = word.get("endSeconds")
            _check_span(w_start, w_end, w_path, issues, max_duration=max_dur)
            if w_start is None and w_end is None:
                unaligned_words += 1
            elif w_start is not None and w_end is not None:
                if s_start is not None and w_start < s_start - 0.001:
                    issues.append(
                        ValidationIssue(
                            code="word_before_segment_start",
                            path=w_path,
                            message=f"Word startSeconds ({w_start}s) precedes segment start ({s_start}s).",
                        )
                    )
                if s_end is not None and w_end > s_end + 0.001:
                    issues.append(
                        ValidationIssue(
                            code="word_after_segment_end",
                            path=w_path,
                            message=f"Word endSeconds ({w_end}s) exceeds segment end ({s_end}s).",
                        )
                    )
                if prev_word_end is not None and w_start < prev_word_end - 0.001:
                    issues.append(
                        ValidationIssue(
                            code="overlapping_or_non_monotonic_word",
                            path=w_path,
                            message=f"Word startSeconds ({w_start}s) overlaps prior word end ({prev_word_end}s).",
                        )
                    )
                prev_word_end = float(w_end)

            units = word.get("units") or []
            prev_unit_end: Optional[float] = None
            for u_idx, unit in enumerate(units):
                unit_count += 1
                u_path = f"{w_path}.units[{u_idx}]"
                u_start = unit.get("startSeconds")
                u_end = unit.get("endSeconds")
                _check_span(u_start, u_end, u_path, issues, max_duration=max_dur)
                if u_start is not None and u_end is not None:
                    if w_start is not None and u_start < w_start - 0.001:
                        issues.append(
                            ValidationIssue(
                                code="unit_before_word_start",
                                path=u_path,
                                message="Unit startSeconds precedes parent word startSeconds.",
                            )
                        )
                    if w_end is not None and u_end > w_end + 0.001:
                        issues.append(
                            ValidationIssue(
                                code="unit_after_word_end",
                                path=u_path,
                                message="Unit endSeconds exceeds parent word endSeconds.",
                            )
                        )
                    if prev_unit_end is not None and u_start < prev_unit_end - 0.001:
                        issues.append(
                            ValidationIssue(
                                code="non_monotonic_unit",
                                path=u_path,
                                message="Unit startSeconds overlaps prior unit endSeconds.",
                            )
                        )
                    prev_unit_end = float(u_end)

    return LyricsValidationReport(
        valid=len(issues) == 0,
        segment_count=len(segments),
        word_count=word_count,
        unit_count=unit_count,
        aligned_segment_count=aligned_segments,
        unaligned_word_count=unaligned_words,
        issues=issues,
    )


def _round_sec(value: float) -> float:
    return round(float(value), 3)


def validate_analysis_segment_mapping(
    mapping: Dict[str, Any],
    original_duration: Optional[float] = None,
) -> List[ValidationIssue]:
    issues: List[ValidationIssue] = []
    seg_id = str(mapping.get("analysis_segment_id") or "").strip()
    if not seg_id:
        issues.append(
            ValidationIssue(
                code="invalid_analysis_segment_id",
                path="analysis_segment_id",
                message="analysis_segment_id must be a non-empty string.",
            )
        )

    for key in ("analysis_start", "analysis_end", "original_start", "original_end"):
        val = mapping.get(key)
        if not isinstance(val, (int, float)) or isinstance(val, bool) or val < 0:
            issues.append(
                ValidationIssue(
                    code="negative_or_invalid_mapping_timestamp",
                    path=key,
                    message=f"{key} must be a non-negative number in seconds.",
                )
            )

    a_start = mapping.get("analysis_start")
    a_end = mapping.get("analysis_end")
    o_start = mapping.get("original_start")
    o_end = mapping.get("original_end")

    if isinstance(a_start, (int, float)) and isinstance(a_end, (int, float)) and a_end <= a_start:
        issues.append(
            ValidationIssue(
                code="invalid_analysis_span",
                path="analysis_end",
                message=f"analysis_end ({a_end}) must be > analysis_start ({a_start}).",
            )
        )
    if isinstance(o_start, (int, float)) and isinstance(o_end, (int, float)) and o_end <= o_start:
        issues.append(
            ValidationIssue(
                code="invalid_original_span",
                path="original_end",
                message=f"original_end ({o_end}) must be > original_start ({o_start}).",
            )
        )
    if (
        isinstance(original_duration, (int, float))
        and original_duration > 0
        and isinstance(o_end, (int, float))
        and o_end > original_duration + 0.05
    ):
        issues.append(
            ValidationIssue(
                code="mapping_exceeds_original_duration",
                path="original_end",
                message=f"original_end ({o_end}) exceeds audio duration ({original_duration}s).",
            )
        )
    return issues


def remap_analysis_timestamp_to_original(
    analysis_time_sec: float,
    mapping: Dict[str, Any],
) -> float:
    a_start = float(mapping["analysis_start"])
    a_end = float(mapping["analysis_end"])
    o_start = float(mapping["original_start"])
    o_end = float(mapping["original_end"])
    a_span = max(1e-6, a_end - a_start)
    o_span = max(0.0, o_end - o_start)
    ratio = max(0.0, min(1.0, (float(analysis_time_sec) - a_start) / a_span))
    return _round_sec(o_start + ratio * o_span)


def remap_segment_alignment_to_original(
    segment: Dict[str, Any],
    mapping: Dict[str, Any],
) -> Dict[str, Any]:
    def map_opt(val: Optional[float]) -> Optional[float]:
        if val is None:
            return None
        return remap_analysis_timestamp_to_original(float(val), mapping)

    remapped_words = []
    for word in segment.get("words") or []:
        remapped_units = [
            {
                **unit,
                "start": map_opt(unit.get("start")),
                "end": map_opt(unit.get("end")),
            }
            for unit in (word.get("units") or [])
        ]
        remapped_words.append(
            {
                **word,
                "start": map_opt(word.get("start")),
                "end": map_opt(word.get("end")),
                "units": remapped_units,
            }
        )

    return {
        **segment,
        "start": map_opt(segment.get("start")),
        "end": map_opt(segment.get("end")),
        "words": remapped_words,
    }


def validate_canonical_song_alignment_dict(doc: Dict[str, Any]) -> LyricsValidationReport:
    issues: List[ValidationIssue] = []
    if not str(doc.get("song_id") or "").strip():
        issues.append(
            ValidationIssue(
                code="invalid_song_id",
                path="song_id",
                message="song_id must be a non-empty string.",
            )
        )

    duration = doc.get("audio_duration", 0.0)
    if not isinstance(duration, (int, float)) or isinstance(duration, bool) or duration < 0:
        issues.append(
            ValidationIssue(
                code="invalid_audio_duration",
                path="audio_duration",
                message="audio_duration must be a non-negative number in seconds.",
            )
        )
        max_dur: Optional[float] = None
    else:
        max_dur = float(duration) if duration > 0 else None

    segments = doc.get("segments")
    if not isinstance(segments, list):
        issues.append(
            ValidationIssue(
                code="invalid_segments_list",
                path="segments",
                message="segments must be an array.",
            )
        )
        segments = []

    word_count = 0
    unit_count = 0
    aligned_segments = 0
    unaligned_words = 0
    prev_seg_end: Optional[float] = None

    for s_idx, seg in enumerate(segments):
        seg_path = f"segments[{s_idx}]"
        s_start = seg.get("start")
        s_end = seg.get("end")
        _check_span(s_start, s_end, seg_path, issues, max_duration=max_dur)

        if s_start is not None and s_end is not None:
            aligned_segments += 1
            if prev_seg_end is not None and s_start < prev_seg_end - 0.001:
                issues.append(
                    ValidationIssue(
                        code="overlapping_or_non_monotonic_segment",
                        path=seg_path,
                        message=f"Segment start ({s_start}s) precedes previous end ({prev_seg_end}s).",
                    )
                )
            prev_seg_end = float(s_end)

        prev_word_end: Optional[float] = None
        for w_idx, word in enumerate(seg.get("words") or []):
            word_count += 1
            w_path = f"{seg_path}.words[{w_idx}]"
            w_start = word.get("start")
            w_end = word.get("end")
            _check_span(w_start, w_end, w_path, issues, max_duration=max_dur)

            for conf_key in ("confidence", "alignment_confidence"):
                conf_val = word.get(conf_key)
                if conf_val is not None and (
                    not isinstance(conf_val, (int, float)) or conf_val < 0 or conf_val > 1
                ):
                    issues.append(
                        ValidationIssue(
                            code="invalid_confidence_range",
                            path=f"{w_path}.{conf_key}",
                            message=f"{conf_key} must be between 0.0 and 1.0.",
                        )
                    )

            if w_start is None and w_end is None:
                unaligned_words += 1
            elif w_start is not None and w_end is not None:
                if s_start is not None and w_start < s_start - 0.001:
                    issues.append(
                        ValidationIssue(
                            code="word_before_segment_start",
                            path=w_path,
                            message="Word start precedes segment start.",
                        )
                    )
                if s_end is not None and w_end > s_end + 0.001:
                    issues.append(
                        ValidationIssue(
                            code="word_after_segment_end",
                            path=w_path,
                            message="Word end exceeds segment end.",
                        )
                    )
                if prev_word_end is not None and w_start < prev_word_end - 0.001:
                    issues.append(
                        ValidationIssue(
                            code="overlapping_or_non_monotonic_word",
                            path=w_path,
                            message="Word start overlaps prior word end.",
                        )
                    )
                prev_word_end = float(w_end)

            prev_unit_end: Optional[float] = None
            for u_idx, unit in enumerate(word.get("units") or []):
                unit_count += 1
                u_path = f"{w_path}.units[{u_idx}]"
                u_start = unit.get("start")
                u_end = unit.get("end")
                _check_span(u_start, u_end, u_path, issues, max_duration=max_dur)
                if u_start is not None and u_end is not None:
                    if w_start is not None and u_start < w_start - 0.001:
                        issues.append(
                            ValidationIssue(
                                code="unit_before_word_start",
                                path=u_path,
                                message="Unit start precedes parent word start.",
                            )
                        )
                    if w_end is not None and u_end > w_end + 0.001:
                        issues.append(
                            ValidationIssue(
                                code="unit_after_word_end",
                                path=u_path,
                                message="Unit end exceeds parent word end.",
                            )
                        )
                    if prev_unit_end is not None and u_start < prev_unit_end - 0.001:
                        issues.append(
                            ValidationIssue(
                                code="non_monotonic_unit",
                                path=u_path,
                                message="Unit start overlaps prior unit end.",
                            )
                        )
                    prev_unit_end = float(u_end)

    return LyricsValidationReport(
        valid=len(issues) == 0,
        segment_count=len(segments),
        word_count=word_count,
        unit_count=unit_count,
        aligned_segment_count=aligned_segments,
        unaligned_word_count=unaligned_words,
        issues=issues,
    )


def to_canonical_song_alignment_dict(
    doc: Dict[str, Any],
    alignment_version: str = "v1",
) -> Dict[str, Any]:
    status_map = {
        "unaligned": "unaligned",
        "phase1_placeholder": "unaligned",
        "partial_manual": "partial",
        "aligned": "completed",
        "validated": "validated",
    }
    doc_source = doc.get("source") or "phase1_stub"
    doc_status = doc.get("alignmentStatus") or "unaligned"
    if doc_source == "manual_editor":
        t_status = "manual"
    elif doc_source == "phase1_stub" and doc_status == "phase1_placeholder":
        t_status = "pending"
    else:
        t_status = "completed"

    word_seq = 0
    out_segments = []
    for s_idx, seg in enumerate(doc.get("segments") or []):
        out_words = []
        for word in seg.get("words") or []:
            word_seq += 1
            raw_units = word.get("units") or []
            if raw_units:
                units = [
                    {
                        "text": u.get("text", ""),
                        "start": _round_sec(u["startSeconds"]) if u.get("startSeconds") is not None else None,
                        "end": _round_sec(u["endSeconds"]) if u.get("endSeconds") is not None else None,
                    }
                    for u in raw_units
                ]
            else:
                units = [
                    {
                        "text": word.get("text", ""),
                        "start": _round_sec(word["startSeconds"]) if word.get("startSeconds") is not None else None,
                        "end": _round_sec(word["endSeconds"]) if word.get("endSeconds") is not None else None,
                    }
                ]
            out_words.append(
                {
                    "id": word.get("wordId") or f"word_{word_seq:03d}",
                    "text": word.get("text", ""),
                    "start": _round_sec(word["startSeconds"]) if word.get("startSeconds") is not None else None,
                    "end": _round_sec(word["endSeconds"]) if word.get("endSeconds") is not None else None,
                    "confidence": word.get("confidence"),
                    "alignment_confidence": word.get("confidence"),
                    "units": units,
                }
            )
        out_segments.append(
            {
                "id": seg.get("segmentId") or f"line_{s_idx + 1:03d}",
                "text": seg.get("text", ""),
                "start": _round_sec(seg["startSeconds"]) if seg.get("startSeconds") is not None else None,
                "end": _round_sec(seg["endSeconds"]) if seg.get("endSeconds") is not None else None,
                "words": out_words,
            }
        )

    return {
        "song_id": doc.get("audioId") or doc.get("documentId") or "song_001",
        "audio_duration": _round_sec(doc.get("durationSeconds") or 0.0),
        "language": doc.get("primaryLanguage") or "auto",
        "transcription_status": t_status,
        "alignment_status": status_map.get(doc_status, "unaligned"),
        "alignment_version": alignment_version,
        "segments": out_segments,
    }


def validate_canonical_processing_job_dict(job: Dict[str, Any]) -> List[ValidationIssue]:
    from .state_machine import ProcessingPipelineState

    issues: List[ValidationIssue] = []
    if not str(job.get("jobId") or "").strip():
        issues.append(
            ValidationIssue(
                code="invalid_job_id",
                path="jobId",
                message="jobId must be a non-empty string.",
            )
        )
    if not str(job.get("songId") or "").strip():
        issues.append(
            ValidationIssue(
                code="invalid_song_id",
                path="songId",
                message="songId must be a non-empty string.",
            )
        )

    valid_statuses = {s.value for s in ProcessingPipelineState}
    if str(job.get("status") or "") not in valid_statuses:
        issues.append(
            ValidationIssue(
                code="invalid_processing_status",
                path="status",
                message="status must be a valid canonical ProcessingStatus value.",
            )
        )

    progress = job.get("progress")
    if (
        not isinstance(progress, (int, float))
        or isinstance(progress, bool)
        or progress < 0
        or progress > 100
    ):
        issues.append(
            ValidationIssue(
                code="invalid_progress_range",
                path="progress",
                message="progress must be between 0 and 100.",
            )
        )

    if not str(job.get("currentStep") or "").strip():
        issues.append(
            ValidationIssue(
                code="invalid_current_step",
                path="currentStep",
                message="currentStep must be a non-empty string.",
            )
        )
    return issues


def to_canonical_processing_job_dict(job: Dict[str, Any]) -> Dict[str, Any]:
    from .state_machine import (
        DEFAULT_JOB_STEP_MESSAGES,
        STAGE_PROGRESS_PERCENT,
        ProcessingPipelineState,
    )

    raw_status = str(job.get("status") or job.get("state") or ProcessingPipelineState.QUEUED.value)
    enum_status = ProcessingPipelineState(raw_status)
    transitions = job.get("transitions") or []
    last_msg = transitions[-1].get("message", "") if transitions else ""
    current_step = (
        str(job.get("currentStep") or "").strip()
        or str(last_msg or "").strip()
        or DEFAULT_JOB_STEP_MESSAGES[enum_status]
    )
    raw_progress = job.get("progress")
    if raw_progress is None:
        raw_progress = job.get("progressPercent")
    if raw_progress is None:
        raw_progress = STAGE_PROGRESS_PERCENT[enum_status]

    payload: Dict[str, Any] = {
        "jobId": str(job.get("jobId") or ""),
        "songId": str(job.get("songId") or job.get("audioId") or ""),
        "status": enum_status.value,
        "progress": max(0, min(100, int(round(float(raw_progress))))),
        "currentStep": current_step,
    }
    if job.get("error"):
        payload["error"] = str(job["error"])
    return payload


def validate_aligned_lyrics_document_dict(doc: Dict[str, Any]) -> LyricsValidationReport:
    issues: List[ValidationIssue] = []
    if not str(doc.get("songId") or "").strip():
        issues.append(
            ValidationIssue(
                code="invalid_song_id",
                path="songId",
                message="songId must be a non-empty string.",
            )
        )

    duration = doc.get("duration", 0.0)
    if not isinstance(duration, (int, float)) or isinstance(duration, bool) or duration < 0:
        issues.append(
            ValidationIssue(
                code="invalid_duration",
                path="duration",
                message="duration must be a non-negative number in seconds.",
            )
        )
        max_dur: Optional[float] = None
    else:
        max_dur = float(duration) if duration > 0 else None

    if not str(doc.get("language") or "").strip():
        issues.append(
            ValidationIssue(
                code="invalid_language",
                path="language",
                message="language must be a non-empty string.",
            )
        )

    version = doc.get("version")
    if not isinstance(version, int) or isinstance(version, bool) or version < 1:
        issues.append(
            ValidationIssue(
                code="invalid_version",
                path="version",
                message="version must be an integer >= 1.",
            )
        )

    segments = doc.get("segments")
    if not isinstance(segments, list):
        issues.append(
            ValidationIssue(
                code="invalid_segments_list",
                path="segments",
                message="segments must be an array.",
            )
        )
        segments = []

    word_count = 0
    unit_count = 0
    aligned_segments = 0
    prev_seg_end: Optional[float] = None

    for s_idx, seg in enumerate(segments):
        seg_path = f"segments[{s_idx}]"
        if not str(seg.get("id") or "").strip():
            issues.append(
                ValidationIssue(
                    code="invalid_segment_id",
                    path=f"{seg_path}.id",
                    message="Segment id must be a non-empty string.",
                )
            )
        s_start = seg.get("start")
        s_end = seg.get("end")
        if (
            not isinstance(s_start, (int, float))
            or not isinstance(s_end, (int, float))
            or isinstance(s_start, bool)
            or isinstance(s_end, bool)
        ):
            issues.append(
                ValidationIssue(
                    code="incomplete_timestamp_pair",
                    path=seg_path,
                    message="Segment start and end must be finite numbers in seconds.",
                )
            )
            continue
        _check_span(float(s_start), float(s_end), seg_path, issues, max_duration=max_dur)
        aligned_segments += 1
        if prev_seg_end is not None and float(s_start) < prev_seg_end - 0.001:
            issues.append(
                ValidationIssue(
                    code="overlapping_or_non_monotonic_segment",
                    path=seg_path,
                    message=f"Segment start ({s_start}s) precedes previous end ({prev_seg_end}s).",
                )
            )
        prev_seg_end = float(s_end)

        prev_word_end: Optional[float] = None
        for w_idx, word in enumerate(seg.get("words") or []):
            word_count += 1
            w_path = f"{seg_path}.words[{w_idx}]"
            if not str(word.get("id") or "").strip():
                issues.append(
                    ValidationIssue(
                        code="invalid_word_id",
                        path=f"{w_path}.id",
                        message="Word id must be a non-empty string.",
                    )
                )
            w_start = word.get("start")
            w_end = word.get("end")
            if (
                not isinstance(w_start, (int, float))
                or not isinstance(w_end, (int, float))
                or isinstance(w_start, bool)
                or isinstance(w_end, bool)
            ):
                issues.append(
                    ValidationIssue(
                        code="incomplete_timestamp_pair",
                        path=w_path,
                        message="Word start and end must be finite numbers in seconds.",
                    )
                )
                continue
            _check_span(float(w_start), float(w_end), w_path, issues, max_duration=max_dur)

            for conf_key in ("confidence", "alignmentConfidence"):
                conf_val = word.get(conf_key)
                if conf_val is not None and (
                    not isinstance(conf_val, (int, float))
                    or isinstance(conf_val, bool)
                    or conf_val < 0
                    or conf_val > 1
                ):
                    issues.append(
                        ValidationIssue(
                            code="invalid_confidence_range",
                            path=f"{w_path}.{conf_key}",
                            message=f"{conf_key} must be between 0.0 and 1.0.",
                        )
                    )

            if float(w_start) < float(s_start) - 0.001:
                issues.append(
                    ValidationIssue(
                        code="word_before_segment_start",
                        path=w_path,
                        message="Word start precedes segment start.",
                    )
                )
            if float(w_end) > float(s_end) + 0.001:
                issues.append(
                    ValidationIssue(
                        code="word_after_segment_end",
                        path=w_path,
                        message="Word end exceeds segment end.",
                    )
                )
            if prev_word_end is not None and float(w_start) < prev_word_end - 0.001:
                issues.append(
                    ValidationIssue(
                        code="overlapping_or_non_monotonic_word",
                        path=w_path,
                        message="Word start overlaps prior word end.",
                    )
                )
            prev_word_end = float(w_end)

            prev_unit_end: Optional[float] = None
            for u_idx, unit in enumerate(word.get("units") or []):
                unit_count += 1
                u_path = f"{w_path}.units[{u_idx}]"
                u_start = unit.get("start")
                u_end = unit.get("end")
                if (
                    not isinstance(u_start, (int, float))
                    or not isinstance(u_end, (int, float))
                    or isinstance(u_start, bool)
                    or isinstance(u_end, bool)
                ):
                    issues.append(
                        ValidationIssue(
                            code="incomplete_timestamp_pair",
                            path=u_path,
                            message="Unit start and end must be finite numbers in seconds.",
                        )
                    )
                    continue
                _check_span(float(u_start), float(u_end), u_path, issues, max_duration=max_dur)
                if float(u_start) < float(w_start) - 0.001:
                    issues.append(
                        ValidationIssue(
                            code="unit_before_word_start",
                            path=u_path,
                            message="Unit start precedes parent word start.",
                        )
                    )
                if float(u_end) > float(w_end) + 0.001:
                    issues.append(
                        ValidationIssue(
                            code="unit_after_word_end",
                            path=u_path,
                            message="Unit end exceeds parent word end.",
                        )
                    )
                if prev_unit_end is not None and float(u_start) < prev_unit_end - 0.001:
                    issues.append(
                        ValidationIssue(
                            code="non_monotonic_unit",
                            path=u_path,
                            message="Unit start overlaps prior unit end.",
                        )
                    )
                prev_unit_end = float(u_end)

    return LyricsValidationReport(
        valid=len(issues) == 0,
        segment_count=len(segments),
        word_count=word_count,
        unit_count=unit_count,
        aligned_segment_count=aligned_segments,
        unaligned_word_count=0,
        issues=issues,
    )


def to_aligned_lyrics_document_dict(
    doc: Dict[str, Any],
    version: Optional[int] = None,
    review_threshold: float = 0.75,
) -> Dict[str, Any]:
    raw_version = version or doc.get("version") or (doc.get("metadata") or {}).get("version") or 1
    safe_version = max(1, int(raw_version))
    word_seq = 0
    out_segments = []

    for s_idx, seg in enumerate(doc.get("segments") or []):
        s_start = _round_sec(seg["startSeconds"]) if seg.get("startSeconds") is not None else 0.0
        s_end = (
            _round_sec(seg["endSeconds"])
            if seg.get("endSeconds") is not None
            else s_start
        )
        out_words = []
        for w in seg.get("words") or []:
            word_seq += 1
            w_id = w.get("wordId") or f"word_{word_seq:03d}"
            w_start = _round_sec(w["startSeconds"]) if w.get("startSeconds") is not None else s_start
            w_end = (
                _round_sec(w["endSeconds"])
                if w.get("endSeconds") is not None
                else w_start
            )
            word_obj: Dict[str, Any] = {
                "id": w_id,
                "text": w.get("text", ""),
                "start": w_start,
                "end": w_end,
            }
            conf = w.get("confidence")
            align_conf = w.get("alignmentConfidence")
            if align_conf is None:
                align_conf = conf
            if conf is not None:
                word_obj["confidence"] = conf
            if align_conf is not None:
                word_obj["alignmentConfidence"] = align_conf
            if w.get("reviewRequired") is not None:
                word_obj["reviewRequired"] = bool(w["reviewRequired"])
            elif align_conf is not None:
                word_obj["reviewRequired"] = float(align_conf) < review_threshold

            raw_units = w.get("units") or []
            if raw_units:
                out_units = []
                for u_idx, u in enumerate(raw_units):
                    u_start = (
                        _round_sec(u["startSeconds"])
                        if u.get("startSeconds") is not None
                        else w_start
                    )
                    u_end = (
                        _round_sec(u["endSeconds"])
                        if u.get("endSeconds") is not None
                        else u_start
                    )
                    u_obj: Dict[str, Any] = {
                        "id": u.get("unitId") or f"{w_id}_u{u_idx + 1:02d}",
                        "text": u.get("text", ""),
                        "start": u_start,
                        "end": u_end,
                    }
                    if u.get("confidence") is not None:
                        u_obj["confidence"] = u["confidence"]
                    out_units.append(u_obj)
                word_obj["units"] = out_units
            out_words.append(word_obj)

        out_segments.append(
            {
                "id": seg.get("segmentId") or f"seg_{s_idx + 1:03d}",
                "text": seg.get("text", ""),
                "start": s_start,
                "end": s_end,
                "words": out_words,
            }
        )

    return {
        "songId": doc.get("audioId") or doc.get("documentId") or "song_001",
        "duration": _round_sec(doc.get("durationSeconds") or 0.0),
        "language": doc.get("primaryLanguage") or "auto",
        "segments": out_segments,
        "version": safe_version,
    }


def from_aligned_lyrics_document_dict(
    aligned: Dict[str, Any],
    document_id: Optional[str] = None,
    title: Optional[str] = None,
    artist: str = "",
) -> Dict[str, Any]:
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    song_id = str(aligned.get("songId") or "song_001")
    lang = str(aligned.get("language") or "auto")
    version = max(1, int(aligned.get("version") or 1))
    has_review = any(
        bool(w.get("reviewRequired"))
        for seg in (aligned.get("segments") or [])
        for w in (seg.get("words") or [])
    )

    out_segments = []
    for s_idx, seg in enumerate(aligned.get("segments") or []):
        seg_id = seg.get("id") or f"seg_{s_idx + 1:03d}"
        out_words = []
        for w_idx, w in enumerate(seg.get("words") or []):
            w_id = w.get("id") or f"{seg_id}_w{w_idx + 1:03d}"
            conf = w.get("confidence")
            align_conf = w.get("alignmentConfidence")
            if conf is None:
                conf = align_conf
            if align_conf is None:
                align_conf = conf
            rev = bool(w.get("reviewRequired", False))
            out_units = [
                {
                    "unitId": u.get("id") or f"{w_id}_u{u_idx + 1:02d}",
                    "text": u.get("text", ""),
                    "unitType": "character",
                    "startSeconds": _round_sec(u["start"]),
                    "endSeconds": _round_sec(u["end"]),
                    "confidence": u.get("confidence", conf),
                    "alignmentState": "aligned",
                }
                for u_idx, u in enumerate(w.get("units") or [])
            ]
            out_words.append(
                {
                    "wordId": w_id,
                    "text": w.get("text", ""),
                    "startSeconds": _round_sec(w["start"]),
                    "endSeconds": _round_sec(w["end"]),
                    "confidence": conf,
                    "alignmentConfidence": align_conf,
                    "alignmentState": "aligned",
                    "reviewRequired": rev,
                    "speaker": "Lead",
                    "flags": ["review_required"] if rev else [],
                    "units": out_units,
                }
            )
        out_segments.append(
            {
                "segmentId": seg_id,
                "index": s_idx,
                "text": seg.get("text", ""),
                "startSeconds": _round_sec(seg["start"]),
                "endSeconds": _round_sec(seg["end"]),
                "language": lang,
                "sectionType": "verse",
                "vocalType": "lead",
                "speaker": "Lead",
                "confidence": None,
                "alignmentState": "aligned",
                "isPlaceholder": False,
                "words": out_words,
            }
        )

    return {
        "schemaVersion": "1.0.0",
        "documentId": document_id or f"lyr_{song_id}",
        "audioId": song_id,
        "jobId": None,
        "title": title or song_id,
        "artist": artist,
        "primaryLanguage": lang,
        "detectedLanguages": [] if lang == "auto" else [lang],
        "durationSeconds": _round_sec(aligned.get("duration") or 0.0),
        "timelineOriginSeconds": 0,
        "preservesOriginalAudio": True,
        "alignmentStatus": "aligned" if has_review else "validated",
        "source": "forced_alignment_adapter",
        "version": version,
        "metadata": {"version": version, "aligned_contract": "camelCase_v1"},
        "segments": out_segments,
        "createdAt": now,
        "updatedAt": now,
    }


