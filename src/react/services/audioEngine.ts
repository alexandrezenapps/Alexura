import type { WaveformPeak } from '../types/pipeline';

export interface AudioTransportSnapshot {
  playing: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  volume: number;
  loop: boolean;
  rmsLevel: number;
  spectrumBins: number[];
  ready: boolean;
  sourceLabel: string;
}

export class HybridAudioEngine {
  private audioEl: HTMLAudioElement | null = null;
  private audioCtx: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private freqBuf: Uint8Array<ArrayBuffer> | null = null;
  private objectUrl: string | null = null;
  private sourceLabel = '';
  private rafId = 0;
  private listeners = new Set<(snap: AudioTransportSnapshot) => void>();

  constructor() {
    if (typeof window !== 'undefined') {
      const el = new Audio();
      el.preload = 'metadata';
      el.crossOrigin = 'anonymous';
      this.audioEl = el;
      this.bindElementEvents(el);
    }
  }

  private bindElementEvents(el: HTMLAudioElement): void {
    const notify = () => this.emitSnapshot();
    el.addEventListener('play', () => {
      this.ensureWebAudioGraph();
      this.startMeterLoop();
      notify();
    });
    el.addEventListener('pause', () => {
      this.stopMeterLoop();
      notify();
    });
    el.addEventListener('ended', () => {
      this.stopMeterLoop();
      notify();
    });
    el.addEventListener('loadedmetadata', notify);
    el.addEventListener('timeupdate', notify);
    el.addEventListener('seeked', notify);
    el.addEventListener('ratechange', notify);
    el.addEventListener('volumechange', notify);
  }

  private ensureWebAudioGraph(): void {
    if (!this.audioEl || typeof window === 'undefined') return;
    try {
      if (!this.audioCtx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.audioCtx = new AC();
      }
      if (this.audioCtx.state === 'suspended') {
        void this.audioCtx.resume().catch(() => {});
      }
      if (!this.sourceNode) {
        this.sourceNode = this.audioCtx.createMediaElementSource(this.audioEl);
        this.gainNode = this.audioCtx.createGain();
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 128;
        this.analyser.smoothingTimeConstant = 0.78;
        this.freqBuf = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
        this.sourceNode.connect(this.gainNode);
        this.gainNode.connect(this.analyser);
        this.analyser.connect(this.audioCtx.destination);
      }
    } catch {
      // Safe fallback to native HTML <audio> output if browser blocks graph setup
    }
  }

  subscribe(listener: (snap: AudioTransportSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitSnapshot(): void {
    const snap = this.getSnapshot();
    for (const cb of this.listeners) cb(snap);
  }

  private startMeterLoop(): void {
    if (this.rafId) return;
    const tick = () => {
      this.emitSnapshot();
      if (this.audioEl && !this.audioEl.paused && !this.audioEl.ended) {
        this.rafId = requestAnimationFrame(tick);
      } else {
        this.rafId = 0;
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopMeterLoop(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  getSnapshot(): AudioTransportSnapshot {
    const el = this.audioEl;
    let rmsLevel = 0;
    const spectrumBins: number[] = [];
    if (this.analyser && this.freqBuf && el && !el.paused) {
      this.analyser.getByteFrequencyData(this.freqBuf);
      let sq = 0;
      const take = Math.min(24, this.freqBuf.length);
      for (let i = 0; i < take; i++) {
        const v = this.freqBuf[i] / 255;
        spectrumBins.push(+v.toFixed(3));
        sq += v * v;
      }
      rmsLevel = Math.sqrt(sq / Math.max(1, take));
    }
    return {
      playing: Boolean(el && !el.paused && !el.ended),
      currentTime: el && Number.isFinite(el.currentTime) ? el.currentTime : 0,
      duration: el && Number.isFinite(el.duration) ? el.duration : 0,
      playbackRate: el ? el.playbackRate : 1,
      volume: el ? el.volume : 1,
      loop: el ? el.loop : false,
      rmsLevel,
      spectrumBins,
      ready: Boolean(el && el.src && Number.isFinite(el.duration) && el.duration > 0),
      sourceLabel: this.sourceLabel,
    };
  }

  loadFromUrl(url: string, label = 'Stream Audio'): void {
    if (!this.audioEl) return;
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.sourceLabel = label;
    this.audioEl.src = url;
    this.audioEl.load();
    this.emitSnapshot();
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
    this.emitSnapshot();
  }

  async play(): Promise<void> {
    if (!this.audioEl || !this.audioEl.src) return;
    this.ensureWebAudioGraph();
    await this.audioEl.play();
  }

  pause(): void {
    this.audioEl?.pause();
  }

  toggle(): void {
    if (!this.audioEl) return;
    if (this.audioEl.paused) void this.play();
    else this.pause();
  }

  seek(sec: number): void {
    if (!this.audioEl) return;
    const dur = Number.isFinite(this.audioEl.duration) ? this.audioEl.duration : 0;
    const clamped = Math.max(0, dur > 0 ? Math.min(dur, sec) : sec);
    this.audioEl.currentTime = clamped;
    this.emitSnapshot();
  }

  setPlaybackRate(rate: number): void {
    if (!this.audioEl) return;
    this.audioEl.playbackRate = Math.max(0.5, Math.min(2.0, rate));
    this.emitSnapshot();
  }

  setVolume(vol: number): void {
    if (!this.audioEl) return;
    const v = Math.max(0, Math.min(1, vol));
    this.audioEl.volume = v;
    if (this.gainNode) this.gainNode.gain.value = v;
    this.emitSnapshot();
  }

  setLoop(loop: boolean): void {
    if (!this.audioEl) return;
    this.audioEl.loop = loop;
    this.emitSnapshot();
  }

  async decodeFilePeaksClient(file: File, bins = 420): Promise<{ durationSec: number; waveformPeaks: WaveformPeak[] }> {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    try {
      const buf = await file.arrayBuffer();
      const decoded = await ctx.decodeAudioData(buf.slice(0));
      const len = decoded.length;
      const ch0 = decoded.getChannelData(0);
      const step = Math.max(1, len / bins);
      const peaks: WaveformPeak[] = [];
      for (let b = 0; b < bins; b++) {
        const i0 = Math.floor(b * step);
        const i1 = Math.min(len, Math.max(i0 + 1, Math.floor((b + 1) * step)));
        let mn = 1;
        let mx = -1;
        let sq = 0;
        for (let i = i0; i < i1; i++) {
          const s = ch0[i];
          if (s < mn) mn = s;
          if (s > mx) mx = s;
          sq += s * s;
        }
        peaks.push({
          min: +mn.toFixed(4),
          max: +mx.toFixed(4),
          rms: +Math.sqrt(sq / Math.max(1, i1 - i0)).toFixed(4),
        });
      }
      return { durationSec: +decoded.duration.toFixed(3), waveformPeaks: peaks };
    } finally {
      await ctx.close().catch(() => {});
    }
  }

  destroy(): void {
    this.stopMeterLoop();
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.src = '';
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    void this.audioCtx?.close().catch(() => {});
    this.listeners.clear();
  }
}
