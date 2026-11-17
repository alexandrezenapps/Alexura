import type { IncomingMessage, ServerResponse } from 'http';

interface ApiReq extends IncomingMessage {
  method?: string;
  body?: { action?: string; targetUrl?: string; payload?: unknown };
}

interface ApiRes extends ServerResponse {
  status: (code: number) => ApiRes;
  json: (data: unknown) => void;
}

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

  const { action, targetUrl, payload } = req.body || {};
  const explicitTarget = validateHttpsTarget(targetUrl);
  const envTarget =
    action === 'deploy'
      ? process.env.VERCEL_DEPLOY_HOOK_URL
      : process.env.EXTERNAL_APP_URL;

  const target = explicitTarget || (envTarget ? validateHttpsTarget(envTarget) : null);

  if (!target) {
    res.status(200).json({
      success: false,
      reason:
        action === 'deploy'
          ? 'vercel_deploy_hook_not_configured'
          : action === 'ping'
            ? 'vercel_url_not_configured'
            : 'external_app_url_not_configured',
    });
    return;
  }

  try {
    if (action === 'ping') {
      const u = new URL(target);
      const pingUrl = u.pathname === '/' ? `${u.origin}/api/health` : u.toString();
      const upstream = await fetch(pingUrl, { method: 'GET' });
      const text = await upstream.text();
      res.status(200).json({
        success: upstream.ok,
        status: upstream.status,
        url: pingUrl,
        response: text.slice(0, 500),
      });
      return;
    }

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
