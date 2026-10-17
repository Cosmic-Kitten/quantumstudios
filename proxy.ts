import { next } from '@vercel/functions';
import session from './lib/turnstile-session.js';

const PUBLIC_PATHS = new Set([
  '/turnstile-gate.html',
  '/api/turnstile/verify',
  '/api/turnstile/signout'
]);

export default function proxy(request: Request) {
  const url = new URL(request.url);
  if (PUBLIC_PATHS.has(url.pathname)) return next();

  const secret = process.env.ORBIT_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    return new Response('Website access is temporarily unavailable.', {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }

  const cookieHeader = request.headers.get('cookie') || '';
  const cookie = cookieHeader.split(';').map(part => part.trim())
    .find(part => part.startsWith(`${session.COOKIE_NAME}=`));
  const token = cookie ? cookie.slice(session.COOKIE_NAME.length + 1) : null;

  if (session.isValidSession(token, secret)) {
    // The session authorises exactly one page load. Clear it on the way out so
    // that reloading the page always sends the visitor back through the gate,
    // while the request that is already in flight still renders normally.
    const response = next();
    response.headers.append('Set-Cookie', session.clearCookieHeader(request));
    return response;
  }

  if (url.pathname.startsWith('/api/')) {
    return Response.json({ error: 'turnstile_required' }, {
      status: 403,
      headers: { 'Cache-Control': 'no-store' }
    });
  }

  const gateUrl = new URL('/turnstile-gate.html', url);
  gateUrl.searchParams.set('next', `${url.pathname}${url.search}`);
  return new Response(null, {
    status: 307,
    headers: {
      'Cache-Control': 'no-store',
      Location: gateUrl.toString()
    }
  });
}
