const express = require("express");
const path    = require("child_process");
const { exec } = require("child_process");

const app = express();
const PORT = process.env.PORT || 8787;

const ADGUARD_BASE  = process.env.ADGUARD_BASE   || "http://127.0.0.1:3000";
const ADGUARD_USER  = process.env.ADGUARD_USER   || "";
const ADGUARD_PASS  = process.env.ADGUARD_PASS   || "";
const STREAMIO_PORT = process.env.STREAMIO_PORT  || "11470";
const TV_IP         = process.env.TV_IP          || "192.168.1.110";
const FRONTEND_DIST = require("path").join(__dirname, "..", "frontend", "dist");

// ─── Caches ───────────────────────────────────────────────────────────────────
let marketCache   = { ts: 0, data: null };
let adguardCache  = { ts: 0, data: null };
let playbackCache = { ts: 0, data: null };
let lsofCache     = { ts: 0, data: [] };
let nettopCache   = { ts: 0, data: 0 };
let lastTvSeenAt  = 0;

const MARKET_TTL_MS   = 16 * 60 * 1000;
const ADGUARD_TTL_MS  =      30 * 1000;
const LSOF_TTL_MS     =      10 * 1000;
const NETTOP_TTL_MS   =      30 * 1000;
const PLAYBACK_TTL_MS =      12 * 1000;

const MARKET_ASSETS = [
  { key: "sp500", label: "S&P 500",  symbol: "^GSPC",    suffix: "USD" },
  { key: "ta125", label: "TA-125",   symbol: "^TA125.TA", suffix: "ILS" },
  { key: "gold",  label: "Gold",     symbol: "GC=F",      suffix: "USD" },
  { key: "btc",   label: "Bitcoin",  symbol: "BTC-USD",   suffix: "USD" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function basicAuthHeader() {
  if (!ADGUARD_USER || !ADGUARD_PASS) return {};
  return { Authorization: "Basic " + Buffer.from(`${ADGUARD_USER}:${ADGUARD_PASS}`).toString("base64") };
}

async function fetchJson(url, options = {}) {
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), options.timeoutMs || 8000);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } finally { clearTimeout(t); }
}

function execPromise(cmd, ms = 20000) {
  return new Promise((res, rej) => exec(cmd, { timeout: ms }, (err, out) => err ? rej(err) : res({ stdout: out })));
}

// ─── AdGuard ──────────────────────────────────────────────────────────────────
async function refreshAdGuard() {
  try {
    adguardCache = { ts: Date.now(), data: await fetchJson(`${ADGUARD_BASE}/control/stats`, { headers: basicAuthHeader(), timeoutMs: 8000 }) };
  } catch (e) { console.warn("AdGuard:", e.message); }
}

// ─── Markets + sparkline ──────────────────────────────────────────────────────
async function fetchYahooQuote(asset) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(asset.symbol)}?interval=1d&range=5d&includePrePost=false&events=div,splits`;
  const json = await fetchJson(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" }, timeoutMs: 10000 });
  const result = json?.chart?.result?.[0];
  if (!result?.meta) throw new Error(`Bad response for ${asset.symbol}`);

  const meta          = result.meta;
  const price         = Number(meta.regularMarketPrice ?? meta.previousClose ?? 0);
  const previousClose = Number(meta.chartPreviousClose ?? meta.previousClose ?? 0);
  const changePercent = previousClose ? ((price - previousClose) / previousClose) * 100 : 0;
  const asOf = new Date((meta.regularMarketTime || Date.now()/1000) * 1000)
    .toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jerusalem" });

  // Sparkline — closing prices from the chart data (last ~5 daily candles)
  // This powers the small direction graph in the rotating stocks tile.
  const closes    = result.indicators?.quote?.[0]?.close ?? [];
  const sparkline = closes.filter(c => c != null).slice(-5)
    .map(c => parseFloat(Number(c).toFixed(asset.key === "btc" ? 0 : 2)));

  return { key: asset.key, label: asset.label, symbol: asset.symbol, price, changePercent, suffix: asset.suffix, asOf, sparkline };
}

async function refreshMarkets() {
  if (marketCache.data && Date.now() - marketCache.ts < MARKET_TTL_MS) return;
  const results = [];
  for (const asset of MARKET_ASSETS) {
    try { results.push(await fetchYahooQuote(asset)); }
    catch { results.push({ key: asset.key, label: asset.label, symbol: asset.symbol, price: 0, changePercent: 0, suffix: asset.suffix, asOf: "—", sparkline: [] }); }
  }
  marketCache = { ts: Date.now(), data: results };
}

// ─── lsof (cached 10 s) ───────────────────────────────────────────────────────
async function getLsofLines() {
  if (lsofCache.data.length && Date.now() - lsofCache.ts < LSOF_TTL_MS) return lsofCache.data;
  try {
    const { stdout } = await execPromise("lsof -nP -iTCP -iUDP", 12000);
    lsofCache = { ts: Date.now(), data: stdout.split("\n").filter(Boolean) };
  } catch { lsofCache = { ts: Date.now(), data: [] }; }
  return lsofCache.data;
}

// ─── nettop (cached 30 s) ─────────────────────────────────────────────────────
async function sampleExternalRateMbps() {
  if (nettopCache.data !== null && Date.now() - nettopCache.ts < NETTOP_TTL_MS) return nettopCache.data;
  try {
    const { stdout } = await execPromise("nettop -P -L 1 -J bytes_in,bytes_out -x", 15000);
    let total = 0;
    for (const line of stdout.split("\n")) {
      if (!line.includes(",") || line.includes(TV_IP) || line.includes("127.0.0.1")) continue;
      for (const col of line.split(",")) {
        const v = col.trim();
        if (/^[0-9]+$/.test(v)) { total += Number(v); break; }
      }
    }
    nettopCache = { ts: Date.now(), data: Number(((total * 8) / 1e6).toFixed(2)) };
  } catch { nettopCache = { ts: Date.now(), data: 0 }; }
  return nettopCache.data;
}

// ─── Playback ─────────────────────────────────────────────────────────────────
function classifyProfile(mbps) {
  if (!mbps || isNaN(mbps) || mbps < 2) return "Idle";
  if (mbps >= 60) return "4K HDR";
  if (mbps >= 30) return "4K";
  if (mbps >= 8)  return "1080p";
  return "Low bitrate";
}

const PRIVATE = ["127.0.0.1","->192.168.","->10.",...Array.from({length:16},(_,i)=>`->172.${16+i}.`)];

async function refreshPlayback() {
  try {
    const lines = await getLsofLines();
    let tvActive = 0;
    for (const l of lines) {
      if (l.includes(TV_IP) && l.includes(`:${STREAMIO_PORT}`) && l.includes("ESTABLISHED")) tvActive++;
    }
    if (tvActive > 0) lastTvSeenAt = Date.now();
    const tvRecentSeconds = lastTvSeenAt > 0 ? Math.round((Date.now() - lastTvSeenAt) / 1000) : null;

    let extConns = 0;
    for (const l of lines) {
      if (!l.includes("ESTABLISHED")) continue;
      if (PRIVATE.some(p => l.includes(p))) continue;
      if (l.includes(TV_IP) || l.includes(`:${STREAMIO_PORT}`)) continue;
      extConns++;
    }

    const externalMbps   = await sampleExternalRateMbps();
    const torrentProfile = classifyProfile(externalMbps);
    let overallProfile   = "Idle";
    if      (tvActive > 0 && externalMbps >= 60) overallProfile = "4K HDR";
    else if (tvActive > 0 && externalMbps >= 30) overallProfile = "4K";
    else if (tvActive > 0 && externalMbps >= 8)  overallProfile = "1080p";
    else if (tvActive > 0)                        overallProfile = "Low bitrate";

    playbackCache = { ts: Date.now(), data: {
      tvIp: TV_IP, tvActive: tvActive > 0, tvRecentSeconds,
      localStatus: tvActive > 0 ? "TV connected" : "Idle",
      responseMs: tvActive > 0 ? 20 : 0,
      externalConnections: extConns, externalMbps, torrentProfile, overallProfile,
      stable: tvActive > 0 && extConns > 0 && overallProfile !== "Idle" && overallProfile === torrentProfile,
    }};
  } catch (e) { console.warn("Playback:", e.message); }
}

// ─── Background refresh ───────────────────────────────────────────────────────
async function startBackgroundRefresh() {
  await Promise.allSettled([refreshPlayback(), refreshAdGuard(), refreshMarkets()]);
  setInterval(refreshPlayback, PLAYBACK_TTL_MS);
  setInterval(refreshAdGuard,  ADGUARD_TTL_MS);
  setInterval(refreshMarkets,  5 * 60 * 1000);
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get("/api/all", (_req, res) => res.json({
  adguard:   adguardCache.data  ?? null,
  markets:   marketCache.data   ? { assets: marketCache.data } : null,
  streaming: playbackCache.data ?? null,
  ts: Date.now(),
}));

app.get("/api/adguard/stats",   (_req, res) => res.json(adguardCache.data  ?? {}));
app.get("/api/markets/quotes",  (_req, res) => res.json({ assets: marketCache.data ?? [] }));
app.get("/api/streamio/status", (_req, res) => res.json(playbackCache.data ?? {}));
app.get("/health",              (_req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()) + "s" }));

app.use(express.static(FRONTEND_DIST));
app.use((req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
  res.sendFile(require("path").join(FRONTEND_DIST, "index.html"));
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
startBackgroundRefresh().then(() => {
  app.listen(PORT, () => console.log(`Dashboard → http://127.0.0.1:${PORT}`));
});