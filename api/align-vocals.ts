import type { IncomingMessage, ServerResponse } from 'http';
import { GoogleGenAI, Type } from '@google/genai';

interface InputLine {
  i?: number;
  index?: number;
  text: string;
}

interface ApiReq extends IncomingMessage {
  method?: string;
  body?: { audioBase64?: string; separatedVocalBase64?: string; lines?: InputLine[]; lang?: string };
}

interface ApiRes extends ServerResponse {
  status: (code: number) => ApiRes;
  json: (data: unknown) => void;
}

interface RawChar {
  ch?: string;
  start?: number;
  end?: number;
}

interface RawPhoneme {
  unit?: string;
  start?: number;
  end?: number;
}

interface RawWord {
  text?: string;
  start?: number;
  end?: number;
  recognitionConfidence?: number;
  alignmentConfidence?: number;
  audioClarity?: number;
  vocalOverlap?: number;
  speaker?: string;
  flags?: string[];
  phonemes?: RawPhoneme[];
  chars?: RawChar[];
}

interface AlignmentItem {
  index?: number;
  start?: number;
  end?: number;
  speaker?: string;
  recognitionConfidence?: number;
  alignmentConfidence?: number;
  flags?: string[];
  validationNote?: string;
  words?: RawWord[];
}

function clampConf(val: unknown, fallback = 0.84) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  // Never falsely claim 100% automated accuracy: honest upper bound 0.98
  return +Math.max(0.05, Math.min(0.98, n)).toFixed(3);
}

function classifyWordTierServer(recConf: number, alignConf: number, clarity: number, overlap: number, flags: string[]) {
  const f = new Set(flags || []);
  const hasUnc = f.has('uncertain_word') || f.has('misrecognized_word') || f.has('missing_word');
  const hasBnd = f.has('uncertain_boundary');
  const overlapPenalty = overlap > 0.45 ? 0.14 : overlap > 0.25 ? 0.06 : 0;
  const clarityPenalty = clarity < 0.45 ? 0.16 : clarity < 0.65 ? 0.06 : 0;
  const overall = Math.max(0.05, Math.min(0.97, +(0.42 * recConf + 0.36 * alignConf + 0.22 * clarity - overlapPenalty - clarityPenalty).toFixed(3)));
  const uncertainty = +Math.max(0.02, Math.min(0.95, 1 - overall)).toFixed(3);
  let tier: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM';
  if (!hasUnc && !hasBnd && overlap <= 0.35 && clarity >= 0.65 && recConf >= 0.78 && alignConf >= 0.78 && overall >= 0.78) {
    tier = 'HIGH';
  } else if (hasUnc || recConf < 0.65 || alignConf < 0.62 || clarity < 0.45 || overall < 0.58) {
    tier = 'LOW';
  }
  return { overall, uncertainty, tier };
}

const VALID_WORD_FLAGS = new Set([
  'uncertain_word',
  'missing_word',
  'misrecognized_word',
  'overlapping_vocals',
  'uncertain_boundary',
]);

function normalizeFlagsList(rawFlags: unknown, recConf: number, alignConf: number, vocalType: string, isUnclear: boolean) {
  const set = new Set<string>();
  if (Array.isArray(rawFlags)) {
    for (const f of rawFlags) {
      const s = String(f || '').trim().toLowerCase();
      if (VALID_WORD_FLAGS.has(s)) set.add(s);
    }
  }
  if (isUnclear || recConf < 0.72) set.add('uncertain_word');
  if (recConf < 0.52 && !isUnclear) set.add('misrecognized_word');
  if (alignConf < 0.70) set.add('uncertain_boundary');
  if (vocalType === 'overlapping' || vocalType === 'harmony' || vocalType === 'backing') set.add('overlapping_vocals');
  return Array.from(set);
}

function buildCharTimingsServer(wordText: string, start: number, end: number, rawChars?: RawChar[]) {
  const chars = Array.from(wordText);
  const n = chars.length;
  if (!n || end <= start) return chars.map(ch => ({ ch, start, end }));
  if (Array.isArray(rawChars) && rawChars.length === n) {
    let cPrev = start;
    const out: Array<{ ch: string; start: number; end: number }> = [];
    for (let i = 0; i < n; i++) {
      const rc = rawChars[i];
      let cs = Number(rc?.start);
      let ce = Number(rc?.end);
      cs = Number.isFinite(cs) ? Math.max(cPrev, Math.min(end - 0.004, cs)) : cPrev;
      ce = Number.isFinite(ce) ? Math.min(end, Math.max(cs + 0.004, ce)) : (i === n - 1 ? end : Math.min(end, cs + Math.max(0.01, (end - cs) / (n - i))));
      if (i === n - 1) ce = end;
      cs = +cs.toFixed(3);
      ce = +Math.max(cs + 0.004, ce).toFixed(3);
      cPrev = ce;
      out.push({ ch: chars[i], start: cs, end: ce });
    }
    return out;
  }
  const weights = chars.map(ch => {
    if (/[aeiouyàâäéèêëîïôöùûüÿæœ]/i.test(ch)) return 1.35;
    if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(ch)) return 1.4;
    if (/[a-zA-Z0-9À-ÿ]/.test(ch)) return 0.9;
    return 0.3;
  });
  const total = weights.reduce((a, b) => a + b, 0) || n;
  const dur = end - start;
  let cur = start;
  return chars.map((ch, idx) => {
    const step = (weights[idx] / total) * dur;
    const cs = +cur.toFixed(3);
    cur += step;
    const ce = idx === n - 1 ? +end.toFixed(3) : +Math.max(cs + 0.008, cur).toFixed(3);
    return { ch, start: cs, end: ce };
  });
}

function normalizeWords(
  text: string,
  start: number,
  end: number,
  rawWords: RawWord[],
  lineSpeaker = 'Lead',
  lineRecConf = 0.92,
  lineAlignConf = 0.9,
  lineFlags: string[] = [],
) {
  const words: Array<{
    text: string;
    start: number;
    end: number;
    chars: Array<{ ch: string; start: number; end: number }>;
    phonemes?: Array<{ unit: string; start: number; end: number }>;
    recognitionConfidence: number;
    alignmentConfidence: number;
    audioClarity: number;
    vocalOverlap: number;
    recognitionUncertainty: number;
    qualityTier: 'HIGH' | 'MEDIUM' | 'LOW';
    speaker: string;
    flags: string[];
  }> = [];
  if (rawWords && rawWords.length > 0) {
    let wPrev = start;
    for (let wi = 0; wi < rawWords.length; wi++) {
      const w = rawWords[wi];
      const wText = String(w?.text || '').trim();
      if (!wText) continue;
      let ws = Number(w?.start);
      let we = Number(w?.end);
      if (!Number.isFinite(ws) || ws < wPrev) ws = wPrev;
      if (ws > end - 0.02) ws = Math.max(start, end - 0.02);
      if (!Number.isFinite(we) || we <= ws) we = ws + Math.max(0.04, (end - ws) / Math.max(1, rawWords.length - wi));
      if (we > end) we = end;
      ws = +ws.toFixed(3);
      we = +Math.max(ws + 0.015, we).toFixed(3);
      wPrev = we;
      const phonemes = Array.isArray(w?.phonemes)
        ? w.phonemes.map(ph => ({
            unit: String(ph?.unit || '').trim(),
            start: +(Math.max(ws, Math.min(we, Number(ph?.start) || 0))).toFixed(3),
            end: +(Math.max(ws + 0.005, Math.min(we, Number(ph?.end) || 0))).toFixed(3),
          })).filter(ph => ph.unit)
        : undefined;
      const wRec = clampConf(w?.recognitionConfidence, lineRecConf);
      const wAlign = clampConf(w?.alignmentConfidence, lineAlignConf);
      const wUnclear = /\[unclear/i.test(wText);
      const wClarity = clampConf(w?.audioClarity, wUnclear ? 0.32 : 0.78);
      const wOverlap = +Math.max(0, Math.min(1, Number(w?.vocalOverlap ?? 0.08))).toFixed(3);
      const wFlags = normalizeFlagsList(w?.flags, wRec, wAlign, 'singing', wUnclear);
      const qMeta = classifyWordTierServer(wRec, wAlign, wClarity, wOverlap, wFlags);
      words.push({
        text: wText,
        start: ws,
        end: we,
        chars: buildCharTimingsServer(wText, ws, we, w?.chars),
        phonemes: phonemes && phonemes.length ? phonemes : undefined,
        recognitionConfidence: wRec,
        alignmentConfidence: wAlign,
        audioClarity: wClarity,
        vocalOverlap: wOverlap,
        recognitionUncertainty: qMeta.uncertainty,
        qualityTier: qMeta.tier,
        speaker: String(w?.speaker || lineSpeaker).trim(),
        flags: wFlags,
      });
    }
  }
  if (!words.length && text) {
    const tokens = text.match(/[A-Za-zÀ-ÿ\u1e00-\u1eff0-9'’\-]+[,.;:!?…]?|[\u4e00-\u9fff\u3400-\u4dbf]|[\u3040-\u309f\u30a0-\u30ff][\u3041\u3043\u3045\u3047\u3049\u3063\u3083\u3085\u3087\u308e\u30a1\u30a3\u30a5\u30a7\u30a9\u30c3\u30e3\u30e5\u30e7\u30ee\u30fc]?|[\uac00-\ud7af]|[^\s]/g) || [text];
    const weights = tokens.map(tk => Math.max(0.8, tk.replace(/[^A-Za-zÀ-ÿ\u1e00-\u1eff0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, '').length));
    const totalW = weights.reduce((a, b) => a + b, 0) || tokens.length;
    let cur = start;
    tokens.forEach((tk, wi) => {
      const dur = (weights[wi] / totalW) * (end - start);
      const ws = +cur.toFixed(3);
      cur += dur;
      const we = wi === tokens.length - 1 ? end : +Math.max(ws + 0.015, cur).toFixed(3);
      const wAlign = +(Math.max(0.45, Math.min(0.92, lineAlignConf * 0.78))).toFixed(3);
      const wClarity = 0.74;
      const wOverlap = 0.1;
      const wFlags = normalizeFlagsList(lineFlags, lineRecConf, wAlign, 'singing', false);
      const qMeta = classifyWordTierServer(lineRecConf, wAlign, wClarity, wOverlap, wFlags);
      words.push({
        text: tk,
        start: ws,
        end: we,
        chars: buildCharTimingsServer(tk, ws, we),
        recognitionConfidence: lineRecConf,
        alignmentConfidence: wAlign,
        audioClarity: wClarity,
        vocalOverlap: wOverlap,
        recognitionUncertainty: qMeta.uncertainty,
        qualityTier: qMeta.tier,
        speaker: lineSpeaker,
        flags: wFlags,
      });
    });
  }
  return words;
}

export default async function handler(req: ApiReq, res: ApiRes) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, reason: 'method_not_allowed' });
    return;
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const { audioBase64, separatedVocalBase64, lines, lang } = req.body || {};
    if (!apiKey || !audioBase64 || !lines || !lines.length) {
      res.status(200).json({ success: false, reason: 'ai_not_configured' });
      return;
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const prompt = `You are a singing-aware forced-alignment & acoustic phonetics engine (Stages 4-6).
Analyze BOTH the original mix reference${separatedVocalBase64 ? ' AND the center-isolated vocal stem provided' : ''}. Language hint: ${lang || 'auto'}.
Ordered list of lyric lines to align:
${JSON.stringify(lines, null, 2)}

CRITICAL SINGING-AWARE ALIGNMENT & VALIDATION RULES:
- Distinguish actual SINGING performance (sustained vowels, vibrato, melisma, vocal onsets) from ordinary speech or musical beats.
- NEVER divide line duration equally among words, NEVER estimate from text length, and NEVER replace vocal alignment with music beat timing.
- Use phonetic/phoneme-level analysis ("phonemes": [{ "unit": string, "start": number, "end": number }]) to derive exact word and character start/end boundaries when sung words are sustained or legato.
- For Chinese, Japanese, and Korean, output individual Chinese character / kana mora / Hangul syllable boundaries accurately.
- Preserve silent pauses and breath gaps cleanly between words.
- Stage 6 Validation: Compare provided lyrics honestly against the actual singing audio. In "flags", include any of:
  * "uncertain_word" (unclear pronunciation / masking)
  * "missing_word" (singer clearly sings additional audible words not present in provided text, or expected words absent)
  * "misrecognized_word" (provided lyric clearly contradicts sung audio)
  * "overlapping_vocals" (duet / harmony / backing vocals overlap during this token)
  * "uncertain_boundary" (ambiguous legato/reverb boundary)`;

    const contentParts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> = [
      { inlineData: { mimeType: 'audio/wav', data: audioBase64 } },
    ];
    if (separatedVocalBase64) {
      contentParts.push({ inlineData: { mimeType: 'audio/wav', data: separatedVocalBase64 } });
    }
    contentParts.push({ text: prompt });

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: contentParts,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            alignments: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  index: { type: Type.INTEGER },
                  start: { type: Type.NUMBER },
                  end: { type: Type.NUMBER },
                  speaker: { type: Type.STRING },
                  recognitionConfidence: { type: Type.NUMBER },
                  alignmentConfidence: { type: Type.NUMBER },
                  flags: { type: Type.ARRAY, items: { type: Type.STRING } },
                  validationNote: { type: Type.STRING },
                  words: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        text: { type: Type.STRING },
                        start: { type: Type.NUMBER },
                        end: { type: Type.NUMBER },
                        recognitionConfidence: { type: Type.NUMBER },
                        alignmentConfidence: { type: Type.NUMBER },
                        speaker: { type: Type.STRING },
                        flags: { type: Type.ARRAY, items: { type: Type.STRING } },
                        phonemes: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              unit: { type: Type.STRING },
                              start: { type: Type.NUMBER },
                              end: { type: Type.NUMBER },
                            },
                            required: ['unit', 'start', 'end'],
                          },
                        },
                        chars: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              ch: { type: Type.STRING },
                              start: { type: Type.NUMBER },
                              end: { type: Type.NUMBER },
                            },
                            required: ['ch', 'start', 'end'],
                          },
                        },
                      },
                      required: ['text', 'start', 'end'],
                    },
                  },
                },
                required: ['index', 'start', 'end'],
              },
            },
          },
          required: ['alignments'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    const lineTimes: Record<number, number> = {};
    const wordTimes: Record<number, unknown[]> = {};
    const lineMeta: Record<number, {
      speaker: string;
      recognitionConfidence: number;
      alignmentConfidence: number;
      flags: string[];
      validationNote: string;
    }> = {};
    if (parsed.alignments && Array.isArray(parsed.alignments)) {
      const sorted = (parsed.alignments as AlignmentItem[]).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      let prevEnd = 0;
      for (const item of sorted) {
        if (typeof item.index === 'number' && typeof item.start === 'number') {
          const s = +Math.max(prevEnd, item.start).toFixed(3);
          const e = +Math.max(s + 0.15, typeof item.end === 'number' ? item.end : s + 2.0).toFixed(3);
          prevEnd = e;
          const spk = String(item.speaker || 'Lead').trim();
          const recC = clampConf(item.recognitionConfidence, 0.92);
          const alignC = clampConf(item.alignmentConfidence, 0.9);
          const lFlags = normalizeFlagsList(item.flags, recC, alignC, 'singing', false);
          lineTimes[item.index] = s;
          lineMeta[item.index] = {
            speaker: spk,
            recognitionConfidence: recC,
            alignmentConfidence: alignC,
            flags: lFlags,
            validationNote: item.validationNote ? String(item.validationNote).trim() : '',
          };
          const srcLine = lines.find(l => l.i === item.index || l.index === item.index);
          const srcText = srcLine?.text || (item.words || []).map(w => w.text || '').join(' ');
          wordTimes[item.index] = normalizeWords(srcText, s, e, item.words || [], spk, recC, alignC, lFlags);
        }
      }
    }

    res.status(200).json({ success: true, lineTimes, wordTimes, lineMeta });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err || '');
    const e = err as { status?: string; code?: number };
    const isBilling =
      msg.includes('billing') ||
      msg.includes('free tier') ||
      e?.status === 'PERMISSION_DENIED' ||
      e?.code === 403;
    res.status(200).json({
      success: false,
      reason: isBilling ? 'billing_required' : 'alignment_error',
      requiresBilling: isBilling,
    });
  }
}
