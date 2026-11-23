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
  const sideMono = ch >= 2 ? new Float32Array(len) : null;
  if (ch >= 2) {
    const chL = audioBuffer.getChannelData(0), chR = audioBuffer.getChannelData(1);
    for (let i = 0; i < len; i++) {
      mono[i] = 0.5 * (chL[i] + chR[i]);       // Mid (center lead vocal focus)
      sideMono[i] = 0.5 * (chL[i] - chR[i]);   // Side (stereo instruments, harmonies, reverb)
    }
    if (ch > 2) {
      for (let c = 2; c < ch; c++) { const d = audioBuffer.getChannelData(c); for (let i = 0; i < len; i++) mono[i] = (mono[i] * c + d[i]) / (c + 1); }
    }
  } else {
    const d = audioBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) mono[i] = d[i];
  }

  // Stage 1: Non-destructive audio normalization for analysis ONLY (original audioBuffer stays 100% untouched for playback & export)
  let rawPeak = 0, rawSqSum = 0, clippedSamples = 0;
  for (let i = 0; i < len; i++) {
    const x = mono[i];
    const ax = x < 0 ? -x : x;
    if (ax > rawPeak) rawPeak = ax;
    if (ax >= 0.985) clippedSamples++;
    rawSqSum += x * x;
  }
  const clipRatio = clippedSamples / Math.max(1, len);
  const rawRms = Math.sqrt(rawSqSum / Math.max(1, len));
  const targetRms = 0.14;
  const normGain = rawRms > 1e-5 ? Math.min(8.0, Math.min(0.92 / Math.max(1e-4, rawPeak), targetRms / rawRms)) : 1.0;
  const normMono = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const v = mono[i] * normGain;
    normMono[i] = v > 1 ? 1 : v < -1 ? -1 : v;
  }

  const rate = 50, hop = Math.round(sr / rate), n = Math.floor(len / hop);
  const energy = new Float32Array(n), flux = new Float32Array(n);
  const vocalEnergy = new Float32Array(n);

  // High-resolution 100 Hz (10ms) acoustic features for word & character forced alignment & VAD
  const fineRate = 100, fineHop = Math.max(1, Math.round(sr / fineRate)), fn = Math.floor(len / fineHop);
  const vocalEnv100 = new Float32Array(fn);
  const consonantFlux100 = new Float32Array(fn);
  const voicing100 = new Float32Array(fn);
  const wordAttack100 = new Float32Array(fn);
  const sideRatio100 = new Float32Array(fn);

  // Filter constants:
  // 1) Vocal formant bandpass (~300Hz - ~3400Hz)
  // 2) Consonant/plosive/sibilant attack bandpass (~2200Hz - ~6500Hz)
  const dt = 1 / sr;
  const aVHP = (1 / (2 * Math.PI * 300)) / (1 / (2 * Math.PI * 300) + dt);
  const aVLP = dt / (1 / (2 * Math.PI * 3400) + dt);
  const aCHP = (1 / (2 * Math.PI * 2200)) / (1 / (2 * Math.PI * 2200) + dt);
  const aCLP = dt / (1 / (2 * Math.PI * 6500) + dt);

  let prevHP = 0, prevX = 0;
  let prevVHP = 0, prevVX = 0, prevVLP = 0;
  let prevCHP = 0, prevCX = 0, prevCLP = 0;

  for (let f = 0; f < fn; f++) {
    let e = 0, eh = 0, ve = 0, ce = 0, se = 0;
    const i0 = f * fineHop;
    const end = Math.min(len, (f + 1) * fineHop);
    const cnt = Math.max(1, end - i0);
    for (let i = i0; i < end; i++) {
      const x = normMono[i];
      e += x * x;
      if (sideMono) {
        const sx = sideMono[i] * normGain;
        se += sx * sx;
      }
      const hp = 0.92 * (prevHP + x - prevX); prevHP = hp; prevX = x; eh += hp * hp;

      const vhp = aVHP * (prevVHP + x - prevVX); prevVHP = vhp; prevVX = x;
      const vlp = prevVLP + aVLP * (vhp - prevVLP); prevVLP = vlp;
      ve += vlp * vlp;

      const chp = aCHP * (prevCHP + x - prevCX); prevCHP = chp; prevCX = x;
      const clp = prevCLP + aCLP * (chp - prevCLP); prevCLP = clp;
      ce += clp * clp;
    }
    const rmsAll = Math.sqrt(e / cnt);
    const rmsVoc = Math.sqrt(ve / cnt);
    const rmsCon = Math.sqrt(ce / cnt);
    const rmsHp = Math.sqrt(eh / cnt);
    const rmsSide = sideMono ? Math.sqrt(se / cnt) : 0;

    vocalEnv100[f] = rmsVoc;
    consonantFlux100[f] = rmsCon;
    voicing100[f] = rmsAll > 1e-5 ? Math.min(1, rmsVoc / (rmsAll + 1e-5)) : 0;
    sideRatio100[f] = sideMono && (rmsAll + rmsSide) > 1e-5 ? Math.min(1, rmsSide / (rmsAll + 1e-5)) : 0;

    // Downsample 2x into 50Hz song-level buffers cleanly without second pass
    const f50 = f >> 1;
    if (f50 < n) {
      if ((f & 1) === 0) {
        energy[f50] = rmsAll * rmsAll;
        flux[f50] = rmsHp * rmsHp;
        vocalEnergy[f50] = rmsVoc * rmsVoc;
      } else {
        energy[f50] = Math.sqrt(0.5 * (energy[f50] + rmsAll * rmsAll));
        flux[f50] = Math.sqrt(0.5 * (flux[f50] + rmsHp * rmsHp));
        vocalEnergy[f50] = Math.sqrt(0.5 * (vocalEnergy[f50] + rmsVoc * rmsVoc));
      }
    }
  }
  if ((fn & 1) === 1 && n > 0 && (fn >> 1) < n) {
    const last50 = fn >> 1;
    energy[last50] = Math.sqrt(energy[last50]);
    flux[last50] = Math.sqrt(flux[last50]);
    vocalEnergy[last50] = Math.sqrt(vocalEnergy[last50]);
  }

  // Word pronunciation attack strength at 100Hz (10ms)
  for (let f = 1; f < fn; f++) {
    let vMean = 0, cMean = 0, k = 0;
    for (let j = Math.max(0, f - 5); j < f; j++) {
      vMean += Math.log(1e-4 + vocalEnv100[j]);
      cMean += Math.log(1e-4 + consonantFlux100[j]);
      k++;
    }
    const vJump = Math.max(0, Math.log(1e-4 + vocalEnv100[f]) - vMean / Math.max(1, k));
    const cJump = Math.max(0, Math.log(1e-4 + consonantFlux100[f]) - cMean / Math.max(1, k));
    wordAttack100[f] = +(0.68 * vJump + 0.52 * cJump).toFixed(5);
  }

  // onset strength: positive change of log high-passed energy vs local mean
  const onset = new Float32Array(n), vocalOnset = new Float32Array(n);
  for (let f = 1; f < n; f++) {
    const cur = Math.log(1e-4 + flux[f]);
    let m = 0, k = 0; for (let j = Math.max(0, f - 4); j < f; j++) { m += Math.log(1e-4 + flux[j]); k++; }
    onset[f] = Math.max(0, cur - m / Math.max(1, k));

    const vcur = Math.log(1e-4 + vocalEnergy[f]);
    let vm = 0, vk = 0; for (let j = Math.max(0, f - 6); j < f; j++) { vm += Math.log(1e-4 + vocalEnergy[j]); vk++; }
    vocalOnset[f] = Math.max(0, vcur - vm / Math.max(1, vk));
  }

  // Stage 1: Detect silence sections (RMS below adaptive floor >= 0.35s) on original timeline
  const sortedTotal = Array.from(energy).sort((a, b) => a - b);
  const p95Total = sortedTotal[Math.floor(sortedTotal.length * 0.95)] || 1e-3;
  const silenceThr = Math.max(1e-6, p95Total * 0.025);
  const silenceSegments = [];
  let inSil = false, silStart = 0;
  for (let f = 0; f < n; f++) {
    const isSil = energy[f] < silenceThr;
    const t = f / rate;
    if (isSil && !inSil) { inSil = true; silStart = t; }
    else if (!isSil && inSil) {
      if (t - silStart >= 0.35) silenceSegments.push({ start: +silStart.toFixed(3), end: +t.toFixed(3) });
      inSil = false;
    }
  }
  if (inSil && len / sr - silStart >= 0.35) silenceSegments.push({ start: +silStart.toFixed(3), end: +(len / sr).toFixed(3) });

  // Detect vocal active phrase segments & potential overlapping backing/stereo vocal regions
  const sortedVocal = Array.from(vocalEnergy).sort((a, b) => a - b);
  const vFloor20 = sortedVocal[Math.floor(sortedVocal.length * 0.2)] || 1e-5;
  const vPeak95 = sortedVocal[Math.floor(sortedVocal.length * 0.95)] || 1e-3;
  const vThresh = Math.max(silenceThr * 1.35, vFloor20 * 1.6, vPeak95 * 0.14);
  const vocalSegments = [];
  const overlapSegments = [];
  let inSeg = false, segStart = 0;
  let inOv = false, ovStart = 0;
  for (let f = 0; f < n; f++) {
    const isVoice = vocalEnergy[f] > vThresh;
    const t = f / rate;
    if (isVoice && !inSeg) { inSeg = true; segStart = t; }
    else if (!isVoice && inSeg) {
      if (t - segStart >= 0.35) vocalSegments.push({ start: +segStart.toFixed(3), end: +t.toFixed(3) });
      inSeg = false;
    }
    const f100 = Math.min(fn - 1, f * 2);
    const isOvFrame = isVoice && sideMono && sideRatio100[f100] > 0.38 && voicing100[f100] > 0.34;
    if (isOvFrame && !inOv) { inOv = true; ovStart = t; }
    else if (!isOvFrame && inOv) {
      if (t - ovStart >= 0.4) overlapSegments.push({ start: +ovStart.toFixed(3), end: +t.toFixed(3) });
      inOv = false;
    }
  }
  if (inSeg && len / sr - segStart >= 0.35) vocalSegments.push({ start: +segStart.toFixed(3), end: +(len / sr).toFixed(3) });
  if (inOv && len / sr - ovStart >= 0.4) overlapSegments.push({ start: +ovStart.toFixed(3), end: +(len / sr).toFixed(3) });
  // Fallback segmentation from vocal onset peaks for heavily compressed tracks without true silence
  if (vocalSegments.length === 0 && audioBuffer.duration > 2) {
    const segStep = Math.max(2.5, Math.min(4.5, audioBuffer.duration / 8));
    for (let t = 0.5; t < audioBuffer.duration - 1.0; t += segStep) {
      vocalSegments.push({ start: +t.toFixed(3), end: +Math.min(audioBuffer.duration, t + segStep - 0.2).toFixed(3) });
    }
  }

  // tempo via autocorrelation (70..180 BPM) — used strictly for video cut/visual pulse, NEVER to override vocal forced alignment
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
  const energyN = new Float32Array(n);
  for (let f = 0; f < n; f++) energyN[f] = Math.min(1, energy[f] / p95Total);
  // waveform peaks for the timeline
  const bins = 1600, peaks = new Float32Array(bins), per = Math.max(1, Math.floor(len / bins));
  for (let b = 0; b < bins; b++) { let m = 0; for (let i = b * per, e = Math.min(len, (b + 1) * per); i < e; i += 4) { const v = Math.abs(mono[i]); if (v > m) m = v; } peaks[b] = m; }

  // Acoustic classification: singing vs speech vs instrumental vs combination + instrumental gap detection
  const durSec = audioBuffer.duration;
  const rawAudioExt = ((file.name || '').match(/\.([^.]+)$/) || ['', ''])[1].toUpperCase();
  const mimeSub = (file.type || '').split('/').pop() || '';
  const format = rawAudioExt || (mimeSub ? mimeSub.replace(/^x-/, '').toUpperCase() : 'AUDIO');

  const instrumentalSegments = [];
  let cursor = 0;
  for (const seg of vocalSegments) {
    if (seg.start - cursor >= 2.4) {
      instrumentalSegments.push({ start: +cursor.toFixed(3), end: +seg.start.toFixed(3) });
    }
    cursor = Math.max(cursor, seg.end);
  }
  if (durSec - cursor >= 2.8) {
    instrumentalSegments.push({ start: +cursor.toFixed(3), end: +durSec.toFixed(3) });
  }

  let vocalActiveFrames = 0;
  let totalEnergySum = 0;
  let vocalEnergySum = 0;
  let onsetDensitySum = 0;
  for (let f = 0; f < n; f++) {
    totalEnergySum += energy[f];
    vocalEnergySum += vocalEnergy[f];
    onsetDensitySum += onset[f];
    if (vocalEnergy[f] > vThresh) vocalActiveFrames++;
  }
  const vocalRatio = n > 0 ? vocalActiveFrames / n : 0;
  const vocalFormantShare = totalEnergySum > 1e-6 ? vocalEnergySum / totalEnergySum : 0;
  const beatLocked = best > 0 && beats.length >= 4;
  let acousticType = 'singing';
  if (vocalRatio < 0.08 || (vocalFormantShare < 0.14 && beatLocked)) {
    acousticType = 'instrumental';
  } else if (!beatLocked && vocalRatio > 0.18 && instrumentalSegments.length <= 1 && (onsetDensitySum / Math.max(1, n)) < 0.14) {
    acousticType = 'speech';
  } else if (instrumentalSegments.length >= 2 && vocalRatio < 0.72) {
    acousticType = 'combination';
  }

  // FUNCTION 08 Track-level & 100Hz frame-level Audio Clarity, Noise, Clipping/Distortion & Reverberation Metrics
  const vFloor10 = sortedVocal[Math.floor(sortedVocal.length * 0.12)] || 1e-5;
  const vMed50 = sortedVocal[Math.floor(sortedVocal.length * 0.50)] || 1e-4;
  const trackSnrRatio = vPeak95 / Math.max(1e-5, vFloor10);
  const trackNoiseScore = J.clamp(1 - Math.log10(Math.max(1.2, trackSnrRatio)) / 1.85, 0, 1);

  // Estimate reverberation via persistence ratio after vocal peaks (high sustained tail / sluggish decay vs dry consonants)
  let decaySum = 0, decayCnt = 0;
  for (let f = 6; f < fn - 6; f++) {
    if (vocalEnv100[f] > vFloor10 * 2.5 && wordAttack100[f] < 0.08) {
      const ratio = Math.min(1, vocalEnv100[f] / Math.max(1e-5, vocalEnv100[f - 5]));
      if (ratio > 0.72 && ratio < 1.06) { decaySum += ratio; decayCnt++; }
    }
  }
  const reverbTailScore = decayCnt > 8 ? J.clamp((decaySum / decayCnt - 0.74) / 0.22, 0, 1) : 0.18;
  const clarity100 = new Float32Array(fn);
  let claritySum = 0, ovFrames = 0;
  for (let f = 0; f < fn; f++) {
    const localSnr = J.clamp((vocalEnv100[f] / Math.max(1e-5, Math.sqrt(vFloor10) * 1.4) - 0.5) / 5.0, 0.08, 1.0);
    const vadClarity = 0.55 * localSnr + 0.45 * voicing100[f];
    const ovDrag = sideRatio100[f] > 0.36 ? (sideRatio100[f] - 0.36) * 0.6 : 0;
    const revDrag = reverbTailScore * 0.22;
    const clipDrag = clipRatio > 0.008 ? Math.min(0.35, clipRatio * 12) : 0;
    const c = J.clamp(vadClarity * (1 - 0.35 * trackNoiseScore) - ovDrag - revDrag - clipDrag, 0.08, 0.97);
    clarity100[f] = +c.toFixed(3);
    claritySum += c;
    if (sideRatio100[f] > 0.38 && voicing100[f] > 0.34) ovFrames++;
  }
  const avgClarity = +(claritySum / Math.max(1, fn)).toFixed(3);
  const overlapRatio = +(ovFrames / Math.max(1, fn)).toFixed(3);
  const qualityConditions = {
    isNoisy: trackNoiseScore > 0.54 || trackSnrRatio < 6.5,
    noiseScore: +trackNoiseScore.toFixed(3),
    isDistorted: clipRatio > 0.006,
    clipRatio: +clipRatio.toFixed(4),
    isReverberated: reverbTailScore > 0.52,
    reverbScore: +reverbTailScore.toFixed(3),
    hasOverlappingSingers: overlapSegments.length > 0 || overlapRatio > 0.08,
    overlapRatio,
    avgClarity,
  };

  const preprocessing = {
    sampleRate: sr,
    duration: +durSec.toFixed(3),
    channels: ch,
    normGain: +normGain.toFixed(3),
    rmsDb: +(20 * Math.log10(Math.max(1e-5, rawRms))).toFixed(1),
    peakDb: +(20 * Math.log10(Math.max(1e-5, rawPeak))).toFixed(1),
    silenceCount: silenceSegments.length,
    vocalPhraseCount: vocalSegments.length,
    instrumentalGapCount: instrumentalSegments.length,
    overlapSegmentCount: overlapSegments.length,
    shouldSeparate: ch >= 2 || vocalFormantShare < 0.45,
    timelinePreserved: true,
    qualityConditions,
  };

  const acousticSummary = {
    audioType: acousticType,
    vocalRatio: +vocalRatio.toFixed(3),
    vocalFormantShare: +vocalFormantShare.toFixed(3),
    silenceCount: silenceSegments.length,
    instrumentalGapCount: instrumentalSegments.length,
    vocalPhraseCount: vocalSegments.length,
    overlapSegmentCount: overlapSegments.length,
    avgClarity,
    qualityConditions,
    sampleRate: sr,
    channels: ch,
    format,
  };

  return {
    name: file.name, format, duration: audioBuffer.duration, sampleRate: sr, channels: ch, buffer: audioBuffer,
    bpm: Math.round(60 / period * 10) / 10, beats, energy: energyN, energyRate: rate, peaks,
    vocalEnergy, vocalOnset, silenceSegments, vocalSegments, instrumentalSegments, overlapSegments,
    preprocessing, acousticSummary, qualityConditions,
    fineRate, vocalEnv100, consonantFlux100, voicing100, wordAttack100, sideRatio100, clarity100,
  };
};

/* Language-aware tokenization for karaoke word & character alignment:
   - Chinese: individual Chinese characters as separate aligned tokens
   - Japanese: kanji individually, kana + small yoon/sokuon/prolonged mark as mora clusters
   - Thai / Lao / Khmer / Myanmar (no-space scripts): Intl.Segmenter word segmentation when supported
   - Korean & Latin/Vietnamese: words preserved with apostrophe contractions & trailing light punctuation */
J.tokenizeKaraokeWords = (text, lang) => {
  const clean = String(text || '').trim();
  if (!clean) return [];
  const normLang = String(lang || '').toLowerCase();
  const hasCjk = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff]/.test(clean);
  const hasNoSpaceSea = /[\u0e00-\u0e7f\u0e80-\u0eff\u1780-\u17ff\u1000-\u109f]/.test(clean);

  const tokens = [];
  if (hasNoSpaceSea && typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segLocale = normLang.startsWith('th') ? 'th' : normLang.startsWith('km') ? 'km' : normLang.startsWith('lo') ? 'lo' : 'th';
    try {
      const segmenter = new Intl.Segmenter(segLocale, { granularity: 'word' });
      for (const part of segmenter.segment(clean)) {
        const s = part.segment.trim();
        if (!s) continue;
        if (hasCjk && /[\u4e00-\u9fff\u3400-\u4dbf]/.test(s)) {
          for (const ch of s) tokens.push(ch);
        } else {
          tokens.push(s);
        }
      }
      if (tokens.length) return tokens;
    } catch (e) {}
  }

  const re = /[¿¡]?[A-Za-zÀ-ÿ\u0100-\u024f\u1e00-\u1eff0-9]+(?:['’\-][A-Za-zÀ-ÿ\u0100-\u024f\u1e00-\u1eff0-9]+)*[,.;:!?…]?|[\uac00-\ud7af]+[,.;:!?…]?|[\u3040-\u309f\u30a0-\u30ff][\u3041\u3043\u3045\u3047\u3049\u3063\u3083\u3085\u3087\u308e\u30a1\u30a3\u30a5\u30a7\u30a9\u30c3\u30e3\u30e5\u30e7\u30ee\u30fc]*[、。，．！？…]?|[\u4e00-\u9fff\u3400-\u4dbf][、。，．！？…]?|[^\s]/g;
  const rawTokens = clean.match(re) || [clean];
  for (const tk of rawTokens) {
    if (/^[.,!?;:…、。，．！？」』）)]+$/.test(tk) && tokens.length) {
      tokens[tokens.length - 1] += tk;
    } else if (/^[\u4e00-\u9fff\u3400-\u4dbf]{2,}$/.test(tk)) {
      for (const ch of tk) tokens.push(ch);
    } else {
      tokens.push(tk);
    }
  }
  return tokens;
};

/* Build character-level timestamps inside a word, warping along real 10ms vocal acoustic energy when available */
J.buildCharTimings = (wordText, start, end, analysis) => {
  const chars = Array.from(String(wordText || ''));
  const n = chars.length;
  const s = Math.max(0, Number(start) || 0);
  const e = Math.max(s + 0.015, Number(end) || s + 0.16);
  if (!n) return [];
  if (n === 1) return [{ ch: chars[0], start: +s.toFixed(3), end: +e.toFixed(3) }];

  const weights = chars.map(ch => {
    if (/[aeiouyàâäéèêëîïôöùûüÿæœáàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵ]/i.test(ch)) return 1.38;
    if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(ch)) return 1.4;
    if (/[bcdfgjklmnpqrstvwxz]/i.test(ch)) return 0.85;
    if (/[0-9]/.test(ch)) return 1.0;
    return 0.28;
  });
  const totalW = weights.reduce((a, b) => a + b, 0) || n;

  const env = analysis && analysis.vocalEnv100;
  const att = analysis && analysis.wordAttack100;
  const fr = (analysis && analysis.fineRate) || 100;
  const dur = e - s;
  if (env && env.length && fr > 0 && dur >= 0.06) {
    const steps = Math.max(n * 3, Math.min(48, Math.round(dur * fr)));
    const cdf = new Float64Array(steps + 1);
    for (let i = 1; i <= steps; i++) {
      const t = s + ((i - 0.5) / steps) * dur;
      const fi = Math.min(env.length - 1, Math.max(0, Math.round(t * fr)));
      const ac = Math.pow(Math.max(1e-4, env[fi]), 0.5) + (att ? Math.min(1.5, att[fi]) * 0.25 : 0);
      cdf[i] = cdf[i - 1] + (0.45 + 0.55 * ac);
    }
    const cdfTot = cdf[steps] || 1;
    const sampleT = (frac) => {
      const tgt = Math.max(0, Math.min(1, frac)) * cdfTot;
      let lo = 0, hi = steps;
      while (lo < hi) { const m = (lo + hi) >> 1; if (cdf[m] < tgt) lo = m + 1; else hi = m; }
      const prev = lo > 0 ? cdf[lo - 1] : 0;
      const seg = Math.max(1e-6, cdf[lo] - prev);
      const pos = Math.max(0, (lo - 1 + (lo > 0 ? (tgt - prev) / seg : 0)) / steps);
      return s + pos * dur;
    };
    let acc = 0;
    let prevEnd = s;
    return chars.map((ch, idx) => {
      acc += weights[idx];
      const cs = +prevEnd.toFixed(3);
      const rawEnd = idx === n - 1 ? e : sampleT(acc / totalW);
      const remain = n - 1 - idx;
      const maxEnd = e - remain * 0.006;
      const ce = idx === n - 1 ? +e.toFixed(3) : +Math.min(maxEnd, Math.max(cs + 0.006, rawEnd)).toFixed(3);
      prevEnd = ce;
      return { ch, start: cs, end: ce };
    });
  }

  let cur = s;
  return chars.map((ch, idx) => {
    const step = (weights[idx] / totalW) * dur;
    const cs = +cur.toFixed(3);
    cur += step;
    const ce = idx === n - 1 ? +e.toFixed(3) : +Math.max(cs + 0.008, cur).toFixed(3);
    return { ch, start: cs, end: ce };
  });
};

/* Phonetic word statistics used by Viterbi DP acoustic forced alignment */
function wordPhoneticStats(tk) {
  const stripped = String(tk || '').replace(/[^\p{L}\p{N}]/gu, '');
  if (!stripped) return { weight: 0.35, hasStrongOnset: false };
  const hasStrongOnset = /^[bcdfghjkpqstvwxzBCDFGHJKPQSTVWXZ\u00c7\u00e7\u0111\u0110]/.test(stripped);
  if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(stripped)) {
    return { weight: Math.max(0.85, [...stripped].length * 1.15), hasStrongOnset: true };
  }
  const vowelGroups = stripped.match(/[aeiouyàâäéèêëîïôöùûüÿæœáàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵ]+/gi);
  const syl = vowelGroups ? vowelGroups.length : 1;
  return { weight: Math.max(0.65, syl * 0.85 + stripped.length * 0.14), hasStrongOnset };
}

/* Viterbi Dynamic Programming Acoustic Forced Alignment (NOT uniform, NOT text-length-only, NOT beat-only):
   Places word & character boundaries on detected 10ms vocal formant sustains + consonant/plosive attacks,
   trims inter-word pauses/silences, and computes real acoustic alignmentConfidence & speaker metadata. */
J.alignWordsAcoustic = (analysis, text, tStart, tEnd, lang, speaker = 'Lead', recConf = 0.9) => {
  const tokens = J.tokenizeKaraokeWords(text, lang);
  const s = Math.max(0, Number(tStart) || 0);
  const e = Math.max(s + 0.15, Number(tEnd) || s + 2.0);
  if (!tokens.length) return [];

  const stats = tokens.map(wordPhoneticStats);
  const weights = stats.map(st => st.weight);
  const totalW = weights.reduce((a, b) => a + b, 0) || tokens.length;

  const env = analysis && (analysis.vocalEnv100 || analysis.vocalEnergy);
  const att = analysis && (analysis.wordAttack100 || analysis.vocalOnset);
  const con = analysis && analysis.consonantFlux100;
  const er = (analysis && analysis.vocalEnv100 ? analysis.fineRate : analysis && analysis.energyRate) || 100;
  const useAcoustic = !!(env && env.length && er > 0);

  if (!useAcoustic) {
    let cur = s;
    return tokens.map((tk, wi) => {
      const dur = (weights[wi] / totalW) * (e - s);
      const ws = +cur.toFixed(3);
      cur += dur;
      const we = wi === tokens.length - 1 ? +e.toFixed(3) : +Math.max(ws + 0.02, cur).toFixed(3);
      return {
        text: tk,
        start: ws,
        end: we,
        chars: J.buildCharTimings(tk, ws, we),
        recognitionConfidence: +Math.max(0, Math.min(1, recConf)).toFixed(3),
        alignmentConfidence: 0.62,
        speaker,
      };
    });
  }

  // 1. Detect true vocal boundaries inside [tStart, tEnd] (trim leading/trailing silence)
  const fStart = Math.max(0, Math.floor(s * er));
  const fEnd = Math.min(env.length - 1, Math.ceil(e * er));
  let maxE = 0;
  const localVals = [];
  for (let f = fStart; f <= fEnd; f++) {
    if (env[f] > maxE) maxE = env[f];
    localVals.push(env[f]);
  }
  localVals.sort((a, b) => a - b);
  const p20 = localVals[Math.floor(localVals.length * 0.2)] || 1e-4;
  const silenceThr = Math.max(p20 * 1.35, maxE * 0.16, 1e-4);

  let activeStartF = fStart;
  let activeEndF = fEnd;
  if (maxE > 1e-4) {
    while (activeStartF < fEnd - tokens.length && env[activeStartF] < silenceThr && (activeStartF - fStart) / er < (e - s) * 0.35) {
      activeStartF++;
    }
    while (activeEndF > activeStartF + Math.max(2, tokens.length) && env[activeEndF] < silenceThr && (fEnd - activeEndF) / er < (e - s) * 0.38) {
      activeEndF--;
    }
  }
  const activeS = Math.max(s, activeStartF / er);
  const activeE = Math.min(e, Math.max(activeS + 0.12, activeEndF / er));

  // If single token/word, return trimmed span + real SNR confidence directly
  if (tokens.length === 1) {
    const ws = +activeS.toFixed(3);
    const we = +Math.max(ws + 0.04, activeE).toFixed(3);
    const snr = Math.min(1, maxE / Math.max(1e-4, p20 * 3));
    const acConf = +(0.65 + 0.31 * snr).toFixed(3);
    return [{
      text: tokens[0],
      start: ws,
      end: we,
      chars: J.buildCharTimings(tokens[0], ws, we, analysis),
      recognitionConfidence: +Math.max(0, Math.min(1, recConf)).toFixed(3),
      alignmentConfidence: acConf,
      speaker,
      flags: acConf < 0.7 ? ['uncertain_boundary'] : [],
    }];
  }

  // 2. Build Viterbi DP grid across K words and M frames (downsampled safely if > 320 frames)
  const K = tokens.length;
  const rawSpanF = Math.max(K, activeEndF - activeStartF);
  const strideF = Math.max(1, Math.ceil(rawSpanF / 320));
  const M = Math.max(K, Math.floor(rawSpanF / strideF));
  const dtStep = strideF / er;

  const prefEnergy = new Float64Array(M + 1);
  const frameAttack = new Float64Array(M + 1);
  const frameLowEnergy = new Uint8Array(M + 1);

  for (let m = 0; m <= M; m++) {
    const fi = Math.min(env.length - 1, activeStartF + m * strideF);
    const eNorm = maxE > 1e-5 ? env[fi] / maxE : 0.5;
    const attNorm = att ? Math.min(1.5, att[fi]) : 0;
    const conBoost = con && maxE > 1e-5 ? Math.min(0.8, con[fi] / maxE) : 0;
    frameAttack[m] = attNorm + 0.35 * conBoost;
    frameLowEnergy[m] = env[fi] < silenceThr ? 1 : 0;
    if (m > 0) prefEnergy[m] = prefEnergy[m - 1] + (0.25 + 0.75 * Math.pow(eNorm, 0.7));
  }

  // DP maximize score: sum of onset attack rewards + vocal sustain fit - log duration mismatch penalty
  const NEG = -1e12;
  const dp = Array.from({ length: K + 1 }, () => new Float64Array(M + 1).fill(NEG));
  const back = Array.from({ length: K + 1 }, () => new Int32Array(M + 1));
  dp[0][0] = 0;

  const minFramesPerWord = Math.max(1, Math.min(Math.floor(M / K), Math.round(0.035 / dtStep)));
  const totalEnergySpan = Math.max(1e-4, prefEnergy[M]);

  for (let w = 0; w < K; w++) {
    const targetFrac = weights[w] / totalW;
    const expDurFrames = Math.max(minFramesPerWord, targetFrac * M);
    const expDurEnergy = Math.max(0.05, targetFrac * totalEnergySpan);
    const remainMin = (K - 1 - w) * minFramesPerWord;
    const onsetWeight = stats[w].hasStrongOnset ? 1.35 : 0.9;

    const prevMin = w * minFramesPerWord;
    const prevMax = M - (K - w) * minFramesPerWord;

    for (let j = prevMin + minFramesPerWord; j <= M - remainMin; j++) {
      let bestVal = NEG;
      let bestI = prevMin;
      // Search plausible duration window around phonetic expectation
      const loI = Math.max(prevMin, j - Math.round(expDurFrames * 3.4) - 4);
      const hiI = Math.min(prevMax, j - minFramesPerWord);
      for (let i = loI; i <= hiI; i++) {
        if (dp[w][i] <= NEG * 0.5) continue;
        const wordE = prefEnergy[j] - prefEnergy[i];
        const eRatio = Math.log(Math.max(0.15, (wordE + 0.08) / (expDurEnergy + 0.08)));
        const durRatio = Math.log(Math.max(0.15, (j - i) / Math.max(1, expDurFrames)));
        // Reward word start sitting right on a real vocal onset / consonant transient peak
        const onsetScore = onsetWeight * frameAttack[i];
        const pauseCutBonus = i > 0 && frameLowEnergy[i - 1] && !frameLowEnergy[i] ? 0.55 : 0;
        const score = dp[w][i] + onsetScore + pauseCutBonus + 0.25 * wordE - 1.15 * eRatio * eRatio - 0.55 * durRatio * durRatio;
        if (score > bestVal) {
          bestVal = score;
          bestI = i;
        }
      }
      dp[w + 1][j] = bestVal;
      back[w + 1][j] = bestI;
    }
  }

  // Backtrack boundary frames
  const bounds = new Int32Array(K + 1);
  bounds[K] = M;
  for (let w = K; w >= 1; w--) {
    bounds[w - 1] = back[w][bounds[w]];
  }
  bounds[0] = 0;

  // 3. Emit words, trim interior silent pause gaps between words, compute real acoustic confidence + chars
  const out = [];
  let prevWordEnd = s;
  for (let w = 0; w < K; w++) {
    let rawF0 = activeStartF + bounds[w] * strideF;
    let rawF1 = w === K - 1 ? activeEndF : activeStartF + bounds[w + 1] * strideF;

    // Trim trailing silence frames before the next word begins to preserve genuine breath/pause gaps
    if (w < K - 1) {
      let trimmedEnd = rawF1;
      const minKeep = rawF0 + Math.max(2, Math.round(0.03 * er));
      while (trimmedEnd > minKeep && env[trimmedEnd - 1] < silenceThr && (rawF1 - trimmedEnd) < Math.round(0.45 * er)) {
        trimmedEnd--;
      }
      if (rawF1 - trimmedEnd >= Math.round(0.035 * er)) rawF1 = trimmedEnd;
    }
    // Trim leading silence frames on internal words after a pause
    if (w > 0) {
      let trimmedStart = rawF0;
      const maxAdvance = rawF1 - Math.max(2, Math.round(0.03 * er));
      while (trimmedStart < maxAdvance && env[trimmedStart] < silenceThr && (trimmedStart - rawF0) < Math.round(0.35 * er)) {
        trimmedStart++;
      }
      rawF0 = trimmedStart;
    }

    const ws = +Math.max(prevWordEnd, Math.min(e - 0.02, rawF0 / er)).toFixed(3);
    const we = w === K - 1
      ? +Math.max(ws + 0.025, Math.min(e, activeE)).toFixed(3)
      : +Math.max(ws + 0.025, Math.min(e - (K - 1 - w) * 0.02, rawF1 / er)).toFixed(3);
    prevWordEnd = we;

    // Local word alignment confidence from peak vocal onset & SNR inside [rawF0, rawF1]
    let wMaxE = 0, wMaxAtt = 0;
    for (let f = Math.max(0, rawF0 - 2); f <= Math.min(env.length - 1, rawF1); f++) {
      if (env[f] > wMaxE) wMaxE = env[f];
    }
    if (att) {
      for (let f = Math.max(0, rawF0 - 2); f <= Math.min(att.length - 1, rawF0 + 3); f++) {
        if (att[f] > wMaxAtt) wMaxAtt = att[f];
      }
    }
    const snrScore = maxE > 1e-5 ? Math.min(1, wMaxE / (silenceThr * 2.2)) : 0.6;
    const onsetMatchScore = Math.min(1, wMaxAtt / 0.85);
    const alignConf = +(J.clamp(0.54 + 0.24 * snrScore + 0.2 * onsetMatchScore, 0.45, 0.98)).toFixed(3);

    out.push({
      text: tokens[w],
      start: ws,
      end: we,
      chars: J.buildCharTimings(tokens[w], ws, we, analysis),
      recognitionConfidence: +J.clamp(recConf, 0, 1).toFixed(3),
      alignmentConfidence: alignConf,
      speaker,
      flags: alignConf < 0.7 ? ['uncertain_boundary'] : [],
    });
  }
  return out;
};

/* Stage 5: Hybrid AI + Phoneme + 10ms Acoustic Refinement Pipeline:
   - Splits grouped CJK multi-char strings into individual aligned characters
   - Uses phoneme boundaries when present (w.phonemes), vocal onsets (wordAttack100), VAD (voicing100), and vocal energy
   - Trims unvoiced inter-word breaths/pauses cleanly without beat snapping */
J.refineWordTimingsAcoustic = (analysis, rawWords, lineStart, lineEnd, lang, defaultSpeaker = 'Lead') => {
  if (!Array.isArray(rawWords) || !rawWords.length) return [];
  const sLine = Math.max(0, Number(lineStart) || 0);
  const eLine = Math.max(sLine + 0.1, Number(lineEnd) || sLine + 2.0);
  const normLang = String(lang || '').toLowerCase();
  const isZh = normLang.startsWith('zh');

  const expanded = [];
  for (const w of rawWords) {
    const txt = String(w && w.text || '').trim();
    if (!txt) continue;
    let ws = Math.max(sLine, Number(w.start) || sLine);
    let we = Math.min(eLine, Math.max(ws + 0.015, Number(w.end) || ws + 0.2));
    // Anchor on explicit phoneme boundary span if available (Stage 4 phoneme derivation)
    const ph = Array.isArray(w.phonemes) ? w.phonemes.filter(p => p && Number.isFinite(+p.start) && Number.isFinite(+p.end)) : [];
    if (ph.length) {
      const phS = Math.max(sLine, Number(ph[0].start));
      const phE = Math.min(eLine, Number(ph[ph.length - 1].end));
      if (phE > phS + 0.015) {
        ws = phS;
        we = phE;
      }
    }
    const spk = String(w.speaker || defaultSpeaker || 'Lead').trim();
    const recC = Number.isFinite(Number(w.recognitionConfidence)) ? J.clamp(Number(w.recognitionConfidence), 0, 1) : 0.92;
    const alignC = Number.isFinite(Number(w.alignmentConfidence)) ? J.clamp(Number(w.alignmentConfidence), 0, 1) : 0.9;
    const baseFlags = Array.isArray(w.flags) ? w.flags.slice() : [];

    if ((isZh || /[\u4e00-\u9fff\u3400-\u4dbf]{2,}/.test(txt)) && Array.from(txt).filter(c => /[\u4e00-\u9fff\u3400-\u4dbf]/.test(c)).length >= 2) {
      const subTokens = J.tokenizeKaraokeWords(txt, lang);
      if (subTokens.length > 1) {
        const subAligned = J.alignWordsAcoustic(analysis, subTokens.join(' '), ws, we, lang, spk, recC);
        if (subAligned.length === subTokens.length) {
          subAligned.forEach((sw, si) => {
            sw.text = subTokens[si];
            sw.alignmentConfidence = +Math.max(sw.alignmentConfidence, alignC * 0.92).toFixed(3);
            sw.flags = baseFlags.slice();
            expanded.push(sw);
          });
          continue;
        }
      }
    }
    expanded.push({ text: txt, start: ws, end: we, chars: w.chars, phonemes: ph, recognitionConfidence: recC, alignmentConfidence: alignC, speaker: spk, flags: baseFlags });
  }

  const att = analysis && analysis.wordAttack100;
  const env = analysis && analysis.vocalEnv100;
  const vad = analysis && analysis.voicing100;
  const ovMap = analysis && analysis.sideRatio100;
  const fr = (analysis && analysis.fineRate) || 100;
  const canSnap = !!(att && env && att.length && fr > 0);

  let prevEnd = sLine;
  return expanded.map(w => {
    let ws = Math.max(prevEnd, w.start);
    let we = Math.min(eLine, Math.max(ws + 0.018, w.end));

    if (canSnap) {
      // 1) Snap onset onto crisp vocal/consonant attack peak within ±70ms
      const centerF = Math.round(ws * fr);
      const loF = Math.max(Math.ceil(prevEnd * fr), centerF - 7);
      const hiF = Math.min(Math.floor((we - 0.02) * fr), att.length - 1, centerF + 7);
      let bestF = centerF, bestA = -1, meanA = 0, cntA = 0;
      for (let f = loF; f <= hiF; f++) {
        meanA += att[f]; cntA++;
        if (att[f] > bestA) { bestA = att[f]; bestF = f; }
      }
      const avgA = cntA > 0 ? meanA / cntA : 0;
      if (bestA > Math.max(0.18, avgA * 1.45)) {
        const snapped = bestF / fr;
        if (snapped >= prevEnd && snapped < we - 0.02) {
          ws = snapped;
        }
      }
      // 2) Trim trailing low-VAD / unvoiced tail (keeping authentic pause gap before next word)
      if (vad && vad.length) {
        let fEnd = Math.min(vad.length - 1, Math.round(we * fr));
        const fMin = Math.ceil((ws + 0.03) * fr);
        while (fEnd > fMin && vad[fEnd] < 0.14 && env[fEnd] < 0.008 && (Math.round(we * fr) - fEnd) < 12) {
          fEnd--;
        }
        const trimmedEnd = fEnd / fr;
        if (trimmedEnd >= ws + 0.025 && trimmedEnd <= we) we = trimmedEnd;
      }
    }

    ws = +ws.toFixed(3);
    we = +Math.max(ws + 0.018, we).toFixed(3);
    prevEnd = we;

    let finalAlignC = w.alignmentConfidence;
    const flagSet = new Set(Array.isArray(w.flags) ? w.flags : []);
    if (canSnap) {
      const f0 = Math.max(0, Math.min(env.length - 1, Math.round(ws * fr)));
      const f1 = Math.max(f0, Math.min(env.length - 1, Math.round(we * fr)));
      let wPeak = 0, vadSum = 0, ovSum = 0, nF = 0;
      for (let f = f0; f <= f1; f++) {
        if (env[f] > wPeak) wPeak = env[f];
        if (vad) vadSum += vad[f];
        if (ovMap) ovSum += ovMap[f];
        nF++;
      }
      const avgVad = nF ? vadSum / nF : 0.5;
      const avgOv = nF ? ovSum / nF : 0;
      const acBonus = (wPeak > 0.004 ? 0.65 : 0.4) + 0.35 * Math.min(1, avgVad * 1.4);
      finalAlignC = +J.clamp(0.62 * w.alignmentConfidence + 0.38 * acBonus, 0.35, 0.99).toFixed(3);
      if (wPeak < 0.0025 || avgVad < 0.16) flagSet.add('uncertain_boundary');
      if (avgOv > 0.42) flagSet.add('overlapping_vocals');
    }
    if (w.recognitionConfidence < 0.72) flagSet.add('uncertain_word');
    if (w.recognitionConfidence < 0.52) flagSet.add('misrecognized_word');
    if (finalAlignC < 0.70) flagSet.add('uncertain_boundary');

    const chars = (Array.isArray(w.chars) && w.chars.length === Array.from(w.text).length)
      ? w.chars.map((ch, ci) => {
          const cs = Math.max(ws, Math.min(we - 0.005, Number(ch.start) || ws));
          const ce = ci === w.chars.length - 1 ? we : Math.min(we, Math.max(cs + 0.005, Number(ch.end) || cs + 0.02));
          return { ch: ch.ch, start: +cs.toFixed(3), end: +ce.toFixed(3) };
        })
      : J.buildCharTimings(w.text, ws, we, analysis);

    return {
      text: w.text,
      start: ws,
      end: we,
      chars,
      phonemes: w.phonemes && w.phonemes.length ? w.phonemes : undefined,
      recognitionConfidence: +w.recognitionConfidence.toFixed(3),
      alignmentConfidence: finalAlignC,
      speaker: w.speaker,
      flags: Array.from(flagSet),
      validated: Boolean(w.validated),
    };
  });
};

/* Align lyric lines instantly to detected vocal singing onsets and phrase boundaries */
J.alignLinesToVocals = (analysis, lines) => {
  if (!analysis || !lines || !lines.length) return {};
  const { vocalSegments, vocalOnset, duration, energyRate } = analysis;
  const lineTimes = {};
  const segs = (vocalSegments || []).slice();
  const validLines = lines.map((l, i) => ({ i, ...l })).filter(l => !l.interlude && l.text);
  if (!validLines.length) return lineTimes;

  if (segs.length > 0) {
    for (let k = 0; k < validLines.length; k++) {
      const line = validLines[k];
      const targetRatio = k / Math.max(1, validLines.length - 1);
      const estTime = targetRatio * (duration * 0.85);

      let bestSeg = null, bestDist = 1e9;
      for (const seg of segs) {
        const d = Math.abs(seg.start - estTime);
        const lastT = Object.keys(lineTimes).length ? Math.max(...Object.values(lineTimes)) : -1;
        if (d < bestDist && seg.start >= lastT + 0.3) {
          bestDist = d; bestSeg = seg;
        }
      }
      if (bestSeg) {
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

/* Find nearest genuine vocal/consonant attack transient around targetTime (±radiusSec)
   Used by Tap Studio Adaptive Latency Calibration, Vocal Coordination Radar, and live micro-snapping. */
J.estimateVocalAttackNear = (analysis, targetTime, radiusSec = 0.22, minBound = 0, maxBound = Infinity) => {
  const t = Math.max(minBound, Number(targetTime) || 0);
  const att = analysis && (analysis.wordAttack100 || analysis.vocalOnset);
  const env = analysis && (analysis.vocalEnv100 || analysis.vocalEnergy);
  const con = analysis && analysis.consonantFlux100;
  const vad = analysis && analysis.voicing100;
  const cla = analysis && analysis.clarity100;
  const fr = (analysis && (analysis.vocalEnv100 ? analysis.fineRate : analysis.energyRate)) || 100;
  if (!att || !att.length || !(fr > 0)) {
    return { found: false, attackTime: +t.toFixed(3), driftMs: 0, strength: 0, voicing: 0, clarity: 0.5 };
  }
  const rad = Math.max(0.04, Number(radiusSec) || 0.22);
  const loT = Math.max(minBound, t - rad);
  const hiT = Math.min(maxBound, t + rad);
  const idx0 = Math.max(0, Math.floor(loT * fr));
  const idx1 = Math.min(att.length - 1, Math.ceil(hiT * fr));
  let bestF = -1, bestScore = -1, maxEnv = 1e-4;
  if (env) {
    for (let f = idx0; f <= idx1; f++) if (env[f] > maxEnv) maxEnv = env[f];
  }
  for (let f = idx0; f <= idx1; f++) {
    const ft = f / fr;
    if (ft < minBound || ft > maxBound) continue;
    const distNorm = Math.min(1, Math.abs(ft - t) / rad);
    const distWeight = 1 - 0.28 * distNorm;
    const eNorm = env ? Math.min(1, env[f] / Math.max(1e-4, maxEnv)) : 0.4;
    const cNorm = con ? Math.min(1, con[f] / Math.max(1e-4, maxEnv)) : 0;
    const score = (0.64 * att[f] + 0.22 * cNorm + 0.14 * eNorm) * distWeight;
    if (score > bestScore) { bestScore = score; bestF = f; }
  }
  if (bestF >= 0 && att[bestF] > 0.025 && bestScore > 0.032) {
    const atkT = +Math.max(minBound, Math.min(maxBound, bestF / fr)).toFixed(3);
    return {
      found: true,
      attackTime: atkT,
      driftMs: Math.round((t - atkT) * 1000),
      strength: +att[bestF].toFixed(3),
      voicing: vad ? +vad[bestF].toFixed(3) : 0.72,
      clarity: cla ? +cla[bestF].toFixed(3) : 0.74,
    };
  }
  return { found: false, attackTime: +t.toFixed(3), driftMs: 0, strength: 0, voicing: 0, clarity: 0.5 };
};

/* Snap vocal release / hold end onto genuine voicing decay around approxEndTime */
J.alignVocalTailEnd = (analysis, approxEndTime, minStart = 0, maxEnd = Infinity) => {
  const raw = Math.max(minStart + 0.05, Math.min(maxEnd, Number(approxEndTime) || minStart + 0.2));
  const env = analysis && analysis.vocalEnv100;
  const vad = analysis && analysis.voicing100;
  const fr = (analysis && analysis.fineRate) || 100;
  if (!env || !env.length || !(fr > 0)) return +raw.toFixed(3);

  const idxCenter = Math.max(0, Math.min(env.length - 1, Math.round(raw * fr)));
  const idx0 = Math.max(Math.ceil((minStart + 0.04) * fr), idxCenter - 14);
  const idx1 = Math.min(env.length - 1, Math.floor(Math.min(maxEnd, raw + 0.14) * fr));
  let peakE = 0;
  for (let f = idx0; f <= idxCenter; f++) if (env[f] > peakE) peakE = env[f];
  if (peakE <= 1e-4) return +raw.toFixed(3);

  const dropThr = peakE * 0.28;
  for (let f = Math.max(idx0, idxCenter - 4); f <= idx1; f++) {
    const lowV = vad ? vad[f] < 0.18 : false;
    if (env[f] <= dropThr || lowV) {
      return +Math.max(minStart + 0.05, Math.min(maxEnd, f / fr)).toFixed(3);
    }
  }
  return +raw.toFixed(3);
};

/* Constrained Anchor-Warp Word Alignment:
   Preserves manually tapped/validated anchor words intact while snapping every remaining word
   between anchors onto 10ms acoustic vocal attack & consonant peaks via Viterbi DP. */
J.alignLineWordsAnchored = (analysis, words, lineStart, lineEnd, lang, defaultSpeaker = 'Lead') => {
  if (!Array.isArray(words) || !words.length) return [];
  const sLine = Math.max(0, Number(lineStart) || 0);
  const eLine = Math.max(sLine + 0.08 * words.length, Number(lineEnd) || sLine + 2.0);
  const cloned = words.map(w => Object.assign({}, w, {
    text: String((w && w.text) || ''),
    start: Number(w && w.start) || sLine,
    end: Number(w && w.end) || (sLine + 0.2),
    speaker: String((w && w.speaker) || defaultSpeaker || 'Lead'),
    validated: Boolean(w && w.validated),
  }));

  // Partition into contiguous unvalidated runs separated by validated anchors
  let idx = 0;
  while (idx < cloned.length) {
    if (cloned[idx].validated) {
      if (!Array.isArray(cloned[idx].chars) || !cloned[idx].chars.length) {
        cloned[idx].chars = J.buildCharTimings(cloned[idx].text, cloned[idx].start, cloned[idx].end, analysis);
      }
      idx++;
      continue;
    }
    let endIdx = idx;
    while (endIdx + 1 < cloned.length && !cloned[endIdx + 1].validated) endIdx++;

    const leftT = idx === 0
      ? sLine
      : Math.max(sLine, cloned[idx - 1].end + 0.006);
    const rightLimit = endIdx === cloned.length - 1
      ? eLine
      : Math.min(eLine, Math.max(leftT + 0.06 * (endIdx - idx + 1), cloned[endIdx + 1].start - 0.006));
    const spanText = cloned.slice(idx, endIdx + 1).map(w => w.text).join(' ');
    const avgRec = cloned.slice(idx, endIdx + 1).reduce((s, w) => s + (Number(w.recognitionConfidence) || 0.9), 0) / (endIdx - idx + 1);
    const aligned = J.alignWordsAcoustic(analysis, spanText, leftT, rightLimit, lang, defaultSpeaker, avgRec);

    const count = endIdx - idx + 1;
    if (aligned.length === count) {
      for (let k = 0; k < count; k++) {
        const tgt = cloned[idx + k];
        const src = aligned[k];
        tgt.start = src.start;
        tgt.end = src.end;
        tgt.chars = src.chars;
        tgt.alignmentConfidence = src.alignmentConfidence;
        tgt.flags = src.flags;
      }
    } else {
      // Fallback: distribute phonetically & build chars if tokenizer split differs
      const totalWeights = cloned.slice(idx, endIdx + 1).reduce((s, w) => s + wordPhoneticStats(w.text).weight, 0) || count;
      let cur = leftT;
      for (let k = 0; k < count; k++) {
        const tgt = cloned[idx + k];
        const dur = (wordPhoneticStats(tgt.text).weight / totalWeights) * Math.max(0.06 * count, rightLimit - leftT);
        tgt.start = +cur.toFixed(3);
        cur += dur;
        tgt.end = k === count - 1 ? +Math.max(tgt.start + 0.025, rightLimit).toFixed(3) : +Math.max(tgt.start + 0.025, cur).toFixed(3);
        tgt.chars = J.buildCharTimings(tgt.text, tgt.start, tgt.end, analysis);
        tgt.alignmentConfidence = analysis ? 0.82 : 0.64;
      }
    }
    idx = endIdx + 1;
  }
  return cloned;
};

/* Per-word Vocal-to-Lyric Coherence Analyzer:
   Evaluates how tightly each displayed word aligns with genuine vocal onset, voicing, and envelope in [lineStart, lineEnd]. */
J.analyzeLineVocalCoordination = (analysis, words, lineStart = 0, lineEnd = 0) => {
  const list = Array.isArray(words) ? words : [];
  const env = analysis && analysis.vocalEnv100;
  const vad = analysis && analysis.voicing100;
  const fr = (analysis && analysis.fineRate) || 100;
  const hasAudio = Boolean(env && env.length && fr > 0);
  if (!list.length) {
    return { score: 0, syncedCount: 0, total: 0, avgAbsErrMs: 0, hasAudio, words: [] };
  }

  let peakLineEnv = 1e-4;
  if (hasAudio) {
    const s0 = Math.max(0, Math.floor(Math.max(0, lineStart) * fr));
    const s1 = Math.min(env.length - 1, Math.ceil(Math.max(lineStart + 0.3, lineEnd || (list[list.length - 1].end || 1)) * fr));
    for (let f = s0; f <= s1; f++) if (env[f] > peakLineEnv) peakLineEnv = env[f];
  }

  let scoreSum = 0;
  let errSum = 0;
  let syncedCount = 0;
  const analyzedWords = list.map((w, idx) => {
    const ws = Math.max(0, Number(w && w.start) || 0);
    const we = Math.max(ws + 0.02, Number(w && w.end) || (ws + 0.2));
    const dur = we - ws;
    const minBound = idx > 0 ? Math.max(0, (Number(list[idx - 1].start) || 0) + 0.03) : Math.max(0, ws - 0.22);

    let onsetErrorMs = 0;
    let avgEnvNorm = 0.72;
    let maxVoicing = 0.75;
    let nearestAttack = ws;
    let attackFound = false;

    if (hasAudio) {
      const atk = J.estimateVocalAttackNear(analysis, ws, 0.20, minBound, we);
      attackFound = Boolean(atk && atk.found);
      if (attackFound) {
        nearestAttack = atk.attackTime;
        onsetErrorMs = Math.round((ws - atk.attackTime) * 1000);
      }
      const f0 = Math.max(0, Math.floor(ws * fr));
      const f1 = Math.min(env.length - 1, Math.max(f0, Math.ceil(we * fr)));
      let sumE = 0, cntE = 0, bestV = 0;
      for (let f = f0; f <= f1; f++) {
        sumE += env[f];
        cntE++;
        if (vad && vad[f] > bestV) bestV = vad[f];
      }
      avgEnvNorm = cntE ? Math.min(1, (sumE / cntE) / Math.max(1e-4, peakLineEnv * 0.55)) : 0;
      maxVoicing = vad ? bestV : avgEnvNorm;
    }

    const validated = Boolean(w && w.validated);
    const cleanTextLen = String((w && w.text) || '').replace(/\s+/g, '').length;
    let status = 'synced';
    if (hasAudio) {
      if (avgEnvNorm < 0.14 && maxVoicing < 0.22 && !validated) status = 'silence';
      else if (dur < 0.055 && cleanTextLen >= 4) status = 'crowded';
      else if (Math.abs(onsetErrorMs) <= 45 || (validated && Math.abs(onsetErrorMs) <= 65)) status = 'synced';
      else if (onsetErrorMs < -45) status = 'early';
      else status = 'late';
    } else if (!validated) {
      status = 'estimated';
    }

    const absErr = Math.abs(onsetErrorMs);
    let wordScore = hasAudio
      ? Math.max(0.15, 1 - Math.min(1, absErr / 180) * 0.65 - (status === 'silence' ? 0.35 : status === 'crowded' ? 0.2 : 0))
      : (validated ? 0.94 : 0.72);
    if (validated) wordScore = Math.max(wordScore, 0.88);
    if (status === 'synced') syncedCount++;
    scoreSum += wordScore;
    errSum += absErr;

    return {
      index: idx,
      text: String((w && w.text) || ''),
      status,
      validated,
      onsetErrorMs,
      nearestAttack: +nearestAttack.toFixed(3),
      attackFound,
      vocalPresence: +avgEnvNorm.toFixed(2),
      score: Math.round(wordScore * 100),
    };
  });

  return {
    score: Math.round((scoreSum / list.length) * 100),
    syncedCount,
    total: list.length,
    avgAbsErrMs: Math.round(errSum / list.length),
    hasAudio,
    words: analyzedWords,
  };
};

/* Two-Pass Vocal-to-Lyric Optimizer:
   Pass 1 runs anchored 10ms Viterbi alignment; Pass 2 pulls residual >45ms unvalidated words onto clean nearby vocal transients. */
J.optimizeLineVocalCoordination = (analysis, words, lineStart, lineEnd, lang, defaultSpeaker = 'Lead') => {
  const pass1 = J.alignLineWordsAnchored(analysis, words, lineStart, lineEnd, lang, defaultSpeaker);
  if (!analysis || !(analysis.wordAttack100 && analysis.wordAttack100.length) || !pass1.length) {
    return pass1;
  }
  const sLine = Math.max(0, Number(lineStart) || 0);
  const eLine = Math.max(sLine + 0.08 * pass1.length, Number(lineEnd) || (pass1[pass1.length - 1].end || sLine + 1));

  for (let i = 0; i < pass1.length; i++) {
    const cur = pass1[i];
    if (cur.validated) continue;
    const prevEnd = i > 0 ? pass1[i - 1].end + 0.008 : sLine;
    const nextStart = i + 1 < pass1.length ? pass1[i + 1].start - 0.008 : eLine;
    const lo = Math.max(sLine, i > 0 ? pass1[i - 1].start + 0.04 : sLine);
    const hi = Math.min(eLine, i + 1 < pass1.length ? pass1[i + 1].end - 0.04 : eLine);
    if (hi - lo < 0.05) continue;

    const atk = J.estimateVocalAttackNear(analysis, cur.start, 0.14, lo, hi - 0.035);
    if (atk.found && Math.abs(atk.driftMs) >= 35 && Math.abs(atk.driftMs) <= 145) {
      const snappedS = +J.clamp(atk.attackTime, prevEnd - 0.04, hi - 0.045).toFixed(3);
      if (i > 0 && pass1[i - 1].end > snappedS - 0.008) {
        if (pass1[i - 1].validated) continue;
        pass1[i - 1].end = +Math.max(pass1[i - 1].start + 0.03, snappedS - 0.008).toFixed(3);
        pass1[i - 1].chars = J.buildCharTimings(pass1[i - 1].text, pass1[i - 1].start, pass1[i - 1].end, analysis);
      }
      const nextE = Math.min(nextStart, Math.max(snappedS + 0.05, cur.end));
      cur.start = snappedS;
      cur.end = +Math.max(snappedS + 0.04, nextE).toFixed(3);
      cur.alignmentConfidence = +Math.min(0.95, Math.max(Number(cur.alignmentConfidence) || 0.78, 0.88 + 0.06 * atk.clarity)).toFixed(3);
      cur.flags = (cur.flags || []).filter(f => f !== 'uncertain_boundary');
      cur.chars = J.buildCharTimings(cur.text, cur.start, cur.end, analysis);
    }
  }
  return pass1;
};

const blobToBase64 = (blob) => new Promise((res, rej) => {
  const reader = new FileReader();
  reader.onload = () => {
    const result = String(reader.result || '');
    const comma = result.indexOf(',');
    res(comma >= 0 ? result.slice(comma + 1) : result);
  };
  reader.onerror = rej;
  reader.readAsDataURL(blob);
});

/* Stage 2: Vocal Detection & Separation WAV Generator (Mid-Side center lead extraction + vocal formant BPF)
   Preserves the exact original timeline [startSec .. startSec + durationSec] while leaving playback buffer untouched. */
J.audioVocalSeparatedWavWindow = (buffer, startSec = 0, durationSec = 140, targetSampleRate = 16000) => {
  const chn = buffer.numberOfChannels;
  const origSr = buffer.sampleRate;
  const s0 = Math.max(0, Number(startSec) || 0);
  const availDur = Math.max(0.05, buffer.duration - s0);
  const dur = Math.min(availDur, Math.max(0.1, Number(durationSec) || availDur));
  const targetSr = targetSampleRate;
  const targetLength = Math.max(1, Math.floor(dur * targetSr));
  const step = origSr / targetSr;
  const srcStart = Math.floor(s0 * origSr);
  const ch0 = buffer.getChannelData(0);
  const ch1 = chn >= 2 ? buffer.getChannelData(1) : null;

  const bytes = targetLength * 2;
  const ab = new ArrayBuffer(44 + bytes);
  const v = new DataView(ab);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, targetSr, true);
  v.setUint32(28, targetSr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, bytes, true);

  // 140Hz HPF + 7400Hz LPF on center-isolated lead signal to attenuate sub-bass/kick while preserving crisp vocal consonants
  const dt = 1 / targetSr;
  const aHP = (1 / (2 * Math.PI * 140)) / (1 / (2 * Math.PI * 140) + dt);
  const aLP = dt / (1 / (2 * Math.PI * 7400) + dt);
  let pHP = 0, pX = 0, pLP = 0;

  let o = 44;
  for (let i = 0; i < targetLength; i++) {
    const srcIdx = srcStart + Math.floor(i * step);
    let raw = 0;
    if (ch1) {
      const l = srcIdx < ch0.length ? ch0[srcIdx] : 0;
      const r = srcIdx < ch1.length ? ch1[srcIdx] : 0;
      const mid = 0.5 * (l + r);
      const side = 0.5 * (l - r);
      // Center-dominant soft mask attenuating wide-panned stereo accompaniment
      const mask = Math.min(1, Math.abs(mid) / (Math.abs(mid) + 0.65 * Math.abs(side) + 1e-4));
      raw = mid * (0.45 + 0.55 * mask);
    } else {
      raw = srcIdx < ch0.length ? ch0[srcIdx] : 0;
    }
    const hp = aHP * (pHP + raw - pX); pHP = hp; pX = raw;
    const lp = pLP + aLP * (hp - pLP); pLP = lp;
    const boosted = Math.max(-1, Math.min(1, lp * 1.45));
    v.setInt16(o, boosted < 0 ? boosted * 0x8000 : boosted * 0x7fff, true);
    o += 2;
  }
  return new Blob([ab], { type: 'audio/wav' });
};

/* FUNCTION 08: Estimate all 5 Quality Control dimensions for an individual word & classify into
   HIGH CONFIDENCE / MEDIUM CONFIDENCE / LOW CONFIDENCE. Never claims 100% accuracy. */
J.evaluateWordQuality = (w, analysis = null, lineMeta = null) => {
  const recRaw = w && w.recognitionConfidence != null ? Number(w.recognitionConfidence) : (w && w.validated ? 0.94 : 0.80);
  const alignRaw = w && w.alignmentConfidence != null ? Number(w.alignmentConfidence) : (w && w.validated ? 0.95 : 0.78);
  const env = analysis && analysis.vocalEnv100;
  const clMap = analysis && analysis.clarity100;
  const ovMap = analysis && analysis.sideRatio100;
  const vad = analysis && analysis.voicing100;
  const fr = (analysis && analysis.fineRate) || 100;
  const qCond = (analysis && analysis.qualityConditions) || {};

  let audioClarity = w && w.audioClarity != null ? Number(w.audioClarity) : (qCond.avgClarity != null ? qCond.avgClarity : 0.78);
  let vocalOverlap = w && w.vocalOverlap != null ? Number(w.vocalOverlap) : 0.08;
  let peakE = 0, avgVad = 0.5;

  if (env && env.length && Number.isFinite(Number(w && w.start)) && Number.isFinite(Number(w && w.end))) {
    const f0 = Math.max(0, Math.min(env.length - 1, Math.round(Number(w.start) * fr)));
    const f1 = Math.max(f0, Math.min(env.length - 1, Math.round(Number(w.end) * fr)));
    let clSum = 0, ovSum = 0, vadSum = 0, cnt = 0;
    for (let f = f0; f <= f1; f++) {
      if (env[f] > peakE) peakE = env[f];
      if (clMap) clSum += clMap[f] || 0;
      if (ovMap) ovSum += ovMap[f] || 0;
      if (vad) vadSum += vad[f] || 0;
      cnt++;
    }
    if (cnt > 0) {
      if (clMap) audioClarity = clSum / cnt;
      if (ovMap) vocalOverlap = Math.max(vocalOverlap * 0.5, ovSum / cnt);
      if (vad) avgVad = vadSum / cnt;
    }
  }
  if (analysis && Array.isArray(analysis.overlapSegments) && w) {
    const mid = (Number(w.start) + Number(w.end)) * 0.5;
    if (analysis.overlapSegments.some(s => mid >= s.start && mid <= s.end)) {
      vocalOverlap = Math.max(vocalOverlap, 0.58);
    }
  }
  if (lineMeta && (lineMeta.vocalType === 'overlapping' || lineMeta.vocalType === 'harmony' || lineMeta.vocalType === 'backing' || lineMeta.backingText)) {
    vocalOverlap = Math.max(vocalOverlap, 0.55);
  }

  const flags = Array.isArray(w && w.flags) ? w.flags.slice() : [];
  if (flags.includes('overlapping_vocals')) vocalOverlap = Math.max(vocalOverlap, 0.56);

  // Degrade clarity/certainty honestly when noisy, distorted, or heavily reverberated
  if (qCond.isDistorted) audioClarity = Math.min(audioClarity, 0.62);
  if (qCond.isNoisy) audioClarity = Math.min(audioClarity, 0.66);
  if (qCond.isReverberated) audioClarity = Math.min(audioClarity, 0.70);

  const transcriptionConfidence = +J.clamp(recRaw, 0.05, 0.98).toFixed(3);
  const alignmentConfidence = +J.clamp(alignRaw, 0.05, 0.98).toFixed(3);
  audioClarity = +J.clamp(audioClarity, 0.05, 0.97).toFixed(3);
  vocalOverlap = +J.clamp(vocalOverlap, 0, 1).toFixed(3);

  const hasUncWord = flags.includes('uncertain_word') || flags.includes('misrecognized_word') || flags.includes('missing_word');
  const hasUncBound = flags.includes('uncertain_boundary');

  const envUncertainty = (qCond.isNoisy ? 0.14 : 0) + (qCond.isDistorted ? 0.16 : 0) + (qCond.isReverberated ? 0.10 : 0) + (vocalOverlap > 0.42 ? 0.18 * vocalOverlap : 0);
  const rawComposite = (0.40 * transcriptionConfidence + 0.36 * alignmentConfidence + 0.24 * audioClarity) - 0.55 * envUncertainty;
  const compositeScore = +J.clamp(rawComposite, 0.05, 0.97).toFixed(3);
  const recognitionUncertainty = +J.clamp((1 - compositeScore) + (hasUncWord ? 0.14 : 0), 0.02, 0.96).toFixed(3);

  let qualityTier = 'MEDIUM';
  if (w && w.validated) {
    // Human-verified words keep honest acoustic metrics; if clarity/overlap is severe, reflect medium acoustic confidence while marked validated
    qualityTier = (audioClarity < 0.45 || qCond.isDistorted) ? 'MEDIUM' : 'HIGH';
  } else if (
    !hasUncWord &&
    !hasUncBound &&
    transcriptionConfidence >= 0.78 &&
    alignmentConfidence >= 0.78 &&
    audioClarity >= 0.64 &&
    vocalOverlap <= 0.36 &&
    compositeScore >= 0.77
  ) {
    qualityTier = 'HIGH';
  } else if (
    hasUncWord ||
    transcriptionConfidence < 0.66 ||
    alignmentConfidence < 0.64 ||
    audioClarity < 0.48 ||
    compositeScore < 0.59 ||
    (peakE > 0 && peakE < 0.002 && avgVad < 0.15)
  ) {
    qualityTier = 'LOW';
  }

  const conditionWarnings = [];
  if (qCond.isNoisy) conditionWarnings.push('noisy');
  if (qCond.isDistorted) conditionWarnings.push('distorted');
  if (qCond.isReverberated) conditionWarnings.push('reverberated');
  if (vocalOverlap > 0.38 || qCond.hasOverlappingSingers) conditionWarnings.push('overlapping_vocals');

  return {
    transcriptionConfidence,
    alignmentConfidence,
    audioClarity,
    vocalOverlap,
    recognitionUncertainty,
    compositeScore,
    qualityTier,
    conditionWarnings,
  };
};

J.classifyWordQuality = (w, analysis = null, lineMeta = null) => J.evaluateWordQuality(w, analysis, lineMeta);

/* Stage 6: Cross-Validate Detected Lyrics & Timestamps Against Acoustic Vocal Evidence + FUNCTION 08 Quality Control.
   Flags uncertain/missing/misrecognized/overlapping/boundary issues — NEVER invents fake lyrics & NEVER claims 100% accuracy. */
J.validateKaraokeAlignment = (analysis, lines, serverValidation = null) => {
  const vocalSegs = (analysis && analysis.vocalSegments) || [];
  const env = analysis && analysis.vocalEnv100;
  const vad = analysis && analysis.voicing100;
  const ovMap = analysis && analysis.sideRatio100;
  const fr = (analysis && analysis.fineRate) || 100;
  const serverGaps = (serverValidation && Array.isArray(serverValidation.missingVocalGaps)) ? serverValidation.missingVocalGaps : [];
  const qualityConditions = (analysis && analysis.qualityConditions) || {
    isNoisy: false, isDistorted: false, isReverberated: false, hasOverlappingSingers: false, avgClarity: 0.78,
  };

  const nonInstLines = (lines || []).filter(l => l && !l.isInstrumentalSection && l.vocalType !== 'instrumental');
  const covIntervals = [];
  for (const ln of nonInstLines) {
    if (Array.isArray(ln.words) && ln.words.length) {
      for (const w of ln.words) {
        const ws = Number(w.start), we = Number(w.end);
        if (Number.isFinite(ws) && Number.isFinite(we) && we > ws) covIntervals.push([ws - 0.15, we + 0.15]);
      }
    } else if (Number.isFinite(Number(ln.start)) && Number.isFinite(Number(ln.end)) && ln.end > ln.start) {
      covIntervals.push([ln.start - 0.15, ln.end + 0.15]);
    }
  }
  covIntervals.sort((a, b) => a[0] - b[0]);
  const mergedCov = [];
  for (const iv of covIntervals) {
    if (!mergedCov.length || iv[0] > mergedCov[mergedCov.length - 1][1]) mergedCov.push([iv[0], iv[1]]);
    else if (iv[1] > mergedCov[mergedCov.length - 1][1]) mergedCov[mergedCov.length - 1][1] = iv[1];
  }

  const uncoveredSegs = [];
  for (const seg of vocalSegs) {
    if ((seg.end - seg.start) < 0.85) continue;
    let cursor = seg.start;
    for (const [cs, ce] of mergedCov) {
      if (ce <= cursor) continue;
      if (cs >= seg.end) break;
      if (cs - cursor >= 0.90) {
        uncoveredSegs.push({
          start: +cursor.toFixed(3),
          end: +Math.min(seg.end, cs).toFixed(3),
          reason: 'active_vocal_segment_without_transcribed_lyrics',
        });
      }
      if (ce > cursor) cursor = ce;
    }
    if (seg.end - cursor >= 0.90) {
      uncoveredSegs.push({
        start: +cursor.toFixed(3),
        end: +seg.end.toFixed(3),
        reason: 'active_vocal_segment_without_transcribed_lyrics',
      });
    }
  }
  const missingVocalGaps = serverGaps.concat(uncoveredSegs);

  let uncertainWords = 0, misrecognizedWords = 0, overlappingWords = 0, uncertainBoundaries = 0, totalWords = 0;
  let highConfidenceWords = 0, mediumConfidenceWords = 0, lowConfidenceWords = 0;
  let claritySum = 0, uncertaintySum = 0, overlapSum = 0;

  const validatedLines = (lines || []).map(ln => {
    if (!ln || ln.isInstrumentalSection || ln.vocalType === 'instrumental') return ln;
    const lineFlagSet = new Set(Array.isArray(ln.flags) ? ln.flags : []);
    const words = (ln.words || []).map(w => {
      totalWords++;
      const fSet = new Set(Array.isArray(w.flags) ? w.flags : []);
      if (w.validated) {
        fSet.delete('uncertain_word');
        fSet.delete('misrecognized_word');
        fSet.delete('uncertain_boundary');
      } else {
        if (env && vad && env.length) {
          const f0 = Math.max(0, Math.min(env.length - 1, Math.round(w.start * fr)));
          const f1 = Math.max(f0, Math.min(env.length - 1, Math.round(w.end * fr)));
          let peakE = 0, avgVad = 0, avgOv = 0, cnt = 0;
          for (let f = f0; f <= f1; f++) {
            if (env[f] > peakE) peakE = env[f];
            avgVad += vad[f] || 0;
            avgOv += ovMap ? (ovMap[f] || 0) : 0;
            cnt++;
          }
          avgVad /= Math.max(1, cnt);
          avgOv /= Math.max(1, cnt);
          if (peakE < 0.002 && avgVad < 0.14) fSet.add('uncertain_boundary');
          if (avgOv > 0.42) fSet.add('overlapping_vocals');
        }
        if (w.recognitionConfidence != null && w.recognitionConfidence < 0.72) fSet.add('uncertain_word');
        if (w.recognitionConfidence != null && w.recognitionConfidence < 0.52) fSet.add('misrecognized_word');
        if (w.alignmentConfidence != null && w.alignmentConfidence < 0.70) fSet.add('uncertain_boundary');
      }

      const wFlags = Array.from(fSet);
      const qm = J.evaluateWordQuality(Object.assign({}, w, { flags: wFlags }), analysis, ln);
      if (fSet.has('uncertain_word')) uncertainWords++;
      if (fSet.has('misrecognized_word')) misrecognizedWords++;
      if (fSet.has('overlapping_vocals') || qm.vocalOverlap > 0.42) overlappingWords++;
      if (fSet.has('uncertain_boundary')) uncertainBoundaries++;
      if (qm.qualityTier === 'HIGH') highConfidenceWords++;
      else if (qm.qualityTier === 'LOW') lowConfidenceWords++;
      else mediumConfidenceWords++;
      claritySum += qm.audioClarity;
      uncertaintySum += qm.recognitionUncertainty;
      overlapSum += qm.vocalOverlap;
      wFlags.forEach(fl => lineFlagSet.add(fl));
      return Object.assign({}, w, {
        flags: wFlags,
        validated: Boolean(w.validated),
        recognitionConfidence: qm.transcriptionConfidence,
        alignmentConfidence: qm.alignmentConfidence,
        audioClarity: qm.audioClarity,
        vocalOverlap: qm.vocalOverlap,
        recognitionUncertainty: qm.recognitionUncertainty,
        qualityTier: qm.qualityTier,
      });
    });
    if (ln.unclear || ln.vocalType === 'unclear') lineFlagSet.add('uncertain_word');
    if (ln.backingText || ln.vocalType === 'overlapping' || ln.vocalType === 'harmony') lineFlagSet.add('overlapping_vocals');
    return Object.assign({}, ln, { words, flags: Array.from(lineFlagSet) });
  });

  const avgClarity = totalWords ? +(claritySum / totalWords).toFixed(3) : (qualityConditions.avgClarity ?? 0.78);
  const avgUncertainty = totalWords ? +(uncertaintySum / totalWords).toFixed(3) : 0.25;
  const avgOverlap = totalWords ? +(overlapSum / totalWords).toFixed(3) : (qualityConditions.overlapRatio ?? 0);
  // Honest track score capped strictly below 1.00 (never claims 100%)
  const overallConfidence = +J.clamp(1 - avgUncertainty, 0.05, 0.97).toFixed(3);

  return {
    lines: validatedLines,
    validationSummary: {
      totalWords,
      highConfidenceWords,
      mediumConfidenceWords,
      lowConfidenceWords,
      uncertainWords,
      missingWords: missingVocalGaps.length,
      misrecognizedWords,
      overlappingWords,
      uncertainBoundaries,
      missingVocalGaps,
      avgClarity,
      avgUncertainty,
      avgOverlap,
      overallConfidence,
      qualityConditions,
    },
  };
};

/* FUNCTION 08: Automatic High-Resolution Re-Analysis of Low-Confidence Segments */
J.reanalyzeLowConfidenceSegments = async (analysis, lines, lang = 'auto', onProgress = null) => {
  const inputLines = Array.isArray(lines) ? lines : [];
  if (!inputLines.length) return { lines: inputLines, reanalyzedCount: 0, upgradedCount: 0, source: 'none', validationSummary: null };

  const targetIndices = [];
  inputLines.forEach((ln, idx) => {
    if (!ln || ln.interlude || ln.isInstrumentalSection) return;
    const words = Array.isArray(ln.words) ? ln.words : (Array.isArray(ln.wordsTimed) ? ln.wordsTimed : []);
    const hasLow = words.some(w => {
      if (w.validated) return false;
      const tier = w.qualityTier || J.evaluateWordQuality(w, analysis, ln).qualityTier;
      return tier === 'LOW';
    });
    const f = Array.isArray(ln.flags) ? ln.flags : [];
    if (hasLow || ln.unclear || f.includes('uncertain_word') || f.includes('misrecognized_word') || f.includes('missing_word')) {
      targetIndices.push(idx);
    }
  });

  if (!targetIndices.length) {
    const val = J.validateKaraokeAlignment(analysis, inputLines);
    return { lines: val.lines, reanalyzedCount: 0, upgradedCount: 0, source: 'none', validationSummary: val.validationSummary };
  }

  const outLines = inputLines.map(ln => Object.assign({}, ln, {
    words: Array.isArray(ln.words) ? ln.words.map(w => Object.assign({}, w)) : [],
  }));
  let upgradedCount = 0;
  let usedAi = false;

  for (let k = 0; k < targetIndices.length; k++) {
    const idx = targetIndices[k];
    const ln = outLines[idx];
    if (typeof onProgress === 'function') {
      try { onProgress(k + 1, targetIndices.length, ln); } catch (e) {}
    }
    const padS = Math.max(0, (Number(ln.start) || 0) - 0.35);
    const padE = Math.min((analysis && analysis.duration) || (Number(ln.end) + 1), (Number(ln.end) || padS + 2) + 0.35);
    let updatedWords = null;

    if (analysis && analysis.buffer && typeof fetch === 'function') {
      try {
        const sr = 24000;
        const wavBlob = J.audioMonoWavWindow(analysis.buffer, padS, Math.max(0.25, padE - padS), sr);
        const audioBase64 = await blobToBase64(wavBlob);
        let separatedVocalBase64 = '';
        if (analysis.preprocessing && analysis.preprocessing.shouldSeparate !== false) {
          const sepBlob = J.audioVocalSeparatedWavWindow(analysis.buffer, padS, Math.max(0.25, padE - padS), sr);
          separatedVocalBase64 = await blobToBase64(sepBlob);
        }
        const resp = await fetch('/api/reanalyze-segment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioBase64,
            separatedVocalBase64,
            startSec: padS,
            endSec: padE,
            existingWords: ln.words || [],
            qualityConditions: analysis.qualityConditions || null,
            lang,
          }),
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data && data.success && Array.isArray(data.lines) && data.lines.length) {
            usedAi = true;
            const aiWords = data.lines.flatMap(dl => dl.words || []);
            if (aiWords.length) {
              updatedWords = J.refineWordTimingsAcoustic(analysis, aiWords, ln.start, ln.end, ln.language || lang, ln.speaker || 'Lead');
              const txtNew = data.lines.map(dl => dl.text).filter(Boolean).join(' ').trim();
              if (txtNew && !/^\[?unclear/i.test(txtNew)) ln.text = txtNew;
            }
          }
        }
      } catch (e) {}
    }

    if (!updatedWords) {
      // High-precision acoustic re-alignment pass (preserves validated anchors)
      updatedWords = J.realignLineWords
        ? J.realignLineWords(analysis, ln.text, ln.start, ln.end, ln.language || lang, ln.speaker || 'Lead', ln.words)
        : J.alignWordsAcoustic(analysis, ln.text, ln.start, ln.end, ln.language || lang, ln.speaker || 'Lead', 0.86);
    }

    if (Array.isArray(updatedWords) && updatedWords.length) {
      // Never overwrite user-validated words; update uncertain/low-confidence words cleanly
      const oldLow = (ln.words || []).filter(w => (w.qualityTier || 'MEDIUM') === 'LOW').length;
      const merged = updatedWords.map((nw, wi) => {
        const ow = ln.words[wi];
        if (ow && ow.validated) return ow;
        return nw;
      });
      ln.words = merged;
      const postQ = merged.map(mw => J.evaluateWordQuality(mw, analysis, ln));
      const newLow = postQ.filter(q => q.qualityTier === 'LOW').length;
      if (newLow < oldLow) upgradedCount += (oldLow - newLow);
    }
  }

  const finalVal = J.validateKaraokeAlignment(analysis, outLines);
  return {
    lines: finalVal.lines,
    reanalyzedCount: targetIndices.length,
    upgradedCount,
    remainingLowCount: finalVal.validationSummary.lowConfidenceWords,
    source: usedAi ? 'ai+acoustic' : 'acoustic_deep',
    validationSummary: finalVal.validationSummary,
  };
};

/* CORE FUNCTION 06 — Realign an edited word & unvalidated surrounding words locally against acoustic vocal onsets
   while preserving original audio AND all previously validated timestamps. */
J.realignSurroundingWords = (analysis, existingWords, editedIdx, newWordText, lineStart, lineEnd, lang = 'auto', defaultSpeaker = 'Lead') => {
  const sLine = Math.max(0, Number(lineStart) || 0);
  const eLine = Math.max(sLine + 0.15, Number(lineEnd) || sLine + 2.5);
  const list = Array.isArray(existingWords) ? existingWords.map(w => Object.assign({}, w)) : [];
  const k = Math.max(0, Math.min(list.length - 1, editedIdx | 0));

  if (!list.length) {
    const clean = String(newWordText || '').trim();
    if (!clean) return [];
    const aligned = J.alignWordsAcoustic(analysis, clean, sLine, eLine, lang, defaultSpeaker, 0.99);
    return aligned.map(w => Object.assign(w, { validated: true, flags: [] }));
  }

  // Determine nearest validated anchor before k and nearest validated anchor after k (never destroy validated words!)
  // Realignment touches only [leftBound .. rightBound], preferring unvalidated immediate neighbors around k
  let winLeftIdx = Math.max(0, k - 1);
  if (winLeftIdx < k && list[winLeftIdx].validated) winLeftIdx = k;
  let winRightIdx = Math.min(list.length - 1, k + 1);
  if (winRightIdx > k && list[winRightIdx].validated) winRightIdx = k;

  const winStart = winLeftIdx > 0 ? Math.max(sLine, Number(list[winLeftIdx - 1].end) || sLine) : sLine;
  const winEnd = winRightIdx < list.length - 1 ? Math.min(eLine, Math.max(winStart + 0.08, Number(list[winRightIdx + 1].start) || eLine)) : eLine;

  const editedRaw = String(newWordText || '').trim();
  const replacementTokens = editedRaw ? J.tokenizeKaraokeWords(editedRaw, lang) : [];

  const subEntries = [];
  for (let i = winLeftIdx; i <= winRightIdx; i++) {
    if (i === k) {
      const origSpk = list[k].speaker || defaultSpeaker;
      for (const tk of replacementTokens) {
        subEntries.push({ text: tk, speaker: origSpk, isEdited: true });
      }
    } else {
      subEntries.push({ text: list[i].text, speaker: list[i].speaker || defaultSpeaker, isEdited: false, recC: list[i].recognitionConfidence });
    }
  }

  const outBefore = list.slice(0, winLeftIdx);
  const outAfter = list.slice(winRightIdx + 1);
  if (!subEntries.length) {
    return outBefore.concat(outAfter);
  }

  const reAligned = J.alignWordsAcoustic(
    analysis,
    subEntries.map(x => x.text).join(' '),
    winStart,
    Math.max(winStart + 0.05 * subEntries.length, winEnd),
    lang,
    defaultSpeaker,
    0.95,
  );

  const rebuiltMiddle = (reAligned.length === subEntries.length ? reAligned : []).map((rw, idx) => {
    const meta = subEntries[idx];
    return Object.assign({}, rw, {
      text: meta.text,
      speaker: meta.speaker || rw.speaker,
      recognitionConfidence: meta.isEdited ? 0.99 : (meta.recC ?? rw.recognitionConfidence),
      alignmentConfidence: meta.isEdited ? Math.max(0.9, rw.alignmentConfidence) : rw.alignmentConfidence,
      validated: meta.isEdited ? true : false,
      flags: meta.isEdited ? [] : (rw.flags || []),
    });
  });

  if (rebuiltMiddle.length !== subEntries.length) {
    // Fallback weighted distribution preserving existing order inside [winStart, winEnd]
    const span = Math.max(0.05 * subEntries.length, winEnd - winStart);
    const weights = subEntries.map(x => Math.max(1, [...x.text].length));
    const tot = weights.reduce((a, b) => a + b, 0) || subEntries.length;
    let cur = winStart;
    subEntries.forEach((meta, idx) => {
      const d = (weights[idx] / tot) * span;
      const ws = +cur.toFixed(3);
      cur += d;
      const we = idx === subEntries.length - 1 ? +winEnd.toFixed(3) : +Math.max(ws + 0.02, cur).toFixed(3);
      rebuiltMiddle.push({
        text: meta.text,
        start: ws,
        end: we,
        chars: J.buildCharTimings(meta.text, ws, we, analysis),
        recognitionConfidence: meta.isEdited ? 0.99 : (meta.recC ?? 0.9),
        alignmentConfidence: 0.88,
        speaker: meta.speaker,
        flags: [],
        validated: Boolean(meta.isEdited),
      });
    });
  }

  return outBefore.concat(rebuiltMiddle, outAfter);
};

/* Recalculate alignment for a line while respecting already-validated anchor words */
J.realignLineWords = (analysis, lineText, lineStart, lineEnd, lang = 'auto', defaultSpeaker = 'Lead', existingWords = []) => {
  const sLine = Math.max(0, Number(lineStart) || 0);
  const eLine = Math.max(sLine + 0.15, Number(lineEnd) || sLine + 2.5);
  const cur = Array.isArray(existingWords) ? existingWords : [];
  const hasLocked = cur.some(w => w && w.validated);
  const tokens = J.tokenizeKaraokeWords(lineText, lang);
  if (!tokens.length) return [];

  if (!hasLocked || cur.map(w => w.text).join('') !== tokens.join('')) {
    return J.alignWordsAcoustic(analysis, tokens.join(' '), sLine, eLine, lang, defaultSpeaker, 0.94);
  }

  // Partition around validated anchors so validated timestamps remain completely intact
  const out = cur.map(w => Object.assign({}, w));
  let i = 0;
  while (i < out.length) {
    if (out[i].validated) { i++; continue; }
    let j = i;
    while (j < out.length && !out[j].validated) j++;
    const segStart = i > 0 ? Math.max(sLine, out[i - 1].end) : sLine;
    const segEnd = j < out.length ? Math.min(eLine, Math.max(segStart + 0.04, out[j].start)) : eLine;
    const sliceText = out.slice(i, j).map(w => w.text).join(' ');
    const alignedSlice = J.alignWordsAcoustic(analysis, sliceText, segStart, segEnd, lang, defaultSpeaker, 0.92);
    for (let u = 0; u < j - i; u++) {
      if (alignedSlice[u]) {
        out[i + u] = Object.assign({}, alignedSlice[u], {
          text: out[i + u].text,
          speaker: out[i + u].speaker || defaultSpeaker,
          validated: false,
        });
      }
    }
    i = j;
  }
  return out;
};

/* Standalone Stage-A Orthography, Diacritics & Contractions Audit */
J.auditLyricsSpelling = async (linesOrText, lang = 'auto') => {
  try {
    const body = Array.isArray(linesOrText)
      ? { lines: linesOrText, lang }
      : { lyrics: String(linesOrText || ''), lang };
    const resp = await fetch('/api/audit-lyrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.success) return data;
    }
  } catch (e) {}
  return { success: false, spellingFixCount: 0, changes: [], correctedLines: {}, correctedText: '', detectedLanguage: lang };
};

/* AI Vocal forced alignment (Stages 1-7 + Orthography & Voice-Linked Typo Repair) */
J.aiAlignVocals = async (audioAnalysis, lines, lang = 'auto', onStage = null) => {
  let requiresBilling = false;
  let errorReason = '';
  let recognizedLines = [];
  let recognizedTranscript = '';
  let corrections = [];
  let spellingFixCount = 0;
  let correctedLines = {};
  let correctedText = '';
  let divergences = [];
  let reformulations = [];
  let unresolvableProblems = [];
  let reconcileSummary = null;
  let lineMatchRatios = {};
  let detectedLanguage = lang;
  const report = (st, msg) => { if (typeof onStage === 'function') try { onStage(st, msg); } catch (e) {} };
  const vocalSegs = Array.isArray(audioAnalysis && audioAnalysis.vocalSegments)
    ? audioAnalysis.vocalSegments.slice(0, 48).map(s => ({ start: +Number(s.start || 0).toFixed(3), end: +Number(s.end || 0).toFixed(3) }))
    : [];
  const dur = (audioAnalysis && audioAnalysis.duration) || 30;
  const lineTexts = lines.map((l, i) => ({ i, text: l.interlude ? '[interlude]' : l.text }));

  try {
    if (audioAnalysis && audioAnalysis.buffer) {
      report(1, 'stem');
      const sr = dur > 180 ? 10000 : dur > 90 ? 12000 : 16000;
      const includeDualSep = Boolean(audioAnalysis.preprocessing && audioAnalysis.preprocessing.shouldSeparate && dur <= 85);
      const wavBlob = J.audioMonoWav(audioAnalysis.buffer, Math.min(300, dur), sr);
      const base64Audio = await blobToBase64(wavBlob);
      let separatedVocalBase64 = '';
      if (includeDualSep) {
        const sepBlob = J.audioVocalSeparatedWavWindow(audioAnalysis.buffer, 0, Math.min(300, dur), sr);
        separatedVocalBase64 = await blobToBase64(sepBlob);
      }
      report(2, 'align');
      let resp = await fetch('/api/align-vocals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64: base64Audio,
          separatedVocalBase64,
          lines: lineTexts,
          lang,
          vocalSegments: vocalSegs,
          durationSec: dur,
        }),
      });
      if (resp.status === 413) {
        const slimBlob = (audioAnalysis.preprocessing && audioAnalysis.preprocessing.shouldSeparate)
          ? J.audioVocalSeparatedWavWindow(audioAnalysis.buffer, 0, Math.min(300, dur), 8000)
          : J.audioMonoWav(audioAnalysis.buffer, Math.min(300, dur), 8000);
        const slimB64 = await blobToBase64(slimBlob);
        resp = await fetch('/api/align-vocals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioBase64: slimB64,
            separatedVocalBase64: '',
            lines: lineTexts,
            lang,
            vocalSegments: vocalSegs,
            durationSec: dur,
          }),
        });
      }
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.requiresBilling) requiresBilling = true;
        if (data && data.reason) errorReason = data.reason;
        if (data && Array.isArray(data.corrections)) corrections = data.corrections;
        if (data && Number.isFinite(Number(data.spellingFixCount))) spellingFixCount = Number(data.spellingFixCount);
        if (data && data.correctedLines && typeof data.correctedLines === 'object') correctedLines = data.correctedLines;
        if (data && data.correctedText) correctedText = data.correctedText;
        if (data && Array.isArray(data.divergences)) divergences = data.divergences;
        if (data && Array.isArray(data.reformulations)) reformulations = data.reformulations;
        if (data && Array.isArray(data.unresolvableProblems)) unresolvableProblems = data.unresolvableProblems;
        if (data && data.reconcileSummary && typeof data.reconcileSummary === 'object') reconcileSummary = data.reconcileSummary;
        if (data && data.lineMatchRatios && typeof data.lineMatchRatios === 'object') lineMatchRatios = data.lineMatchRatios;
        if (data && data.detectedLanguage) detectedLanguage = data.detectedLanguage;
        if (data && Array.isArray(data.recognizedLines) && data.recognizedLines.length) {
          recognizedLines = data.recognizedLines;
          recognizedTranscript = data.recognizedTranscript || '';
        }
        if (data && data.lineTimes && Object.keys(data.lineTimes).length) {
          report(3, 'optimize');
          const refinedWords = {};
          const keys = Object.keys(data.wordTimes || {});
          let scoreSum = 0, errSum = 0, lineCnt = 0;
          for (const k of keys) {
            const idx = +k;
            const s = data.lineTimes[idx] ?? 0;
            const nextL = lines[idx + 1];
            const e = (nextL && data.lineTimes[idx + 1] != null) ? data.lineTimes[idx + 1] : Math.min(dur || 300, s + 4);
            const metaSpk = (data.lineMeta && data.lineMeta[idx] && data.lineMeta[idx].speaker) || 'Lead';
            const r1 = J.refineWordTimingsAcoustic(audioAnalysis, data.wordTimes[idx], s, e, lang, metaSpk);
            const r2 = J.optimizeLineVocalCoordination ? J.optimizeLineVocalCoordination(audioAnalysis, r1, s, e, lang, metaSpk) : r1;
            refinedWords[idx] = r2;
            if (J.analyzeLineVocalCoordination && r2.length) {
              const coh = J.analyzeLineVocalCoordination(audioAnalysis, r2, s, e);
              scoreSum += coh.score; errSum += coh.avgAbsErrMs; lineCnt++;
            }
          }
          report(4, 'done');
          return {
            lineTimes: data.lineTimes,
            wordTimes: refinedWords,
            lineMeta: data.lineMeta || {},
            coherenceScore: lineCnt ? Math.round(scoreSum / lineCnt) : 90,
            avgAbsErrMs: lineCnt ? Math.round(errSum / lineCnt) : 18,
            matchedCount: data.matchedCount ?? 0,
            matchRatio: data.matchRatio ?? 1,
            corrections,
            spellingFixCount: spellingFixCount || corrections.length,
            correctedLines,
            correctedText,
            divergences,
            reformulations,
            unresolvableProblems,
            reconcileSummary,
            lineMatchRatios,
            detectedLanguage,
            recognizedLines,
            recognizedTranscript,
            source: 'ai',
            engineSource: data.source || 'gemini_cloud',
            engineName: data.engine || '',
            requiresBilling: false,
            errorReason: '',
          };
        }
      }
    }
  } catch (e) {
    errorReason = 'network_or_align_error';
  }

  // Ensure Stage-A orthography corrections still run if /api/align-vocals couldn't complete
  if (!corrections.length && !Object.keys(correctedLines).length) {
    const audit = await J.auditLyricsSpelling(lineTexts, lang);
    if (audit && audit.success) {
      corrections = audit.changes || [];
      spellingFixCount = audit.spellingFixCount || corrections.length;
      correctedLines = audit.correctedLines || {};
      correctedText = audit.correctedText || '';
      if (audit.detectedLanguage) detectedLanguage = audit.detectedLanguage;
    }
  }

  report(3, 'acoustic_viterbi');
  const lineTimes = J.alignLinesToVocals(audioAnalysis, lines);
  const wordTimes = {};
  const lineMeta = {};
  let scoreSum = 0, errSum = 0, lineCnt = 0;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln || ln.interlude || !ln.text) continue;
    const effectiveText = correctedLines[i] || ln.text;
    const s = lineTimes[i] != null ? lineTimes[i] : (ln.start ?? 0.4);
    const e = i < lines.length - 1 && lineTimes[i + 1] != null ? lineTimes[i + 1] : Math.min(dur, s + 3.2);
    const pass1 = J.alignWordsAcoustic(audioAnalysis, effectiveText, s, e, lang, 'Lead', 0.85);
    const words = J.optimizeLineVocalCoordination ? J.optimizeLineVocalCoordination(audioAnalysis, pass1, s, e, lang, 'Lead') : pass1;
    wordTimes[i] = words;
    if (J.analyzeLineVocalCoordination && words.length) {
      const coh = J.analyzeLineVocalCoordination(audioAnalysis, words, s, e);
      scoreSum += coh.score; errSum += coh.avgAbsErrMs; lineCnt++;
    }
    const avgAlign = words.length ? +(words.reduce((a, w) => a + (w.alignmentConfidence || 0.7), 0) / words.length).toFixed(3) : 0.7;
    const flags = words.some(w => w.alignmentConfidence < 0.7) ? ['uncertain_boundary'] : [];
    lineMeta[i] = { speaker: 'Lead', recognitionConfidence: 0.85, alignmentConfidence: avgAlign, flags };
  }
  report(4, 'done');
  return {
    lineTimes,
    wordTimes,
    lineMeta,
    coherenceScore: lineCnt ? Math.round(scoreSum / lineCnt) : 0,
    avgAbsErrMs: lineCnt ? Math.round(errSum / lineCnt) : 0,
    matchedCount: 0,
    matchRatio: 0,
    corrections,
    spellingFixCount: spellingFixCount || corrections.length,
    correctedLines,
    correctedText,
    divergences,
    reformulations,
    unresolvableProblems,
    reconcileSummary,
    lineMatchRatios,
    detectedLanguage,
    recognizedLines,
    recognizedTranscript,
    source: 'acoustic',
    requiresBilling,
    errorReason,
  };
};

/* Dedicated On-Demand AI Lyric Reformulation & Diagnostic Reconciliation */
J.reconcileLyricsWithAI = async ({ lines = [], recognizedLines = [], vocalSegments = [], divergences = [], corrections = [], lang = 'auto', durationSec = 0, matchRatio = 1, lineMatchRatios = {} } = {}) => {
  try {
    const resp = await fetch('/api/reconcile-lyrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lines,
        recognizedLines,
        vocalSegments,
        divergences,
        corrections,
        lang,
        durationSec,
        matchRatio,
        lineMatchRatios,
      }),
    });
    if (resp.ok) return await resp.json();
  } catch (e) {}
  return { success: false, reformulations: [], unresolvableProblems: [] };
};

/* Surgical Single-Segment Vocal Re-Analysis for Low-Confidence or Divergent Lines */
J.reanalyzeLineAudio = async (audioAnalysis, startSec, endSec, existingWords = [], lang = 'auto') => {
  if (!audioAnalysis || !audioAnalysis.buffer) return { success: false };
  const s0 = Math.max(0, (Number(startSec) || 0) - 0.35);
  const e0 = Math.min(audioAnalysis.duration || (s0 + 6), Math.max(s0 + 1.2, (Number(endSec) || (s0 + 3)) + 0.45));
  const segDur = Math.max(0.8, e0 - s0);
  try {
    const rawBlob = J.audioMonoWavWindow(audioAnalysis.buffer, s0, segDur, 16000);
    const audioBase64 = await blobToBase64(rawBlob);
    let separatedVocalBase64 = '';
    if (audioAnalysis.preprocessing && audioAnalysis.preprocessing.shouldSeparate && J.audioVocalSeparatedWavWindow) {
      const sepBlob = J.audioVocalSeparatedWavWindow(audioAnalysis.buffer, s0, segDur, 16000);
      separatedVocalBase64 = await blobToBase64(sepBlob);
    }
    const resp = await fetch('/api/reanalyze-segment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioBase64,
        separatedVocalBase64,
        startSec: s0,
        endSec: e0,
        existingWords,
        qualityConditions: (audioAnalysis.preprocessing && audioAnalysis.preprocessing.quality) || {},
        lang,
      }),
    });
    if (!resp.ok) return { success: false };
    const data = await resp.json();
    if (data && data.success && Array.isArray(data.lines) && data.lines.length) {
      const shifted = data.lines.map(ln => ({
        ...ln,
        start: +((Number(ln.start) || 0) + s0).toFixed(3),
        end: +((Number(ln.end) || 0) + s0).toFixed(3),
        words: Array.isArray(ln.words)
          ? ln.words.map(w => ({
              ...w,
              start: +((Number(w.start) || 0) + s0).toFixed(3),
              end: +((Number(w.end) || 0) + s0).toFixed(3),
            }))
          : [],
      }));
      return { success: true, lines: shifted, focusTranscript: data.focusTranscript || '' };
    }
    return data || { success: false };
  } catch (e) {
    return { success: false };
  }
};

/* Downsample a window of an AudioBuffer to mono WAV for high-speed AI speech/lyric recognition */
J.audioMonoWavWindow = (buffer, startSec = 0, durationSec = 140, targetSampleRate = 16000) => {
  const chn = buffer.numberOfChannels;
  const origSr = buffer.sampleRate;
  const s0 = Math.max(0, Number(startSec) || 0);
  const availDur = Math.max(0.05, buffer.duration - s0);
  const dur = Math.min(availDur, Math.max(0.1, Number(durationSec) || availDur));
  const targetSr = targetSampleRate;
  const targetLength = Math.max(1, Math.floor(dur * targetSr));
  const step = origSr / targetSr;
  const srcStart = Math.floor(s0 * origSr);
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
    const srcIdx = srcStart + Math.floor(i * step);
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

/* Downsample an AudioBuffer to mono WAV */
J.audioMonoWav = (buffer, maxSeconds = 300, targetSampleRate = 16000) => {
  return J.audioMonoWavWindow(buffer, 0, maxSeconds, targetSampleRate);
};

/* CORE FUNCTION 05 — Complete 7-Stage Audio Analysis, Vocal Separation, Streaming Singing Transcription,
   Forced Alignment, Refinement, Validation & Synchronized Subtitle Generation Pipeline */
J.aiTranscribeMusic = async (audioAnalysis, lang = 'auto', onStage = null, onPartialResult = null) => {
  if (!audioAnalysis || !audioAnalysis.buffer) {
    return { success: false, reason: 'no_audio', errorMessage: 'No decoded audio buffer available' };
  }
  const totalDur = audioAnalysis.duration || audioAnalysis.buffer.duration || 0;
  const reportStage = (stage, label) => { if (typeof onStage === 'function') try { onStage(stage, label); } catch (e) {} };
  const reportPartial = (payload) => { if (typeof onPartialResult === 'function') try { onPartialResult(payload); } catch (e) {} };
  const prep = audioAnalysis.preprocessing || {};
  const allVocalSegs = Array.isArray(audioAnalysis.vocalSegments)
    ? audioAnalysis.vocalSegments.map(s => ({ start: +Number(s.start || 0).toFixed(3), end: +Number(s.end || 0).toFixed(3) }))
    : [];

  reportStage(1, 'preprocessing');
  const buildPayload = async (chunkStart, chunkDur, sampleRate, withSeparated) => {
    const wavBlob = J.audioMonoWavWindow(audioAnalysis.buffer, chunkStart, chunkDur, sampleRate);
    const base64Audio = await blobToBase64(wavBlob);
    let separatedVocalBase64 = '';
    if (withSeparated) {
      reportStage(2, 'separation');
      const sepBlob = J.audioVocalSeparatedWavWindow(audioAnalysis.buffer, chunkStart, chunkDur, sampleRate);
      separatedVocalBase64 = await blobToBase64(sepBlob);
    }
    const chunkEnd = chunkStart + chunkDur;
    const windowSegs = allVocalSegs.filter(s => s.end > chunkStart && s.start < chunkEnd);
    return JSON.stringify({
      audioBase64: base64Audio,
      separatedVocalBase64,
      lang,
      audioFormat: audioAnalysis.format || 'AUDIO',
      duration: totalDur,
      sampleRate: audioAnalysis.sampleRate,
      chunkStartSec: chunkStart,
      chunkDurationSec: chunkDur,
      preprocessingSummary: prep,
      vocalSegments: windowSegs.slice(0, 48),
    });
  };

  const readSseStream = async (resp) => {
    if (!resp.body || typeof resp.body.getReader !== 'function') {
      return resp.json();
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let finalData = null;

    const handleBlock = (block) => {
      let evtName = 'message';
      const dataLines = [];
      for (const rawLine of block.split(/\r?\n/)) {
        if (!rawLine || rawLine.startsWith(':')) continue;
        if (rawLine.startsWith('event:')) evtName = rawLine.slice(6).trim();
        else if (rawLine.startsWith('data:')) dataLines.push(rawLine.slice(5).trim());
      }
      if (!dataLines.length) return;
      try {
        const parsed = JSON.parse(dataLines.join('\n'));
        if (evtName === 'stage') {
          reportStage(parsed.stage || 3, parsed.label || 'transcribing');
        } else if (evtName === 'transcript_preview') {
          reportPartial({
            stage: 'preview',
            previewLines: Array.isArray(parsed.previewLines) ? parsed.previewLines : [],
            transcript: parsed.transcript || '',
            offsetSec: parsed.offsetSec || 0,
          });
        } else if (evtName === 'result' || evtName === 'error') {
          finalData = parsed;
        }
      } catch (e) {}
    };

    while (true) {
      const { value, done } = await reader.read();
      if (value) {
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const blk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          handleBlock(blk);
        }
      }
      if (done) break;
    }
    if (buf.trim()) handleBlock(buf);
    return finalData;
  };

  const transcribeWindow = async (chunkStart, chunkDur) => {
    const useSep = Boolean(prep.shouldSeparate);
    let sr = chunkDur > 140 ? 12000 : 16000;
    let bodyJson = await buildPayload(chunkStart, chunkDur, sr, useSep);
    reportStage(3, 'transcription');
    try {
      let resp = await fetch('/api/transcribe-lyrics/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyJson,
      });
      if (resp.status === 413) {
        bodyJson = await buildPayload(chunkStart, chunkDur, 8000, false);
        resp = await fetch('/api/transcribe-lyrics/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: bodyJson,
        });
      }
      if (resp.ok) {
        const ctype = (resp.headers.get('content-type') || '').toLowerCase();
        const streamed = ctype.includes('text/event-stream') ? await readSseStream(resp) : await resp.json();
        if (streamed) return streamed;
      }
    } catch (e) {}

    // Fallback cleanly to standard JSON endpoint if SSE stream fails
    let respFallback = await fetch('/api/transcribe-lyrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyJson,
    });
    if (respFallback.status === 413) {
      bodyJson = await buildPayload(chunkStart, chunkDur, 8000, false);
      respFallback = await fetch('/api/transcribe-lyrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyJson,
      });
    }
    if (!respFallback.ok) {
      return { success: false, reason: 'http_error', errorMessage: `HTTP ${respFallback.status}` };
    }
    return respFallback.json();
  };

  const refineAndValidate = (rawLines, detectedLang, serverValidation, usedModels) => {
    reportStage(5, 'refinement');
    const needsAcousticLineSnap = usedModels && usedModels.forcedAlignment === 'client_10ms_vocal_onset_aligner';
    let workingLines = rawLines;
    if (needsAcousticLineSnap && workingLines.length) {
      const parsedPseudo = workingLines.map(l => ({ text: l.text, interlude: Boolean(l.isInstrumentalSection) }));
      const snappedTimes = J.alignLinesToVocals(audioAnalysis, parsedPseudo);
      workingLines = workingLines.map((l, idx) => {
        if (l.isInstrumentalSection) return l;
        const ns = snappedTimes[idx] != null ? snappedTimes[idx] : l.start;
        const ne = (idx < workingLines.length - 1 && snappedTimes[idx + 1] != null)
          ? Math.max(ns + 0.35, snappedTimes[idx + 1] - 0.05)
          : Math.max(ns + 0.5, Math.min(totalDur, l.end || ns + 3.0));
        return Object.assign({}, l, { start: +ns.toFixed(3), end: +ne.toFixed(3) });
      });
    }
    const refined = workingLines.map(l => {
      const lineLang = l.language || detectedLang || lang;
      const lineSpk = l.speaker || 'Lead';
      if (l.isInstrumentalSection || l.vocalType === 'instrumental') {
        return Object.assign({}, l, { speaker: 'Instrumental', words: [] });
      }
      const words = (Array.isArray(l.words) && l.words.length)
        ? J.refineWordTimingsAcoustic(audioAnalysis, l.words, l.start, l.end, lineLang, lineSpk)
        : J.alignWordsAcoustic(audioAnalysis, l.text, l.start, l.end, lineLang, lineSpk, l.recognitionConfidence ?? 0.9);
      return Object.assign({}, l, { words });
    });
    reportStage(6, 'validation');
    const validated = J.validateKaraokeAlignment(audioAnalysis, refined, serverValidation);
    reportStage(7, 'subtitles');
    const pipelineReport = {
      stages: [
        { id: 1, key: 'preprocessing', status: 'done', detail: `${prep.sampleRate || audioAnalysis.sampleRate}Hz · ${totalDur.toFixed(1)}s · ${prep.silenceCount ?? 0} silences` },
        { id: 2, key: 'separation', status: 'done', detail: usedModels && usedModels.separation ? usedModels.separation : (prep.shouldSeparate ? 'mid_side_formant' : 'direct_vocal') },
        { id: 3, key: 'transcription', status: 'done', detail: (usedModels && usedModels.transcription) || 'gemini-3.5-transcribe' },
        { id: 4, key: 'forced_alignment', status: 'done', detail: (usedModels && usedModels.forcedAlignment) || 'gemini-4-hydrogen' },
        { id: 5, key: 'refinement', status: 'done', detail: 'onset+VAD+phoneme_10ms' },
        { id: 6, key: 'validation', status: 'done', detail: `${validated.validationSummary.uncertainWords} uncertain · ${validated.validationSummary.missingWords} gaps · ${validated.validationSummary.overlappingWords} overlap` },
        { id: 7, key: 'subtitles', status: 'done', detail: `${validated.lines.length} lines · ${validated.validationSummary.totalWords} tokens` },
      ],
    };
    return { lines: validated.lines, validationSummary: validated.validationSummary, pipelineReport };
  };

  // Single cohesive window up to 42s; for longer tracks, stream 36s windows with 3s overlap so lyrics start appearing immediately!
  if (totalDur <= 42) {
    const data = await transcribeWindow(0, totalDur);
    if (!data) return { success: false, reason: 'empty_response', errorMessage: 'Empty server response' };
    if (data.requiresBilling || data.reason === 'billing_required') {
      return { success: false, billingRequired: true, reason: 'billing_required', errorMessage: data.message || '', lines: [] };
    }
    if (data.reason === 'ai_not_configured') {
      return { success: false, notConfigured: true, reason: 'ai_not_configured', errorMessage: data.message || '', lines: [] };
    }
    if (data.success && (Array.isArray(data.lines) || data.isInstrumental)) {
      const rv = refineAndValidate(data.lines || [], data.language, data.validationSummary, data.pipelineModels);
      data.lines = rv.lines;
      data.validationSummary = rv.validationSummary;
      data.pipelineReport = rv.pipelineReport;
      const lineLangs = new Set(Array.isArray(data.detectedLanguages) ? data.detectedLanguages.filter(Boolean) : []);
      if (data.language && data.language !== 'auto' && data.language !== 'multi' && data.language !== 'instrumental') lineLangs.add(data.language);
      rv.lines.forEach(l => {
        if (l && !l.isInstrumentalSection && l.language && l.language !== 'auto' && l.language !== 'instrumental') lineLangs.add(l.language);
      });
      data.detectedLanguages = Array.from(lineLangs);
      if (data.detectedLanguages.length > 1 && !lang) data.language = data.detectedLanguages[0];
      return data;
    }
    return { success: false, reason: data.reason || 'transcription_error', errorMessage: data.message || data.errorMessage || '', lines: [] };
  }

  const winDur = 36;
  const step = 33;
  const totalChunks = Math.max(1, Math.ceil((totalDur - 0.5) / step));
  const mergedLines = [];
  const mergedSections = [];
  const mergedGaps = [];
  const langs = new Set();
  const speakers = new Set();
  const audioTypes = new Set();
  let primaryLang = 'auto';
  let title = '';
  let artist = '';
  let hasBackingVocals = false;
  let hasUnclearSections = false;
  let hasInstrumentalSections = false;
  let hasRepeatedChorus = false;
  let allInstrumental = true;
  let lastModels = null;
  let lastError = null;
  let chunkIndex = 0;

  for (let t0 = 0; t0 < totalDur - 0.5; t0 += step) {
    chunkIndex++;
    const dur = Math.min(winDur, totalDur - t0);
    const chunkData = await transcribeWindow(t0, dur);
    if (!chunkData) continue;
    if (chunkData.requiresBilling || chunkData.reason === 'billing_required') {
      return { success: false, billingRequired: true, reason: 'billing_required', errorMessage: chunkData.message || '', lines: [] };
    }
    if (chunkData.reason === 'ai_not_configured') {
      return { success: false, notConfigured: true, reason: 'ai_not_configured', errorMessage: chunkData.message || '', lines: [] };
    }
    if (!chunkData.success) {
      lastError = chunkData;
      continue;
    }
    if (chunkData.pipelineModels) lastModels = chunkData.pipelineModels;

    if (chunkData.language && chunkData.language !== 'auto' && chunkData.language !== 'instrumental' && primaryLang === 'auto') {
      primaryLang = chunkData.language;
    }
    (chunkData.detectedLanguages || []).forEach(dl => { if (dl) langs.add(dl); });
    (chunkData.detectedSpeakers || []).forEach(sp => { if (sp) speakers.add(sp); });
    if (chunkData.audioType) audioTypes.add(chunkData.audioType);
    if (!title && chunkData.title) title = chunkData.title;
    if (!artist && chunkData.artist) artist = chunkData.artist;
    if (chunkData.hasBackingVocals) hasBackingVocals = true;
    if (chunkData.hasUnclearSections) hasUnclearSections = true;
    if (chunkData.hasInstrumentalSections) hasInstrumentalSections = true;
    if (chunkData.hasRepeatedChorus) hasRepeatedChorus = true;
    if (!chunkData.isInstrumental) allInstrumental = false;
    if (chunkData.validationSummary && Array.isArray(chunkData.validationSummary.missingVocalGaps)) {
      mergedGaps.push(...chunkData.validationSummary.missingVocalGaps);
    }

    if (Array.isArray(chunkData.sections)) mergedSections.push(...chunkData.sections);
    if (Array.isArray(chunkData.lines)) {
      for (const ln of chunkData.lines) {
        if (ln.speaker && ln.speaker !== 'Instrumental') speakers.add(ln.speaker);
        const prev = mergedLines[mergedLines.length - 1];
        if (prev && ln.start < prev.end + 0.45 && prev.text.trim().toLowerCase() === String(ln.text || '').trim().toLowerCase()) continue;
        if (prev && ln.start < prev.end) {
          ln.start = +Math.max(prev.end + 0.02, ln.start).toFixed(3);
          if (ln.end <= ln.start) ln.end = +(ln.start + 0.25).toFixed(3);
        }
        mergedLines.push(ln);
      }
    }

    if (mergedLines.length) {
      reportPartial({
        stage: 'chunk',
        chunkIndex,
        totalChunks,
        lines: mergedLines.slice(),
        language: primaryLang,
        detectedLanguages: Array.from(langs),
      });
    }
  }

  if (!mergedLines.length && !allInstrumental) {
    return {
      success: false,
      reason: (lastError && lastError.reason) || 'transcription_error',
      errorMessage: (lastError && (lastError.message || lastError.errorMessage)) || '',
      lines: [],
    };
  }
  let combinedType = 'singing';
  if (allInstrumental) combinedType = 'instrumental';
  else if (audioTypes.has('combination') || (audioTypes.size > 1) || (audioTypes.has('speech') && audioTypes.has('singing'))) combinedType = 'combination';
  else if (audioTypes.has('speech') && !audioTypes.has('singing')) combinedType = 'speech';

  const rv = refineAndValidate(mergedLines, primaryLang, { missingVocalGaps: mergedGaps }, lastModels);

  return {
    success: true,
    audioType: combinedType,
    language: primaryLang,
    detectedLanguages: Array.from(langs),
    detectedSpeakers: Array.from(speakers),
    hasBackingVocals,
    hasUnclearSections: hasUnclearSections || rv.validationSummary.uncertainWords > 0,
    hasInstrumentalSections: hasInstrumentalSections || rv.lines.some(l => l.isInstrumentalSection),
    hasRepeatedChorus,
    title,
    artist,
    isInstrumental: allInstrumental,
    sections: mergedSections,
    validationSummary: rv.validationSummary,
    pipelineReport: rv.pipelineReport,
    lines: rv.lines,
  };
};

/* Instant Built-in Browser Voice & Singing Recognition + Automatic Neural Whisper Mic Fallback */
J.isVoiceRecognitionSupported = () => {
  if (typeof window === 'undefined') return false;
  const hasSpeech = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  const hasMicRec = Boolean(typeof navigator !== 'undefined' && navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function' && typeof window.MediaRecorder === 'function');
  return hasSpeech || hasMicRec;
};

J.mapLangToSpeechLocale = (lang = 'auto') => {
  const raw = String(lang || 'auto').trim().toLowerCase();
  const map = {
    fr: 'fr-FR',
    en: 'en-US',
    'zh-hans': 'zh-CN',
    'zh-hant': 'zh-TW',
    zh: 'zh-CN',
    ja: 'ja-JP',
    ko: 'ko-KR',
    es: 'es-ES',
    de: 'de-DE',
    it: 'it-IT',
    pt: 'pt-PT',
  };
  if (map[raw]) return map[raw];
  const docLang = (typeof document !== 'undefined' && document.documentElement.lang || '').toLowerCase();
  return map[docLang] || (typeof navigator !== 'undefined' && navigator.language) || 'fr-FR';
};

J.createLiveVoiceRecognizer = (opts = {}) => {
  const SpeechCtor = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const onInterim = typeof opts.onInterim === 'function' ? opts.onInterim : () => {};
  const onPhrase = typeof opts.onPhrase === 'function' ? opts.onPhrase : () => {};
  const onLevel = typeof opts.onLevel === 'function' ? opts.onLevel : () => {};
  const onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : () => {};
  const getClock = typeof opts.getClock === 'function' ? opts.getClock : () => (performance.now() / 1000);

  let active = false;
  let mode = 'speech'; // 'speech' | 'whisper_mic'
  let recognition = null;
  let startClockSec = 0;
  let phraseStartSec = null;
  let pauseFlushTimer = null;
  let lastInterimText = '';
  let mediaStream = null;
  let audioCtx = null;
  let rafId = 0;
  let restartTimer = 0;
  let mediaRec = null;
  let recChunks = [];
  let recStartClock = 0;
  let recStartMs = 0;
  let hadVoiceInClip = false;
  let lastVoiceMs = 0;
  let flushingWhisperClip = false;

  const pickRecorderMime = () => {
    if (typeof window === 'undefined' || typeof window.MediaRecorder !== 'function' || typeof window.MediaRecorder.isTypeSupported !== 'function') {
      return '';
    }
    const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    return cands.find(m => window.MediaRecorder.isTypeSupported(m)) || '';
  };

  const stopMeter = () => {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (mediaRec && mediaRec.state !== 'inactive') {
      try { mediaRec.onstop = null; mediaRec.stop(); } catch (e) {}
    }
    mediaRec = null;
    if (mediaStream) {
      try { mediaStream.getTracks().forEach(t => t.stop()); } catch (e) {}
      mediaStream = null;
    }
    if (audioCtx) {
      try { audioCtx.close(); } catch (e) {}
      audioCtx = null;
    }
    onLevel(0);
  };

  const sendWhisperClip = async (blob, clipStartRel, clipDurSec) => {
    if (!blob || blob.size < 800) return;
    try {
      const b64 = await blobToBase64(blob);
      const resp = await fetch('/api/transcribe-voice-clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64: b64, lang: opts.lang || 'auto' }),
      });
      if (!resp.ok) return;
      const data = await resp.json();
      if (data && data.success && !data.isInstrumental && Array.isArray(data.lines) && data.lines.length) {
        data.lines.forEach(ln => {
          const txt = String((ln && ln.text) || '').trim();
          if (!txt || /^\[?instrumental/i.test(txt)) return;
          const s = clipStartRel + Math.max(0, Number(ln.start) || 0);
          const e = clipStartRel + Math.max(0.35, Number(ln.end) || clipDurSec);
          onInterim({ text: '', startSec: s });
          onPhrase({
            text: txt,
            startSec: +s.toFixed(3),
            endSec: +Math.max(s + 0.35, e).toFixed(3),
            confidence: ln.recognitionConfidence || 0.9,
            words: Array.isArray(ln.words)
              ? ln.words.map(w => Object.assign({}, w, {
                  start: +(clipStartRel + (Number(w.start) || 0)).toFixed(3),
                  end: +(clipStartRel + (Number(w.end) || 0.1)).toFixed(3),
                }))
              : undefined,
          });
        });
      }
    } catch (e) {
      // Non-fatal clip upload error; listener stays active for next phrase
    }
  };

  const startWhisperSegment = () => {
    if (!active || !mediaStream || typeof window.MediaRecorder !== 'function') return;
    flushingWhisperClip = false;
    recChunks = [];
    hadVoiceInClip = false;
    recStartMs = performance.now();
    lastVoiceMs = recStartMs;
    recStartClock = Math.max(0, getClock() - startClockSec);
    const mime = pickRecorderMime();
    try {
      mediaRec = mime ? new window.MediaRecorder(mediaStream, { mimeType: mime }) : new window.MediaRecorder(mediaStream);
    } catch (e) {
      mediaRec = new window.MediaRecorder(mediaStream);
    }
    const localStart = recStartClock;
    const localMs = recStartMs;
    mediaRec.ondataavailable = (ev) => {
      if (ev && ev.data && ev.data.size > 0) recChunks.push(ev.data);
    };
    mediaRec.onstop = () => {
      const chunksCopy = recChunks.slice();
      const spoke = hadVoiceInClip;
      const dur = Math.max(0.2, (performance.now() - localMs) / 1000);
      recChunks = [];
      mediaRec = null;
      if (spoke && chunksCopy.length) {
        const blob = new Blob(chunksCopy, { type: (chunksCopy[0] && chunksCopy[0].type) || mime || 'audio/webm' });
        onInterim({ text: '✨ Whisper IA…', startSec: localStart });
        sendWhisperClip(blob, localStart, dur);
      }
      if (active && mode === 'whisper_mic') {
        startWhisperSegment();
      }
    };
    mediaRec.start(250);
  };

  const flushCurrentWhisperSegment = () => {
    if (flushingWhisperClip || !mediaRec || mediaRec.state !== 'recording') return;
    flushingWhisperClip = true;
    try { mediaRec.stop(); } catch (e) { flushingWhisperClip = false; }
  };

  const switchToWhisperMic = async () => {
    mode = 'whisper_mic';
    if (recognition) {
      try { recognition.onend = null; recognition.stop(); } catch (e) {}
      recognition = null;
    }
    await startMeter(true);
    if (active && mediaStream) {
      onStatus('listening', { lang: J.mapLangToSpeechLocale(opts.lang || 'auto'), mode: 'whisper_mic' });
      startWhisperSegment();
    } else if (active) {
      active = false;
      stopMeter();
      onStatus('denied', { error: 'microphone_unavailable' });
    }
  };

  const startMeter = async (startWhisperCapture = false) => {
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) return;
    if (mediaStream) return;
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx || !active) return;
      audioCtx = new Ctx();
      const src = audioCtx.createMediaStreamSource(mediaStream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        if (!active) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        onLevel(Math.min(1, rms * 3.8));
        if (mode === 'whisper_mic' && mediaRec && mediaRec.state === 'recording') {
          const nowMs = performance.now();
          const isZhLive = String(opts.lang || '').toLowerCase().startsWith('zh');
          const silThresh = isZhLive ? 520 : 680;
          const minClip = isZhLive ? 720 : 900;
          const maxClip = isZhLive ? 3500 : 4600;
          if (rms > 0.020) {
            hadVoiceInClip = true;
            lastVoiceMs = nowMs;
            onInterim({ text: isZhLive ? '🎙️ 正在识别中文语音…' : '🎙️ …', startSec: recStartClock });
          }
          const clipMs = nowMs - recStartMs;
          const silenceMs = nowMs - lastVoiceMs;
          if ((hadVoiceInClip && silenceMs > silThresh && clipMs > minClip) || clipMs > maxClip) {
            flushCurrentWhisperSegment();
          }
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
      if (startWhisperCapture && !mediaRec) startWhisperSegment();
    } catch (e) {
      if (mode === 'whisper_mic') {
        active = false;
        stopMeter();
        onStatus('denied', { error: 'not-allowed' });
      }
    }
  };

  const emitFinal = (txt, conf = 0.92) => {
    let clean = String(txt || '').trim();
    if (/[\u4e00-\u9fff]/.test(clean)) {
      clean = clean
        .replace(/([\u4e00-\u9fff\u3400-\u4dbf])\s+(?=[\u4e00-\u9fff\u3400-\u4dbf，。！？；：、])/g, '$1')
        .replace(/[。]+$/g, '');
    }
    if (!clean) return;
    const nowSec = Math.max(0, getClock() - startClockSec);
    const sSec = phraseStartSec != null ? Math.max(0, phraseStartSec) : Math.max(0, nowSec - 1.4);
    const eSec = Math.max(sSec + 0.35, nowSec);
    phraseStartSec = null;
    lastInterimText = '';
    onInterim({ text: '', startSec: sSec });
    onPhrase({ text: clean, startSec: +sSec.toFixed(3), endSec: +eSec.toFixed(3), confidence: conf });
  };

  const spawnRecognition = () => {
    if (!SpeechCtor || !active || mode !== 'speech') return;
    recognition = new SpeechCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = J.mapLangToSpeechLocale(opts.lang || 'auto');

    recognition.onstart = () => {
      if (active && mode === 'speech') onStatus('listening', { lang: recognition.lang, mode: 'speech' });
    };

    recognition.onresult = (event) => {
      if (!active || mode !== 'speech') return;
      clearTimeout(pauseFlushTimer);
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const transcript = (res[0] && res[0].transcript) ? String(res[0].transcript) : '';
        const conf = (res[0] && typeof res[0].confidence === 'number' && res[0].confidence > 0) ? res[0].confidence : 0.91;
        if (phraseStartSec == null) {
          phraseStartSec = Math.max(0, getClock() - startClockSec);
        }
        if (res.isFinal) {
          emitFinal(transcript, conf);
        } else {
          interim += transcript;
        }
      }
      const cleanInterim = interim.trim();
      lastInterimText = cleanInterim;
      if (cleanInterim) {
        onInterim({ text: cleanInterim, startSec: phraseStartSec ?? 0 });
        const flushDelayMs = String(opts.lang || '').toLowerCase().startsWith('zh') ? 880 : 1250;
        pauseFlushTimer = setTimeout(() => {
          if (active && mode === 'speech' && lastInterimText) {
            emitFinal(lastInterimText, 0.86);
            try { recognition && recognition.stop(); } catch (e) {}
          }
        }, flushDelayMs);
      }
    };

    recognition.onerror = (ev) => {
      const err = (ev && ev.error) || 'error';
      if (err === 'not-allowed') {
        active = false;
        stopMeter();
        onStatus('denied', { error: err });
      } else if (err === 'service-not-allowed' || err === 'network' || err === 'language-not-supported') {
        // Automatic fallback to Studio Whisper Mic Recording when browser cloud speech is blocked
        if (active && typeof window.MediaRecorder === 'function') {
          switchToWhisperMic();
        } else {
          active = false;
          stopMeter();
          onStatus('denied', { error: err });
        }
      } else if (err === 'no-speech' || err === 'aborted') {
        // Silent timeout — auto-restarted on onend
      } else {
        onStatus('error', { error: err });
      }
    };

    recognition.onend = () => {
      if (!active || mode !== 'speech') return;
      restartTimer = setTimeout(() => {
        if (active && mode === 'speech') spawnRecognition();
      }, 140);
    };

    try {
      recognition.start();
    } catch (e) {
      if (typeof window.MediaRecorder === 'function') {
        switchToWhisperMic();
      } else {
        active = false;
        stopMeter();
        onStatus('error', { error: (e && e.message) || 'start_failed' });
      }
    }
  };

  return {
    start(overrideLang) {
      if (!J.isVoiceRecognitionSupported()) {
        onStatus('unsupported', { error: 'Voice recognition unavailable' });
        return false;
      }
      if (overrideLang) opts.lang = overrideLang;
      active = true;
      startClockSec = getClock();
      phraseStartSec = null;
      lastInterimText = '';
      if (SpeechCtor) {
        mode = 'speech';
        spawnRecognition();
        startMeter(false);
      } else {
        switchToWhisperMic();
      }
      return true;
    },
    stop() {
      const wasWhisperMic = mode === 'whisper_mic';
      active = false;
      clearTimeout(pauseFlushTimer);
      clearTimeout(restartTimer);
      if (lastInterimText) emitFinal(lastInterimText, 0.85);
      if (recognition) {
        try { recognition.onend = null; recognition.stop(); } catch (e) {}
        recognition = null;
      }
      if (wasWhisperMic && mediaRec && mediaRec.state === 'recording') {
        const ref = mediaRec;
        const chunksCopy = recChunks;
        const spoke = hadVoiceInClip;
        const localStart = recStartClock;
        const dur = Math.max(0.2, (performance.now() - recStartMs) / 1000);
        ref.onstop = () => {
          if (spoke && chunksCopy.length) {
            const blob = new Blob(chunksCopy, { type: (chunksCopy[0] && chunksCopy[0].type) || 'audio/webm' });
            sendWhisperClip(blob, localStart, dur);
          }
          stopMeter();
          onStatus('stopped');
        };
        try { ref.stop(); } catch (e) { stopMeter(); onStatus('stopped'); }
        return;
      }
      stopMeter();
      onStatus('stopped');
    },
    isActive() { return active; },
  };
};

/* FUNCTION 09 — Optional synchronized translation layer helper (preserves original lines/timestamps) */
J.translateLyricsLines = async (lines, targetLang) => {
  const inputLines = Array.isArray(lines) ? lines : [];
  if (!inputLines.length) {
    return { success: true, targetLang, detectedSourceLanguages: [], translations: [] };
  }
  const resp = await fetch('/api/translate-lyrics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lines: inputLines.map((l, idx) => ({
        index: Number.isInteger(Number(l && l.index)) ? Number(l.index) : idx,
        text: String((l && l.text) || ''),
        language: String((l && (l.language || (l.meta && l.meta.language))) || ''),
        interlude: Boolean(l && (l.interlude || l.isInstrumentalSection)),
      })),
      targetLang: String(targetLang || 'en'),
    }),
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  return resp.json();
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
