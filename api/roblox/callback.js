const {
  COOKIE_NAME,
  OAUTH_BASE,
  OAUTH_COOKIE_NAME,
  appendCookie,
  clearCookie,
  getConfig,
  methodNotAllowed,
  parseCookies,
  redirect,
  safeEqual,
  seal,
  unseal
} = require('../../lib/roblox-oauth');

const SESSION_SECONDS = 7 * 24 * 60 * 60;

function sanitizeProfile(data) {
  if (!data || data.sub === undefined || data.sub === null) throw new Error('Roblox profile has no subject');
  const username = String(data.preferred_username || data.nickname || data.name || 'Roblox player').slice(0, 64);
  const displayName = String(data.name || data.nickname || username).slice(0, 64);
  const picture = typeof data.picture === 'string' && data.picture.startsWith('https://')
    ? data.picture.slice(0, 512)
    : null;
  return { id: String(data.sub).slice(0, 64), username, displayName, picture };
}

module.exports = async function callback(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET');

  let config;
  try {
    config = getConfig(true);
  } catch {
    return redirect(res, '/?oauth_error=not_configured');
  }

  const requestUrl = new URL(req.url, config.redirectUri);
  const cookies = parseCookies(req.headers.cookie);
  const oauthState = unseal(cookies[OAUTH_COOKIE_NAME], config.sessionSecret);
  clearCookie(res, req, OAUTH_COOKIE_NAME);

  const code = requestUrl.searchParams.get('code');
  const state = requestUrl.searchParams.get('state');
  const error = requestUrl.searchParams.get('error');
  if (error) return redirect(res, '/?oauth_error=denied');
  if (!code || !state || !oauthState || !safeEqual(state, oauthState.state) || Date.now() - oauthState.createdAt > 10 * 60 * 1000) {
    return redirect(res, '/?oauth_error=invalid_state');
  }

  try {
    const tokenResponse = await fetch(`${OAUTH_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code_verifier: oauthState.verifier
      }),
      signal: AbortSignal.timeout(10000)
    });
    if (!tokenResponse.ok) return redirect(res, '/?oauth_error=exchange_failed');

    const token = await tokenResponse.json();
    if (typeof token.access_token !== 'string' || token.access_token.length > 8192) {
      return redirect(res, '/?oauth_error=exchange_failed');
    }

    const profileResponse = await fetch(`${OAUTH_BASE}/userinfo`, {
      headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
    if (!profileResponse.ok) return redirect(res, '/?oauth_error=profile_failed');

    const profile = sanitizeProfile(await profileResponse.json());
    const session = seal({ profile, expiresAt: Date.now() + SESSION_SECONDS * 1000 }, config.sessionSecret);
    appendCookie(res, req, COOKIE_NAME, session, SESSION_SECONDS);
    return redirect(res, '/?oauth=connected');
  } catch {
    return redirect(res, '/?oauth_error=connection_failed');
  }
};