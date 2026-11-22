"""
Automated tests for Alexura AI Lyrics Sync Engine (Phase 1):
1. Normalized LyricsDocument JSON schema validation (seconds relative to original audio).
2. ProcessingJob 9-state pipeline transitions and illegal transition rejection.
3. Optional Pydantic/FastAPI endpoint tests when FastAPI is installed.
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.app.core.state_machine import (
    PIPELINE_STAGE_ORDER,
    InvalidJobTransitionError,
    ProcessingPipelineState,
    assert_valid_job_transition,
    can_transition_job_state,
)
from backend.app.core.validation_rules import validate_lyrics_document_dict


def _make_sample_document(**overrides):
    base = {
        "schemaVersion": "1.0.0",
        "documentId": "lyr_test_001",
        "audioId": "aud_test_001",
        "jobId": "job_test_001",
        "title": "Sample Song",
        "artist": "Alexura Artist",
        "primaryLanguage": "fr",
        "detectedLanguages": ["fr"],
        "durationSeconds": 180.0,
        "timelineOriginSeconds": 0,
        "preservesOriginalAudio": True,
        "alignmentStatus": "unaligned",
        "source": "phase1_stub",
        "segments": [
            {
                "segmentId": "seg_000",
                "index": 0,
                "text": "Lumière du soir",
                "startSeconds": None,
                "endSeconds": None,
                "language": "fr",
                "sectionType": "verse",
                "vocalType": "lead",
                "speaker": "Lead",
                "confidence": None,
                "alignmentState": "unaligned",
                "isPlaceholder": False,
                "words": [
                    {
                        "wordId": "seg_000_w000",
                        "text": "Lumière",
                        "startSeconds": None,
                        "endSeconds": None,
                        "confidence": None,
                        "alignmentState": "unaligned",
                        "speaker": "Lead",
                        "flags": ["unaligned_phase1"],
                        "units": [
                            {
                                "unitId": "seg_000_w000_u00",
                                "text": "L",
                                "unitType": "character",
                                "startSeconds": None,
                                "endSeconds": None,
                                "confidence": None,
                                "alignmentState": "unaligned",
                            }
                        ],
                    }
                ],
            }
        ],
        "createdAt": "2026-11-21T00:00:00Z",
        "updatedAt": "2026-11-21T00:00:00Z",
    }
    base.update(overrides)
    return base


class TestNormalizedLyricsSchema(unittest.TestCase):
    def test_valid_unaligned_phase1_document_passes(self) -> None:
        doc = _make_sample_document()
        report = validate_lyrics_document_dict(doc)
        self.assertTrue(report.valid)
        self.assertEqual(report.segment_count, 1)
        self.assertEqual(report.word_count, 1)
        self.assertEqual(report.unit_count, 1)
        self.assertEqual(report.unaligned_word_count, 1)

    def test_valid_aligned_seconds_document_passes(self) -> None:
        doc = _make_sample_document(
            alignmentStatus="aligned",
            segments=[
                {
                    "segmentId": "seg_000",
                    "index": 0,
                    "text": "Lumière",
                    "startSeconds": 1.25,
                    "endSeconds": 2.4,
                    "sectionType": "verse",
                    "vocalType": "lead",
                    "alignmentState": "aligned",
                    "words": [
                        {
                            "wordId": "seg_000_w000",
                            "text": "Lumière",
                            "startSeconds": 1.3,
                            "endSeconds": 2.35,
                            "alignmentState": "aligned",
                            "flags": [],
                            "units": [
                                {
                                    "unitId": "seg_000_w000_u00",
                                    "text": "Lu",
                                    "unitType": "syllable",
                                    "startSeconds": 1.3,
                                    "endSeconds": 1.75,
                                    "alignmentState": "aligned",
                                }
                            ],
                        }
                    ],
                }
            ],
        )
        report = validate_lyrics_document_dict(doc)
        self.assertTrue(report.valid)
        self.assertEqual(report.aligned_segment_count, 1)
        self.assertEqual(report.unaligned_word_count, 0)

    def test_rejects_negative_and_inverted_timestamps(self) -> None:
        doc = _make_sample_document(
            segments=[
                {
                    "segmentId": "seg_000",
                    "index": 0,
                    "text": "Bad timestamps",
                    "startSeconds": -0.5,
                    "endSeconds": -1.2,
                    "sectionType": "verse",
                    "vocalType": "lead",
                    "alignmentState": "manual",
                    "words": [],
                }
            ]
        )
        report = validate_lyrics_document_dict(doc)
        self.assertFalse(report.valid)
        codes = {issue.code for issue in report.issues}
        self.assertIn("negative_timestamp", codes)
        self.assertIn("inverted_timestamp_range", codes)

    def test_rejects_non_zero_timeline_origin(self) -> None:
        doc = _make_sample_document(timelineOriginSeconds=5.0)
        report = validate_lyrics_document_dict(doc)
        self.assertFalse(report.valid)
        self.assertEqual(report.issues[0].code, "invalid_timeline_origin")

    def test_rejects_overlapping_segments(self) -> None:
        doc = _make_sample_document(
            segments=[
                {
                    "segmentId": "seg_000",
                    "index": 0,
                    "text": "Line 1",
                    "startSeconds": 1.0,
                    "endSeconds": 4.0,
                    "sectionType": "verse",
                    "vocalType": "lead",
                    "alignmentState": "manual",
                    "words": [],
                },
                {
                    "segmentId": "seg_001",
                    "index": 1,
                    "text": "Line 2",
                    "startSeconds": 3.5,
                    "endSeconds": 5.5,
                    "sectionType": "verse",
                    "vocalType": "lead",
                    "alignmentState": "manual",
                    "words": [],
                },
            ]
        )
        report = validate_lyrics_document_dict(doc)
        self.assertFalse(report.valid)
        self.assertEqual(report.issues[0].code, "overlapping_or_non_monotonic_segment")


class TestProcessingJobTransitions(unittest.TestCase):
    def test_all_9_pipeline_states_exist(self) -> None:
        expected = {
            "queued",
            "validating",
            "analyzing",
            "separating_vocals",
            "transcribing",
            "aligning",
            "validating_alignment",
            "completed",
            "failed",
        }
        self.assertEqual({s.value for s in ProcessingPipelineState}, expected)

    def test_valid_sequential_progression(self) -> None:
        for i in range(len(PIPELINE_STAGE_ORDER) - 1):
            cur = PIPELINE_STAGE_ORDER[i]
            nxt = PIPELINE_STAGE_ORDER[i + 1]
            self.assertTrue(can_transition_job_state(cur, nxt))
            self.assertEqual(assert_valid_job_transition(cur, nxt), nxt)

    def test_skip_vocal_separation_allowed(self) -> None:
        self.assertTrue(
            can_transition_job_state(
                ProcessingPipelineState.ANALYZING,
                ProcessingPipelineState.TRANSCRIBING,
            )
        )

    def test_illegal_skip_or_terminal_transition_raises(self) -> None:
        with self.assertRaises(InvalidJobTransitionError):
            assert_valid_job_transition(
                ProcessingPipelineState.QUEUED,
                ProcessingPipelineState.COMPLETED,
            )
        with self.assertRaises(InvalidJobTransitionError):
            assert_valid_job_transition(
                ProcessingPipelineState.COMPLETED,
                ProcessingPipelineState.VALIDATING,
            )

    def test_retry_from_failed_to_queued_allowed(self) -> None:
        self.assertEqual(
            assert_valid_job_transition(
                ProcessingPipelineState.FAILED,
                ProcessingPipelineState.QUEUED,
            ),
            ProcessingPipelineState.QUEUED,
        )


@unittest.skipUnless(
    importlib.util.find_spec("pydantic") is not None,
    "pydantic not installed in minimal container runtime",
)
class TestPydanticModelsWhenInstalled(unittest.TestCase):
    def test_pydantic_lyrics_document_and_job_transitions(self) -> None:
        from backend.app.schemas.jobs import ProcessingJob
        from backend.app.schemas.lyrics import LyricsDocument

        doc = LyricsDocument(**_make_sample_document())
        self.assertEqual(doc.timelineOriginSeconds, 0)

        job = ProcessingJob(jobId="job_1", audioId="aud_1")
        for nxt in PIPELINE_STAGE_ORDER[1:]:
            job.transition_to(nxt)
        self.assertEqual(job.state, ProcessingPipelineState.COMPLETED)


if __name__ == "__main__":
    unittest.main()
