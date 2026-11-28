"""
Audio Processing, Probing, Normalization, Waveform Generation & Upload Storage Service
(backend/app/audio_service.py).

Combines:
- FFprobe / FFmpeg async inspection & 16kHz mono PCM normalization helpers
- Waveform envelope peak extraction (`generate_waveform`, NumPy-accelerated with stdlib fallback)
- Path-confined audio upload validation, metadata extraction, and untouched byte storage
"""

from __future__ import annotations

from array import array
import asyncio
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import hashlib
import io
import json
import math
import os
from pathlib import Path
import struct
from typing import Any, BinaryIO, Dict, List, Optional
import uuid
import wave

try:
    import numpy as np  # type: ignore
except ImportError:  # pragma: no cover - fallback active in minimal runtime without numpy
    np = None  # type: ignore


FFPROBE = os.getenv("FFPROBE_BIN", "ffprobe")
FFMPEG = os.getenv("FFMPEG_BIN", "ffmpeg")

MAX_DURATION_SECONDS = 30 * 60

SUPPORTED_EXTENSIONS = {
    ".mp3",
    ".wav",
    ".m4a",
    ".aac",
    ".flac",
    ".ogg",
    ".opus",
}

ALLOWED_AUDIO_EXTENSIONS = SUPPORTED_EXTENSIONS | {".webm"}

CONTENT_TYPES = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".webm": "audio/webm",
}

DEFAULT_STORAGE_ROOT = Path(__file__).resolve().parents[1] / "storage"
STREAM_CHUNK_BYTES = 1024 * 1024  # 1 MiB chunk reads

_MP3_SAMPLE_RATES = {
    3: {0: 44100, 1: 48000, 2: 32000},  # MPEG-1
    2: {0: 22050, 1: 24000, 2: 16000},  # MPEG-2
    0: {0: 11025, 1: 12000, 2: 8000},   # MPEG-2.5
}


async def run_command(
    command: list[str],
    timeout: int = 120,
) -> tuple[str, str]:
    process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    try:
        stdout, stderr = await asyncio.wait_for(
            process.communicate(),
            timeout=timeout,
        )
    except asyncio.TimeoutError:
        process.kill()
        await process.communicate()
        raise RuntimeError(f"Command timeout: {command[0]}")

    if process.returncode != 0:
        raise RuntimeError(stderr.decode("utf-8", errors="replace")[-2000:])

    return (
        stdout.decode("utf-8", errors="replace"),
        stderr.decode("utf-8", errors="replace"),
    )


async def probe_audio(
    audio_path: Path,
) -> dict[str, Any]:
    resolved = Path(audio_path).resolve()
    command = [
        FFPROBE,
        "-v", "error",
        "-show_format",
        "-show_streams",
        "-of", "json",
        str(resolved),
    ]
    stdout, _ = await run_command(command, timeout=30)
    return json.loads(stdout)


def get_audio_stream(
    probe: dict[str, Any],
) -> dict[str, Any]:
    streams = probe.get("streams", [])
    audio_streams = [
        stream
        for stream in streams
        if stream.get("codec_type") == "audio"
    ]
    if not audio_streams:
        raise ValueError("No audio stream found.")
    return audio_streams[0]


def get_duration(
    probe: dict[str, Any],
    stream: dict[str, Any],
) -> float:
    value = stream.get("duration")
    if value is None:
        value = probe.get("format", {}).get("duration")
    if value is None:
        raise ValueError("Unable to determine audio duration.")

    duration = float(value)
    if not math.isfinite(duration):
        raise ValueError("Invalid audio duration.")
    if duration <= 0:
        raise ValueError("Audio duration must be greater than zero.")
    if duration > MAX_DURATION_SECONDS:
        raise ValueError("Audio exceeds the 30-minute limit.")
    return duration


async def normalize_audio(
    source_path: Path,
    output_path: Path,
) -> None:
    resolved_src = Path(source_path).resolve()
    resolved_out = Path(output_path).resolve()
    command = [
        FFMPEG,
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-i", str(resolved_src),
        "-map", "0:a:0",
        "-vn",
        "-ac", "1",
        "-ar", "16000",
        "-c:a", "pcm_s16le",
        "-f", "wav",
        str(resolved_out),
    ]
    await run_command(command, timeout=180)


def generate_waveform(
    wav_path: Path,
    target_bins: int = 1200,
) -> list[float]:
    peaks: list[float] = []
    if target_bins <= 0:
        return peaks

    with wave.open(str(wav_path), "rb") as wav:
        total_frames = wav.getnframes()
        if total_frames == 0:
            return []

        bin_frames = max(1, math.ceil(total_frames / target_bins))
        sample_width = wav.getsampwidth()

        while True:
            raw = wav.readframes(bin_frames)
            if not raw:
                break

            if np is not None and sample_width == 2:
                samples = np.frombuffer(raw, dtype=np.int16)
                if len(samples) == 0:
                    break
                peak = float(np.max(np.abs(samples.astype(np.int32)))) / 32768.0
                peaks.append(min(1.0, peak))
            elif sample_width == 2:
                samples_arr = array("h")
                usable = len(raw) - (len(raw) % 2)
                if usable <= 0:
                    break
                samples_arr.frombytes(raw[:usable])
                if not samples_arr:
                    break
                peak_int = max(abs(min(samples_arr)), abs(max(samples_arr)))
                peaks.append(min(1.0, float(peak_int / 32768.0)))
            elif sample_width == 1:
                peak_val = max(abs(b - 128) for b in raw) / 128.0
                peaks.append(min(1.0, float(peak_val)))
            elif sample_width == 4:
                usable = len(raw) - (len(raw) % 4)
                if usable <= 0:
                    break
                ints = struct.unpack(f"<{usable // 4}i", raw[:usable])
                peak_int = max(abs(min(ints)), abs(max(ints)))
                peaks.append(min(1.0, float(peak_int / 2147483648.0)))
            else:
                break

    return peaks


def get_media_type(extension: str) -> str:
    ext_l = extension.lower()
    if ext_l == ".webm":
        return "audio/webm"
    return CONTENT_TYPES.get(ext_l, "application/octet-stream")


class AudioUploadValidationError(ValueError):
    """Raised when an uploaded audio payload fails validation or security confinement checks."""


@dataclass(frozen=True)
class AudioMetadata:
    duration_seconds: float = 0.0
    sample_rate_hz: int = 0
    channels: int = 0
    bit_depth: int = 0
    codec_container: str = "unknown"
    peaks: List[float] = field(default_factory=list)


def has_valid_audio_magic(head: bytes, ext: str) -> bool:
    """Verify binary file signature matches common studio audio formats."""
    if len(head) < 4:
        return False
    ext_l = ext.lower()
    if head[:4] == b"RIFF" and len(head) >= 12 and head[8:12] == b"WAVE":
        return ext_l == ".wav"
    if head[:3] == b"ID3" or (head[0] == 0xFF and (head[1] & 0xE0) == 0xE0):
        return ext_l in {".mp3", ".aac"}
    if head[:4] == b"fLaC":
        return ext_l == ".flac"
    if head[:4] == b"OggS":
        return ext_l in {".ogg", ".opus"}
    if len(head) >= 8 and head[4:8] == b"ftyp":
        return ext_l in {".m4a", ".aac"}
    if head[:4] == b"\x1a\x45\xdf\xa3" and ext_l == ".webm":
        return True
    return False


def _compute_wav_peaks(
    pcm_bytes: bytes,
    channels: int,
    sample_width: int,
    num_bins: int = 96,
) -> List[float]:
    if not pcm_bytes or channels <= 0 or sample_width not in (1, 2, 4) or num_bins <= 0:
        return []

    frame_bytes = channels * sample_width
    usable_len = (len(pcm_bytes) // frame_bytes) * frame_bytes
    if usable_len <= 0:
        return []
    pcm_view = pcm_bytes[:usable_len]

    if np is not None:
        dtype_map = {1: np.uint8, 2: np.int16, 4: np.int32}
        arr = np.frombuffer(pcm_view, dtype=dtype_map[sample_width]).astype(np.float32)
        if sample_width == 1:
            arr = (arr - 128.0) / 128.0
        elif sample_width == 2:
            arr = arr / 32768.0
        else:
            arr = arr / 2147483648.0
        arr = np.abs(arr.reshape(-1, channels)).max(axis=1)
        total_frames = arr.shape[0]
        actual_bins = min(num_bins, total_frames)
        edges = np.linspace(0, total_frames, actual_bins + 1, dtype=int)
        return [round(float(np.max(arr[edges[i]:edges[i + 1]])), 4) for i in range(actual_bins)]

    total_frames = usable_len // frame_bytes
    actual_bins = min(num_bins, total_frames)
    if sample_width == 1:
        scale = 128.0
        unpack_fmt = "<B"
    elif sample_width == 2:
        scale = 32768.0
        unpack_fmt = "<h"
    else:
        scale = 2147483648.0
        unpack_fmt = "<i"

    peaks: List[float] = []
    stride_frames = max(1, total_frames // 2048)
    for b in range(actual_bins):
        start_f = (b * total_frames) // actual_bins
        end_f = max(start_f + 1, ((b + 1) * total_frames) // actual_bins)
        bin_max = 0.0
        for f_idx in range(start_f, end_f, stride_frames):
            base_off = f_idx * frame_bytes
            val = struct.unpack_from(unpack_fmt, pcm_view, base_off)[0]
            amp = abs((val - 128.0) / scale) if sample_width == 1 else abs(val / scale)
            if amp > bin_max:
                bin_max = amp
        peaks.append(round(min(1.0, bin_max), 4))
    return peaks


def _extract_wav_metadata(raw_bytes: bytes) -> AudioMetadata:
    try:
        with wave.open(io.BytesIO(raw_bytes), "rb") as wf:
            channels = wf.getnchannels()
            sample_rate = wf.getframerate()
            sample_width = wf.getsampwidth()
            n_frames = wf.getnframes()
            duration = round(n_frames / float(sample_rate), 3) if sample_rate > 0 else 0.0
            pcm_bytes = wf.readframes(n_frames) if n_frames <= sample_rate * 600 else b""
            peaks = _compute_wav_peaks(pcm_bytes, channels=channels, sample_width=sample_width)
            return AudioMetadata(
                duration_seconds=max(0.0, duration),
                sample_rate_hz=max(0, int(sample_rate)),
                channels=max(0, int(channels)),
                bit_depth=max(0, int(sample_width * 8)),
                codec_container="wav",
                peaks=peaks,
            )
    except Exception:
        return AudioMetadata(codec_container="wav")


def _extract_flac_metadata(raw_bytes: bytes) -> AudioMetadata:
    if len(raw_bytes) < 42 or raw_bytes[:4] != b"fLaC":
        return AudioMetadata(codec_container="flac")
    block_type = raw_bytes[4] & 0x7F
    if block_type != 0:
        return AudioMetadata(codec_container="flac")
    streaminfo = raw_bytes[8:42]
    packed = int.from_bytes(streaminfo[10:18], "big")
    sample_rate = (packed >> 44) & 0xFFFFF
    channels = ((packed >> 41) & 0x7) + 1
    bps = ((packed >> 36) & 0x1F) + 1
    total_samples = packed & 0xFFFFFFFFF
    duration = round(total_samples / float(sample_rate), 3) if sample_rate > 0 else 0.0
    return AudioMetadata(
        duration_seconds=max(0.0, duration),
        sample_rate_hz=sample_rate,
        channels=channels,
        bit_depth=bps,
        codec_container="flac",
    )


def _extract_ogg_metadata(raw_bytes: bytes, ext_l: str = ".ogg") -> AudioMetadata:
    opus_idx = raw_bytes.find(b"OpusHead")
    if opus_idx != -1 and opus_idx + 16 <= len(raw_bytes):
        channels = raw_bytes[opus_idx + 9]
        sample_rate = struct.unpack_from("<I", raw_bytes, opus_idx + 12)[0] or 48000
        return AudioMetadata(
            duration_seconds=0.0,
            sample_rate_hz=sample_rate,
            channels=channels,
            codec_container="opus",
        )
    idx = raw_bytes.find(b"\x01vorbis")
    if idx != -1 and idx + 16 <= len(raw_bytes):
        channels = raw_bytes[idx + 11]
        sample_rate = struct.unpack_from("<I", raw_bytes, idx + 12)[0]
        return AudioMetadata(
            duration_seconds=0.0,
            sample_rate_hz=sample_rate,
            channels=channels,
            codec_container="ogg",
        )
    return AudioMetadata(codec_container=ext_l.lstrip(".") or "ogg")


def _extract_mp3_metadata(raw_bytes: bytes) -> AudioMetadata:
    offset = 0
    if raw_bytes[:3] == b"ID3" and len(raw_bytes) >= 10:
        size_bytes = raw_bytes[6:10]
        tag_size = (
            ((size_bytes[0] & 0x7F) << 21)
            | ((size_bytes[1] & 0x7F) << 14)
            | ((size_bytes[2] & 0x7F) << 7)
            | (size_bytes[3] & 0x7F)
        )
        offset = min(len(raw_bytes), 10 + tag_size)

    scan_limit = min(len(raw_bytes) - 4, offset + 4096)
    for pos in range(offset, max(offset, scan_limit)):
        b0, b1, b2, b3 = raw_bytes[pos : pos + 4]
        if b0 == 0xFF and (b1 & 0xE0) == 0xE0:
            version_id = (b1 >> 3) & 0x03
            sr_idx = (b2 >> 2) & 0x03
            channel_mode = (b3 >> 6) & 0x03
            sr = _MP3_SAMPLE_RATES.get(version_id, {}).get(sr_idx, 0)
            if sr > 0:
                channels = 1 if channel_mode == 3 else 2
                return AudioMetadata(
                    duration_seconds=0.0,
                    sample_rate_hz=sr,
                    channels=channels,
                    codec_container="mp3",
                )
    return AudioMetadata(codec_container="mp3")


def extract_audio_metadata(raw_bytes: bytes, ext: str) -> AudioMetadata:
    """Inspect real container/stream headers without fabricating missing metrics."""
    ext_l = ext.lower()
    if ext_l == ".wav":
        return _extract_wav_metadata(raw_bytes)
    if ext_l == ".flac":
        return _extract_flac_metadata(raw_bytes)
    if ext_l in {".ogg", ".opus"}:
        return _extract_ogg_metadata(raw_bytes, ext_l=ext_l)
    if ext_l == ".mp3":
        return _extract_mp3_metadata(raw_bytes)
    return AudioMetadata(codec_container=ext_l.lstrip(".") or "unknown")


def resolve_storage_root(storage_dir: Optional[Path | str] = None) -> Path:
    if storage_dir is not None:
        return Path(storage_dir).resolve()
    env_dir = os.environ.get("ALEXURA_DATA_DIR", "").strip()
    if env_dir:
        return Path(env_dir).resolve()
    return DEFAULT_STORAGE_ROOT.resolve()


class AudioUploadService:
    """
    Production audio upload & storage manager writing directly to `backend/storage/`.
    Keeps original uploaded audio bytes intact and confines every file operation strictly
    inside its resolved storage directory.
    """

    def __init__(
        self,
        storage_root: Optional[Path | str] = None,
        max_upload_bytes: Optional[int] = None,
    ) -> None:
        self.storage_root = resolve_storage_root(storage_root)
        self.audio_dir = (self.storage_root / "audio").resolve()
        self.audio_dir.mkdir(parents=True, exist_ok=True)
        if max_upload_bytes is not None:
            self.max_upload_bytes = int(max_upload_bytes)
        else:
            mb = int(os.environ.get("MAX_UPLOAD_MB", "100") or "100")
            self.max_upload_bytes = max(1, mb) * 1024 * 1024

    def _confine_child(self, directory: Path, filename: str) -> Path:
        clean_name = Path(filename).name
        if not clean_name or clean_name in {".", ".."}:
            raise AudioUploadValidationError("invalid_storage_path")
        target = (directory / clean_name).resolve()
        if not target.is_relative_to(directory.resolve()):
            raise AudioUploadValidationError("invalid_storage_path")
        return target

    def ingest_bytes(
        self,
        raw_bytes: bytes,
        filename: str,
        mime_type: str = "",
    ) -> Dict[str, Any]:
        safe_name = Path(filename or "track.wav").name[:200]
        ext = Path(safe_name).suffix.lower()
        if ext not in ALLOWED_AUDIO_EXTENSIONS:
            raise AudioUploadValidationError("unsupported_audio_extension")
        if not raw_bytes:
            raise AudioUploadValidationError("empty_audio_payload")
        if len(raw_bytes) > self.max_upload_bytes:
            raise AudioUploadValidationError("audio_exceeds_max_upload_size")
        if not has_valid_audio_magic(raw_bytes[:16], ext):
            raise AudioUploadValidationError("invalid_audio_magic_header")

        audio_id = f"aud_{uuid.uuid4().hex[:16]}"
        audio_path = self._confine_child(self.audio_dir, f"{audio_id}{ext}")
        audio_path.write_bytes(raw_bytes)

        meta = extract_audio_metadata(raw_bytes, ext)
        resolved_mime = (mime_type or "").strip()
        if not resolved_mime or resolved_mime == "application/octet-stream":
            resolved_mime = get_media_type(ext)

        record: Dict[str, Any] = {
            "audioId": audio_id,
            "filename": safe_name,
            "mimeType": resolved_mime,
            "byteSize": len(raw_bytes),
            "sha256": hashlib.sha256(raw_bytes).hexdigest(),
            "durationSeconds": meta.duration_seconds,
            "sampleRateHz": meta.sample_rate_hz,
            "channels": meta.channels,
            "bitDepth": meta.bit_depth,
            "codecContainer": meta.codec_container,
            "waveformPeaks": meta.peaks,
            "storagePath": str(audio_path),
            "audioUrl": f"/api/v1/audio/{audio_id}/stream",
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }
        meta_path = self._confine_child(self.audio_dir, f"{audio_id}.json")
        meta_path.write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8")
        return record

    async def ingest_upload_file(self, upload_file: Any) -> Dict[str, Any]:
        """Stream-read a FastAPI `UploadFile` in chunks so size limits enforce early."""
        filename = getattr(upload_file, "filename", None) or "track.wav"
        mime_type = getattr(upload_file, "content_type", None) or ""
        buf = bytearray()
        while True:
            chunk = await upload_file.read(STREAM_CHUNK_BYTES)
            if not chunk:
                break
            if len(buf) + len(chunk) > self.max_upload_bytes:
                raise AudioUploadValidationError("audio_exceeds_max_upload_size")
            buf.extend(chunk)
        return self.ingest_bytes(bytes(buf), filename=filename, mime_type=mime_type)

    def ingest_stream(
        self,
        stream: BinaryIO,
        filename: str,
        mime_type: str = "",
    ) -> Dict[str, Any]:
        buf = bytearray()
        while True:
            chunk = stream.read(STREAM_CHUNK_BYTES)
            if not chunk:
                break
            if len(buf) + len(chunk) > self.max_upload_bytes:
                raise AudioUploadValidationError("audio_exceeds_max_upload_size")
            buf.extend(chunk)
        return self.ingest_bytes(bytes(buf), filename=filename, mime_type=mime_type)

    def get_audio(self, audio_id: str) -> Optional[Dict[str, Any]]:
        if not audio_id or "/" in audio_id or "\\" in audio_id or ".." in audio_id:
            return None
        meta_path = self._confine_child(self.audio_dir, f"{audio_id}.json")
        if not meta_path.exists():
            return None
        return json.loads(meta_path.read_text(encoding="utf-8"))

    def get_audio_file_path(self, audio_id: str) -> Optional[Path]:
        rec = self.get_audio(audio_id)
        if not rec:
            return None
        candidate = Path(rec.get("storagePath", "")).resolve()
        if not candidate.is_relative_to(self.audio_dir.resolve()) or not candidate.exists():
            return None
        return candidate

    def list_audio(self, limit: int = 25) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        files = sorted(self.audio_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        for p in files:
            try:
                items.append(json.loads(p.read_text(encoding="utf-8")))
                if len(items) >= limit:
                    break
            except Exception:
                continue
        return items

    def delete_audio(self, audio_id: str) -> bool:
        rec = self.get_audio(audio_id)
        if not rec:
            return False
        audio_path = self.get_audio_file_path(audio_id)
        if audio_path and audio_path.exists():
            audio_path.unlink()
        meta_path = self._confine_child(self.audio_dir, f"{audio_id}.json")
        if meta_path.exists():
            meta_path.unlink()
        return True

    def metadata_as_dict(self, meta: AudioMetadata) -> Dict[str, Any]:
        return asdict(meta)
