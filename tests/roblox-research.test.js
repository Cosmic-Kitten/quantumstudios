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
      <?xml version="1.0"?>
      <rss><channel>
        <item>
          <title>Beginner &amp; controls guide</title>
          <link>https://guides.example/game?ref=bing</link>
          <description>Learn the &lt;b&gt;controls&lt;/b&gt; and first quests.</description>
        </item>
        <item>
          <title><![CDATA[How to play]]></title>
          <link>https://community.example/how-to-play</link>
          <description>Tips for new players &amp; friends.</description>
        </item>
        <item>
          <title>Unsafe result</title>
          <link>javascript:alert(1)</link>
          <description>Unsafe URLs must not be returned.</description>
        </item>
      </channel></rss>
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
    assert.equal(requestedUrl.hostname, 'www.bing.com');
    assert.equal(requestedUrl.pathname, '/search');
    assert.equal(requestedUrl.searchParams.get('format'), 'rss');
    assert.equal(requestedUrl.searchParams.get('q'), 'game how to play');
    assert.deepEqual(response.body.results.map(result => result.url), [
      'https://guides.example/game?ref=bing',
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
