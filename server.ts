import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Parse CLI args (e.g. --port 3000) or APP_PORT, strictly defaulting to 3000 (port 8080 is reserved for Nginx)
const portArgIndex = process.argv.indexOf('--port');
const cliPort = portArgIndex !== -1 ? Number(process.argv[portArgIndex + 1]) : null;
const PORT = cliPort || Number(process.env.APP_PORT) || 3000;
const HOST = '0.0.0.0';

// Initialize Gemini client on server-side if key is present
const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    })
  : null;

// Parse JSON payloads up to 30MB for audio alignment data
app.use(express.json({ limit: '35mb' }));

// Allow cross-origin calls from external Vercel apps on /api/*
app.use('/api', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

// Service health & integration capabilities endpoint
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    app: 'Alexura',
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    bridgeConfigured: Boolean(process.env.EXTERNAL_APP_URL || process.env.VERCEL_DEPLOY_HOOK_URL),
    endpoints: ['/api/health', '/api/transcribe-lyrics', '/api/align-vocals', '/api/bridge'],
  });
});

// Server-side bridge endpoint to sync project payloads or trigger a Vercel Deploy Hook
app.post('/api/bridge', async (req, res) => {
  const { action, payload } = req.body || {};
  const target =
    action === 'deploy'
      ? process.env.VERCEL_DEPLOY_HOOK_URL
      : process.env.EXTERNAL_APP_URL;

  if (!target) {
    return res.status(200).json({
      success: false,
      reason: action === 'deploy' ? 'vercel_deploy_hook_not_configured' : 'external_app_url_not_configured',
    });
  }

  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload ?? { source: 'Alexura', timestamp: new Date().toISOString() }),
    });
    const text = await upstream.text();
    return res.json({ success: upstream.ok, status: upstream.status, response: text.slice(0, 500) });
  } catch (err: any) {
    return res.status(502).json({
      success: false,
      reason: 'upstream_unreachable',
      message: err?.message || String(err),
    });
  }
});

function clampConf(val: any, fallback = 0.88) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return +Math.max(0, Math.min(1, n)).toFixed(3);
}

function buildCharTimingsServer(wordText: string, start: number, end: number, rawChars?: any[]) {
  const chars = Array.from(wordText);
  const n = chars.length;
  if (!n || end <= start) return chars.map(ch => ({ ch, start, end }));
  if (Array.isArray(rawChars) && rawChars.length === n) {
    let cPrev = start;
    const out: any[] = [];
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

function normalizeKaraokeLines(rawLines: any[], chunkOffsetSec = 0) {
  const out: any[] = [];
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
    const words: any[] = [];
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
          ? w.chars.map((ch: any) => ({
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
      // Language-aware tokenization fallback (Chinese individual chars, Japanese kana/kanji, Korean syllables, Latin words)
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

// AI Vocal-to-Lyric Ultra-Precise Forced Alignment Endpoint (line + word + character + confidence + speaker)
app.post('/api/align-vocals', async (req, res) => {
  try {
    const { audioBase64, lines, lang } = req.body;
    if (!ai || !audioBase64 || !lines || !lines.length) {
      return res.status(200).json({ success: false, reason: 'ai_not_configured' });
    }

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
        {
          inlineData: {
            mimeType: 'audio/wav',
            data: audioBase64,
          },
        },
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
    const wordTimes: Record<number, any[]> = {};
    const lineMeta: Record<number, any> = {};
    if (parsed.alignments && Array.isArray(parsed.alignments)) {
      const sorted = parsed.alignments.slice().sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0));
      const normalized = normalizeKaraokeLines(
        sorted.map((item: any) => ({
          text: (lines.find((l: any) => l.i === item.index || l.index === item.index)?.text) || (item.words || []).map((w: any) => w.text).join(' '),
          start: item.start,
          end: item.end,
          speaker: item.speaker,
          recognitionConfidence: item.recognitionConfidence,
          alignmentConfidence: item.alignmentConfidence,
          words: item.words,
        })),
      );
      sorted.forEach((item: any, idx: number) => {
        if (typeof item.index === 'number' && typeof item.start === 'number' && normalized[idx]) {
          lineTimes[item.index] = normalized[idx].start;
          wordTimes[item.index] = normalized[idx].words;
          lineMeta[item.index] = {
            speaker: normalized[idx].speaker,
            recognitionConfidence: normalized[idx].recognitionConfidence,
            alignmentConfidence: normalized[idx].alignmentConfidence,
          };
        }
      });
    }

    return res.json({ success: true, lineTimes, wordTimes, lineMeta });
  } catch (err: any) {
    const msg = err?.message || String(err || '');
    const isBilling = msg.includes('billing') || msg.includes('free tier') || err?.status === 'PERMISSION_DENIED' || err?.code === 403;
    return res.status(200).json({
      success: false,
      reason: isBilling ? 'billing_required' : 'alignment_error',
      requiresBilling: isBilling,
    });
  }
});

// AI Music Audio-to-Lyrics Detection, Multi-Layer Vocal Analysis & Ultra-Precise Word/Char Forced Alignment Endpoint
app.post('/api/transcribe-lyrics', async (req, res) => {
  try {
    const { audioBase64, lang, audioFormat, duration, chunkStartSec, chunkDurationSec } = req.body || {};
    if (!ai || !audioBase64) {
      return res.status(200).json({ success: false, reason: 'ai_not_configured' });
    }
    const offsetSec = Math.max(0, Number(chunkStartSec) || 0);

    // Pass 1: Deep full-audio listening & verbatim multilingual transcription with gemini-3.5-transcribe
    let vocalTranscript = '';
    try {
      const transcribeResp = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: [
          {
            inlineData: {
              mimeType: 'audio/wav',
              data: audioBase64,
            },
          },
          {
            text: `Listen carefully to this complete audio recording (source format: ${audioFormat || 'audio'}, duration: ${chunkDurationSec || duration || 'unknown'}s).
1. Identify whether it contains singing, speech, instrumental music, or a combination, and identify every language and distinct singer/speaker heard (language hint: ${lang && lang !== 'auto' ? lang : 'auto-detect multilingual: French, English, Chinese, Japanese, Korean, Vietnamese, Indonesian, Spanish, etc.'}).
2. Transcribe EVERY sung and spoken phrase VERBATIM in its native language script, preserving exact spelling, punctuation, contractions, slang, and ALL repetitions (never skip repeated choruses or write "x2").
3. Distinguish song structure (Verse, Pre-Chorus, Chorus, Bridge, Intro, Outro) and repeated choruses.
4. Capture audible background vocals, harmonies, or overlapping singers in parentheses like (harmony/backing: ...) and tag distinct singers (Lead, Singer 1, Singer 2, Backing).
5. Explicitly mark non-vocal musical breaks with timestamps as [INSTRUMENTAL].
6. CRITICAL ANTI-HALLUCINATION RULE: If any vocal section is masked, distorted, or unintelligible, mark it as [UNCLEAR] with timestamps—DO NOT invent or guess lyrics!`,
          },
        ],
      });
      vocalTranscript = String(transcribeResp.text || '').trim();
    } catch (tErr: any) {
      const tMsg = tErr?.message || String(tErr || '');
      if (tMsg.includes('billing') || tMsg.includes('free tier') || tErr?.status === 'PERMISSION_DENIED' || tErr?.code === 403) {
        throw tErr;
      }
      // Continue cleanly to gemini-4-hydrogen audio+alignment pass if transcribe pass is unavailable
    }

    // Pass 2: Full song classification, structural segmentation & ultra-precise word/char forced alignment with gemini-4-hydrogen
    const alignPrompt = `You are a world-class AI audio engineer, acoustic phonetician, and singing forced-alignment engine.
Listen directly to the vocal performance in the audio track below.${vocalTranscript ? `\n\nReference verbatim vocal transcript from pass 1:\n${vocalTranscript}\n` : ''}
Analyze the ENTIRE audio track and output strict structured JSON:
1. "audioType": classify accurately as "singing", "speech", "instrumental", or "combination".
2. "language": primary BCP-47 language code ("fr", "en", "zh-Hans", "zh-Hant", "ja", "ko", "vi", "id", "es", etc., or "instrumental" if none). Hint: ${lang || 'auto'}.
3. "detectedLanguages": array of ALL language codes sung/spoken anywhere in the audio.
4. "detectedSpeakers": array of distinct singers/speakers detected (e.g. ["Lead"], or ["Singer 1", "Singer 2", "Backing"]).
5. "hasBackingVocals": true if background vocals, harmonies, ad-libs, or overlapping singers occur.
6. "hasUnclearSections": true if any sung part is unintelligible/inaudible (NEVER fabricate fake words).
7. "hasInstrumentalSections": true if there are distinct instrumental intros, solos, interludes, or outros (>= 2s without lead vocals).
8. "hasRepeatedChorus": true if a chorus/hook repeats in this audio.
9. "sections": ordered array of song sections { "type": "intro"|"verse"|"pre_chorus"|"chorus"|"bridge"|"outro"|"instrumental"|"speech"|"other", "label": string, "start": float, "end": float, "isRepeat": boolean }.
10. "lines": chronological array covering EVERY sung line, spoken phrase, unclear vocal, and distinct instrumental break (>= 2.5s):
   - "text": Exact verbatim lyrics in native orthography keeping original punctuation & repetitions. Use "[INSTRUMENTAL]" for instrumental breaks and "[Unclear vocal]" when vocals are truly unintelligible — NEVER invent lyrics.
   - "start" & "end": Exact vocal onset & release timestamps (3-decimal float seconds).
   - "section": "verse"|"chorus"|"pre_chorus"|"bridge"|"intro"|"outro"|"instrumental"|"speech".
   - "vocalType": "singing"|"speech"|"harmony"|"backing"|"overlapping"|"instrumental"|"unclear".
   - "language": BCP-47 code for this line.
   - "speaker": active singer/speaker ID (e.g. "Lead", "Singer 1", "Singer 2", "Backing").
   - "recognitionConfidence" & "alignmentConfidence": 0..1 confidence floats.
   - "isRepeatedChorus": true when this line belongs to a chorus/refrain that repeats.
   - "backingText": exact background/harmony/overlapping lyric text if audible alongside lead vocal, else "".
   - "unclear": true if lyrics are obscured/unintelligible, else false.
   - "words": CRITICAL — do NOT divide sentence duration equally or estimate from text length or beat! Place "start" and "end" on ACTUAL vocal onset & pronunciation release of EVERY word (or EVERY individual Chinese character / Japanese kana / Korean syllable cluster for unspaced CJK/Asian scripts!), preserving real silent gaps between words. Include "recognitionConfidence", "alignmentConfidence", "speaker", and optional "chars": [{ "ch", "start", "end" }] when character boundaries are acoustically separable.
11. "title" & "artist": only if explicitly spoken/sung or unmistakable, otherwise "".`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: [
        {
          inlineData: {
            mimeType: 'audio/wav',
            data: audioBase64,
          },
        },
        { text: alignPrompt },
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
    const rawLines = Array.isArray(parsed.lines) ? parsed.lines : [];
    const lines = normalizeKaraokeLines(rawLines, offsetSec);
    const sections = Array.isArray(parsed.sections)
      ? parsed.sections.map((sec: any) => ({
          type: String(sec?.type || 'other').toLowerCase(),
          label: String(sec?.label || sec?.type || ''),
          start: +(Math.max(0, (Number(sec?.start) || 0) + offsetSec)).toFixed(3),
          end: +(Math.max(0.1, (Number(sec?.end) || 0) + offsetSec)).toFixed(3),
          isRepeat: Boolean(sec?.isRepeat),
        }))
      : [];
    const detectedLanguages = Array.isArray(parsed.detectedLanguages) && parsed.detectedLanguages.length
      ? parsed.detectedLanguages.filter(Boolean)
      : (parsed.language && parsed.language !== 'auto' && parsed.language !== 'instrumental' ? [parsed.language] : []);
    const speakerSet = new Set<string>(Array.isArray(parsed.detectedSpeakers) ? parsed.detectedSpeakers.filter(Boolean) : []);
    lines.forEach((ln: any) => {
      if (ln.speaker && ln.speaker !== 'Instrumental') speakerSet.add(ln.speaker);
      (ln.words || []).forEach((w: any) => { if (w.speaker) speakerSet.add(w.speaker); });
    });

    return res.json({
      success: true,
      audioType: String(parsed.audioType || (parsed.isInstrumental ? 'instrumental' : 'singing')).toLowerCase(),
      language: parsed.language || 'auto',
      detectedLanguages,
      detectedSpeakers: Array.from(speakerSet),
      hasBackingVocals: Boolean(parsed.hasBackingVocals || lines.some((l: any) => l.backingText || l.vocalType === 'backing' || l.vocalType === 'harmony' || l.vocalType === 'overlapping')),
      hasUnclearSections: Boolean(parsed.hasUnclearSections || lines.some((l: any) => l.unclear)),
      hasInstrumentalSections: Boolean(parsed.hasInstrumentalSections || parsed.isInstrumental || lines.some((l: any) => l.isInstrumentalSection)),
      hasRepeatedChorus: Boolean(parsed.hasRepeatedChorus || lines.some((l: any) => l.isRepeatedChorus) || sections.some((s: any) => s.isRepeat)),
      title: parsed.title || '',
      artist: parsed.artist || '',
      isInstrumental: Boolean(parsed.isInstrumental || parsed.audioType === 'instrumental'),
      sections,
      lines,
    });
  } catch (err: any) {
    const msg = err?.message || String(err || '');
    const isBilling = msg.includes('billing') || msg.includes('free tier') || err?.status === 'PERMISSION_DENIED' || err?.code === 403;
    return res.status(200).json({
      success: false,
      reason: isBilling ? 'billing_required' : 'transcription_error',
      requiresBilling: isBilling,
      message: msg.slice(0, 300),
    });
  }
});

// Explicit route handlers for language edition directories
const editions = ['fr', 'en', 'zh-hant', 'zh-hans', 'ko', 'id', 'vi'];

// Route handler for root: intelligently serve French edition (/fr/index.html) as the primary experience
app.get('/', (req, res) => {
  const lang = req.query.lang as string;
  if (lang && editions.includes(lang)) {
    return res.redirect(`/${lang}/`);
  }
  const accept = (req.headers['accept-language'] || '').toLowerCase();
  if (accept.includes('ja')) {
    return res.sendFile(path.join(__dirname, 'index.html'));
  }
  if (accept.includes('zh')) {
    return res.sendFile(path.join(__dirname, 'zh-hans', 'index.html'));
  }
  // Default to French for Alexura
  res.sendFile(path.join(__dirname, 'fr', 'index.html'));
});

for (const ed of editions) {
  app.get([`/${ed}`, `/${ed}/`], (req, res) => {
    if (!req.path.endsWith('/')) {
      return res.redirect(301, `/${ed}/`);
    }
    res.sendFile(path.join(__dirname, ed, 'index.html'));
  });
}

// Serve static assets from the project root without auto-serving index.html on root
app.use(express.static(__dirname, {
  extensions: ['html'],
  index: false
}));

// Fallback to fr/index.html for unknown HTML navigations
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'fr', 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Alexura server running at http://${HOST}:${PORT}`);
});
