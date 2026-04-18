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
  const closes = (q.close || []).filter(v => v != null);
  const highs = (q.high || []).filter(v => v != null);
  const lows = (q.low || []).filter(v => v != null);
  const volumes = (q.volume || []).filter(v => v != null);
  const timestamps = res.timestamp || [];
  if (closes.length < 30) return null;
  return { meta, closes, highs, lows, volumes, timestamps };
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

module.exports = { fetchStock, fetchFundamentals, fetchMarketData, fetchYahooNews };
