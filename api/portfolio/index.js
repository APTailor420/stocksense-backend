// ================================================================
// /api/portfolio — Portfolio CRUD
// GET    — list positions (query: status=active|exited|all)
// POST   — add new position
// PUT    — update position (body: { id, updates })
// ================================================================

const { getPortfolio, addToPortfolio, updatePosition, exitPosition } = require('../../lib/db');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS_HEADERS);
    return res.end();
  }
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  try {
    // GET — list
    if (req.method === 'GET') {
      const status = req.query.status || 'all';
      const positions = await getPortfolio(status);
      return res.status(200).json({ success: true, count: positions.length, positions });
    }

    // POST — add position
    if (req.method === 'POST') {
      const body = req.body;
      if (!body?.symbol || !body?.entryPrice) {
        return res.status(400).json({ error: 'symbol and entryPrice are required' });
      }
      const position = await addToPortfolio(body);
      return res.status(201).json({ success: true, position });
    }

    // PUT — update or exit
    if (req.method === 'PUT') {
      const body = req.body;
      if (!body?.id) return res.status(400).json({ error: 'id is required' });

      // If exitPrice provided, exit the position
      if (body.exitPrice != null) {
        const result = await exitPosition(body.id, body.exitPrice);
        return res.status(200).json({ success: true, ...result });
      }

      // Otherwise, update fields
      const result = await updatePosition(body.id, body);
      return res.status(200).json({ success: true, ...result });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Portfolio error:', err);
    return res.status(500).json({ error: err.message });
  }
};
