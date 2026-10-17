const { methodNotAllowed } = require('../../lib/roblox-oauth');

function positiveId(value) {
  return /^\d{1,20}$/.test(value || '') && BigInt(value) > 0n;
}

function inferGameplaySystems(description) {
  const text = String(description || '').slice(0, 5000);
  const systems = [
    {
      id: 'activities',
      label: 'Player activities',
      terms: [
        ['adopt', /\badopt(?:ing|s|ed)?\b/i],
        ['raise', /\brais(?:e|es|ing|ed)\b/i],
        ['trade', /\btrad(?:e|es|ing|ed)\b/i],
        ['collect', /\bcollect(?:s|ing|ed)?\b/i],
        ['explore', /\bexplor(?:e|es|ing|ed|ation)\b/i],
        ['battle', /\bbattl(?:e|es|ing|ed)\b/i],
        ['roleplay', /\brole[ -]?play(?:s|ing|ed)?\b/i],
        ['race', /\brac(?:e|es|ing|ed)\b/i]
      ]
    },
    {
      id: 'progression',
      label: 'Goals & progression',
      terms: [
        ['quests', /\bquests?\b/i],
        ['levels', /\blevel(?:s|ing|led)?\b/i],
        ['unlocking', /\bunlock(?:s|ing|ed)?\b/i],
        ['upgrading', /\bupgrad(?:e|es|ing|ed)\b/i],
        ['hatching', /\bhatch(?:es|ing|ed)?\b/i],
        ['evolving', /\bevolv(?:e|es|ing|ed)\b/i],
        ['rewards', /\brewards?\b/i],
        ['collecting', /\bcollect(?:s|ing|ed)?\b/i]
      ]
    },
    {
      id: 'social',
      label: 'Social play',
      terms: [
        ['friends', /\bfriends?\b/i],
        ['trading', /\btrad(?:e|es|ing|ed)\b/i],
        ['teams', /\bteams?\b/i],
        ['roleplay', /\brole[ -]?play(?:s|ing|ed)?\b/i],
        ['multiplayer', /\bmultiplayer\b/i],
        ['players', /\bplayers?\b/i]
      ]
    },
    {
      id: 'building',
      label: 'Building & customization',
      terms: [
        ['building', /\bbuild(?:s|ing)?\b/i],
        ['designing', /\bdesign(?:s|ing|ed)?\b/i],
        ['customizing', /\bcustomiz(?:e|es|ing|ed|ation)\b/i],
        ['decorating', /\bdecorat(?:e|es|ing|ed|ion)\b/i],
        ['homes', /\bhomes?\b/i],
        ['avatars', /\bavatars?\b/i]
      ]
    }
  ];

  return systems.map(system => ({
    id: system.id,
    label: system.label,
    evidence: system.terms.filter(([, pattern]) => pattern.test(text)).map(([term]) => term).slice(0, 5)
  })).filter(system => system.evidence.length);
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error('Roblox public game data request failed');
  return response.json();
}

module.exports = async function game(req, res) {
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET');

  const query = new URL(req.url, 'https://orbit.local').searchParams;
  const universeId = query.get('universeId') || '';
  if (!positiveId(universeId)) return res.status(400).json({ error: 'A valid universeId is required.' });

  try {
    const [detailsPayload, recommendationPayload, thumbnailPayload] = await Promise.all([
      getJson(`https://games.roblox.com/v1/games?universeIds=${universeId}`),
      getJson(`https://games.roblox.com/v1/games/recommendations/game/${universeId}?maxRows=8`),
      getJson(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeId}&returnPolicy=PlaceHolder&size=512x512&format=Png&isCircular=false`)
    ]);

    const game = (detailsPayload.data || [])[0];
    if (!game || String(game.id) !== universeId || !Number.isSafeInteger(game.rootPlaceId)) {
      return res.status(404).json({ error: 'Roblox did not return details for that experience.' });
    }

    const seenRecommendationIds = new Set([universeId]);
    const recommendations = (Array.isArray(recommendationPayload.games) ? recommendationPayload.games : [])
      .filter(item => Number.isSafeInteger(item.universeId) && Number.isSafeInteger(item.placeId))
      .filter(item => {
        const universeId = String(item.universeId);
        if (seenRecommendationIds.has(universeId)) return false;
        seenRecommendationIds.add(universeId);
        return true;
      })
      .slice(0, 8)
      .map(item => ({
        universeId: String(item.universeId),
        placeId: String(item.placeId),
        name: String(item.name || 'Untitled experience').slice(0, 120),
        creator: String(item.creatorName || 'Roblox creator').slice(0, 100),
        playerCount: Number.isFinite(item.playerCount) ? item.playerCount : 0,
        url: `https://www.roblox.com/games/${item.placeId}`
      }));
    let recommendationThumbnails = new Map();
    if (recommendations.length) {
      const thumbnailIds = recommendations.map(item => item.universeId).join(',');
      try {
        const recommendationThumbnailPayload = await getJson(
          `https://thumbnails.roblox.com/v1/games/icons?universeIds=${thumbnailIds}&returnPolicy=PlaceHolder&size=512x512&format=Png&isCircular=false`
        );
        recommendationThumbnails = new Map((Array.isArray(recommendationThumbnailPayload.data) ? recommendationThumbnailPayload.data : [])
          .filter(item => /^\d+$/.test(String(item.targetId || '')) && typeof item.imageUrl === 'string' && item.imageUrl.startsWith('https://'))
          .map(item => [String(item.targetId), item.imageUrl]));
      } catch (error) {
        console.error('Roblox recommendation thumbnails request failed:', error instanceof Error ? error.message : 'unknown error');
      }
    }
    recommendations.forEach(item => { item.thumbnail = recommendationThumbnails.get(item.universeId) || null; });

    return res.status(200).json({
      game: {
        universeId: String(game.id),
        placeId: String(game.rootPlaceId),
        name: String(game.name || 'Untitled experience').slice(0, 120),
        description: String(game.description || '').slice(0, 5000),
        creator: {
          id: String(game.creator?.id || ''),
          name: String(game.creator?.name || 'Roblox creator').slice(0, 100),
          type: game.creator?.type === 'Group' ? 'Group' : 'User',
          verified: Boolean(game.creator?.hasVerifiedBadge)
        },
        genre: String(game.genre_l1 || game.genre || 'Not listed').slice(0, 80),
        subgenre: String(game.genre_l2 || '').slice(0, 80),
        gameplay: inferGameplaySystems(game.description),
        playing: Number.isFinite(game.playing) ? game.playing : 0,
        visits: Number.isFinite(game.visits) ? game.visits : 0,
        favorites: Number.isFinite(game.favoritedCount) ? game.favoritedCount : 0,
        maxPlayers: Number.isFinite(game.maxPlayers) ? game.maxPlayers : null,
        created: game.created || null,
        updated: game.updated || null,
        url: `https://www.roblox.com/games/${game.rootPlaceId}`,
        thumbnail: thumbnailPayload.data?.[0]?.imageUrl || null
      },
      connections: recommendations
    });
  } catch {
    return res.status(502).json({ error: 'Could not load public Roblox experience information. Try again.' });
  }
};