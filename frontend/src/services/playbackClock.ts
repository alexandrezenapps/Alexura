/**
 * HTML Audio API Playback Clock Service for Phase 1.
 * Keeps playback strictly anchored in seconds (>= 0.0) relative to the original audio timeline.
 */

export interface PlaybackSnapshot {
  playing: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  volume: number;
  muted: boolean;
  loop: boolean;
  ready: boolean;
  sourceLabel: string;
}

export function formatSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return '--:--.--';
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const centis = Math.floor((seconds - Math.floor(seconds)) * 100);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}

export class HtmlAudioPlaybackClock {
  private audioEl: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private sourceLabel = '';
  private rafId = 0;
  private listeners = new Set<(snap: PlaybackSnapshot) => void>();

  constructor() {
    if (typeof window !== 'undefined' && typeof Audio !== 'undefined') {
      const el = new Audio();
      el.preload = 'metadata';
      el.crossOrigin = 'anonymous';
      this.audioEl = el;
      this.bindEvents(el);
    }
  }

  private bindEvents(el: HTMLAudioElement): void {
    const notify = () => this.emit();
    el.addEventListener('play', () => {
      this.startLoop();
      notify();
    });
    el.addEventListener('pause', () => {
      this.stopLoop();
      notify();
    });
    el.addEventListener('ended', () => {
      this.stopLoop();
      notify();
    });
    el.addEventListener('loadedmetadata', notify);
    el.addEventListener('timeupdate', notify);
    el.addEventListener('seeked', notify);
    el.addEventListener('ratechange', notify);
    el.addEventListener('volumechange', notify);
  }

  private startLoop(): void {
    if (this.rafId || typeof requestAnimationFrame === 'undefined') return;
    const tick = () => {
      this.emit();
      if (this.audioEl && !this.audioEl.paused && !this.audioEl.ended) {
        this.rafId = requestAnimationFrame(tick);
      } else {
        this.rafId = 0;
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.rafId && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  subscribe(cb: (snap: PlaybackSnapshot) => void): () => void {
    this.listeners.add(cb);
    cb(this.getSnapshot());
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(): void {
    const snap = this.getSnapshot();
    for (const cb of this.listeners) {
      cb(snap);
    }
  }

  getSnapshot(): PlaybackSnapshot {
    const el = this.audioEl;
    return {
      playing: Boolean(el && !el.paused && !el.ended),
      currentTime: el && Number.isFinite(el.currentTime) ? el.currentTime : 0,
      duration: el && Number.isFinite(el.duration) ? el.duration : 0,
      playbackRate: el ? el.playbackRate : 1,
      volume: el ? el.volume : 1,
      muted: el ? el.muted : false,
      loop: el ? el.loop : false,
      ready: Boolean(el && el.src && Number.isFinite(el.duration) && el.duration > 0),
      sourceLabel: this.sourceLabel,
    };
  }

  loadFromFile(file: File): void {
    if (!this.audioEl) return;
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    const url = URL.createObjectURL(file);
    this.objectUrl = url;
    this.sourceLabel = file.name;
    this.audioEl.src = url;
    this.audioEl.load();
    this.emit();
  }

  loadFromUrl(url: string, label: string): void {
    if (!this.audioEl) return;
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.sourceLabel = label;
    this.audioEl.src = url;
    this.audioEl.load();
    this.emit();
  }

  async play(): Promise<void> {
    if (!this.audioEl || !this.audioEl.src) return;
    await this.audioEl.play();
  }

  pause(): void {
    this.audioEl?.pause();
  }

  toggle(): void {
    if (!this.audioEl) return;
    if (this.audioEl.paused) {
      void this.play().catch(() => {});
    } else {
      this.pause();
    }
  }

  seek(seconds: number): void {
    if (!this.audioEl) return;
    const dur = Number.isFinite(this.audioEl.duration) ? this.audioEl.duration : 0;
    const clamped = Math.max(0, dur > 0 ? Math.min(dur, seconds) : seconds);
    this.audioEl.currentTime = clamped;
    this.emit();
  }

  setPlaybackRate(rate: number): void {
    if (!this.audioEl) return;
    this.audioEl.playbackRate = Math.max(0.5, Math.min(2.0, rate));
    this.emit();
  }

  setVolume(volume: number): void {
    if (!this.audioEl) return;
    const v = Math.max(0, Math.min(1, volume));
    this.audioEl.volume = v;
    if (v > 0 && this.audioEl.muted) {
      this.audioEl.muted = false;
    }
    this.emit();
  }

  toggleMute(): void {
    if (!this.audioEl) return;
    this.audioEl.muted = !this.audioEl.muted;
    this.emit();
  }

  setLoop(loop: boolean): void {
    if (!this.audioEl) return;
    this.audioEl.loop = loop;
    this.emit();
  }

  destroy(): void {
    this.stopLoop();
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.src = '';
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.listeners.clear();
  }
}
