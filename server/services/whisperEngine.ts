import { spawn } from 'node:child_process';
import path from 'node:path';
import {
  analyzeAndFixOrthography,
  evaluateVoiceWordRepair,
  type OrthographyChange,
  type VoiceDivergence,
} from './lyricSpellReconciler.ts';
import {
  containsHanzi,
  detectMandarinScript,
  mandarinCharSimilarity,
} from './mandarinTools.ts';

export interface WhisperWordToken {
  text: string;
  start: number;
  end: number;
  recognitionConfidence: number;
  alignmentConfidence: number;
  audioClarity: number;
  vocalOverlap: number;
  speaker: string;
  flags: string[];
}

export interface WhisperKaraokeLine {
  text: string;
  start: number;
  end: number;
  section: string;
  vocalType: string;
  language: string;
  speaker: string;
  recognitionConfidence: number;
  alignmentConfidence: number;
  isRepeatedChorus: boolean;
  backingText: string;
  unclear: boolean;
  isInstrumentalSection: boolean;
  flags: string[];
  validationNote: string;
  words: WhisperWordToken[];
}

export interface WhisperTranscribeResult {
  success: boolean;
  audioType: string;
  language: string;
  detectedLanguages: string[];
  detectedSpeakers: string[];
  hasBackingVocals: boolean;
  hasUnclearSections: boolean;
  hasInstrumentalSections: boolean;
  hasRepeatedChorus: boolean;
  isInstrumental: boolean;
  lines: WhisperKaraokeLine[];
  rawTranscript: string;
  engine: string;
}

const LANG_TO_WHISPER: Record<string, string | undefined> = {
  fr: 'french',
  en: 'english',
  'zh-hans': 'chinese',
  'zh-hant': 'chinese',
  zh: 'chinese',
  ja: 'japanese',
  ko: 'korean',
  es: 'spanish',
  de: 'german',
  it: 'italian',
  pt: 'portuguese',
  ar: 'arabic',
  ru: 'russian',
  vi: 'vietnamese',
  id: 'indonesian',
  th: 'thai',
};

const HALLUCINATION_PATTERNS = [
  /sous-titres?\s+(?:r[ée]alis[ée]s?|par|d['’])/i,
  /amara\.org/i,
  /merci\s+d['’]avoir\s+regard[ée]/i,
  /thank\s+you\s+for\s+watching/i,
  /thanks?\s+for\s+watching/i,
  /please\s+subscribe/i,
  /abonne[rz]?-?vous/i,
  /请不吝点赞|订阅.*频道|转发.*打赏|明镜与点点|优优独播剧场|感谢收看|谢谢观看|中文字幕|字幕提供|字幕制作/,
  /^[.\s,!?…\-♪♫*。，！？、；：]+$/,
  /^(?:you|hmm|uh|ah|oh)\.?$/i,
];

let pipelinePromise: Promise<any> | null = null;
let cachedReady = false;

export function isWhisperWarm(): boolean {
  return cachedReady;
}

export async function getWhisperPipeline(): Promise<any> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.cacheDir = path.resolve(process.cwd(), '.cache/huggingface');
      const asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base', {
        dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
      });
      cachedReady = true;
      return asr;
    })().catch(err => {
      pipelinePromise = null;
      cachedReady = false;
      throw err;
    });
  }
  return pipelinePromise;
}

export function warmupWhisper(): void {
  getWhisperPipeline().catch(() => {
    // Non-fatal background warmup; endpoint handles on-demand load cleanly
  });
}

function decodeWavFallback(wavBuf: Buffer): { pcm: Float32Array; sampleRate: number } | null {
  if (wavBuf.length < 44) return null;
  if (wavBuf.toString('ascii', 0, 4) !== 'RIFF' || wavBuf.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }
  let offset = 12;
  let channels = 1;
  let sampleRate = 16000;
  let bitsPerSample = 16;
  let audioFormat = 1;
  let dataStart = -1;
  let dataSize = 0;

  while (offset + 8 <= wavBuf.length) {
    const chunkId = wavBuf.toString('ascii', offset, offset + 4);
    const chunkSize = wavBuf.readUInt32LE(offset + 4);
    if (chunkId === 'fmt ' && offset + 24 <= wavBuf.length) {
      audioFormat = wavBuf.readUInt16LE(offset + 8);
      channels = wavBuf.readUInt16LE(offset + 10);
      sampleRate = wavBuf.readUInt32LE(offset + 12);
      bitsPerSample = wavBuf.readUInt16LE(offset + 22);
    } else if (chunkId === 'data') {
      dataStart = offset + 8;
      dataSize = Math.min(chunkSize, wavBuf.length - dataStart);
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  if (dataStart < 0 || dataSize <= 0) return null;
  const bytesPerSample = Math.max(1, bitsPerSample >> 3);
  const frameSize = bytesPerSample * Math.max(1, channels);
  const numFrames = Math.floor(dataSize / frameSize);
  const rawMono = new Float32Array(numFrames);

  for (let i = 0; i < numFrames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const p = dataStart + i * frameSize + c * bytesPerSample;
      if (audioFormat === 3 && bitsPerSample === 32 && p + 4 <= wavBuf.length) {
        sum += wavBuf.readFloatLE(p);
      } else if (bitsPerSample === 16 && p + 2 <= wavBuf.length) {
        sum += wavBuf.readInt16LE(p) / 32768;
      } else if (bitsPerSample === 8 && p < wavBuf.length) {
        sum += (wavBuf.readUInt8(p) - 128) / 128;
      }
    }
    rawMono[i] = Math.max(-1, Math.min(1, sum / Math.max(1, channels)));
  }

  if (sampleRate === 16000) return { pcm: rawMono, sampleRate: 16000 };
  const targetLen = Math.max(1, Math.floor((numFrames / sampleRate) * 16000));
  const resampled = new Float32Array(targetLen);
  const step = sampleRate / 16000;
  for (let i = 0; i < targetLen; i++) {
    const idx = i * step;
    const i0 = Math.floor(idx);
    const i1 = Math.min(numFrames - 1, i0 + 1);
    const frac = idx - i0;
    resampled[i] = rawMono[i0] * (1 - frac) + rawMono[i1] * frac;
  }
  return { pcm: resampled, sampleRate: 16000 };
}

export async function isolateVocalsPcm16k(
  audioBase64: string,
  separatedVocalBase64?: string,
  preferIsolated = true,
): Promise<Float32Array> {
  const chosenB64 = (preferIsolated && separatedVocalBase64) ? separatedVocalBase64 : audioBase64;
  const inputBuf = Buffer.from(chosenB64, 'base64');
  if (!inputBuf.length) return new Float32Array(0);

  // Use ffmpeg vocal-isolation bandpass + gentle denoising + loudness normalization -> 16kHz f32le mono
  try {
    const pcmBuf = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];
      const ff = spawn('ffmpeg', [
        '-hide_banner',
        '-loglevel', 'error',
        '-i', 'pipe:0',
        '-af', 'highpass=f=95,lowpass=f=7500,afftdn=nf=-20,dynaudnorm=f=120:g=7',
        '-ac', '1',
        '-ar', '16000',
        '-f', 'f32le',
        'pipe:1',
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      const killTimer = setTimeout(() => {
        try { ff.kill('SIGKILL'); } catch {}
        reject(new Error('ffmpeg timeout'));
      }, 25000);

      ff.stdout.on('data', (d: Buffer) => chunks.push(d));
      ff.stderr.on('data', (d: Buffer) => errChunks.push(d));
      ff.on('error', err => {
        clearTimeout(killTimer);
        reject(err);
      });
      ff.on('close', code => {
        clearTimeout(killTimer);
        const out = Buffer.concat(chunks);
        if (code === 0 && out.length >= 4) {
          resolve(out);
        } else {
          reject(new Error(Buffer.concat(errChunks).toString('utf8') || `ffmpeg exit ${code}`));
        }
      });

      ff.stdin.on('error', () => {});
      ff.stdin.end(inputBuf);
    });

    const nSamples = Math.floor(pcmBuf.length / 4);
    const out = new Float32Array(nSamples);
    for (let i = 0; i < nSamples; i++) {
      out[i] = pcmBuf.readFloatLE(i * 4);
    }
    return out;
  } catch {
    const parsed = decodeWavFallback(inputBuf);
    return parsed ? parsed.pcm : new Float32Array(0);
  }
}

function measureRms(pcm: Float32Array, startSec: number, endSec: number, sr = 16000): number {
  if (!pcm.length) return 0;
  const i0 = Math.max(0, Math.floor(startSec * sr));
  const i1 = Math.min(pcm.length, Math.ceil(endSec * sr));
  if (i1 <= i0) return 0;
  let sum = 0;
  for (let i = i0; i < i1; i++) {
    sum += pcm[i] * pcm[i];
  }
  return Math.sqrt(sum / (i1 - i0));
}

function isHallucinatedFragment(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return true;
  return HALLUCINATION_PATTERNS.some(rx => rx.test(t));
}

function inferPrimaryScriptLang(text: string, hintLang = 'auto'): string {
  if (hintLang && hintLang !== 'auto' && hintLang !== 'multi') return hintLang;
  const s = String(text || '');
  if (/[\u4e00-\u9fff]/.test(s)) return 'zh-Hans';
  if (/[\u3040-\u30ff]/.test(s)) return 'ja';
  if (/[\uac00-\ud7af]/.test(s)) return 'ko';
  if (/[éèêëàâçùûüîïôœ]/i.test(s)) return 'fr';
  if (/[ñáéíóú¿¡]/i.test(s)) return 'es';
  if (/[äöüß]/i.test(s)) return 'de';
  return 'en';
}

function buildKaraokeLinesFromWhisperChunks(
  rawChunks: Array<{ text?: string; timestamp?: [number | null, number | null] }>,
  pcm: Float32Array,
  offsetSec = 0,
  clipDurationSec = 30,
  hintLang = 'auto',
): WhisperKaraokeLine[] {
  const cleanTokens: Array<{ text: string; start: number; end: number; conf: number; clarity: number }> = [];
  let prevEnd = 0;

  for (const ch of rawChunks) {
    const rawTxt = String(ch?.text || '').replace(/\s+/g, ' ').trim();
    if (!rawTxt || isHallucinatedFragment(rawTxt)) continue;

    const ts = Array.isArray(ch?.timestamp) ? ch.timestamp : [null, null];
    let s = typeof ts[0] === 'number' && Number.isFinite(ts[0]) ? Math.max(0, ts[0]) : prevEnd;
    if (s < prevEnd) s = prevEnd;
    let e = typeof ts[1] === 'number' && Number.isFinite(ts[1]) ? Math.max(s + 0.06, ts[1]) : Math.min(clipDurationSec, s + 0.35);
    e = Math.max(s + 0.04, Math.min(clipDurationSec, e));
    prevEnd = e;

    const segRms = measureRms(pcm, s, e);
    if (segRms < 0.004 && cleanTokens.length > 0 && rawTxt.length <= 2) continue;
    const clarity = Math.min(0.95, Math.max(0.45, 0.55 + Math.min(0.4, segRms * 4.5)));
    const recConf = Math.min(0.95, Math.max(0.68, 0.78 + Math.min(0.16, segRms * 2.2)));

    // Split multi-word segment chunks proportionally if segment-level timestamps were returned
    const rawSubTokens = rawTxt.match(/[A-Za-zÀ-ÿ\u0100-\u024f\u1e00-\u1eff0-9'’\-]+[,.;:!?…]?|[\u4e00-\u9fff\u3400-\u4dbf][、。，．！？]?|[\u3040-\u309f\u30a0-\u30ff]+|[\uac00-\ud7af]+|[^\s]/g) || [rawTxt];
    const subTokens: string[] = [];
    for (const st of rawSubTokens) {
      if (/^[.,!?;:…、。，．！？]+$/.test(st) && subTokens.length) {
        subTokens[subTokens.length - 1] += st;
      } else {
        subTokens.push(st);
      }
    }
    if (subTokens.length === 1) {
      cleanTokens.push({ text: subTokens[0], start: s, end: e, conf: recConf, clarity });
    } else {
      const weights = subTokens.map(tk => estimateTokenAcousticWeight(tk));
      const totW = weights.reduce((a, b) => a + b, 0) || subTokens.length;
      let cur = s;
      subTokens.forEach((tk, idx) => {
        const dur = (weights[idx] / totW) * (e - s);
        const ws = cur;
        cur += dur;
        const we = idx === subTokens.length - 1 ? e : Math.max(ws + 0.03, cur);
        cleanTokens.push({ text: tk, start: ws, end: we, conf: recConf, clarity });
      });
    }
  }

  if (!cleanTokens.length) return [];

  // Collapse spurious 3+ identical short-word ASR loops caused by sustained musical notes
  const dedupedTokens: typeof cleanTokens = [];
  for (const tk of cleanTokens) {
    const nCur = tk.text.toLowerCase().replace(/[^a-z0-9à-ÿ\u4e00-\u9fff]/g, '');
    const dLen = dedupedTokens.length;
    if (
      dLen >= 2 &&
      nCur &&
      nCur.length <= 12 &&
      dedupedTokens[dLen - 1].text.toLowerCase().replace(/[^a-z0-9à-ÿ\u4e00-\u9fff]/g, '') === nCur &&
      dedupedTokens[dLen - 2].text.toLowerCase().replace(/[^a-z0-9à-ÿ\u4e00-\u9fff]/g, '') === nCur &&
      tk.start - dedupedTokens[dLen - 1].end < 0.35
    ) {
      continue;
    }
    dedupedTokens.push(tk);
  }

  // Regroup word stream into singable karaoke phrases (tight breath splits + CJK char/word cap awareness)
  const isCjkLike = (t: string) => /^[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff]/.test(t);
  const groups: Array<typeof cleanTokens> = [];
  let curGroup: typeof cleanTokens = [];

  for (let i = 0; i < dedupedTokens.length; i++) {
    const tk = dedupedTokens[i];
    const prev = curGroup[curGroup.length - 1];
    const gap = prev ? tk.start - prev.end : 0;
    const isGroupCjk = curGroup.some(x => isCjkLike(x.text));
    const curChars = curGroup.reduce((sum, x) => sum + x.text.length, 0);
    const curDur = curGroup.length ? tk.end - curGroup[0].start : 0;
    const prevEndsSentence = prev ? /[.!?。！？…]$/.test(prev.text) : false;
    const prevEndsClause = prev ? /[,;:，；、]$/.test(prev.text) && curGroup.length >= (isGroupCjk ? 4 : 3) : false;
    const charCap = isGroupCjk ? 18 : 44;
    const wordCap = isGroupCjk ? 16 : 9;

    if (
      curGroup.length > 0 &&
      (gap >= 0.40 || prevEndsSentence || prevEndsClause || curGroup.length >= wordCap || curChars >= charCap || curDur >= 4.4)
    ) {
      groups.push(curGroup);
      curGroup = [];
    }
    curGroup.push(tk);
  }
  if (curGroup.length) groups.push(curGroup);

  return groups.map(grp => {
    const startAbs = +(grp[0].start + offsetSec).toFixed(3);
    const endAbs = +(Math.max(grp[0].start + 0.12, grp[grp.length - 1].end) + offsetSec).toFixed(3);

    let lineText = '';
    grp.forEach((tk, i) => {
      if (i === 0) lineText += tk.text;
      else if (isCjkLike(tk.text) && isCjkLike(grp[i - 1].text)) lineText += tk.text;
      else if (/^[,.;:!?…，。！？]$/.test(tk.text)) lineText += tk.text;
      else lineText += ' ' + tk.text;
    });
    lineText = lineText.trim();

    const avgRec = +(grp.reduce((a, x) => a + x.conf, 0) / grp.length).toFixed(3);
    const langDetected = inferPrimaryScriptLang(lineText, hintLang);

    const words: WhisperWordToken[] = grp.map(tk => ({
      text: tk.text,
      start: +(tk.start + offsetSec).toFixed(3),
      end: +(Math.max(tk.start + 0.025, tk.end) + offsetSec).toFixed(3),
      recognitionConfidence: +tk.conf.toFixed(3),
      alignmentConfidence: 0.87,
      audioClarity: +tk.clarity.toFixed(3),
      vocalOverlap: 0.12,
      speaker: 'Lead',
      flags: tk.conf < 0.72 ? ['uncertain_word'] : [],
    }));

    return {
      text: lineText,
      start: startAbs,
      end: endAbs,
      section: 'verse',
      vocalType: 'singing',
      language: langDetected,
      speaker: 'Lead',
      recognitionConfidence: avgRec,
      alignmentConfidence: 0.87,
      isRepeatedChorus: false,
      backingText: '',
      unclear: false,
      isInstrumentalSection: false,
      flags: avgRec < 0.72 ? ['uncertain_word'] : [],
      validationNote: '',
      words,
    };
  });
}

export async function transcribeWithWhisper(params: {
  audioBase64: string;
  separatedVocalBase64?: string;
  lang?: string;
  chunkStartSec?: number;
  chunkDurationSec?: number;
  onProgress?: (evt: { stage: number; event: string; payload?: any }) => void;
}): Promise<WhisperTranscribeResult> {
  const { audioBase64, separatedVocalBase64, lang = 'auto', chunkStartSec = 0, chunkDurationSec = 30, onProgress } = params;
  const offsetSec = Math.max(0, Number(chunkStartSec) || 0);

  onProgress?.({ stage: 2, event: 'stage', payload: { label: 'separation' } });
  let pcm = await isolateVocalsPcm16k(audioBase64, separatedVocalBase64, true);
  if (!pcm.length) {
    return {
      success: false,
      audioType: 'instrumental',
      language: lang,
      detectedLanguages: [],
      detectedSpeakers: [],
      hasBackingVocals: false,
      hasUnclearSections: false,
      hasInstrumentalSections: false,
      hasRepeatedChorus: false,
      isInstrumental: true,
      lines: [],
      rawTranscript: '',
      engine: 'whisper-base-q8',
    };
  }

  const clipDur = Math.max(0.5, pcm.length / 16000 || Number(chunkDurationSec) || 30);
  const clipRms = measureRms(pcm, 0, clipDur);

  // If the isolated vocal track has almost no energy, try the original full mix before declaring instrumental
  if (clipRms < 0.005 && separatedVocalBase64) {
    const rawPcm = await isolateVocalsPcm16k(audioBase64, undefined, false);
    if (rawPcm.length && measureRms(rawPcm, 0, rawPcm.length / 16000) > clipRms * 1.4) {
      pcm = rawPcm;
    }
  }

  const finalRms = measureRms(pcm, 0, pcm.length / 16000);
  if (finalRms < 0.003) {
    return {
      success: true,
      audioType: 'instrumental',
      language: 'instrumental',
      detectedLanguages: [],
      detectedSpeakers: [],
      hasBackingVocals: false,
      hasUnclearSections: false,
      hasInstrumentalSections: true,
      hasRepeatedChorus: false,
      isInstrumental: true,
      lines: [],
      rawTranscript: '',
      engine: 'whisper-base-q8',
    };
  }

  onProgress?.({ stage: 3, event: 'stage', payload: { label: 'transcribing' } });
  const asr = await getWhisperPipeline();
  const whisperLang = LANG_TO_WHISPER[String(lang || 'auto').toLowerCase()];

  const runInfer = async (timestampMode: 'word' | true) => {
    return asr(pcm, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: timestampMode,
      task: 'transcribe',
      condition_on_previous_text: false,
      no_speech_threshold: 0.58,
      compression_ratio_threshold: 2.4,
      ...(whisperLang ? { language: whisperLang } : {}),
    });
  };

  let output: any;
  try {
    output = await runInfer('word');
  } catch {
    output = await runInfer(true);
  }

  const rawText = String(output?.text || '').trim();
  const chunks = Array.isArray(output?.chunks) ? output.chunks : [];

  const lines = buildKaraokeLinesFromWhisperChunks(chunks, pcm, offsetSec, clipDur, lang);
  // Apply safe orthography & Mandarin script/contraction polish to recognized lines while preserving Whisper word timestamps
  if (lines.length) {
    const joinedAll = lines.map(l => l.text).join('\n');
    const effectiveOrthLang = (lang === 'auto' && containsHanzi(joinedAll)) ? detectMandarinScript(joinedAll) : lang;
    const orth = analyzeAndFixOrthography(lines.map(l => l.text), effectiveOrthLang);
    lines.forEach((ln, li) => {
      const polished = orth.correctedLines[li];
      if (!polished || polished === ln.text) return;
      ln.text = polished;
      const newToks = tokenizeLineText(polished);
      if (newToks.length === ln.words.length) {
        newToks.forEach((tk, wi) => { ln.words[wi].text = tk; });
      } else if (newToks.length) {
        const s0 = ln.start;
        const e0 = Math.max(s0 + 0.08, ln.end);
        const weights = newToks.map(tk => Math.max(1, tk.length));
        const tot = weights.reduce((a, b) => a + b, 0) || newToks.length;
        let cur = s0;
        ln.words = newToks.map((tk, wi) => {
          const dur = (weights[wi] / tot) * (e0 - s0);
          const ws = +cur.toFixed(3);
          cur += dur;
          const we = wi === newToks.length - 1 ? e0 : +Math.max(ws + 0.025, cur).toFixed(3);
          return {
            text: tk,
            start: ws,
            end: we,
            recognitionConfidence: ln.recognitionConfidence,
            alignmentConfidence: ln.alignmentConfidence,
            audioClarity: 0.78,
            vocalOverlap: 0.12,
            speaker: ln.speaker || 'Lead',
            flags: [],
          };
        });
      }
    });
  }
  const previewLines = lines.map(l => l.text).filter(Boolean);

  if (previewLines.length) {
    onProgress?.({
      stage: 3,
      event: 'transcript_preview',
      payload: { transcript: previewLines.join('\n'), previewLines, offsetSec },
    });
  }

  const detectedLangSet = new Set<string>();
  lines.forEach(l => {
    if (l.language && l.language !== 'auto' && l.language !== 'instrumental') detectedLangSet.add(l.language);
  });
  const primaryLang = detectedLangSet.size === 1
    ? Array.from(detectedLangSet)[0]
    : detectedLangSet.size > 1
    ? 'multi'
    : (lang !== 'auto' ? lang : inferPrimaryScriptLang(rawText, 'en'));

  const isPureInst = lines.length === 0;
  return {
    success: true,
    audioType: isPureInst ? 'instrumental' : 'singing',
    language: isPureInst ? 'instrumental' : primaryLang,
    detectedLanguages: Array.from(detectedLangSet),
    detectedSpeakers: isPureInst ? [] : ['Lead'],
    hasBackingVocals: false,
    hasUnclearSections: false,
    hasInstrumentalSections: isPureInst,
    hasRepeatedChorus: false,
    isInstrumental: isPureInst,
    lines,
    rawTranscript: previewLines.join('\n') || rawText,
    engine: 'whisper-base-q8+ffmpeg-vocal-stem',
  };
}

function estimateTokenAcousticWeight(tk: string): number {
  const clean = String(tk || '').replace(/[^A-Za-zÀ-ÿ\u0100-\u024f\u1e00-\u1eff0-9\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/g, '');
  if (!clean) return 0.35;
  if (/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/.test(clean)) {
    return Math.max(0.95, [...clean].length * 1.25);
  }
  const vowels = clean.match(/[aeiouyàâäéèêëîïôöùûüÿæœ]+/gi);
  const syl = vowels ? vowels.length : 1;
  return Math.max(0.65, syl * 0.92 + clean.length * 0.14);
}

function normTok(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, '');
}

function tokenizeLineText(text: string): string[] {
  return String(text || '').match(
    /[¿¡"«'(\[]?[A-Za-zÀ-ÿ\u0100-\u024f\u1e00-\u1eff0-9]+(?:['’\-][A-Za-zÀ-ÿ\u0100-\u024f\u1e00-\u1eff0-9]+)*[,.;:!?…»"')\]♪♫]*|[\u4e00-\u9fff\u3400-\u4dbf][、。，．！？…]?|[\u3040-\u309f\u30a0-\u30ff][\u3041\u3043\u3045\u3047\u3049\u3063\u3083\u3085\u3087\u308e\u30a1\u30a3\u30a5\u30a7\u30a9\u30c3\u30e3\u30e5\u30e7\u30ee\u30fc]*|[\uac00-\ud7af]+|[^\s]/g,
  ) || [];
}

function joinLineTokens(tokens: string[]): string {
  const isCjkLike = (t: string) => /^[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff]/.test(t);
  let out = '';
  tokens.forEach((tk, i) => {
    if (i === 0) out += tk;
    else if (isCjkLike(tk) && isCjkLike(tokens[i - 1])) out += tk;
    else if (/^[.,!?;:…，。！？»"')\]♪♫]+$/.test(tk)) out += tk;
    else out += ' ' + tk;
  });
  out = out.trim();
  if (/^[a-zà-öø-ÿ]/.test(out)) {
    out = out.charAt(0).toUpperCase() + out.slice(1);
  }
  return out;
}

function levenshteinSim(na: string, nb: string): number {
  if (!na || !nb) return 0;
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return Math.max(0.72, Math.min(na.length, nb.length) / Math.max(na.length, nb.length));
  const la = na.length, lb = nb.length;
  const dp = Array.from({ length: la + 1 }, (_, i) => i);
  for (let j = 1; j <= lb; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= la; i++) {
      const tmp = dp[i];
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (na[i - 1] === nb[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return Math.max(0, 1 - dp[la] / Math.max(la, lb));
}

function phoneticKey(tok: string): string {
  const n = normTok(tok);
  if (!n || /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(n)) return n;
  return n
    .replace(/eaux?/g, 'o')
    .replace(/au/g, 'o')
    .replace(/ou/g, 'u')
    .replace(/ph/g, 'f')
    .replace(/qu/g, 'k')
    .replace(/ch/g, 'sh')
    .replace(/(?:ai|ei|er|ez|et)$/g, 'e')
    .replace(/([a-z])\1+/g, '$1')
    .replace(/(?:ent|es|e|s)$/g, (m, off) => (off > 2 ? '' : m));
}

function tokenSimilarity(a: string, b: string): number {
  if (containsHanzi(a) && containsHanzi(b)) {
    const zhSim = mandarinCharSimilarity(a, b);
    if (zhSim > 0) return zhSim;
  }
  const na = normTok(a);
  const nb = normTok(b);
  if (!na || !nb) return 0;
  const lexSim = levenshteinSim(na, nb);
  if (lexSim >= 0.92) return lexSim;
  const pa = phoneticKey(a);
  const pb = phoneticKey(b);
  const phoSim = (pa && pb) ? levenshteinSim(pa, pb) * 0.9 : 0;
  return Math.max(lexSim, phoSim);
}

/* 3-Stage Neural DTW Alignment + Orthography & Voice-Linked Typo Reconciliation for Synchro Voix:
   1) Pre-analyzes integrated lyrics & repairs spelling/diacritics/contractions FIRST
   2) Links lyrics with vocal audio via Whisper Neural DTW and performs voice-confirmed phonetic repair
   3) Returns aligned timings, corrected lines, change log, and per-line voice divergence diagnostics */
export interface AlignDtwProgressEvent {
  stage: number;
  step: 'orthography' | 'vocal_isolation' | 'asr_decode' | 'dtw_matching' | 'moment_refinement';
  pct: number;
  label: string;
  matchedCount?: number;
  totalTokens?: number;
  spellingFixCount?: number;
  recognizedLines?: Array<{ text: string; start: number; end: number }>;
  partialLineTimes?: Record<number, number>;
  partialWordTimes?: Record<number, any[]>;
}

/* 3-Stage Neural DTW Alignment + Orthography & Voice-Linked Typo Reconciliation for SYNCRO VOIX ET PAROLE:
   1) Pre-analyzes integrated lyrics & repairs spelling/diacritics/contractions FIRST
   2) Links lyrics with vocal audio via Whisper Neural DTW and performs voice-confirmed phonetic repair
   3) Streams moment-by-moment aligned timings, corrected lines, change log, and per-line voice divergence diagnostics */
export async function alignLyricsWithWhisperDTW(params: {
  audioBase64: string;
  separatedVocalBase64?: string;
  lines: Array<{ i?: number; index?: number; text: string }>;
  lang?: string;
  vocalSegments?: Array<{ start: number; end: number }>;
  onProgress?: (evt: AlignDtwProgressEvent) => void;
}): Promise<{
  success: boolean;
  matchedCount: number;
  matchRatio: number;
  lineTimes: Record<number, number>;
  wordTimes: Record<number, any[]>;
  lineMeta: Record<number, any>;
  lineMatchRatios: Record<number, number>;
  stretchedLineIndices: number[];
  corrections: OrthographyChange[];
  spellingFixCount: number;
  correctedLines: Record<number, string>;
  correctedText: string;
  divergences: VoiceDivergence[];
  detectedLanguage: string;
  recognizedLines: WhisperKaraokeLine[];
  recognizedTranscript: string;
  engine: string;
}> {
  const { audioBase64, separatedVocalBase64, lines, lang = 'auto', vocalSegments = [], onProgress } = params;

  // Stage A: Analyze integrated lyrics FIRST to fix orthography, accents, and missing apostrophes
  const inputEntries = lines.map((ln, k) => ({
    lineIdx: typeof ln.i === 'number' ? ln.i : (typeof ln.index === 'number' ? ln.index : k),
    rawText: String(ln.text || '').trim(),
  }));
  const preAudit = analyzeAndFixOrthography(inputEntries.map(e => e.rawText), lang);
  const allCorrections: OrthographyChange[] = preAudit.changes.map(ch => ({
    ...ch,
    lineIdx: inputEntries[ch.lineIdx]?.lineIdx ?? ch.lineIdx,
  }));
  onProgress?.({
    stage: 1,
    step: 'orthography',
    pct: 14,
    label: 'Analyse orthographe & extraction vocale…',
    spellingFixCount: allCorrections.length,
  });
  const workingLineTexts = new Map<number, string>();
  inputEntries.forEach((e, k) => {
    if (e.rawText && !/^\[interlude/i.test(e.rawText)) {
      workingLineTexts.set(e.lineIdx, preAudit.correctedLines[k] || e.rawText);
    }
  });

  const buildCorrectedPayload = () => {
    const correctedLinesObj: Record<number, string> = {};
    inputEntries.forEach(e => {
      const cur = workingLineTexts.get(e.lineIdx);
      if (cur && cur !== e.rawText) {
        correctedLinesObj[e.lineIdx] = cur;
      }
    });
    const correctedText = inputEntries
      .map(e => workingLineTexts.get(e.lineIdx) || e.rawText)
      .join('\n');
    return { correctedLines: correctedLinesObj, correctedText };
  };

  onProgress?.({
    stage: 2,
    step: 'vocal_isolation',
    pct: 28,
    label: 'Isolation vocale & décodage de la voix chantée…',
    spellingFixCount: allCorrections.length,
  });

  const recognized = await transcribeWithWhisper({
    audioBase64,
    separatedVocalBase64,
    lang: preAudit.detectedLanguage !== 'auto' ? preAudit.detectedLanguage : lang,
    chunkStartSec: 0,
    chunkDurationSec: 300,
  });
  onProgress?.({
    stage: 3,
    step: 'asr_decode',
    pct: 50,
    label: 'Voix décodée — alignement mot à mot en direct…',
    recognizedLines: recognized.lines.slice(0, 24).map(rl => ({ text: rl.text, start: rl.start, end: rl.end })),
  });
  const asrWords: WhisperWordToken[] = recognized.lines.flatMap(l => l.words || []);
  if (!asrWords.length) {
    const cp = buildCorrectedPayload();
    return {
      success: false,
      matchedCount: 0,
      matchRatio: 0,
      lineTimes: {},
      wordTimes: {},
      lineMeta: {},
      lineMatchRatios: {},
      stretchedLineIndices: [],
      corrections: allCorrections,
      spellingFixCount: allCorrections.length,
      correctedLines: cp.correctedLines,
      correctedText: cp.correctedText,
      divergences: [],
      detectedLanguage: preAudit.detectedLanguage,
      recognizedLines: recognized.lines,
      recognizedTranscript: recognized.rawTranscript,
      engine: recognized.engine,
    };
  }

  // Build flat list of tokens from Stage-A corrected lyrics mapped back to original line index
  const flatUser: Array<{ lineIdx: number; tokIdx: number; text: string }> = [];
  const lineTokensMap = new Map<number, string[]>();
  for (const entry of inputEntries) {
    const txt = workingLineTexts.get(entry.lineIdx);
    if (!txt || /^\[interlude/i.test(txt)) continue;
    const toks = tokenizeLineText(txt);
    lineTokensMap.set(entry.lineIdx, toks);
    toks.forEach((tk, ti) => flatUser.push({ lineIdx: entry.lineIdx, tokIdx: ti, text: tk }));
  }

  if (!flatUser.length) {
    const cp = buildCorrectedPayload();
    return {
      success: false,
      matchedCount: 0,
      matchRatio: 0,
      lineTimes: {},
      wordTimes: {},
      lineMeta: {},
      lineMatchRatios: {},
      stretchedLineIndices: [],
      corrections: allCorrections,
      spellingFixCount: allCorrections.length,
      correctedLines: cp.correctedLines,
      correctedText: cp.correctedText,
      divergences: [],
      detectedLanguage: preAudit.detectedLanguage,
      recognizedLines: recognized.lines,
      recognizedTranscript: recognized.rawTranscript,
      engine: recognized.engine,
    };
  }

  // Semi-global Smith-Waterman DTW: allows skipping intro/outro speech or unmatching preamble without penalizing lyric entry
  const M = flatUser.length;
  const N = asrWords.length;
  const dp = new Float32Array((M + 1) * (N + 1));
  const ptr = new Uint8Array((M + 1) * (N + 1)); // 1=diag, 2=up(skip user), 3=left(skip asr)
  const idx = (r: number, c: number) => r * (N + 1) + c;

  for (let i = 1; i <= M; i++) { dp[idx(i, 0)] = -0.15 * i; ptr[idx(i, 0)] = 2; }
  for (let j = 1; j <= N; j++) { dp[idx(0, j)] = 0; ptr[idx(0, j)] = 3; }

  for (let i = 1; i <= M; i++) {
    for (let j = 1; j <= N; j++) {
      const sim = tokenSimilarity(flatUser[i - 1].text, asrWords[j - 1].text);
      const matchScore = sim >= 0.52 ? sim * 1.45 : -0.4;
      const dScore = dp[idx(i - 1, j - 1)] + matchScore;
      const uScore = dp[idx(i - 1, j)] - 0.15;
      const lScore = dp[idx(i, j - 1)] - 0.06;
      if (dScore >= uScore && dScore >= lScore) {
        dp[idx(i, j)] = dScore; ptr[idx(i, j)] = 1;
      } else if (uScore >= lScore) {
        dp[idx(i, j)] = uScore; ptr[idx(i, j)] = 2;
      } else {
        dp[idx(i, j)] = lScore; ptr[idx(i, j)] = 3;
      }
    }
  }

  const anchorMatch = new Array<{ start: number; end: number; conf: number } | null>(M).fill(null);
  const anchorAsrIdx = new Int32Array(M).fill(-1);
  const anchorSim = new Float32Array(M);
  // Pick best end column on row M if trailing ASR speech extends beyond pasted lyrics
  let bestEndCol = N;
  let bestEndScore = dp[idx(M, N)];
  const minEndCol = Math.min(N, Math.max(1, Math.floor(M * 0.4)));
  for (let j = minEndCol; j <= N; j++) {
    if (dp[idx(M, j)] > bestEndScore) {
      bestEndScore = dp[idx(M, j)];
      bestEndCol = j;
    }
  }
  let r = M, c = bestEndCol;
  while (r > 0 || c > 0) {
    const p = ptr[idx(r, c)];
    if (p === 1 && r > 0 && c > 0) {
      const sim = tokenSimilarity(flatUser[r - 1].text, asrWords[c - 1].text);
      if (sim >= 0.52) {
        anchorAsrIdx[r - 1] = c - 1;
        anchorSim[r - 1] = sim;
        anchorMatch[r - 1] = {
          start: asrWords[c - 1].start,
          end: asrWords[c - 1].end,
          conf: +(0.72 + 0.24 * sim).toFixed(3),
        };
      }
      r--; c--;
    } else if (p === 2 && r > 0) {
      r--;
    } else if (c > 0) {
      c--;
    } else {
      break;
    }
  }

  const matchedCount = anchorMatch.filter(Boolean).length;
  const matchRatio = +(matchedCount / Math.max(1, M)).toFixed(3);
  onProgress?.({
    stage: 4,
    step: 'dtw_matching',
    pct: 66,
    label: `Coordination DTW : ${matchedCount}/${M} mots ancrés sur la voix…`,
    matchedCount,
    totalTokens: M,
  });
  if (matchedCount === 0) {
    const cp = buildCorrectedPayload();
    return {
      success: false,
      matchedCount: 0,
      matchRatio: 0,
      lineTimes: {},
      wordTimes: {},
      lineMeta: {},
      lineMatchRatios: {},
      stretchedLineIndices: [],
      corrections: allCorrections,
      spellingFixCount: allCorrections.length,
      correctedLines: cp.correctedLines,
      correctedText: cp.correctedText,
      divergences: [],
      detectedLanguage: preAudit.detectedLanguage,
      recognizedLines: recognized.lines,
      recognizedTranscript: recognized.rawTranscript,
      engine: recognized.engine,
    };
  }

  // Stage B: Voice-linked phonetic spelling repair on anchored tokens
  const repairLangHint = preAudit.detectedLanguage !== 'auto' ? preAudit.detectedLanguage : lang;
  const repairedLinesSet = new Set<number>();
  for (let ui = 0; ui < M; ui++) {
    const aIdx = anchorAsrIdx[ui];
    if (aIdx < 0) continue;
    const asrW = asrWords[aIdx];
    const u = flatUser[ui];
    const toks = lineTokensMap.get(u.lineIdx) || [];
    const prevTok = u.tokIdx > 0 ? (toks[u.tokIdx - 1] || '') : '';
    const nextTok = u.tokIdx + 1 < toks.length ? (toks[u.tokIdx + 1] || '') : '';
    const repair = evaluateVoiceWordRepair(
      u.text,
      asrW.text,
      anchorSim[ui],
      asrW.recognitionConfidence,
      repairLangHint,
      prevTok,
      nextTok,
    );
    if (repair.shouldReplace && repair.finalWord && repair.finalWord !== u.text) {
      const prevText = u.text;
      u.text = repair.finalWord;
      if (toks && toks[u.tokIdx] !== undefined) {
        toks[u.tokIdx] = repair.finalWord;
      }
      repairedLinesSet.add(u.lineIdx);
      if (anchorMatch[ui]) {
        anchorMatch[ui]!.conf = Math.max(anchorMatch[ui]!.conf, 0.86);
      }
      const existingFix = allCorrections.find(
        c => c.lineIdx === u.lineIdx && (c.wordIdx === u.tokIdx || c.corrected.toLowerCase() === prevText.toLowerCase()),
      );
      if (existingFix) {
        existingFix.corrected = repair.finalWord;
        existingFix.source = 'voice_phonetic';
        existingFix.start = asrW.start;
      } else {
        allCorrections.push({
          lineIdx: u.lineIdx,
          wordIdx: u.tokIdx,
          original: prevText,
          corrected: repair.finalWord,
          source: 'voice_phonetic',
          start: asrW.start,
        });
      }
    }
  }
  for (const li of repairedLinesSet) {
    const toks = lineTokensMap.get(li);
    if (toks && toks.length) {
      workingLineTexts.set(li, joinLineTokens(toks));
    }
  }

  // Interpolate unmatched user tokens cleanly between anchored Whisper timestamps (respecting VAD & clamping instrumental gaps)
  const maxAudioEnd = asrWords[asrWords.length - 1].end;
  const resolvedTimes: Array<{ start: number; end: number; conf: number; stretched?: boolean }> = new Array(M);
  const cleanVadSegs = Array.isArray(vocalSegments)
    ? vocalSegments
        .map(s => ({ start: Number(s?.start) || 0, end: Number(s?.end) || 0 }))
        .filter(s => s.end > s.start)
        .sort((a, b) => a.start - b.start)
    : [];
  const stretchedLineSet = new Set<number>();

  let i = 0;
  while (i < M) {
    if (anchorMatch[i]) {
      resolvedTimes[i] = anchorMatch[i]!;
      i++;
      continue;
    }
    let j = i;
    while (j < M && !anchorMatch[j]) j++;
    const unanchoredCount = j - i;
    const rawLeft = i > 0 ? resolvedTimes[i - 1].end + 0.01 : Math.max(0, asrWords[0].start - 0.38 * unanchoredCount);
    const hasRightAnchor = j < M && anchorMatch[j] != null;
    const rawRightBound = hasRightAnchor ? Math.max(rawLeft + 0.04, anchorMatch[j]!.start - 0.01) : Math.max(rawLeft + 0.35 * unanchoredCount, maxAudioEnd);

    // Check if an active vocal VAD segment sits inside a wide gap so unanchored lyrics stay off instrumental solos
    let effLeft = rawLeft;
    let effRight = rawRightBound;
    let wasGapStretched = false;
    const rawGapDur = effRight - effLeft;
    const expectedNaturalDur = Math.max(0.4, unanchoredCount * 0.42);
    if (rawGapDur > Math.max(5.5, expectedNaturalDur * 2.2)) {
      const vadInside = cleanVadSegs.filter(vs => vs.end > rawLeft + 0.05 && vs.start < rawRightBound - 0.05);
      if (vadInside.length) {
        effLeft = Math.max(rawLeft, vadInside[0].start);
        effRight = Math.min(rawRightBound, vadInside[vadInside.length - 1].end);
      } else {
        // No vocal energy inside wide instrumental gap: anchor near adjacent boundary without stretching 20s across solo!
        effRight = Math.min(rawRightBound, effLeft + expectedNaturalDur);
        wasGapStretched = true;
      }
    }

    const span = hasRightAnchor
      ? Math.max(0.02 * unanchoredCount, effRight - effLeft)
      : Math.max(0.12 * unanchoredCount, effRight - effLeft);
    const weights = flatUser.slice(i, j).map(u => estimateTokenAcousticWeight(u.text));
    const sumW = weights.reduce((a, b) => a + b, 0) || unanchoredCount;
    let cur = effLeft;
    for (let u = i; u < j; u++) {
      const d = (weights[u - i] / sumW) * span;
      const ws = +cur.toFixed(3);
      cur += d;
      const maxCap = hasRightAnchor ? rawRightBound : cur + 0.05;
      const we = +Math.min(maxCap, Math.max(ws + 0.02, cur)).toFixed(3);
      resolvedTimes[u] = { start: ws, end: we, conf: wasGapStretched ? 0.56 : 0.74, stretched: wasGapStretched };
      if (wasGapStretched) stretchedLineSet.add(flatUser[u].lineIdx);
    }
    i = j;
  }

  const lineTimes: Record<number, number> = {};
  const wordTimes: Record<number, any[]> = {};
  const lineMeta: Record<number, any> = {};
  const lineMatchRatios: Record<number, number> = {};
  const perLine = new Map<number, any[]>();
  const lineAnchorHits = new Map<number, { hit: number; total: number }>();

  flatUser.forEach((u, ui) => {
    const rt = resolvedTimes[ui];
    if (!perLine.has(u.lineIdx)) perLine.set(u.lineIdx, []);
    perLine.get(u.lineIdx)!.push({
      text: u.text,
      start: rt.start,
      end: rt.end,
      recognitionConfidence: rt.conf,
      alignmentConfidence: rt.conf,
      speaker: 'Lead',
      flags: rt.conf < 0.72 ? ['uncertain_boundary'] : [],
    });
    const st = lineAnchorHits.get(u.lineIdx) || { hit: 0, total: 0 };
    st.total++;
    if (anchorMatch[ui]) st.hit++;
    lineAnchorHits.set(u.lineIdx, st);
  });

  const divergences: VoiceDivergence[] = [];
  const totalPerLines = Math.max(1, perLine.size);
  let resolvedLineNum = 0;
  let batchLineTimes: Record<number, number> = {};
  let batchWordTimes: Record<number, any[]> = {};
  const batchStride = Math.max(1, Math.min(4, Math.ceil(totalPerLines / 5)));

  for (const [lineIdx, wArr] of perLine.entries()) {
    if (!wArr.length) continue;
    const ls = wArr[0].start;
    const le = wArr[wArr.length - 1].end;
    lineTimes[lineIdx] = ls;
    wordTimes[lineIdx] = wArr;
    batchLineTimes[lineIdx] = ls;
    batchWordTimes[lineIdx] = wArr;
    resolvedLineNum++;

    const avgC = +(wArr.reduce((s, w) => s + w.alignmentConfidence, 0) / wArr.length).toFixed(3);
    const lineFixes = allCorrections.filter(c => c.lineIdx === lineIdx);
    const hitStat = lineAnchorHits.get(lineIdx) || { hit: 0, total: 1 };
    const lineMatchRatio = +(hitStat.hit / Math.max(1, hitStat.total)).toFixed(3);
    lineMatchRatios[lineIdx] = lineMatchRatio;

    lineMeta[lineIdx] = {
      speaker: 'Lead',
      recognitionConfidence: avgC,
      alignmentConfidence: avgC,
      flags: avgC < 0.75 || stretchedLineSet.has(lineIdx) ? ['uncertain_boundary'] : [],
      validationNote: lineFixes.length
        ? `Whisper DTW + ${lineFixes.length} correction(s)`
        : stretchedLineSet.has(lineIdx)
          ? 'Whisper DTW (zone instrumentale incertaine)'
          : 'Whisper Neural DTW Alignment',
    };

    if (onProgress && (resolvedLineNum % batchStride === 0 || resolvedLineNum === totalPerLines)) {
      const pct = Math.min(86, Math.round(68 + (resolvedLineNum / totalPerLines) * 18));
      onProgress({
        stage: 5,
        step: 'moment_refinement',
        pct,
        label: `Coordination instant par instant (${resolvedLineNum}/${totalPerLines} phrases)…`,
        matchedCount,
        totalTokens: M,
        partialLineTimes: batchLineTimes,
        partialWordTimes: batchWordTimes,
      });
      batchLineTimes = {};
      batchWordTimes = {};
    }

    const overlappingRec = recognized.lines
      .filter(rl => {
        const ov = Math.min(le, rl.end) - Math.max(ls, rl.start);
        const minD = Math.max(0.15, Math.min(le - ls, Math.max(0.2, rl.end - rl.start)));
        return ov >= 0.12 || (ov / minD) >= 0.35;
      })
      .map(rl => rl.text)
      .join(' ')
      .trim();
    const rawEntry = inputEntries.find(e => e.lineIdx === lineIdx);
    const corrLineTxt = workingLineTexts.get(lineIdx) || rawEntry?.rawText || '';

    if (lineFixes.some(f => f.source === 'voice_phonetic')) {
      divergences.push({
        lineIdx,
        type: 'word_replaced_by_voice',
        userText: rawEntry?.rawText || corrLineTxt,
        heardText: overlappingRec || corrLineTxt,
        start: ls,
        end: le,
      });
    } else if (lineFixes.length > 0) {
      divergences.push({
        lineIdx,
        type: 'spelling_fixed',
        userText: rawEntry?.rawText || corrLineTxt,
        heardText: overlappingRec || corrLineTxt,
        start: ls,
        end: le,
      });
    } else if (lineMatchRatio < 0.6 && overlappingRec) {
      divergences.push({
        lineIdx,
        type: 'divergent_phrase',
        userText: rawEntry?.rawText || corrLineTxt,
        heardText: overlappingRec,
        start: ls,
        end: le,
      });
    }
  }

  const cp = buildCorrectedPayload();
  return {
    success: Object.keys(lineTimes).length > 0,
    matchedCount,
    matchRatio,
    lineTimes,
    wordTimes,
    lineMeta,
    lineMatchRatios,
    stretchedLineIndices: Array.from(stretchedLineSet),
    corrections: allCorrections,
    spellingFixCount: allCorrections.length,
    correctedLines: cp.correctedLines,
    correctedText: cp.correctedText,
    divergences,
    detectedLanguage: preAudit.detectedLanguage,
    recognizedLines: recognized.lines,
    recognizedTranscript: recognized.rawTranscript,
    engine: recognized.engine + '+neural-dtw+orthography',
  };
}
