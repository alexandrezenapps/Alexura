import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
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

// AI Vocal-to-Lyric Forced Alignment Endpoint
app.post('/api/align-vocals', async (req, res) => {
  try {
    const { audioBase64, lines, lang } = req.body;
    if (!ai || !audioBase64 || !lines || !lines.length) {
      return res.status(200).json({ success: false, reason: 'ai_not_configured' });
    }

    const prompt = `You are a music audio-to-lyrics timing aligner.
Analyze the vocal singing in this song recording. The lyrics are in language: ${lang || 'auto'}.
Here is the ordered list of lyric lines with their indices:
${JSON.stringify(lines, null, 2)}

Identify the precise timestamp in seconds (start) where the singing vocal begins for each line index.
Return a structured JSON with alignments.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
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
                },
                required: ['index', 'start'],
              },
            },
          },
          required: ['alignments'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    const lineTimes: Record<number, number> = {};
    if (parsed.alignments && Array.isArray(parsed.alignments)) {
      for (const item of parsed.alignments) {
        if (typeof item.index === 'number' && typeof item.start === 'number') {
          lineTimes[item.index] = Math.max(0, +item.start.toFixed(3));
        }
      }
    }

    return res.json({ success: true, lineTimes });
  } catch (err: any) {
    console.warn('AI Vocal alignment error:', err?.message || err);
    return res.status(200).json({ success: false, error: err?.message || 'alignment_error' });
  }
});

// Serve static assets from the project root
app.use(express.static(__dirname, {
  extensions: ['html'],
  index: ['index.html']
}));

// Route handler for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Explicit route handlers for language edition directories if accessed without trailing slash
const editions = ['fr', 'en', 'zh-hant', 'zh-hans', 'ko', 'id', 'vi'];
for (const ed of editions) {
  app.get(`/${ed}`, (req, res) => {
    res.redirect(`/${ed}/`);
  });
  app.get(`/${ed}/`, (req, res) => {
    res.sendFile(path.join(__dirname, ed, 'index.html'));
  });
}

// Fallback to index.html for unknown HTML navigations
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`ALEZURA server running at http://${HOST}:${PORT}`);
});
