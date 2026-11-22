# Alexura — AI Lyrics Sync Engine (Phase 1: Architecture Foundation)

Minimalist, Apple-inspired dark music studio foundation for AI lyrics recognition, forced alignment, and karaoke synchronization.

## Monorepo Structure

```text
.
├── frontend/                     # React + TypeScript + Vite + Tailwind CSS + shadcn/ui
│   ├── components.json           # shadcn/ui configuration
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── types/lyrics.ts       # LyricsDocument, LyricSegment, LyricWord, LyricUnit, ProcessingJob
│       ├── services/
│       │   ├── playbackClock.ts  # HTML Audio API playback timeline (seconds relative to 0.000s)
│       │   └── syncEngineApi.ts  # Typed REST client (no API secrets in frontend)
│       ├── components/
│       │   ├── ui/               # shadcn/ui primitives (Button, Card, Tabs, Slider, Progress, ...)
│       │   ├── UploadScreen.tsx
│       │   ├── AudioPlayer.tsx
│       │   ├── WaveformTimelinePlaceholder.tsx  # WaveSurfer.js integration slot
│       │   ├── SynchronizedLyricsDisplay.tsx
│       │   └── PipelineAdaptersPanel.tsx
│       └── App.tsx
├── backend/                      # Python + FastAPI + Pydantic REST API
│   ├── requirements.txt
│   ├── fastapi_app.py            # Combined legacy v2 + Phase 1 v1 FastAPI entrypoint
│   ├── app/
│   │   ├── main.py               # Phase 1 FastAPI entrypoint
│   │   ├── core/                 # Config, structured logging, 9-state FSM, validation rules
│   │   ├── schemas/              # Pydantic v2 LyricsDocument & ProcessingJob models
│   │   ├── adapters/             # SingingASRAdapter, VocalSeparationAdapter, ForcedAlignmentAdapter, LyricsValidationService
│   │   ├── services/             # Path-confined audio & JSON persistence
│   │   ├── workers/              # Async background pipeline orchestrator
│   │   └── api/routes.py         # /api/v1/* endpoints
│   └── tests/                    # Python unittest / pytest suite
├── schemas/lyrics.schema.json    # Normalized Draft-2020-12 JSON Schema
├── server/routes/syncEngineRoutes.ts  # Express /api/v1 parity router on port 3000
├── tests/                        # TypeScript schema & transition tests
└── .env.example                  # Backend-only secrets & configuration template
```

## Processing Pipeline States

All jobs follow strict finite-state-machine transitions across:

1. `queued`
2. `validating`
3. `analyzing`
4. `separating_vocals`
5. `transcribing`
6. `aligning`
7. `validating_alignment`
8. `completed` / `failed`

## Phase 1 Honesty & Security Principles

- **Zero fake timestamps**: Unaligned words and units preserve `startSeconds: null` / `endSeconds: null`.
- **No simulated AI lyrics**: Unimplemented models are explicitly declared as `Unconfigured*Adapter` / `DevMock*Adapter` stubs ready for Phase 2.
- **API Key Isolation**: `GEMINI_API_KEY` and external inference endpoints remain strictly in backend environment variables (`.env`), never prefixed with `VITE_`.
- **Timeline Integrity**: All timestamps use seconds (`>= 0.0`) relative to the untouched original uploaded audio file (`timelineOriginSeconds: 0`).

## Local Setup & Startup

### 1. Environment Variables
```bash
cp .env.example .env
# Populate GEMINI_API_KEY in .env on the backend only if enabling Phase 2 server calls.
```

### 2. Run the Integrated Full-Stack Server (Port 3000)
```bash
npm install
npm run build
npm run dev
```
Open `http://localhost:3000/studio/` (or launch directly from Alexura `/fr/` via `🎛 Studio IA React`).

### 3. Run the Python FastAPI Backend Standalone (Port 8000)
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload --port 8000
```

### 4. Run the Vite React Frontend Standalone (Port 5173)
```bash
cd frontend
npm run dev
```

### 5. Run Verification Tests
```bash
# Python normalized schema & state machine tests
python3 -m unittest discover -s backend/tests -v

# TypeScript schema & state machine tests
node --experimental-strip-types --test tests/lyricsSchemaAndJobs.test.mjs
```
