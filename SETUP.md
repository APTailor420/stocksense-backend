# StockSense Pro Backend — Setup Guide

## What This Is
A Vercel serverless backend that powers StockSense Pro. It ports ALL the scoring logic, indicators, and analysis from the HTML frontend into a proper Node.js backend with:
- **Server-side Yahoo Finance fetching** (no more CORS proxy issues!)
- **MongoDB Atlas storage** for scan history and portfolio tracking
- **9-step scoring engine** with all technical indicators
- **Market regime detection** (Nifty 50-DMA + VIX)
- **Beta/Resilience analysis** with auto-downgrade in risk-off markets

---

## Step 1: MongoDB Atlas Setup (Free Tier)

1. Go to [https://www.mongodb.com/atlas](https://www.mongodb.com/atlas)
2. Create a free account → Create a **FREE** cluster (M0 tier, 512MB — plenty for us)
3. Choose **AWS Mumbai (ap-south-1)** for lowest latency from India
4. Set a database username and password (save these!)
5. Under **Network Access** → Add IP: `0.0.0.0/0` (allows Vercel to connect)
6. Click **Connect** → **Drivers** → Copy the connection string
7. It looks like: `mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`

---

## Step 2: GitHub Repository

1. Create a new GitHub repo (e.g. `stocksense-backend`)
2. Push this entire `stocksense-backend/` folder to it:

```bash
cd stocksense-backend
git init
git add .
git commit -m "Initial backend setup"
git remote add origin https://github.com/YOUR_USERNAME/stocksense-backend.git
git push -u origin main
```

---

## Step 3: Vercel Deployment

1. Go to [https://vercel.com](https://vercel.com) and sign in with GitHub
2. Click **"Add New Project"** → Import your `stocksense-backend` repo
3. **Framework Preset**: Select "Other"
4. **Environment Variables** — Add these:
   - `MONGODB_URI` = your MongoDB connection string from Step 1
   - `MONGODB_DB` = `stocksense` (or any name you prefer)
5. Click **Deploy**

Your API will be live at: `https://stocksense-backend-xxxxx.vercel.app`

---

## Step 4: Test Your API

After deployment, test these endpoints:

```
GET  /api/health              → Check DB connection
GET  /api/regime              → Current market regime
POST /api/scan                → Full 150-stock scan (takes ~60-90s)
GET  /api/stock/RELIANCE      → Single stock deep analysis
GET  /api/news/RELIANCE       → Stock news
GET  /api/history             → Scan history list
GET  /api/history?id=xxx      → Single scan details
GET  /api/portfolio            → List portfolio positions
POST /api/portfolio            → Add position
PUT  /api/portfolio            → Update/exit position
GET  /api/watchlist            → List watchlist
POST /api/watchlist            → Add to watchlist
DELETE /api/watchlist?symbol=X → Remove from watchlist
```

### Quick test with curl:

```bash
# Health check
curl https://YOUR-APP.vercel.app/api/health

# Market regime
curl https://YOUR-APP.vercel.app/api/regime

# Single stock analysis
curl https://YOUR-APP.vercel.app/api/stock/RELIANCE

# Full scan (POST)
curl -X POST https://YOUR-APP.vercel.app/api/scan \
  -H "Content-Type: application/json" \
  -d '{"portfolioMode": "offensive"}'

# Add to portfolio
curl -X POST https://YOUR-APP.vercel.app/api/portfolio \
  -H "Content-Type: application/json" \
  -d '{"symbol":"RELIANCE","name":"Reliance Industries","sector":"Energy","entryPrice":2950,"quantity":10,"signal":"Strong Buy","score":75}'
```

---

## API Endpoints Detail

### POST /api/scan
Full universe scan. Body options:
- `portfolioMode`: `"offensive"` (default) or `"defensive"`
- `sector`: `"All"` (default), or specific like `"IT"`, `"Banking"`, etc.
- `save`: `true` (default) — saves scan to MongoDB

### GET /api/stock/:symbol
Deep analysis for one stock. Returns all 9 scoring steps, fundamentals, regime context.

### GET /api/news/:symbol
Aggregated news from Yahoo Finance + Google News RSS (4 parallel queries + MoneyControl).

### Portfolio Management
- `POST /api/portfolio` — Add entry: `{ symbol, entryPrice, quantity, name, sector }`
- `PUT /api/portfolio` — Exit: `{ id, exitPrice }` or Update: `{ id, notes, trailingStop }`
- `GET /api/portfolio?status=active` — Filter active/exited

---

## Architecture

```
stocksense-backend/
├── api/
│   ├── scan.js              → POST /api/scan (full 150-stock scan)
│   ├── regime.js            → GET /api/regime (market regime)
│   ├── health.js            → GET /api/health (DB check)
│   ├── stock/[symbol].js    → GET /api/stock/:sym (deep analysis)
│   ├── news/[symbol].js     → GET /api/news/:sym (aggregated news)
│   ├── history/index.js     → GET /api/history (scan history)
│   ├── portfolio/index.js   → CRUD /api/portfolio
│   └── watchlist/index.js   → CRUD /api/watchlist
├── lib/
│   ├── indicators.js        → All technical indicators (SMA, EMA, RSI, MACD, BB, SuperTrend, VWAP, S/R, Trendline, Beta, ATR, Resilience)
│   ├── scoring.js           → 9-step scoring engine + signal classification
│   ├── yahoo.js             → Server-side Yahoo Finance fetcher
│   ├── regime.js            → Market regime computation
│   ├── universe.js          → 150+ NSE stock universe
│   └── db.js                → MongoDB connection + all collection helpers
├── package.json
├── vercel.json              → Route config + function settings
├── .env.example
└── .gitignore
```

---

## Important Notes

- **Full scan takes 60-120 seconds** because it fetches 150+ stocks from Yahoo Finance with batching. Vercel Pro plan allows up to 300s function duration. Free plan allows 60s max — consider filtering by sector for free tier.
- **All scoring logic is identical** to the v4 HTML tool. Same indicators, same weights, same thresholds.
- **No CORS proxies needed** — server-side requests go directly to Yahoo Finance.
- **MongoDB free tier** gives 512MB — enough for thousands of scans.
