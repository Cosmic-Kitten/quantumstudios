const { clearCookieHeader } = require('../../lib/turnstile-session');

module.exports = function signOutOfTurnstile(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  res.setHeader('Set-Cookie', clearCookieHeader(req));
  return res.status(204).end();
};
