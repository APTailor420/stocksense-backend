// ================================================================
// STRICT SCORING ENGINE v2 — Gate-Based Multi-Confirmation System
// A stock must pass MULTIPLE confirmation gates to qualify.
// 9-step analysis + BTST (Buy Today Sell Tomorrow) scoring
// ================================================================

const {
  last, prev, fmt,
  calcSMA, calcEMA, calcRSI, calcMACD, calcBB,
  calcSuperTrend, calcVWAP,
  calcSupportResistance, detectTrendBreak,
  calcBeta, calcATR14,
  computeResilienceScore, getResilienceLabel
} = require('./indicators');

/**
 * Score a stock using strict gate-based confirmation.
 * Each indicator is a GATE — pass or fail. A stock needs multiple
 * gates passing simultaneously to qualify as Buy/Strong Buy.
 *
 * GATES (9 total):
 *  1. RSI Gate: RSI < 50 (room to run, not overbought)
 *  2. SuperTrend Gate: SuperTrend bullish (green)
 *  3. VWAP Gate: Price above VWAP
 *  4. MACD Gate: MACD bullish (above signal line)
 *  5. Moving Average Gate: Price above at least 2 of 3 MAs (20/50/200)
 *  6. Resistance Breakout Gate: Just broke or near breaking resistance
 *  7. Trendline Gate: Bullish breakout or testing resistance
 *  8. Bollinger Gate: Not at upper band (room to grow)
 *  9. Momentum Gate: Positive recent momentum + volume
 *
 * Signal Thresholds (gate-based):
 *   Strong Buy: 7+ gates AND score >= 75
 *   Buy:        5+ gates AND score >= 63
 *   Hold:       3+ gates OR score >= 45
 *   Avoid:      everything else
 */
function scoreStock(data, nifty60dHistory) {
  const { meta, closes, highs, lows, volumes } = data;
  const n = closes.length, price = closes[n - 1];

  // Compute all indicators
  const sma10 = calcSMA(closes, 10), sma20 = calcSMA(closes, 20);
  const sma50 = calcSMA(closes, 50), sma200 = calcSMA(closes, 200);
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
  const l10 = last(sma10), l20 = last(sma20), l50 = last(sma50), l200 = last(sma200);
  const bbu = last(bb.upper), bbl = last(bb.lower), bbm = last(bb.middle);
  const stDir = last(superTrend.direction), stVal = last(superTrend.value);
  const lVwap = last(vwap);

  // Volume analysis
  let volRatio = 1;
  if (volumes.length >= 10) {
    const avgV = volumes.slice(-10).reduce((a, b) => a + b) / 10;
    const curV = volumes[volumes.length - 1];
    volRatio = avgV > 0 ? curV / avgV : 1;
  }

  // 52-week position
  const h52 = meta.fiftyTwoWeekHigh || Math.max(...highs);
  const l52 = meta.fiftyTwoWeekLow || Math.min(...lows);
  const w52pos = (h52 - l52) > 0 ? (price - l52) / (h52 - l52) : 0.5;

  // ============================================================
  // GATE SYSTEM — Each gate is pass/fail with a quality score
  // ============================================================
  const steps = [];
  let techScore = 50, momScore = 50;
  let gatesPassed = 0;
  const gateResults = [];

  // === GATE 1: RSI — Must be below 50 (room to run) ===
  let g1 = false, rsiVerdict = 'neutral', rsiReason = '';
  if (lr < 25) {
    g1 = true; techScore += 12; rsiVerdict = 'bullish';
    rsiReason = `RSI at ${fmt(lr, 1)} is deeply oversold (<25). GATE PASS ✅ Extreme bounce potential.`;
  } else if (lr < 35) {
    g1 = true; techScore += 8; rsiVerdict = 'bullish';
    rsiReason = `RSI at ${fmt(lr, 1)} is oversold (<35). GATE PASS ✅ Strong recovery setup.`;
  } else if (lr < 50) {
    g1 = true; techScore += 3; rsiVerdict = 'bullish';
    rsiReason = `RSI at ${fmt(lr, 1)} is below 50. GATE PASS ✅ Room to run before overbought.`;
  } else if (lr <= 60) {
    rsiVerdict = 'neutral';
    rsiReason = `RSI at ${fmt(lr, 1)} is above 50. GATE FAIL ❌ Already in bullish territory — limited upside.`;
  } else if (lr <= 75) {
    techScore -= 6; rsiVerdict = 'bearish';
    rsiReason = `RSI at ${fmt(lr, 1)} is elevated. GATE FAIL ❌ Overbought risk — pullback likely.`;
  } else {
    techScore -= 15; rsiVerdict = 'bearish';
    rsiReason = `RSI at ${fmt(lr, 1)} is overbought (>75). GATE FAIL ❌ High risk of sharp pullback.`;
  }
  if (g1) gatesPassed++;
  gateResults.push(g1);
  steps.push({ num: 1, title: 'RSI Gate (<50)', verdict: rsiVerdict, value: fmt(lr, 1), reason: rsiReason, gate: g1 });

  // === GATE 2: SuperTrend — Must be bullish (green) ===
  let g2 = false, stVerdict = 'neutral', stReason = '';
  if (stDir === 1) {
    g2 = true; stVerdict = 'bullish';
    stReason = `SuperTrend BULLISH (Green). GATE PASS ✅ Support at ₹${fmt(stVal)}.`;
    const prevDir = superTrend.direction.filter(v => v != null);
    if (prevDir.length >= 2 && prevDir[prevDir.length - 2] === -1) {
      techScore += 10; stReason += ' 🔥 FRESH bullish flip — just turned green!';
    } else {
      techScore += 5;
    }
  } else if (stDir === -1) {
    techScore -= 10; stVerdict = 'bearish';
    stReason = `SuperTrend BEARISH (Red). GATE FAIL ❌ Resistance at ₹${fmt(stVal)}. Trend is against you.`;
    const prevDir = superTrend.direction.filter(v => v != null);
    if (prevDir.length >= 2 && prevDir[prevDir.length - 2] === 1) { techScore -= 5; stReason += ' Fresh bearish flip — just turned red!'; }
  } else { stReason = 'SuperTrend data insufficient. GATE FAIL ❌'; }
  if (g2) gatesPassed++;
  gateResults.push(g2);
  steps.push({ num: 2, title: 'SuperTrend Gate (Bullish)', verdict: stVerdict, value: stDir === 1 ? 'Bullish ✅' : 'Bearish ❌', reason: stReason, gate: g2 });

  // === GATE 3: VWAP — Price must be above VWAP ===
  let g3 = false, vwapVerdict = 'neutral', vwapReason = '';
  if (lVwap) {
    const vwapDiff = ((price - lVwap) / lVwap * 100);
    if (price > lVwap) {
      g3 = true; techScore += 5; vwapVerdict = 'bullish';
      vwapReason = `Price ${fmt(vwapDiff, 1)}% above VWAP (₹${fmt(lVwap)}). GATE PASS ✅ Institutional buying support.`;
      if (vwapDiff > 2) { techScore += 2; vwapReason += ' Strong above VWAP.'; }
    } else {
      techScore -= 6; vwapVerdict = 'bearish';
      vwapReason = `Price ${fmt(Math.abs(vwapDiff), 1)}% below VWAP (₹${fmt(lVwap)}). GATE FAIL ❌ Institutional selling pressure.`;
    }
  } else { vwapReason = 'VWAP data insufficient. GATE FAIL ❌'; }
  if (g3) gatesPassed++;
  gateResults.push(g3);
  steps.push({ num: 3, title: 'VWAP Gate (Above)', verdict: vwapVerdict, value: lVwap ? (price > lVwap ? 'Above ✅' : 'Below ❌') : 'N/A', reason: vwapReason, gate: g3 });

  // === GATE 4: MACD — Must be bullish ===
  let g4 = false, macdVerdict = 'neutral', macdReason = '';
  if (lm != null && ls != null) {
    const hist = last(macd.hist);
    if (lm > ls && pm != null && ps != null && pm <= ps) {
      g4 = true; techScore += 10; macdVerdict = 'bullish';
      macdReason = `🔥 Fresh MACD bullish crossover! GATE PASS ✅ Histogram: ${fmt(hist, 2)}. Strongest buy signal.`;
    } else if (lm > ls) {
      g4 = true; techScore += 4; macdVerdict = 'bullish';
      macdReason = `MACD above signal line. GATE PASS ✅ Bullish momentum. Histogram: ${fmt(hist, 2)}.`;
    } else if (lm < ls && pm != null && ps != null && pm >= ps) {
      techScore -= 12; macdVerdict = 'bearish';
      macdReason = `Fresh MACD bearish crossover! GATE FAIL ❌ Momentum turning sharply negative.`;
    } else if (lm < ls) {
      techScore -= 6; macdVerdict = 'bearish';
      macdReason = `MACD below signal. GATE FAIL ❌ Bearish momentum.`;
    }
    if (lm > 0 && g4) { techScore += 2; macdReason += ' MACD above zero confirms trend.'; }
    if (lm < 0 && !g4) { techScore -= 2; macdReason += ' MACD below zero confirms downtrend.'; }
  } else { macdReason = 'Insufficient MACD data. GATE FAIL ❌'; }
  if (g4) gatesPassed++;
  gateResults.push(g4);
  steps.push({ num: 4, title: 'MACD Gate (Bullish)', verdict: macdVerdict, value: g4 ? 'Bullish ✅' : 'Bearish ❌', reason: macdReason, gate: g4 });

  // === GATE 5: Moving Average — Price above at least 2 of 3 MAs (10/50/200) ===
  let g5 = false, maVerdict = 'neutral', maReason = '';
  let maBullCount = 0;
  if (l10 && price > l10) maBullCount++;
  if (l50 && price > l50) maBullCount++;
  if (l200 && price > l200) maBullCount++;

  if (maBullCount >= 3) { g5 = true; techScore += 10; }
  else if (maBullCount === 2) { g5 = true; techScore += 3; }
  else if (maBullCount === 1) { techScore -= 5; }
  else { techScore -= 12; }

  // Golden/Death Cross (10 crossing above 50, or 50 crossing above 200)
  let crossNote = '';
  if (l10 && l50) {
    const p10 = prev(sma10), p50v = prev(sma50);
    if (l10 > l50 && p10 && p50v && p10 <= p50v) { techScore += 5; crossNote = ' 🔥 SMA10/50 GOLDEN CROSS!'; }
    if (l10 < l50 && p10 && p50v && p10 >= p50v) { techScore -= 6; crossNote = ' ☠️ SMA10/50 DEATH CROSS!'; }
  }
  if (l50 && l200) {
    const p50 = prev(sma50), p200 = prev(sma200);
    if (l50 > l200 && p50 && p200 && p50 <= p200) { techScore += 8; crossNote += ' 🔥 SMA50/200 GOLDEN CROSS!'; }
    if (l50 < l200 && p50 && p200 && p50 >= p200) { techScore -= 10; crossNote += ' ☠️ SMA50/200 DEATH CROSS!'; }
  }

  if (maBullCount >= 3) { maVerdict = 'bullish'; maReason = `Price above ALL MAs (10/50/200). GATE PASS ✅ Strong uptrend.${crossNote}`; }
  else if (maBullCount === 2) { maVerdict = 'bullish'; maReason = `Price above 2 of 3 MAs. GATE PASS ✅ Moderate uptrend.${crossNote}`; }
  else if (maBullCount === 1) { maVerdict = 'bearish'; maReason = `Only 1 of 3 MAs bullish. GATE FAIL ❌ Weak structure.${crossNote}`; }
  else { maVerdict = 'bearish'; maReason = `Price below ALL MAs. GATE FAIL ❌ Clear downtrend.${crossNote}`; }
  if (g5) gatesPassed++;
  gateResults.push(g5);
  steps.push({ num: 5, title: 'MA Gate (10/50/200)', verdict: maVerdict, value: `${maBullCount}/3 Bullish`, reason: maReason, gate: g5 });

  // === GATE 6: Resistance Breakout — Just broke or near breaking resistance ===
  let g6 = false, srVerdict = 'neutral', srReason = '';
  const distToSupport = ((price - sr.nearestSupport) / price * 100);
  const distToResist = ((sr.nearestResist - price) / price * 100);

  // Check if price just broke above resistance (within last 3 days)
  let justBrokeResistance = false;
  if (n >= 3) {
    for (let i = Math.max(0, n - 3); i < n - 1; i++) {
      if (closes[i] < sr.nearestResist && price > sr.nearestResist) {
        justBrokeResistance = true;
        break;
      }
    }
  }

  if (justBrokeResistance) {
    g6 = true; techScore += 8; srVerdict = 'bullish';
    srReason = `🔥 JUST BROKE RESISTANCE at ₹${fmt(sr.nearestResist)}! GATE PASS ✅ Breakout confirmed. Next target higher.`;
  } else if (distToResist < 1.5) {
    g6 = true; techScore += 3; srVerdict = 'bullish';
    srReason = `Testing resistance ₹${fmt(sr.nearestResist)} (${fmt(distToResist, 1)}% away). GATE PASS ✅ Breakout imminent.`;
  } else if (distToSupport < 2 && distToResist > 5) {
    g6 = true; techScore += 4; srVerdict = 'bullish';
    srReason = `Near support ₹${fmt(sr.nearestSupport)} with big upside to ₹${fmt(sr.nearestResist)}. GATE PASS ✅ Great risk/reward.`;
  } else if (distToResist < 3) {
    techScore -= 3; srVerdict = 'neutral';
    srReason = `Resistance ₹${fmt(sr.nearestResist)} is close (${fmt(distToResist, 1)}%). GATE FAIL ❌ Upside capped.`;
  } else {
    srReason = `Between S:₹${fmt(sr.nearestSupport)} and R:₹${fmt(sr.nearestResist)}. GATE FAIL ❌ No breakout signal.`;
  }
  if (g6) gatesPassed++;
  gateResults.push(g6);
  steps.push({ num: 6, title: 'Resistance Breakout Gate', verdict: srVerdict, value: justBrokeResistance ? '🔥 Breakout!' : `R:₹${fmt(sr.nearestResist)}`, reason: srReason, gate: g6 });

  // === GATE 7: Trendline Breakout ===
  let g7 = false, tbVerdict = 'neutral', tbReason = '';
  if (trendBreak.breakout === 'bullish') {
    g7 = true; techScore += 8; tbVerdict = 'bullish';
    tbReason = `🔥 BULLISH TRENDLINE BREAKOUT! GATE PASS ✅ ${trendBreak.desc}.`;
  } else if (trendBreak.breakout === 'testing-resist') {
    g7 = true; techScore += 2; tbVerdict = 'bullish';
    tbReason = `Testing trendline resistance. GATE PASS ✅ ${trendBreak.desc}. Breakout watch.`;
  } else if (trendBreak.breakout === 'bearish') {
    techScore -= 10; tbVerdict = 'bearish';
    tbReason = `BEARISH TRENDLINE BREAKDOWN! GATE FAIL ❌ ${trendBreak.desc}.`;
  } else if (trendBreak.breakout === 'testing-support') {
    techScore -= 3; tbVerdict = 'bearish';
    tbReason = `Testing trendline support. GATE FAIL ❌ ${trendBreak.desc}. Risk of breakdown.`;
  } else {
    tbReason = `Within trendlines. GATE FAIL ❌ No breakout. S:₹${fmt(trendBreak.trendSupport)} R:₹${fmt(trendBreak.trendResist)}.`;
  }
  if (g7) gatesPassed++;
  gateResults.push(g7);
  steps.push({ num: 7, title: 'Trendline Gate', verdict: tbVerdict, value: g7 ? 'Breakout ✅' : 'No Breakout ❌', reason: tbReason, gate: g7 });

  // === GATE 8: Bollinger Bands — Must NOT be at upper band ===
  let g8 = false, bbVerdict = 'neutral', bbReason = '';
  if (bbu && bbl) {
    const bbPos = (price - bbl) / (bbu - bbl);
    const bbWidth = ((bbu - bbl) / bbm * 100);
    if (bbPos < 0.15) {
      g8 = true; techScore += 7; bbVerdict = 'bullish';
      bbReason = `At lower BB (BB% ${fmt(bbPos * 100, 0)}%). GATE PASS ✅ Strong mean-reversion bounce zone.`;
    } else if (bbPos < 0.5) {
      g8 = true; techScore += 3; bbVerdict = 'bullish';
      bbReason = `Lower half of BB (BB% ${fmt(bbPos * 100, 0)}%). GATE PASS ✅ Room to grow to upper band.`;
    } else if (bbPos <= 0.75) {
      bbReason = `Mid-upper BB (BB% ${fmt(bbPos * 100, 0)}%). GATE FAIL ❌ Limited room.`;
    } else if (bbPos > 0.9) {
      techScore -= 8; bbVerdict = 'bearish';
      bbReason = `At upper BB (BB% ${fmt(bbPos * 100, 0)}%). GATE FAIL ❌ Overbought — pullback imminent.`;
    } else {
      techScore -= 3; bbVerdict = 'neutral';
      bbReason = `Near upper BB (BB% ${fmt(bbPos * 100, 0)}%). GATE FAIL ❌ Extended.`;
    }
    if (bbWidth < 8) { bbReason += ` ⚡ Bollinger Squeeze (${fmt(bbWidth, 1)}%) — explosive move coming.`; }
  }
  if (g8) gatesPassed++;
  gateResults.push(g8);
  steps.push({ num: 8, title: 'Bollinger Gate (Room to Grow)', verdict: bbVerdict, value: bbu ? `BB%: ${fmt((price - bbl) / (bbu - bbl) * 100, 0)}%` : 'N/A', reason: bbReason, gate: g8 });

  // === GATE 9: Momentum & Volume — Positive momentum + decent volume ===
  let g9 = false, momReason = '';
  let momBullPoints = 0;

  if (n >= 5) {
    const r1w = (closes[n - 1] - closes[n - 5]) / closes[n - 5] * 100;
    if (r1w > 5) { momScore += 8; momBullPoints++; momReason += `Strong 1W +${fmt(r1w, 1)}%. `; }
    else if (r1w > 2) { momScore += 4; momBullPoints++; momReason += `Positive 1W +${fmt(r1w, 1)}%. `; }
    else if (r1w < -5) { momScore -= 10; momReason += `Weak 1W ${fmt(r1w, 1)}%. `; }
    else if (r1w < -2) { momScore -= 5; momReason += `Negative 1W ${fmt(r1w, 1)}%. `; }
    else { momReason += `Flat 1W ${fmt(r1w, 1)}%. `; }
  }
  if (n >= 21) {
    const r1m = (closes[n - 1] - closes[n - 21]) / closes[n - 21] * 100;
    if (r1m > 10) { momScore += 8; momBullPoints++; momReason += `Strong 1M +${fmt(r1m, 1)}%. `; }
    else if (r1m > 4) { momScore += 3; momBullPoints++; momReason += `Positive 1M +${fmt(r1m, 1)}%. `; }
    else if (r1m < -10) { momScore -= 10; momReason += `Sharp 1M decline ${fmt(r1m, 1)}%. `; }
    else if (r1m < -4) { momScore -= 5; momReason += `Negative 1M ${fmt(r1m, 1)}%. `; }
  }

  // Volume confirmation
  let volNote = '';
  if (volRatio > 2) { momScore += 6; momBullPoints++; volNote = `🔥 Volume surge ${fmt(volRatio, 1)}x avg! `; }
  else if (volRatio > 1.5) { momScore += 3; momBullPoints++; volNote = `Above-avg volume ${fmt(volRatio, 1)}x. `; }
  else if (volRatio < 0.5) { momScore -= 5; volNote = `Low volume ${fmt(volRatio, 1)}x — weak conviction. `; }

  // 52-week position
  if (w52pos < 0.15) { momScore += 6; momBullPoints++; momReason += 'Near 52W low — deep value. '; }
  else if (w52pos < 0.3) { momScore += 2; momBullPoints++; momReason += 'Lower 52W range. '; }
  else if (w52pos > 0.95) { momScore -= 8; momReason += 'At 52W high — extremely overextended. '; }
  else if (w52pos > 0.85) { momScore -= 3; momReason += 'Near 52W high. '; }

  // Gate passes if positive momentum + volume not dead
  g9 = momBullPoints >= 2 && volRatio >= 0.7;
  if (g9) gatesPassed++;
  gateResults.push(g9);

  steps.push({
    num: 9, title: 'Momentum & Volume Gate',
    verdict: g9 ? 'bullish' : momScore <= 42 ? 'bearish' : 'neutral',
    value: g9 ? 'Pass ✅' : 'Fail ❌',
    reason: ((momReason + volNote) || 'No significant signals.') + (g9 ? ' GATE PASS ✅' : ' GATE FAIL ❌'),
    gate: g9
  });

  // ============================================================
  // FINAL SCORE CALCULATION
  // ============================================================
  techScore = Math.max(0, Math.min(100, Math.round(techScore)));
  momScore = Math.max(0, Math.min(100, Math.round(momScore)));
  let totalScore = Math.round(techScore * 0.55 + momScore * 0.45);

  // GATE BONUS/PENALTY — reward multi-confirmation, punish lack of it
  if (gatesPassed >= 8) totalScore = Math.min(100, totalScore + 10);
  else if (gatesPassed >= 7) totalScore = Math.min(100, totalScore + 5);
  else if (gatesPassed <= 2) totalScore = Math.max(0, totalScore - 10);
  else if (gatesPassed <= 3) totalScore = Math.max(0, totalScore - 5);

  totalScore = Math.max(0, Math.min(100, totalScore));

  const vs50 = l50 ? ((price - l50) / l50 * 100) : 0;
  const vs200 = l200 ? ((price - l200) / l200 * 100) : 0;
  const change = n >= 2 ? ((closes[n - 1] - closes[n - 2]) / closes[n - 2] * 100) : 0;

  // Build reasons from bullish gates that passed
  const reasons = steps.filter(s => s.gate === true).map(s => s.title + ': ' + s.value);
  if (!reasons.length) reasons.push('No gates passed — avoid this stock');

  // ============================================================
  // BTST SCORING — Buy Today Sell Tomorrow
  // Looks for explosive short-term setups
  // ============================================================
  const btst = computeBTST(closes, highs, lows, volumes, lr, stDir, lVwap, lm, ls, pm, ps, volRatio, price, atr14, sr, bb, w52pos);

  return {
    techScore, momScore, totalScore, reasons, steps,
    gatesPassed, gateResults,
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
    resilienceScore,
    btst
  };
}

/**
 * BTST (Buy Today Sell Tomorrow) Scoring
 * Identifies stocks likely to go up tomorrow based on:
 * - Bullish candle today (close > open with decent body)
 * - Volume surge (>1.3x average)
 * - RSI rising but not overbought (25-65)
 * - Price above VWAP
 * - SuperTrend bullish
 * - MACD histogram improving
 * - Near support or just broke resistance
 * - Positive intraday momentum (last 1-3 days green)
 */
function computeBTST(closes, highs, lows, volumes, rsi, stDir, vwap, macdLine, macdSignal, prevMacd, prevSignal, volRatio, price, atr14, sr, bb, w52pos) {
  const n = closes.length;
  let btstScore = 0;
  const btstReasons = [];

  if (n < 5) return { score: 0, signal: 'skip', reasons: ['Insufficient data'] };

  // 1. Today's candle — bullish? (close > previous close)
  const todayChange = (closes[n - 1] - closes[n - 2]) / closes[n - 2] * 100;
  if (todayChange > 1.5) { btstScore += 15; btstReasons.push(`Strong green candle today (+${todayChange.toFixed(1)}%)`); }
  else if (todayChange > 0.3) { btstScore += 8; btstReasons.push(`Green candle today (+${todayChange.toFixed(1)}%)`); }
  else if (todayChange < -1.5) { btstScore -= 15; btstReasons.push(`Red candle today (${todayChange.toFixed(1)}%)`); }
  else if (todayChange < -0.3) { btstScore -= 8; btstReasons.push(`Slight red today (${todayChange.toFixed(1)}%)`); }

  // 2. Last 3 days momentum
  if (n >= 4) {
    const last3 = (closes[n - 1] - closes[n - 4]) / closes[n - 4] * 100;
    if (last3 > 3) { btstScore += 12; btstReasons.push(`3-day rally +${last3.toFixed(1)}%`); }
    else if (last3 > 1) { btstScore += 5; btstReasons.push(`3-day positive +${last3.toFixed(1)}%`); }
    else if (last3 < -3) { btstScore -= 10; btstReasons.push(`3-day decline ${last3.toFixed(1)}%`); }
  }

  // 3. Volume surge — critical for BTST
  if (volRatio > 2.5) { btstScore += 20; btstReasons.push(`🔥 Massive volume surge ${volRatio.toFixed(1)}x avg`); }
  else if (volRatio > 1.8) { btstScore += 15; btstReasons.push(`Strong volume ${volRatio.toFixed(1)}x avg`); }
  else if (volRatio > 1.3) { btstScore += 8; btstReasons.push(`Above-avg volume ${volRatio.toFixed(1)}x`); }
  else if (volRatio < 0.6) { btstScore -= 12; btstReasons.push(`Low volume — no conviction`); }

  // 4. RSI sweet spot for BTST (25-60 ideal, rising)
  if (rsi >= 25 && rsi <= 45) { btstScore += 10; btstReasons.push(`RSI ${rsi.toFixed(0)} — oversold recovery zone`); }
  else if (rsi > 45 && rsi <= 60) { btstScore += 5; btstReasons.push(`RSI ${rsi.toFixed(0)} — healthy momentum`); }
  else if (rsi > 75) { btstScore -= 15; btstReasons.push(`RSI ${rsi.toFixed(0)} — overbought, risky for BTST`); }
  else if (rsi > 65) { btstScore -= 5; btstReasons.push(`RSI ${rsi.toFixed(0)} — elevated`); }

  // 5. SuperTrend confirmation
  if (stDir === 1) { btstScore += 8; btstReasons.push('SuperTrend bullish'); }
  else { btstScore -= 10; btstReasons.push('SuperTrend bearish — risky'); }

  // 6. VWAP confirmation
  if (vwap && price > vwap) { btstScore += 7; btstReasons.push('Above VWAP — institutional buying'); }
  else if (vwap) { btstScore -= 7; btstReasons.push('Below VWAP'); }

  // 7. MACD momentum direction
  if (macdLine != null && macdSignal != null) {
    if (macdLine > macdSignal && prevMacd != null && prevSignal != null && prevMacd <= prevSignal) {
      btstScore += 15; btstReasons.push('🔥 Fresh MACD crossover today!');
    } else if (macdLine > macdSignal) {
      btstScore += 5; btstReasons.push('MACD bullish');
    } else {
      btstScore -= 5;
    }
  }

  // 8. Near support (good risk/reward for BTST)
  const distToSupport = ((price - sr.nearestSupport) / price * 100);
  const distToResist = ((sr.nearestResist - price) / price * 100);
  if (distToSupport < 2 && distToResist > 3) {
    btstScore += 10; btstReasons.push(`Near support with ${distToResist.toFixed(1)}% upside to resistance`);
  }

  // 9. ATR risk check — reasonable volatility for BTST
  const atrPct = (atr14 / price * 100);
  if (atrPct > 1 && atrPct < 4) { btstScore += 5; btstReasons.push(`Good ATR volatility ${atrPct.toFixed(1)}%`); }
  else if (atrPct >= 4) { btstScore -= 5; btstReasons.push(`High ATR volatility ${atrPct.toFixed(1)}% — risky`); }

  // 10. 52-week position — avoid extremes for BTST
  if (w52pos > 0.9) { btstScore -= 10; btstReasons.push('Near 52W high — avoid BTST'); }

  // BTST signal classification
  let btstSignal;
  if (btstScore >= 60) btstSignal = 'strong-btst';
  else if (btstScore >= 40) btstSignal = 'btst';
  else if (btstScore >= 20) btstSignal = 'weak-btst';
  else btstSignal = 'no-btst';

  return {
    score: Math.max(0, Math.min(100, btstScore)),
    signal: btstSignal,
    reasons: btstReasons,
    todayChange: parseFloat(todayChange.toFixed(2)),
    volRatio: parseFloat(volRatio.toFixed(2)),
    atrPct: parseFloat(atrPct.toFixed(2))
  };
}

/**
 * Get signal classification — STRICT gate-based system.
 * Strong Buy requires 7+ gates AND high score.
 * Buy requires 5+ gates AND decent score.
 */
function getSignal(s, beta, regime, gatesPassed) {
  gatesPassed = gatesPassed || 0;
  let base;

  // STRICT: Both score AND gates must align
  if (s >= 75 && gatesPassed >= 7) base = { label: 'Strong Buy', key: 'strong-buy', emoji: '🚀' };
  else if (s >= 63 && gatesPassed >= 5) base = { label: 'Buy', key: 'buy', emoji: '✅' };
  else if (s >= 63 && gatesPassed >= 4) base = { label: 'Cautious Buy', key: 'cautious-buy', emoji: '⚠️' };
  else if (s >= 45 || gatesPassed >= 3) base = { label: 'Hold', key: 'hold', emoji: '⏳' };
  else base = { label: 'Avoid', key: 'avoid', emoji: '🚫' };

  // Auto-downgrade in weak market regimes
  if (!regime) return base;
  if (regime === 'CAUTION') {
    if (base.key === 'strong-buy' && beta > 1.0) {
      return { label: 'Buy', key: 'buy', emoji: '✅', downgraded: true };
    }
    if (base.key === 'buy' && beta > 1.2) {
      return { label: 'Cautious Buy', key: 'cautious-buy', emoji: '⚠️', downgraded: true };
    }
  }
  if (regime === 'RISK-OFF') {
    if (base.key === 'strong-buy') {
      return { label: 'Cautious Buy', key: 'cautious-buy', emoji: '⚠️', downgraded: true };
    }
    if (base.key === 'buy') {
      return { label: 'Hold', key: 'hold', emoji: '⏳', downgraded: true };
    }
  }
  return base;
}

module.exports = { scoreStock, getSignal };
