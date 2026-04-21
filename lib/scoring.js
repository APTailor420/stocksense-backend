// ================================================================
// SCORING ENGINE v6 — "Fresh Crossover" Detection System
// Only rewards stocks that JUST crossed indicators (1-2 candles).
// Stocks already above indicators for 3+ days = already priced in.
// Finds the BEGINNING of moves, not the middle.
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
// FRESHNESS HELPERS — How many candles ago did a crossover happen?
// ============================================================

/**
 * Find how many candles ago price crossed above a moving average.
 * Returns 0 = crossed today, 1 = yesterday, 99 = been above for a long time.
 */
function crossoverAge(closes, maArray) {
  const n = closes.length;
  if (!maArray || n < 2) return 99;
  // Walk backward from today — find last candle where price was BELOW the MA
  for (let i = n - 1; i >= Math.max(0, n - 15); i--) {
    const ma = maArray[i];
    if (ma == null) continue;
    if (closes[i] < ma) {
      // Crossover happened at candle i+1
      return n - 1 - i - 1;  // 0 = just now, 1 = yesterday
    }
  }
  return 99; // been above for 15+ days
}

/**
 * Find how many candles ago MACD crossed above signal.
 */
function macdCrossoverAge(macdArr, signalArr) {
  const n = macdArr.length;
  for (let i = n - 1; i >= Math.max(0, n - 15); i--) {
    if (macdArr[i] == null || signalArr[i] == null) continue;
    if (macdArr[i] <= signalArr[i]) {
      return n - 1 - i - 1;
    }
  }
  return 99;
}

/**
 * Find how many candles ago SuperTrend flipped bullish.
 */
function superTrendFlipAge(directionArr) {
  const valid = directionArr.filter(v => v != null);
  const n = valid.length;
  for (let i = n - 1; i >= Math.max(0, n - 15); i--) {
    if (valid[i] === -1) {
      return n - 1 - i - 1;
    }
  }
  return 99;
}

/**
 * Find how many candles ago RSI crossed above a threshold from below.
 */
function rsiCrossAge(rsiArr, threshold) {
  const n = rsiArr.length;
  for (let i = n - 1; i >= Math.max(0, n - 15); i--) {
    if (rsiArr[i] == null) continue;
    if (rsiArr[i] < threshold) {
      return n - 1 - i - 1;
    }
  }
  return 99;
}

/**
 * Check if candle is sustainable (body > wick ratio, not a doji/spinning top).
 */
function candleSustainability(opens, closes, highs, lows, idx) {
  if (!opens || idx < 0) return { sustainable: false, score: 0 };
  const o = opens[idx], c = closes[idx], h = highs[idx], l = lows[idx];
  if (!o || !c || !h || !l || h === l) return { sustainable: false, score: 0 };
  const body = Math.abs(c - o);
  const totalRange = h - l;
  const bodyRatio = body / totalRange;
  const isBullish = c > o;
  const upperWick = h - Math.max(o, c);
  const lowerWick = Math.min(o, c) - l;

  let score = 0;
  if (isBullish && bodyRatio > 0.6) score += 3;  // Strong bullish candle
  if (isBullish && bodyRatio > 0.4) score += 1;  // Decent body
  if (isBullish && upperWick < body * 0.3) score += 2;  // No rejection
  if (!isBullish) score -= 2;  // Bearish candle = not sustainable

  return { sustainable: isBullish && bodyRatio > 0.35, score, bodyRatio, isBullish };
}

/**
 * Freshness multiplier — how much credit to give based on crossover age.
 * Age 0 (today) = 1.0x (full credit)
 * Age 1 (yesterday) = 0.8x
 * Age 2 = 0.4x
 * Age 3+ = 0.0x (already priced in — no credit)
 */
function freshnessMultiplier(age) {
  if (age <= 0) return 1.0;
  if (age === 1) return 0.8;
  if (age === 2) return 0.4;
  return 0.0; // 3+ days = stale, already priced in
}

// ============================================================
// MAIN SCORING FUNCTION
// ============================================================

function scoreStock(data, nifty60dHistory) {
  const { meta, closes, highs, lows, volumes, timestamps } = data;
  const opens = data.opens || closes.map((c, i) => i > 0 ? closes[i - 1] : c);
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
  // Volume trend (is volume increasing over last 3 days?)
  let volTrend = 0;
  if (volumes.length >= 3) {
    const v1 = volumes[volumes.length - 3], v2 = volumes[volumes.length - 2], v3 = volumes[volumes.length - 1];
    if (v3 > v2 && v2 > v1) volTrend = 2;      // Increasing 3 days
    else if (v3 > v2) volTrend = 1;             // Increasing last day
    else if (v3 < v2 && v2 < v1) volTrend = -2; // Decreasing
  }

  // 52-week position
  const h52 = meta.fiftyTwoWeekHigh || Math.max(...highs);
  const l52 = meta.fiftyTwoWeekLow || Math.min(...lows);
  const w52pos = (h52 - l52) > 0 ? (price - l52) / (h52 - l52) : 0.5;

  // Candle sustainability check
  const lastCandle = candleSustainability(opens, closes, highs, lows, n - 1);

  // ============================================================
  // FRESH CROSSOVER GATE SYSTEM
  // Each gate: Is it bullish? + How FRESH is the crossover?
  // Stale crossovers (3+ days) get ZERO credit.
  // ============================================================
  const steps = [];
  let techScore = 50, momScore = 50;
  let gatesPassed = 0;
  let freshGatesPassed = 0; // Gates that crossed within last 2 candles
  const gateResults = [];
  const freshness = {};

  // === GATE 1: RSI — Must be recovering from below 50, FRESHLY ===
  let g1 = false, rsiVerdict = 'neutral', rsiReason = '';
  const rsiAge = rsiCrossAge(rsi, 50);
  freshness.rsi = rsiAge;

  if (lr < 25) {
    g1 = true; const pts = Math.round(14 * freshnessMultiplier(0)); // Always fresh if deeply oversold
    techScore += pts; rsiVerdict = 'bullish';
    rsiReason = `RSI at ${fmt(lr, 1)} deeply oversold. 🔥 FRESH — immediate bounce zone.`;
    freshGatesPassed++;
  } else if (lr < 40 && rsiAge <= 2) {
    g1 = true; const pts = Math.round(10 * freshnessMultiplier(rsiAge));
    techScore += pts; rsiVerdict = 'bullish';
    rsiReason = `RSI at ${fmt(lr, 1)} recovering from oversold. FRESH ✅ Crossed ${rsiAge === 0 ? 'TODAY' : rsiAge + 'd ago'}.`;
    if (rsiAge <= 1) freshGatesPassed++;
  } else if (lr < 50 && rsiAge <= 2) {
    g1 = true; const pts = Math.round(5 * freshnessMultiplier(rsiAge));
    techScore += pts; rsiVerdict = 'bullish';
    rsiReason = `RSI at ${fmt(lr, 1)} below 50 with room. Crossed ${rsiAge === 0 ? 'TODAY' : rsiAge + 'd ago'}. ✅`;
    if (rsiAge <= 1) freshGatesPassed++;
  } else if (lr < 50 && rsiAge > 2) {
    rsiVerdict = 'neutral';
    rsiReason = `RSI at ${fmt(lr, 1)} below 50 but crossed ${rsiAge}d ago. ⚠️ STALE — move already started.`;
  } else if (lr <= 65) {
    techScore -= 3; rsiVerdict = 'neutral';
    rsiReason = `RSI at ${fmt(lr, 1)} above 50. ❌ Already in momentum zone — late entry.`;
  } else {
    techScore -= 12; rsiVerdict = 'bearish';
    rsiReason = `RSI at ${fmt(lr, 1)} overbought. ❌ High pullback risk.`;
  }
  if (g1) gatesPassed++;
  gateResults.push(g1);
  steps.push({ num: 1, title: 'RSI Fresh Cross', verdict: rsiVerdict, value: `${fmt(lr, 1)} (${rsiAge <= 2 ? '🔥' + rsiAge + 'd' : '⚠️' + rsiAge + 'd'})`, reason: rsiReason, gate: g1, age: rsiAge });

  // === GATE 2: SuperTrend — Must have JUST flipped green ===
  let g2 = false, stVerdict = 'neutral', stReason = '';
  const stAge = superTrendFlipAge(superTrend.direction);
  freshness.superTrend = stAge;

  if (stDir === 1 && stAge <= 2) {
    g2 = true; const pts = Math.round(12 * freshnessMultiplier(stAge));
    techScore += pts; stVerdict = 'bullish';
    stReason = `🔥 SuperTrend JUST flipped GREEN ${stAge === 0 ? 'TODAY' : stAge + 'd ago'}! FRESH ✅ Support at ₹${fmt(stVal)}.`;
    if (stAge <= 1) freshGatesPassed++;
  } else if (stDir === 1 && stAge <= 4) {
    g2 = true; techScore += 3; stVerdict = 'bullish';
    stReason = `SuperTrend green but flipped ${stAge}d ago. ⚠️ Getting stale. Support ₹${fmt(stVal)}.`;
  } else if (stDir === 1) {
    stVerdict = 'neutral';
    stReason = `SuperTrend green for ${stAge}+ days. ❌ STALE — already priced in. Not a fresh entry.`;
    techScore -= 2;
  } else if (stDir === -1) {
    techScore -= 10; stVerdict = 'bearish';
    stReason = `SuperTrend BEARISH (Red). ❌ Trend against you. Resistance ₹${fmt(stVal)}.`;
    const prevDir = superTrend.direction.filter(v => v != null);
    if (prevDir.length >= 2 && prevDir[prevDir.length - 2] === 1) { techScore -= 5; stReason += ' Just turned red!'; }
  } else { stReason = 'Insufficient data. ❌'; }
  if (g2) gatesPassed++;
  gateResults.push(g2);
  steps.push({ num: 2, title: 'SuperTrend Fresh Flip', verdict: stVerdict, value: stDir === 1 ? `Green 🔥${stAge}d` : 'Red ❌', reason: stReason, gate: g2, age: stAge });

  // === GATE 3: VWAP — Price JUST crossed above VWAP ===
  let g3 = false, vwapVerdict = 'neutral', vwapReason = '';
  const vwapAge = lVwap ? crossoverAge(closes, vwap) : 99;
  freshness.vwap = vwapAge;

  if (lVwap && price > lVwap && vwapAge <= 2) {
    g3 = true; const vd = ((price - lVwap) / lVwap * 100);
    const pts = Math.round(8 * freshnessMultiplier(vwapAge));
    techScore += pts; vwapVerdict = 'bullish';
    vwapReason = `🔥 JUST crossed above VWAP ${vwapAge === 0 ? 'TODAY' : vwapAge + 'd ago'}! +${fmt(vd, 1)}% above. Institutional buying kicking in.`;
    if (vwapAge <= 1) freshGatesPassed++;
  } else if (lVwap && price > lVwap && vwapAge <= 4) {
    g3 = true; techScore += 2; vwapVerdict = 'neutral';
    vwapReason = `Above VWAP but crossed ${vwapAge}d ago. ⚠️ Getting stale.`;
  } else if (lVwap && price > lVwap) {
    vwapVerdict = 'neutral';
    vwapReason = `Above VWAP for ${vwapAge}+ days. ❌ STALE — institutions already positioned.`;
  } else if (lVwap) {
    techScore -= 6; vwapVerdict = 'bearish';
    vwapReason = `Below VWAP. ❌ Institutional selling.`;
  } else { vwapReason = 'VWAP data insufficient. ❌'; }
  if (g3) gatesPassed++;
  gateResults.push(g3);
  steps.push({ num: 3, title: 'VWAP Fresh Cross', verdict: vwapVerdict, value: vwapAge <= 2 ? `🔥 ${vwapAge}d` : (price > (lVwap || 0) ? `⚠️ ${vwapAge}d` : '❌ Below'), reason: vwapReason, gate: g3, age: vwapAge });

  // === GATE 4: MACD — JUST had bullish crossover ===
  let g4 = false, macdVerdict = 'neutral', macdReason = '';
  const macdAge = (lm != null && ls != null && lm > ls) ? macdCrossoverAge(macd.macd, macd.signal) : 99;
  freshness.macd = macdAge;

  if (lm != null && ls != null && lm > ls && macdAge <= 1) {
    g4 = true; techScore += 12; macdVerdict = 'bullish';
    macdReason = `🔥🔥 FRESH MACD crossover ${macdAge === 0 ? 'TODAY' : 'YESTERDAY'}! Strongest entry signal. Histogram: ${fmt(last(macd.hist), 2)}.`;
    freshGatesPassed++;
  } else if (lm != null && ls != null && lm > ls && macdAge === 2) {
    g4 = true; techScore += 6; macdVerdict = 'bullish';
    macdReason = `MACD crossover 2d ago. Still fresh. ✅ Histogram: ${fmt(last(macd.hist), 2)}.`;
  } else if (lm != null && ls != null && lm > ls && macdAge <= 4) {
    g4 = true; techScore += 2; macdVerdict = 'neutral';
    macdReason = `MACD bullish but crossover ${macdAge}d ago. ⚠️ Momentum already running.`;
  } else if (lm != null && ls != null && lm > ls) {
    macdVerdict = 'neutral';
    macdReason = `MACD bullish for ${macdAge}+ days. ❌ STALE — late entry.`;
    techScore -= 2;
  } else if (lm != null && ls != null && lm < ls) {
    // Check if MACD is about to cross (histogram narrowing)
    const hist = last(macd.hist), prevHist = prev(macd.hist);
    if (hist != null && prevHist != null && hist > prevHist && hist > -0.5) {
      techScore += 1; macdVerdict = 'neutral';
      macdReason = `MACD bearish but histogram improving (${fmt(hist, 2)}). 👀 Watch for crossover.`;
    } else {
      techScore -= 8; macdVerdict = 'bearish';
      macdReason = `MACD bearish. ❌ Momentum against you.`;
    }
  } else { macdReason = 'Insufficient MACD data. ❌'; }
  if (g4) gatesPassed++;
  gateResults.push(g4);
  steps.push({ num: 4, title: 'MACD Fresh Crossover', verdict: macdVerdict, value: macdAge <= 2 ? `🔥 ${macdAge}d` : (lm > ls ? `⚠️ ${macdAge}d` : '❌ Bearish'), reason: macdReason, gate: g4, age: macdAge });

  // === GATE 5: Moving Average — JUST crossed above key MAs ===
  let g5 = false, maVerdict = 'neutral', maReason = '';
  const ma10Age = crossoverAge(closes, sma10);
  const ma50Age = crossoverAge(closes, sma50);
  const ma200Age = crossoverAge(closes, sma200);
  const freshMACrosses = [ma10Age, ma50Age, ma200Age].filter(a => a <= 2).length;
  const anyFreshMA = Math.min(ma10Age, ma50Age, ma200Age);
  freshness.ma = { sma10: ma10Age, sma50: ma50Age, sma200: ma200Age };

  if (freshMACrosses >= 2 && anyFreshMA <= 1) {
    g5 = true; techScore += 12; maVerdict = 'bullish';
    maReason = `🔥🔥 JUST crossed ${freshMACrosses} MAs! SMA10:${ma10Age}d SMA50:${ma50Age}d SMA200:${ma200Age}d. Perfect fresh entry!`;
    freshGatesPassed++;
  } else if (freshMACrosses >= 1) {
    g5 = true; const pts = Math.round(7 * freshnessMultiplier(anyFreshMA));
    techScore += pts; maVerdict = 'bullish';
    maReason = `Fresh MA crossover detected. SMA10:${ma10Age}d SMA50:${ma50Age}d SMA200:${ma200Age}d. ✅`;
    if (anyFreshMA <= 1) freshGatesPassed++;
  } else {
    // All MAs are stale — check if price is above all 3 but old
    let aboveCount = 0;
    if (l10 && price > l10) aboveCount++;
    if (l50 && price > l50) aboveCount++;
    if (l200 && price > l200) aboveCount++;
    if (aboveCount === 0) {
      techScore -= 10; maVerdict = 'bearish';
      maReason = `Below ALL MAs. ❌ Downtrend. No entry.`;
    } else if (aboveCount <= 1) {
      techScore -= 5; maVerdict = 'bearish';
      maReason = `Only ${aboveCount}/3 MAs bullish, all stale. ❌ Weak.`;
    } else {
      maVerdict = 'neutral';
      maReason = `Above ${aboveCount}/3 MAs but all crossed ${anyFreshMA}+ days ago. ❌ STALE — already priced in.`;
      techScore -= 2;
    }
  }

  // Golden/Death Cross freshness
  let crossNote = '';
  if (l10 && l50) {
    const p10 = prev(sma10), p50v = prev(sma50);
    if (l10 > l50 && p10 && p50v && p10 <= p50v) { techScore += 8; crossNote = ' 🔥🔥 SMA10/50 GOLDEN CROSS TODAY!'; freshGatesPassed++; }
    if (l10 < l50 && p10 && p50v && p10 >= p50v) { techScore -= 8; crossNote = ' ☠️ DEATH CROSS!'; }
  }
  if (l50 && l200) {
    const p50 = prev(sma50), p200 = prev(sma200);
    if (l50 > l200 && p50 && p200 && p50 <= p200) { techScore += 10; crossNote += ' 🔥🔥🔥 SMA50/200 GOLDEN CROSS!'; freshGatesPassed++; }
    if (l50 < l200 && p50 && p200 && p50 >= p200) { techScore -= 12; crossNote += ' ☠️ DEATH CROSS!'; }
  }
  if (crossNote) maReason += crossNote;

  if (g5) gatesPassed++;
  gateResults.push(g5);
  steps.push({ num: 5, title: 'MA Fresh Cross (10/50/200)', verdict: maVerdict, value: freshMACrosses >= 1 ? `🔥 ${freshMACrosses} fresh` : '❌ Stale', reason: maReason, gate: g5, age: anyFreshMA });

  // === GATE 6: Resistance Breakout — JUST broke resistance (today/yesterday) ===
  let g6 = false, srVerdict = 'neutral', srReason = '';
  const distToSupport = ((price - sr.nearestSupport) / price * 100);
  const distToResist = ((sr.nearestResist - price) / price * 100);

  // Check exact candle when resistance was broken
  let resistBreakAge = 99;
  for (let i = n - 1; i >= Math.max(0, n - 10); i--) {
    if (closes[i] < sr.nearestResist) {
      resistBreakAge = n - 1 - i - 1;
      break;
    }
  }
  freshness.resistBreak = resistBreakAge;

  if (price > sr.nearestResist && resistBreakAge <= 1) {
    g6 = true; techScore += 12; srVerdict = 'bullish';
    srReason = `🔥🔥 JUST BROKE RESISTANCE ₹${fmt(sr.nearestResist)} ${resistBreakAge === 0 ? 'TODAY' : 'YESTERDAY'}! Fresh breakout — chase it!`;
    freshGatesPassed++;
  } else if (price > sr.nearestResist && resistBreakAge === 2) {
    g6 = true; techScore += 5; srVerdict = 'bullish';
    srReason = `Broke resistance ₹${fmt(sr.nearestResist)} 2d ago. Still actionable. ✅`;
  } else if (price > sr.nearestResist && resistBreakAge >= 3) {
    srVerdict = 'neutral';
    srReason = `Above resistance but broke ${resistBreakAge}d ago. ❌ STALE — breakout already played out.`;
    techScore -= 3;
  } else if (distToResist < 1.5) {
    g6 = true; techScore += 4; srVerdict = 'bullish';
    srReason = `Testing resistance ₹${fmt(sr.nearestResist)} (${fmt(distToResist, 1)}% away). 👀 Breakout imminent!`;
  } else if (distToSupport < 2 && distToResist > 4) {
    g6 = true; techScore += 3; srVerdict = 'bullish';
    srReason = `Near support ₹${fmt(sr.nearestSupport)} with ${fmt(distToResist, 1)}% upside. Good risk/reward.`;
  } else {
    srReason = `Between S:₹${fmt(sr.nearestSupport)} R:₹${fmt(sr.nearestResist)}. ❌ No breakout.`;
  }
  if (g6) gatesPassed++;
  gateResults.push(g6);
  steps.push({ num: 6, title: 'Resistance Fresh Break', verdict: srVerdict, value: resistBreakAge <= 2 ? `🔥 Broke ${resistBreakAge}d` : `❌ ${resistBreakAge}d`, reason: srReason, gate: g6, age: resistBreakAge });

  // === GATE 7: Trendline Breakout — Must be fresh ===
  let g7 = false, tbVerdict = 'neutral', tbReason = '';
  if (trendBreak.breakout === 'bullish') {
    g7 = true; techScore += 8; tbVerdict = 'bullish';
    tbReason = `🔥 BULLISH TRENDLINE BREAKOUT! ✅ ${trendBreak.desc}.`;
    freshGatesPassed++;
  } else if (trendBreak.breakout === 'testing-resist') {
    g7 = true; techScore += 3; tbVerdict = 'bullish';
    tbReason = `Testing trendline resistance. 👀 ${trendBreak.desc}. Watch for breakout.`;
  } else if (trendBreak.breakout === 'bearish') {
    techScore -= 10; tbVerdict = 'bearish';
    tbReason = `BEARISH BREAKDOWN! ❌ ${trendBreak.desc}.`;
  } else if (trendBreak.breakout === 'testing-support') {
    techScore -= 3; tbVerdict = 'bearish';
    tbReason = `Testing trendline support. ❌ Risk of breakdown.`;
  } else {
    tbReason = `Within trendlines. ❌ No breakout. S:₹${fmt(trendBreak.trendSupport)} R:₹${fmt(trendBreak.trendResist)}.`;
  }
  if (g7) gatesPassed++;
  gateResults.push(g7);
  steps.push({ num: 7, title: 'Trendline Breakout', verdict: tbVerdict, value: g7 ? 'Breakout ✅' : 'No ❌', reason: tbReason, gate: g7 });

  // === GATE 8: Bollinger Bands — Must be bouncing from lower half ===
  let g8 = false, bbVerdict = 'neutral', bbReason = '';
  let bbAge = 99;
  if (bbu && bbl) {
    const bbPos = (price - bbl) / (bbu - bbl);
    const bbWidth = ((bbu - bbl) / bbm * 100);
    // Find when BB position crossed above 0.2 (bounce from lower)
    for (let i = n - 1; i >= Math.max(0, n - 10); i--) {
      const bbuI = bb.upper[i], bblI = bb.lower[i];
      if (bbuI && bblI) {
        const posI = (closes[i] - bblI) / (bbuI - bblI);
        if (posI < 0.2) { bbAge = n - 1 - i - 1; break; }
      }
    }
    freshness.bb = bbAge;

    if (bbPos < 0.15) {
      g8 = true; techScore += 8; bbVerdict = 'bullish';
      bbReason = `🔥 AT lower Bollinger Band (BB% ${fmt(bbPos * 100, 0)}%). Bounce zone NOW!`;
      freshGatesPassed++;
    } else if (bbPos < 0.35 && bbAge <= 2) {
      g8 = true; techScore += Math.round(6 * freshnessMultiplier(bbAge)); bbVerdict = 'bullish';
      bbReason = `Just bounced from lower BB ${bbAge}d ago (BB% ${fmt(bbPos * 100, 0)}%). ✅ Fresh bounce.`;
      if (bbAge <= 1) freshGatesPassed++;
    } else if (bbPos < 0.5) {
      g8 = true; techScore += 2; bbVerdict = 'neutral';
      bbReason = `Lower half of BB (${fmt(bbPos * 100, 0)}%). Some room but not freshest.`;
    } else if (bbPos > 0.9) {
      techScore -= 8; bbVerdict = 'bearish';
      bbReason = `At upper BB (${fmt(bbPos * 100, 0)}%). ❌ Overbought — pullback imminent.`;
    } else if (bbPos > 0.7) {
      techScore -= 3; bbVerdict = 'neutral';
      bbReason = `Near upper BB (${fmt(bbPos * 100, 0)}%). ❌ Extended — late entry.`;
    } else {
      bbReason = `Mid BB (${fmt(bbPos * 100, 0)}%). ❌ No clear edge.`;
    }
    if (bbWidth < 8) { bbReason += ` ⚡ Squeeze (${fmt(bbWidth, 1)}%) — explosive move coming.`; }
  }
  if (g8) gatesPassed++;
  gateResults.push(g8);
  steps.push({ num: 8, title: 'BB Fresh Bounce', verdict: bbVerdict, value: bbu ? `BB% ${fmt((price - bbl) / (bbu - bbl) * 100, 0)}%` : 'N/A', reason: bbReason, gate: g8, age: bbAge });

  // === GATE 9: Volume & Momentum — Today's action matters most ===
  let g9 = false, momReason = '';
  let momBullPoints = 0;

  // Today's candle quality
  if (lastCandle.sustainable) { momBullPoints++; momReason += `Today: bullish candle (body ${fmt(lastCandle.bodyRatio * 100, 0)}%). `; }
  else if (!lastCandle.isBullish) { momReason += `Today: red candle ⚠️. `; }

  // 1-day change (most important for v6)
  const r1d = n >= 2 ? (closes[n - 1] - closes[n - 2]) / closes[n - 2] * 100 : 0;
  if (r1d > 2) { momScore += 10; momBullPoints++; momReason += `Strong today +${fmt(r1d, 1)}%. `; }
  else if (r1d > 0.5) { momScore += 5; momBullPoints++; momReason += `Green today +${fmt(r1d, 1)}%. `; }
  else if (r1d < -2) { momScore -= 8; momReason += `Red today ${fmt(r1d, 1)}%. `; }

  // 3-day momentum
  if (n >= 4) {
    const r3d = (closes[n - 1] - closes[n - 4]) / closes[n - 4] * 100;
    if (r3d > 4) { momScore += 6; momBullPoints++; momReason += `3D rally +${fmt(r3d, 1)}%. `; }
    else if (r3d > 1.5) { momScore += 3; momBullPoints++; momReason += `3D positive +${fmt(r3d, 1)}%. `; }
    else if (r3d < -4) { momScore -= 8; momReason += `3D decline ${fmt(r3d, 1)}%. `; }
  }

  // Volume — critical for v6 (confirms the fresh crossover has conviction)
  let volNote = '';
  if (volRatio > 2.5) { momScore += 10; momBullPoints += 2; volNote = `🔥🔥 Massive volume ${fmt(volRatio, 1)}x! `; }
  else if (volRatio > 1.8) { momScore += 7; momBullPoints++; volNote = `🔥 Strong volume ${fmt(volRatio, 1)}x. `; }
  else if (volRatio > 1.3) { momScore += 4; momBullPoints++; volNote = `Good volume ${fmt(volRatio, 1)}x. `; }
  else if (volRatio < 0.5) { momScore -= 6; volNote = `⚠️ Low volume ${fmt(volRatio, 1)}x — weak conviction. `; }

  // Volume trend bonus
  if (volTrend >= 2) { momScore += 3; volNote += 'Vol increasing 3d! '; momBullPoints++; }

  // 52-week position
  if (w52pos < 0.15) { momScore += 5; momBullPoints++; momReason += 'Near 52W low — deep value. '; }
  else if (w52pos > 0.95) { momScore -= 8; momReason += 'At 52W high — overextended. '; }
  else if (w52pos > 0.85) { momScore -= 3; momReason += 'Near 52W high. '; }

  g9 = momBullPoints >= 2 && volRatio >= 0.8 && r1d > -1;
  if (g9) gatesPassed++;
  gateResults.push(g9);

  steps.push({
    num: 9, title: 'Volume & Today\'s Action',
    verdict: g9 ? 'bullish' : momScore <= 42 ? 'bearish' : 'neutral',
    value: g9 ? `✅ Vol ${fmt(volRatio, 1)}x` : `❌ Vol ${fmt(volRatio, 1)}x`,
    reason: ((momReason + volNote) || 'No signals.') + (g9 ? ' GATE PASS ✅' : ' GATE FAIL ❌'),
    gate: g9
  });

  // ============================================================
  // SUSTAINABILITY CHECK — Is this move likely to continue?
  // ============================================================
  let sustainScore = 0;
  const sustainReasons = [];
  if (lastCandle.sustainable) { sustainScore += 15; sustainReasons.push('Bullish candle with strong body'); }
  if (volRatio > 1.3) { sustainScore += 15; sustainReasons.push(`Volume confirmation ${fmt(volRatio, 1)}x`); }
  if (volTrend >= 1) { sustainScore += 10; sustainReasons.push('Volume trending up'); }
  if (stDir === 1 && stAge <= 3) { sustainScore += 10; sustainReasons.push('Fresh SuperTrend support'); }
  if (lm > ls && macdAge <= 3) { sustainScore += 10; sustainReasons.push('Fresh MACD momentum'); }
  if (lr < 50) { sustainScore += 10; sustainReasons.push('RSI has room to run'); }
  if (lr > 70) { sustainScore -= 15; sustainReasons.push('RSI overbought — unsustainable'); }
  if (w52pos > 0.9) { sustainScore -= 10; sustainReasons.push('Near 52W high — exhaustion risk'); }
  if (distToResist < 2 && price < sr.nearestResist) { sustainScore -= 5; sustainReasons.push('Resistance overhead'); }

  // ============================================================
  // FINAL SCORE — Heavily weight FRESHNESS
  // ============================================================
  techScore = Math.max(0, Math.min(100, Math.round(techScore)));
  momScore = Math.max(0, Math.min(100, Math.round(momScore)));
  let totalScore = Math.round(techScore * 0.50 + momScore * 0.30 + sustainScore * 0.20);

  // FRESHNESS BONUS — reward stocks with multiple fresh crossovers
  if (freshGatesPassed >= 4) totalScore = Math.min(100, totalScore + 15);
  else if (freshGatesPassed >= 3) totalScore = Math.min(100, totalScore + 10);
  else if (freshGatesPassed >= 2) totalScore = Math.min(100, totalScore + 5);
  // STALENESS PENALTY — if no fresh gates, this is a late entry
  if (freshGatesPassed === 0 && gatesPassed > 0) totalScore = Math.max(0, totalScore - 10);

  totalScore = Math.max(0, Math.min(100, totalScore));

  const vs50 = l50 ? ((price - l50) / l50 * 100) : 0;
  const vs200 = l200 ? ((price - l200) / l200 * 100) : 0;
  const change = n >= 2 ? ((closes[n - 1] - closes[n - 2]) / closes[n - 2] * 100) : 0;

  const reasons = steps.filter(s => s.gate === true && s.age !== undefined && s.age <= 2).map(s => s.title + ': 🔥' + (s.age || 0) + 'd');
  if (!reasons.length) reasons.push('No fresh crossovers detected');

  // ============================================================
  // BTST v6 — based on TODAY's fresh action
  // ============================================================
  const btst = computeBTST(closes, highs, lows, volumes, opens, lr, stDir, stAge, lVwap, vwapAge, lm, ls, macdAge, volRatio, volTrend, price, atr14, sr, bb, w52pos, lastCandle, freshGatesPassed);

  return {
    techScore, momScore, totalScore, reasons, steps,
    gatesPassed, freshGatesPassed, gateResults, freshness,
    sustainScore, sustainReasons,
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

// ============================================================
// BTST v6 — Buy Today Sell Tomorrow (freshness-focused)
// ============================================================
function computeBTST(closes, highs, lows, volumes, opens, rsi, stDir, stAge, vwap, vwapAge, macdLine, macdSignal, macdAge, volRatio, volTrend, price, atr14, sr, bb, w52pos, lastCandle, freshGates) {
  const n = closes.length;
  let btstScore = 0;
  const btstReasons = [];
  if (n < 5) return { score: 0, signal: 'skip', reasons: ['Insufficient data'] };

  const todayChange = (closes[n - 1] - closes[n - 2]) / closes[n - 2] * 100;

  // 1. Today's candle — must be bullish and strong
  if (lastCandle.sustainable && todayChange > 1.5) { btstScore += 18; btstReasons.push(`🔥 Strong bullish candle (+${todayChange.toFixed(1)}%)`); }
  else if (lastCandle.sustainable && todayChange > 0.3) { btstScore += 10; btstReasons.push(`Green candle (+${todayChange.toFixed(1)}%)`); }
  else if (todayChange < -1) { btstScore -= 15; btstReasons.push(`Red candle (${todayChange.toFixed(1)}%)`); }

  // 2. Volume surge TODAY — most critical for BTST
  if (volRatio > 2.5) { btstScore += 22; btstReasons.push(`🔥🔥 Massive volume surge ${volRatio.toFixed(1)}x`); }
  else if (volRatio > 1.8) { btstScore += 15; btstReasons.push(`🔥 Strong volume ${volRatio.toFixed(1)}x`); }
  else if (volRatio > 1.3) { btstScore += 8; btstReasons.push(`Above-avg volume ${volRatio.toFixed(1)}x`); }
  else if (volRatio < 0.6) { btstScore -= 12; btstReasons.push(`Low volume — skip`); }

  // 3. Volume trend (increasing = continuation likely)
  if (volTrend >= 2) { btstScore += 8; btstReasons.push('Volume increasing 3 days'); }

  // 4. FRESH crossovers today = highest BTST potential
  if (freshGates >= 3) { btstScore += 15; btstReasons.push(`🔥 ${freshGates} fresh crossovers today`); }
  else if (freshGates >= 2) { btstScore += 8; btstReasons.push(`${freshGates} fresh crossovers`); }

  // 5. RSI sweet spot
  if (rsi >= 25 && rsi <= 45) { btstScore += 10; btstReasons.push(`RSI ${rsi.toFixed(0)} — recovery zone`); }
  else if (rsi > 45 && rsi <= 55) { btstScore += 5; btstReasons.push(`RSI ${rsi.toFixed(0)} — healthy`); }
  else if (rsi > 70) { btstScore -= 12; btstReasons.push(`RSI ${rsi.toFixed(0)} — overbought`); }

  // 6. SuperTrend just flipped = strong BTST signal
  if (stDir === 1 && stAge <= 1) { btstScore += 12; btstReasons.push('🔥 SuperTrend just turned green!'); }
  else if (stDir === 1) { btstScore += 4; btstReasons.push('SuperTrend green'); }
  else { btstScore -= 8; btstReasons.push('SuperTrend red — risky'); }

  // 7. MACD fresh crossover = BTST gold
  if (macdLine > macdSignal && macdAge <= 1) { btstScore += 12; btstReasons.push('🔥 MACD just crossed bullish!'); }
  else if (macdLine > macdSignal) { btstScore += 3; }
  else { btstScore -= 5; }

  // 8. Near support = good risk/reward
  const dToS = ((price - sr.nearestSupport) / price * 100);
  const dToR = ((sr.nearestResist - price) / price * 100);
  if (dToS < 2 && dToR > 3) { btstScore += 8; btstReasons.push(`Near support, ${dToR.toFixed(1)}% upside`); }

  // 9. ATR for stop-loss feasibility
  const atrPct = (atr14 / price * 100);
  if (atrPct > 1 && atrPct < 3.5) { btstScore += 5; btstReasons.push(`Good volatility ${atrPct.toFixed(1)}%`); }
  else if (atrPct >= 4) { btstScore -= 5; btstReasons.push(`High risk ATR ${atrPct.toFixed(1)}%`); }

  // 10. 52-week position — avoid extremes
  if (w52pos > 0.92) { btstScore -= 10; btstReasons.push('Near 52W high — avoid'); }

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
    atrPct: parseFloat((atr14 / price * 100).toFixed(2))
  };
}

// ============================================================
// SIGNAL CLASSIFICATION — Requires FRESH gates
// ============================================================
function getSignal(s, beta, regime, gatesPassed, freshGatesPassed) {
  gatesPassed = gatesPassed || 0;
  freshGatesPassed = freshGatesPassed || 0;
  let base;

  // v6 STRICT: Needs both gates AND fresh crossovers
  if (s >= 75 && gatesPassed >= 6 && freshGatesPassed >= 3) base = { label: 'Strong Buy', key: 'strong-buy', emoji: '🚀' };
  else if (s >= 63 && gatesPassed >= 5 && freshGatesPassed >= 2) base = { label: 'Buy', key: 'buy', emoji: '✅' };
  else if (s >= 60 && gatesPassed >= 4 && freshGatesPassed >= 1) base = { label: 'Cautious Buy', key: 'cautious-buy', emoji: '⚠️' };
  else if (s >= 45 || gatesPassed >= 3) base = { label: 'Hold', key: 'hold', emoji: '⏳' };
  else base = { label: 'Avoid', key: 'avoid', emoji: '🚫' };

  if (!regime) return base;
  if (regime === 'CAUTION') {
    if (base.key === 'strong-buy' && beta > 1.0) return { label: 'Buy', key: 'buy', emoji: '✅', downgraded: true };
    if (base.key === 'buy' && beta > 1.2) return { label: 'Cautious Buy', key: 'cautious-buy', emoji: '⚠️', downgraded: true };
  }
  if (regime === 'RISK-OFF') {
    if (base.key === 'strong-buy') return { label: 'Cautious Buy', key: 'cautious-buy', emoji: '⚠️', downgraded: true };
    if (base.key === 'buy') return { label: 'Hold', key: 'hold', emoji: '⏳', downgraded: true };
  }
  return base;
}

module.exports = { scoreStock, getSignal };
