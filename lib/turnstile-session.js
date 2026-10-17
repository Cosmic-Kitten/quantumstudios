const { createHash, createHmac, timingSafeEqual } = require('node:crypto');

// The gate session is deliberately short-lived: it only has to survive the
// redirect from the challenge back to the requested page. Reloading the page
// is meant to re-run the check, and proxy.ts also clears the cookie as soon as
// it is used, so the value here is just a backstop in case that clear is lost.
const SESSION_SECONDS = 60;
const COOKIE_NAME = 'orbit_turnstile';

function createSessionToken(secret, expiresAt) {
  const payload = String(expiresAt);
  const key = createHash('sha256').update('orbit-turnstile-session\0').update(secret).digest();
  const signature = createHmac('sha256', key).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

// Expires the access cookie. Mirrors api/turnstile/signout.js so both the
// middleware and the sign-out endpoint drop the session the same way.
function clearCookieHeader(request) {
  const forwardedProto = request && request.headers
    ? (typeof request.headers.get === 'function' ? request.headers.get('x-forwarded-proto') : request.headers['x-forwarded-proto'])
    : null;
  const secure = process.env.VERCEL === '1' || forwardedProto === 'https';
  return [
    `${COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : [])
  ].join('; ');
}

function isValidSession(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || typeof secret !== 'string' || secret.length < 32) return false;

  const parts = token.split('.');
  if (parts.length !== 2 || !/^\d+$/.test(parts[0])) return false;

  const expiresAt = Number(parts[0]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + (SESSION_SECONDS + 60) * 1000) {
    return false;
  }

  const expected = createSessionToken(secret, expiresAt).split('.')[1];
  const actualSignature = Buffer.from(parts[1], 'base64url');
  const expectedSignature = Buffer.from(expected, 'base64url');
  return actualSignature.length === expectedSignature.length &&
    timingSafeEqual(actualSignature, expectedSignature) &&
    actualSignature.toString('base64url') === parts[1];
}

module.exports = { COOKIE_NAME, SESSION_SECONDS, createSessionToken, isValidSession, clearCookieHeader };
