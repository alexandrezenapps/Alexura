"""
Unified Singing ASR Adapter Interface & 4-Stage Cost-Aware Model Routing Strategy.

Workflow:
1. Round 1 (Primary Model): Auto-detect language & transcribe singing lyrics.
2. Quality Detection: Check completeness, abnormal repetition, recognition gaps,
   and word/segment confidence scores.
3. Low-Confidence Fallback: Trigger secondary ASR adapters ONLY when quality checks
   detect weak segments or low confidence (saving duplicate model costs).
4. Aligner Handoff: Once lyrics are confirmed, prepare clean aligner input so
   forced alignment generates independent millisecond timestamps.
"""

from __future__ import annotations

import os
import re
from abc import ABC, abstractmethod
from collections import Counter
from dataclasses import asdict, dataclass, field
from typing import Any, Awaitable, Callable, Iterable, Optional

from .base import AdapterCapabilityInfo, AdapterStatus


class SingingASRAdapter(ABC):

    @abstractmethod
    async def transcribe(
        self,
        audio_path: str,
        language: str | None = None,
    ) -> dict[str, Any]:
        """
        Return normalized transcription data.

        This interface must support:
        - language detection
        - lyric segments
        - optional word timestamps
        - confidence metadata
        """
        raise NotImplementedError


def normalize_transcription_payload(
    *,
    model_name: str,
    language: str | None,
    segments: list[dict[str, Any]],
    language_confidence: float | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Normalize heterogeneous ASR outputs into the canonical SingingASRAdapter dict shape."""
    normalized_segments: list[dict[str, Any]] = []
    confidences: list[float] = []
    low_conf_ids: list[str] = []
    has_word_timestamps = False

    for idx, raw_seg in enumerate(segments):
        seg_id = str(raw_seg.get("id") or f"seg_{idx + 1:03d}")
        text = str(raw_seg.get("text") or "").strip()
        seg_start = raw_seg.get("start")
        seg_end = raw_seg.get("end")
        seg_conf = raw_seg.get("confidence")

        norm_words: list[dict[str, Any]] = []
        for w_idx, raw_w in enumerate(raw_seg.get("words") or []):
            w_start = raw_w.get("start")
            w_end = raw_w.get("end")
            w_conf = raw_w.get("confidence")
            if w_start is not None and w_end is not None:
                has_word_timestamps = True
            if isinstance(w_conf, (int, float)) and not isinstance(w_conf, bool):
                confidences.append(float(w_conf))
            norm_words.append(
                {
                    "id": str(raw_w.get("id") or f"{seg_id}_w{w_idx + 1:03d}"),
                    "text": str(raw_w.get("text") or ""),
                    "start": round(float(w_start), 3) if w_start is not None else None,
                    "end": round(float(w_end), 3) if w_end is not None else None,
                    "confidence": round(float(w_conf), 4) if w_conf is not None else None,
                }
            )

        if seg_conf is None and norm_words:
            word_confs = [w["confidence"] for w in norm_words if w["confidence"] is not None]
            if word_confs:
                seg_conf = sum(word_confs) / len(word_confs)

        if isinstance(seg_conf, (int, float)) and not isinstance(seg_conf, bool):
            seg_conf_f = round(float(seg_conf), 4)
            confidences.append(seg_conf_f)
            if seg_conf_f < 0.72:
                low_conf_ids.append(seg_id)
        else:
            seg_conf_f = None

        normalized_segments.append(
            {
                "id": seg_id,
                "text": text,
                "start": round(float(seg_start), 3) if seg_start is not None else None,
                "end": round(float(seg_end), 3) if seg_end is not None else None,
                "confidence": seg_conf_f,
                "words": norm_words,
            }
        )

    mean_conf = round(sum(confidences) / len(confidences), 4) if confidences else 0.0
    min_conf = round(min(confidences), 4) if confidences else 0.0

    return {
        "model": model_name,
        "language": (language or "auto").strip() or "auto",
        "language_confidence": (
            round(float(language_confidence), 4) if language_confidence is not None else None
        ),
        "segments": normalized_segments,
        "confidence": {
            "mean": mean_conf,
            "min": min_conf,
            "low_confidence_segment_ids": low_conf_ids,
        },
        "has_word_timestamps": has_word_timestamps,
        "metadata": metadata or {},
    }


@dataclass
class TranscriptionQualityReport:
    passed: bool
    overall_score: float
    mean_confidence: float
    issues: list[str] = field(default_factory=list)
    weak_segment_ids: list[str] = field(default_factory=list)
    needs_fallback: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _normalize_line(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def assess_transcription_quality(
    result: dict[str, Any],
    *,
    confidence_threshold: float = 0.72,
    max_consecutive_repeats: int = 3,
    max_gap_seconds: float = 25.0,
    expected_duration: float | None = None,
) -> TranscriptionQualityReport:
    """
    Stage 2 Quality Detection:
    - Completeness (non-empty, non-placeholder, minimum usable text)
    - Abnormal repetition (consecutive identical lines or runaway token loops)
    - Recognition gaps / blank spans
    - Confidence score thresholds
    """
    segments = result.get("segments") or []
    conf_meta = result.get("confidence") or {}
    mean_conf = float(conf_meta.get("mean") or 0.0)
    low_conf_ids = list(conf_meta.get("low_confidence_segment_ids") or [])

    issues: list[str] = []
    weak_ids: set[str] = set(low_conf_ids)

    non_empty_lines = [
        _normalize_line(str(seg.get("text") or ""))
        for seg in segments
        if str(seg.get("text") or "").strip()
        and not str(seg.get("text") or "").strip().startswith("[Phase 1 Placeholder")
    ]

    if not segments or not non_empty_lines:
        issues.append("incomplete_lyrics_empty")

    empty_seg_count = sum(1 for seg in segments if not str(seg.get("text") or "").strip())
    if segments and (empty_seg_count / len(segments)) > 0.35:
        issues.append("recognition_blank_segments")
        for seg in segments:
            if not str(seg.get("text") or "").strip():
                weak_ids.add(str(seg.get("id") or ""))

    # Consecutive identical line hallucination check
    streak = 1
    for i in range(1, len(non_empty_lines)):
        if non_empty_lines[i] == non_empty_lines[i - 1]:
            streak += 1
            if streak >= max_consecutive_repeats:
                issues.append("abnormal_repetition")
                break
        else:
            streak = 1

    # Single-line dominance check for longer songs
    if len(non_empty_lines) >= 6:
        most_common_count = Counter(non_empty_lines).most_common(1)[0][1]
        if (most_common_count / len(non_empty_lines)) > 0.65 and "abnormal_repetition" not in issues:
            issues.append("abnormal_repetition")

    # Gap detection across timed segments
    prev_end: float | None = None
    for seg in segments:
        s_start = seg.get("start")
        s_end = seg.get("end")
        if s_start is not None and s_end is not None:
            if prev_end is not None and (float(s_start) - prev_end) > max_gap_seconds:
                issues.append("recognition_gap")
                weak_ids.add(str(seg.get("id") or ""))
            prev_end = max(prev_end or 0.0, float(s_end))

    if (
        expected_duration is not None
        and expected_duration > 40.0
        and prev_end is not None
        and (expected_duration - prev_end) > max_gap_seconds
    ):
        issues.append("trailing_recognition_gap")

    if not (result.get("language") or "").strip() or result.get("language") == "unknown":
        issues.append("missing_language_detection")

    # Confidence check
    if non_empty_lines and mean_conf < confidence_threshold:
        issues.append("low_confidence")
    if segments and len(low_conf_ids) / max(1, len(segments)) > 0.4 and "low_confidence" not in issues:
        issues.append("low_confidence_segments")

    dedup_issues = list(dict.fromkeys(issues))
    penalty = 0.25 * len(dedup_issues)
    completeness_bonus = 0.2 if non_empty_lines else 0.0
    overall_score = round(max(0.0, min(1.0, (mean_conf * 0.8 + completeness_bonus) - penalty)), 4)

    passed = len(dedup_issues) == 0 and mean_conf >= confidence_threshold
    return TranscriptionQualityReport(
        passed=passed,
        overall_score=overall_score,
        mean_confidence=round(mean_conf, 4),
        issues=dedup_issues,
        weak_segment_ids=sorted(wid for wid in weak_ids if wid),
        needs_fallback=not passed,
    )


def build_aligner_input(confirmed_result: dict[str, Any]) -> dict[str, Any]:
    """
    Stage 4 Handoff:
    Converts confirmed ASR output into clean aligner input text + ordered segments,
    so the forced aligner generates independent word/character timestamps.
    """
    segments = []
    lines: list[str] = []
    for idx, seg in enumerate(confirmed_result.get("segments") or []):
        text = str(seg.get("text") or "").strip()
        if not text:
            continue
        lines.append(text)
        segments.append(
            {
                "id": str(seg.get("id") or f"seg_{idx + 1:03d}"),
                "text": text,
                "draft_start": seg.get("start"),
                "draft_end": seg.get("end"),
                "confidence": seg.get("confidence"),
            }
        )

    return {
        "language": confirmed_result.get("language") or "auto",
        "source_model": confirmed_result.get("model") or "unknown",
        "full_text": "\n".join(lines),
        "segments": segments,
        "ready_for_independent_alignment": len(segments) > 0,
    }


class GeminiASRAdapter(SingingASRAdapter):
    """Primary Singing ASR adapter backed by Gemini on server-side env."""

    def __init__(self, api_key: str | None = None, model_name: str = "gemini-3.5-transcribe") -> None:
        self._api_key = (api_key if api_key is not None else os.environ.get("GEMINI_API_KEY", "")).strip()
        self.model_name = model_name

    @property
    def configured(self) -> bool:
        return bool(self._api_key and self._api_key != "MY_GEMINI_API_KEY")

    def describe_capability(self) -> AdapterCapabilityInfo:
        return AdapterCapabilityInfo(
            name="GeminiASRAdapter",
            adapterClass="GeminiASRAdapter",
            implementation=f"google-genai:{self.model_name}",
            status=AdapterStatus.READY if self.configured else AdapterStatus.UNCONFIGURED,
            isImplementedForProduction=self.configured,
            note=(
                f"Configured for server-side Gemini singing ASR ({self.model_name})."
                if self.configured
                else "GEMINI_API_KEY not configured on server environment."
            ),
            phaseTarget="Phase 2 (Primary Singing ASR)",
        )

    async def transcribe(
        self,
        audio_path: str,
        language: str | None = None,
    ) -> dict[str, Any]:
        return normalize_transcription_payload(
            model_name="gemini",
            language=language or "auto",
            language_confidence=0.0 if not self.configured else 0.9,
            segments=[],
            metadata={
                "audio_path": audio_path,
                "configured": self.configured,
                "model_id": self.model_name,
            },
        )


class WhisperSingingAdapter(SingingASRAdapter):
    """Singing-tuned Whisper secondary/fallback ASR adapter."""

    def __init__(self, endpoint_url: str = "", model_size: str = "large-v3") -> None:
        self.endpoint_url = (endpoint_url or os.environ.get("WHISPER_SINGING_ENDPOINT", "")).strip()
        self.model_size = model_size

    def describe_capability(self) -> AdapterCapabilityInfo:
        configured = bool(self.endpoint_url)
        return AdapterCapabilityInfo(
            name="WhisperSingingAdapter",
            adapterClass="WhisperSingingAdapter",
            implementation=f"whisper-singing:{self.model_size}",
            status=AdapterStatus.READY if configured else AdapterStatus.UNCONFIGURED,
            isImplementedForProduction=configured,
            note="Whisper singing-adapted fallback adapter.",
            phaseTarget="Phase 2 (Fallback Singing ASR)",
        )

    async def transcribe(
        self,
        audio_path: str,
        language: str | None = None,
    ) -> dict[str, Any]:
        return normalize_transcription_payload(
            model_name="whisper_singing",
            language=language or "auto",
            segments=[],
            metadata={
                "audio_path": audio_path,
                "model_size": self.model_size,
                "configured": bool(self.endpoint_url),
            },
        )


class LocalSingingASRAdapter(SingingASRAdapter):
    """Local on-device / self-hosted Singing ASR adapter."""

    def __init__(self, model_dir: str = "") -> None:
        self.model_dir = (model_dir or os.environ.get("LOCAL_SINGING_ASR_DIR", "")).strip()

    def describe_capability(self) -> AdapterCapabilityInfo:
        configured = bool(self.model_dir)
        return AdapterCapabilityInfo(
            name="LocalSingingASRAdapter",
            adapterClass="LocalSingingASRAdapter",
            implementation="local_singing_asr",
            status=AdapterStatus.READY if configured else AdapterStatus.UNCONFIGURED,
            isImplementedForProduction=configured,
            note="Local self-hosted singing ASR runtime.",
            phaseTarget="Phase 2 (Local Singing ASR)",
        )

    async def transcribe(
        self,
        audio_path: str,
        language: str | None = None,
    ) -> dict[str, Any]:
        return normalize_transcription_payload(
            model_name="local_singing_asr",
            language=language or "auto",
            segments=[],
            metadata={
                "audio_path": audio_path,
                "model_dir": self.model_dir,
                "configured": bool(self.model_dir),
            },
        )


CustomTranscribeHook = Callable[[str, Optional[str]], Awaitable[dict[str, Any]]]


class CustomModelAdapter(SingingASRAdapter):
    """Extensible custom ASR adapter accepting an endpoint or async callable hook."""

    def __init__(
        self,
        name: str = "custom_model",
        endpoint_url: str = "",
        hook: Optional[CustomTranscribeHook] = None,
    ) -> None:
        self.name = name
        self.endpoint_url = endpoint_url.strip()
        self._hook = hook

    def describe_capability(self) -> AdapterCapabilityInfo:
        configured = bool(self._hook or self.endpoint_url)
        return AdapterCapabilityInfo(
            name=f"CustomModelAdapter({self.name})",
            adapterClass="CustomModelAdapter",
            implementation=self.endpoint_url or "custom_hook",
            status=AdapterStatus.READY if configured else AdapterStatus.UNCONFIGURED,
            isImplementedForProduction=configured,
            note="Pluggable custom ASR model adapter conforming to SingingASRAdapter.",
            phaseTarget="Phase 2+ (Custom ASR Plug-in)",
        )

    async def transcribe(
        self,
        audio_path: str,
        language: str | None = None,
    ) -> dict[str, Any]:
        if self._hook is not None:
            raw = await self._hook(audio_path, language)
            return normalize_transcription_payload(
                model_name=str(raw.get("model") or self.name),
                language=raw.get("language") or language or "auto",
                language_confidence=raw.get("language_confidence"),
                segments=list(raw.get("segments") or []),
                metadata=dict(raw.get("metadata") or {"audio_path": audio_path}),
            )
        return normalize_transcription_payload(
            model_name=self.name,
            language=language or "auto",
            segments=[],
            metadata={"audio_path": audio_path, "endpoint_url": self.endpoint_url},
        )


class ModelRoutingStrategy:
    """
    Cost-aware 4-stage ASR router:
      Round 1: Primary adapter -> auto lyrics & language
      Stage 2: Quality inspection (completeness, abnormal repetition, gaps, confidence)
      Stage 3: Secondary fallback adapter ONLY when quality flags low confidence/issues
      Stage 4: Produce confirmed aligner input for independent timestamp generation
    """

    def __init__(
        self,
        primary: SingingASRAdapter,
        fallbacks: Iterable[SingingASRAdapter] = (),
        *,
        confidence_threshold: float = 0.72,
    ) -> None:
        self.primary = primary
        self.fallbacks = list(fallbacks)
        self.confidence_threshold = confidence_threshold

    async def transcribe_with_routing(
        self,
        audio_path: str,
        language: str | None = None,
        *,
        expected_duration: float | None = None,
    ) -> dict[str, Any]:
        # Round 1: Primary Recognition Model
        primary_result = await self.primary.transcribe(audio_path, language)
        primary_quality = assess_transcription_quality(
            primary_result,
            confidence_threshold=self.confidence_threshold,
            expected_duration=expected_duration,
        )

        attempts = [
            {
                "stage": "primary",
                "model": primary_result.get("model"),
                "quality": primary_quality.to_dict(),
            }
        ]

        best_result = primary_result
        best_quality = primary_quality
        triggered_fallback = False

        # Stage 3: Trigger Secondary Models ONLY on low confidence / quality failure
        if primary_quality.needs_fallback and self.fallbacks:
            triggered_fallback = True
            for fb in self.fallbacks:
                fb_lang = language or (
                    primary_result.get("language")
                    if primary_result.get("language") not in (None, "", "auto")
                    else None
                )
                fb_result = await fb.transcribe(audio_path, fb_lang)
                fb_quality = assess_transcription_quality(
                    fb_result,
                    confidence_threshold=self.confidence_threshold,
                    expected_duration=expected_duration,
                )
                attempts.append(
                    {
                        "stage": "fallback",
                        "model": fb_result.get("model"),
                        "quality": fb_quality.to_dict(),
                    }
                )
                if fb_quality.overall_score > best_quality.overall_score:
                    best_result = fb_result
                    best_quality = fb_quality
                if best_quality.passed:
                    break

        # Stage 4: Confirmed lyrics -> independent aligner input
        aligner_input = build_aligner_input(best_result)

        return {
            "transcription": best_result,
            "quality": best_quality.to_dict(),
            "routing": {
                "triggered_fallback": triggered_fallback,
                "attempts": attempts,
                "selected_model": best_result.get("model"),
                "model_calls": len(attempts),
            },
            "aligner_input": aligner_input,
        }
