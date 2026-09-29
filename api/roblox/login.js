const {
  OAUTH_BASE,
  OAUTH_COOKIE_NAME,
  appendCookie,
  createPkce,
  getConfig,
  methodNotAllowed,
  redirect,
  seal
} = require('../../lib/roblox-oauth');
const { randomBytes } = require('node:crypto');

module.exports = function login(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET');

  let config;
  try {
    config = getConfig();
  } catch {
    return redirect(res, '/?oauth_error=not_configured');
  }

  const state = randomBytes(32).toString('base64url');
  const { verifier, challenge } = createPkce();
  const loginState = seal({ state, verifier, createdAt: Date.now() }, config.sessionSecret);
  appendCookie(res, req, OAUTH_COOKIE_NAME, loginState, 600);

  const authorizeUrl = new URL(`${OAUTH_BASE}/authorize`);
  authorizeUrl.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    scope: 'openid profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  });
  res.setHeader('Referrer-Policy', 'no-referrer');
  return redirect(res, authorizeUrl.toString());
};