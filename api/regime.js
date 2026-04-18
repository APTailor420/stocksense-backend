// ================================================================
// GET /api/regime — Current market regime detection
// Returns Nifty position vs 50-DMA, VIX level, regime classification
// ================================================================

const { fetchMarketData } = require('../lib/yahoo');
const { computeMarketRegime } = require('../lib/regime');

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
    const marketData = await fetchMarketData();
    const regimeData = computeMarketRegime(marketData);

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      ...regimeData
    });
  } catch (err) {
    console.error('Regime error:', err);
    return res.status(500).json({ error: err.message });
  }
};
