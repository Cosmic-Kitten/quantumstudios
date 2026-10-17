const { createSessionToken, SESSION_SECONDS } = require('../../lib/turnstile-session');

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const EXPECTED_ACTION = 'website';

function getExpectedHostnames() {
  const hostnames = (process.env.TURNSTILE_HOSTNAMES || '')
    .split(',')
    .map(hostname => hostname.trim().toLowerCase())
    .filter(Boolean);

  if (process.env.VERCEL_ENV === 'production') {
    return new Set(hostnames.filter(hostname => !['localhost', '127.0.0.1'].includes(hostname)));
  }
  return new Set(hostnames);
}

function getRequestHostname(req) {
  const host = req.headers.host;
  if (typeof host !== 'string' || !host) return null;
  try {
    return new URL(`https://${host}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

module.exports = async function verifyTurnstile(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const secret = process.env.TURNSTILE_SECRET;
  const sessionSecret = process.env.ORBIT_SESSION_SECRET;
  const hostname = getRequestHostname(req);
  const expectedHostnames = getExpectedHostnames();
  const token = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body.token
    : null;

  if (!secret || !sessionSecret || sessionSecret.length < 32 || expectedHostnames.size === 0) {
    return res.status(503).json({ error: 'turnstile_not_configured' });
  }
  if (!hostname || !expectedHostnames.has(hostname)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
    return res.status(400).json({ error: 'invalid_turnstile_token' });
  }

  let result;
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) {
      console.error(`Turnstile siteverify returned HTTP ${response.status}`);
      return res.status(503).json({ error: 'turnstile_verification_unavailable' });
    }
    result = await response.json();
  } catch (error) {
    console.error('Turnstile siteverify request failed:', error instanceof Error ? error.message : 'unknown error');
    return res.status(503).json({ error: 'turnstile_verification_unavailable' });
  }

  const errorCodes = Array.isArray(result?.['error-codes'])
    ? result['error-codes'].filter(code => typeof code === 'string').slice(0, 5)
    : [];
  if (errorCodes.includes('invalid-input-secret') || errorCodes.includes('missing-input-secret')) {
    console.error('Turnstile rejected the configured secret:', errorCodes.join(', ') || 'unknown error');
    return res.status(503).json({ error: 'turnstile_configuration_error' });
  }
  if (!result || typeof result !== 'object' || result.success !== true) {
    console.error('Turnstile rejected the challenge:', errorCodes.join(', ') || 'no error code');
    if (errorCodes.includes('timeout-or-duplicate') || errorCodes.includes('invalid-input-response') || errorCodes.includes('missing-input-response')) {
      return res.status(403).json({ error: 'turnstile_challenge_rejected' });
    }
    return res.status(403).json({ error: 'turnstile_verification_failed' });
  }
  if (result.action !== EXPECTED_ACTION || result.hostname !== hostname) {
    console.error('Turnstile challenge did not match the expected action/hostname:', JSON.stringify({
      action: result.action,
      hostname: result.hostname,
      expectedAction: EXPECTED_ACTION,
      expectedHostname: hostname
    }));
    return res.status(403).json({ error: 'turnstile_configuration_mismatch' });
  }

  const expiresAt = Date.now() + SESSION_SECONDS * 1000;
  const sessionToken = createSessionToken(sessionSecret, expiresAt);
  const secure = process.env.VERCEL === '1' || req.headers['x-forwarded-proto'] === 'https';
  const cookie = [
    `orbit_turnstile=${sessionToken}`,
    'Path=/',
    `Max-Age=${SESSION_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : [])
  ].join('; ');
  res.setHeader('Set-Cookie', cookie);
  return res.status(204).end();
};
