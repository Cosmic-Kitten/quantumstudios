const {
  COOKIE_NAME,
  clearCookie,
  getConfig,
  methodNotAllowed,
  parseCookies,
  unseal
} = require('../../lib/roblox-oauth');

module.exports = function me(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET');

  let config;
  try {
    config = getConfig();
  } catch {
    return res.status(503).json({ error: 'oauth_not_configured' });
  }

  const cookies = parseCookies(req.headers.cookie);
  const session = unseal(cookies[COOKIE_NAME], config.sessionSecret);
  if (!session || !session.profile || session.expiresAt <= Date.now()) {
    if (cookies[COOKIE_NAME]) clearCookie(res, req, COOKIE_NAME);
    return res.status(200).json({ user: null });
  }

  return res.status(200).json({ user: session.profile });
};