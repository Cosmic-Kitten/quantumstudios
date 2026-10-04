const { methodNotAllowed } = require('../../lib/roblox-oauth');

function decodeHtml(value) {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|#39|lt|gt|nbsp);/gi, (match, entity) => {
      if (entity[0] === '#') {
        const hex = entity[1]?.toLowerCase() === 'x';
        const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
        return Number.isInteger(point) && point >= 0 && point <= 0x10ffff
          ? String.fromCodePoint(point)
          : ' ';
      }
      return ({ amp: '&', quot: '"', apos: "'", '#39': "'", lt: '<', gt: '>', nbsp: ' ' })[entity.toLowerCase()] || ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
}

function resultUrl(rawHref) {
  try {
    let url = new URL(rawHref, 'https://html.duckduckgo.com');
    if (url.hostname === 'duckduckgo.com' || url.hostname.endsWith('.duckduckgo.com')) {
      const destination = url.searchParams.get('uddg');
      if (!destination) return null;
      url = new URL(destination);
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function parseResults(html) {
  const anchors = [...html.matchAll(/<a\b[^>]*\bclass=(["'])[^"']*\bresult__a\b[^"']*\1[^>]*>([\s\S]*?)<\/a>/gi)];
  const results = [];
  const seen = new Set();
  anchors.forEach((match, index) => {
    const url = resultUrl(attribute(match[0], 'href'));
    const title = decodeHtml(match[2]);
    if (!url || !title || seen.has(url)) return;
    seen.add(url);
    const start = match.index + match[0].length;
    const end = anchors[index + 1]?.index ?? html.length;
    const following = html.slice(start, end);
    const snippetMatch = following.match(/<(?:a|div|td)\b[^>]*\bclass=(["'])[^"']*\bresult__snippet\b[^"']*\1[^>]*>([\s\S]*?)<\/(?:a|div|td)>/i);
    const snippet = snippetMatch ? decodeHtml(snippetMatch[2]) : '';
    const host = new URL(url).hostname.replace(/^www\./i, '');
    results.push({ title: title.slice(0, 180), snippet: snippet.slice(0, 500), url, host });
  });
  return results.slice(0, 8);
}

module.exports = async function research(req, res) {
  res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300');
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET');

  const query = new URL(req.url, 'https://orbit.local').searchParams.get('q')?.trim().replace(/\s+/g, ' ') || '';
  if (query.length < 3 || query.length > 160) {
    return res.status(400).json({ error: 'Enter a research query between 3 and 160 characters.' });
  }

  const url = new URL('https://html.duckduckgo.com/html/');
  url.searchParams.set('q', query);
  url.searchParams.set('kl', 'us-en');

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/html',
        'User-Agent': 'Mozilla/5.0 (compatible; OrbitResearch/1.0)'
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return res.status(502).json({ error: 'Web research is temporarily unavailable.' });
    const html = await response.text();
    const results = parseResults(html);
    return res.status(200).json({ query, results });
  } catch {
    return res.status(502).json({ error: 'Could not reach web search. Try again.' });
  }
};
