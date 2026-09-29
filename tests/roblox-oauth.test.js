const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { parseCookies, safeEqual, seal, unseal } = require('../lib/roblox-oauth');
const login = require('../api/roblox/login');
const callback = require('../api/roblox/callback');
const me = require('../api/roblox/me');
const logout = require('../api/roblox/logout');

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    getHeader(name) { return this.headers[name.toLowerCase()]; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { this.ended = true; return this; }
  };
}

function setOAuthEnvironment() {
  const names = ['ROBLOX_CLIENT_ID', 'ROBLOX_CLIENT_SECRET', 'ROBLOX_REDIRECT_URI', 'ORBIT_SESSION_SECRET'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  process.env.ROBLOX_CLIENT_ID = 'test-client-id';
  process.env.ROBLOX_CLIENT_SECRET = 'test-client-secret';
  process.env.ROBLOX_REDIRECT_URI = 'https://orbit.example/api/roblox/callback';
  process.env.ORBIT_SESSION_SECRET = 'test-session-secret-with-at-least-32-characters';
  return () => names.forEach(name => {
    if (previous[name] === undefined) delete process.env[name];
    else process.env[name] = previous[name];
  });
}

function cookiePair(setCookie, name) {
  return setCookie.find(cookie => cookie.startsWith(`${name}=`)).split(';', 1)[0];
}

test('sealed sessions round-trip and cannot be read with a different secret', () => {
  const secret = 'local-test-secret-with-at-least-32-characters';
  const value = { profile: { id: '1234', username: 'OrbitUser' }, expiresAt: 1000 };
  const sealed = seal(value, secret);

  assert.deepEqual(unseal(sealed, secret), value);
  assert.equal(unseal(sealed, `${secret}-wrong`), null);
});

test('tampered session ciphertext is rejected', () => {
  const sealed = seal({ user: 'orbit' }, 'local-test-secret-with-at-least-32-characters');
  const replacement = sealed.endsWith('A') ? 'B' : 'A';

  assert.equal(unseal(`${sealed.slice(0, -1)}${replacement}`, 'local-test-secret-with-at-least-32-characters'), null);
});

test('cookie parsing preserves values containing equals signs', () => {
  assert.deepEqual(parseCookies('first=one; orbit_session=abc.def=='), {
    first: 'one',
    orbit_session: 'abc.def=='
  });
});

test('OAuth state comparison is exact', () => {
  assert.equal(safeEqual('expected-state', 'expected-state'), true);
  assert.equal(safeEqual('expected-state', 'different-state'), false);
  assert.equal(safeEqual('', ''), true);
});

test('OAuth login uses state and PKCE, callback stores only an encrypted profile, and logout clears it', async () => {
  const restoreEnvironment = setOAuthEnvironment();
  const originalFetch = global.fetch;

  try {
    const loginResponse = createResponse();
    login({ method: 'GET', headers: { 'x-forwarded-proto': 'https' } }, loginResponse);

    const authorizationUrl = new URL(loginResponse.headers.location);
    assert.equal(authorizationUrl.origin, 'https://apis.roblox.com');
    assert.equal(authorizationUrl.pathname, '/oauth/v1/authorize');
    assert.equal(authorizationUrl.searchParams.get('scope'), 'openid profile');
    assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');

    const oauthCookie = cookiePair(loginResponse.headers['set-cookie'], 'orbit_oauth');
    const oauthState = unseal(oauthCookie.slice('orbit_oauth='.length), process.env.ORBIT_SESSION_SECRET);
    assert.equal(authorizationUrl.searchParams.get('state'), oauthState.state);
    assert.equal(
      authorizationUrl.searchParams.get('code_challenge'),
      createHash('sha256').update(oauthState.verifier).digest('base64url')
    );

    const fetchCalls = [];
    let mockFetchError = null;
    global.fetch = async (url, options = {}) => {
      fetchCalls.push({ url: String(url), options });
      try {
        if (String(url).endsWith('/token')) {
          const form = new URLSearchParams(options.body);
          assert.equal(form.get('client_secret'), 'test-client-secret');
          assert.equal(form.get('code_verifier'), oauthState.verifier);
          return { ok: true, json: async () => ({ access_token: 'temporary-access-token' }) };
        }
        assert.equal(options.headers.Authorization, 'Bearer temporary-access-token');
        return {
          ok: true,
          json: async () => ({ sub: '98765', preferred_username: 'OrbitPlayer', name: 'Orbit Player' })
        };
      } catch (error) {
        mockFetchError = error;
        throw error;
      }
    };

    const forgedCallbackResponse = createResponse();
    await callback({
      method: 'GET',
      url: '/api/roblox/callback?code=forged-code&state=forged-state',
      headers: { cookie: oauthCookie, 'x-forwarded-proto': 'https' }
    }, forgedCallbackResponse);
    assert.equal(forgedCallbackResponse.headers.location, '/?oauth_error=invalid_state');
    assert.equal(fetchCalls.length, 0);

    const callbackResponse = createResponse();
    await callback({
      method: 'GET',
      url: `/api/roblox/callback?code=one-time-code&state=${encodeURIComponent(oauthState.state)}`,
      headers: { cookie: oauthCookie, 'x-forwarded-proto': 'https' }
    }, callbackResponse);

    assert.equal(mockFetchError, null, mockFetchError?.stack);
    assert.deepEqual(fetchCalls.map(call => call.url), [
      'https://apis.roblox.com/oauth/v1/token',
      'https://apis.roblox.com/oauth/v1/userinfo'
    ]);
    assert.equal(callbackResponse.headers.location, '/?oauth=connected');
    const sessionCookie = cookiePair(callbackResponse.headers['set-cookie'], 'orbit_session');
    assert.equal(sessionCookie.includes('temporary-access-token'), false);
    assert.equal(sessionCookie.includes('OrbitPlayer'), false);

    const profileResponse = createResponse();
    me({ method: 'GET', headers: { cookie: sessionCookie } }, profileResponse);
    assert.deepEqual(profileResponse.body.user, {
      id: '98765',
      username: 'OrbitPlayer',
      displayName: 'Orbit Player',
      picture: null
    });

    const logoutResponse = createResponse();
    logout({ method: 'POST', headers: {} }, logoutResponse);
    assert.equal(logoutResponse.statusCode, 204);
    assert.ok(logoutResponse.headers['set-cookie'][0].includes('Max-Age=0'));
  } finally {
    global.fetch = originalFetch;
    restoreEnvironment();
  }
});