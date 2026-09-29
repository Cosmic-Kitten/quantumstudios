const {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual
} = require('node:crypto');

const COOKIE_NAME = 'orbit_session';
const OAUTH_COOKIE_NAME = 'orbit_oauth';
const OAUTH_BASE = 'https://apis.roblox.com/oauth/v1';

function getConfig(includeClientSecret = false) {
  const clientId = process.env.ROBLOX_CLIENT_ID;
  const redirectUri = process.env.ROBLOX_REDIRECT_URI;
  const sessionSecret = process.env.ORBIT_SESSION_SECRET;
  const clientSecret = process.env.ROBLOX_CLIENT_SECRET;

  if (!clientId || !redirectUri || !sessionSecret || (includeClientSecret && !clientSecret)) {
    throw new Error('Roblox OAuth environment is incomplete');
  }
  if (sessionSecret.length < 32) throw new Error('ORBIT_SESSION_SECRET must be at least 32 characters');

  const callback = new URL(redirectUri);
  if (callback.pathname !== '/api/roblox/callback') throw new Error('ROBLOX_REDIRECT_URI must end in /api/roblox/callback');
  if (callback.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(callback.hostname)) {
    throw new Error('ROBLOX_REDIRECT_URI must use HTTPS');
  }

  return { clientId, clientSecret, redirectUri, sessionSecret };
}

function deriveKey(secret) {
  return createHash('sha256').update(secret).digest();
}

function seal(value, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function unseal(value, secret) {
  try {
    const [version, encodedIv, encodedTag, encodedCiphertext, extra] = String(value || '').split('.');
    if (version !== 'v1' || !encodedIv || !encodedTag || !encodedCiphertext || extra) return null;
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(encodedIv, 'base64url'));
    decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
      decipher.final()
    ]).toString('utf8');
    return JSON.parse(plaintext);
  } catch {
    return null;
  }
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => {
    const separator = part.indexOf('=');
    if (separator < 0) return ['', ''];
    return [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
  }).filter(([name]) => name));
}

function appendCookie(res, req, name, value, maxAge) {
  const attributes = [
    `${name}=${value}`,
    'Path=/api/roblox',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`
  ];
  if (process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https') {
    attributes.push('Secure');
  }
  const current = res.getHeader('Set-Cookie');
  const cookies = Array.isArray(current) ? current : current ? [current] : [];
  res.setHeader('Set-Cookie', [...cookies, attributes.join('; ')]);
}

function clearCookie(res, req, name) {
  appendCookie(res, req, name, '', 0);
}

function safeEqual(first, second) {
  const left = Buffer.from(String(first || ''));
  const right = Buffer.from(String(second || ''));
  return left.length === right.length && timingSafeEqual(left, right);
}

function createPkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function redirect(res, location) {
  res.statusCode = 303;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed);
  res.setHeader('Cache-Control', 'no-store');
  res.status(405).json({ error: 'method_not_allowed' });
}

module.exports = {
  COOKIE_NAME,
  OAUTH_COOKIE_NAME,
  OAUTH_BASE,
  appendCookie,
  clearCookie,
  createPkce,
  getConfig,
  methodNotAllowed,
  parseCookies,
  redirect,
  safeEqual,
  seal,
  unseal
};