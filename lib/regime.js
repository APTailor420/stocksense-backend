// ================================================================
// MARKET REGIME DETECTION — ported from StockSense Pro v4
// Uses Nifty 50-DMA + India VIX to classify market conditions
// ================================================================

const { calcSMA } = require('./indicators');

/**
 * Compute market regime from Nifty data.
 * @param {Object} niftyData - { price, closes, highs, lows, vix }
 * @returns {Object} regime info
 */
function computeMarketRegime(niftyData) {
  if (!niftyData) {
    return {
      regime: 'NEUTRAL',
      label: 'Market data unavailable',
      recommendation: 'Proceed with caution',
      niftyVal: '—', nifty5d: '—', niftySMA: '—', vix: '—'
    };
  }

  const n = niftyData.closes.length;
  const price = niftyData.price;
  const vix = niftyData.vix;

  // Compute 50-DMA
  const sma50 = calcSMA(niftyData.closes, 50);
  const sma50Last = sma50.filter(v => v != null).slice(-1)[0];
  const vs50 = sma50Last ? ((price - sma50Last) / sma50Last * 100) : 0;

  // Compute 5D change
  const change5d = n >= 5 ? ((niftyData.closes[n - 1] - niftyData.closes[n - 5]) / niftyData.closes[n - 5] * 100) : 0;

  // Classify regime
  let regime = 'NEUTRAL', recommendation = 'Proceed with balanced approach';

  if (vs50 > 0 && vix < 18) {
    regime = 'RISK-ON';
    recommendation = 'Market bullish and calm. Favor offensive picks with conviction';
  } else if (vs50 > 0 && vix >= 18 && vix <= 22) {
    regime = 'NEUTRAL';
    recommendation = 'Mixed signals. Balance offensive & defensive. Watch for VIX spikes.';
  } else if (vs50 > 0 && vix > 22) {
    regime = 'CAUTION';
    recommendation = 'Nifty bullish but elevated volatility. Trim high-beta, favor defensive picks';
  } else if (vs50 <= 0 && vix < 22) {
    regime = 'CAUTION';
    recommendation = 'Downtrend emerging. Trim high-beta positions, rotate to defensives';
  } else if (vs50 <= 0 && vix > 22 || change5d < -3) {
    regime = 'RISK-OFF';
    recommendation = 'High fear regime. Consider cash. Avoid offensive plays. Focus on defensive, low-beta names';
  }

  const fmt = (n, d = 2) => (n != null && !isNaN(n)) ? n.toFixed(d) : '—';

  return {
    regime,
    label: regime,
    recommendation,
    niftyVal: price,
    nifty5d: parseFloat(fmt(change5d, 1)),
    nifty5dStr: (change5d >= 0 ? '+' : '') + fmt(change5d, 1) + '%',
    niftySMA: parseFloat(fmt(vs50, 1)),
    niftySMAStr: (vs50 >= 0 ? '+' : '') + fmt(vs50, 1) + '%',
    vix: vix ? parseFloat(fmt(vix, 1)) : null,
    niftyPrice: price,
    vixPrice: vix
  };
}

module.exports = { computeMarketRegime };
