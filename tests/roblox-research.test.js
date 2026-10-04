const test = require('node:test');
const assert = require('node:assert/strict');
const research = require('../api/roblox/research');

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

test('web research validates queries and normalizes guide sources', async () => {
  const originalFetch = global.fetch;
  let requestedUrl;
  global.fetch = async url => {
    requestedUrl = new URL(url);
    return {
      ok: true,
      text: async () => `
        <div class="result">
          <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fguides.example%2Fgame%3Fref%3Dddg">Beginner &amp; controls guide</a>
          <div class="result__snippet">Learn the <b>controls</b> and first quests.</div>
        </div>
        <div class="result">
          <a class="result__a" href="https://community.example/how-to-play">How to play</a>
          <a class="result__snippet">Tips for new players &amp; friends.</a>
        </div>
        <a class="result__a" href="javascript:alert(1)">Unsafe result</a>
      `
    };
  };

  try {
    const invalid = createResponse();
    await research({ method: 'GET', url: '/api/roblox/research?q=ab' }, invalid);
    assert.equal(invalid.statusCode, 400);
    assert.equal(requestedUrl, undefined);

    const response = createResponse();
    await research({ method: 'GET', url: '/api/roblox/research?q=game%20how%20to%20play' }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(requestedUrl.hostname, 'html.duckduckgo.com');
    assert.equal(requestedUrl.searchParams.get('q'), 'game how to play');
    assert.deepEqual(response.body.results.map(result => result.url), [
      'https://guides.example/game?ref=ddg',
      'https://community.example/how-to-play'
    ]);
    assert.equal(response.body.results[0].title, 'Beginner & controls guide');
    assert.equal(response.body.results[0].snippet, 'Learn the controls and first quests.');
    assert.equal(response.body.results[0].host, 'guides.example');

    const wrongMethod = createResponse();
    await research({ method: 'POST', url: '/api/roblox/research?q=game%20guides' }, wrongMethod);
    assert.equal(wrongMethod.statusCode, 405);
  } finally {
    global.fetch = originalFetch;
  }
});
