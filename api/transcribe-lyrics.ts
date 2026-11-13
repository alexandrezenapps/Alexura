import type { IncomingMessage, ServerResponse } from 'http';
import { GoogleGenAI, Type } from '@google/genai';

interface ApiReq extends IncomingMessage {
  method?: string;
  body?: {
    audioBase64?: string;
    lang?: string;
    audioFormat?: string;
    duration?: number;
    chunkStartSec?: number;
    chunkDurationSec?: number;
  };
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
  words?: RawWord[];
}

interface RawSection {
  type?: string;
  label?: string;
  start?: number;
  end?: number;
  isRepeat?: boolean;
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
    const out = [];
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
        words.push({
          text: wText,
          start: ws,
          end: we,
          chars: buildCharTimingsServer(wText, ws, we, shiftedChars),
          recognitionConfidence: clampConf(w?.recognitionConfidence, lineRecConf),
          alignmentConfidence: clampConf(w?.alignmentConfidence, lineAlignConf),
          speaker: String(w?.speaker || lineSpeaker).trim(),
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
    const { audioBase64, lang, audioFormat, duration, chunkStartSec, chunkDurationSec } = req.body || {};
    if (!apiKey || !audioBase64) {
      res.status(200).json({ success: false, reason: 'ai_not_configured' });
      return;
    }
    const offsetSec = Math.max(0, Number(chunkStartSec) || 0);

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    let vocalTranscript = '';
    try {
      const transcribeResp = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: [
          { inlineData: { mimeType: 'audio/wav', data: audioBase64 } },
          {
            text: `Listen carefully to this complete audio recording (source format: ${audioFormat || 'audio'}, duration: ${chunkDurationSec || duration || 'unknown'}s).
1. Identify whether it contains singing, speech, instrumental music, or a combination, and identify every language and distinct singer/speaker heard (hint: ${lang && lang !== 'auto' ? lang : 'auto-detect multilingual: French, English, Chinese, Japanese, Korean, Vietnamese, Indonesian, Spanish, etc.'}).
2. Transcribe EVERY sung and spoken phrase VERBATIM in its native language script, preserving exact spelling, punctuation, contractions, and ALL repetitions (never collapse repeated choruses).
3. Capture audible background vocals, harmonies, or overlapping singers in parentheses like (harmony/backing: ...) and tag singers.
4. Mark non-vocal musical breaks as [INSTRUMENTAL] and masked/unintelligible singing as [UNCLEAR] without inventing words.`,
          },
        ],
      });
      vocalTranscript = String(transcribeResp.text || '').trim();
    } catch (tErr: unknown) {
      const msg = tErr instanceof Error ? tErr.message : String(tErr || '');
      const e = tErr as { status?: string; code?: number };
      if (msg.includes('billing') || msg.includes('free tier') || e?.status === 'PERMISSION_DENIED' || e?.code === 403) {
        throw tErr;
      }
    }

    const prompt = `You are a world-class AI audio engineer, acoustic phonetician, and singing forced-alignment engine.
Listen directly to the vocal performance in the audio track below.${vocalTranscript ? `\n\nReference verbatim vocal transcript from pass 1:\n${vocalTranscript}\n` : ''}
Analyze the ENTIRE audio track and output strict structured JSON:
1. "audioType": classify as "singing", "speech", "instrumental", or "combination".
2. "language": primary BCP-47 language code ("fr", "en", "zh-Hans", "zh-Hant", "ja", "ko", "vi", "id", "es", etc.). Hint: ${lang || 'auto'}.
3. "detectedLanguages": array of ALL languages sung/spoken in the audio.
4. "detectedSpeakers": array of distinct singers/speakers detected (e.g. ["Lead"] or ["Singer 1", "Singer 2", "Backing"]).
5. "hasBackingVocals": true if background vocals, harmonies, or overlapping singers occur.
6. "hasUnclearSections": true if any sung part is unintelligible (NEVER invent fake lyrics).
7. "hasInstrumentalSections": true if there are instrumental breaks/intros/outros (>= 2s without lead vocals).
8. "hasRepeatedChorus": true if a chorus/hook repeats.
9. "sections": ordered array of { "type": "intro"|"verse"|"pre_chorus"|"chorus"|"bridge"|"outro"|"instrumental"|"speech"|"other", "label": string, "start": float, "end": float, "isRepeat": boolean }.
10. "lines": chronological array covering every sung line, spoken phrase, unclear vocal, and instrumental break (>= 2.5s) with "text", "start", "end", "section", "vocalType", "language", "speaker", "recognitionConfidence", "alignmentConfidence", "isRepeatedChorus", "backingText", "unclear", and "words": CRITICAL — do NOT divide duration equally or estimate from text length or beat! Detect actual vocal onset & release timestamps (3-decimal floats) for every word (or EVERY individual Chinese character / Japanese kana / Korean syllable cluster), keeping real pauses, with "recognitionConfidence", "alignmentConfidence", "speaker", and optional "chars": [{ "ch", "start", "end" }].
11. "title" & "artist": only if clearly identifiable, else "".`;

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
            audioType: { type: Type.STRING },
            language: { type: Type.STRING },
            detectedLanguages: { type: Type.ARRAY, items: { type: Type.STRING } },
            detectedSpeakers: { type: Type.ARRAY, items: { type: Type.STRING } },
            hasBackingVocals: { type: Type.BOOLEAN },
            hasUnclearSections: { type: Type.BOOLEAN },
            hasInstrumentalSections: { type: Type.BOOLEAN },
            hasRepeatedChorus: { type: Type.BOOLEAN },
            title: { type: Type.STRING },
            artist: { type: Type.STRING },
            isInstrumental: { type: Type.BOOLEAN },
            sections: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING },
                  label: { type: Type.STRING },
                  start: { type: Type.NUMBER },
                  end: { type: Type.NUMBER },
                  isRepeat: { type: Type.BOOLEAN },
                },
                required: ['type', 'start', 'end'],
              },
            },
            lines: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: { type: Type.STRING },
                  start: { type: Type.NUMBER },
                  end: { type: Type.NUMBER },
                  section: { type: Type.STRING },
                  vocalType: { type: Type.STRING },
                  language: { type: Type.STRING },
                  speaker: { type: Type.STRING },
                  recognitionConfidence: { type: Type.NUMBER },
                  alignmentConfidence: { type: Type.NUMBER },
                  isRepeatedChorus: { type: Type.BOOLEAN },
                  backingText: { type: Type.STRING },
                  unclear: { type: Type.BOOLEAN },
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
                required: ['text', 'start', 'end', 'words'],
              },
            },
          },
          required: ['audioType', 'language', 'lines'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    const lines = normalizeKaraokeLines(Array.isArray(parsed.lines) ? parsed.lines : [], offsetSec);
    const sections = Array.isArray(parsed.sections)
      ? (parsed.sections as RawSection[]).map(sec => ({
          type: String(sec?.type || 'other').toLowerCase(),
          label: String(sec?.label || sec?.type || ''),
          start: +Math.max(0, (Number(sec?.start) || 0) + offsetSec).toFixed(3),
          end: +Math.max(0.1, (Number(sec?.end) || 0) + offsetSec).toFixed(3),
          isRepeat: Boolean(sec?.isRepeat),
        }))
      : [];
    const detectedLanguages =
      Array.isArray(parsed.detectedLanguages) && parsed.detectedLanguages.length
        ? parsed.detectedLanguages.filter(Boolean)
        : parsed.language && parsed.language !== 'auto' && parsed.language !== 'instrumental'
        ? [parsed.language]
        : [];
    const speakerSet = new Set<string>(Array.isArray(parsed.detectedSpeakers) ? parsed.detectedSpeakers.filter(Boolean) : []);
    lines.forEach(ln => {
      if (ln.speaker && ln.speaker !== 'Instrumental') speakerSet.add(ln.speaker);
      (ln.words || []).forEach(w => { if (w.speaker) speakerSet.add(w.speaker); });
    });

    res.status(200).json({
      success: true,
      audioType: String(parsed.audioType || (parsed.isInstrumental ? 'instrumental' : 'singing')).toLowerCase(),
      language: parsed.language || 'auto',
      detectedLanguages,
      detectedSpeakers: Array.from(speakerSet),
      hasBackingVocals: Boolean(parsed.hasBackingVocals || lines.some(l => l.backingText || l.vocalType === 'backing' || l.vocalType === 'harmony' || l.vocalType === 'overlapping')),
      hasUnclearSections: Boolean(parsed.hasUnclearSections || lines.some(l => l.unclear)),
      hasInstrumentalSections: Boolean(parsed.hasInstrumentalSections || parsed.isInstrumental || lines.some(l => l.isInstrumentalSection)),
      hasRepeatedChorus: Boolean(parsed.hasRepeatedChorus || lines.some(l => l.isRepeatedChorus) || sections.some(s => s.isRepeat)),
      title: parsed.title || '',
      artist: parsed.artist || '',
      isInstrumental: Boolean(parsed.isInstrumental || parsed.audioType === 'instrumental'),
      sections,
      lines,
    });
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
      reason: isBilling ? 'billing_required' : 'transcription_error',
      requiresBilling: isBilling,
      message: msg.slice(0, 300),
    });
  }
}
