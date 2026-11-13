import type { IncomingMessage, ServerResponse } from 'http';
import { GoogleGenAI, Type } from '@google/genai';

interface InputLine {
  i?: number;
  index?: number;
  text: string;
}

interface ApiReq extends IncomingMessage {
  method?: string;
  body?: { audioBase64?: string; lines?: InputLine[]; lang?: string };
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

interface RawWord {
  text?: string;
  start?: number;
  end?: number;
  recognitionConfidence?: number;
  alignmentConfidence?: number;
  speaker?: string;
  chars?: RawChar[];
}

function clampConf(val: unknown, fallback = 0.88) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return +Math.max(0, Math.min(1, n)).toFixed(3);
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
) {
  const words: Array<{
    text: string;
    start: number;
    end: number;
    chars: Array<{ ch: string; start: number; end: number }>;
    recognitionConfidence: number;
    alignmentConfidence: number;
    speaker: string;
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
      words.push({
        text: wText,
        start: ws,
        end: we,
        chars: buildCharTimingsServer(wText, ws, we, w?.chars),
        recognitionConfidence: clampConf(w?.recognitionConfidence, lineRecConf),
        alignmentConfidence: clampConf(w?.alignmentConfidence, lineAlignConf),
        speaker: String(w?.speaker || lineSpeaker).trim(),
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
      words.push({
        text: tk,
        start: ws,
        end: we,
        chars: buildCharTimingsServer(tk, ws, we),
        recognitionConfidence: lineRecConf,
        alignmentConfidence: +(Math.max(0.45, lineAlignConf * 0.78)).toFixed(3),
        speaker: lineSpeaker,
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
    const { audioBase64, lines, lang } = req.body || {};
    if (!apiKey || !audioBase64 || !lines || !lines.length) {
      res.status(200).json({ success: false, reason: 'ai_not_configured' });
      return;
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const prompt = `You are a world-class singing forced-alignment & acoustic phonetics engineer.
Listen closely to the actual vocal performance in this audio recording. Language hint: ${lang || 'auto'}.
Ordered list of lyric lines to align:
${JSON.stringify(lines, null, 2)}

CRITICAL PRECISION RULES:
- Do NOT divide sentence duration equally among words, do NOT estimate from character count, and do NOT align blindly to instrumental beats.
- Detect the exact millisecond when the singer actually begins pronouncing each word (consonant/vowel onset) and finishes sustaining it.
- Preserve silent pauses or breaths between words cleanly (ws > previous word's end when a pause exists).
- For Chinese lyrics, emit EVERY single Chinese character as its own token in "words" with exact start/end timestamps. For Japanese/Korean/no-space scripts, emit each natural character/syllable cluster.
- For each line AND each word provide:
  * "text", "start", "end" (3-decimal floats)
  * "chars": [{ "ch": string, "start": number, "end": number }] when acoustically distinguishable
  * "recognitionConfidence": 0..1 float
  * "alignmentConfidence": 0..1 float
  * "speaker": singer/speaker identifier (e.g. "Lead", "Singer 1", "Singer 2", "Backing", "Harmony", "Speaker")`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: [
        { inlineData: { mimeType: 'audio/wav', data: audioBase64 } },
        { text: prompt },
      ],
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
    const lineMeta: Record<number, { speaker: string; recognitionConfidence: number; alignmentConfidence: number }> = {};
    if (parsed.alignments && Array.isArray(parsed.alignments)) {
      const sorted = parsed.alignments.slice().sort((a: { index?: number }, b: { index?: number }) => (a.index ?? 0) - (b.index ?? 0));
      let prevEnd = 0;
      for (const item of sorted) {
        if (typeof item.index === 'number' && typeof item.start === 'number') {
          const s = +Math.max(prevEnd, item.start).toFixed(3);
          const e = +Math.max(s + 0.15, typeof item.end === 'number' ? item.end : s + 2.0).toFixed(3);
          prevEnd = e;
          const spk = String(item.speaker || 'Lead').trim();
          const recC = clampConf(item.recognitionConfidence, 0.92);
          const alignC = clampConf(item.alignmentConfidence, 0.9);
          lineTimes[item.index] = s;
          lineMeta[item.index] = { speaker: spk, recognitionConfidence: recC, alignmentConfidence: alignC };
          const srcLine = lines.find(l => l.i === item.index || l.index === item.index);
          wordTimes[item.index] = normalizeWords(srcLine?.text || '', s, e, item.words || [], spk, recC, alignC);
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
