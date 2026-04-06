const express = require("express");
const path = require("path");
const { exec } = require("child_process");

const app = express();
const PORT = process.env.PORT || 8787;

const ADGUARD_BASE = process.env.ADGUARD_BASE || "http://127.0.0.1:3000";
const ADGUARD_USER = process.env.ADGUARD_USER || "";
const ADGUARD_PASS = process.env.ADGUARD_PASS || "";
const STREAMIO_PORT = process.env.STREAMIO_PORT || "11470";
const TV_IP = process.env.TV_IP || "192.168.1.110";

const FRONTEND_DIST = path.join(__dirname, "..", "frontend", "dist");

let marketCache = { ts: 0, data: null };
let externalRateCache = { ts: 0, data: null };
let lastTvSeenAt = 0;

const MARKET_REFRESH_MS = 16 * 60 * 1000;
const RATE_CACHE_MS = 15000;

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

function execPromise(command, timeoutMs = 20000) {
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

function classifyProfile(mbps) {
  if (!mbps || Number.isNaN(mbps) || mbps < 2) return "Idle";
  if (mbps >= 60) return "4K HDR";
  if (mbps >= 30) return "4K";
  if (mbps >= 8) return "1080p";
  return "Low bitrate";
}

async function getLsofLines() {
  try {
    const { stdout } = await execPromise("lsof -nP -iTCP -iUDP", 12000);
    return stdout.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function parseConnectionColumns(line) {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 9) return null;

  const name = parts[0];
  const pid = parts[1];
  const protocol = parts[7];
  const nameField = parts.slice(8).join(" ");

  return { name, pid, protocol, nameField };
}

function countTvConnections(lines) {
  let active = 0;
  let responseMs = 0;

  for (const line of lines) {
    if (!line.includes(TV_IP)) continue;
    if (!line.includes(`:${STREAMIO_PORT}`)) continue;
    if (!line.includes("ESTABLISHED")) continue;
    active += 1;
  }

  if (active > 0) {
    lastTvSeenAt = Date.now();
    responseMs = 20;
  }

  return {
    active,
    recent: lastTvSeenAt > 0 ? Math.round((Date.now() - lastTvSeenAt) / 1000) : null,
    responseMs,
  };
}

function countExternalPeerConnections(lines) {
  let count = 0;

  for (const line of lines) {
    if (!line.includes("ESTABLISHED")) continue;
    if (line.includes(`127.0.0.1`)) continue;
    if (line.includes(TV_IP)) continue;
    if (line.includes(`:${STREAMIO_PORT}`)) continue;
    if (line.includes("->192.168.")) continue;
    if (line.includes("->10.")) continue;
    if (line.includes("->172.16.")) continue;
    if (line.includes("->172.17.")) continue;
    if (line.includes("->172.18.")) continue;
    if (line.includes("->172.19.")) continue;
    if (line.includes("->172.20.")) continue;
    if (line.includes("->172.21.")) continue;
    if (line.includes("->172.22.")) continue;
    if (line.includes("->172.23.")) continue;
    if (line.includes("->172.24.")) continue;
    if (line.includes("->172.25.")) continue;
    if (line.includes("->172.26.")) continue;
    if (line.includes("->172.27.")) continue;
    if (line.includes("->172.28.")) continue;
    if (line.includes("->172.29.")) continue;
    if (line.includes("->172.30.")) continue;
    if (line.includes("->172.31.")) continue;

    count += 1;
  }

  return count;
}

async function sampleExternalRateMbps() {
  if (externalRateCache.data && Date.now() - externalRateCache.ts < RATE_CACHE_MS) {
    return externalRateCache.data;
  }

  try {
    const cmd = `nettop -P -L 1 -J bytes_in,bytes_out -x`;
    const { stdout } = await execPromise(cmd, 15000);
    const lines = stdout.split("\n").filter(Boolean);

    let totalBytesIn = 0;

    for (const line of lines) {
      if (!line.includes(",")) continue;
      if (line.includes(TV_IP)) continue;
      if (line.includes("127.0.0.1")) continue;

      const cols = line.split(",");
      for (const col of cols) {
        const trimmed = col.trim();
        if (/^[0-9]+$/.test(trimmed)) {
          const value = Number(trimmed);
          if (!Number.isNaN(value)) {
            totalBytesIn += value;
            break;
          }
        }
      }
    }

    const mbps = Number(((totalBytesIn * 8) / 1000000).toFixed(2));

    externalRateCache = {
      ts: Date.now(),
      data: mbps,
    };

    return mbps;
  } catch {
    externalRateCache = {
      ts: Date.now(),
      data: 0,
    };
    return 0;
  }
}

async function buildPlaybackStatus() {
  const lines = await getLsofLines();
  const tv = countTvConnections(lines);
  const externalConnections = countExternalPeerConnections(lines);
  const externalMbps = await sampleExternalRateMbps();

  const localStatus = tv.active > 0 ? "TV connected" : "Idle";
  const torrentProfile = classifyProfile(externalMbps);

  let overallProfile = "Idle";
  if (tv.active > 0 && externalMbps >= 60) overallProfile = "4K HDR";
  else if (tv.active > 0 && externalMbps >= 30) overallProfile = "4K";
  else if (tv.active > 0 && externalMbps >= 8) overallProfile = "1080p";
  else if (tv.active > 0) overallProfile = "Low bitrate";

  const stable =
    tv.active > 0 &&
    externalConnections > 0 &&
    overallProfile !== "Idle" &&
    overallProfile === torrentProfile;

  return {
    tvIp: TV_IP,
    tvActive: tv.active > 0,
    tvRecentSeconds: tv.recent,
    localStatus,
    responseMs: tv.responseMs,
    externalConnections,
    externalMbps,
    torrentProfile,
    overallProfile,
    stable,
  };
}

app.get("/api/adguard/stats", async (_req, res) => {
  try {
    const json = await getAdGuard("/control/stats");
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
    const status = await buildPlaybackStatus();
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
