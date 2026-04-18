// ================================================================
// TECHNICAL INDICATOR CALCULATIONS — ported from StockSense Pro v4
// All functions are pure: arrays in, arrays out (no side effects)
// ================================================================

function last(a) {
  return a.filter(v => v != null).slice(-1)[0];
}
function prev(a) {
  return a.filter(v => v != null).slice(-2)[0];
}
function fmt(n, d = 2) {
  return (n != null && !isNaN(n)) ? n.toFixed(d) : '—';
}

// Simple Moving Average
function calcSMA(a, p) {
  return a.map((v, i) => i < p - 1 ? null : a.slice(i - p + 1, i + 1).reduce((x, y) => x + y, 0) / p);
}

// Exponential Moving Average
function calcEMA(a, p) {
  const k = 2 / (p + 1);
  const e = Array(a.length).fill(null);
  if (a.length < p) return e;
  e[p - 1] = a.slice(0, p).reduce((x, y) => x + y) / p;
  for (let i = p; i < a.length; i++) {
    e[i] = a[i] * k + e[i - 1] * (1 - k);
  }
  return e;
}

// RSI with Wilder smoothing
function calcRSI(c, p = 14) {
  const r = Array(c.length).fill(null);
  if (c.length < p + 1) return r;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) {
    const d = c[i] - c[i - 1];
    if (d > 0) g += d; else l -= d;
  }
  let ag = g / p, al = l / p;
  r[p] = 100 - 100 / (1 + (al === 0 ? 9999 : ag / al));
  for (let i = p + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    ag = (ag * (p - 1) + (d > 0 ? d : 0)) / p;
    al = (al * (p - 1) + (d < 0 ? -d : 0)) / p;
    r[i] = 100 - 100 / (1 + (al === 0 ? 9999 : ag / al));
  }
  return r;
}

// MACD (12, 26, 9)
function calcMACD(c) {
  const e12 = calcEMA(c, 12), e26 = calcEMA(c, 26);
  const m = e12.map((v, i) => (v != null && e26[i] != null) ? v - e26[i] : null);
  const vals = m.filter(v => v != null);
  if (vals.length < 9) return { macd: m, signal: Array(c.length).fill(null), hist: Array(c.length).fill(null) };
  const sig = calcEMA(vals, 9);
  const sf = Array(c.length).fill(null);
  let si = 0;
  for (let i = 0; i < m.length; i++) {
    if (m[i] != null) { sf[i] = sig[si] || null; si++; }
  }
  const h = m.map((v, i) => (v != null && sf[i] != null) ? v - sf[i] : null);
  return { macd: m, signal: sf, hist: h };
}

// Bollinger Bands (20, 2)
function calcBB(c, p = 20) {
  const s = calcSMA(c, p), u = [], l = [];
  for (let i = 0; i < c.length; i++) {
    if (!s[i]) { u.push(null); l.push(null); continue; }
    const sl = c.slice(i - p + 1, i + 1);
    const std = Math.sqrt(sl.reduce((a, b) => a + Math.pow(b - s[i], 2), 0) / p);
    u.push(s[i] + 2 * std);
    l.push(s[i] - 2 * std);
  }
  return { upper: u, lower: l, middle: s };
}

// Average True Range (default period=10 for SuperTrend)
function calcATR(highs, lows, closes, period = 10) {
  const tr = [];
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) { tr.push(highs[i] - lows[i]); continue; }
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const atr = Array(closes.length).fill(null);
  if (tr.length < period) return atr;
  atr[period - 1] = tr.slice(0, period).reduce((a, b) => a + b) / period;
  for (let i = period; i < tr.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }
  return atr;
}

// SuperTrend (ATR-based, period=10, multiplier=3)
function calcSuperTrend(highs, lows, closes, period = 10, mult = 3) {
  const atr = calcATR(highs, lows, closes, period);
  const n = closes.length;
  const st = Array(n).fill(null);   // +1=bullish(green), -1=bearish(red)
  const stVal = Array(n).fill(null);
  let upperBand, lowerBand;
  for (let i = period - 1; i < n; i++) {
    if (atr[i] == null) continue;
    const mid = (highs[i] + lows[i]) / 2;
    let ub = mid + mult * atr[i], lb = mid - mult * atr[i];
    if (i > period - 1 && stVal[i - 1] != null) {
      if (lowerBand != null && closes[i - 1] > lowerBand) lb = Math.max(lb, lowerBand);
      if (upperBand != null && closes[i - 1] < upperBand) ub = Math.min(ub, upperBand);
    }
    upperBand = ub; lowerBand = lb;
    if (i === period - 1) { st[i] = closes[i] > ub ? 1 : -1; stVal[i] = st[i] === 1 ? lb : ub; continue; }
    const prevSt = st[i - 1] || 1;
    if (prevSt === 1) {
      st[i] = closes[i] < lowerBand ? -1 : 1;
    } else {
      st[i] = closes[i] > upperBand ? 1 : -1;
    }
    stVal[i] = st[i] === 1 ? lowerBand : upperBand;
  }
  return { direction: st, value: stVal };
}

// VWAP (rolling 20-day)
function calcVWAP(closes, volumes, highs, lows) {
  const n = closes.length;
  const vwap = Array(n).fill(null);
  const lookback = Math.min(20, n);
  const start = n - lookback;
  let cumVol = 0, cumTP = 0;
  for (let i = start; i < n; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    cumVol += volumes[i] || 1;
    cumTP += tp * (volumes[i] || 1);
    vwap[i] = cumVol > 0 ? cumTP / cumVol : closes[i];
  }
  return vwap;
}

// Support & Resistance (pivot-based from swing highs/lows with 1.5% clustering)
function calcSupportResistance(highs, lows, closes) {
  const n = closes.length;
  const price = closes[n - 1];
  // Find swing highs and swing lows (5-bar pivots)
  const swingHighs = [], swingLows = [];
  for (let i = 5; i < n - 5; i++) {
    const isHigh = highs[i] >= Math.max(...highs.slice(i - 5, i)) && highs[i] >= Math.max(...highs.slice(i + 1, i + 6));
    const isLow = lows[i] <= Math.min(...lows.slice(i - 5, i)) && lows[i] <= Math.min(...lows.slice(i + 1, i + 6));
    if (isHigh) swingHighs.push(highs[i]);
    if (isLow) swingLows.push(lows[i]);
  }
  // Cluster nearby levels (within 1.5%)
  function clusterLevels(levels) {
    if (!levels.length) return [];
    levels.sort((a, b) => a - b);
    const clusters = []; let cur = [levels[0]];
    for (let i = 1; i < levels.length; i++) {
      if ((levels[i] - cur[0]) / cur[0] < 0.015) cur.push(levels[i]);
      else { clusters.push(cur.reduce((a, b) => a + b) / cur.length); cur = [levels[i]]; }
    }
    clusters.push(cur.reduce((a, b) => a + b) / cur.length);
    return clusters;
  }
  const resistanceLevels = clusterLevels(swingHighs).filter(l => l > price).slice(0, 3);
  const supportLevels = clusterLevels(swingLows).filter(l => l < price).slice(-3).reverse();
  // Fallback to simple high/low
  if (!supportLevels.length) supportLevels.push(Math.min(...lows.slice(-20)));
  if (!resistanceLevels.length) resistanceLevels.push(Math.max(...highs.slice(-20)));
  return {
    support: supportLevels,
    resistance: resistanceLevels,
    nearestSupport: supportLevels[0] || lows[n - 1],
    nearestResist: resistanceLevels[0] || highs[n - 1]
  };
}

// Trendline Breakout Detection (30-day linear regression)
function detectTrendBreak(closes, highs, lows) {
  const n = closes.length;
  if (n < 30) return { breakout: 'none', desc: 'Insufficient data' };
  const price = closes[n - 1];
  const recent = 30;
  const start = n - recent;
  function linReg(values, len) {
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < len; i++) { sx += i; sy += values[i]; sxx += i * i; sxy += i * values[i]; }
    const slope = (len * sxy - sx * sy) / (len * sxx - sx * sx);
    const intercept = (sy - slope * sx) / len;
    return { slope, intercept, endValue: intercept + slope * (len - 1) };
  }
  const lowSlice = lows.slice(start);
  const highSlice = highs.slice(start);
  const supTrend = linReg(lowSlice, recent);
  const resTrend = linReg(highSlice, recent);
  const supLineEnd = supTrend.endValue;
  const resLineEnd = resTrend.endValue;
  // Check for breakouts
  if (price > resLineEnd && closes[n - 2] <= resTrend.intercept + resTrend.slope * (recent - 2)) {
    return { breakout: 'bullish', desc: `Price broke above resistance trendline at ${fmt(resLineEnd)}`, trendSupport: supLineEnd, trendResist: resLineEnd };
  }
  if (price < supLineEnd && closes[n - 2] >= supTrend.intercept + supTrend.slope * (recent - 2)) {
    return { breakout: 'bearish', desc: `Price broke below support trendline at ${fmt(supLineEnd)}`, trendSupport: supLineEnd, trendResist: resLineEnd };
  }
  // Check if testing levels
  const distToRes = (resLineEnd - price) / price * 100;
  const distToSup = (price - supLineEnd) / price * 100;
  if (distToRes < 1) return { breakout: 'testing-resist', desc: `Testing resistance trendline at ${fmt(resLineEnd)} (${fmt(distToRes, 1)}% away)`, trendSupport: supLineEnd, trendResist: resLineEnd };
  if (distToSup < 1) return { breakout: 'testing-support', desc: `Testing support trendline at ${fmt(supLineEnd)} (${fmt(distToSup, 1)}% away)`, trendSupport: supLineEnd, trendResist: resLineEnd };
  return { breakout: 'none', desc: 'Within trendlines', trendSupport: supLineEnd, trendResist: resLineEnd };
}

// Beta calculation (60-day covariance/variance vs Nifty)
function calcBeta(stockCloses, niftyCloses) {
  if (!niftyCloses || niftyCloses.length < 2) return { beta: 1.0, correlation: 0 };
  const n = Math.min(stockCloses.length, niftyCloses.length);
  if (n < 2) return { beta: 1.0, correlation: 0 };
  // Compute returns
  const stockReturns = [], niftyReturns = [];
  for (let i = 1; i < n; i++) {
    stockReturns.push((stockCloses[stockCloses.length - n + i] - stockCloses[stockCloses.length - n + i - 1]) / stockCloses[stockCloses.length - n + i - 1]);
    niftyReturns.push((niftyCloses[niftyCloses.length - n + i] - niftyCloses[niftyCloses.length - n + i - 1]) / niftyCloses[niftyCloses.length - n + i - 1]);
  }
  // Covariance and variance
  const meanStock = stockReturns.reduce((a, b) => a + b) / stockReturns.length;
  const meanNifty = niftyReturns.reduce((a, b) => a + b) / niftyReturns.length;
  let cov = 0, varStock = 0, varNifty = 0;
  for (let i = 0; i < stockReturns.length; i++) {
    const ds = stockReturns[i] - meanStock, dn = niftyReturns[i] - meanNifty;
    cov += ds * dn; varStock += ds * ds; varNifty += dn * dn;
  }
  const beta = varNifty > 0 ? cov / varNifty : 1.0;
  const stdStock = Math.sqrt(varStock / stockReturns.length);
  const stdNifty = Math.sqrt(varNifty / niftyReturns.length);
  const correlation = stdStock > 0 && stdNifty > 0 ? cov / (Math.sqrt(varStock) * Math.sqrt(varNifty)) : 0;
  return { beta: Math.max(0, beta), correlation: Math.max(-1, Math.min(1, correlation)) };
}

// ATR-14 (for trailing stop-loss)
function calcATR14(highs, lows, closes) {
  if (closes.length < 14) return 0;
  const tr = [];
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) { tr.push(highs[i] - lows[i]); continue; }
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  return tr.slice(-14).reduce((a, b) => a + b) / 14;
}

// Resilience Score (0-100)
function computeResilienceScore(beta, correlation, sector, relativeStrength) {
  let score = 0;
  // Beta scoring (0-30 pts): lower beta = more defensive
  if (beta < 0.7) score += 30;
  else if (beta < 1.0) score += 20;
  else if (beta < 1.3) score += 10;
  // Correlation scoring (0-25 pts): lower correlation = more independent
  if (correlation < 0.4) score += 25;
  else if (correlation < 0.6) score += 15;
  else if (correlation < 0.8) score += 5;
  // Sector scoring (0-25 pts)
  if (['FMCG', 'Pharma', 'IT', 'Utilities', 'Cement'].includes(sector)) score += 25;
  else if (['Auto', 'Banking'].includes(sector)) score += 15;
  else if (['Finance', 'Telecom'].includes(sector)) score += 10;
  // Relative strength scoring (0-20 pts)
  if (relativeStrength > 0) score += 20;
  else if (relativeStrength === 0) score += 10;
  return Math.round(score);
}

function getResilienceLabel(score) {
  if (score >= 70) return { label: 'Defensive', emoji: '🛡️' };
  if (score >= 40) return { label: 'Balanced', emoji: '⚖️' };
  return { label: 'Aggressive', emoji: '🚀' };
}

module.exports = {
  last, prev, fmt,
  calcSMA, calcEMA, calcRSI, calcMACD, calcBB,
  calcATR, calcSuperTrend,
  calcVWAP,
  calcSupportResistance, detectTrendBreak,
  calcBeta, calcATR14,
  computeResilienceScore, getResilienceLabel
};
