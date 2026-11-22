"""
Alexura Structured Timestamp, Job Queue, Upload Deduplication & Analysis Cache SQLite Store
Strictly parameterized queries via stdlib sqlite3.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any, Dict, List


DEFAULT_DB_PATH = os.environ.get("ALEXURA_DB_PATH", ".alexura_data/timestamps.db")


def _connect(db_path: str = DEFAULT_DB_PATH) -> sqlite3.Connection:
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=15.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    _init_schema(conn)
    return conn


def _init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS uploads (
            id TEXT PRIMARY KEY,
            filename TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            byte_size INTEGER NOT NULL,
            sha256 TEXT NOT NULL,
            duration_sec REAL NOT NULL DEFAULT 0,
            sample_rate INTEGER NOT NULL DEFAULT 0,
            channels INTEGER NOT NULL DEFAULT 0,
            waveform_json TEXT NOT NULL DEFAULT '[]',
            vocal_segments_json TEXT NOT NULL DEFAULT '[]',
            storage_path TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            upload_id TEXT NOT NULL,
            song_id TEXT,
            status TEXT NOT NULL,
            stage TEXT NOT NULL,
            progress INTEGER NOT NULL DEFAULT 0,
            lang TEXT NOT NULL DEFAULT 'auto',
            mode TEXT NOT NULL DEFAULT 'hybrid_pipeline',
            retry_count INTEGER NOT NULL DEFAULT 0,
            cached_hit INTEGER NOT NULL DEFAULT 0,
            request_params_json TEXT NOT NULL DEFAULT '{}',
            capabilities_json TEXT NOT NULL DEFAULT '{}',
            result_json TEXT,
            error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (upload_id) REFERENCES uploads(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS analysis_cache (
            cache_key TEXT PRIMARY KEY,
            audio_sha256 TEXT NOT NULL,
            params_hash TEXT NOT NULL,
            song_id TEXT NOT NULL,
            result_json TEXT NOT NULL,
            hit_count INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            last_hit_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS songs (
            id TEXT PRIMARY KEY,
            upload_id TEXT,
            title TEXT NOT NULL,
            artist TEXT NOT NULL DEFAULT '',
            language TEXT NOT NULL DEFAULT 'auto',
            detected_languages_json TEXT NOT NULL DEFAULT '[]',
            audio_type TEXT NOT NULL DEFAULT 'singing',
            duration_sec REAL NOT NULL DEFAULT 0,
            bpm REAL NOT NULL DEFAULT 0,
            provenance_json TEXT NOT NULL DEFAULT '{}',
            validation_summary_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS lyric_lines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            song_id TEXT NOT NULL,
            line_index INTEGER NOT NULL,
            text TEXT NOT NULL,
            start_sec REAL NOT NULL,
            end_sec REAL NOT NULL,
            section TEXT NOT NULL DEFAULT 'verse',
            vocal_type TEXT NOT NULL DEFAULT 'singing',
            language TEXT NOT NULL DEFAULT '',
            speaker TEXT NOT NULL DEFAULT 'Lead',
            recognition_confidence REAL NOT NULL DEFAULT 0,
            alignment_confidence REAL NOT NULL DEFAULT 0,
            flags_json TEXT NOT NULL DEFAULT '[]',
            provenance TEXT NOT NULL DEFAULT 'dsp_acoustic_viterbi',
            UNIQUE (song_id, line_index),
            FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS lyric_words (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            song_id TEXT NOT NULL,
            line_index INTEGER NOT NULL,
            word_index INTEGER NOT NULL,
            text TEXT NOT NULL,
            start_sec REAL NOT NULL,
            end_sec REAL NOT NULL,
            recognition_confidence REAL NOT NULL DEFAULT 0,
            alignment_confidence REAL NOT NULL DEFAULT 0,
            audio_clarity REAL NOT NULL DEFAULT 0,
            vocal_overlap REAL NOT NULL DEFAULT 0,
            quality_tier TEXT NOT NULL DEFAULT 'MEDIUM',
            speaker TEXT NOT NULL DEFAULT 'Lead',
            flags_json TEXT NOT NULL DEFAULT '[]',
            phonemes_json TEXT NOT NULL DEFAULT '[]',
            chars_json TEXT NOT NULL DEFAULT '[]',
            provenance TEXT NOT NULL DEFAULT 'dsp_acoustic_viterbi',
            UNIQUE (song_id, line_index, word_index),
            FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_uploads_sha ON uploads(sha256);
        CREATE INDEX IF NOT EXISTS idx_jobs_upload ON jobs(upload_id);
        CREATE INDEX IF NOT EXISTS idx_jobs_updated ON jobs(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_lines_song ON lyric_lines(song_id, line_index);
        CREATE INDEX IF NOT EXISTS idx_words_song ON lyric_words(song_id, line_index, word_index);
        """
    )
    # Safe additive column migrations for existing DB files
    existing_cols = {r["name"] for r in conn.execute("PRAGMA table_info(jobs)").fetchall()}
    if "retry_count" not in existing_cols:
        conn.execute("ALTER TABLE jobs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0")
    if "cached_hit" not in existing_cols:
        conn.execute("ALTER TABLE jobs ADD COLUMN cached_hit INTEGER NOT NULL DEFAULT 0")
    if "request_params_json" not in existing_cols:
        conn.execute("ALTER TABLE jobs ADD COLUMN request_params_json TEXT NOT NULL DEFAULT '{}'")


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _row_to_upload(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "filename": row["filename"],
        "mimeType": row["mime_type"],
        "byteSize": row["byte_size"],
        "sha256": row["sha256"],
        "durationSec": row["duration_sec"],
        "sampleRate": row["sample_rate"],
        "channels": row["channels"],
        "waveformPeaks": json.loads(row["waveform_json"] or "[]"),
        "vocalSegments": json.loads(row["vocal_segments_json"] or "[]"),
        "storagePath": row["storage_path"],
        "createdAt": row["created_at"],
    }


def upsert_upload(conn: sqlite3.Connection, data: Dict[str, Any]) -> Dict[str, Any]:
    now = data.get("createdAt") or _now_iso()
    conn.execute(
        """
        INSERT INTO uploads (
            id, filename, mime_type, byte_size, sha256, duration_sec, sample_rate,
            channels, waveform_json, vocal_segments_json, storage_path, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            duration_sec = excluded.duration_sec,
            sample_rate = excluded.sample_rate,
            channels = excluded.channels,
            waveform_json = excluded.waveform_json,
            vocal_segments_json = excluded.vocal_segments_json
        """,
        (
            str(data["id"]),
            str(data["filename"]),
            str(data["mimeType"]),
            int(data["byteSize"]),
            str(data["sha256"]),
            float(data.get("durationSec") or 0),
            int(data.get("sampleRate") or 0),
            int(data.get("channels") or 0),
            json.dumps(data.get("waveformPeaks") or []),
            json.dumps(data.get("vocalSegments") or []),
            str(data["storagePath"]),
            now,
        ),
    )
    conn.commit()
    return get_upload(conn, str(data["id"])) or {}


def get_upload(conn: sqlite3.Connection, upload_id: str) -> Dict[str, Any] | None:
    row = conn.execute("SELECT * FROM uploads WHERE id = ?", (upload_id,)).fetchone()
    return _row_to_upload(row) if row else None


def find_upload_by_sha256(conn: sqlite3.Connection, sha256: str) -> Dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM uploads WHERE sha256 = ? ORDER BY created_at DESC LIMIT 1",
        (sha256,),
    ).fetchone()
    return _row_to_upload(row) if row else None


def _row_to_job(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "uploadId": row["upload_id"],
        "songId": row["song_id"],
        "status": row["status"],
        "stage": row["stage"],
        "progress": row["progress"],
        "lang": row["lang"],
        "mode": row["mode"],
        "retryCount": int(row["retry_count"] or 0),
        "cachedHit": bool(row["cached_hit"]),
        "requestParams": json.loads(row["request_params_json"] or "{}"),
        "capabilities": json.loads(row["capabilities_json"] or "{}"),
        "result": json.loads(row["result_json"]) if row["result_json"] else None,
        "error": row["error"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def upsert_job(conn: sqlite3.Connection, data: Dict[str, Any]) -> Dict[str, Any]:
    now = _now_iso()
    created = data.get("createdAt") or now
    conn.execute(
        """
        INSERT INTO jobs (
            id, upload_id, song_id, status, stage, progress, lang, mode,
            retry_count, cached_hit, request_params_json, capabilities_json,
            result_json, error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            song_id = excluded.song_id,
            status = excluded.status,
            stage = excluded.stage,
            progress = excluded.progress,
            retry_count = excluded.retry_count,
            cached_hit = excluded.cached_hit,
            request_params_json = excluded.request_params_json,
            capabilities_json = excluded.capabilities_json,
            result_json = excluded.result_json,
            error = excluded.error,
            updated_at = excluded.updated_at
        """,
        (
            str(data["id"]),
            str(data["uploadId"]),
            data.get("songId"),
            str(data["status"]),
            str(data["stage"]),
            int(data.get("progress") or 0),
            str(data.get("lang") or "auto"),
            str(data.get("mode") or "hybrid_pipeline"),
            int(data.get("retryCount") or 0),
            1 if data.get("cachedHit") else 0,
            json.dumps(data.get("requestParams") or {}),
            json.dumps(data.get("capabilities") or {}),
            json.dumps(data.get("result")) if data.get("result") is not None else None,
            data.get("error"),
            created,
            now,
        ),
    )
    conn.commit()
    return get_job(conn, str(data["id"])) or {}


def get_job(conn: sqlite3.Connection, job_id: str) -> Dict[str, Any] | None:
    row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return _row_to_job(row) if row else None


def list_jobs(conn: sqlite3.Connection, limit: int = 25) -> List[Dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM jobs ORDER BY updated_at DESC LIMIT ?",
        (max(1, min(100, int(limit))),),
    ).fetchall()
    out: List[Dict[str, Any]] = []
    for r in rows:
        item = _row_to_job(r)
        # Keep job listing lightweight by omitting large full result payload
        item["result"] = None
        out.append(item)
    return out


def get_cached_analysis(conn: sqlite3.Connection, cache_key: str) -> Dict[str, Any] | None:
    row = conn.execute("SELECT * FROM analysis_cache WHERE cache_key = ?", (cache_key,)).fetchone()
    if not row:
        return None
    now = _now_iso()
    conn.execute(
        "UPDATE analysis_cache SET hit_count = hit_count + 1, last_hit_at = ? WHERE cache_key = ?",
        (now, cache_key),
    )
    conn.commit()
    return {
        "cacheKey": row["cache_key"],
        "audioSha256": row["audio_sha256"],
        "songId": row["song_id"],
        "hitCount": int(row["hit_count"]) + 1,
        "result": json.loads(row["result_json"]),
        "createdAt": row["created_at"],
    }


def save_cached_analysis(conn: sqlite3.Connection, data: Dict[str, Any]) -> None:
    now = _now_iso()
    conn.execute(
        """
        INSERT INTO analysis_cache (
            cache_key, audio_sha256, params_hash, song_id, result_json, hit_count, created_at, last_hit_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
            song_id = excluded.song_id,
            result_json = excluded.result_json,
            last_hit_at = excluded.last_hit_at
        """,
        (
            str(data["cacheKey"]),
            str(data["audioSha256"]),
            str(data.get("paramsHash") or ""),
            str(data["songId"]),
            json.dumps(data["result"]),
            now,
            now,
        ),
    )
    conn.commit()


def save_song_timestamps(conn: sqlite3.Connection, data: Dict[str, Any]) -> Dict[str, Any]:
    song_id = str(data["songId"])
    now = _now_iso()
    existing = conn.execute("SELECT created_at FROM songs WHERE id = ?", (song_id,)).fetchone()
    created = existing["created_at"] if existing else now

    conn.execute(
        """
        INSERT INTO songs (
            id, upload_id, title, artist, language, detected_languages_json,
            audio_type, duration_sec, bpm, provenance_json, validation_summary_json,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            upload_id = COALESCE(excluded.upload_id, songs.upload_id),
            title = excluded.title,
            artist = excluded.artist,
            language = excluded.language,
            detected_languages_json = excluded.detected_languages_json,
            audio_type = excluded.audio_type,
            duration_sec = excluded.duration_sec,
            bpm = excluded.bpm,
            provenance_json = excluded.provenance_json,
            validation_summary_json = excluded.validation_summary_json,
            updated_at = excluded.updated_at
        """,
        (
            song_id,
            data.get("uploadId"),
            str(data.get("title") or "Sans titre")[:200],
            str(data.get("artist") or "")[:200],
            str(data.get("language") or "auto")[:32],
            json.dumps(data.get("detectedLanguages") or []),
            str(data.get("audioType") or "singing")[:32],
            float(data.get("durationSec") or 0),
            float(data.get("bpm") or 0),
            json.dumps(data.get("provenance") or {}),
            json.dumps(data.get("validationSummary") or {}),
            created,
            now,
        ),
    )

    conn.execute("DELETE FROM lyric_words WHERE song_id = ?", (song_id,))
    conn.execute("DELETE FROM lyric_lines WHERE song_id = ?", (song_id,))

    lines = data.get("lines") or []
    for l_idx, ln in enumerate(lines):
        l_prov = str(ln.get("provenance") or data.get("defaultProvenance") or "dsp_acoustic_viterbi")
        conn.execute(
            """
            INSERT INTO lyric_lines (
                song_id, line_index, text, start_sec, end_sec, section, vocal_type,
                language, speaker, recognition_confidence, alignment_confidence, flags_json, provenance
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                song_id,
                l_idx,
                str(ln.get("text") or ""),
                float(ln.get("start") or 0),
                float(ln.get("end") or 0),
                str(ln.get("section") or "verse"),
                str(ln.get("vocalType") or "singing"),
                str(ln.get("language") or ""),
                str(ln.get("speaker") or "Lead"),
                float(ln.get("recognitionConfidence") or 0),
                float(ln.get("alignmentConfidence") or 0),
                json.dumps(ln.get("flags") or []),
                l_prov,
            ),
        )
        words = ln.get("words") or []
        for w_idx, w in enumerate(words):
            conn.execute(
                """
                INSERT INTO lyric_words (
                    song_id, line_index, word_index, text, start_sec, end_sec,
                    recognition_confidence, alignment_confidence, audio_clarity, vocal_overlap,
                    quality_tier, speaker, flags_json, phonemes_json, chars_json, provenance
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    song_id,
                    l_idx,
                    w_idx,
                    str(w.get("text") or ""),
                    float(w.get("start") or 0),
                    float(w.get("end") or 0),
                    float(w.get("recognitionConfidence") or 0),
                    float(w.get("alignmentConfidence") or 0),
                    float(w.get("audioClarity") or 0.7),
                    float(w.get("vocalOverlap") or 0.1),
                    str(w.get("qualityTier") or "MEDIUM"),
                    str(w.get("speaker") or ln.get("speaker") or "Lead"),
                    json.dumps(w.get("flags") or []),
                    json.dumps(w.get("phonemes") or []),
                    json.dumps(w.get("chars") or []),
                    str(w.get("provenance") or l_prov),
                ),
            )
    conn.commit()
    return get_song_timestamps(conn, song_id) or {}


def get_song_timestamps(conn: sqlite3.Connection, song_id: str) -> Dict[str, Any] | None:
    srow = conn.execute("SELECT * FROM songs WHERE id = ?", (song_id,)).fetchone()
    if not srow:
        return None
    line_rows = conn.execute(
        "SELECT * FROM lyric_lines WHERE song_id = ? ORDER BY line_index ASC",
        (song_id,),
    ).fetchall()
    word_rows = conn.execute(
        "SELECT * FROM lyric_words WHERE song_id = ? ORDER BY line_index ASC, word_index ASC",
        (song_id,),
    ).fetchall()

    words_by_line: Dict[int, List[Dict[str, Any]]] = {}
    for w in word_rows:
        words_by_line.setdefault(w["line_index"], []).append({
            "wordIndex": w["word_index"],
            "text": w["text"],
            "start": w["start_sec"],
            "end": w["end_sec"],
            "recognitionConfidence": w["recognition_confidence"],
            "alignmentConfidence": w["alignment_confidence"],
            "audioClarity": w["audio_clarity"],
            "vocalOverlap": w["vocal_overlap"],
            "qualityTier": w["quality_tier"],
            "speaker": w["speaker"],
            "flags": json.loads(w["flags_json"] or "[]"),
            "phonemes": json.loads(w["phonemes_json"] or "[]"),
            "chars": json.loads(w["chars_json"] or "[]"),
            "provenance": w["provenance"],
        })

    lines_out: List[Dict[str, Any]] = []
    for ln in line_rows:
        idx = ln["line_index"]
        lines_out.append({
            "lineIndex": idx,
            "text": ln["text"],
            "start": ln["start_sec"],
            "end": ln["end_sec"],
            "section": ln["section"],
            "vocalType": ln["vocal_type"],
            "language": ln["language"],
            "speaker": ln["speaker"],
            "recognitionConfidence": ln["recognition_confidence"],
            "alignmentConfidence": ln["alignment_confidence"],
            "flags": json.loads(ln["flags_json"] or "[]"),
            "provenance": ln["provenance"],
            "words": words_by_line.get(idx, []),
        })

    return {
        "songId": srow["id"],
        "uploadId": srow["upload_id"],
        "title": srow["title"],
        "artist": srow["artist"],
        "language": srow["language"],
        "detectedLanguages": json.loads(srow["detected_languages_json"] or "[]"),
        "audioType": srow["audio_type"],
        "durationSec": srow["duration_sec"],
        "bpm": srow["bpm"],
        "provenance": json.loads(srow["provenance_json"] or "{}"),
        "validationSummary": json.loads(srow["validation_summary_json"] or "{}"),
        "createdAt": srow["created_at"],
        "updatedAt": srow["updated_at"],
        "lines": lines_out,
    }


def list_songs(conn: sqlite3.Connection, limit: int = 40) -> List[Dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT s.*,
               (SELECT COUNT(*) FROM lyric_lines l WHERE l.song_id = s.id) AS line_count,
               (SELECT COUNT(*) FROM lyric_words w WHERE w.song_id = s.id) AS word_count
        FROM songs s
        ORDER BY s.updated_at DESC
        LIMIT ?
        """,
        (max(1, min(100, int(limit))),),
    ).fetchall()
    return [
        {
            "songId": r["id"],
            "uploadId": r["upload_id"],
            "title": r["title"],
            "artist": r["artist"],
            "language": r["language"],
            "detectedLanguages": json.loads(r["detected_languages_json"] or "[]"),
            "audioType": r["audio_type"],
            "durationSec": r["duration_sec"],
            "bpm": r["bpm"],
            "lineCount": r["line_count"],
            "wordCount": r["word_count"],
            "provenance": json.loads(r["provenance_json"] or "{}"),
            "validationSummary": json.loads(r["validation_summary_json"] or "{}"),
            "updatedAt": r["updated_at"],
        }
        for r in rows
    ]


def update_word_timestamp(conn: sqlite3.Connection, data: Dict[str, Any]) -> Dict[str, Any]:
    song_id = str(data["songId"])
    line_index = int(data["lineIndex"])
    word_index = int(data["wordIndex"])
    start_sec = float(data["start"])
    end_sec = max(start_sec + 0.02, float(data["end"]))
    provenance = str(data.get("provenance") or "human_verified")
    cur = conn.execute(
        """
        UPDATE lyric_words
        SET start_sec = ?, end_sec = ?, provenance = ?, quality_tier = 'HIGH', alignment_confidence = 0.99
        WHERE song_id = ? AND line_index = ? AND word_index = ?
        """,
        (round(start_sec, 3), round(end_sec, 3), provenance, song_id, line_index, word_index),
    )
    if cur.rowcount == 0:
        raise ValueError("word_not_found")
    conn.execute("UPDATE songs SET updated_at = ? WHERE id = ?", (_now_iso(), song_id))
    conn.commit()
    return get_song_timestamps(conn, song_id) or {}


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "missing_action"}))
        sys.exit(1)
    action = sys.argv[1]
    raw = sys.stdin.read()
    payload = json.loads(raw) if raw.strip() else {}
    conn = _connect()
    try:
        if action == "upsert_upload":
            res = {"ok": True, "upload": upsert_upload(conn, payload)}
        elif action == "get_upload":
            res = {"ok": True, "upload": get_upload(conn, str(payload["id"]))}
        elif action == "find_upload_by_sha256":
            res = {"ok": True, "upload": find_upload_by_sha256(conn, str(payload["sha256"]))}
        elif action == "upsert_job":
            res = {"ok": True, "job": upsert_job(conn, payload)}
        elif action == "get_job":
            res = {"ok": True, "job": get_job(conn, str(payload["id"]))}
        elif action == "list_jobs":
            res = {"ok": True, "jobs": list_jobs(conn, int(payload.get("limit") or 25))}
        elif action == "get_cached_analysis":
            res = {"ok": True, "cache": get_cached_analysis(conn, str(payload["cacheKey"]))}
        elif action == "save_cached_analysis":
            save_cached_analysis(conn, payload)
            res = {"ok": True}
        elif action == "save_song_timestamps":
            res = {"ok": True, "song": save_song_timestamps(conn, payload)}
        elif action == "get_song_timestamps":
            res = {"ok": True, "song": get_song_timestamps(conn, str(payload["songId"]))}
        elif action == "list_songs":
            res = {"ok": True, "songs": list_songs(conn, int(payload.get("limit") or 40))}
        elif action == "update_word_timestamp":
            res = {"ok": True, "song": update_word_timestamp(conn, payload)}
        else:
            res = {"ok": False, "error": f"unknown_action:{action}"}
        print(json.dumps(res))
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
