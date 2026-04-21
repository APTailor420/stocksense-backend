// ================================================================
// YAHOO FINANCE SERVER-SIDE FETCHER
// No CORS proxies needed — direct server-side requests
// ================================================================

const YAHOO_BASE = 'https://query1.finance.yahoo.com';
const REQUEST_TIMEOUT = 10000; // 10s

/**
 * Fetch with timeout (Node 18+ AbortSignal.timeout)
 */
async function fetchWithTimeout(url, timeoutMs = REQUEST_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    clearTimeout(timer);
    return null;
  }
}

/**
 * Fetch stock chart data (6 months daily)
 * @param {string} sym - NSE symbol (e.g. 'RELIANCE')
 * @returns {Object|null} { meta, closes, highs, lows, volumes, timestamps }
 */
async function fetchStock(sym) {
  // Handle M&M → M%26M for Yahoo
  const yahooSym = sym.replace('&', '%26');
  const url = `${YAHOO_BASE}/v8/finance/chart/${yahooSym}.NS?interval=1d&range=6mo&includePrePost=false`;
  const data = await fetchWithTimeout(url);
  if (!data?.chart?.result?.[0]) return null;
  const res = data.chart.result[0];
  const meta = res.meta || {};
  const q = res.indicators?.quote?.[0] || {};
  const opens = (q.open || []);
  const closes = (q.close || []);
  const highs = (q.high || []);
  const lows = (q.low || []);
  const volumes = (q.volume || []);
  const timestamps = res.timestamp || [];
  // Build aligned OHLCV arrays — only keep candles where all values are valid
  const ohlcv = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (opens[i] != null && highs[i] != null && lows[i] != null && closes[i] != null && volumes[i] != null) {
      ohlcv.push({ t: timestamps[i], o: opens[i], h: highs[i], l: lows[i], c: closes[i], v: volumes[i] });
    }
  }
  if (ohlcv.length < 30) return null;
  // Keep backward-compatible flat arrays for scoring engine
  const validCloses = ohlcv.map(d => d.c);
  const validHighs = ohlcv.map(d => d.h);
  const validLows = ohlcv.map(d => d.l);
  const validVolumes = ohlcv.map(d => d.v);
  const validOpens = ohlcv.map(d => d.o);
  return { meta, opens: validOpens, closes: validCloses, highs: validHighs, lows: validLows, volumes: validVolumes, timestamps: ohlcv.map(d => d.t), ohlcv };
}

/**
 * Fetch fundamentals (financial data, balance sheet, etc.)
 * @param {string} sym - NSE symbol
 * @returns {Object|null}
 */
async function fetchFundamentals(sym) {
  const yahooSym = sym.replace('&', '%26');
  const url = `${YAHOO_BASE}/v10/finance/quoteSummary/${yahooSym}.NS?modules=financialData,defaultKeyStatistics,summaryDetail,assetProfile,balanceSheetHistory,incomeStatementHistory,recommendationTrend`;
  try {
    const data = await fetchWithTimeout(url);
    return data?.quoteSummary?.result?.[0] || null;
  } catch {
    return null;
  }
}

/**
 * Fetch Nifty 50 market data (3 months for regime detection)
 * Tries multiple symbols for reliability.
 * @returns {Object|null} { price, closes, highs, lows, vix }
 */
async function fetchMarketData() {
  const niftySymbols = ['%5ENSEI', 'NIFTY_50.NS', '%5ECNX500'];
  const vixSymbols = ['%5EINDIAVIX', 'INDIAVIX.NS'];

  // Try Nifty
  let niftyResult = null;
  for (const sym of niftySymbols) {
    const url = `${YAHOO_BASE}/v8/finance/chart/${sym}?interval=1d&range=3mo&includePrePost=false`;
    const raw = await fetchWithTimeout(url);
    if (!raw?.chart?.result?.[0]) continue;
    const res = raw.chart.result[0];
    const closes = (res.indicators?.quote?.[0]?.close || []).filter(v => v != null);
    const highs = (res.indicators?.quote?.[0]?.high || []).filter(v => v != null);
    const lows = (res.indicators?.quote?.[0]?.low || []).filter(v => v != null);
    if (closes.length < 10) continue;
    niftyResult = { closes, highs, lows, price: closes[closes.length - 1] };
    break;
  }
  if (!niftyResult) return null;

  // Try VIX (non-critical)
  let vixPrice = null;
  for (const sym of vixSymbols) {
    const url = `${YAHOO_BASE}/v8/finance/chart/${sym}?interval=1d&range=5d&includePrePost=false`;
    const raw = await fetchWithTimeout(url);
    const closesArr = raw?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
    const valid = closesArr.filter(v => v != null);
    if (valid.length > 0) { vixPrice = valid[valid.length - 1]; break; }
  }

  return {
    price: niftyResult.price,
    closes: niftyResult.closes,
    highs: niftyResult.highs,
    lows: niftyResult.lows,
    vix: vixPrice
  };
}

/**
 * Fetch Yahoo Finance news for a symbol
 * @param {string} sym - NSE symbol
 * @returns {Array} news items
 */
async function fetchYahooNews(sym) {
  const yahooSym = sym.replace('&', '%26');
  const url = `${YAHOO_BASE}/v1/finance/search?q=${yahooSym}&newsCount=6&quotesCount=0`;
  const d = await fetchWithTimeout(url);
  return (d?.news || []).map(n => ({
    title: n.title || '',
    link: n.link || '',
    pubDate: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString() : '',
    source: n.publisher || 'Yahoo Finance'
  }));
}

/**
 * Fetch news from multiple sources + score catalyst freshness
 * Sources: Yahoo Finance search + Google News RSS
 * @param {string} sym - NSE symbol
 * @param {string} companyName - Company name for broader search
 * @returns {Object} { news: [], catalystScore, catalystReasons }
 */
async function fetchMultiSourceNews(sym, companyName) {
  const yahooSym = sym.replace('&', '%26');
  const allNews = [];

  // Source 1: Yahoo Finance search
  try {
    const url = `${YAHOO_BASE}/v1/finance/search?q=${yahooSym}+NSE&newsCount=10&quotesCount=0`;
    const d = await fetchWithTimeout(url);
    (d?.news || []).forEach(n => {
      allNews.push({
        title: n.title || '',
        link: n.link || '',
        pubDate: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString() : '',
        source: n.publisher || 'Yahoo Finance',
        ageHours: n.providerPublishTime ? Math.round((Date.now() / 1000 - n.providerPublishTime) / 3600) : 999
      });
    });
  } catch (e) { /* ignore */ }

  // Source 2: Google News RSS (server-side, no CORS)
  try {
    const query = encodeURIComponent(`${companyName || sym} NSE stock`);
    const gUrl = `https://news.google.com/rss/search?q=${query}&hl=en-IN&gl=IN&ceid=IN:en`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const gRes = await fetch(gUrl, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    clearTimeout(timer);
    if (gRes.ok) {
      const xml = await gRes.text();
      // Simple XML parse for RSS items
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      items.slice(0, 8).forEach(item => {
        const title = (item.match(/<title>(.*?)<\/title>/) || [])[1] || '';
        const link = (item.match(/<link>(.*?)<\/link>/) || [])[1] || '';
        const pubDate = (item.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '';
        const source = (item.match(/<source.*?>(.*?)<\/source>/) || [])[1] || 'Google News';
        const pubTime = pubDate ? new Date(pubDate).getTime() : 0;
        const ageHours = pubTime ? Math.round((Date.now() - pubTime) / 3600000) : 999;
        if (title) allNews.push({ title, link, pubDate: pubDate ? new Date(pubDate).toISOString() : '', source, ageHours });
      });
    }
  } catch (e) { /* ignore */ }

  // Deduplicate by title similarity
  const unique = [];
  const seen = new Set();
  for (const n of allNews) {
    const key = n.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
    if (!seen.has(key)) { seen.add(key); unique.push(n); }
  }

  // Sort by recency
  unique.sort((a, b) => a.ageHours - b.ageHours);

  // Catalyst scoring — based on news freshness and keywords
  let catalystScore = 0;
  const catalystReasons = [];
  const catalystKeywords = ['result', 'earning', 'profit', 'revenue', 'quarterly', 'q4', 'q3', 'q2', 'q1',
    'order', 'contract', 'deal', 'acquisition', 'merger', 'buyback', 'dividend', 'split',
    'upgrade', 'target', 'rating', 'buy', 'outperform', 'overweight',
    'launch', 'expansion', 'approval', 'partnership', 'joint venture',
    'fii', 'dii', 'institutional', 'bulk deal', 'block deal'];
  const negativeKeywords = ['downgrade', 'sell', 'underperform', 'fraud', 'scam', 'fine', 'penalty', 'loss', 'debt', 'default', 'probe', 'investigation'];

  for (const n of unique.slice(0, 10)) {
    const titleLower = n.title.toLowerCase();
    const isCatalyst = catalystKeywords.some(k => titleLower.includes(k));
    const isNegative = negativeKeywords.some(k => titleLower.includes(k));

    if (isCatalyst && n.ageHours <= 24) {
      catalystScore += 15; catalystReasons.push(`🔥 FRESH catalyst (${n.ageHours}h): ${n.title.slice(0, 60)}`);
    } else if (isCatalyst && n.ageHours <= 48) {
      catalystScore += 8; catalystReasons.push(`Recent catalyst (${n.ageHours}h): ${n.title.slice(0, 60)}`);
    } else if (isCatalyst && n.ageHours <= 96) {
      catalystScore += 2; catalystReasons.push(`Older catalyst (${Math.round(n.ageHours / 24)}d): ${n.title.slice(0, 50)}`);
    }
    if (isNegative && n.ageHours <= 72) {
      catalystScore -= 10; catalystReasons.push(`⚠️ Negative news (${n.ageHours}h): ${n.title.slice(0, 60)}`);
    }
  }

  return {
    news: unique.slice(0, 15),
    catalystScore: Math.max(-30, Math.min(30, catalystScore)),
    catalystReasons,
    totalSources: unique.length,
    freshNewsCount: unique.filter(n => n.ageHours <= 48).length
  };
}

module.exports = { fetchStock, fetchFundamentals, fetchMarketData, fetchYahooNews, fetchMultiSourceNews };
