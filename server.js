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
app.post("/api/align-vocals", async (req, res) => {
  try {
    const { audioBase64, lines, lang } = req.body;
    if (!ai || !audioBase64 || !lines || !lines.length) {
      return res.status(200).json({ success: false, reason: "ai_not_configured" });
    }
    const prompt = `You are a music audio-to-lyrics timing aligner.
Analyze the vocal singing in this song recording. The lyrics are in language: ${lang || "auto"}.
Here is the ordered list of lyric lines with their indices:
${JSON.stringify(lines, null, 2)}

Identify the precise timestamp in seconds (start) where the singing vocal begins for each line index.
Return a structured JSON with alignments.`;
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          inlineData: {
            mimeType: "audio/wav",
            data: audioBase64
          }
        },
        { text: prompt }
      ],
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
                  start: { type: Type.NUMBER }
                },
                required: ["index", "start"]
              }
            }
          },
          required: ["alignments"]
        }
      }
    });
    const parsed = JSON.parse(response.text || "{}");
    const lineTimes = {};
    if (parsed.alignments && Array.isArray(parsed.alignments)) {
      for (const item of parsed.alignments) {
        if (typeof item.index === "number" && typeof item.start === "number") {
          lineTimes[item.index] = Math.max(0, +item.start.toFixed(3));
        }
      }
    }
    return res.json({ success: true, lineTimes });
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
    const { audioBase64, lang } = req.body;
    if (!ai || !audioBase64) {
      return res.status(200).json({ success: false, reason: "ai_not_configured" });
    }
    const prompt = `You are a world-class music audio lyric transcription and timecode alignment engine.
Carefully listen to this music audio track and the singing vocals:
1. Detect the language of the sung vocals (e.g. "fr" for French, "zh" for Chinese, "en" for English, "ja" for Japanese, "ko" for Korean, "vi" for Vietnamese, etc.). Preferred language if specified: ${lang || "auto"}.
2. Accurately transcribe all sung lyrics line-by-line, dividing into natural musical phrases or verse/chorus lines appropriate for dynamic lyric video / music video typography (MV).
3. For each lyric line:
   - "text": The exact sung lyrics in their native script/orthography.
   - "start": Timestamp in seconds (float, e.g. 14.25) where the singing vocal for this line begins.
   - "end": Timestamp in seconds (float, e.g. 17.80) where the singing vocal for this line ends.
4. If there is an instrumental intro or break, make sure the "start" of lines reflect the actual singing moment.
5. If you recognize the song title or artist from the lyrics/song, provide "title" and "artist", else empty strings.
6. If the audio is purely instrumental without vocals, set "isInstrumental": true and "lines": [].
Ensure precision timestamps so that lyrics match the singing vocal instantaneously.`;
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          inlineData: {
            mimeType: "audio/wav",
            data: audioBase64
          }
        },
        { text: prompt }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            language: { type: Type.STRING },
            title: { type: Type.STRING },
            artist: { type: Type.STRING },
            isInstrumental: { type: Type.BOOLEAN },
            lines: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: { type: Type.STRING },
                  start: { type: Type.NUMBER },
                  end: { type: Type.NUMBER }
                },
                required: ["text", "start", "end"]
              }
            }
          },
          required: ["language", "lines"]
        }
      }
    });
    const parsed = JSON.parse(response.text || "{}");
    const lines = Array.isArray(parsed.lines) ? parsed.lines : [];
    return res.json({
      success: true,
      language: parsed.language || "auto",
      title: parsed.title || "",
      artist: parsed.artist || "",
      isInstrumental: !!parsed.isInstrumental,
      lines: lines.map((l) => ({
        text: String(l.text || "").trim(),
        start: Math.max(0, +Number(l.start || 0).toFixed(3)),
        end: Math.max(0, +Number(l.end || 0).toFixed(3))
      })).filter((l) => l.text.length > 0)
    });
  } catch (err) {
    const msg = err?.message || String(err || "");
    const isBilling = msg.includes("billing") || msg.includes("free tier") || err?.status === "PERMISSION_DENIED" || err?.code === 403;
    return res.status(200).json({
      success: false,
      reason: isBilling ? "billing_required" : "transcription_error",
      requiresBilling: isBilling
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
  app.get(`/${ed}`, (req, res) => {
    res.redirect(`/${ed}/`);
  });
  app.get(`/${ed}/`, (req, res) => {
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
