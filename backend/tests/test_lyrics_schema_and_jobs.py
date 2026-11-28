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


class TestSegmentRemappingAndCanonicalContract(unittest.TestCase):
    def test_segment_mapping_remaps_analysis_to_original_seconds(self) -> None:
        from backend.app.core.validation_rules import (
            remap_analysis_timestamp_to_original,
            remap_segment_alignment_to_original,
            validate_analysis_segment_mapping,
        )

        mapping = {
            "analysis_segment_id": "seg_002",
            "analysis_start": 6.4,
            "analysis_end": 14.1,
            "original_start": 21.0,
            "original_end": 28.7,
        }
        self.assertEqual(validate_analysis_segment_mapping(mapping, original_duration=185.42), [])
        self.assertEqual(remap_analysis_timestamp_to_original(6.4, mapping), 21.0)
        self.assertEqual(remap_analysis_timestamp_to_original(14.1, mapping), 28.7)
        self.assertEqual(remap_analysis_timestamp_to_original(10.25, mapping), 24.85)

        seg = {
            "id": "line_001",
            "text": "我爱你",
            "start": 7.4,
            "end": 9.16,
            "words": [
                {
                    "id": "word_001",
                    "text": "我",
                    "start": 7.4,
                    "end": 7.69,
                    "confidence": 0.96,
                    "alignment_confidence": 0.92,
                    "units": [{"text": "我", "start": 7.4, "end": 7.69}],
                }
            ],
        }
        remapped = remap_segment_alignment_to_original(seg, mapping)
        self.assertEqual(remapped["start"], 22.0)
        self.assertEqual(remapped["end"], 23.76)
        self.assertEqual(remapped["words"][0]["units"][0]["end"], 22.29)

    def test_canonical_song_001_chinese_contract_validates_cleanly(self) -> None:
        from backend.app.core.validation_rules import (
            to_canonical_song_alignment_dict,
            validate_canonical_song_alignment_dict,
        )

        canonical = {
            "song_id": "song_001",
            "audio_duration": 185.42,
            "language": "zh",
            "transcription_status": "completed",
            "alignment_status": "completed",
            "alignment_version": "v1",
            "segments": [
                {
                    "id": "line_001",
                    "text": "我爱你",
                    "start": 12.32,
                    "end": 14.08,
                    "words": [
                        {
                            "id": "word_001",
                            "text": "我",
                            "start": 12.32,
                            "end": 12.61,
                            "confidence": 0.96,
                            "alignment_confidence": 0.92,
                            "units": [{"text": "我", "start": 12.32, "end": 12.61}],
                        },
                        {
                            "id": "word_002",
                            "text": "爱",
                            "start": 12.62,
                            "end": 13.15,
                            "confidence": 0.98,
                            "alignment_confidence": 0.94,
                            "units": [{"text": "爱", "start": 12.62, "end": 13.15}],
                        },
                        {
                            "id": "word_003",
                            "text": "你",
                            "start": 13.16,
                            "end": 14.08,
                            "confidence": 0.97,
                            "alignment_confidence": 0.89,
                            "units": [{"text": "你", "start": 13.16, "end": 14.08}],
                        },
                    ],
                }
            ],
        }
        report = validate_canonical_song_alignment_dict(canonical)
        self.assertTrue(report.valid)
        self.assertEqual(report.word_count, 3)
        self.assertEqual(report.unit_count, 3)

        converted = to_canonical_song_alignment_dict(_make_sample_document())
        self.assertEqual(converted["song_id"], "aud_test_001")
        self.assertEqual(converted["alignment_version"], "v1")

    def test_canonical_processing_job_contract(self) -> None:
        from backend.app.core.validation_rules import (
            to_canonical_processing_job_dict,
            validate_canonical_processing_job_dict,
        )

        sample_job = {
            "jobId": "job_001",
            "songId": "song_001",
            "status": "aligning",
            "progress": 72,
            "currentStep": "Aligning word boundaries",
        }
        self.assertEqual(validate_canonical_processing_job_dict(sample_job), [])

        legacy_job = {
            "jobId": "job_001",
            "audioId": "song_001",
            "state": "aligning",
            "progressPercent": 78,
            "transitions": [
                {"fromState": "transcribing", "toState": "aligning", "message": "Aligning word boundaries"}
            ],
            "error": None,
        }
        projected = to_canonical_processing_job_dict(legacy_job)
        self.assertEqual(projected["jobId"], "job_001")
        self.assertEqual(projected["songId"], "song_001")
        self.assertEqual(projected["status"], "aligning")
        self.assertEqual(projected["progress"], 78)
        self.assertEqual(projected["currentStep"], "Aligning word boundaries")
        self.assertNotIn("error", projected)

        invalid = validate_canonical_processing_job_dict(
            {"jobId": "", "songId": "song_001", "status": "unknown", "progress": 120, "currentStep": ""}
        )
        self.assertGreaterEqual(len(invalid), 4)

    def test_aligned_lyrics_document_contract(self) -> None:
        from backend.app.core.validation_rules import (
            from_aligned_lyrics_document_dict,
            to_aligned_lyrics_document_dict,
            validate_aligned_lyrics_document_dict,
        )

        aligned = {
            "songId": "song_001",
            "duration": 185.42,
            "language": "en",
            "version": 1,
            "segments": [
                {
                    "id": "seg_001",
                    "text": "love",
                    "start": 32.4,
                    "end": 32.95,
                    "words": [
                        {
                            "id": "word_005",
                            "text": "love",
                            "start": 32.417,
                            "end": 32.891,
                            "confidence": 0.98,
                            "alignmentConfidence": 0.71,
                            "reviewRequired": True,
                            "units": [
                                {"id": "word_005_u01", "text": "lo", "start": 32.417, "end": 32.65, "confidence": 0.95},
                                {"id": "word_005_u02", "text": "ve", "start": 32.651, "end": 32.891, "confidence": 0.96},
                            ],
                        }
                    ],
                }
            ],
        }
        report = validate_aligned_lyrics_document_dict(aligned)
        self.assertTrue(report.valid)
        self.assertEqual(report.word_count, 1)
        self.assertEqual(report.unit_count, 2)

        normalized = from_aligned_lyrics_document_dict(aligned)
        self.assertTrue(validate_lyrics_document_dict(normalized).valid)
        self.assertEqual(normalized["segments"][0]["words"][0]["wordId"], "word_005")
        self.assertEqual(normalized["segments"][0]["words"][0]["startSeconds"], 32.417)
        self.assertEqual(normalized["segments"][0]["words"][0]["endSeconds"], 32.891)

        round_trip = to_aligned_lyrics_document_dict(normalized)
        self.assertEqual(round_trip["songId"], "song_001")
        self.assertEqual(round_trip["version"], 1)
        self.assertEqual(round_trip["segments"][0]["words"][0]["start"], 32.417)
        self.assertEqual(round_trip["segments"][0]["words"][0]["end"], 32.891)
        self.assertEqual(round_trip["segments"][0]["words"][0]["reviewRequired"], True)


class TestUnifiedSingingASRAndRouting(unittest.TestCase):
    def test_adapters_conform_to_unified_singing_asr_interface(self) -> None:
        import asyncio
        from backend.app.adapters.asr_service import (
            CustomModelAdapter,
            GeminiASRAdapter,
            LocalSingingASRAdapter,
            SingingASRAdapter,
            WhisperSingingAdapter,
        )

        adapters = [
            GeminiASRAdapter(api_key=""),
            WhisperSingingAdapter(),
            LocalSingingASRAdapter(),
            CustomModelAdapter(name="custom_test"),
        ]
        for adapter in adapters:
            self.assertIsInstance(adapter, SingingASRAdapter)
            res = asyncio.run(adapter.transcribe("demo.wav", language="zh"))
            self.assertIn("language", res)
            self.assertIn("segments", res)
            self.assertIn("confidence", res)
            self.assertIn("has_word_timestamps", res)

    def test_routing_skips_fallback_when_primary_high_confidence(self) -> None:
        import asyncio
        from backend.app.adapters.asr_service import (
            CustomModelAdapter,
            ModelRoutingStrategy,
            normalize_transcription_payload,
        )

        calls = {"primary": 0, "fallback": 0}

        async def primary_hook(audio_path: str, language: str | None):
            calls["primary"] += 1
            return normalize_transcription_payload(
                model_name="gemini",
                language=language or "en",
                language_confidence=0.98,
                segments=[
                    {
                        "id": "seg_001",
                        "text": "I still remember",
                        "start": 1.0,
                        "end": 3.5,
                        "confidence": 0.94,
                        "words": [
                            {"id": "w1", "text": "I", "start": 1.0, "end": 1.4, "confidence": 0.96},
                            {"id": "w2", "text": "still", "start": 1.5, "end": 2.1, "confidence": 0.93},
                        ],
                    },
                    {
                        "id": "seg_002",
                        "text": "How you said love",
                        "start": 3.8,
                        "end": 6.4,
                        "confidence": 0.92,
                    },
                ],
            )

        async def fallback_hook(audio_path: str, language: str | None):
            calls["fallback"] += 1
            return normalize_transcription_payload(model_name="whisper_singing", language="en", segments=[])

        router = ModelRoutingStrategy(
            primary=CustomModelAdapter(name="gemini", hook=primary_hook),
            fallbacks=[CustomModelAdapter(name="whisper_singing", hook=fallback_hook)],
        )
        out = asyncio.run(router.transcribe_with_routing("song.wav"))
        self.assertFalse(out["routing"]["triggered_fallback"])
        self.assertEqual(calls["primary"], 1)
        self.assertEqual(calls["fallback"], 0)
        self.assertEqual(out["routing"]["selected_model"], "gemini")
        self.assertTrue(out["quality"]["passed"])
        self.assertTrue(out["aligner_input"]["ready_for_independent_alignment"])
        self.assertIn("How you said love", out["aligner_input"]["full_text"])

    def test_routing_triggers_fallback_on_repetition_gaps_or_low_confidence(self) -> None:
        import asyncio
        from backend.app.adapters.asr_service import (
            CustomModelAdapter,
            ModelRoutingStrategy,
            normalize_transcription_payload,
        )

        async def weak_primary(audio_path: str, language: str | None):
            return normalize_transcription_payload(
                model_name="gemini",
                language="zh",
                language_confidence=0.6,
                segments=[
                    {"id": "s1", "text": "la la", "start": 0.5, "end": 2.0, "confidence": 0.51},
                    {"id": "s2", "text": "la la", "start": 2.1, "end": 4.0, "confidence": 0.48},
                    {"id": "s3", "text": "la la", "start": 35.0, "end": 37.0, "confidence": 0.45},
                ],
            )

        async def strong_whisper(audio_path: str, language: str | None):
            return normalize_transcription_payload(
                model_name="whisper_singing",
                language=language or "zh",
                language_confidence=0.95,
                segments=[
                    {"id": "s1", "text": "我爱你", "start": 12.32, "end": 14.08, "confidence": 0.94},
                    {"id": "s2", "text": "在星空下", "start": 14.5, "end": 17.2, "confidence": 0.91},
                ],
            )

        router = ModelRoutingStrategy(
            primary=CustomModelAdapter(name="gemini", hook=weak_primary),
            fallbacks=[CustomModelAdapter(name="whisper_singing", hook=strong_whisper)],
        )
        out = asyncio.run(router.transcribe_with_routing("song_001.wav"))
        self.assertTrue(out["routing"]["triggered_fallback"])
        self.assertEqual(out["routing"]["selected_model"], "whisper_singing")
        self.assertEqual(out["routing"]["model_calls"], 2)
        self.assertIn("abnormal_repetition", out["routing"]["attempts"][0]["quality"]["issues"])
        self.assertIn("recognition_gap", out["routing"]["attempts"][0]["quality"]["issues"])
        self.assertTrue(out["quality"]["passed"])
        self.assertEqual(out["aligner_input"]["language"], "zh")
        self.assertEqual(out["aligner_input"]["segments"][0]["text"], "我爱你")


class TestRealAudioUploadService(unittest.TestCase):
    @staticmethod
    def _build_wav_bytes(sample_rate: int = 16000, duration_s: float = 0.5) -> bytes:
        import io
        import math
        import struct
        import wave

        buf = io.BytesIO()
        n_frames = int(sample_rate * duration_s)
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            samples = [
                int(16000 * math.sin(2.0 * math.pi * 440.0 * i / sample_rate))
                for i in range(n_frames)
            ]
            wf.writeframes(struct.pack(f"<{len(samples)}h", *samples))
        return buf.getvalue()

    def test_wav_upload_extracts_real_metadata_peaks_and_persists_untouched(self) -> None:
        import tempfile
        from backend.app.audio_service import AudioUploadService

        wav_bytes = self._build_wav_bytes(sample_rate=16000, duration_s=0.5)
        with tempfile.TemporaryDirectory() as tmpdir:
            svc = AudioUploadService(storage_root=tmpdir, max_upload_bytes=10 * 1024 * 1024)
            rec = svc.ingest_bytes(wav_bytes, filename="../demo_vocal.wav", mime_type="audio/wav")

            self.assertEqual(rec["filename"], "demo_vocal.wav")
            self.assertEqual(rec["sampleRateHz"], 16000)
            self.assertEqual(rec["channels"], 1)
            self.assertEqual(rec["bitDepth"], 16)
            self.assertAlmostEqual(rec["durationSeconds"], 0.5, places=2)
            self.assertGreater(len(rec["waveformPeaks"]), 0)
            self.assertEqual(rec["byteSize"], len(wav_bytes))

            stored = svc.get_audio_file_path(rec["audioId"])
            self.assertIsNotNone(stored)
            self.assertEqual(stored.read_bytes(), wav_bytes)
            self.assertEqual(len(svc.list_audio()), 1)
            self.assertTrue(svc.delete_audio(rec["audioId"]))
            self.assertIsNone(svc.get_audio(rec["audioId"]))

    def test_upload_rejects_spoofed_magic_empty_oversize_and_traversal(self) -> None:
        import tempfile
        from backend.app.audio_service import AudioUploadService, AudioUploadValidationError

        with tempfile.TemporaryDirectory() as tmpdir:
            svc = AudioUploadService(storage_root=tmpdir, max_upload_bytes=128)
            with self.assertRaises(AudioUploadValidationError):
                svc.ingest_bytes(b"NOT_A_REAL_WAV_HEADER", filename="fake.wav")
            with self.assertRaises(AudioUploadValidationError):
                svc.ingest_bytes(b"", filename="empty.wav")
            with self.assertRaises(AudioUploadValidationError):
                svc.ingest_bytes(b"RIFF\x00\x00\x00\x00WAVE" + b"\x00" * 200, filename="big.wav")
            with self.assertRaises(AudioUploadValidationError):
                svc.ingest_bytes(b"#!/bin/sh", filename="script.sh")
            self.assertIsNone(svc.get_audio("../secret"))

    def test_probe_helpers_generate_waveform_and_media_types(self) -> None:
        import tempfile
        from backend.app.audio_service import (
            MAX_DURATION_SECONDS,
            SUPPORTED_EXTENSIONS,
            generate_waveform,
            get_audio_stream,
            get_duration,
            get_media_type,
        )

        self.assertIn(".opus", SUPPORTED_EXTENSIONS)
        self.assertEqual(get_media_type(".mp3"), "audio/mpeg")
        self.assertEqual(get_media_type(".opus"), "audio/ogg")
        self.assertEqual(get_media_type(".unknown"), "application/octet-stream")

        probe_ok = {
            "streams": [{"codec_type": "video"}, {"codec_type": "audio", "duration": "123.45"}],
            "format": {"duration": "123.45"},
        }
        stream = get_audio_stream(probe_ok)
        self.assertEqual(stream["codec_type"], "audio")
        self.assertAlmostEqual(get_duration(probe_ok, stream), 123.45, places=2)

        with self.assertRaises(ValueError):
            get_audio_stream({"streams": [{"codec_type": "video"}]})
        with self.assertRaises(ValueError):
            get_duration({}, {"duration": "0"})
        with self.assertRaises(ValueError):
            get_duration({}, {"duration": str(MAX_DURATION_SECONDS + 1)})

        wav_bytes = self._build_wav_bytes(sample_rate=16000, duration_s=0.25)
        with tempfile.TemporaryDirectory() as tmpdir:
            wav_path = Path(tmpdir) / "tone.wav"
            wav_path.write_bytes(wav_bytes)
            peaks = generate_waveform(wav_path, target_bins=120)
            self.assertGreater(len(peaks), 0)
            self.assertTrue(all(0.0 <= p <= 1.0 for p in peaks))
            self.assertGreater(max(peaks), 0.35)


if __name__ == "__main__":
    unittest.main()
