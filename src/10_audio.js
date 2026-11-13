/* ============================================================
   JIZURA — audio: decode, energy envelope, onset, BPM & beat grid
   ============================================================ */
(() => {
'use strict';

J.analyzeAudio = async (file) => {
  const buf = await file.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  let audioBuffer;
  try { audioBuffer = await ac.decodeAudioData(buf.slice(0)); } finally { try { ac.close(); } catch (e) {} }
  const sr = audioBuffer.sampleRate, len = audioBuffer.length, ch = audioBuffer.numberOfChannels;
  const mono = new Float32Array(len);
  for (let c = 0; c < ch; c++) { const d = audioBuffer.getChannelData(c); for (let i = 0; i < len; i++) mono[i] += d[i] / ch; }
  const rate = 50, hop = Math.round(sr / rate), n = Math.floor(len / hop);
  const energy = new Float32Array(n), flux = new Float32Array(n);
  const vocalEnergy = new Float32Array(n), vocalFlux = new Float32Array(n);
  
  // Vocal frequency bandpass: human singing voice formants reside mostly in ~300Hz to ~3400Hz
  const dt = 1 / sr;
  const rcHP = 1 / (2 * Math.PI * 300), aHP = rcHP / (rcHP + dt);
  const rcLP = 1 / (2 * Math.PI * 3400), aLP = dt / (rcLP + dt);
  let prevHP = 0, prevX = 0, prevVHP = 0, prevVX = 0, prevVLP = 0;
  
  for (let f = 0; f < n; f++) {
    let e = 0, eh = 0, ve = 0;
    for (let i = f * hop, end = Math.min(len, (f + 1) * hop); i < end; i++) {
      const x = mono[i]; e += x * x;
      const hp = 0.92 * (prevHP + x - prevX); prevHP = hp; prevX = x; eh += hp * hp;
      
      // Vocal bandpass
      const vhp = aHP * (prevVHP + x - prevVX); prevVHP = vhp; prevVX = x;
      const vlp = prevVLP + aLP * (vhp - prevVLP); prevVLP = vlp;
      ve += vlp * vlp;
    }
    energy[f] = Math.sqrt(e / hop);
    flux[f] = Math.sqrt(eh / hop);
    vocalEnergy[f] = Math.sqrt(ve / hop);
  }
  // onset strength: positive change of log high-passed energy vs local mean
  const onset = new Float32Array(n), vocalOnset = new Float32Array(n);
  for (let f = 1; f < n; f++) {
    const cur = Math.log(1e-4 + flux[f]);
    let m = 0, k = 0; for (let j = Math.max(0, f - 4); j < f; j++) { m += Math.log(1e-4 + flux[j]); k++; }
    onset[f] = Math.max(0, cur - m / Math.max(1, k));

    // Vocal onset detection (singing attacks)
    const vcur = Math.log(1e-4 + vocalEnergy[f]);
    let vm = 0, vk = 0; for (let j = Math.max(0, f - 6); j < f; j++) { vm += Math.log(1e-4 + vocalEnergy[j]); vk++; }
    vocalOnset[f] = Math.max(0, vcur - vm / Math.max(1, vk));
  }
  // Detect vocal active phrase segments
  const sortedVocal = Array.from(vocalEnergy).sort((a, b) => a - b);
  const vMed = sortedVocal[Math.floor(sortedVocal.length * 0.5)] || 1e-4;
  const vThresh = vMed * 1.5;
  const vocalSegments = [];
  let inSeg = false, segStart = 0;
  for (let f = 0; f < n; f++) {
    const isVoice = vocalEnergy[f] > vThresh;
    const t = f / rate;
    if (isVoice && !inSeg) { inSeg = true; segStart = t; }
    else if (!isVoice && inSeg) {
      if (t - segStart >= 0.35) vocalSegments.push({ start: +segStart.toFixed(3), end: +t.toFixed(3) });
      inSeg = false;
    }
  }
  if (inSeg && len / sr - segStart >= 0.35) vocalSegments.push({ start: +segStart.toFixed(3), end: +(len / sr).toFixed(3) });
  // Fallback segmentation from vocal onset peaks for compressed tracks
  if (vocalSegments.length === 0 && audioBuffer.duration > 2) {
    const segStep = Math.max(2.5, Math.min(4.5, audioBuffer.duration / 8));
    for (let t = 0.5; t < audioBuffer.duration - 1.0; t += segStep) {
      vocalSegments.push({ start: +t.toFixed(3), end: +Math.min(audioBuffer.duration, t + segStep - 0.2).toFixed(3) });
    }
  }

  // tempo via autocorrelation (70..180 BPM)
  const minLag = Math.round(rate * 60 / 180), maxLag = Math.round(rate * 60 / 70);
  let best = 0, bestLag = Math.round(rate * 0.5);
  const scores = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0; for (let f = lag; f < n; f++) s += onset[f] * onset[f - lag];
    const bpm = 60 * rate / lag;
    const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 125) / 0.7, 2));
    s *= w; scores[lag] = s;
    if (s > best) { best = s; bestLag = lag; }
  }
  let lagF = bestLag;
  if (scores[bestLag - 1] != null && scores[bestLag + 1] != null) {
    const a = scores[bestLag - 1], b = scores[bestLag], c = scores[bestLag + 1];
    const d = (a - 2 * b + c); if (d !== 0) lagF = bestLag + 0.5 * (a - c) / d;
  }
  const period = lagF / rate;
  // phase
  let bestPh = 0, bestPS = -1;
  for (let ph = 0; ph < lagF; ph += 0.5) {
    let s = 0; for (let t = ph; t < n; t += lagF) s += onset[Math.round(t)] || 0;
    if (s > bestPS) { bestPS = s; bestPh = ph; }
  }
  const beats = [];
  for (let t = bestPh / rate; t < audioBuffer.duration; t += period) beats.push(+t.toFixed(4));
  // normalised energy (0..1, 95th percentile)
  const sorted = Array.from(energy).sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 1;
  const energyN = new Float32Array(n);
  for (let f = 0; f < n; f++) energyN[f] = Math.min(1, energy[f] / p95);
  // waveform peaks for the timeline
  const bins = 1600, peaks = new Float32Array(bins), per = Math.max(1, Math.floor(len / bins));
  for (let b = 0; b < bins; b++) { let m = 0; for (let i = b * per, e = Math.min(len, (b + 1) * per); i < e; i += 4) { const v = Math.abs(mono[i]); if (v > m) m = v; } peaks[b] = m; }
  return {
    name: file.name, duration: audioBuffer.duration, sampleRate: sr, buffer: audioBuffer,
    bpm: Math.round(60 / period * 10) / 10, beats, energy: energyN, energyRate: rate, peaks,
    vocalEnergy, vocalOnset, vocalSegments,
  };
};

/* Align lyric lines instantly to detected vocal singing onsets and phrase boundaries */
J.alignLinesToVocals = (analysis, lines) => {
  if (!analysis || !lines || !lines.length) return {};
  const { vocalSegments, vocalOnset, duration, energyRate, beats } = analysis;
  const lineTimes = {};
  const segs = (vocalSegments || []).slice();
  const validLines = lines.map((l, i) => ({ i, ...l })).filter(l => !l.interlude && l.text);
  if (!validLines.length) return lineTimes;

  if (segs.length > 0) {
    for (let k = 0; k < validLines.length; k++) {
      const line = validLines[k];
      const targetRatio = k / Math.max(1, validLines.length - 1);
      const estTime = targetRatio * (duration * 0.85);

      // Search for segment matching this line
      let bestSeg = null, bestDist = 1e9;
      for (const seg of segs) {
        const d = Math.abs(seg.start - estTime);
        const lastT = Object.keys(lineTimes).length ? Math.max(...Object.values(lineTimes)) : -1;
        if (d < bestDist && seg.start >= lastT + 0.3) {
          bestDist = d; bestSeg = seg;
        }
      }
      if (bestSeg) {
        // Find maximum vocal attack onset near segment start
        const f0 = Math.max(0, Math.floor((bestSeg.start - 0.25) * energyRate));
        const f1 = Math.min(vocalOnset.length - 1, Math.floor((bestSeg.start + 0.35) * energyRate));
        let maxO = -1, bestT = bestSeg.start;
        for (let f = f0; f <= f1; f++) {
          if (vocalOnset[f] > maxO) { maxO = vocalOnset[f]; bestT = f / energyRate; }
        }
        lineTimes[line.i] = +bestT.toFixed(3);
      }
    }
  }

  // Interpolate / fill any remaining lines cleanly
  let prevT = 0.4;
  for (let i = 0; i < lines.length; i++) {
    if (lineTimes[i] == null) {
      let nextT = duration - 1;
      for (let j = i + 1; j < lines.length; j++) {
        if (lineTimes[j] != null) { nextT = lineTimes[j]; break; }
      }
      const remain = Math.max(1, lines.slice(i).filter(l => lineTimes[lines.indexOf(l)] == null).length);
      const t = prevT + Math.min(3.5, Math.max(0.8, (nextT - prevT) / remain));
      lineTimes[i] = +t.toFixed(3);
    }
    prevT = lineTimes[i];
  }
  return lineTimes;
};

/* AI Vocal alignment via server API with graceful local fallback */
J.aiAlignVocals = async (audioAnalysis, lines, lang = 'auto') => {
  try {
    if (!audioAnalysis || !audioAnalysis.buffer) return J.alignLinesToVocals(audioAnalysis, lines);
    const wavBlob = J.audioWav(audioAnalysis.buffer, Math.min(180, audioAnalysis.duration));
    const reader = new FileReader();
    const base64Audio = await new Promise((res, rej) => {
      reader.onload = () => {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        res(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = rej;
      reader.readAsDataURL(wavBlob);
    });
    const lineTexts = lines.map((l, i) => ({ i, text: l.interlude ? '[interlude]' : l.text }));
    const resp = await fetch('/api/align-vocals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioBase64: base64Audio,
        lines: lineTexts,
        lang,
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.lineTimes && Object.keys(data.lineTimes).length) {
        return data.lineTimes;
      }
    }
  } catch (e) {
    console.warn('AI vocal alignment fallback to local vocal onset analysis:', e);
  }
  return J.alignLinesToVocals(audioAnalysis, lines);
};

/* Downsample an AudioBuffer to 16kHz mono WAV for high-speed AI speech/lyric recognition */
J.audioMonoWav = (buffer, maxSeconds = 300, targetSampleRate = 16000) => {
  const chn = buffer.numberOfChannels;
  const dur = Math.min(maxSeconds, buffer.duration);
  const origSr = buffer.sampleRate;
  const targetSr = targetSampleRate;
  const targetLength = Math.max(1, Math.floor(dur * targetSr));
  const step = origSr / targetSr;
  const chData = [];
  for (let c = 0; c < chn; c++) chData.push(buffer.getChannelData(c));

  const bytes = targetLength * 2;
  const ab = new ArrayBuffer(44 + bytes);
  const v = new DataView(ab);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, targetSr, true);
  v.setUint32(28, targetSr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, bytes, true);

  let o = 44;
  for (let i = 0; i < targetLength; i++) {
    const srcIdx = Math.floor(i * step);
    let sum = 0;
    for (let c = 0; c < chn; c++) {
      sum += srcIdx < chData[c].length ? chData[c][srcIdx] : 0;
    }
    const avg = chn > 1 ? sum / chn : sum;
    const sample = Math.max(-1, Math.min(1, avg));
    v.setInt16(o, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    o += 2;
  }
  return new Blob([ab], { type: 'audio/wav' });
};

/* AI Music Audio-to-Lyrics Transcription with full multi-language detection */
J.aiTranscribeMusic = async (audioAnalysis, lang = 'auto') => {
  if (!audioAnalysis || !audioAnalysis.buffer) return null;
  const wavBlob = J.audioMonoWav(audioAnalysis.buffer, 300, 16000);
  const reader = new FileReader();
  const base64Audio = await new Promise((res, rej) => {
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      res(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = rej;
    reader.readAsDataURL(wavBlob);
  });

  const resp = await fetch('/api/transcribe-lyrics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audioBase64: base64Audio, lang }),
  });
  if (resp.ok) {
    const data = await resp.json();
    if (data && data.success && Array.isArray(data.lines) && data.lines.length) {
      return data;
    }
    if (data && data.requiresBilling) {
      return { billingRequired: true, lines: [] };
    }
  }
  return null;
};

/* 16-bit PCM WAV of an AudioBuffer, cut / padded to `duration` seconds (the soundtrack next to an MP4 whose
   audio track some players cannot play, or when the browser has no audio encoder) */
J.audioWav = (buffer, duration, offset = 0) => {
  const sr = buffer.sampleRate, chn = Math.min(2, buffer.numberOfChannels);
  const n = Math.max(1, Math.round((duration > 0 ? duration : buffer.duration) * sr));
  const bytes = n * chn * 2, ab = new ArrayBuffer(44 + bytes), v = new DataView(ab);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, chn, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * chn * 2, true); v.setUint16(32, chn * 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, bytes, true);
  const ch = []; for (let c = 0; c < chn; c++) ch.push(buffer.getChannelData(c));
  const L = buffer.length, i0 = Math.max(0, Math.round(offset * sr)); let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < chn; c++) {
    const j = i + i0, x = j < L ? Math.max(-1, Math.min(1, ch[c][j])) : 0;
    v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2;
  }
  return new Blob([ab], { type: 'audio/wav' });
};

/* the last song, kept in this browser (IndexedDB) so a reload does not silently drop the audio from exports */
const IDB = { db: null };
IDB.open = () => IDB.db || (IDB.db = new Promise((res, rej) => {
  if (typeof indexedDB === 'undefined') return rej(new Error('no IndexedDB'));
  const r = indexedDB.open('jizura', 1);
  r.onupgradeneeded = () => { r.result.createObjectStore('files'); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
}));
J.saveSong = async (file) => {
  try {
    const db = await IDB.open(), data = await file.arrayBuffer();
    await new Promise((res, rej) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put({ name: file.name, type: file.type, data }, 'song'); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    return true;
  } catch (e) { return false; }
};
J.loadSong = async () => {
  try {
    const db = await IDB.open();
    const rec = await new Promise((res, rej) => { const tx = db.transaction('files', 'readonly'); const q = tx.objectStore('files').get('song'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    if (!rec || !rec.data) return null;
    return new File([rec.data], rec.name || 'song', { type: rec.type || '' });
  } catch (e) { return null; }
};
J.saveFontData = async (key, data) => {
  try { const db = await IDB.open(); await new Promise((res, rej) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put({ data }, 'font:' + key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); return true; } catch (e) { return false; }
};
J.loadFontData = async (key) => {
  try { const db = await IDB.open(); const rec = await new Promise((res, rej) => { const tx = db.transaction('files', 'readonly'); const q = tx.objectStore('files').get('font:' + key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); return rec && rec.data ? rec.data : null; } catch (e) { return null; }
};
J.forgetSong = async () => {
  try { const db = await IDB.open(); await new Promise(res => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').delete('song'); tx.oncomplete = res; tx.onerror = res; }); } catch (e) {}
};

/* rebuild a beat grid from a user BPM + first-beat offset */
J.beatGrid = (bpm, offset, duration) => {
  const out = []; if (!(bpm > 0)) return out;
  const p = 60 / bpm;
  for (let t = offset; t < duration + 0.01; t += p) if (t >= 0) out.push(+t.toFixed(4));
  return out;
};
})();
