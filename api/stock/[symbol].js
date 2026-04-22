// ================================================================
// GET /api/stock/:symbol — Single stock deep analysis (v6)
// Returns full scoring breakdown with freshness detection
// ================================================================

const { UNIVERSE } = require('../../lib/universe');
const { fetchStock, fetchFundamentals, fetchMarketData, fetchMultiSourceNews } = require('../../lib/yahoo');
const { scoreStock, getSignal } = require('../../lib/scoring');
const { computeMarketRegime } = require('../../lib/regime');
const { getResilienceLabel } = require('../../lib/indicators');

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
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: 'Symbol is required' });

    const sym = symbol.toUpperCase();

    // Find stock in universe for name/sector
    const stockInfo = UNIVERSE.find(u => u.s === sym || u.s === sym.replace('&', '%26'));
    const sector = stockInfo?.sec || 'Unknown';
    const name = stockInfo?.n || sym;

    // Fetch stock data + market data + fundamentals + multi-source news in parallel
    const [stockData, marketData, fundamentals, newsData] = await Promise.all([
      fetchStock(sym),
      fetchMarketData(),
      fetchFundamentals(sym),
      fetchMultiSourceNews(sym, name)
    ]);

    if (!stockData) {
      return res.status(404).json({ error: `No data found for ${sym}.NS` });
    }

    // Market regime
    const regimeData = computeMarketRegime(marketData);
    const regime = regimeData.regime;
    const nifty60dHistory = marketData
      ? marketData.closes.slice(Math.max(0, marketData.closes.length - 60))
      : null;

    // Score with v6 freshness detection
    stockData.sector = sector;
    const scored = scoreStock(stockData, nifty60dHistory);
    const signal = getSignal(scored.totalScore, scored.beta, regime, scored.gatesPassed, scored.freshGatesPassed);
    const resilience = getResilienceLabel(scored.resilienceScore);
    const defensiveScore = Math.round(scored.totalScore * 0.5 + scored.resilienceScore * 0.5);

    // Parse fundamentals
    let fundData = null;
    if (fundamentals) {
      const fin = fundamentals.financialData || {};
      const stats = fundamentals.defaultKeyStatistics || {};
      const summary = fundamentals.summaryDetail || {};
      const profile = fundamentals.assetProfile || {};
      const reco = fundamentals.recommendationTrend?.trend?.[0] || {};

      fundData = {
        marketCap: summary.marketCap?.raw || null,
        pe: summary.trailingPE?.raw || stats.trailingEps?.raw || null,
        forwardPE: summary.forwardPE?.raw || null,
        pb: summary.priceToBook?.raw || null,
        dividendYield: summary.dividendYield?.raw || null,
        roe: fin.returnOnEquity?.raw || null,
        debtToEquity: fin.debtToEquity?.raw || null,
        currentRatio: fin.currentRatio?.raw || null,
        revenueGrowth: fin.revenueGrowth?.raw || null,
        earningsGrowth: fin.earningsGrowth?.raw || null,
        profitMargin: fin.profitMargins?.raw || null,
        operatingMargin: fin.operatingMargins?.raw || null,
        targetMeanPrice: fin.targetMeanPrice?.raw || null,
        targetHighPrice: fin.targetHighPrice?.raw || null,
        recommendationKey: fin.recommendationKey || null,
        analystOpinions: {
          strongBuy: reco.strongBuy || 0,
          buy: reco.buy || 0,
          hold: reco.hold || 0,
          sell: reco.sell || 0,
          strongSell: reco.strongSell || 0
        },
        sector: profile.sector || sector,
        industry: profile.industry || null,
        employees: profile.fullTimeEmployees || null,
        website: profile.website || null,
        description: profile.longBusinessSummary || null
      };
    }

    // Build chart OHLCV data for frontend charting
    const chartData = (stockData.ohlcv || []).map(d => ({
      t: d.t, o: parseFloat(d.o.toFixed(2)), h: parseFloat(d.h.toFixed(2)),
      l: parseFloat(d.l.toFixed(2)), c: parseFloat(d.c.toFixed(2)), v: d.v
    }));

    return res.status(200).json({
      success: true,
      symbol: sym,
      name,
      sector,
      regime: regimeData,
      chart: chartData,
      score: {
        total: scored.totalScore,
        technical: scored.techScore,
        momentum: scored.momScore,
        defensive: defensiveScore
      },
      signal: {
        label: signal.label,
        key: signal.key,
        emoji: signal.emoji,
        downgraded: signal.downgraded || false
      },
      resilience: {
        score: scored.resilienceScore,
        label: resilience.label,
        emoji: resilience.emoji
      },
      // v6 freshness data
      gatesPassed: scored.gatesPassed,
      freshGatesPassed: scored.freshGatesPassed,
      freshness: scored.freshness,
      sustainScore: scored.sustainScore,
      sustainReasons: scored.sustainReasons,
      // Standard fields
      price: scored.price,
      change: parseFloat(scored.change.toFixed(2)),
      beta: parseFloat(scored.beta.toFixed(2)),
      correlation: parseFloat(scored.correlation.toFixed(2)),
      atr14: parseFloat(scored.atr14.toFixed(2)),
      trailingStop: parseFloat(scored.trailingStop.toFixed(2)),
      trailingStopPct: parseFloat(scored.trailingStopPct.toFixed(1)),
      support: scored.support ? parseFloat(scored.support.toFixed(2)) : null,
      resistance: scored.resistance ? parseFloat(scored.resistance.toFixed(2)) : null,
      rsi: scored.rsi ? parseFloat(scored.rsi.toFixed(1)) : null,
      superTrendBull: scored.superTrendBull,
      superTrendVal: scored.superTrendVal ? parseFloat(scored.superTrendVal.toFixed(2)) : null,
      macdBull: scored.macdBull,
      vwap: scored.vwap ? parseFloat(scored.vwap.toFixed(2)) : null,
      vwapAbove: scored.vwapAbove,
      vs50: parseFloat(scored.vs50.toFixed(2)),
      vs200: parseFloat(scored.vs200.toFixed(2)),
      w52pos: scored.w52pos,
      relativeStrength: parseFloat(scored.relativeStrength.toFixed(2)),
      trendBreak: scored.trendBreak,
      bbPos: parseFloat((scored.bbPos * 100).toFixed(0)),
      reasons: scored.reasons,
      steps: scored.steps,
      // v6 multi-source news with catalyst scoring
      newsIntel: newsData,
      fundamentals: fundData
    });
  } catch (err) {
    console.error('Stock analysis error:', err);
    return res.status(500).json({ error: err.message });
  }
};
