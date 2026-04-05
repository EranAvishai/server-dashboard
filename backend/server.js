const express = require("express");
const path = require("path");
const { exec } = require("child_process");

const app = express();
const PORT = process.env.PORT || 8787;

const ADGUARD_BASE = process.env.ADGUARD_BASE || "http://127.0.0.1:3000";
const ADGUARD_USER = process.env.ADGUARD_USER || "";
const ADGUARD_PASS = process.env.ADGUARD_PASS || "";
const STREAMIO_PORT = process.env.STREAMIO_PORT || "11470";

const FRONTEND_DIST = path.join(__dirname, "..", "frontend", "dist");

let marketCache = { ts: 0, data: null };
let networkCache = { ts: 0, data: null };

const MARKET_REFRESH_MS = 16 * 60 * 1000;
const NETWORK_REFRESH_MS = 30 * 60 * 1000;

const MARKET_ASSETS = [
  { key: "sp500", label: "S&P 500", symbol: "^GSPC", suffix: "USD" },
  { key: "ta125", label: "TA-125", symbol: "^TA125.TA", suffix: "ILS" },
  { key: "gold", label: "Gold", symbol: "GC=F", suffix: "USD" },
  { key: "btc", label: "Bitcoin", symbol: "BTC-USD", suffix: "USD" },
];

function basicAuthHeader() {
  if (!ADGUARD_USER || !ADGUARD_PASS) return {};
  const token = Buffer.from(`${ADGUARD_USER}:${ADGUARD_PASS}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 8000);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }

    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

function execPromise(command, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    exec(command, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) return reject(error);
      resolve({ stdout, stderr });
    });
  });
}

async function getAdGuard(pathname) {
  return fetchJson(`${ADGUARD_BASE}${pathname}`, {
    headers: {
      ...basicAuthHeader(),
    },
    timeoutMs: 8000,
  });
}

async function fetchYahooQuote(asset) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(asset.symbol)}?interval=1d&range=5d&includePrePost=false&events=div,splits`;

  const json = await fetchJson(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
    },
    timeoutMs: 10000,
  });

  const result = json?.chart?.result?.[0];
  if (!result || !result.meta) {
    throw new Error(`Bad market response for ${asset.symbol}`);
  }

  const meta = result.meta;
  const price = Number(meta.regularMarketPrice ?? meta.previousClose ?? 0);
  const previousClose = Number(meta.chartPreviousClose ?? meta.previousClose ?? 0);

  const changePercent = previousClose
    ? ((price - previousClose) / previousClose) * 100
    : 0;

  const asOf = new Date(
    (meta.regularMarketTime || Math.floor(Date.now() / 1000)) * 1000
  ).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jerusalem",
  });

  return {
    key: asset.key,
    label: asset.label,
    symbol: asset.symbol,
    price,
    changePercent,
    suffix: asset.suffix,
    asOf,
  };
}

async function getMarketQuotes() {
  if (marketCache.data && Date.now() - marketCache.ts < MARKET_REFRESH_MS) {
    return marketCache.data;
  }

  const results = [];
  for (const asset of MARKET_ASSETS) {
    try {
      const quote = await fetchYahooQuote(asset);
      results.push(quote);
    } catch {
      results.push({
        key: asset.key,
        label: asset.label,
        symbol: asset.symbol,
        price: 0,
        changePercent: 0,
        suffix: asset.suffix,
        asOf: "Unavailable",
      });
    }
  }

  marketCache = {
    ts: Date.now(),
    data: results,
  };

  return results;
}

function classifyMbps(mbps) {
  if (!mbps || Number.isNaN(mbps)) return "Unknown";
  if (mbps >= 60) return "Good for 4K HDR";
  if (mbps >= 35) return "Good for 4K";
  if (mbps >= 8) return "Good for 1080p";
  return "Below 1080p target";
}

async function getNetworkSample() {
  if (networkCache.data && Date.now() - networkCache.ts < NETWORK_REFRESH_MS) {
    return networkCache.data;
  }

  try {
    const { stdout } = await execPromise("networkQuality -s", 120000);
    const match = stdout.match(/Download capacity:\s*([0-9.]+)\s*Mbps/i);
    const mbps = match ? Number(match[1]) : 0;

    networkCache = {
      ts: Date.now(),
      data: {
        mbps,
        quality: classifyMbps(mbps),
      },
    };
  } catch {
    networkCache = {
      ts: Date.now(),
      data: {
        mbps: 0,
        quality: "Unknown",
      },
    };
  }

  return networkCache.data;
}

async function checkStreamio() {
  const started = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(`http://127.0.0.1:${STREAMIO_PORT}/`, {
      signal: controller.signal,
    }).catch(() => null);

    clearTimeout(timeout);

    const responseMs = Date.now() - started;
    const network = await getNetworkSample();

    return {
      status: res ? "Up" : "Down",
      responseMs,
      mbps: network.mbps,
      quality: network.quality,
    };
  } catch {
    const network = await getNetworkSample();
    return {
      status: "Down",
      responseMs: 0,
      mbps: network.mbps,
      quality: network.quality,
    };
  }
}

app.get("/api/adguard/stats", async (_req, res) => {
  try {
    const json = await getAdGuard("/control/stats");
    res.json(json);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/adguard/history", async (_req, res) => {
  try {
    const json = await getAdGuard("/control/stats_history");
    res.json(json);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/markets/quotes", async (_req, res) => {
  try {
    const assets = await getMarketQuotes();
    res.json({ assets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/streamio/status", async (_req, res) => {
  try {
    const status = await checkStreamio();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use(express.static(FRONTEND_DIST));

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Not found" });
  }
  res.sendFile(path.join(FRONTEND_DIST, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Dashboard listening on http://127.0.0.1:${PORT}`);
});
