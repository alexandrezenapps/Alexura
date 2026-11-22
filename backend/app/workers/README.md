# Background Workers & Phase 2 Roadmap

`backend/app/workers/pipeline_worker.py` orchestrates the 9-state processing lifecycle:

`queued` → `validating` → `analyzing` → `separating_vocals` → `transcribing` → `aligning` → `validating_alignment` → `completed` / `failed`.

## Phase 2 Ready Extension Points
1. Replace `UnconfiguredVocalSeparationAdapter` with a worker calling Demucs/MDX-Net.
2. Replace `UnconfiguredSingingASRAdapter` with Gemini audio understanding + singing-aware ASR.
3. Replace `UnconfiguredForcedAlignmentAdapter` with a real CTC phoneme/character forced aligner (e.g. Wav2Vec2/MFA/CTC aligner) outputting `startSeconds` & `endSeconds` strictly relative to the untouched original audio timeline.
4. Wire Redis / Celery / Dramatiq worker queues behind the exact same `ProcessingJob` finite-state machine.
