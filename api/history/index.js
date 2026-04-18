// ================================================================
// GET /api/history — List scan history (paginated)
// GET /api/history?id=xxx — Get single scan with full results
// ================================================================

const { getScanHistory, getScanById } = require('../../lib/db');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS_HEADERS);
    return res.end();
  }
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  try {
    const { id, page = '1', limit = '20' } = req.query;

    // Single scan detail
    if (id) {
      const scan = await getScanById(id);
      if (!scan) return res.status(404).json({ error: 'Scan not found' });
      return res.status(200).json({ success: true, scan });
    }

    // Paginated list
    const result = await getScanHistory(parseInt(page), parseInt(limit));
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('History error:', err);
    return res.status(500).json({ error: err.message });
  }
};
