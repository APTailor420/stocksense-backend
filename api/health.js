// ================================================================
// GET /api/health — Health check + DB connection test
// ================================================================

const { connectDB, ensureIndexes } = require('../lib/db');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const db = await connectDB();
    await ensureIndexes();

    return res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      db: 'connected',
      version: '1.0.0'
    });
  } catch (err) {
    return res.status(500).json({
      status: 'error',
      db: 'disconnected',
      error: err.message
    });
  }
};
