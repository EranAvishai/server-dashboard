const express = require("express");
const path    = require("path");
const { exec } = require("child_process");

const app = express();
const PORT = process.env.PORT || 8787;

const ADGUARD_BASE  = process.env.ADGUARD_BASE   || "http://127.0.0.1:3000";
const ADGUARD_USER  = process.env.ADGUARD_USER   || "";
const ADGUARD_PASS  = process.env.ADGUARD_PASS   || "";
const STREAMIO_PORT = process.env.STREAMIO_PORT  || "11470";
const TV_IP         = process.env.TV_IP          || "192.168.1.110";
const FRONTEND_DIST = path.join(__dirname, "..", "frontend", "dist");

// ─── Cache buckets ────────────────────────────────────────────────────────────
let marketCache   = { ts: 0, data: null };
let adguardCache  = { ts: 0, data: null };
let playbackCache = { ts: 0, data: null };
let lsofCache     = { ts: 0, data: [] };
let nettopCache   = { ts: 0, data: 0 };
let lastTvSeenAt  = 0;

// ─── TTLs ─────────────────────────────────────────────────────────────────────
const MARKET_TTL_MS   = 16 * 60 * 1000;   // 16 min
const ADGUARD_TTL_MS  =      30 * 1000;   // 30 s
const LSOF_TTL_MS     =      10 * 1000;   // 10 s  — was per-request before
const NETTOP_TTL_MS   =      30 * 1000;   // 30 s  — nettop is expensive
const PLAYBACK_TTL_MS =      12 * 1000;   // 12 s  — pre-computed on timer

// ─── Market assets ────────────────────────────────────────────────────────────
const MARKET_ASSETS = [
  { key: "sp500", label: "S&P 500",  symbol: "^GSPC",    suffix: "USD" },
  { key: "ta125", label: "TA-125",   symbol: "^TA125.TA", suffix: "ILS" },
  { key: "gold",  label: "Gold",     symbol: "GC=F",      suffix: "USD" },
  { key: "btc",   label: "Bitcoin",  symbol: "BTC-USD",   suffix: "USD" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function basicAuthHeader() {
  if (!ADGUARD_USER || !ADGUARD_PASS) return {};
  const token = Buffer.from(`${ADGUARD_USER}:${ADGUARD_PASS}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 8000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
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

// ─── AdGuard ──────────────────────────────────────────────────────────────────
// The full /control/stats response includes dns_queries[] and blocked_filtering[]
// — 24-element hourly arrays that power the frontend chart.
// We pass the entire JSON through so the chart always has fresh data.
async function refreshAdGuard() {
  try {
    const data = await fetchJson(`${ADGUARD_BASE}/control/stats`, {
      headers: basicAuthHeader(),
      timeoutMs: 8000,
    });
    adguardCache = { ts: Date.now(), data };
  } catch (err) {
    console.warn("AdGuard refresh failed:", err.message);
  }
}

// ─── Markets ──────────────────────────────────────────────────────────────────
async function fetchYahooQuote(asset) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(asset.symbol)}` +
    `?interval=1d&range=5d&includePrePost=false&events=div,splits`;

  const json = await fetchJson(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    timeoutMs: 10000,
  });

  const result = json?.chart?.result?.[0];
  if (!result?.meta) throw new Error(`Bad market response for ${asset.symbol}`);

  const meta          = result.meta;
  const price         = Number(meta.regularMarketPrice ?? meta.previousClose ?? 0);
  const previousClose = Number(meta.chartPreviousClose ?? meta.previousClose ?? 0);
  const changePercent = previousClose ? ((price - previousClose) / previousClose) * 100 : 0;
  const asOf = new Date(
    (meta.regularMarketTime || Math.floor(Date.now() / 1000)) * 1000
  ).toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jerusalem",
  });

  return { key: asset.key, label: asset.label, symbol: asset.symbol, price, changePercent, suffix: asset.suffix, asOf };
}

async function refreshMarkets() {
  if (marketCache.data && Date.now() - marketCache.ts < MARKET_TTL_MS) return;
  const results = [];
  for (const asset of MARKET_ASSETS) {
    try {
      results.push(await fetchYahooQuote(asset));
    } catch {
      results.push({ key: asset.key, label: asset.label, symbol: asset.symbol, price: 0, changePercent: 0, suffix: asset.suffix, asOf: "—" });
    }
  }
  marketCache = { ts: Date.now(), data: results };
}

// ─── lsof — cached, NOT run per-request ──────────────────────────────────────
async function getLsofLines() {
  if (lsofCache.data.length && Date.now() - lsofCache.ts < LSOF_TTL_MS) {
    return lsofCache.data;
  }
  try {
    const { stdout } = await execPromise("lsof -nP -iTCP -iUDP", 12000);
    const lines = stdout.split("\n").filter(Boolean);
    lsofCache = { ts: Date.now(), data: lines };
    return lines;
  } catch {
    lsofCache = { ts: Date.now(), data: [] };
    return [];
  }
}

// ─── nettop — cached, NOT run per-request ─────────────────────────────────────
async function sampleExternalRateMbps() {
  if (nettopCache.data !== null && Date.now() - nettopCache.ts < NETTOP_TTL_MS) {
    return nettopCache.data;
  }
  try {
    const { stdout } = await execPromise("nettop -P -L 1 -J bytes_in,bytes_out -x", 15000);
    const lines = stdout.split("\n").filter(Boolean);
    let totalBytesIn = 0;
    for (const line of lines) {
      if (!line.includes(",")) continue;
      if (line.includes(TV_IP) || line.includes("127.0.0.1")) continue;
      const cols = line.split(",");
      for (const col of cols) {
        const trimmed = col.trim();
        if (/^[0-9]+$/.test(trimmed)) { totalBytesIn += Number(trimmed); break; }
      }
    }
    const mbps = Number(((totalBytesIn * 8) / 1_000_000).toFixed(2));
    nettopCache = { ts: Date.now(), data: mbps };
    return mbps;
  } catch {
    nettopCache = { ts: Date.now(), data: 0 };
    return 0;
  }
}

// ─── Stremio / TV parsing ─────────────────────────────────────────────────────
function classifyProfile(mbps) {
  if (!mbps || isNaN(mbps) || mbps < 2) return "Idle";
  if (mbps >= 60) return "4K HDR";
  if (mbps >= 30) return "4K";
  if (mbps >= 8)  return "1080p";
  return "Low bitrate";
}

function countTvConnections(lines) {
  let active = 0;
  for (const line of lines) {
    if (!line.includes(TV_IP))              continue;
    if (!line.includes(`:${STREAMIO_PORT}`)) continue;
    if (!line.includes("ESTABLISHED"))      continue;
    active++;
  }
  if (active > 0) lastTvSeenAt = Date.now();
  return {
    active,
    recent: lastTvSeenAt > 0 ? Math.round((Date.now() - lastTvSeenAt) / 1000) : null,
    responseMs: active > 0 ? 20 : 0,
  };
}

// Private IP ranges to skip when counting external peers
const PRIVATE = [
  "127.0.0.1",
  "->192.168.",
  "->10.",
  ...Array.from({ length: 16 }, (_, i) => `->172.${16 + i}.`),
];

function countExternalPeerConnections(lines) {
  let count = 0;
  for (const line of lines) {
    if (!line.includes("ESTABLISHED")) continue;
    if (PRIVATE.some((r) => line.includes(r))) continue;
    if (line.includes(TV_IP))                  continue;
    if (line.includes(`:${STREAMIO_PORT}`))    continue;
    count++;
  }
  return count;
}

// ─── Playback — pre-computed on a timer, served from cache ────────────────────
async function refreshPlayback() {
  try {
    const lines              = await getLsofLines();
    const tv                 = countTvConnections(lines);
    const externalConnections = countExternalPeerConnections(lines);
    const externalMbps       = await sampleExternalRateMbps();
    const torrentProfile     = classifyProfile(externalMbps);

    let overallProfile = "Idle";
    if      (tv.active > 0 && externalMbps >= 60) overallProfile = "4K HDR";
    else if (tv.active > 0 && externalMbps >= 30) overallProfile = "4K";
    else if (tv.active > 0 && externalMbps >= 8)  overallProfile = "1080p";
    else if (tv.active > 0)                        overallProfile = "Low bitrate";

    const stable = tv.active > 0 && externalConnections > 0 &&
                   overallProfile !== "Idle" && overallProfile === torrentProfile;

    playbackCache = {
      ts: Date.now(),
      data: {
        tvIp: TV_IP, tvActive: tv.active > 0, tvRecentSeconds: tv.recent,
        localStatus: tv.active > 0 ? "TV connected" : "Idle",
        responseMs: tv.responseMs, externalConnections, externalMbps,
        torrentProfile, overallProfile, stable,
      },
    };
  } catch (err) {
    console.warn("Playback refresh failed:", err.message);
  }
}

// ─── Background refresh loop ──────────────────────────────────────────────────
// All heavy work (lsof, nettop, network calls) runs on timers.
// API endpoints only read from memory — MacBook stays cool under sustained polling.
async function startBackgroundRefresh() {
  await Promise.allSettled([refreshPlayback(), refreshAdGuard(), refreshMarkets()]);

  setInterval(refreshPlayback, PLAYBACK_TTL_MS);
  setInterval(refreshAdGuard,  ADGUARD_TTL_MS);
  setInterval(refreshMarkets,  5 * 60 * 1000);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Single combined endpoint — frontend makes ONE request per tick
app.get("/api/all", (_req, res) => {
  res.json({
    adguard:   adguardCache.data  ?? null,
    markets:   marketCache.data   ? { assets: marketCache.data } : null,
    streaming: playbackCache.data ?? null,
    ts: Date.now(),
  });
});

// Individual endpoints kept for debugging / health checks
app.get("/api/adguard/stats",   (_req, res) => res.json(adguardCache.data  ?? {}));
app.get("/api/markets/quotes",  (_req, res) => res.json({ assets: marketCache.data ?? [] }));
app.get("/api/streamio/status", (_req, res) => res.json(playbackCache.data ?? {}));

app.get("/health", (_req, res) =>
  res.json({ ok: true, uptime: Math.round(process.uptime()) + "s" })
);

app.use(express.static(FRONTEND_DIST));
app.use((req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
  res.sendFile(path.join(FRONTEND_DIST, "index.html"));
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
startBackgroundRefresh().then(() => {
  app.listen(PORT, () => {
    console.log(`Dashboard listening on http://127.0.0.1:${PORT}`);
  });
});