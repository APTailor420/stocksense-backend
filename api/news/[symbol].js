// ================================================================
// GET /api/news/:symbol — Fetch news from Yahoo + Google News RSS
// Returns deduplicated, sorted news items
// ================================================================

const { UNIVERSE } = require('../../lib/universe');
const { fetchYahooNews } = require('../../lib/yahoo');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * Fetch and parse Google News RSS (server-side — no CORS issues)
 */
async function fetchGoogleNewsRSS(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StockSenseBot/1.0)' },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return [];
    const text = await res.text();

    // Simple XML parsing for RSS items (no DOM parser in Node — use regex)
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(text)) !== null) {
      const block = match[1];
      const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
      const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '';
      const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '';
      const source = (block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || 'Google News';
      items.push({
        title: title.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim(),
        link: link.trim(),
        pubDate,
        source: source.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim()
      });
    }
    return items;
  } catch {
    return [];
  }
}

/**
 * Build news queries from stock name (same logic as v4)
 */
function buildNewsQueries(sym, name) {
  const cleanSym = sym.replace('%26', '&');
  const shortName = (name || '').replace(/\b(Corp|Corporation|Limited|Ltd|Industries|Company|Co\.|India|Bank|Motors|Finance)\b/gi, '').replace(/\s+/g, ' ').trim();
  const primary = shortName || cleanSym;
  return [
    { q: `"${primary}" share`, label: 'share' },
    { q: `"${primary}" stock India`, label: 'stock' },
    { q: `"${primary}" results OR earnings OR quarterly`, label: 'results' },
    { q: `${cleanSym} NSE`, label: 'ticker' }
  ];
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS_HEADERS);
    return res.end();
  }
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  try {
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: 'Symbol is required' });

    const sym = symbol.toUpperCase();
    const stockInfo = UNIVERSE.find(u => u.s === sym || u.s === sym.replace('&', '%26'));
    const name = stockInfo?.n || sym;

    // Build queries
    const queries = buildNewsQueries(sym, name);

    // Fetch all sources in parallel
    const [yahooNews, ...googleResults] = await Promise.all([
      fetchYahooNews(sym),
      ...queries.map(({ q }) => fetchGoogleNewsRSS(q)),
      // Also fetch MoneyControl-specific news
      fetchGoogleNewsRSS(`"${name.replace(/\b(Corp|Corporation|Limited|Ltd|Industries|Company|Co\.)\b/gi, '').trim()}" site:moneycontrol.com`)
    ]);

    // Flatten + dedupe
    const all = [
      ...yahooNews,
      ...[].concat(...googleResults)
    ];

    const seen = new Set();
    const dedup = [];
    for (const item of all) {
      if (!item.title) continue;
      const key = item.title.toLowerCase().slice(0, 50);
      if (seen.has(key)) continue;
      seen.add(key);
      dedup.push(item);
    }

    // Sort by date (newest first)
    dedup.sort((a, b) => {
      const da = new Date(a.pubDate || 0).getTime();
      const db = new Date(b.pubDate || 0).getTime();
      return db - da;
    });

    return res.status(200).json({
      success: true,
      symbol: sym,
      name,
      count: Math.min(dedup.length, 25),
      news: dedup.slice(0, 25)
    });
  } catch (err) {
    console.error('News fetch error:', err);
    return res.status(500).json({ error: err.message });
  }
};
