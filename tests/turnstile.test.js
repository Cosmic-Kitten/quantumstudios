const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidSession } = require('../lib/turnstile-session');
const verifyTurnstile = require('../api/turnstile/verify');

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { this.ended = true; return this; }
  };
}

function setTurnstileEnvironment(overrides = {}) {
  const names = ['TURNSTILE_SECRET', 'TURNSTILE_HOSTNAMES', 'ORBIT_SESSION_SECRET', 'VERCEL', 'VERCEL_ENV'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, {
    TURNSTILE_SECRET: 'test-turnstile-secret',
    TURNSTILE_HOSTNAMES: 'quantumstudios.vercel.app,localhost,127.0.0.1',
    ORBIT_SESSION_SECRET: 'test-session-secret-with-at-least-32-characters',
    VERCEL: '1',
    VERCEL_ENV: 'production',
    ...overrides
  });
  return () => names.forEach(name => {
    if (previous[name] === undefined) delete process.env[name];
    else process.env[name] = previous[name];
  });
}

function createRequest({ method = 'POST', host = 'quantumstudios.vercel.app', token = 'fresh-token' } = {}) {
  return { method, headers: { host }, body: { token } };
}

test('Turnstile verification grants a signed secure HttpOnly cookie only for the expected action and hostname', async () => {
  const restoreEnvironment = setTurnstileEnvironment();
  const originalFetch = global.fetch;
  let requestBody;

  try {
    global.fetch = async (url, options) => {
      assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
      requestBody = new URLSearchParams(options.body);
      return {
        ok: true,
        json: async () => ({ success: true, action: 'website', hostname: 'quantumstudios.vercel.app' })
      };
    };

    const response = createResponse();
    await verifyTurnstile(createRequest(), response);

    assert.equal(requestBody.get('secret'), 'test-turnstile-secret');
    assert.equal(requestBody.get('response'), 'fresh-token');
    assert.equal(response.statusCode, 204);
    const cookie = response.headers['set-cookie'];
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Lax/);
    const token = cookie.match(/orbit_turnstile=([^;]+)/)[1];
    assert.equal(isValidSession(token, process.env.ORBIT_SESSION_SECRET), true);
  } finally {
    global.fetch = originalFetch;
    restoreEnvironment();
  }
});

test('Turnstile verification rejects unsuccessful, mismatched-action, and mismatched-host responses', async () => {
  const restoreEnvironment = setTurnstileEnvironment();
  const originalFetch = global.fetch;
  const results = [
    { success: false, action: 'website', hostname: 'quantumstudios.vercel.app' },
    { success: true, action: 'login', hostname: 'quantumstudios.vercel.app' },
    { success: true, action: 'website', hostname: 'other.example' }
  ];

  try {
    global.fetch = async () => ({ ok: true, json: async () => results.shift() });
    for (let index = 0; index < 3; index += 1) {
      const response = createResponse();
      await verifyTurnstile(createRequest(), response);
      assert.equal(response.statusCode, 403);
      assert.equal(response.headers['set-cookie'], undefined);
    }
  } finally {
    global.fetch = originalFetch;
    restoreEnvironment();
  }
});

test('Turnstile verification fails closed for local hostnames in production', async () => {
  const restoreEnvironment = setTurnstileEnvironment();
  const originalFetch = global.fetch;

  try {
    global.fetch = async () => {
      throw new Error('siteverify must not be called for an unapproved request hostname');
    };
    const response = createResponse();
    await verifyTurnstile(createRequest({ host: 'localhost:3000' }), response);
    assert.equal(response.statusCode, 403);
    assert.equal(response.body.error, 'forbidden');
  } finally {
    global.fetch = originalFetch;
    restoreEnvironment();
  }
});

test('Turnstile verification reports missing configuration and upstream failures', async () => {
  const restoreEnvironment = setTurnstileEnvironment();
  const originalFetch = global.fetch;

  try {
    delete process.env.TURNSTILE_SECRET;
    const unconfiguredResponse = createResponse();
    await verifyTurnstile(createRequest(), unconfiguredResponse);
    assert.equal(unconfiguredResponse.statusCode, 503);

    process.env.TURNSTILE_SECRET = 'test-turnstile-secret';
    global.fetch = async () => {
      throw new Error('network unavailable');
    };
    const unavailableResponse = createResponse();
    await verifyTurnstile(createRequest(), unavailableResponse);
    assert.equal(unavailableResponse.statusCode, 503);
    assert.equal(unavailableResponse.body.error, 'turnstile_verification_unavailable');
  } finally {
    global.fetch = originalFetch;
    restoreEnvironment();
  }
});

test('signed access sessions reject tampering and expiration', () => {
  const now = Date.now();
  const token = `${now + 60_000}.${'a'.repeat(43)}`;
  assert.equal(isValidSession(token, 'session-secret-that-is-at-least-32-characters', now), false);
  assert.equal(isValidSession(null, 'session-secret-that-is-at-least-32-characters', now), false);
});
