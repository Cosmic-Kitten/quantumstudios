const { createHash, createHmac, timingSafeEqual } = require('node:crypto');

const SESSION_SECONDS = 12 * 60 * 60;
const COOKIE_NAME = 'orbit_turnstile';

function createSessionToken(secret, expiresAt) {
  const payload = String(expiresAt);
  const key = createHash('sha256').update('orbit-turnstile-session\0').update(secret).digest();
  const signature = createHmac('sha256', key).update(payload).digest('base64url');
  return `${payload}.${signature}`;
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

module.exports = { COOKIE_NAME, SESSION_SECONDS, createSessionToken, isValidSession };
