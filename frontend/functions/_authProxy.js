/**
 * Cloudflare Pages Function helper: forwards the browser's auth calls to Django on Render.
 *
 * Only these routes use it (see functions/api/...):
 *   POST /api/token/            login   -> sets the httpOnly refresh cookie
 *   POST /api/token/refresh/    refresh -> rotates the cookie, returns a new access token
 *   POST /api/auth/logout/      logout  -> revokes tokens, deletes the cookie
 * Every other API call goes straight from the browser to Render (not through here), so the
 * Workers free quota (100,000 requests/day) is only used by these few calls.
 *
 * Pages settings -> Environment variables (Production AND Preview):
 *   BACKEND_ORIGIN  e.g. https://attendance-face-recognition-1.onrender.com
 *   PROXY_SECRET    long random string (Encrypted); same value as AUTH_PROXY_SECRET on Render
 */

const FORWARDED_REQUEST_HEADERS = ['content-type', 'authorization', 'cookie', 'origin', 'x-auth-mode', 'user-agent', 'accept', 'accept-language'];

export async function proxyAuth({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'POST') return json({ detail: 'Method not allowed.' }, 405);
  if (!env.BACKEND_ORIGIN || !env.PROXY_SECRET) {
    return json({ detail: 'Sign-in is not configured (BACKEND_ORIGIN / PROXY_SECRET missing).' }, 500);
  }

  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, env.BACKEND_ORIGIN);

  // Forward only what the backend needs (never the browser's own proxy/IP headers).
  const headers = new Headers();
  FORWARDED_REQUEST_HEADERS.forEach((name) => {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  });
  headers.set('X-Client-IP', request.headers.get('CF-Connecting-IP') || '');
  headers.set('X-Proxy-Secret', env.PROXY_SECRET);

  let upstream;
  try {
    upstream = await fetch(target.toString(), {
      method: 'POST',
      headers,
      body: request.body,
      redirect: 'manual',
    });
  } catch {
    return json({ detail: 'The server is unreachable. Please try again.' }, 502);
  }

  // Pass status, body and headers (including Set-Cookie) through unchanged.
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set('Cache-Control', 'no-store');
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
