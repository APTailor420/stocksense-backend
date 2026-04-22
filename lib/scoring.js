// ================================================================
// SCORING ENGINE — Simple Additive System (v3/v4 style)
// Each indicator adds/subtracts from base score of 50.
// No gates, no freshness — just pure technical analysis.
// ================================================================

const {
  last, prev, fmt,
  calcSMA, calcEMA, calcRSI, calcMACD, calcBB,
  calcSuperTrend, calcVWAP,
  calcSupportResistance, detectTrendBreak,
  calcBeta, calcATR14,
  computeResilienceScore, getResilienceLabel
} = require('./indicators');

// ============================================================
// MAIN SCORING FUNCTION
// ============================================================

function scoreStock(data, nifty60dHistory) {
  const { meta, closes, highs, lows, volumes, timestamps } = data;
  const n = closes.length, price = closes[n - 1];

  // Compute all indicators
  const sma20 = calcSMA(closes, 20), sma50 = calcSMA(closes, 50), sma200 = calcSMA(closes, 200);
  const ema12 = calcEMA(closes, 12), ema26 = calcEMA(closes, 26);
  const rsi = calcRSI(closes), macd = calcMACD(closes), bb = calcBB(closes);
  const superTrend = calcSuperTrend(highs, lows, closes);
  const vwap = calcVWAP(closes, volumes, highs, lows);
  const sr = calcSupportResistance(highs, lows, closes);
  const trendBreak = detectTrendBreak(closes, highs, lows);

  // Beta, Correlation, ATR, Resilience
  const betaData = calcBeta(closes, nifty60dHistory || closes);
  const atr14 = calcATR14(highs, lows, closes);
  const stock30dReturn = n >= 30 ? ((closes[n - 1] - closes[n - 30]) / closes[n - 30] * 100) : 0;
  const nifty30dReturn = nifty60dHistory && nifty60dHistory.length >= 30
    ? ((nifty60dHistory[nifty60dHistory.length - 1] - nifty60dHistory[nifty60dHistory.length - 30]) / nifty60dHistory[nifty60dHistory.length - 30] * 100)
    : stock30dReturn;
  const relativeStrength = stock30dReturn - nifty30dReturn;
  const resilienceScore = computeResilienceScore(betaData.beta, betaData.correlation, data.sector || 'Energy', relativeStrength);
  const trailingStop = price - (2 * atr14);
  const trailingStopPct = atr14 > 0 ? ((price - trailingStop) / price * 100) : 0;

  // Indicator values
  const lr = last(rsi), lm = last(macd.macd), ls = last(macd.signal), pm = prev(macd.macd), ps = prev(macd.signal);
  const l20 = last(sma20), l50 = last(sma50), l200 = last(sma200);
  const bbu = last(bb.upper), bbl = last(bb.lower), bbm = last(bb.middle);
  const stDir = last(superTrend.direction), stVal = last(superTrend.value);
  const lVwap = last(vwap);

  // Step-by-step analysis
  const steps = [];
  let techScore = 50, momScore = 50;

  // === STEP 1: RSI Analysis ===
  let rsiVerdict = 'neutral', rsiReason = '';
  if (lr < 25) { techScore += 22; rsiVerdict = 'bullish'; rsiReason = `RSI at ${fmt(lr, 1)} deeply oversold (<25). Strong bounce expected within 1-3 weeks.`; }
  else if (lr < 35) { techScore += 14; rsiVerdict = 'bullish'; rsiReason = `RSI at ${fmt(lr, 1)} in oversold zone (<35). Selling pressure exhausted — potential reversal.`; }
  else if (lr < 45) { techScore += 6; rsiVerdict = 'neutral'; rsiReason = `RSI at ${fmt(lr, 1)} approaching oversold. Sellers losing momentum.`; }
  else if (lr >= 45 && lr <= 55) { rsiVerdict = 'neutral'; rsiReason = `RSI at ${fmt(lr, 1)} neutral zone (45-55). No clear bias.`; }
  else if (lr > 55 && lr < 65) { techScore += 3; rsiVerdict = 'bullish'; rsiReason = `RSI at ${fmt(lr, 1)} healthy bullish momentum without being overbought.`; }
  else if (lr >= 65 && lr <= 75) { techScore -= 4; rsiVerdict = 'neutral'; rsiReason = `RSI at ${fmt(lr, 1)} elevated. Upside may be limited.`; }
  else { techScore -= 16; rsiVerdict = 'bearish'; rsiReason = `RSI at ${fmt(lr, 1)} overbought (>75). High pullback risk.`; }
  steps.push({ num: 1, title: 'RSI (14) Analysis', verdict: rsiVerdict, value: fmt(lr, 1), reason: rsiReason });

  // === STEP 2: SuperTrend Analysis ===
  let stVerdict = 'neutral', stReason = '';
  if (stDir === 1) {
    techScore += 12; stVerdict = 'bullish';
    stReason = `SuperTrend BULLISH (Green). Support at ₹${fmt(stVal)}. Active uptrend confirmed.`;
    const prevDir = superTrend.direction.filter(v => v != null);
    if (prevDir.length >= 2 && prevDir[prevDir.length - 2] === -1) { techScore += 8; stReason += ' Fresh bullish flip — early entry point!'; }
  } else if (stDir === -1) {
    techScore -= 10; stVerdict = 'bearish';
    stReason = `SuperTrend BEARISH (Red). Resistance at ₹${fmt(stVal)}. Downtrend active.`;
    const prevDir = superTrend.direction.filter(v => v != null);
    if (prevDir.length >= 2 && prevDir[prevDir.length - 2] === 1) { techScore -= 6; stReason += ' Fresh bearish flip — avoid.'; }
  } else { stReason = 'SuperTrend data insufficient.'; }
  steps.push({ num: 2, title: 'SuperTrend (10,3) Analysis', verdict: stVerdict, value: stDir === 1 ? 'Bullish' : 'Bearish', reason: stReason });

  // === STEP 3: VWAP Analysis ===
  let vwapVerdict = 'neutral', vwapReason = '';
  if (lVwap) {
    const vwapDiff = ((price - lVwap) / lVwap * 100);
    if (price > lVwap) {
      techScore += 8; vwapVerdict = 'bullish';
      vwapReason = `Price ${fmt(vwapDiff, 1)}% above VWAP (₹${fmt(lVwap)}). Institutional buyers in control.`;
    } else {
      techScore -= 6; vwapVerdict = 'bearish';
      vwapReason = `Price ${fmt(Math.abs(vwapDiff), 1)}% below VWAP (₹${fmt(lVwap)}). Institutional selling pressure.`;
    }
  } else { vwapReason = 'VWAP data insufficient.'; }
  steps.push({ num: 3, title: 'VWAP Analysis', verdict: vwapVerdict, value: lVwap ? '₹' + fmt(lVwap) : 'N/A', reason: vwapReason });

  // === STEP 4: MACD Analysis ===
  let macdVerdict = 'neutral', macdReason = '';
  if (lm != null && ls != null) {
    const hist = last(macd.hist);
    if (lm > ls && pm != null && ps != null && pm <= ps) {
      techScore += 16; macdVerdict = 'bullish';
      macdReason = `Fresh MACD bullish crossover! MACD (${fmt(lm, 2)}) crossed above signal (${fmt(ls, 2)}). Strongest buy signal.`;
    } else if (lm > ls) {
      techScore += 7; macdVerdict = 'bullish';
      macdReason = `MACD (${fmt(lm, 2)}) above signal (${fmt(ls, 2)}). Bullish momentum. Histogram: ${fmt(hist, 2)}.`;
    } else if (lm < ls && pm != null && ps != null && pm >= ps) {
      techScore -= 14; macdVerdict = 'bearish';
      macdReason = `Fresh MACD bearish crossover! Momentum shifting downward — avoid.`;
    } else if (lm < ls) {
      techScore -= 6; macdVerdict = 'bearish';
      macdReason = `MACD (${fmt(lm, 2)}) below signal (${fmt(ls, 2)}). Bearish momentum.`;
    }
    if (lm > 0 && macdVerdict === 'bullish') { techScore += 4; macdReason += ' MACD above zero — overall bullish trend.'; }
  } else { macdReason = 'Insufficient MACD data.'; }
  steps.push({ num: 4, title: 'MACD (12,26,9) Analysis', verdict: macdVerdict, value: lm > ls ? 'Bullish' : 'Bearish', reason: macdReason });

  // === STEP 5: Moving Average Analysis ===
  let maVerdict = 'neutral', maReason = '';
  let maBullCount = 0;
  if (l20 && price > l20) maBullCount++;
  if (l50 && price > l50) maBullCount++;
  if (l200 && price > l200) maBullCount++;
  if (l50) { if (price > l50) techScore += 8; else techScore -= 8; }
  if (l200) { if (price > l200) techScore += 6; else techScore -= 6; }
  // Golden/Death Cross
  let crossNote = '';
  if (l50 && l200) {
    const p50 = prev(sma50), p200 = prev(sma200);
    if (l50 > l200 && p50 && p200 && p50 <= p200) { techScore += 12; crossNote = ' GOLDEN CROSS detected (50MA crossed above 200MA)!'; }
    if (l50 < l200 && p50 && p200 && p50 >= p200) { techScore -= 12; crossNote = ' DEATH CROSS detected (50MA crossed below 200MA)!'; }
  }
  if (maBullCount >= 3) { maVerdict = 'bullish'; maReason = `Above ALL key MAs (20/50/200). Strong confirmed uptrend.${crossNote}`; }
  else if (maBullCount === 2) { maVerdict = 'bullish'; maReason = `Above 2/3 key MAs. Short-to-medium trend bullish.${crossNote}`; }
  else if (maBullCount === 1) { maVerdict = 'neutral'; maReason = `Above only 1/3 MAs. Mixed signals.${crossNote}`; }
  else { maVerdict = 'bearish'; maReason = `Below ALL key MAs. Strong downtrend.${crossNote}`; }
  steps.push({ num: 5, title: 'Moving Averages (20/50/200)', verdict: maVerdict, value: `${maBullCount}/3 Bullish`, reason: maReason });

  // === STEP 6: Support & Resistance ===
  let srVerdict = 'neutral', srReason = '';
  const distToSupport = ((price - sr.nearestSupport) / price * 100);
  const distToResist = ((sr.nearestResist - price) / price * 100);
  if (distToSupport < 2) {
    techScore += 10; srVerdict = 'bullish';
    srReason = `Near support ₹${fmt(sr.nearestSupport)} (${fmt(distToSupport, 1)}% away). Strong buy zone — resistance at ₹${fmt(sr.nearestResist)} gives ${fmt(distToResist, 1)}% upside.`;
  } else if (distToResist < 2) {
    techScore -= 6; srVerdict = 'bearish';
    srReason = `Near resistance ₹${fmt(sr.nearestResist)} (${fmt(distToResist, 1)}% away). Upside capped. Wait for breakout or pullback.`;
  } else {
    srReason = `Between S:₹${fmt(sr.nearestSupport)} R:₹${fmt(sr.nearestResist)}. ${fmt(distToResist, 1)}% to resistance, ${fmt(distToSupport, 1)}% above support.`;
    if (distToResist > distToSupport) { srVerdict = 'bullish'; techScore += 4; } else { srVerdict = 'neutral'; }
  }
  steps.push({ num: 6, title: 'Support & Resistance', verdict: srVerdict, value: `S:₹${fmt(sr.nearestSupport)} R:₹${fmt(sr.nearestResist)}`, reason: srReason });

  // === STEP 7: Trendline Breakout ===
  let tbVerdict = 'neutral', tbReason = '';
  if (trendBreak.breakout === 'bullish') { techScore += 14; tbVerdict = 'bullish'; tbReason = `BULLISH BREAKOUT! ${trendBreak.desc}. High-conviction buy signal.`; }
  else if (trendBreak.breakout === 'bearish') { techScore -= 12; tbVerdict = 'bearish'; tbReason = `BEARISH BREAKDOWN! ${trendBreak.desc}. Avoid until recovery.`; }
  else if (trendBreak.breakout === 'testing-resist') { techScore += 4; tbVerdict = 'neutral'; tbReason = `${trendBreak.desc}. Watch for breakout with volume.`; }
  else if (trendBreak.breakout === 'testing-support') { techScore -= 3; tbVerdict = 'neutral'; tbReason = `${trendBreak.desc}. Place stop-loss below support.`; }
  else { tbReason = `Within trendlines. S:₹${fmt(trendBreak.trendSupport)} R:₹${fmt(trendBreak.trendResist)}.`; }
  steps.push({ num: 7, title: 'Trendline Breakout', verdict: tbVerdict, value: trendBreak.breakout === 'none' ? 'No Breakout' : trendBreak.breakout, reason: tbReason });

  // === STEP 8: Bollinger Bands ===
  let bbVerdict = 'neutral', bbReason = '';
  if (bbu && bbl) {
    const bbPos = (price - bbl) / (bbu - bbl);
    const bbWidth = ((bbu - bbl) / bbm * 100);
    if (bbPos < 0.1) { techScore += 10; bbVerdict = 'bullish'; bbReason = `At lower BB (BB% ${fmt(bbPos * 100, 0)}%). Mean reversion expected — strong buy zone.`; }
    else if (bbPos < 0.25) { techScore += 5; bbVerdict = 'bullish'; bbReason = `Near lower BB (BB% ${fmt(bbPos * 100, 0)}%). Good entry for bounce.`; }
    else if (bbPos > 0.9) { techScore -= 8; bbVerdict = 'bearish'; bbReason = `At upper BB (BB% ${fmt(bbPos * 100, 0)}%). Overbought — pullback likely.`; }
    else { bbReason = `Within BB (BB% ${fmt(bbPos * 100, 0)}%). Normal range.`; }
    if (bbWidth < 8) { bbReason += ` Bollinger Squeeze (${fmt(bbWidth, 1)}%) — big move imminent.`; }
  }
  steps.push({ num: 8, title: 'Bollinger Bands (20,2)', verdict: bbVerdict, value: bbu ? `BB% ${fmt((price - bbl) / (bbu - bbl) * 100, 0)}%` : 'N/A', reason: bbReason });

  // === STEP 9: Momentum & Volume ===
  let momReason = '';
  if (n >= 5) {
    const r1w = (closes[n - 1] - closes[n - 5]) / closes[n - 5] * 100;
    if (r1w > 5) { momScore += 14; momReason += `Strong 1-week +${fmt(r1w, 1)}%. `; }
    else if (r1w > 2) { momScore += 7; momReason += `Positive 1-week +${fmt(r1w, 1)}%. `; }
    else if (r1w < -5) { momScore -= 12; momReason += `Weak 1-week ${fmt(r1w, 1)}%. `; }
    else if (r1w < -2) { momScore -= 5; momReason += `Negative 1-week ${fmt(r1w, 1)}%. `; }
    else { momReason += `Flat 1-week ${fmt(r1w, 1)}%. `; }
  }
  if (n >= 21) {
    const r1m = (closes[n - 1] - closes[n - 21]) / closes[n - 21] * 100;
    if (r1m > 10) { momScore += 12; momReason += `Strong 1-month +${fmt(r1m, 1)}%. `; }
    else if (r1m > 4) { momScore += 6; momReason += `Positive 1-month +${fmt(r1m, 1)}%. `; }
    else if (r1m < -10) { momScore -= 12; momReason += `Sharp 1-month ${fmt(r1m, 1)}%. `; }
    else if (r1m < -4) { momScore -= 5; momReason += `Negative 1-month ${fmt(r1m, 1)}%. `; }
  }
  // Volume
  let volNote = '';
  if (volumes.length >= 10) {
    const avgV = volumes.slice(-10).reduce((a, b) => a + b) / 10;
    const curV = volumes[volumes.length - 1];
    if (avgV > 0 && curV / avgV > 2) { momScore += 10; volNote = `Volume surge ${fmt(curV / avgV, 1)}x avg — strong conviction. `; }
    else if (avgV > 0 && curV / avgV > 1.5) { momScore += 4; volNote = `Above-avg volume ${fmt(curV / avgV, 1)}x. `; }
    else if (avgV > 0 && curV / avgV < 0.5) { momScore -= 3; volNote = `Low volume — weak conviction. `; }
  }
  // 52-week position
  const h52 = meta.fiftyTwoWeekHigh || Math.max(...highs);
  const l52 = meta.fiftyTwoWeekLow || Math.min(...lows);
  const w52pos = (h52 - l52) > 0 ? (price - l52) / (h52 - l52) : 0.5;
  if (w52pos < 0.15) { momScore += 14; momReason += 'Near 52W low — value zone. '; }
  else if (w52pos < 0.3) { momScore += 7; momReason += 'Lower 52W range. '; }
  else if (w52pos > 0.92) { momScore += 5; momReason += 'Near 52W high — strong momentum. '; }

  steps.push({
    num: 9, title: 'Momentum & Volume',
    verdict: momScore >= 55 ? 'bullish' : momScore <= 45 ? 'bearish' : 'neutral',
    value: `Score: ${Math.max(0, Math.min(100, momScore))}`,
    reason: (momReason + volNote) || 'No significant momentum signals.'
  });

  // ============================================================
  // FINAL SCORE — Simple weighted average
  // ============================================================
  techScore = Math.max(0, Math.min(100, Math.round(techScore)));
  momScore = Math.max(0, Math.min(100, Math.round(momScore)));
  const totalScore = Math.round(techScore * 0.55 + momScore * 0.45);

  const vs50 = l50 ? ((price - l50) / l50 * 100) : 0;
  const vs200 = l200 ? ((price - l200) / l200 * 100) : 0;
  const change = n >= 2 ? ((closes[n - 1] - closes[n - 2]) / closes[n - 2] * 100) : 0;

  // Build reasons from bullish steps
  const reasons = steps.filter(s => s.verdict === 'bullish').map(s => s.title + ': ' + s.value);
  if (!reasons.length) reasons.push('No strong bullish signals');

  return {
    techScore, momScore, totalScore, reasons, steps,
    gatesPassed: 0, freshGatesPassed: 0,
    price, change, vs50, vs200, rsi: lr, w52pos: Math.round(w52pos * 100),
    macdBull: lm > ls,
    superTrendBull: stDir === 1, superTrendVal: stVal,
    vwap: lVwap, vwapAbove: price > (lVwap || 0),
    support: sr.nearestSupport, resistance: sr.nearestResist, sr,
    trendBreak,
    bbPos: bbu && bbl ? (price - bbl) / (bbu - bbl) : 0.5,
    beta: betaData.beta, correlation: betaData.correlation, atr14,
    trailingStop, trailingStopPct,
    relativeStrength, stock30dReturn, nifty30dReturn,
    resilienceScore
  };
}

// ============================================================
// SIGNAL CLASSIFICATION — Simple score-based (v3/v4)
// ============================================================
function getSignal(s, beta, regime) {
  let base;
  if (s >= 75) base = { label: 'Strong Buy', key: 'strong-buy', emoji: '🚀' };
  else if (s >= 63) base = { label: 'Buy', key: 'buy', emoji: '✅' };
  else if (s >= 50) base = { label: 'Hold', key: 'hold', emoji: '⏳' };
  else base = { label: 'Avoid', key: 'avoid', emoji: '🚫' };

  if (!regime) return base;
  if (regime === 'CAUTION') {
    if (base.key === 'strong-buy' && beta > 1.0) return { label: 'Buy', key: 'buy', emoji: '✅', downgraded: true };
    if (base.key === 'buy' && beta > 1.2) return { label: 'Hold', key: 'hold', emoji: '⏳', downgraded: true };
  }
  if (regime === 'RISK-OFF') {
    if (base.key === 'strong-buy') return { label: 'Buy', key: 'buy', emoji: '✅', downgraded: true };
    if (base.key === 'buy') return { label: 'Hold', key: 'hold', emoji: '⏳', downgraded: true };
  }
  return base;
}

module.exports = { scoreStock, getSignal };
