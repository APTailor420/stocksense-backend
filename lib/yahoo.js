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
  return { meta, closes: validCloses, highs: validHighs, lows: validLows, volumes: validVolumes, timestamps: ohlcv.map(d => d.t), ohlcv };
