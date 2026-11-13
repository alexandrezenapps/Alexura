import type { IncomingMessage, ServerResponse } from 'http';

interface ApiReq extends IncomingMessage {
  method?: string;
  body?: { action?: string; payload?: unknown };
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

  const { action, payload } = req.body || {};
  const target =
    action === 'deploy'
      ? process.env.VERCEL_DEPLOY_HOOK_URL
      : process.env.EXTERNAL_APP_URL;

  if (!target) {
    res.status(200).json({
      success: false,
      reason: action === 'deploy' ? 'vercel_deploy_hook_not_configured' : 'external_app_url_not_configured',
    });
    return;
  }

  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload ?? { source: 'Alexura', timestamp: new Date().toISOString() }),
    });
    const text = await upstream.text();
    res.status(200).json({ success: upstream.ok, status: upstream.status, response: text.slice(0, 500) });
  } catch (err: unknown) {
    res.status(502).json({
      success: false,
      reason: 'upstream_unreachable',
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
