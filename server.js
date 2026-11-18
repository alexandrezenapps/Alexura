// server.ts
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type } from "@google/genai";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var app = express();
var portArgIndex = process.argv.indexOf("--port");
var cliPort = portArgIndex !== -1 ? Number(process.argv[portArgIndex + 1]) : null;
var PORT = cliPort || Number(process.env.APP_PORT) || 3e3;
var HOST = "0.0.0.0";
var ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build"
    }
  }
}) : null;
app.use(express.json({ limit: "35mb" }));
app.use("/api", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
});
function validateHttpsTarget(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "https:") return null;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h === "::1" || h.endsWith(".local") || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h)) {
      return null;
    }
    return u.toString();
  } catch {
    return null;
  }
}
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    app: "Alexura",
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    firebaseConfigured: true,
    vercelConnected: Boolean(process.env.VERCEL || process.env.VERCEL_URL || process.env.EXTERNAL_APP_URL || process.env.VERCEL_DEPLOY_HOOK_URL),
    vercelUrl: process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : process.env.EXTERNAL_APP_URL || "",
    bridgeConfigured: Boolean(process.env.EXTERNAL_APP_URL || process.env.VERCEL_DEPLOY_HOOK_URL),
    endpoints: ["/api/health", "/api/transcribe-lyrics", "/api/align-vocals", "/api/reanalyze-segment", "/api/translate-lyrics", "/api/bridge"]
  });
});
app.post("/api/bridge", async (req, res) => {
  const { action, targetUrl, payload } = req.body || {};
  const explicitTarget = validateHttpsTarget(targetUrl);
  const envTarget = action === "deploy" ? process.env.VERCEL_DEPLOY_HOOK_URL : process.env.EXTERNAL_APP_URL;
  const target = explicitTarget || (envTarget ? validateHttpsTarget(envTarget) : null);
  if (!target) {
    return res.status(200).json({
      success: false,
      reason: action === "deploy" ? "vercel_deploy_hook_not_configured" : action === "ping" ? "vercel_url_not_configured" : "external_app_url_not_configured"
    });
  }
  try {
    if (action === "ping") {
      const u = new URL(target);
      const pingUrl = u.pathname === "/" ? `${u.origin}/api/health` : u.toString();
      const upstream2 = await fetch(pingUrl, { method: "GET" });
      const text2 = await upstream2.text();
      return res.json({
        success: upstream2.ok,
        status: upstream2.status,
        url: pingUrl,
        response: text2.slice(0, 500)
      });
    }
    const upstream = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? { source: "Alexura", timestamp: (/* @__PURE__ */ new Date()).toISOString() })
    });
    const text = await upstream.text();
    return res.json({ success: upstream.ok, status: upstream.status, response: text.slice(0, 500) });
  } catch (err) {
    return res.status(502).json({
      success: false,
      reason: "upstream_unreachable",
      message: err?.message || String(err)
    });
  }
});
function clampConf(val, fallback = 0.84) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return +Math.max(0.05, Math.min(0.98, n)).toFixed(3);
}
function classifyWordTierServer(recConf, alignConf, clarity, overlap, flags) {
  const f = new Set(flags || []);
  const hasUnc = f.has("uncertain_word") || f.has("misrecognized_word") || f.has("missing_word");
  const hasBnd = f.has("uncertain_boundary");
  const overlapPenalty = overlap > 0.45 ? 0.14 : overlap > 0.25 ? 0.06 : 0;
  const clarityPenalty = clarity < 0.45 ? 0.16 : clarity < 0.65 ? 0.06 : 0;
  const overall = Math.max(0.05, Math.min(0.97, +(0.42 * recConf + 0.36 * alignConf + 0.22 * clarity - overlapPenalty - clarityPenalty).toFixed(3)));
  const uncertainty = +Math.max(0.02, Math.min(0.95, 1 - overall)).toFixed(3);
  let tier = "MEDIUM";
  if (!hasUnc && !hasBnd && overlap <= 0.35 && clarity >= 0.65 && recConf >= 0.78 && alignConf >= 0.78 && overall >= 0.78) {
    tier = "HIGH";
  } else if (hasUnc || recConf < 0.65 || alignConf < 0.62 || clarity < 0.45 || overall < 0.58) {
    tier = "LOW";
  }
  return { overall, uncertainty, tier };
}
function buildCharTimingsServer(wordText, start, end, rawChars) {
  const chars = Array.from(wordText);
  const n = chars.length;
  if (!n || end <= start) return chars.map((ch) => ({ ch, start, end }));
  if (Array.isArray(rawChars) && rawChars.length === n) {
    let cPrev = start;
    const out = [];
    for (let i = 0; i < n; i++) {
      const rc = rawChars[i];
      let cs = Number(rc?.start);
      let ce = Number(rc?.end);
      cs = Number.isFinite(cs) ? Math.max(cPrev, Math.min(end - 4e-3, cs)) : cPrev;
      ce = Number.isFinite(ce) ? Math.min(end, Math.max(cs + 4e-3, ce)) : i === n - 1 ? end : Math.min(end, cs + Math.max(0.01, (end - cs) / (n - i)));
      if (i === n - 1) ce = end;
      cs = +cs.toFixed(3);
      ce = +Math.max(cs + 4e-3, ce).toFixed(3);
      cPrev = ce;
      out.push({ ch: chars[i], start: cs, end: ce });
    }
    return out;
  }
  const weights = chars.map((ch) => {
    if (/[aeiouyàâäéèêëîïôöùûüÿæœ]/i.test(ch)) return 1.35;
    if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(ch)) return 1.4;
    if (/[a-zA-Z0-9À-ÿ]/.test(ch)) return 0.9;
    return 0.3;
  });
  const total = weights.reduce((a, b) => a + b, 0) || n;
  const dur = end - start;
  let cur = start;
  return chars.map((ch, idx) => {
    const step = weights[idx] / total * dur;
    const cs = +cur.toFixed(3);
    cur += step;
    const ce = idx === n - 1 ? +end.toFixed(3) : +Math.max(cs + 8e-3, cur).toFixed(3);
    return { ch, start: cs, end: ce };
  });
}
var VALID_WORD_FLAGS = /* @__PURE__ */ new Set([
  "uncertain_word",
  "missing_word",
  "misrecognized_word",
  "overlapping_vocals",
  "uncertain_boundary"
]);
function normalizeFlagsList(rawFlags, recConf, alignConf, vocalType, isUnclear) {
  const set = /* @__PURE__ */ new Set();
  if (Array.isArray(rawFlags)) {
    for (const f of rawFlags) {
      const s = String(f || "").trim().toLowerCase();
      if (VALID_WORD_FLAGS.has(s)) set.add(s);
    }
  }
  if (isUnclear || recConf < 0.72) set.add("uncertain_word");
  if (recConf < 0.52 && !isUnclear) set.add("misrecognized_word");
  if (alignConf < 0.7) set.add("uncertain_boundary");
  if (vocalType === "overlapping" || vocalType === "harmony" || vocalType === "backing") set.add("overlapping_vocals");
  return Array.from(set);
}
function normalizeKaraokeLines(rawLines, chunkOffsetSec = 0) {
  const out = [];
  const off = Math.max(0, Number(chunkOffsetSec) || 0);
  let prevEnd = off;
  for (const l of rawLines) {
    const vocalTypeRaw = String(l?.vocalType || "singing").toLowerCase();
    const isInst = vocalTypeRaw === "instrumental" || Boolean(l?.isInstrumentalSection);
    const isUnclear = Boolean(l?.unclear) || vocalTypeRaw === "unclear";
    let text = String(l?.text || "").trim();
    if (!text && isInst) text = "[INSTRUMENTAL]";
    if (!text && isUnclear) text = "[Unclear vocal]";
    if (!text) continue;
    let start = Math.max(prevEnd, (Number(l?.start) || 0) + off);
    let end = Math.max(start + 0.12, (Number(l?.end) || start - off + 2) + off);
    start = +start.toFixed(3);
    end = +end.toFixed(3);
    prevEnd = end;
    const section = String(l?.section || (isInst ? "instrumental" : "verse")).toLowerCase();
    const backingText = l?.backingText ? String(l.backingText).trim() : "";
    const language = l?.language ? String(l.language).trim() : "";
    const isRepeatedChorus = Boolean(l?.isRepeatedChorus) || section === "chorus";
    const lineSpeaker = String(l?.speaker || (vocalTypeRaw === "backing" || vocalTypeRaw === "harmony" ? "Backing" : vocalTypeRaw === "speech" ? "Speaker" : "Lead")).trim();
    const lineRecConf = clampConf(l?.recognitionConfidence, isUnclear ? 0.35 : 0.92);
    const lineAlignConf = clampConf(l?.alignmentConfidence, isUnclear ? 0.45 : 0.9);
    const lineFlags = normalizeFlagsList(l?.flags, lineRecConf, lineAlignConf, vocalTypeRaw, isUnclear);
    const validationNote = l?.validationNote ? String(l.validationNote).trim() : "";
    if (isInst) {
      out.push({
        text: "[INSTRUMENTAL]",
        start,
        end,
        section: section || "instrumental",
        vocalType: "instrumental",
        language,
        speaker: "Instrumental",
        recognitionConfidence: 0.96,
        alignmentConfidence: 0.95,
        isRepeatedChorus: false,
        backingText: "",
        unclear: false,
        isInstrumentalSection: true,
        flags: [],
        validationNote: "",
        words: []
      });
      continue;
    }
    const rawWords = Array.isArray(l?.words) ? l.words : [];
    const words = [];
    if (rawWords.length > 0) {
      let wPrev = start;
      for (let wi = 0; wi < rawWords.length; wi++) {
        const w = rawWords[wi];
        const wText = String(w?.text || "").trim();
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
        const shiftedChars = Array.isArray(w?.chars) ? w.chars.map((ch) => ({
          ch: ch?.ch,
          start: Number.isFinite(Number(ch?.start)) ? Number(ch.start) + off : void 0,
          end: Number.isFinite(Number(ch?.end)) ? Number(ch.end) + off : void 0
        })) : void 0;
        const shiftedPhonemes = Array.isArray(w?.phonemes) ? w.phonemes.map((ph) => ({
          unit: String(ph?.unit || "").trim(),
          start: +Math.max(ws, Math.min(we, (Number(ph?.start) || 0) + off)).toFixed(3),
          end: +Math.max(ws + 5e-3, Math.min(we, (Number(ph?.end) || 0) + off)).toFixed(3)
        })).filter((ph) => ph.unit) : void 0;
        const wRec = clampConf(w?.recognitionConfidence, lineRecConf);
        const wAlign = clampConf(w?.alignmentConfidence, lineAlignConf);
        const wSpk = String(w?.speaker || lineSpeaker).trim();
        const wUnclear = isUnclear || /\[unclear/i.test(wText);
        const wClarity = clampConf(w?.audioClarity, wUnclear ? 0.32 : 0.78);
        const wOverlap = +Math.max(0, Math.min(1, Number(w?.vocalOverlap ?? (vocalTypeRaw === "overlapping" || vocalTypeRaw === "harmony" || vocalTypeRaw === "backing" ? 0.68 : 0.08)))).toFixed(3);
        const wFlags = normalizeFlagsList(w?.flags, wRec, wAlign, vocalTypeRaw, wUnclear);
        const qMeta = classifyWordTierServer(wRec, wAlign, wClarity, wOverlap, wFlags);
        words.push({
          text: wText,
          start: ws,
          end: we,
          chars: buildCharTimingsServer(wText, ws, we, shiftedChars),
          phonemes: shiftedPhonemes && shiftedPhonemes.length ? shiftedPhonemes : void 0,
          recognitionConfidence: wRec,
          alignmentConfidence: wAlign,
          audioClarity: wClarity,
          vocalOverlap: wOverlap,
          recognitionUncertainty: qMeta.uncertainty,
          qualityTier: qMeta.tier,
          speaker: wSpk,
          flags: wFlags
        });
      }
    }
    if (!words.length) {
      const tokens = text.match(/[A-Za-zÀ-ÿ\u1e00-\u1eff0-9'’\-]+[,.;:!?…]?|[\u4e00-\u9fff\u3400-\u4dbf]|[\u3040-\u309f\u30a0-\u30ff][\u3041\u3043\u3045\u3047\u3049\u3063\u3083\u3085\u3087\u308e\u30a1\u30a3\u30a5\u30a7\u30a9\u30c3\u30e3\u30e5\u30e7\u30ee\u30fc]?|[\uac00-\ud7af]|[^\s]/g) || [text];
      const weights = tokens.map((tk) => Math.max(0.8, tk.replace(/[^A-Za-zÀ-ÿ\u1e00-\u1eff0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, "").length));
      const totalW = weights.reduce((a, b) => a + b, 0) || tokens.length;
      let cur = start;
      tokens.forEach((tk, wi) => {
        const dur = weights[wi] / totalW * (end - start);
        const ws = +cur.toFixed(3);
        cur += dur;
        const we = wi === tokens.length - 1 ? end : +Math.max(ws + 0.015, cur).toFixed(3);
        const wAlign = +Math.max(0.45, Math.min(0.92, lineAlignConf * 0.78)).toFixed(3);
        const wClarity = isUnclear ? 0.35 : 0.74;
        const wOverlap = vocalTypeRaw === "overlapping" || vocalTypeRaw === "harmony" || vocalTypeRaw === "backing" ? 0.65 : 0.1;
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
          flags: wFlags
        });
      });
    }
    out.push({
      text,
      start,
      end,
      section,
      vocalType: isUnclear ? "unclear" : vocalTypeRaw,
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
      words
    });
  }
  return out;
}
function summarizeValidation(lines, missingGaps = []) {
  let uncertainWords = 0;
  let misrecognizedWords = 0;
  let overlappingWords = 0;
  let uncertainBoundaries = 0;
  let highConfidenceWords = 0;
  let mediumConfidenceWords = 0;
  let lowConfidenceWords = 0;
  let totalWords = 0;
  for (const ln of lines) {
    for (const w of ln.words || []) {
      totalWords++;
      const f = new Set(w.flags || []);
      if (f.has("uncertain_word")) uncertainWords++;
      if (f.has("misrecognized_word")) misrecognizedWords++;
      if (f.has("overlapping_vocals")) overlappingWords++;
      if (f.has("uncertain_boundary")) uncertainBoundaries++;
      const tier = w.qualityTier || classifyWordTierServer(
        Number(w.recognitionConfidence ?? 0.8),
        Number(w.alignmentConfidence ?? 0.78),
        Number(w.audioClarity ?? 0.75),
        Number(w.vocalOverlap ?? 0.1),
        w.flags || []
      ).tier;
      if (tier === "HIGH") highConfidenceWords++;
      else if (tier === "LOW") lowConfidenceWords++;
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
    missingVocalGaps: Array.isArray(missingGaps) ? missingGaps : []
  };
}
app.post("/api/align-vocals", async (req, res) => {
  try {
    const { audioBase64, separatedVocalBase64, lines, lang } = req.body;
    if (!ai || !audioBase64 || !lines || !lines.length) {
      return res.status(200).json({ success: false, reason: "ai_not_configured" });
    }
    const prompt = `You are a singing-aware forced-alignment & acoustic phonetics engine (Stages 4-6).
Analyze BOTH the original mix reference${separatedVocalBase64 ? " AND the center-isolated vocal stem provided" : ""}. Language hint: ${lang || "auto"}.
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
    const contentParts = [
      {
        inlineData: {
          mimeType: "audio/wav",
          data: audioBase64
        }
      }
    ];
    if (separatedVocalBase64) {
      contentParts.push({
        inlineData: {
          mimeType: "audio/wav",
          data: separatedVocalBase64
        }
      });
    }
    contentParts.push({ text: prompt });
    const response = await ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: contentParts,
      config: {
        responseMimeType: "application/json",
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
                              end: { type: Type.NUMBER }
                            },
                            required: ["unit", "start", "end"]
                          }
                        },
                        chars: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              ch: { type: Type.STRING },
                              start: { type: Type.NUMBER },
                              end: { type: Type.NUMBER }
                            },
                            required: ["ch", "start", "end"]
                          }
                        }
                      },
                      required: ["text", "start", "end"]
                    }
                  }
                },
                required: ["index", "start", "end"]
              }
            }
          },
          required: ["alignments"]
        }
      }
    });
    const parsed = JSON.parse(response.text || "{}");
    const lineTimes = {};
    const wordTimes = {};
    const lineMeta = {};
    if (parsed.alignments && Array.isArray(parsed.alignments)) {
      const sorted = parsed.alignments.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      const normalized = normalizeKaraokeLines(
        sorted.map((item) => ({
          text: lines.find((l) => l.i === item.index || l.index === item.index)?.text || (item.words || []).map((w) => w.text).join(" "),
          start: item.start,
          end: item.end,
          speaker: item.speaker,
          recognitionConfidence: item.recognitionConfidence,
          alignmentConfidence: item.alignmentConfidence,
          flags: item.flags,
          validationNote: item.validationNote,
          words: item.words
        }))
      );
      sorted.forEach((item, idx) => {
        if (typeof item.index === "number" && typeof item.start === "number" && normalized[idx]) {
          lineTimes[item.index] = normalized[idx].start;
          wordTimes[item.index] = normalized[idx].words;
          lineMeta[item.index] = {
            speaker: normalized[idx].speaker,
            recognitionConfidence: normalized[idx].recognitionConfidence,
            alignmentConfidence: normalized[idx].alignmentConfidence,
            flags: normalized[idx].flags,
            validationNote: normalized[idx].validationNote
          };
        }
      });
    }
    return res.json({ success: true, lineTimes, wordTimes, lineMeta });
  } catch (err) {
    const msg = err?.message || String(err || "");
    const isBilling = msg.includes("billing") || msg.includes("free tier") || err?.status === "PERMISSION_DENIED" || err?.code === 403;
    return res.status(200).json({
      success: false,
      reason: isBilling ? "billing_required" : "alignment_error",
      requiresBilling: isBilling
    });
  }
});
app.post("/api/transcribe-lyrics", async (req, res) => {
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
      preprocessingSummary
    } = req.body || {};
    if (!ai || !audioBase64) {
      return res.status(200).json({ success: false, reason: "ai_not_configured" });
    }
    const offsetSec = Math.max(0, Number(chunkStartSec) || 0);
    let vocalTranscript = "";
    try {
      const transcribeParts = [
        {
          inlineData: {
            mimeType: "audio/wav",
            data: separatedVocalBase64 || audioBase64
          }
        },
        {
          text: `Listen carefully to this audio recording as a specialized multilingual SINGING & SPEECH recognition model (format: ${audioFormat || "audio"}, original sample rate: ${sampleRate || "unknown"}Hz, window duration: ${chunkDurationSec || duration || "unknown"}s${separatedVocalBase64 ? ", vocal-enhanced stem provided" : ""}).
1. Process actual SINGING voices (sustained notes, vibrato, melisma, high belting, rap, spoken intros/outros), NOT just ordinary speech cadence.
2. Identify EVERY language and distinct singer/speaker heard (minimum core languages: English "en", French "fr", Chinese Mandarin "zh-Hans"/"zh-Hant", Spanish "es", German "de", Japanese "ja", Korean "ko", Italian "it", Portuguese "pt"; hint: ${lang && lang !== "auto" && lang !== "multi" ? lang : "auto-detect multilingual & code-switching"}).
3. MIXED-LANGUAGE SONGS: Songs often switch languages between verses, choruses, or even within a single phrase. Transcribe EVERY sung/spoken word VERBATIM in its own original language & native script\u2014NEVER translate lyrics during recognition. Keep spelling, accents, punctuation, contractions, and ALL repeated choruses intact.
4. Separate Lead vocals from Background vocals / harmonies / overlapping vocal performances: mark overlapping or harmony lines explicitly with timestamps and speaker labels (Lead, Singer 1, Singer 2, Backing, Harmony).
5. Explicitly mark non-vocal instrumental breaks with timestamps as [INSTRUMENTAL].
6. ANTI-HALLUCINATION RULE: Whenever a sung section or word is masked, obscured, or unintelligible, mark it as [UNCLEAR] or add a [?uncertain] flag\u2014NEVER fabricate or hallucinate lyrics to fill silent or ambiguous gaps!`
        }
      ];
      const transcribeResp = await ai.models.generateContent({
        model: "gemini-3.5-transcribe",
        contents: transcribeParts
      });
      vocalTranscript = String(transcribeResp.text || "").trim();
    } catch (tErr) {
      const tMsg = tErr?.message || String(tErr || "");
      if (tMsg.includes("billing") || tMsg.includes("free tier") || tErr?.status === "PERMISSION_DENIED" || tErr?.code === 403) {
        throw tErr;
      }
    }
    const stage1Hint = preprocessingSummary ? `
Stage 1-2 acoustic map: sampleRate=${preprocessingSummary.sampleRate || sampleRate}Hz, silenceCount=${preprocessingSummary.silenceCount ?? 0}, vocalSegments=${preprocessingSummary.vocalPhraseCount ?? 0}, instrumentalGaps=${preprocessingSummary.instrumentalGapCount ?? 0}.` : "";
    const alignPrompt = `You are a world-class singing-aware forced-alignment phonetician and lyric validator executing Stages 4, 5, and 6.
You have the original reference mix${separatedVocalBase64 ? " AND a center-vocal-isolated analysis track (Stage 2)" : ""}.${vocalTranscript ? `

Stage 3 verbatim singing transcript:
${vocalTranscript}
` : ""}${stage1Hint}
Preserve the exact original timeline starting at 0.000s of this audio window. Output strict structured JSON:
1. "audioType": "singing" | "speech" | "instrumental" | "combination".
2. "language": primary BCP-47 language code ("en", "fr", "zh-Hans", "zh-Hant", "es", "de", "ja", "ko", "it", "pt", "multi", or "instrumental"). Hint: ${lang || "auto"}.
3. "detectedLanguages": ordered array of ALL distinct language codes sung/spoken in this audio (e.g. ["es", "en"] for bilingual songs).
4. "detectedSpeakers": array of distinct performers/speakers (e.g. ["Lead"], ["Lead", "Backing"], ["Singer 1", "Singer 2"]).
5. "hasBackingVocals", "hasUnclearSections", "hasInstrumentalSections", "hasRepeatedChorus": accurate booleans.
6. "sections": ordered array of song sections { "type": "intro"|"verse"|"pre_chorus"|"chorus"|"bridge"|"outro"|"instrumental"|"speech"|"other", "label": string, "start": float, "end": float, "isRepeat": boolean }.
7. "missingVocalGaps": array of { "start": float, "end": float, "reason": string } for any vocal passage where singing was clearly heard in audio but lyrics could NOT be confidently recognized (NEVER invent lyrics to fill gaps).
8. "lines": chronological array covering EVERY sung line, spoken phrase, unclear vocal, and distinct instrumental section:
   - "text": Exact verbatim sung text in its original language & script (never translated), "[INSTRUMENTAL]", or "[Unclear vocal]".
   - "start" & "end": Exact vocal onset & release timestamps in seconds (3 decimals). Never snap blindly to music beats!
   - "section": "verse"|"chorus"|"pre_chorus"|"bridge"|"intro"|"outro"|"instrumental"|"speech".
   - "vocalType": "singing"|"speech"|"harmony"|"backing"|"overlapping"|"instrumental"|"unclear".
   - "language": exact BCP-47 code for THIS specific line (supports mixed-language songs seamlessly: e.g. line 1 "en", line 2 "fr", line 3 "es", line 4 "zh-Hans", etc.).
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
    const alignContents = [
      {
        inlineData: {
          mimeType: "audio/wav",
          data: audioBase64
        }
      }
    ];
    if (separatedVocalBase64) {
      alignContents.push({
        inlineData: {
          mimeType: "audio/wav",
          data: separatedVocalBase64
        }
      });
    }
    alignContents.push({ text: alignPrompt });
    const response = await ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: alignContents,
      config: {
        responseMimeType: "application/json",
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
                  reason: { type: Type.STRING }
                },
                required: ["start", "end"]
              }
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
                  isRepeat: { type: Type.BOOLEAN }
                },
                required: ["type", "start", "end"]
              }
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
                              end: { type: Type.NUMBER }
                            },
                            required: ["unit", "start", "end"]
                          }
                        },
                        chars: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              ch: { type: Type.STRING },
                              start: { type: Type.NUMBER },
                              end: { type: Type.NUMBER }
                            },
                            required: ["ch", "start", "end"]
                          }
                        }
                      },
                      required: ["text", "start", "end"]
                    }
                  }
                },
                required: ["text", "start", "end", "words"]
              }
            }
          },
          required: ["audioType", "language", "lines"]
        }
      }
    });
    const parsed = JSON.parse(response.text || "{}");
    const rawLines = Array.isArray(parsed.lines) ? parsed.lines : [];
    const lines = normalizeKaraokeLines(rawLines, offsetSec);
    const missingVocalGaps = Array.isArray(parsed.missingVocalGaps) ? parsed.missingVocalGaps.map((g) => ({
      start: +Math.max(0, (Number(g?.start) || 0) + offsetSec).toFixed(3),
      end: +Math.max(0.1, (Number(g?.end) || 0) + offsetSec).toFixed(3),
      reason: String(g?.reason || "unintelligible_or_missing_vocal").slice(0, 120)
    })) : [];
    const sections = Array.isArray(parsed.sections) ? parsed.sections.map((sec) => ({
      type: String(sec?.type || "other").toLowerCase(),
      label: String(sec?.label || sec?.type || ""),
      start: +Math.max(0, (Number(sec?.start) || 0) + offsetSec).toFixed(3),
      end: +Math.max(0.1, (Number(sec?.end) || 0) + offsetSec).toFixed(3),
      isRepeat: Boolean(sec?.isRepeat)
    })) : [];
    const detectedLanguages = Array.isArray(parsed.detectedLanguages) && parsed.detectedLanguages.length ? parsed.detectedLanguages.filter(Boolean) : parsed.language && parsed.language !== "auto" && parsed.language !== "instrumental" ? [parsed.language] : [];
    const speakerSet = new Set(Array.isArray(parsed.detectedSpeakers) ? parsed.detectedSpeakers.filter(Boolean) : []);
    lines.forEach((ln) => {
      if (ln.speaker && ln.speaker !== "Instrumental") speakerSet.add(ln.speaker);
      (ln.words || []).forEach((w) => {
        if (w.speaker) speakerSet.add(w.speaker);
      });
    });
    const validationSummary = summarizeValidation(lines, missingVocalGaps);
    return res.json({
      success: true,
      audioType: String(parsed.audioType || (parsed.isInstrumental ? "instrumental" : "singing")).toLowerCase(),
      language: parsed.language || "auto",
      detectedLanguages,
      detectedSpeakers: Array.from(speakerSet),
      hasBackingVocals: Boolean(parsed.hasBackingVocals || lines.some((l) => l.backingText || l.vocalType === "backing" || l.vocalType === "harmony" || l.vocalType === "overlapping")),
      hasUnclearSections: Boolean(parsed.hasUnclearSections || validationSummary.uncertainWords > 0 || lines.some((l) => l.unclear)),
      hasInstrumentalSections: Boolean(parsed.hasInstrumentalSections || parsed.isInstrumental || lines.some((l) => l.isInstrumentalSection)),
      hasRepeatedChorus: Boolean(parsed.hasRepeatedChorus || lines.some((l) => l.isRepeatedChorus) || sections.some((s) => s.isRepeat)),
      title: parsed.title || "",
      artist: parsed.artist || "",
      isInstrumental: Boolean(parsed.isInstrumental || parsed.audioType === "instrumental"),
      sections,
      validationSummary,
      pipelineModels: {
        separation: separatedVocalBase64 ? "client_mid_side_formant_stem" : "single_channel_formant_filter",
        transcription: vocalTranscript ? "gemini-3.5-transcribe" : "gemini-4-hydrogen",
        forcedAlignment: "gemini-4-hydrogen+phoneme_10ms_viterbi"
      },
      lines
    });
  } catch (err) {
    const msg = err?.message || String(err || "");
    const isBilling = msg.includes("billing") || msg.includes("free tier") || err?.status === "PERMISSION_DENIED" || err?.code === 403;
    return res.status(200).json({
      success: false,
      reason: isBilling ? "billing_required" : "transcription_error",
      requiresBilling: isBilling,
      message: msg.slice(0, 300)
    });
  }
});
app.post("/api/reanalyze-segment", async (req, res) => {
  try {
    const {
      audioBase64,
      separatedVocalBase64,
      startSec,
      endSec,
      existingWords,
      qualityConditions,
      lang
    } = req.body || {};
    if (!ai || !audioBase64) {
      return res.status(200).json({ success: false, reason: "ai_not_configured" });
    }
    const offsetSec = Math.max(0, Number(startSec) || 0);
    const segDur = Math.max(0.2, (Number(endSec) || offsetSec + 2) - offsetSec);
    const condDesc = qualityConditions ? `noise=${qualityConditions.isNoisy ? "YES" : "no"}, distortion=${qualityConditions.isDistorted ? "YES" : "no"}, reverb=${qualityConditions.isReverberated ? "YES" : "no"}, overlappingVocals=${qualityConditions.hasOverlappingSingers ? "YES" : "no"}` : "standard";
    let focusTranscript = "";
    try {
      const tResp = await ai.models.generateContent({
        model: "gemini-3.5-transcribe",
        contents: [
          {
            inlineData: {
              mimeType: "audio/wav",
              data: separatedVocalBase64 || audioBase64
            }
          },
          {
            text: `Re-listen with extreme care to this ${segDur.toFixed(2)}s singing excerpt flagged as low-confidence (${condDesc}). Language hint: ${lang || "auto"}.
Previous candidate words (may contain errors or timing drift): ${JSON.stringify((existingWords || []).map((w) => w.text || "")).slice(0, 800)}.
Transcribe ONLY what is genuinely audible in the singing voice. Mark ambiguous syllables honestly as [UNCLEAR]\u2014never invent words and never exaggerate certainty.`
          }
        ]
      });
      focusTranscript = String(tResp.text || "").trim();
    } catch (tErr) {
      const tMsg = tErr?.message || String(tErr || "");
      if (tMsg.includes("billing") || tMsg.includes("free tier") || tErr?.status === "PERMISSION_DENIED" || tErr?.code === 403) {
        throw tErr;
      }
    }
    const alignResp = await ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: [
        { inlineData: { mimeType: "audio/wav", data: audioBase64 } },
        ...separatedVocalBase64 ? [{ inlineData: { mimeType: "audio/wav", data: separatedVocalBase64 } }] : [],
        {
          text: `Perform accuracy-first phonetic re-alignment of this short ${segDur.toFixed(2)}s excerpt (timeline starts at 0.000s inside this clip).
Acoustic conditions: ${condDesc}.
${focusTranscript ? `Focused vocal transcript:
${focusTranscript}
` : ""}Existing low-confidence tokens with relative hints:
${JSON.stringify((existingWords || []).map((w) => ({ text: w.text, start: +Math.max(0, (Number(w.start) || 0) - offsetSec).toFixed(3), end: +Math.max(0, (Number(w.end) || 0) - offsetSec).toFixed(3) })), null, 2)}

Rules:
- Accuracy is strictly more important than speed.
- Re-anchor word & phoneme boundaries directly to true sung vocal energy & consonant attacks.
- Never claim 1.0 (100%) confidence automatically; cap honest scores <= 0.96, and reduce scores whenever noise, reverb, distortion, or overlapping vocals obscure the articulation.
- Output JSON with "lines": [{ "text", "start", "end", "vocalType", "speaker", "recognitionConfidence", "alignmentConfidence", "flags", "words": [{ "text", "start", "end", "recognitionConfidence", "alignmentConfidence", "audioClarity", "vocalOverlap", "flags", "phonemes": [{"unit","start","end"}], "chars": [{"ch","start","end"}] }] }].`
        }
      ],
      config: {
        responseMimeType: "application/json",
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
                        flags: { type: Type.ARRAY, items: { type: Type.STRING } }
                      },
                      required: ["text", "start", "end"]
                    }
                  }
                },
                required: ["text", "start", "end", "words"]
              }
            }
          },
          required: ["lines"]
        }
      }
    });
    const parsed = JSON.parse(alignResp.text || "{}");
    const lines = normalizeKaraokeLines(Array.isArray(parsed.lines) ? parsed.lines : [], offsetSec);
    return res.json({ success: true, lines, focusTranscript });
  } catch (err) {
    const msg = err?.message || String(err || "");
    const isBilling = msg.includes("billing") || msg.includes("free tier") || err?.status === "PERMISSION_DENIED" || err?.code === 403;
    return res.status(200).json({
      success: false,
      reason: isBilling ? "billing_required" : "reanalysis_error",
      requiresBilling: isBilling,
      message: msg.slice(0, 300)
    });
  }
});
app.post("/api/translate-lyrics", async (req, res) => {
  try {
    const { lines, targetLang } = req.body || {};
    const target = String(targetLang || "en").trim();
    const inputLines = Array.isArray(lines) ? lines : [];
    if (!inputLines.length) {
      return res.json({ success: true, targetLang: target, detectedSourceLanguages: [], translations: [] });
    }
    if (!ai) {
      return res.status(200).json({ success: false, reason: "ai_not_configured" });
    }
    const langNames = {
      en: "English",
      fr: "French (Fran\xE7ais)",
      "zh-Hans": "Simplified Chinese Mandarin (\u7B80\u4F53\u4E2D\u6587)",
      "zh-Hant": "Traditional Chinese Mandarin (\u7E41\u9AD4\u4E2D\u6587)",
      es: "Spanish (Espa\xF1ol)",
      de: "German (Deutsch)",
      ja: "Japanese (\u65E5\u672C\u8A9E)",
      ko: "Korean (\uD55C\uAD6D\uC5B4)",
      it: "Italian (Italiano)",
      pt: "Portuguese (Portugu\xEAs)"
    };
    const targetLabel = langNames[target] || target;
    const payloadLines = inputLines.map((l, i) => ({
      index: Number.isInteger(Number(l?.index)) ? Number(l.index) : i,
      text: String(l?.text || ""),
      language: String(l?.language || ""),
      interlude: Boolean(l?.interlude)
    }));
    const resp = await ai.models.generateContent({
      model: "gemini-4-hydrogen",
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
${JSON.stringify(payloadLines)}`
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            detectedSourceLanguages: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            translations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  index: { type: Type.INTEGER },
                  sourceLanguage: { type: Type.STRING },
                  translatedText: { type: Type.STRING }
                },
                required: ["index", "sourceLanguage", "translatedText"]
              }
            }
          },
          required: ["detectedSourceLanguages", "translations"]
        }
      }
    });
    const parsed = JSON.parse(resp.text || "{}");
    const trList = Array.isArray(parsed.translations) ? parsed.translations : [];
    const byIdx = /* @__PURE__ */ new Map();
    for (const t of trList) {
      if (t && Number.isInteger(Number(t.index))) {
        byIdx.set(Number(t.index), t);
      }
    }
    const normalized = payloadLines.map((src) => {
      if (src.interlude || !src.text.trim() || /^\[(?:interlude|instrumental|間奏|间奏|간주)/i.test(src.text.trim())) {
        return { index: src.index, sourceLanguage: src.language || "", translatedText: "" };
      }
      const hit = byIdx.get(src.index);
      return {
        index: src.index,
        sourceLanguage: String(hit?.sourceLanguage || src.language || "").trim(),
        translatedText: String(hit?.translatedText || "").trim()
      };
    });
    return res.json({
      success: true,
      targetLang: target,
      detectedSourceLanguages: Array.isArray(parsed.detectedSourceLanguages) ? parsed.detectedSourceLanguages : [],
      translations: normalized
    });
  } catch (err) {
    const msg = err?.message || String(err || "");
    const isBilling = msg.includes("billing") || msg.includes("free tier") || err?.status === "PERMISSION_DENIED" || err?.code === 403;
    return res.status(200).json({
      success: false,
      reason: isBilling ? "billing_required" : "translation_error",
      requiresBilling: isBilling,
      message: msg.slice(0, 300)
    });
  }
});
var editions = ["fr", "en", "zh-hant", "zh-hans", "ko", "id", "vi"];
app.get("/", (req, res) => {
  const lang = req.query.lang;
  if (lang && editions.includes(lang)) {
    return res.redirect(`/${lang}/`);
  }
  const accept = (req.headers["accept-language"] || "").toLowerCase();
  if (accept.includes("ja")) {
    return res.sendFile(path.join(__dirname, "index.html"));
  }
  if (accept.includes("zh")) {
    return res.sendFile(path.join(__dirname, "zh-hans", "index.html"));
  }
  res.sendFile(path.join(__dirname, "fr", "index.html"));
});
for (const ed of editions) {
  app.get([`/${ed}`, `/${ed}/`], (req, res) => {
    if (!req.path.endsWith("/")) {
      return res.redirect(301, `/${ed}/`);
    }
    res.sendFile(path.join(__dirname, ed, "index.html"));
  });
}
app.use(express.static(__dirname, {
  extensions: ["html"],
  index: false
}));
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "fr", "index.html"));
});
app.listen(PORT, HOST, () => {
  console.log(`Alexura server running at http://${HOST}:${PORT}`);
});
