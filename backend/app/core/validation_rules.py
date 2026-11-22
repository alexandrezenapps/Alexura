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
