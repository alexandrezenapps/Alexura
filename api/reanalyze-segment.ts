import type { IncomingMessage, ServerResponse } from 'http';
import { GoogleGenAI, Type } from '@google/genai';

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

interface RawLine {
  text?: string;
  start?: number;
  end?: number;
  section?: string;
  vocalType?: string;
  language?: string;
  speaker?: string;
  recognitionConfidence?: number;
  alignmentConfidence?: number;
  isRepeatedChorus?: boolean;
  backingText?: string;
  unclear?: boolean;
  isInstrumentalSection?: boolean;
  flags?: string[];
  validationNote?: string;
  words?: RawWord[];
}

interface QualityConditions {
  isNoisy?: boolean;
  isDistorted?: boolean;
  isReverberated?: boolean;
  hasOverlappingSingers?: boolean;
}

interface ApiReq extends IncomingMessage {
  method?: string;
  body?: {
    audioBase64?: string;
    separatedVocalBase64?: string;
    startSec?: number;
    endSec?: number;
    existingWords?: RawWord[];
    qualityConditions?: QualityConditions;
    lang?: string;
  };
}

interface ApiRes extends ServerResponse {
  status: (code: number) => ApiRes;
  json: (data: unknown) => void;
}

const VALID_WORD_FLAGS = new Set([
  'uncertain_word',
  'missing_word',
  'misrecognized_word',
  'overlapping_vocals',
  'uncertain_boundary',
]);

function clampConf(val: unknown, fallback = 0.84) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
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

function normalizeKaraokeLines(rawLines: RawLine[], chunkOffsetSec = 0) {
  const out = [];
  const off = Math.max(0, Number(chunkOffsetSec) || 0);
  let prevEnd = off;
  for (const l of rawLines) {
    const vocalTypeRaw = String(l?.vocalType || 'singing').toLowerCase();
    const isInst = vocalTypeRaw === 'instrumental' || Boolean(l?.isInstrumentalSection);
    const isUnclear = Boolean(l?.unclear) || vocalTypeRaw === 'unclear';
    let text = String(l?.text || '').trim();
    if (!text && isInst) text = '[INSTRUMENTAL]';
    if (!text && isUnclear) text = '[Unclear vocal]';
    if (!text) continue;

    let start = Math.max(prevEnd, (Number(l?.start) || 0) + off);
    let end = Math.max(start + 0.12, (Number(l?.end) || (start - off) + 2.0) + off);
    start = +start.toFixed(3);
    end = +end.toFixed(3);
    prevEnd = end;

    const section = String(l?.section || (isInst ? 'instrumental' : 'verse')).toLowerCase();
    const backingText = l?.backingText ? String(l.backingText).trim() : '';
    const language = l?.language ? String(l.language).trim() : '';
    const isRepeatedChorus = Boolean(l?.isRepeatedChorus) || section === 'chorus';
    const lineSpeaker = String(l?.speaker || (vocalTypeRaw === 'backing' || vocalTypeRaw === 'harmony' ? 'Backing' : vocalTypeRaw === 'speech' ? 'Speaker' : 'Lead')).trim();
    const lineRecConf = clampConf(l?.recognitionConfidence, isUnclear ? 0.35 : 0.92);
    const lineAlignConf = clampConf(l?.alignmentConfidence, isUnclear ? 0.45 : 0.9);
    const lineFlags = normalizeFlagsList(l?.flags, lineRecConf, lineAlignConf, vocalTypeRaw, isUnclear);
    const validationNote = l?.validationNote ? String(l.validationNote).trim() : '';

    if (isInst) {
      out.push({
        text: '[INSTRUMENTAL]',
        start,
        end,
        section: section || 'instrumental',
        vocalType: 'instrumental',
        language,
        speaker: 'Instrumental',
        recognitionConfidence: 0.96,
        alignmentConfidence: 0.95,
        isRepeatedChorus: false,
        backingText: '',
        unclear: false,
        isInstrumentalSection: true,
        flags: [],
        validationNote: '',
        words: [],
      });
      continue;
    }

    const rawWords = Array.isArray(l?.words) ? l.words : [];
    const words = [];
    if (rawWords.length > 0) {
      let wPrev = start;
      for (let wi = 0; wi < rawWords.length; wi++) {
        const w = rawWords[wi];
        const wText = String(w?.text || '').trim();
        if (!wText) continue;
        let ws = Number(w?.start);
        let we = Number(w?.end);
        ws = Number.isFinite(ws) ? ws + off : wPrev;
        if (ws < wPrev) ws = wPrev;
        if (ws > end - 0.02) ws = Math.max(start, end - 0.02);
        we = Number.isFinite(we) ? we + off : NaN;
        if (!Number.isFinite(we) || we <= ws) we = ws + Math.max(0.04, (end - ws) / Math.max(1, rawWords.length - wi));
        if (we > end) we = end;
        ws = +ws.toFixed(3);
        we = +Math.max(ws + 0.015, we).toFixed(3);
        wPrev = we;
        const shiftedChars = Array.isArray(w?.chars)
          ? w.chars.map(ch => ({
              ch: ch?.ch,
              start: Number.isFinite(Number(ch?.start)) ? Number(ch.start) + off : undefined,
              end: Number.isFinite(Number(ch?.end)) ? Number(ch.end) + off : undefined,
            }))
          : undefined;
        const shiftedPhonemes = Array.isArray(w?.phonemes)
          ? w.phonemes.map(ph => ({
              unit: String(ph?.unit || '').trim(),
              start: +(Math.max(ws, Math.min(we, (Number(ph?.start) || 0) + off))).toFixed(3),
              end: +(Math.max(ws + 0.005, Math.min(we, (Number(ph?.end) || 0) + off))).toFixed(3),
            })).filter(ph => ph.unit)
          : undefined;
        const wRec = clampConf(w?.recognitionConfidence, lineRecConf);
        const wAlign = clampConf(w?.alignmentConfidence, lineAlignConf);
        const wSpk = String(w?.speaker || lineSpeaker).trim();
        const wUnclear = isUnclear || /\[unclear/i.test(wText);
        const wClarity = clampConf(w?.audioClarity, wUnclear ? 0.32 : 0.78);
        const wOverlap = +Math.max(0, Math.min(1, Number(w?.vocalOverlap ?? (vocalTypeRaw === 'overlapping' || vocalTypeRaw === 'harmony' || vocalTypeRaw === 'backing' ? 0.68 : 0.08)))).toFixed(3);
        const wFlags = normalizeFlagsList(w?.flags, wRec, wAlign, vocalTypeRaw, wUnclear);
        const qMeta = classifyWordTierServer(wRec, wAlign, wClarity, wOverlap, wFlags);
        words.push({
          text: wText,
          start: ws,
          end: we,
          chars: buildCharTimingsServer(wText, ws, we, shiftedChars),
          phonemes: shiftedPhonemes && shiftedPhonemes.length ? shiftedPhonemes : undefined,
          recognitionConfidence: wRec,
          alignmentConfidence: wAlign,
          audioClarity: wClarity,
          vocalOverlap: wOverlap,
          recognitionUncertainty: qMeta.uncertainty,
          qualityTier: qMeta.tier,
          speaker: wSpk,
          flags: wFlags,
        });
      }
    }
    if (!words.length) {
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
        const wClarity = isUnclear ? 0.35 : 0.74;
        const wOverlap = (vocalTypeRaw === 'overlapping' || vocalTypeRaw === 'harmony' || vocalTypeRaw === 'backing') ? 0.65 : 0.1;
        const wFlags = normalizeFlagsList(lineFlags, lineRecConf, wAlign, vocalTypeRaw, isUnclear);
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
    out.push({
      text,
      start,
      end,
      section,
      vocalType: isUnclear ? 'unclear' : vocalTypeRaw,
      language,
      speaker: lineSpeaker,
      recognitionConfidence: lineRecConf,
      alignmentConfidence: lineAlignConf,
      isRepeatedChorus,
      backingText,
      unclear: isUnclear,
      isInstrumentalSection: false,
      flags: lineFlags,
      validationNote,
      words,
    });
  }
  return out;
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
    const {
      audioBase64,
      separatedVocalBase64,
      startSec,
      endSec,
      existingWords,
      qualityConditions,
      lang,
    } = req.body || {};
    if (!apiKey || !audioBase64) {
      res.status(200).json({ success: false, reason: 'ai_not_configured' });
      return;
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const offsetSec = Math.max(0, Number(startSec) || 0);
    const segDur = Math.max(0.2, (Number(endSec) || offsetSec + 2) - offsetSec);
    const condDesc = qualityConditions
      ? `noise=${qualityConditions.isNoisy ? 'YES' : 'no'}, distortion=${qualityConditions.isDistorted ? 'YES' : 'no'}, reverb=${qualityConditions.isReverberated ? 'YES' : 'no'}, overlappingVocals=${qualityConditions.hasOverlappingSingers ? 'YES' : 'no'}`
      : 'standard';

    let focusTranscript = '';
    try {
      const tResp = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: [
          { inlineData: { mimeType: 'audio/wav', data: separatedVocalBase64 || audioBase64 } },
          {
            text: `Re-listen with extreme care to this ${segDur.toFixed(2)}s singing excerpt flagged as low-confidence (${condDesc}). Language hint: ${lang || 'auto'}.
Previous candidate words (may contain errors or timing drift): ${JSON.stringify((existingWords || []).map(w => w.text || '')).slice(0, 800)}.
Transcribe ONLY what is genuinely audible in the singing voice. Mark ambiguous syllables honestly as [UNCLEAR]—never invent words and never exaggerate certainty.`,
          },
        ],
      });
      focusTranscript = String(tResp.text || '').trim();
    } catch (tErr: unknown) {
      const tMsg = tErr instanceof Error ? tErr.message : String(tErr || '');
      const e = tErr as { status?: string; code?: number };
      if (tMsg.includes('billing') || tMsg.includes('free tier') || e?.status === 'PERMISSION_DENIED' || e?.code === 403) {
        throw tErr;
      }
    }

    const alignContents = [
      { inlineData: { mimeType: 'audio/wav', data: audioBase64 } },
      ...(separatedVocalBase64 ? [{ inlineData: { mimeType: 'audio/wav', data: separatedVocalBase64 } }] : []),
      {
        text: `Perform accuracy-first phonetic re-alignment of this short ${segDur.toFixed(2)}s excerpt (timeline starts at 0.000s inside this clip).
Acoustic conditions: ${condDesc}.
${focusTranscript ? `Focused vocal transcript:\n${focusTranscript}\n` : ''}Existing low-confidence tokens with relative hints:
${JSON.stringify((existingWords || []).map(w => ({ text: w.text, start: +Math.max(0, (Number(w.start) || 0) - offsetSec).toFixed(3), end: +Math.max(0, (Number(w.end) || 0) - offsetSec).toFixed(3) })), null, 2)}

Rules:
- Accuracy is strictly more important than speed.
- Re-anchor word & phoneme boundaries directly to true sung vocal energy & consonant attacks.
- Never claim 1.0 (100%) confidence automatically; cap honest scores <= 0.96, and reduce scores whenever noise, reverb, distortion, or overlapping vocals obscure the articulation.
- Output JSON with "lines": [{ "text", "start", "end", "vocalType", "speaker", "recognitionConfidence", "alignmentConfidence", "flags", "words": [{ "text", "start", "end", "recognitionConfidence", "alignmentConfidence", "audioClarity", "vocalOverlap", "flags", "phonemes": [{"unit","start","end"}], "chars": [{"ch","start","end"}] }] }].`,
      },
    ];

    const alignResp = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: alignContents,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            lines: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: { type: Type.STRING },
                  start: { type: Type.NUMBER },
                  end: { type: Type.NUMBER },
                  vocalType: { type: Type.STRING },
                  speaker: { type: Type.STRING },
                  recognitionConfidence: { type: Type.NUMBER },
                  alignmentConfidence: { type: Type.NUMBER },
                  flags: { type: Type.ARRAY, items: { type: Type.STRING } },
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
                        audioClarity: { type: Type.NUMBER },
                        vocalOverlap: { type: Type.NUMBER },
                        flags: { type: Type.ARRAY, items: { type: Type.STRING } },
                      },
                      required: ['text', 'start', 'end'],
                    },
                  },
                },
                required: ['text', 'start', 'end', 'words'],
              },
            },
          },
          required: ['lines'],
        },
      },
    });

    const parsed = JSON.parse(alignResp.text || '{}');
    const lines = normalizeKaraokeLines(Array.isArray(parsed.lines) ? parsed.lines : [], offsetSec);
    res.status(200).json({ success: true, lines, focusTranscript });
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
      reason: isBilling ? 'billing_required' : 'reanalysis_error',
      requiresBilling: isBilling,
      message: msg.slice(0, 300),
    });
  }
}
