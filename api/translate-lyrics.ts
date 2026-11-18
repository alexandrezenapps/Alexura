import type { IncomingMessage, ServerResponse } from 'http';
import { GoogleGenAI, Type } from '@google/genai';

interface TranslateLineInput {
  index?: number;
  text?: string;
  language?: string;
  interlude?: boolean;
}

interface ApiReq extends IncomingMessage {
  method?: string;
  body?: {
    lines?: TranslateLineInput[];
    targetLang?: string;
  };
}

interface ApiRes extends ServerResponse {
  status: (code: number) => ApiRes;
  json: (data: unknown) => void;
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
    const { lines, targetLang } = req.body || {};
    const target = String(targetLang || 'en').trim();
    const inputLines = Array.isArray(lines) ? lines : [];
    if (!inputLines.length) {
      res.status(200).json({ success: true, targetLang: target, detectedSourceLanguages: [], translations: [] });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(200).json({ success: false, reason: 'ai_not_configured' });
      return;
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

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
    const payloadLines = inputLines.map((l, i) => ({
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
    const byIdx = new Map<number, { sourceLanguage?: string; translatedText?: string }>();
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

    res.status(200).json({
      success: true,
      targetLang: target,
      detectedSourceLanguages: Array.isArray(parsed.detectedSourceLanguages) ? parsed.detectedSourceLanguages : [],
      translations: normalized,
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
      reason: isBilling ? 'billing_required' : 'translation_error',
      requiresBilling: isBilling,
      message: msg.slice(0, 300),
    });
  }
}
