const { methodNotAllowed } = require('../../lib/roblox-oauth');

module.exports = async function search(req, res) {
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET');

  const query = new URL(req.url, 'https://orbit.local').searchParams;
  const keyword = (query.get('q') || '').trim().replace(/\s+/g, ' ');
  const pageToken = query.get('cursor') || '';
  if (keyword.length < 2 || keyword.length > 80) {
    return res.status(400).json({ error: 'Enter a game name between 2 and 80 characters.' });
  }
  if (pageToken.length > 512) return res.status(400).json({ error: 'Invalid search page token.' });

  const searchUrl = new URL('https://apis.roblox.com/search-api/omni-search');
  searchUrl.search = new URLSearchParams({
    searchQuery: keyword,
    pageToken,
    sessionId: 'orbit-launcher',
    source: 'Game'
  });

  try {
    const response = await fetch(searchUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return res.status(502).json({ error: 'Roblox game search is temporarily unavailable.' });

    const payload = await response.json();
    const results = (payload.searchResults || [])
      .filter(group => group.contentGroupType === 'Game')
      .flatMap(group => group.contents || [])
      .filter(game => Number.isSafeInteger(game.universeId) && Number.isSafeInteger(game.rootPlaceId))
      .map(game => ({
        universeId: String(game.universeId),
        placeId: String(game.rootPlaceId),
        name: String(game.name || 'Untitled experience').slice(0, 120),
        description: String(game.description || '').slice(0, 1200),
        creator: String(game.creatorName || 'Roblox creator').slice(0, 100),
        creatorId: Number.isSafeInteger(game.creatorId) ? String(game.creatorId) : null,
        creatorVerified: Boolean(game.creatorHasVerifiedBadge),
        playerCount: Number.isFinite(game.playerCount) ? game.playerCount : 0,
        upVotes: Number.isFinite(game.totalUpVotes) ? game.totalUpVotes : 0,
        downVotes: Number.isFinite(game.totalDownVotes) ? game.totalDownVotes : 0,
        ageRating: String(game.ageRecommendationDisplayName || '').slice(0, 80),
        url: `https://www.roblox.com/games/${game.rootPlaceId}`
      }))
      .slice(0, 40);

    const nextPageToken = typeof payload.nextPageToken === 'string' && payload.nextPageToken.length <= 512
      ? payload.nextPageToken
      : null;
    return res.status(200).json({ results, nextPageToken });
  } catch {
    return res.status(502).json({ error: 'Could not reach Roblox game search. Try again.' });
  }
};