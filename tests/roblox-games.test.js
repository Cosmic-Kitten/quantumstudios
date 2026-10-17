const test = require('node:test');
const assert = require('node:assert/strict');
const search = require('../api/roblox/search');
const game = require('../api/roblox/game');

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

test('game search validates the query and returns normalized multiple matches', async () => {
  const originalFetch = global.fetch;
  let requestedUrl;
  global.fetch = async url => {
    requestedUrl = new URL(url);
    return {
      ok: true,
      json: async () => ({
        nextPageToken: 'next-token',
        searchResults: [{
          contentGroupType: 'Game',
          contents: [
            { universeId: 10, rootPlaceId: 100, name: 'Obby A', creatorName: 'Studio A', playerCount: 18 },
            { universeId: 20, rootPlaceId: 200, name: 'Obby B', creatorName: 'Studio B', playerCount: 42 }
          ]
        }, { contentGroupType: 'User', contents: [{ universeId: 30, rootPlaceId: 300, name: 'Not a game' }] }]
      })
    };
  };

  try {
    const invalidResponse = createResponse();
    await search({ method: 'GET', url: '/api/roblox/search?q=x' }, invalidResponse);
    assert.equal(invalidResponse.statusCode, 400);
    assert.equal(requestedUrl, undefined);

    const response = createResponse();
    await search({ method: 'GET', url: '/api/roblox/search?q=obby' }, response);
    assert.equal(requestedUrl.origin, 'https://apis.roblox.com');
    assert.equal(requestedUrl.pathname, '/search-api/omni-search');
    assert.equal(requestedUrl.searchParams.get('searchQuery'), 'obby');
    assert.deepEqual(response.body.results.map(item => [item.universeId, item.placeId, item.name]), [
      ['10', '100', 'Obby A'],
      ['20', '200', 'Obby B']
    ]);
    assert.equal(response.body.results.length, 2);
    assert.equal(response.body.nextPageToken, 'next-token');

    const nextPageResponse = createResponse();
    await search({ method: 'GET', url: '/api/roblox/search?q=obby&cursor=next-token' }, nextPageResponse);
    assert.equal(requestedUrl.searchParams.get('pageToken'), 'next-token');
    assert.equal(nextPageResponse.statusCode, 200);

    const invalidCursorResponse = createResponse();
    await search({ method: 'GET', url: `/api/roblox/search?q=obby&cursor=${'x'.repeat(513)}` }, invalidCursorResponse);
    assert.equal(invalidCursorResponse.statusCode, 400);
  } finally {
    global.fetch = originalFetch;
  }
});

test('game intel validates universe ID and normalizes public details and recommendations', async () => {
  const originalFetch = global.fetch;
  const requestedUrls = [];
  global.fetch = async url => {
    const parsed = new URL(url);
    requestedUrls.push(parsed);
    if (parsed.hostname === 'games.roblox.com' && parsed.pathname === '/v1/games') {
      return { ok: true, json: async () => ({ data: [{
        id: 123,
        rootPlaceId: 456,
        name: 'Sample Experience',
        description: 'A public description.',
        creator: { id: 789, name: 'Sample Studio', type: 'Group', hasVerifiedBadge: true },
        genre_l1: 'Adventure',
        genre_l2: 'Obby',
        playing: 52,
        visits: 9000,
        favoritedCount: 1200,
        maxPlayers: 20
      }] }) };
    }
    if (parsed.pathname.includes('/recommendations/')) {
      return { ok: true, json: async () => ({ games: [
        { universeId: 123, placeId: 456, name: 'The current experience' },
        { universeId: 234, placeId: 567, name: 'Related Experience', creatorName: 'Another Studio', playerCount: 7 },
        { universeId: 234, placeId: 568, name: 'Duplicate recommendation' }
      ] }) };
    }
    if (parsed.hostname === 'thumbnails.roblox.com' && parsed.searchParams.get('universeIds') === '234') {
      return { ok: true, json: async () => ({ data: [{ targetId: 234, imageUrl: 'https://t4.rbxcdn.com/related' }] }) };
    }
    return { ok: true, json: async () => ({ data: [{ imageUrl: 'https://t4.rbxcdn.com/example' }] }) };
  };

  try {
    const invalidResponse = createResponse();
    await game({ method: 'GET', url: '/api/roblox/game?universeId=0' }, invalidResponse);
    assert.equal(invalidResponse.statusCode, 400);
    assert.equal(requestedUrls.length, 0);

    const response = createResponse();
    await game({ method: 'GET', url: '/api/roblox/game?universeId=123' }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.game.name, 'Sample Experience');
    assert.equal(response.body.game.creator.name, 'Sample Studio');
    assert.equal(response.body.game.genre, 'Adventure');
    assert.deepEqual(response.body.game.gameplay, []);
    assert.equal(response.body.game.thumbnail, 'https://t4.rbxcdn.com/example');
    assert.equal(response.body.connections[0].name, 'Related Experience');
    assert.equal(response.body.connections[0].thumbnail, 'https://t4.rbxcdn.com/related');
    assert.deepEqual(response.body.connections.map(item => item.universeId), ['234']);
    assert.equal(requestedUrls.length, 4);
  } finally {
    global.fetch = originalFetch;
  }
});

test('game intel only reports gameplay systems supported by explicit description terms', async () => {
  const originalFetch = global.fetch;
  global.fetch = async url => {
    const parsed = new URL(url);
    if (parsed.hostname === 'games.roblox.com' && parsed.pathname === '/v1/games') {
      return { ok: true, json: async () => ({ data: [{
        id: 321,
        rootPlaceId: 654,
        name: 'Pet Town',
        description: 'Adopt and raise pets, trade with friends, collect rewards, and build your home.'
      }] }) };
    }
    if (parsed.pathname.includes('/recommendations/')) return { ok: true, json: async () => ({ games: [] }) };
    return { ok: true, json: async () => ({ data: [] }) };
  };

  try {
    const response = createResponse();
    await game({ method: 'GET', url: '/api/roblox/game?universeId=321' }, response);
    assert.deepEqual(response.body.game.gameplay, [
      { id: 'activities', label: 'Player activities', evidence: ['adopt', 'raise', 'trade', 'collect'] },
      { id: 'progression', label: 'Goals & progression', evidence: ['rewards', 'collecting'] },
      { id: 'social', label: 'Social play', evidence: ['friends', 'trading'] },
      { id: 'building', label: 'Building & customization', evidence: ['building', 'homes'] }
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});