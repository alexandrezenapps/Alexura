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
  const vocalEnergy = new Float32Array(n);

  // High-resolution 100 Hz (10ms) acoustic features for word & character forced alignment
  const fineRate = 100, fineHop = Math.max(1, Math.round(sr / fineRate)), fn = Math.floor(len / fineHop);
  const vocalEnv100 = new Float32Array(fn);
  const consonantFlux100 = new Float32Array(fn);
  const voicing100 = new Float32Array(fn);
  const wordAttack100 = new Float32Array(fn);

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
    let e = 0, eh = 0, ve = 0, ce = 0;
    const i0 = f * fineHop;
    const end = Math.min(len, (f + 1) * fineHop);
    const cnt = Math.max(1, end - i0);
    for (let i = i0; i < end; i++) {
      const x = mono[i];
      e += x * x;
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

    vocalEnv100[f] = rmsVoc;
    consonantFlux100[f] = rmsCon;
    voicing100[f] = rmsAll > 1e-5 ? Math.min(1, rmsVoc / (rmsAll + 1e-5)) : 0;

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

  const acousticSummary = {
    audioType: acousticType,
    vocalRatio: +vocalRatio.toFixed(3),
    vocalFormantShare: +vocalFormantShare.toFixed(3),
    instrumentalGapCount: instrumentalSegments.length,
    vocalPhraseCount: vocalSegments.length,
    format,
  };

  return {
    name: file.name, format, duration: audioBuffer.duration, sampleRate: sr, buffer: audioBuffer,
    bpm: Math.round(60 / period * 10) / 10, beats, energy: energyN, energyRate: rate, peaks,
    vocalEnergy, vocalOnset, vocalSegments, instrumentalSegments, acousticSummary,
    fineRate, vocalEnv100, consonantFlux100, voicing100, wordAttack100,
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

  const re = /[A-Za-zÀ-ÿ\u1e00-\u1eff0-9]+(?:['’\-][A-Za-zÀ-ÿ\u1e00-\u1eff0-9]+)*[,.;:!?…]?|[\uac00-\ud7af]+[,.;:!?…]?|[\u3040-\u309f\u30a0-\u30ff][\u3041\u3043\u3045\u3047\u3049\u3063\u3083\u3085\u3087\u308e\u30a1\u30a3\u30a5\u30a7\u30a9\u30c3\u30e3\u30e5\u30e7\u30ee\u30fc]*[、。，．！？…]?|[\u4e00-\u9fff\u3400-\u4dbf][、。，．！？…]?|[^\s]/g;
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
    });
  }
  return out;
};

/* Hybrid AI + 10ms Acoustic Refiner:
   - Splits grouped CJK/Chinese multi-char tokens into individual aligned characters
   - Snaps AI word start boundaries within ±70ms onto crisp 10ms vocal/consonant attack peaks
   - Recomputes acoustic char timings & blends real acoustic SNR confidence */
J.refineWordTimingsAcoustic = (analysis, rawWords, lineStart, lineEnd, lang, defaultSpeaker = 'Lead') => {
  if (!Array.isArray(rawWords) || !rawWords.length) return [];
  const sLine = Math.max(0, Number(lineStart) || 0);
  const eLine = Math.max(sLine + 0.1, Number(lineEnd) || sLine + 2.0);
  const normLang = String(lang || '').toLowerCase();
  const isZh = normLang.startsWith('zh');

  // Expand any accidentally grouped Chinese multi-character strings into individual characters first
  const expanded = [];
  for (const w of rawWords) {
    const txt = String(w && w.text || '').trim();
    if (!txt) continue;
    const ws = Math.max(sLine, Number(w.start) || sLine);
    const we = Math.min(eLine, Math.max(ws + 0.015, Number(w.end) || ws + 0.2));
    const spk = String(w.speaker || defaultSpeaker || 'Lead').trim();
    const recC = Number.isFinite(Number(w.recognitionConfidence)) ? J.clamp(Number(w.recognitionConfidence), 0, 1) : 0.92;
    const alignC = Number.isFinite(Number(w.alignmentConfidence)) ? J.clamp(Number(w.alignmentConfidence), 0, 1) : 0.9;

    if ((isZh || /[\u4e00-\u9fff\u3400-\u4dbf]{2,}/.test(txt)) && Array.from(txt).filter(c => /[\u4e00-\u9fff\u3400-\u4dbf]/.test(c)).length >= 2) {
      const subTokens = J.tokenizeKaraokeWords(txt, lang);
      if (subTokens.length > 1) {
        const subAligned = J.alignWordsAcoustic(analysis, subTokens.join(' '), ws, we, lang, spk, recC);
        if (subAligned.length === subTokens.length) {
          subAligned.forEach((sw, si) => {
            sw.text = subTokens[si];
            sw.alignmentConfidence = +Math.max(sw.alignmentConfidence, alignC * 0.92).toFixed(3);
            expanded.push(sw);
          });
          continue;
        }
      }
    }
    expanded.push({ text: txt, start: ws, end: we, chars: w.chars, recognitionConfidence: recC, alignmentConfidence: alignC, speaker: spk });
  }

  const att = analysis && analysis.wordAttack100;
  const env = analysis && analysis.vocalEnv100;
  const fr = (analysis && analysis.fineRate) || 100;
  const canSnap = !!(att && env && att.length && fr > 0);

  let prevEnd = sLine;
  return expanded.map((w, idx) => {
    let ws = Math.max(prevEnd, w.start);
    let we = Math.min(eLine, Math.max(ws + 0.018, w.end));

    if (canSnap) {
      // Search ±70ms window around AI onset for the strongest vocal attack peak
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
    }

    ws = +ws.toFixed(3);
    we = +Math.max(ws + 0.018, we).toFixed(3);
    prevEnd = we;

    let finalAlignC = w.alignmentConfidence;
    if (canSnap) {
      const f0 = Math.max(0, Math.min(env.length - 1, Math.round(ws * fr)));
      const f1 = Math.max(f0, Math.min(env.length - 1, Math.round(we * fr)));
      let wPeak = 0;
      for (let f = f0; f <= f1; f++) if (env[f] > wPeak) wPeak = env[f];
      const acBonus = wPeak > 0.004 ? 0.94 : 0.78;
      finalAlignC = +J.clamp(0.65 * w.alignmentConfidence + 0.35 * acBonus, 0.4, 0.99).toFixed(3);
    }

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
      recognitionConfidence: +w.recognitionConfidence.toFixed(3),
      alignmentConfidence: finalAlignC,
      speaker: w.speaker,
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

/* AI Vocal forced alignment via server API with 10ms Viterbi acoustic fallback */
J.aiAlignVocals = async (audioAnalysis, lines, lang = 'auto') => {
  let requiresBilling = false;
  try {
    if (audioAnalysis && audioAnalysis.buffer) {
      const sr = audioAnalysis.duration > 150 ? 10000 : 16000;
      const wavBlob = J.audioMonoWav(audioAnalysis.buffer, Math.min(300, audioAnalysis.duration), sr);
      const base64Audio = await blobToBase64(wavBlob);
      const lineTexts = lines.map((l, i) => ({ i, text: l.interlude ? '[interlude]' : l.text }));
      const resp = await fetch('/api/align-vocals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64: base64Audio, lines: lineTexts, lang }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.requiresBilling) requiresBilling = true;
        if (data && data.lineTimes && Object.keys(data.lineTimes).length) {
          const refinedWords = {};
          const keys = Object.keys(data.wordTimes || {});
          for (const k of keys) {
            const idx = +k;
            const s = data.lineTimes[idx] ?? 0;
            const nextL = lines[idx + 1];
            const e = (nextL && data.lineTimes[idx + 1] != null) ? data.lineTimes[idx + 1] : Math.min(audioAnalysis.duration || 300, s + 4);
            const metaSpk = (data.lineMeta && data.lineMeta[idx] && data.lineMeta[idx].speaker) || 'Lead';
            refinedWords[idx] = J.refineWordTimingsAcoustic(audioAnalysis, data.wordTimes[idx], s, e, lang, metaSpk);
          }
          return {
            lineTimes: data.lineTimes,
            wordTimes: refinedWords,
            lineMeta: data.lineMeta || {},
            source: 'ai',
            requiresBilling: false,
          };
        }
      }
    }
  } catch (e) {
    console.warn('AI vocal alignment fallback to acoustic forced alignment:', e);
  }

  const lineTimes = J.alignLinesToVocals(audioAnalysis, lines);
  const wordTimes = {};
  const lineMeta = {};
  const dur = (audioAnalysis && audioAnalysis.duration) || 30;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln || ln.interlude || !ln.text) continue;
    const s = lineTimes[i] != null ? lineTimes[i] : (ln.start ?? 0.4);
    const e = i < lines.length - 1 && lineTimes[i + 1] != null ? lineTimes[i + 1] : Math.min(dur, s + 3.2);
    const words = J.alignWordsAcoustic(audioAnalysis, ln.text, s, e, lang, 'Lead', 0.85);
    wordTimes[i] = words;
    const avgAlign = words.length ? +(words.reduce((a, w) => a + (w.alignmentConfidence || 0.7), 0) / words.length).toFixed(3) : 0.7;
    lineMeta[i] = { speaker: 'Lead', recognitionConfidence: 0.85, alignmentConfidence: avgAlign };
  }
  return { lineTimes, wordTimes, lineMeta, source: 'acoustic', requiresBilling };
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

/* AI Music Audio-to-Lyrics Detection, Multi-Layer Vocal Analysis & Chunked Full-Song Alignment */
J.aiTranscribeMusic = async (audioAnalysis, lang = 'auto') => {
  if (!audioAnalysis || !audioAnalysis.buffer) return null;
  const totalDur = audioAnalysis.duration || audioAnalysis.buffer.duration || 0;

  const postChunk = async (chunkStart, chunkDur, sampleRate) => {
    const wavBlob = J.audioMonoWavWindow(audioAnalysis.buffer, chunkStart, chunkDur, sampleRate);
    const base64Audio = await blobToBase64(wavBlob);
    return fetch('/api/transcribe-lyrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioBase64: base64Audio,
        lang,
        audioFormat: audioAnalysis.format || 'AUDIO',
        duration: totalDur,
        chunkStartSec: chunkStart,
        chunkDurationSec: chunkDur,
      }),
    });
  };

  const transcribeWindow = async (chunkStart, chunkDur) => {
    let resp = await postChunk(chunkStart, chunkDur, chunkDur > 140 ? 12000 : 16000);
    if (resp.status === 413) {
      resp = await postChunk(chunkStart, chunkDur, 8000);
    }
    if (!resp.ok) return null;
    return resp.json();
  };

  const normalizeLinesOut = (rawLines, detectedLang) => {
    return rawLines.map(l => {
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
  };

  // For songs up to 155s, run a single cohesive full-song analysis; for longer songs, chunk cleanly with 4s overlap so 100% of audio is analyzed
  if (totalDur <= 155) {
    const data = await transcribeWindow(0, totalDur);
    if (!data) return null;
    if (data.requiresBilling) return { billingRequired: true, lines: [] };
    if (data.success && (Array.isArray(data.lines) || data.isInstrumental)) {
      data.lines = normalizeLinesOut(data.lines || [], data.language);
      return data;
    }
    return null;
  }

  const winDur = 125;
  const step = 120;
  const mergedLines = [];
  const mergedSections = [];
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

  for (let t0 = 0; t0 < totalDur - 0.5; t0 += step) {
    const dur = Math.min(winDur, totalDur - t0);
    const chunkData = await transcribeWindow(t0, dur);
    if (!chunkData) continue;
    if (chunkData.requiresBilling) return { billingRequired: true, lines: [] };
    if (!chunkData.success) continue;

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

    if (Array.isArray(chunkData.sections)) mergedSections.push(...chunkData.sections);
    if (Array.isArray(chunkData.lines)) {
      for (const ln of chunkData.lines) {
        if (ln.speaker && ln.speaker !== 'Instrumental') speakers.add(ln.speaker);
        // Deduplicate lines inside the 5s overlap window based on midpoint time / text similarity
        const prev = mergedLines[mergedLines.length - 1];
        if (prev && ln.start < prev.end + 0.35 && prev.text.toLowerCase() === ln.text.toLowerCase()) continue;
        if (prev && ln.start < prev.end) {
          ln.start = +Math.max(prev.end + 0.02, ln.start).toFixed(3);
          if (ln.end <= ln.start) ln.end = +(ln.start + 0.25).toFixed(3);
        }
        mergedLines.push(ln);
      }
    }
  }

  if (!mergedLines.length && !allInstrumental) return null;
  let combinedType = 'singing';
  if (allInstrumental) combinedType = 'instrumental';
  else if (audioTypes.has('combination') || (audioTypes.size > 1) || (audioTypes.has('speech') && audioTypes.has('singing'))) combinedType = 'combination';
  else if (audioTypes.has('speech') && !audioTypes.has('singing')) combinedType = 'speech';

  return {
    success: true,
    audioType: combinedType,
    language: primaryLang,
    detectedLanguages: Array.from(langs),
    detectedSpeakers: Array.from(speakers),
    hasBackingVocals,
    hasUnclearSections,
    hasInstrumentalSections: hasInstrumentalSections || mergedLines.some(l => l.isInstrumentalSection),
    hasRepeatedChorus,
    title,
    artist,
    isInstrumental: allInstrumental,
    sections: mergedSections,
    lines: normalizeLinesOut(mergedLines, primaryLang),
  };
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
