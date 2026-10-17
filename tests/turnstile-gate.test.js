// Covers the reload behaviour of the Turnstile gate: passing the challenge
// authorises exactly one page load, so reloading the page sends the visitor
// back through the gate instead of letting the cookie be reused.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionToken, isValidSession, clearCookieHeader, COOKIE_NAME } = require('../lib/turnstile-session');

const SECRET = 'test-session-secret-with-at-least-32-characters';

// proxy.ts imports @vercel/functions and is TypeScript, so the middleware logic
// is exercised through the same pieces it uses: a session check followed by the
// clear that the middleware appends to its response.
function sessionCookieFor(secret, ttlSeconds = 60) {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  return `${COOKIE_NAME}=${createSessionToken(secret, expiresAt)}`;
}

function readCookieToken(cookieHeader) {
  const cookie = cookieHeader.split(';').map(part => part.trim())
    .find(part => part.startsWith(`${COOKIE_NAME}=`));
  return cookie ? cookie.slice(COOKIE_NAME.length + 1) : null;
}

test('a valid access cookie authorises one page load', () => {
  const header = sessionCookieFor(SECRET);
  assert.equal(isValidSession(readCookieToken(header), SECRET), true);
});

test('the access cookie is cleared after it is used, so a reload re-challenges', () => {
  const header = sessionCookieFor(SECRET);
  const cleared = clearCookieHeader({ headers: { 'x-forwarded-proto': 'https' } });

  // The clear must actually expire the cookie, or the reload would sail through.
  assert.match(cleared, /Max-Age=0/);
  assert.match(cleared, new RegExp(`^${COOKIE_NAME}=;`));
  assert.match(cleared, /HttpOnly/);
  assert.match(cleared, /SameSite=Lax/);
  assert.match(cleared, /Secure/);

  // A cleared cookie no longer carries a usable session.
  assert.equal(isValidSession(readCookieToken(cleared), SECRET), false);
});

test('clearCookieHeader omits Secure off HTTPS so local runs still clear the cookie', () => {
  const previousVercel = process.env.VERCEL;
  delete process.env.VERCEL;
  try {
    const cleared = clearCookieHeader({ headers: { 'x-forwarded-proto': 'http' } });
    assert.doesNotMatch(cleared, /Secure/);
  } finally {
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  }
});

test('an expired access cookie is rejected, so the gate is shown again', () => {
  const expired = sessionCookieFor(SECRET, -1);
  assert.equal(isValidSession(readCookieToken(expired), SECRET), false);
});

test('a tampered access cookie is rejected', () => {
  const token = readCookieToken(sessionCookieFor(SECRET));
  const [payload, signature] = token.split('.');
  const forged = `${payload}.${'a'.repeat(signature.length)}`;
  assert.equal(isValidSession(forged, SECRET), false);
});

test('an access cookie signed with a different secret is rejected', () => {
  const other = 'a-completely-different-session-secret-value';
  const token = readCookieToken(sessionCookieFor(other));
  assert.equal(isValidSession(token, SECRET), false);
});
