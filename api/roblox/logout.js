const {
  COOKIE_NAME,
  clearCookie,
  methodNotAllowed
} = require('../../lib/roblox-oauth');

module.exports = function logout(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
  clearCookie(res, req, COOKIE_NAME);
  return res.status(204).end();
};