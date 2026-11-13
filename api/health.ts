import type { IncomingMessage, ServerResponse } from 'http';

interface ApiReq extends IncomingMessage {
  method?: string;
}

interface ApiRes extends ServerResponse {
  status: (code: number) => ApiRes;
  json: (data: unknown) => void;
}

export default function handler(req: ApiReq, res: ApiRes) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  res.status(200).json({
    ok: true,
    app: 'Alexura',
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    bridgeConfigured: Boolean(process.env.EXTERNAL_APP_URL || process.env.VERCEL_DEPLOY_HOOK_URL),
    endpoints: ['/api/health', '/api/transcribe-lyrics', '/api/align-vocals', '/api/bridge'],
  });
}
