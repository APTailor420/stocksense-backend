// ================================================================
// POST /api/scan — Full universe scan (v6: Fresh Crossover Edition)
// Scans all 150+ stocks, scores with v3/v4 additive scoring,
// detects market regime, saves to MongoDB, returns ranked results.
// ================================================================

const { UNIVERSE } = require('../lib/universe');
const { fetchStock, fetchMarketData } = require('../lib/yahoo');
const { scoreStock, getSignal } = require('../lib/scoring');
const { computeMarketRegime } = require('../lib/regime');
const { getResilienceLabel } = require('../lib/indicators');
const { saveScan } = require('../lib/db');

// CORS headers for frontend
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

module.exports = async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS_HEADERS);
    return res.end();
  }

  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  try {
    const body = req.method === 'POST' ? req.body : {};
    const portfolioMode = body?.portfolioMode || 'offensive';
    const sectorFilter = body?.sector || 'All';
    const saveToDB = body?.save !== false; // save by default

    // Step 1: Fetch market data for regime detection
    const marketData = await fetchMarketData();
    const regimeData = computeMarketRegime(marketData);
    const regime = regimeData.regime;

    // Nifty 60-day history for beta calculation
    const nifty60dHistory = marketData
      ? marketData.closes.slice(Math.max(0, marketData.closes.length - 60))
      : null;

    // Step 2: Filter universe by sector if needed
    let stocks = UNIVERSE;
    if (sectorFilter && sectorFilter !== 'All') {
      stocks = stocks.filter(u => u.sec === sectorFilter);
    }

    // Step 3: Fetch and score all stocks (in batches to avoid rate limits)
    const BATCH_SIZE = 15;
    const results = [];
    const errors = [];

    for (let i = 0; i < stocks.length; i += BATCH_SIZE) {
      const batch = stocks.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.allSettled(
        batch.map(async (stock) => {
          try {
            const data = await fetchStock(stock.s);
            if (!data) return null;

            data.sector = stock.sec;
            const scored = scoreStock(data, nifty60dHistory);
            const signal = getSignal(scored.totalScore, scored.beta, regime);
            const resilience = getResilienceLabel(scored.resilienceScore);

            // Compute defensive score: 50% original + 50% resilience
            const defensiveScore = Math.round(scored.totalScore * 0.5 + scored.resilienceScore * 0.5);

            return {
              symbol: stock.s,
              name: stock.n,
              sector: stock.sec,
              price: scored.price,
              change: parseFloat(scored.change.toFixed(2)),
              totalScore: scored.totalScore,
              techScore: scored.techScore,
              momScore: scored.momScore,
              defensiveScore,
              signal: signal.label,
              signalKey: signal.key,
              signalEmoji: signal.emoji,
              downgraded: signal.downgraded || false,
              beta: parseFloat(scored.beta.toFixed(2)),
              correlation: parseFloat(scored.correlation.toFixed(2)),
              resilienceScore: scored.resilienceScore,
              resilienceLabel: resilience.label,
              resilienceEmoji: resilience.emoji,
              rsi: scored.rsi ? parseFloat(scored.rsi.toFixed(1)) : null,
              superTrendBull: scored.superTrendBull,
              macdBull: scored.macdBull,
              vwapAbove: scored.vwapAbove,
              support: scored.support ? parseFloat(scored.support.toFixed(2)) : null,
              resistance: scored.resistance ? parseFloat(scored.resistance.toFixed(2)) : null,
              trailingStop: parseFloat(scored.trailingStop.toFixed(2)),
              trailingStopPct: parseFloat(scored.trailingStopPct.toFixed(1)),
              vs50: parseFloat(scored.vs50.toFixed(2)),
              vs200: parseFloat(scored.vs200.toFixed(2)),
              w52pos: scored.w52pos,
              relativeStrength: parseFloat(scored.relativeStrength.toFixed(2)),
              reasons: scored.reasons,
              steps: scored.steps,
              trendBreak: scored.trendBreak?.breakout || 'none'
            };
          } catch (err) {
            errors.push({ symbol: stock.s, error: err.message });
            return null;
          }
        })
      );

      batchResults.forEach(r => {
        if (r.status === 'fulfilled' && r.value) results.push(r.value);
      });

      // Small delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < stocks.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // Step 4: Sort results by score (v3/v4 style — simple score-based ranking)
    results.sort((a, b) => {
      const sortKey = portfolioMode === 'defensive' ? 'defensiveScore' : 'totalScore';
      return b[sortKey] - a[sortKey];
    });

    // Step 5: Save scan to MongoDB
    let scanId = null;
    if (saveToDB) {
      try {
        const saved = await saveScan({
          regime,
          regimeData,
          results,
          portfolioMode
        });
        scanId = saved.id;
      } catch (dbErr) {
        console.error('Failed to save scan to DB:', dbErr.message);
      }
    }

    // Step 6: Return response
    return res.status(200).json({
      success: true,
      scanId,
      timestamp: new Date().toISOString(),
      regime: regimeData,
      portfolioMode,
      totalScanned: stocks.length,
      totalResults: results.length,
      totalErrors: errors.length,
      results,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (err) {
    console.error('Scan error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};
