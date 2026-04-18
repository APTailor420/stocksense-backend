// ================================================================
// MONGODB CONNECTION + MODELS
// Uses MongoDB native driver (lighter than Mongoose for serverless)
// ================================================================

const { MongoClient } = require('mongodb');

let cachedClient = null;
let cachedDb = null;

const DB_NAME = process.env.MONGODB_DB || 'stocksense';

/**
 * Get MongoDB connection (cached for serverless reuse)
 */
async function connectDB() {
  if (cachedDb) return cachedDb;

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI environment variable is not set');

  if (!cachedClient) {
    cachedClient = new MongoClient(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    await cachedClient.connect();
  }

  cachedDb = cachedClient.db(DB_NAME);
  return cachedDb;
}

// ================================================================
// COLLECTION HELPERS
// ================================================================

/**
 * Save a full scan result
 * @param {Object} scanData - { timestamp, regime, regimeData, results[], portfolioMode }
 */
async function saveScan(scanData) {
  const db = await connectDB();
  const doc = {
    timestamp: new Date(),
    regime: scanData.regime,
    regimeData: scanData.regimeData,
    totalStocks: scanData.results.length,
    portfolioMode: scanData.portfolioMode || 'offensive',
    results: scanData.results.map(r => ({
      symbol: r.symbol,
      name: r.name,
      sector: r.sector,
      price: r.price,
      change: r.change,
      totalScore: r.totalScore,
      techScore: r.techScore,
      momScore: r.momScore,
      signal: r.signal,
      beta: r.beta,
      correlation: r.correlation,
      resilienceScore: r.resilienceScore,
      resilienceLabel: r.resilienceLabel,
      trailingStop: r.trailingStop,
      support: r.support,
      resistance: r.resistance,
      rsi: r.rsi,
      superTrendBull: r.superTrendBull,
      macdBull: r.macdBull,
      vwapAbove: r.vwapAbove
    }))
  };
  const result = await db.collection('scans').insertOne(doc);
  return { id: result.insertedId, timestamp: doc.timestamp };
}

/**
 * Get scan history (paginated)
 * @param {number} page - page number (1-based)
 * @param {number} limit - results per page
 */
async function getScanHistory(page = 1, limit = 20) {
  const db = await connectDB();
  const skip = (page - 1) * limit;
  const [scans, total] = await Promise.all([
    db.collection('scans')
      .find({}, { projection: { results: 0 } }) // exclude full results for listing
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    db.collection('scans').countDocuments()
  ]);
  return { scans, total, page, pages: Math.ceil(total / limit) };
}

/**
 * Get a single scan by ID (with full results)
 * @param {string} scanId - MongoDB ObjectId string
 */
async function getScanById(scanId) {
  const db = await connectDB();
  const { ObjectId } = require('mongodb');
  return db.collection('scans').findOne({ _id: new ObjectId(scanId) });
}

// ================================================================
// PORTFOLIO TRACKING
// ================================================================

/**
 * Add stock to portfolio
 * @param {Object} entry - { symbol, name, sector, entryPrice, entryDate, quantity, signal, score, notes }
 */
async function addToPortfolio(entry) {
  const db = await connectDB();
  const doc = {
    symbol: entry.symbol,
    name: entry.name,
    sector: entry.sector,
    entryPrice: entry.entryPrice,
    entryDate: entry.entryDate ? new Date(entry.entryDate) : new Date(),
    quantity: entry.quantity || 0,
    signal: entry.signal,
    score: entry.score,
    trailingStop: entry.trailingStop,
    notes: entry.notes || '',
    status: 'active', // active | exited
    exitPrice: null,
    exitDate: null,
    pnl: null,
    pnlPct: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const result = await db.collection('portfolio').insertOne(doc);
  return { id: result.insertedId, ...doc };
}

/**
 * Exit a portfolio position
 * @param {string} positionId - MongoDB ObjectId string
 * @param {number} exitPrice
 */
async function exitPosition(positionId, exitPrice) {
  const db = await connectDB();
  const { ObjectId } = require('mongodb');
  const position = await db.collection('portfolio').findOne({ _id: new ObjectId(positionId) });
  if (!position) throw new Error('Position not found');

  const pnl = (exitPrice - position.entryPrice) * (position.quantity || 1);
  const pnlPct = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;

  await db.collection('portfolio').updateOne(
    { _id: new ObjectId(positionId) },
    {
      $set: {
        status: 'exited',
        exitPrice,
        exitDate: new Date(),
        pnl: parseFloat(pnl.toFixed(2)),
        pnlPct: parseFloat(pnlPct.toFixed(2)),
        updatedAt: new Date()
      }
    }
  );

  return { positionId, exitPrice, pnl, pnlPct };
}

/**
 * Get all portfolio positions
 * @param {string} status - 'active' | 'exited' | 'all'
 */
async function getPortfolio(status = 'all') {
  const db = await connectDB();
  const query = status === 'all' ? {} : { status };
  return db.collection('portfolio')
    .find(query)
    .sort({ createdAt: -1 })
    .toArray();
}

/**
 * Update portfolio position (e.g. update trailing stop, notes)
 * @param {string} positionId
 * @param {Object} updates
 */
async function updatePosition(positionId, updates) {
  const db = await connectDB();
  const { ObjectId } = require('mongodb');
  const allowed = ['trailingStop', 'notes', 'quantity', 'signal', 'score'];
  const setObj = { updatedAt: new Date() };
  for (const key of allowed) {
    if (updates[key] !== undefined) setObj[key] = updates[key];
  }
  await db.collection('portfolio').updateOne(
    { _id: new ObjectId(positionId) },
    { $set: setObj }
  );
  return { positionId, updated: Object.keys(setObj) };
}

// ================================================================
// WATCHLIST
// ================================================================

async function addToWatchlist(item) {
  const db = await connectDB();
  const doc = {
    symbol: item.symbol,
    name: item.name,
    sector: item.sector,
    addedAt: new Date(),
    targetPrice: item.targetPrice || null,
    notes: item.notes || '',
    lastScore: item.lastScore || null,
    lastSignal: item.lastSignal || null
  };
  // Upsert — don't duplicate
  await db.collection('watchlist').updateOne(
    { symbol: item.symbol },
    { $set: doc },
    { upsert: true }
  );
  return doc;
}

async function removeFromWatchlist(symbol) {
  const db = await connectDB();
  await db.collection('watchlist').deleteOne({ symbol });
  return { symbol, removed: true };
}

async function getWatchlist() {
  const db = await connectDB();
  return db.collection('watchlist').find({}).sort({ addedAt: -1 }).toArray();
}

// ================================================================
// INDEX SETUP (run once on first deploy)
// ================================================================

async function ensureIndexes() {
  const db = await connectDB();
  await Promise.all([
    db.collection('scans').createIndex({ timestamp: -1 }),
    db.collection('portfolio').createIndex({ symbol: 1, status: 1 }),
    db.collection('portfolio').createIndex({ createdAt: -1 }),
    db.collection('watchlist').createIndex({ symbol: 1 }, { unique: true }),
  ]);
  return { success: true };
}

module.exports = {
  connectDB, ensureIndexes,
  saveScan, getScanHistory, getScanById,
  addToPortfolio, exitPosition, getPortfolio, updatePosition,
  addToWatchlist, removeFromWatchlist, getWatchlist
};
