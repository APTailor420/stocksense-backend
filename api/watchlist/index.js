// ================================================================
// /api/watchlist — Watchlist CRUD
// GET    — list all watchlist items
// POST   — add to watchlist
// DELETE — remove from watchlist (query: symbol=XXX)
// ================================================================

const { getWatchlist, addToWatchlist, removeFromWatchlist } = require('../../lib/db');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS_HEADERS);
    return res.end();
  }
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  try {
    if (req.method === 'GET') {
      const items = await getWatchlist();
      return res.status(200).json({ success: true, count: items.length, watchlist: items });
    }

    if (req.method === 'POST') {
      const body = req.body;
      if (!body?.symbol) return res.status(400).json({ error: 'symbol is required' });
      const item = await addToWatchlist(body);
      return res.status(201).json({ success: true, item });
    }

    if (req.method === 'DELETE') {
      const symbol = req.query.symbol || req.body?.symbol;
      if (!symbol) return res.status(400).json({ error: 'symbol is required' });
      const result = await removeFromWatchlist(symbol.toUpperCase());
      return res.status(200).json({ success: true, ...result });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Watchlist error:', err);
    return res.status(500).json({ error: err.message });
  }
};
