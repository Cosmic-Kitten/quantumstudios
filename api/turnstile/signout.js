module.exports = function signOutOfTurnstile(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const secure = process.env.VERCEL === '1' || req.headers['x-forwarded-proto'] === 'https';
  const cookie = [
    'orbit_turnstile=',
    'Path=/',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : [])
  ].join('; ');
  res.setHeader('Set-Cookie', cookie);
  return res.status(204).end();
};
