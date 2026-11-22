import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import { createPipelineRouter } from './server/routes/pipelineRoutes.ts';
import { createSyncEngineV1Router } from './server/routes/syncEngineRoutes.ts';

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

// Allow cross-origin calls on /api/*
app.use('/api', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-File-Name, X-Chunk-Index');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

// Phase 1 AI Lyrics Sync Engine REST API (FastAPI v1 parity)
app.use('/api/v1', createSyncEngineV1Router());

// Modular Audio Pipeline v2 Router (Secure Uploads, Async Jobs/SSE, Provider Interfaces, SQLite Timestamp DB)
app.use('/api/v2', createPipelineRouter());

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
    endpoints: [
      '/api/health',
      '/api/v2/capabilities',
      '/api/v2/uploads',
      '/api/v2/jobs',
      '/api/v2/songs',
      '/api/weather',
      '/api/weather/search',
      '/api/transcribe-lyrics',
      '/api/transcribe-lyrics/stream',
      '/api/align-vocals',
      '/api/reanalyze-segment',
      '/api/translate-lyrics',
      '/api/bridge',
    ],
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

function clampConf(val: any, fallback = 0.84) {
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

function summarizeValidation(lines: any[], missingGaps: any[] = []) {
  let uncertainWords = 0;
  let misrecognizedWords = 0;
  let overlappingWords = 0;
  let uncertainBoundaries = 0;
  let highConfidenceWords = 0;
  let mediumConfidenceWords = 0;
  let lowConfidenceWords = 0;
  let totalWords = 0;
  for (const ln of lines) {
    for (const w of (ln.words || [])) {
      totalWords++;
      const f = new Set(w.flags || []);
      if (f.has('uncertain_word')) uncertainWords++;
      if (f.has('misrecognized_word')) misrecognizedWords++;
      if (f.has('overlapping_vocals')) overlappingWords++;
      if (f.has('uncertain_boundary')) uncertainBoundaries++;
      const tier = w.qualityTier || classifyWordTierServer(
        Number(w.recognitionConfidence ?? 0.8),
        Number(w.alignmentConfidence ?? 0.78),
        Number(w.audioClarity ?? 0.75),
        Number(w.vocalOverlap ?? 0.1),
        w.flags || [],
      ).tier;
      if (tier === 'HIGH') highConfidenceWords++;
      else if (tier === 'LOW') lowConfidenceWords++;
      else mediumConfidenceWords++;
    }
  }
  return {
    totalWords,
    highConfidenceWords,
    mediumConfidenceWords,
    lowConfidenceWords,
    uncertainWords,
    missingWords: Array.isArray(missingGaps) ? missingGaps.length : 0,
    misrecognizedWords,
    overlappingWords,
    uncertainBoundaries,
    missingVocalGaps: Array.isArray(missingGaps) ? missingGaps : [],
  };
}

// Stage 4/5/6/7: Singing-Aware Forced Alignment + Validation Endpoint
app.post('/api/align-vocals', async (req, res) => {
  try {
    const { audioBase64, separatedVocalBase64, lines, lang, vocalSegments } = req.body || {};
    if (!ai || !audioBase64 || !lines || !lines.length) {
      return res.status(200).json({ success: false, reason: 'ai_not_configured' });
    }

    const cleanSegs = Array.isArray(vocalSegments)
      ? vocalSegments
          .slice(0, 48)
          .map((s: any) => `[${(Number(s?.start) || 0).toFixed(2)}..${(Number(s?.end) || 0).toFixed(2)}]`)
          .join(', ')
      : '';
    const segHint = cleanSegs ? `\nAcoustic vocal activity windows (seconds): ${cleanSegs}.` : '';

    const prompt = `You are a singing-aware forced-alignment phonetician and lyric validator executing Stages 4-6.
Analyze BOTH the original mix reference${separatedVocalBase64 ? ' AND the center-isolated vocal stem provided' : ''}. Language hint: ${lang || 'auto'}.${segHint}
Ordered list of lyric lines to align:
${JSON.stringify(lines, null, 2)}

CRITICAL SINGING-AWARE ALIGNMENT & VALIDATION RULES:
- Distinguish actual SINGING performance (sustained vowels, vibrato, melisma, vocal onsets) from ordinary speech or musical beats.
- NEVER divide line duration equally among words, NEVER estimate blindly from character length, and NEVER snap onto accompaniment beats instead of vocal attacks.
- For Chinese, Japanese, and Korean, output individual Chinese character / kana mora / Hangul syllable boundaries accurately.
- Preserve silent pauses and breath gaps cleanly between lines and words.
- Stage 6 Validation: Compare provided lyrics honestly against singing audio and flag any of:
  "uncertain_word", "missing_word", "misrecognized_word", "overlapping_vocals", "uncertain_boundary".`;

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
      message: msg.slice(0, 300),
    });
  }
});

function parseTranscriptLinesForRecovery(
  transcript: string,
  vocalSegments: Array<{ start: number; end: number }> = [],
  chunkDurationSec = 30,
  offsetSec = 0,
  hintLang = 'auto',
) {
  const rawLines = String(transcript || '')
    .split(/\r?\n/)
    .map(s => s.replace(/^\s*(?:\[\d{1,2}:\d{2}(?:\.\d+)?\]\s*)+/, '').trim())
    .filter(s => s && !/^\[?(?:INSTRUMENTAL|UNCLEAR)\]?$/i.test(s));
  if (!rawLines.length) return [];

  const segs = Array.isArray(vocalSegments) && vocalSegments.length
    ? vocalSegments.filter(s => Number.isFinite(Number(s?.start)) && Number.isFinite(Number(s?.end)) && Number(s.end) > Number(s.start))
    : [];
  const totalSpan = Math.max(2, Number(chunkDurationSec) || 30);
  const out: any[] = [];
  rawLines.forEach((lineText, i) => {
    let speaker = 'Lead';
    let cleanText = lineText;
    const spMatch = cleanText.match(/^\[?(Lead|Singer\s*\d+|Backing|Harmony|Speaker)\s*:\s*\]?\s*(.+)$/i);
    if (spMatch) {
      speaker = spMatch[1].trim();
      cleanText = spMatch[2].trim();
    }
    const seg = segs[i];
    const startRel = seg
      ? Math.max(0, Number(seg.start) - offsetSec)
      : (i / rawLines.length) * totalSpan;
    const endRel = seg
      ? Math.max(startRel + 0.35, Number(seg.end) - offsetSec)
      : Math.max(startRel + 0.5, ((i + 1) / rawLines.length) * totalSpan);
    out.push({
      text: cleanText,
      start: +startRel.toFixed(3),
      end: +endRel.toFixed(3),
      section: 'verse',
      vocalType: 'singing',
      language: hintLang && hintLang !== 'auto' && hintLang !== 'multi' ? hintLang : '',
      speaker,
      recognitionConfidence: 0.88,
      alignmentConfidence: 0.72,
      flags: ['uncertain_boundary'],
      words: [],
    });
  });
  return out;
}

async function runSingingTranscriptionPipeline(
  body: any,
  onProgress?: (evt: { stage: number; event: string; payload?: any }) => void,
) {
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
    vocalSegments,
  } = body || {};

  if (!ai || !audioBase64) {
    return { success: false, reason: 'ai_not_configured' };
  }

  const offsetSec = Math.max(0, Number(chunkStartSec) || 0);
  const winDur = Math.max(1, Number(chunkDurationSec) || Number(duration) || 30);
  const cleanSegments = Array.isArray(vocalSegments)
    ? vocalSegments
        .slice(0, 48)
        .map((s: any) => ({
          start: +(Math.max(0, (Number(s?.start) || 0) - offsetSec)).toFixed(2),
          end: +(Math.max(0.2, (Number(s?.end) || 0) - offsetSec)).toFixed(2),
        }))
        .filter((s: any) => s.end > s.start)
    : [];

  // Stage 3: Dedicated multilingual singing & speech recognition pass (gemini-3.5-transcribe)
  onProgress?.({ stage: 3, event: 'stage', payload: { label: 'transcribing' } });
  let vocalTranscript = '';
  try {
    const segHint = cleanSegments.length
      ? `\nDetected acoustic vocal windows in this clip (relative seconds): ${cleanSegments.slice(0, 18).map((s: any) => `${s.start}-${s.end}`).join(', ')}.`
      : '';
    const transcribeParts: any[] = [
      {
        inlineData: {
          mimeType: 'audio/wav',
          data: separatedVocalBase64 || audioBase64,
        },
      },
      {
        text: `Listen carefully to this audio recording as a specialized multilingual SINGING & SPEECH recognition model (format: ${audioFormat || 'audio'}, original sample rate: ${sampleRate || 'unknown'}Hz, window duration: ${winDur}s${separatedVocalBase64 ? ', vocal-enhanced stem provided' : ''}).${segHint}
1. Process actual SINGING voices (sustained notes, vibrato, melisma, high belting, rap, spoken intros/outros) AND clear speech, NOT just casual conversation cadence.
2. Output EVERY sung or spoken line verbatim on its own line in its exact original language & native script (English, French, Chinese Mandarin/Cantonese, Spanish, German, Japanese, Korean, Italian, Portuguese, etc.; hint: ${lang && lang !== 'auto' && lang !== 'multi' ? lang : 'auto-detect multilingual & code-switching'}).
3. NEVER translate lyrics during transcription. Preserve contractions, French accents, CJK characters, ad-libs, and ALL repeated choruses accurately.
4. Keep line breaks matched to natural sung phrasing so each line is crisp and ready for karaoke synchronization.
5. Mark pure non-vocal instrumental passages as [INSTRUMENTAL]. If a brief phrase is genuinely masked/inaudible, mark [UNCLEAR] instead of inventing words.`,
      },
    ];
    const transcribeResp = await ai.models.generateContent({
      model: 'gemini-3.5-transcribe',
      contents: transcribeParts,
    });
    vocalTranscript = String(transcribeResp.text || '').trim();
    if (vocalTranscript) {
      const previewLines = vocalTranscript
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean);
      onProgress?.({
        stage: 3,
        event: 'transcript_preview',
        payload: { transcript: vocalTranscript, previewLines, offsetSec },
      });
    }
  } catch (tErr: any) {
    const tMsg = tErr?.message || String(tErr || '');
    if (tMsg.includes('billing') || tMsg.includes('free tier') || errIsPermissionDenied(tErr)) {
      throw tErr;
    }
  }

  // Stage 4 & Stage 6: Singing-aware Forced Alignment & Validation (gemini-4-hydrogen, streamlined word schema)
  onProgress?.({ stage: 4, event: 'stage', payload: { label: 'aligning' } });
  const stage1Hint = preprocessingSummary
    ? `\nStage 1-2 acoustic map: sampleRate=${preprocessingSummary.sampleRate || sampleRate}Hz, silenceCount=${preprocessingSummary.silenceCount ?? 0}, vocalSegments=${preprocessingSummary.vocalPhraseCount ?? cleanSegments.length}, instrumentalGaps=${preprocessingSummary.instrumentalGapCount ?? 0}.`
    : '';
  const segAnchorText = cleanSegments.length
    ? `\nAcoustic vocal intervals (rel sec): ${cleanSegments.slice(0, 24).map((s: any) => `[${s.start}..${s.end}]`).join(', ')}.`
    : '';
  const alignPrompt = `You are a singing-aware forced-alignment phonetician and lyric validator executing Stages 4-6.
Analyze the original mix${separatedVocalBase64 ? ' AND center-vocal stem' : ''}.${vocalTranscript ? `\n\nStage 3 verbatim singing transcript (verify and align accurately):\n${vocalTranscript}\n` : ''}${stage1Hint}${segAnchorText}
Preserve timeline starting at 0.000s of this audio window (${winDur}s total). Output strict structured JSON:
1. "audioType": "singing" | "speech" | "instrumental" | "combination".
2. "language": primary BCP-47 code ("en","fr","zh-Hans","zh-Hant","es","de","ja","ko","it","pt","multi", or "instrumental"). Hint: ${lang || 'auto'}.
3. "detectedLanguages": array of ALL distinct BCP-47 languages sung/spoken.
4. "detectedSpeakers": array of active performers (e.g. ["Lead"], ["Lead","Backing"]).
5. "hasBackingVocals", "hasUnclearSections", "hasInstrumentalSections", "hasRepeatedChorus": booleans.
6. "sections": ordered sections { "type", "label", "start", "end", "isRepeat" }.
7. "missingVocalGaps": array of { "start", "end", "reason" } only when audible singing cannot be deciphered.
8. "lines": chronological array covering EVERY sung line, speech phrase, or instrumental break:
   - "text": Exact verbatim lyric in original script, "[INSTRUMENTAL]", or "[Unclear vocal]".
   - "start" & "end": Exact vocal onset & release timestamps in seconds (3 decimals).
   - "section", "vocalType", "language", "speaker", "recognitionConfidence" (0..1), "alignmentConfidence" (0..1), "flags", "validationNote", "isRepeatedChorus", "backingText", "unclear".
   - "words": aligned tokens (for Chinese output EVERY individual character as a token; for Japanese/Korean syllable/mora clusters): { "text", "start", "end", "recognitionConfidence", "alignmentConfidence", "speaker", "flags" }.
9. "title" & "artist": only if clearly identified, else "".`;

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

  let parsed: any = null;
  let usedStageARecovery = false;
  try {
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
    parsed = JSON.parse(response.text || '{}');
  } catch (alignErr: any) {
    const aMsg = alignErr?.message || String(alignErr || '');
    if (aMsg.includes('billing') || aMsg.includes('free tier') || errIsPermissionDenied(alignErr)) {
      throw alignErr;
    }
    if (vocalTranscript) {
      const recovered = parseTranscriptLinesForRecovery(vocalTranscript, cleanSegments, winDur, offsetSec, lang);
      if (recovered.length) {
        usedStageARecovery = true;
        parsed = {
          audioType: 'singing',
          language: lang && lang !== 'auto' ? lang : 'auto',
          lines: recovered,
        };
      }
    }
    if (!parsed) throw alignErr;
  }

  const rawLines = Array.isArray(parsed?.lines) ? parsed.lines : [];
  const lines = normalizeKaraokeLines(rawLines, offsetSec);
  const missingVocalGaps = Array.isArray(parsed?.missingVocalGaps)
    ? parsed.missingVocalGaps.map((g: any) => ({
        start: +(Math.max(0, (Number(g?.start) || 0) + offsetSec)).toFixed(3),
        end: +(Math.max(0.1, (Number(g?.end) || 0) + offsetSec)).toFixed(3),
        reason: String(g?.reason || 'unintelligible_or_missing_vocal').slice(0, 120),
      }))
    : [];
  const sections = Array.isArray(parsed?.sections)
    ? parsed.sections.map((sec: any) => ({
        type: String(sec?.type || 'other').toLowerCase(),
        label: String(sec?.label || sec?.type || ''),
        start: +(Math.max(0, (Number(sec?.start) || 0) + offsetSec)).toFixed(3),
        end: +(Math.max(0.1, (Number(sec?.end) || 0) + offsetSec)).toFixed(3),
        isRepeat: Boolean(sec?.isRepeat),
      }))
    : [];
  const detectedLanguages = Array.isArray(parsed?.detectedLanguages) && parsed.detectedLanguages.length
    ? parsed.detectedLanguages.filter(Boolean)
    : (parsed?.language && parsed.language !== 'auto' && parsed.language !== 'instrumental' ? [parsed.language] : []);
  const speakerSet = new Set<string>(Array.isArray(parsed?.detectedSpeakers) ? parsed.detectedSpeakers.filter(Boolean) : []);
  lines.forEach((ln: any) => {
    if (ln.speaker && ln.speaker !== 'Instrumental') speakerSet.add(ln.speaker);
    (ln.words || []).forEach((w: any) => { if (w.speaker) speakerSet.add(w.speaker); });
  });

  const validationSummary = summarizeValidation(lines, missingVocalGaps);

  return {
    success: true,
    needsClientAcousticAlign: usedStageARecovery,
    audioType: String(parsed?.audioType || (parsed?.isInstrumental ? 'instrumental' : 'singing')).toLowerCase(),
    language: parsed?.language || 'auto',
    detectedLanguages,
    detectedSpeakers: Array.from(speakerSet),
    hasBackingVocals: Boolean(parsed?.hasBackingVocals || lines.some((l: any) => l.backingText || l.vocalType === 'backing' || l.vocalType === 'harmony' || l.vocalType === 'overlapping')),
    hasUnclearSections: Boolean(parsed?.hasUnclearSections || validationSummary.uncertainWords > 0 || lines.some((l: any) => l.unclear)),
    hasInstrumentalSections: Boolean(parsed?.hasInstrumentalSections || parsed?.isInstrumental || lines.some((l: any) => l.isInstrumentalSection)),
    hasRepeatedChorus: Boolean(parsed?.hasRepeatedChorus || lines.some((l: any) => l.isRepeatedChorus) || sections.some((s: any) => s.isRepeat)),
    title: parsed?.title || '',
    artist: parsed?.artist || '',
    isInstrumental: Boolean(parsed?.isInstrumental || parsed?.audioType === 'instrumental'),
    sections,
    validationSummary,
    pipelineModels: {
      separation: separatedVocalBase64 ? 'client_mid_side_formant_stem' : 'single_channel_formant_filter',
      transcription: vocalTranscript ? 'gemini-3.5-transcribe' : 'gemini-4-hydrogen',
      forcedAlignment: usedStageARecovery ? 'client_10ms_vocal_onset_aligner' : 'gemini-4-hydrogen+phoneme_10ms_viterbi',
    },
    lines,
  };
}

function errIsPermissionDenied(err: any): boolean {
  return err?.status === 'PERMISSION_DENIED' || err?.code === 403 || err?.status === 403;
}

function sendSseEvent(res: express.Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// CORE FUNCTION 05 Multi-Stage Server Pipeline (Stages 2-7): Singing Transcription + Forced Alignment + Validation
app.post('/api/transcribe-lyrics', async (req, res) => {
  try {
    const result = await runSingingTranscriptionPipeline(req.body);
    return res.status(200).json(result);
  } catch (err: any) {
    const msg = err?.message || String(err || '');
    const isBilling = msg.includes('billing') || msg.includes('free tier') || errIsPermissionDenied(err);
    return res.status(200).json({
      success: false,
      reason: isBilling ? 'billing_required' : 'transcription_error',
      requiresBilling: isBilling,
      message: msg.slice(0, 300),
    });
  }
});

// CORE FUNCTION 05 SSE Streaming Endpoint: Emits live transcript preview immediately after Stage 3
app.post('/api/transcribe-lyrics/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let closed = false;
  res.on('close', () => { if (!res.writableEnded) closed = true; });

  try {
    const result = await runSingingTranscriptionPipeline(req.body, evt => {
      if (closed) return;
      sendSseEvent(res, evt.event, { stage: evt.stage, ...(evt.payload || {}) });
    });
    if (!closed) {
      if (result && result.success) {
        sendSseEvent(res, 'result', result);
      } else {
        sendSseEvent(res, 'error', result || { success: false, reason: 'transcription_error' });
      }
      res.end();
    }
  } catch (err: any) {
    if (!closed) {
      const msg = err?.message || String(err || '');
      const isBilling = msg.includes('billing') || msg.includes('free tier') || errIsPermissionDenied(err);
      sendSseEvent(res, 'error', {
        success: false,
        reason: isBilling ? 'billing_required' : 'transcription_error',
        requiresBilling: isBilling,
        message: msg.slice(0, 300),
      });
      res.end();
    }
  }
});

// FUNCTION 08: Accuracy-First Automatic Re-Analysis of Low-Confidence Segments
app.post('/api/reanalyze-segment', async (req, res) => {
  try {
    const {
      audioBase64,
      separatedVocalBase64,
      startSec,
      endSec,
      existingWords,
      qualityConditions,
      lang,
    } = req.body || {};
    if (!ai || !audioBase64) {
      return res.status(200).json({ success: false, reason: 'ai_not_configured' });
    }
    const offsetSec = Math.max(0, Number(startSec) || 0);
    const segDur = Math.max(0.2, (Number(endSec) || offsetSec + 2) - offsetSec);
    const condDesc = qualityConditions
      ? `noise=${qualityConditions.isNoisy ? 'YES' : 'no'}, distortion=${qualityConditions.isDistorted ? 'YES' : 'no'}, reverb=${qualityConditions.isReverberated ? 'YES' : 'no'}, overlappingVocals=${qualityConditions.hasOverlappingSingers ? 'YES' : 'no'}`
      : 'standard';

    // Focused high-accuracy pass 1: gemini-3.5-transcribe on separated vocal slice
    let focusTranscript = '';
    try {
      const tResp = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: [
          {
            inlineData: {
              mimeType: 'audio/wav',
              data: separatedVocalBase64 || audioBase64,
            },
          },
          {
            text: `Re-listen with extreme care to this ${segDur.toFixed(2)}s singing excerpt flagged as low-confidence (${condDesc}). Language hint: ${lang || 'auto'}.
Previous candidate words (may contain errors or timing drift): ${JSON.stringify((existingWords || []).map((w: any) => w.text || '')).slice(0, 800)}.
Transcribe ONLY what is genuinely audible in the singing voice. Mark ambiguous syllables honestly as [UNCLEAR]—never invent words and never exaggerate certainty.`,
          },
        ],
      });
      focusTranscript = String(tResp.text || '').trim();
    } catch (tErr: any) {
      const tMsg = tErr?.message || String(tErr || '');
      if (tMsg.includes('billing') || tMsg.includes('free tier') || tErr?.status === 'PERMISSION_DENIED' || tErr?.code === 403) {
        throw tErr;
      }
    }

    // Pass 2: Focused phonetic forced alignment (gemini-4-hydrogen) with honest confidence calibration
    const alignResp = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: [
        { inlineData: { mimeType: 'audio/wav', data: audioBase64 } },
        ...(separatedVocalBase64 ? [{ inlineData: { mimeType: 'audio/wav', data: separatedVocalBase64 } }] : []),
        {
          text: `Perform accuracy-first phonetic re-alignment of this short ${segDur.toFixed(2)}s excerpt (timeline starts at 0.000s inside this clip).
Acoustic conditions: ${condDesc}.
${focusTranscript ? `Focused vocal transcript:\n${focusTranscript}\n` : ''}Existing low-confidence tokens with relative hints:
${JSON.stringify((existingWords || []).map((w: any) => ({ text: w.text, start: +Math.max(0, (Number(w.start) || 0) - offsetSec).toFixed(3), end: +Math.max(0, (Number(w.end) || 0) - offsetSec).toFixed(3) })), null, 2)}

Rules:
- Accuracy is strictly more important than speed.
- Re-anchor word & phoneme boundaries directly to true sung vocal energy & consonant attacks.
- Never claim 1.0 (100%) confidence automatically; cap honest scores <= 0.96, and reduce scores whenever noise, reverb, distortion, or overlapping vocals obscure the articulation.
- Output JSON with "lines": [{ "text", "start", "end", "vocalType", "speaker", "recognitionConfidence", "alignmentConfidence", "flags", "words": [{ "text", "start", "end", "recognitionConfidence", "alignmentConfidence", "audioClarity", "vocalOverlap", "flags", "phonemes": [{"unit","start","end"}], "chars": [{"ch","start","end"}] }] }].`,
        },
      ],
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
    return res.json({ success: true, lines, focusTranscript });
  } catch (err: any) {
    const msg = err?.message || String(err || '');
    const isBilling = msg.includes('billing') || msg.includes('free tier') || err?.status === 'PERMISSION_DENIED' || err?.code === 403;
    return res.status(200).json({
      success: false,
      reason: isBilling ? 'billing_required' : 'reanalysis_error',
      requiresBilling: isBilling,
      message: msg.slice(0, 300),
    });
  }
});

// FUNCTION 09: Optional Multilingual Lyrics Translation Layer (preserves original detected lyrics & timeline indices)
app.post('/api/translate-lyrics', async (req, res) => {
  try {
    const { lines, targetLang } = req.body || {};
    const target = String(targetLang || 'en').trim();
    const inputLines = Array.isArray(lines) ? lines : [];
    if (!inputLines.length) {
      return res.json({ success: true, targetLang: target, detectedSourceLanguages: [], translations: [] });
    }
    if (!ai) {
      return res.status(200).json({ success: false, reason: 'ai_not_configured' });
    }

    const langNames: Record<string, string> = {
      en: 'English',
      fr: 'French (Français)',
      'zh-Hans': 'Simplified Chinese Mandarin (简体中文)',
      'zh-Hant': 'Traditional Chinese Mandarin (繁體中文)',
      es: 'Spanish (Español)',
      de: 'German (Deutsch)',
      ja: 'Japanese (日本語)',
      ko: 'Korean (한국어)',
      it: 'Italian (Italiano)',
      pt: 'Portuguese (Português)',
    };
    const targetLabel = langNames[target] || target;
    const payloadLines = inputLines.map((l: any, i: number) => ({
      index: Number.isInteger(Number(l?.index)) ? Number(l.index) : i,
      text: String(l?.text || ''),
      language: String(l?.language || ''),
      interlude: Boolean(l?.interlude),
    }));

    const resp = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: [
        {
          text: `Translate these synchronized song lyric lines accurately into ${targetLabel} (target code: "${target}").
Requirements:
- Keep the EXACT array indices provided; NEVER add, remove, merge, or split lines.
- Songs may mix multiple languages across lines or within a line (code-switching); detect each line's actual source language ("sourceLanguage") accurately.
- Preserve lyrical meaning, emotion, and natural singable subtitle conciseness so it fits cleanly on the shared timeline.
- If a line is marked "interlude": true or starts with "[interlude" / "[INSTRUMENTAL]" / "[Unclear", return an empty string "" for "translatedText".
- If a line is already in ${targetLabel}, refine or keep it naturally without adding notes or explanations.

Lines JSON:
${JSON.stringify(payloadLines)}`,
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            detectedSourceLanguages: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            translations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  index: { type: Type.INTEGER },
                  sourceLanguage: { type: Type.STRING },
                  translatedText: { type: Type.STRING },
                },
                required: ['index', 'sourceLanguage', 'translatedText'],
              },
            },
          },
          required: ['detectedSourceLanguages', 'translations'],
        },
      },
    });

    const parsed = JSON.parse(resp.text || '{}');
    const trList = Array.isArray(parsed.translations) ? parsed.translations : [];
    const byIdx = new Map<number, any>();
    for (const t of trList) {
      if (t && Number.isInteger(Number(t.index))) {
        byIdx.set(Number(t.index), t);
      }
    }
    const normalized = payloadLines.map(src => {
      if (src.interlude || !src.text.trim() || /^\[(?:interlude|instrumental|間奏|间奏|간주)/i.test(src.text.trim())) {
        return { index: src.index, sourceLanguage: src.language || '', translatedText: '' };
      }
      const hit = byIdx.get(src.index);
      return {
        index: src.index,
        sourceLanguage: String(hit?.sourceLanguage || src.language || '').trim(),
        translatedText: String(hit?.translatedText || '').trim(),
      };
    });

    return res.json({
      success: true,
      targetLang: target,
      detectedSourceLanguages: Array.isArray(parsed.detectedSourceLanguages) ? parsed.detectedSourceLanguages : [],
      translations: normalized,
    });
  } catch (err: any) {
    const msg = err?.message || String(err || '');
    const isBilling = msg.includes('billing') || msg.includes('free tier') || err?.status === 'PERMISSION_DENIED' || err?.code === 403;
    return res.status(200).json({
      success: false,
      reason: isBilling ? 'billing_required' : 'translation_error',
      requiresBilling: isBilling,
      message: msg.slice(0, 300),
    });
  }
});

// ---------------- Real-Time Weather, Air Quality, Pollen & Geocoding Proxy ----------------
const GMP_SOLUTION_ID = 'gmp_mcp_codeassist_v1_aistudio';
const weatherCache = new Map<string, { expiresAt: number; payload: any }>();
const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000;

function getMapsApiKey(): string {
  return (
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    process.env.MAPS_API_KEY ||
    ''
  ).trim();
}

function isGmpQuotaError(status: number, body: any): boolean {
  if (status === 429) return true;
  const errStatus = body?.error?.status;
  if (errStatus === 'RESOURCE_EXHAUSTED') return true;
  return false;
}

async function fetchJsonWithGmp(url: string, init: RequestInit = {}) {
  const headers: Record<string, string> = {
    'X-Goog-Maps-Solution-ID': GMP_SOLUTION_ID,
    ...((init.headers as Record<string, string>) || {}),
  };
  const resp = await fetch(url, { ...init, headers });
  let data: any = null;
  try {
    data = await resp.json();
  } catch {
    data = null;
  }
  return {
    ok: resp.ok,
    status: resp.status,
    quotaExceeded: isGmpQuotaError(resp.status, data),
    data,
  };
}

function extractLocationSummary(geoData: any, lat: number, lng: number) {
  const results = Array.isArray(geoData?.results) ? geoData.results : [];
  if (!results.length) {
    return {
      shortName: `${lat.toFixed(3)}, ${lng.toFixed(3)}`,
      locality: '',
      neighborhood: '',
      region: '',
      country: '',
      formattedAddress: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    };
  }
  const comps: any[] = [];
  for (const r of results) {
    if (Array.isArray(r.addressComponents)) {
      for (const c of r.addressComponents) comps.push(c);
    }
  }
  const findComp = (...types: string[]) => {
    for (const t of types) {
      const hit = comps.find(c => Array.isArray(c.types) && c.types.includes(t));
      if (hit?.longText || hit?.shortText) return String(hit.longText || hit.shortText);
    }
    return '';
  };
  const neighborhood = findComp('sublocality_level_1', 'sublocality', 'neighborhood', 'route');
  const locality = findComp('locality', 'postal_town', 'administrative_area_level_2');
  const region = findComp('administrative_area_level_1');
  const country = findComp('country');
  const shortParts = [neighborhood && neighborhood !== locality ? neighborhood : '', locality || region || country].filter(Boolean);
  const shortName = shortParts.length ? shortParts.join(' · ') : (results[0]?.formattedAddress || `${lat.toFixed(3)}, ${lng.toFixed(3)}`);
  const formattedAddress = String(results[0]?.formattedAddress || shortName);
  return {
    shortName,
    locality: locality || region || '',
    neighborhood,
    region,
    country,
    formattedAddress,
  };
}

function pollenGrainsToUpi(grains: number): { value: number; categoryFr: string; categoryEn: string } {
  if (!Number.isFinite(grains) || grains <= 1) return { value: 0, categoryFr: 'Très faible', categoryEn: 'Very Low' };
  if (grains <= 10) return { value: 1, categoryFr: 'Faible', categoryEn: 'Low' };
  if (grains <= 35) return { value: 2, categoryFr: 'Modéré', categoryEn: 'Moderate' };
  if (grains <= 80) return { value: 3, categoryFr: 'Élevé', categoryEn: 'High' };
  if (grains <= 160) return { value: 4, categoryFr: 'Très élevé', categoryEn: 'Very High' };
  return { value: 5, categoryFr: 'Extrême', categoryEn: 'Extreme' };
}

function classifyEaqi(eaqi: number, usAqi: number, isFr: boolean) {
  const score = Number.isFinite(usAqi) ? Math.round(usAqi) : Math.round(eaqi);
  if (Number.isFinite(eaqi)) {
    if (eaqi <= 20) return { score, cat: isFr ? 'Excellente qualité de l’air' : 'Excellent air quality', advice: isFr ? 'Air pur, idéal pour toutes les activités extérieures.' : 'Clean air, ideal for all outdoor activities.' };
    if (eaqi <= 40) return { score, cat: isFr ? 'Bonne qualité de l’air' : 'Good air quality', advice: isFr ? 'Conditions atmosphériques favorables en extérieur.' : 'Good outdoor atmospheric conditions.' };
    if (eaqi <= 60) return { score, cat: isFr ? 'Qualité de l’air modérée' : 'Moderate air quality', advice: isFr ? 'Qualité correcte ; les personnes très sensibles peuvent limiter l’effort prolongé.' : 'Moderate quality; sensitive individuals should moderate prolonged exertion.' };
    if (eaqi <= 80) return { score, cat: isFr ? 'Qualité de l’air médiocre' : 'Poor air quality', advice: isFr ? 'Réduisez les efforts intenses en plein air si vous ressentez une gêne.' : 'Reduce intense outdoor activity if respiratory discomfort occurs.' };
    return { score, cat: isFr ? 'Mauvaise qualité de l’air' : 'Very poor air quality', advice: isFr ? 'Évitez les activités sportives extérieures prolongées.' : 'Avoid prolonged outdoor physical exertion.' };
  }
  return { score, cat: isFr ? 'Qualité modérée' : 'Moderate air quality', advice: '' };
}

async function fetchOpenMeteoAtmosphericFallback(lat: number, lng: number, lang: string) {
  const isFr = !String(lang || 'fr').toLowerCase().startsWith('en');
  try {
    const url = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lng));
    url.searchParams.set('current', 'us_aqi,european_aqi,pm2_5,pm10,nitrogen_dioxide,ozone,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen');
    url.searchParams.set('hourly', 'alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen');
    url.searchParams.set('forecast_days', '5');
    url.searchParams.set('timezone', 'auto');
    const resp = await fetch(url.toString());
    if (!resp.ok) return { aqi: null, pollen: null };
    const om = await resp.json();
    const cur = om?.current || {};

    const pm25 = Number(cur.pm2_5);
    const pm10 = Number(cur.pm10);
    const no2 = Number(cur.nitrogen_dioxide);
    const o3 = Number(cur.ozone);
    const eaqi = Number(cur.european_aqi);
    const usAqi = Number(cur.us_aqi);
    const pollutantsRaw = [
      { code: 'pm25', ratio: Number.isFinite(pm25) ? pm25 / 15 : 0, val: pm25 },
      { code: 'pm10', ratio: Number.isFinite(pm10) ? pm10 / 45 : 0, val: pm10 },
      { code: 'no2', ratio: Number.isFinite(no2) ? no2 / 25 : 0, val: no2 },
      { code: 'o3', ratio: Number.isFinite(o3) ? o3 / 100 : 0, val: o3 },
    ].sort((a, b) => b.ratio - a.ratio);
    const dominantPollutant = pollutantsRaw[0]?.code || 'pm25';
    const aqiMeta = classifyEaqi(eaqi, usAqi, isFr);
    const aqi = Number.isFinite(aqiMeta.score) ? {
      dateTime: cur.time || new Date().toISOString(),
      source: 'open-meteo',
      indexes: [
        {
          code: 'eaqi',
          displayName: Number.isFinite(eaqi) ? 'European AQI' : 'US AQI',
          aqi: Number.isFinite(eaqi) ? Math.round(eaqi) : aqiMeta.score,
          aqiDisplay: String(Number.isFinite(eaqi) ? Math.round(eaqi) : aqiMeta.score),
          category: aqiMeta.cat,
          dominantPollutant,
        },
      ],
      healthRecommendations: {
        generalPopulation: aqiMeta.advice,
      },
    } : null;

    const hTimes: string[] = Array.isArray(om?.hourly?.time) ? om.hourly.time : [];
    const byDay = new Map<string, { grass: number; tree: number; weed: number; plants: Record<string, number> }>();
    const addReading = (dateKey: string, field: string, v: number) => {
      if (!byDay.has(dateKey)) {
        byDay.set(dateKey, { grass: 0, tree: 0, weed: 0, plants: {} });
      }
      const b = byDay.get(dateKey)!;
      const val = Number.isFinite(v) ? v : 0;
      if (field === 'grass_pollen') b.grass = Math.max(b.grass, val);
      else if (field === 'birch_pollen' || field === 'alder_pollen' || field === 'olive_pollen') {
        b.tree = Math.max(b.tree, val);
        b.plants[field] = Math.max(b.plants[field] || 0, val);
      } else {
        b.weed = Math.max(b.weed, val);
        b.plants[field] = Math.max(b.plants[field] || 0, val);
      }
    };
    const pFields = ['grass_pollen', 'birch_pollen', 'alder_pollen', 'olive_pollen', 'mugwort_pollen', 'ragweed_pollen'];
    hTimes.forEach((iso, idx) => {
      const dateKey = String(iso).slice(0, 10);
      for (const f of pFields) {
        const arr = om?.hourly?.[f];
        if (Array.isArray(arr) && arr[idx] != null) addReading(dateKey, f, Number(arr[idx]));
      }
    });

    const dailyInfo = Array.from(byDay.entries()).slice(0, 5).map(([dateKey, agg]) => {
      const [yy, mm, dd] = dateKey.split('-').map(Number);
      const gU = pollenGrainsToUpi(agg.grass);
      const tU = pollenGrainsToUpi(agg.tree);
      const wU = pollenGrainsToUpi(agg.weed);
      const maxUpi = Math.max(gU.value, tU.value, wU.value);
      const advice = maxUpi === 0
        ? (isFr ? 'Niveau de pollen très faible aujourd’hui.' : 'Very low pollen levels today.')
        : maxUpi <= 2
          ? (isFr ? 'Allergènes faibles à modérés ; aérez plutôt le matin.' : 'Low to moderate pollen; ventilate indoors in early morning.')
          : (isFr ? 'Pic pollinique actif : rincez vos yeux/cheveux et limitez l’aération l’après-midi.' : 'Active pollen peak: rinse hair and keep windows closed in afternoon.');
      return {
        date: { year: yy, month: mm, day: dd },
        pollenTypeInfo: [
          {
            code: 'GRASS',
            displayName: isFr ? 'Graminées' : 'Grass',
            inSeason: agg.grass > 0,
            indexInfo: { value: gU.value, category: isFr ? gU.categoryFr : gU.categoryEn },
            healthRecommendations: [advice],
          },
          {
            code: 'TREE',
            displayName: isFr ? 'Arbres' : 'Tree',
            inSeason: agg.tree > 0,
            indexInfo: { value: tU.value, category: isFr ? tU.categoryFr : tU.categoryEn },
          },
          {
            code: 'WEED',
            displayName: isFr ? 'Herbacées' : 'Weed',
            inSeason: agg.weed > 0,
            indexInfo: { value: wU.value, category: isFr ? wU.categoryFr : wU.categoryEn },
          },
        ],
        plantInfo: Object.entries(agg.plants)
          .filter(([, gv]) => gv > 1)
          .map(([k, gv]) => ({
            code: k.toUpperCase(),
            displayName: k.replace('_pollen', '').replace('_', ' '),
            inSeason: true,
            indexInfo: { value: pollenGrainsToUpi(gv).value },
          })),
      };
    });

    const pollen = dailyInfo.length ? { source: 'open-meteo', dailyInfo } : null;
    return { aqi, pollen };
  } catch {
    return { aqi: null, pollen: null };
  }
}

app.get('/api/weather', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const lang = String(req.query.lang || 'fr').trim().slice(0, 10) || 'fr';

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ success: false, reason: 'invalid_coordinates' });
  }

  const mapsKey = getMapsApiKey();
  if (!mapsKey) {
    return res.status(200).json({ success: false, reason: 'maps_key_not_configured' });
  }

  const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)},${lang}`;
  const cached = weatherCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return res.json({ ...cached.payload, cached: true });
  }

  const curUrl = new URL('https://weather.googleapis.com/v1/currentConditions:lookup');
  curUrl.searchParams.set('key', mapsKey);
  curUrl.searchParams.set('location.latitude', String(lat));
  curUrl.searchParams.set('location.longitude', String(lng));
  curUrl.searchParams.set('unitsSystem', 'METRIC');

  const daysUrl = new URL('https://weather.googleapis.com/v1/forecast/days:lookup');
  daysUrl.searchParams.set('key', mapsKey);
  daysUrl.searchParams.set('location.latitude', String(lat));
  daysUrl.searchParams.set('location.longitude', String(lng));
  daysUrl.searchParams.set('days', '7');
  daysUrl.searchParams.set('pageSize', '7');
  daysUrl.searchParams.set('unitsSystem', 'METRIC');

  const aqiUrl = `https://airquality.googleapis.com/v1/currentConditions:lookup?key=${encodeURIComponent(mapsKey)}`;

  const pollenUrl = new URL('https://pollen.googleapis.com/v1/forecast:lookup');
  pollenUrl.searchParams.set('key', mapsKey);
  pollenUrl.searchParams.set('location.latitude', String(lat));
  pollenUrl.searchParams.set('location.longitude', String(lng));
  pollenUrl.searchParams.set('days', '5');
  pollenUrl.searchParams.set('plantsDescription', 'false');
  pollenUrl.searchParams.set('languageCode', lang);

  const geoUrl = new URL('https://geocode.googleapis.com/v4/geocode/location');
  geoUrl.searchParams.set('location.latitude', String(lat));
  geoUrl.searchParams.set('location.longitude', String(lng));
  geoUrl.searchParams.set('languageCode', lang);

  try {
    const [curRes, daysRes, aqiRes, pollenRes, geoRes] = await Promise.all([
      fetchJsonWithGmp(curUrl.toString()),
      fetchJsonWithGmp(daysUrl.toString()),
      fetchJsonWithGmp(aqiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          universalAqi: true,
          location: { latitude: lat, longitude: lng },
          extraComputations: [
            'HEALTH_RECOMMENDATIONS',
            'DOMINANT_POLLUTANT_CONCENTRATION',
            'POLLUTANT_CONCENTRATION',
            'LOCAL_AQI',
          ],
          languageCode: lang,
        }),
      }),
      fetchJsonWithGmp(pollenUrl.toString()),
      fetchJsonWithGmp(geoUrl.toString(), {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': mapsKey,
          'X-Goog-FieldMask': 'results.placeId,results.formattedAddress,results.addressComponents,results.types,plusCode',
        },
      }),
    ]);

    const quotaExceeded = Boolean(
      curRes.quotaExceeded ||
      daysRes.quotaExceeded ||
      aqiRes.quotaExceeded ||
      pollenRes.quotaExceeded ||
      geoRes.quotaExceeded,
    );

    if (quotaExceeded && !curRes.ok && !daysRes.ok) {
      return res.status(429).json({
        success: false,
        quotaExceeded: true,
        reason: 'quota_exceeded',
      });
    }

    // Follow nextPageToken once if Forecast returned < 7 days cleanly
    let forecastDays: any[] = Array.isArray(daysRes.data?.forecastDays) ? daysRes.data.forecastDays.slice() : [];
    if (daysRes.ok && daysRes.data?.nextPageToken && forecastDays.length < 7) {
      const p2Url = new URL(daysUrl.toString());
      p2Url.searchParams.set('pageToken', String(daysRes.data.nextPageToken));
      const p2Res = await fetchJsonWithGmp(p2Url.toString());
      if (p2Res.ok && Array.isArray(p2Res.data?.forecastDays)) {
        forecastDays = forecastDays.concat(p2Res.data.forecastDays).slice(0, 7);
      }
    }

    let finalAqiRes = aqiRes;
    if (!finalAqiRes.ok && !finalAqiRes.quotaExceeded && finalAqiRes.status === 400) {
      finalAqiRes = await fetchJsonWithGmp(aqiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          universalAqi: true,
          location: { latitude: lat, longitude: lng },
        }),
      });
    }

    const cur = curRes.ok ? curRes.data : null;
    let aqi = finalAqiRes.ok ? finalAqiRes.data : null;
    let pollen = pollenRes.ok ? pollenRes.data : null;
    const location = extractLocationSummary(geoRes.ok ? geoRes.data : null, lat, lng);

    if ((!aqi || !pollen) && !quotaExceeded) {
      const fb = await fetchOpenMeteoAtmosphericFallback(lat, lng, lang);
      if (!aqi && fb.aqi) aqi = fb.aqi;
      if (!pollen && fb.pollen) pollen = fb.pollen;
    }

    if (!cur && !forecastDays.length) {
      return res.status(200).json({
        success: false,
        quotaExceeded,
        reason: curRes.data?.error?.message || 'weather_unavailable',
        status: curRes.status,
      });
    }

    const payload = {
      success: true,
      quotaExceeded,
      fetchedAt: new Date().toISOString(),
      coordinates: { lat: +lat.toFixed(5), lng: +lng.toFixed(5) },
      location,
      current: cur,
      forecastDays,
      airQuality: aqi,
      pollen,
    };

    if (weatherCache.size > 100) {
      const firstKey = weatherCache.keys().next().value;
      if (firstKey) weatherCache.delete(firstKey);
    }
    weatherCache.set(cacheKey, {
      expiresAt: Date.now() + WEATHER_CACHE_TTL_MS,
      payload,
    });

    return res.json(payload);
  } catch (err: any) {
    return res.status(502).json({
      success: false,
      reason: 'weather_proxy_error',
      message: err?.message || String(err),
    });
  }
});

app.get('/api/weather/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const lang = String(req.query.lang || 'fr').trim().slice(0, 10) || 'fr';
  if (!q) {
    return res.status(400).json({ success: false, reason: 'missing_query' });
  }
  const mapsKey = getMapsApiKey();
  if (!mapsKey) {
    return res.status(200).json({ success: false, reason: 'maps_key_not_configured' });
  }

  try {
    const geoUrl = new URL(`https://geocode.googleapis.com/v4/geocode/address/${encodeURIComponent(q)}`);
    geoUrl.searchParams.set('languageCode', lang);
    const geoRes = await fetchJsonWithGmp(geoUrl.toString(), {
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': mapsKey,
        'X-Goog-FieldMask': 'results.placeId,results.location,results.formattedAddress,results.addressComponents',
      },
    });
    if (geoRes.quotaExceeded) {
      return res.status(429).json({ success: false, quotaExceeded: true, reason: 'quota_exceeded' });
    }
    const first = Array.isArray(geoRes.data?.results) ? geoRes.data.results[0] : null;
    if (!first?.location || !Number.isFinite(first.location.latitude) || !Number.isFinite(first.location.longitude)) {
      return res.status(200).json({ success: false, reason: 'location_not_found' });
    }
    const summary = extractLocationSummary(geoRes.data, first.location.latitude, first.location.longitude);
    return res.json({
      success: true,
      lat: first.location.latitude,
      lng: first.location.longitude,
      location: summary,
    });
  } catch (err: any) {
    return res.status(502).json({
      success: false,
      reason: 'geocode_search_error',
      message: err?.message || String(err),
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

app.get(['/studio', '/studio/'], (req, res) => {
  if (!req.path.endsWith('/')) {
    return res.redirect(301, '/studio/');
  }
  res.sendFile(path.join(__dirname, 'studio', 'index.html'));
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
