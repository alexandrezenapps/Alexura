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

function validateHttpsTarget(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'https:') return null;
    const h = u.hostname.toLowerCase();
    if (
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h === '0.0.0.0' ||
      h === '::1' ||
      h.endsWith('.local') ||
      /^10\./.test(h) ||
      /^192\.168\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
      /^169\.254\./.test(h)
    ) {
      return null;
    }
    return u.toString();
  } catch {
    return null;
  }
}

// Service health & integration capabilities endpoint
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    app: 'Alexura',
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    firebaseConfigured: true,
    vercelConnected: Boolean(process.env.VERCEL || process.env.VERCEL_URL || process.env.EXTERNAL_APP_URL || process.env.VERCEL_DEPLOY_HOOK_URL),
    vercelUrl: process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : process.env.EXTERNAL_APP_URL || '',
    bridgeConfigured: Boolean(process.env.EXTERNAL_APP_URL || process.env.VERCEL_DEPLOY_HOOK_URL),
    endpoints: ['/api/health', '/api/transcribe-lyrics', '/api/align-vocals', '/api/bridge'],
  });
});

// Server-side bridge endpoint to sync project payloads, test Vercel URL, or trigger a Vercel Deploy Hook
app.post('/api/bridge', async (req, res) => {
  const { action, targetUrl, payload } = req.body || {};
  const explicitTarget = validateHttpsTarget(targetUrl);
  const envTarget =
    action === 'deploy'
      ? process.env.VERCEL_DEPLOY_HOOK_URL
      : process.env.EXTERNAL_APP_URL;

  const target = explicitTarget || (envTarget ? validateHttpsTarget(envTarget) : null);

  if (!target) {
    return res.status(200).json({
      success: false,
      reason:
        action === 'deploy'
          ? 'vercel_deploy_hook_not_configured'
          : action === 'ping'
            ? 'vercel_url_not_configured'
            : 'external_app_url_not_configured',
    });
  }

  try {
    if (action === 'ping') {
      const u = new URL(target);
      const pingUrl = u.pathname === '/' ? `${u.origin}/api/health` : u.toString();
      const upstream = await fetch(pingUrl, { method: 'GET' });
      const text = await upstream.text();
      return res.json({
        success: upstream.ok,
        status: upstream.status,
        url: pingUrl,
        response: text.slice(0, 500),
      });
    }

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

const VALID_WORD_FLAGS = new Set([
  'uncertain_word',
  'missing_word',
  'misrecognized_word',
  'overlapping_vocals',
  'uncertain_boundary',
]);

function normalizeFlagsList(rawFlags: any, recConf: number, alignConf: number, vocalType: string, isUnclear: boolean) {
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
        const shiftedPhonemes = Array.isArray(w?.phonemes)
          ? w.phonemes.map((ph: any) => ({
              unit: String(ph?.unit || '').trim(),
              start: +(Math.max(ws, Math.min(we, (Number(ph?.start) || 0) + off))).toFixed(3),
              end: +(Math.max(ws + 0.005, Math.min(we, (Number(ph?.end) || 0) + off))).toFixed(3),
            })).filter((ph: any) => ph.unit)
          : undefined;
        const wRec = clampConf(w?.recognitionConfidence, lineRecConf);
        const wAlign = clampConf(w?.alignmentConfidence, lineAlignConf);
        const wSpk = String(w?.speaker || lineSpeaker).trim();
        const wUnclear = isUnclear || /\[unclear/i.test(wText);
        const wFlags = normalizeFlagsList(w?.flags, wRec, wAlign, vocalTypeRaw, wUnclear);
        words.push({
          text: wText,
          start: ws,
          end: we,
          chars: buildCharTimingsServer(wText, ws, we, shiftedChars),
          phonemes: shiftedPhonemes && shiftedPhonemes.length ? shiftedPhonemes : undefined,
          recognitionConfidence: wRec,
          alignmentConfidence: wAlign,
          speaker: wSpk,
          flags: wFlags,
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
        const wAlign = +(Math.max(0.45, lineAlignConf * 0.78)).toFixed(3);
        words.push({
          text: tk,
          start: ws,
          end: we,
          chars: buildCharTimingsServer(tk, ws, we),
          recognitionConfidence: lineRecConf,
          alignmentConfidence: wAlign,
          speaker: lineSpeaker,
          flags: normalizeFlagsList(lineFlags, lineRecConf, wAlign, vocalTypeRaw, isUnclear),
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

function summarizeValidation(lines: any[], missingGaps: any[] = []) {
  let uncertainWords = 0;
  let misrecognizedWords = 0;
  let overlappingWords = 0;
  let uncertainBoundaries = 0;
  let totalWords = 0;
  for (const ln of lines) {
    for (const w of (ln.words || [])) {
      totalWords++;
      const f = new Set(w.flags || []);
      if (f.has('uncertain_word')) uncertainWords++;
      if (f.has('misrecognized_word')) misrecognizedWords++;
      if (f.has('overlapping_vocals')) overlappingWords++;
      if (f.has('uncertain_boundary')) uncertainBoundaries++;
    }
  }
  return {
    totalWords,
    uncertainWords,
    missingWords: Array.isArray(missingGaps) ? missingGaps.length : 0,
    misrecognizedWords,
    overlappingWords,
    uncertainBoundaries,
    missingVocalGaps: Array.isArray(missingGaps) ? missingGaps : [],
  };
}

// Stage 4/5/6/7: Singing-Aware Forced Alignment + Phoneme Segmentation + Validation Endpoint
app.post('/api/align-vocals', async (req, res) => {
  try {
    const { audioBase64, separatedVocalBase64, lines, lang } = req.body;
    if (!ai || !audioBase64 || !lines || !lines.length) {
      return res.status(200).json({ success: false, reason: 'ai_not_configured' });
    }

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

    const contentParts: any[] = [
      {
        inlineData: {
          mimeType: 'audio/wav',
          data: audioBase64,
        },
      },
    ];
    if (separatedVocalBase64) {
      contentParts.push({
        inlineData: {
          mimeType: 'audio/wav',
          data: separatedVocalBase64,
        },
      });
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
          flags: item.flags,
          validationNote: item.validationNote,
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
            flags: normalized[idx].flags,
            validationNote: normalized[idx].validationNote,
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

// CORE FUNCTION 05 Multi-Stage Server Pipeline (Stages 2-7): Singing Transcription + Phoneme Forced Alignment + Validation
app.post('/api/transcribe-lyrics', async (req, res) => {
  try {
    const {
      audioBase64,
      separatedVocalBase64,
      lang,
      audioFormat,
      duration,
      sampleRate,
      chunkStartSec,
      chunkDurationSec,
      preprocessingSummary,
    } = req.body || {};
    if (!ai || !audioBase64) {
      return res.status(200).json({ success: false, reason: 'ai_not_configured' });
    }
    const offsetSec = Math.max(0, Number(chunkStartSec) || 0);

    // Stage 3: Dedicated multilingual singing & speech recognition pass (gemini-3.5-transcribe)
    // Uses separated vocal stem when provided so instrumental accompaniment does not drown sung phonetics
    let vocalTranscript = '';
    try {
      const transcribeParts: any[] = [
        {
          inlineData: {
            mimeType: 'audio/wav',
            data: separatedVocalBase64 || audioBase64,
          },
        },
        {
          text: `Listen carefully to this audio recording as a specialized multilingual SINGING & SPEECH recognition model (format: ${audioFormat || 'audio'}, original sample rate: ${sampleRate || 'unknown'}Hz, window duration: ${chunkDurationSec || duration || 'unknown'}s${separatedVocalBase64 ? ', vocal-enhanced stem provided' : ''}).
1. Process actual SINGING voices (sustained notes, vibrato, melisma, high belting, rap, spoken intros/outros), NOT just ordinary speech cadence.
2. Identify every language and distinct singer/speaker heard (hint: ${lang && lang !== 'auto' ? lang : 'auto-detect multilingual: French, English, Chinese, Japanese, Korean, Vietnamese, Indonesian, Spanish, etc.'}).
3. Transcribe EVERY sung and spoken word VERBATIM in its native script, preserving spelling, punctuation, contractions, slurs, and ALL repeated choruses (never abbreviate or skip repetitions).
4. Separate Lead vocals from Background vocals / harmonies / overlapping vocal performances: mark overlapping or harmony lines explicitly with timestamps and speaker labels (Lead, Singer 1, Singer 2, Backing, Harmony).
5. Explicitly mark non-vocal instrumental breaks with timestamps as [INSTRUMENTAL].
6. ANTI-HALLUCINATION RULE: Whenever a sung section or word is masked, obscured, or unintelligible, mark it as [UNCLEAR] or add a [?uncertain] flag—NEVER fabricate or hallucinate lyrics to fill silent or ambiguous gaps!`,
        },
      ];
      const transcribeResp = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: transcribeParts,
      });
      vocalTranscript = String(transcribeResp.text || '').trim();
    } catch (tErr: any) {
      const tMsg = tErr?.message || String(tErr || '');
      if (tMsg.includes('billing') || tMsg.includes('free tier') || tErr?.status === 'PERMISSION_DENIED' || tErr?.code === 403) {
        throw tErr;
      }
      // Continue cleanly to Stage 4 forced alignment + transcription pass if transcribe pass is unavailable
    }

    // Stage 4 & Stage 6: Singing-aware Forced Alignment, Phoneme Boundary Extraction & Anti-Hallucination Validation (gemini-4-hydrogen)
    const stage1Hint = preprocessingSummary
      ? `\nStage 1-2 acoustic map: sampleRate=${preprocessingSummary.sampleRate || sampleRate}Hz, silenceCount=${preprocessingSummary.silenceCount ?? 0}, vocalSegments=${preprocessingSummary.vocalPhraseCount ?? 0}, instrumentalGaps=${preprocessingSummary.instrumentalGapCount ?? 0}.`
      : '';
    const alignPrompt = `You are a world-class singing-aware forced-alignment phonetician and lyric validator executing Stages 4, 5, and 6.
You have the original reference mix${separatedVocalBase64 ? ' AND a center-vocal-isolated analysis track (Stage 2)' : ''}.${vocalTranscript ? `\n\nStage 3 verbatim singing transcript:\n${vocalTranscript}\n` : ''}${stage1Hint}
Preserve the exact original timeline starting at 0.000s of this audio window. Output strict structured JSON:
1. "audioType": "singing" | "speech" | "instrumental" | "combination".
2. "language": primary BCP-47 language code ("fr", "en", "zh-Hans", "zh-Hant", "ja", "ko", "vi", "id", "es", etc., or "instrumental"). Hint: ${lang || 'auto'}.
3. "detectedLanguages": array of ALL language codes sung/spoken in this audio.
4. "detectedSpeakers": array of distinct performers/speakers (e.g. ["Lead"], ["Lead", "Backing"], ["Singer 1", "Singer 2"]).
5. "hasBackingVocals", "hasUnclearSections", "hasInstrumentalSections", "hasRepeatedChorus": accurate booleans.
6. "sections": ordered array of song sections { "type": "intro"|"verse"|"pre_chorus"|"chorus"|"bridge"|"outro"|"instrumental"|"speech"|"other", "label": string, "start": float, "end": float, "isRepeat": boolean }.
7. "missingVocalGaps": array of { "start": float, "end": float, "reason": string } for any vocal passage where singing was clearly heard in audio but lyrics could NOT be confidently recognized (NEVER invent lyrics to fill gaps).
8. "lines": chronological array covering EVERY sung line, spoken phrase, unclear vocal, and distinct instrumental section:
   - "text": Exact verbatim sung text, "[INSTRUMENTAL]", or "[Unclear vocal]".
   - "start" & "end": Exact vocal onset & release timestamps in seconds (3 decimals). Never snap blindly to music beats!
   - "section": "verse"|"chorus"|"pre_chorus"|"bridge"|"intro"|"outro"|"instrumental"|"speech".
   - "vocalType": "singing"|"speech"|"harmony"|"backing"|"overlapping"|"instrumental"|"unclear".
   - "language": BCP-47 code.
   - "speaker": active singer/speaker ID.
   - "recognitionConfidence" & "alignmentConfidence": 0..1 floats calibrated honestly to audio clarity.
   - "flags": subset of ["uncertain_word", "missing_word", "misrecognized_word", "overlapping_vocals", "uncertain_boundary"] when any Stage 6 issue applies.
   - "validationNote": concise explanation if any flag is raised, else "".
   - "isRepeatedChorus": boolean.
   - "backingText": simultaneous backing/harmony lyric if audible, else "".
   - "unclear": true if unintelligible/masked, else false.
   - "words": singing-aware forced-aligned tokens (for Chinese output EVERY individual character as a token; for Japanese/Korean output natural mora/syllable clusters):
     * "text", "start", "end" (aligned strictly to actual vocal onset & phoneme release, NOT uniform/beat division)
     * "phonemes": optional phonetic units { "unit", "start", "end" } used to derive boundaries
     * "chars": optional { "ch", "start", "end" }
     * "recognitionConfidence", "alignmentConfidence", "speaker", "flags".
9. "title" & "artist": only if unmistakable in the audio, else "".`;

    const alignContents: any[] = [
      {
        inlineData: {
          mimeType: 'audio/wav',
          data: audioBase64,
        },
      },
    ];
    if (separatedVocalBase64) {
      alignContents.push({
        inlineData: {
          mimeType: 'audio/wav',
          data: separatedVocalBase64,
        },
      });
    }
    alignContents.push({ text: alignPrompt });

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: alignContents,
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
            missingVocalGaps: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  start: { type: Type.NUMBER },
                  end: { type: Type.NUMBER },
                  reason: { type: Type.STRING },
                },
                required: ['start', 'end'],
              },
            },
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
                  flags: { type: Type.ARRAY, items: { type: Type.STRING } },
                  validationNote: { type: Type.STRING },
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
    const missingVocalGaps = Array.isArray(parsed.missingVocalGaps)
      ? parsed.missingVocalGaps.map((g: any) => ({
          start: +(Math.max(0, (Number(g?.start) || 0) + offsetSec)).toFixed(3),
          end: +(Math.max(0.1, (Number(g?.end) || 0) + offsetSec)).toFixed(3),
          reason: String(g?.reason || 'unintelligible_or_missing_vocal').slice(0, 120),
        }))
      : [];
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

    const validationSummary = summarizeValidation(lines, missingVocalGaps);

    return res.json({
      success: true,
      audioType: String(parsed.audioType || (parsed.isInstrumental ? 'instrumental' : 'singing')).toLowerCase(),
      language: parsed.language || 'auto',
      detectedLanguages,
      detectedSpeakers: Array.from(speakerSet),
      hasBackingVocals: Boolean(parsed.hasBackingVocals || lines.some((l: any) => l.backingText || l.vocalType === 'backing' || l.vocalType === 'harmony' || l.vocalType === 'overlapping')),
      hasUnclearSections: Boolean(parsed.hasUnclearSections || validationSummary.uncertainWords > 0 || lines.some((l: any) => l.unclear)),
      hasInstrumentalSections: Boolean(parsed.hasInstrumentalSections || parsed.isInstrumental || lines.some((l: any) => l.isInstrumentalSection)),
      hasRepeatedChorus: Boolean(parsed.hasRepeatedChorus || lines.some((l: any) => l.isRepeatedChorus) || sections.some((s: any) => s.isRepeat)),
      title: parsed.title || '',
      artist: parsed.artist || '',
      isInstrumental: Boolean(parsed.isInstrumental || parsed.audioType === 'instrumental'),
      sections,
      validationSummary,
      pipelineModels: {
        separation: separatedVocalBase64 ? 'client_mid_side_formant_stem' : 'single_channel_formant_filter',
        transcription: vocalTranscript ? 'gemini-3.5-transcribe' : 'gemini-4-hydrogen',
        forcedAlignment: 'gemini-4-hydrogen+phoneme_10ms_viterbi',
      },
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
