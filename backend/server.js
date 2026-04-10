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

// ─── Caches ───────────────────────────────────────────────────────────────────
let marketCache   = { ts: 0, data: null };
let adguardCache  = { ts: 0, data: null };
let playbackCache = { ts: 0, data: null };
let weatherCache  = { ts: 0, data: null };   // ← fetched server-side, no browser CORS
let lsofCache     = { ts: 0, data: [] };
let nettopCache   = { ts: 0, data: 0 };
let lastTvSeenAt  = 0;

const MARKET_TTL_MS   = 16 * 60 * 1000;
const ADGUARD_TTL_MS  =      30 * 1000;
const LSOF_TTL_MS     =      10 * 1000;
const NETTOP_TTL_MS   =      30 * 1000;
const PLAYBACK_TTL_MS =      12 * 1000;
const WEATHER_TTL_MS  =  10 * 60 * 1000;

const MARKET_ASSETS = [
  { key: "sp500", label: "S&P 500",  symbol: "^GSPC",     suffix: "USD" },
  { key: "ta125", label: "TA-125",   symbol: "^TA125.TA", suffix: "ILS" },
  { key: "gold",  label: "Gold",     symbol: "GC=F",       suffix: "USD" },
  { key: "btc",   label: "Bitcoin",  symbol: "BTC-USD",    suffix: "USD" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function basicAuthHeader() {
  if (!ADGUARD_USER || !ADGUARD_PASS) return {};
  return { Authorization: "Basic " + Buffer.from(`${ADGUARD_USER}:${ADGUARD_PASS}`).toString("base64") };
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 8000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

function execPromise(cmd, ms = 20000) {
  return new Promise((res, rej) => {
    exec(cmd, { timeout: ms }, (err, stdout) => err ? rej(err) : res({ stdout }));
  });
}

// ─── Weather (server-side fetch — avoids any browser CORS issues) ─────────────
// Weather — uses native https module (not fetch) to avoid any proxy/TLS quirks
// GMT+3 = Israel Standard/Summer time, avoids the Asia/Jerusalem slash encoding issue
const https = require("https");
const WEATHER_URL =
  "https://api.open-meteo.com/v1/forecast" +
  "?latitude=31.93&longitude=34.80" +
  "&current=temperature_2m,weathercode,windspeed_10m,is_day" +
  "&daily=weathercode,temperature_2m_max,temperature_2m_min" +
  "&forecast_days=4" +
  "&timezone=auto";

function httpsGet(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "server-dashboard/1.0" } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error("JSON parse failed: " + e.message)); }
      });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error("Timeout")); });
    req.on("error", reject);
  });
}

let weatherRetryTimer = null;
let weatherLastError  = null;

// Try fetching via curl as a fallback — curl works reliably on macOS regardless of Node's network stack
function fetchWeatherViaCurl() {
  return new Promise((resolve, reject) => {
    const url = "https://api.open-meteo.com/v1/forecast?latitude=31.93&longitude=34.80&current_weather=true&daily=weathercode,temperature_2m_max,temperature_2m_min,time&forecast_days=4&timezone=GMT%2B3";
    exec(`curl -fsSL --max-time 15 "${url}"`, { timeout: 20000 }, (err, stdout) => {
      if (err) return reject(new Error("curl: " + err.message));
      try { resolve(JSON.parse(stdout)); }
      catch (e) { reject(new Error("curl JSON parse: " + stdout.slice(0, 120))); }
    });
  });
}

async function refreshWeather() {
  try {
    const raw = await httpsGet(WEATHER_URL, 15000);
    // Support both new API (raw.current) and old API (raw.current_weather)
    const cur = raw?.current ?? raw?.current_weather;
    if (!cur) throw new Error("No current data — response: " + JSON.stringify(raw).slice(0, 200));
    // Normalise to current_weather shape so the frontend doesn't need changes
    const data = {
      ...raw,
      current_weather: {
        temperature: cur.temperature_2m ?? cur.temperature,
        windspeed:   cur.windspeed_10m  ?? cur.windspeed,
        weathercode: cur.weathercode,
        is_day:      cur.is_day ?? 1,
      },
    };
    weatherCache     = { ts: Date.now(), data };
    weatherLastError = null;
    if (weatherRetryTimer) { clearTimeout(weatherRetryTimer); weatherRetryTimer = null; }
    console.log(`Weather OK: ${data.current_weather.temperature}°C code=${data.current_weather.weathercode}`);
  } catch (e) {
    weatherLastError = e.message;
    console.warn("Weather failed:", e.message, "— retry in 30s");
    if (!weatherRetryTimer) {
      weatherRetryTimer = setTimeout(() => { weatherRetryTimer = null; refreshWeather(); }, 30_000);
    }
  }
}

// ─── AdGuard ──────────────────────────────────────────────────────────────────
async function refreshAdGuard() {
  try {
    const data = await fetchJson(`${ADGUARD_BASE}/control/stats`, {
      headers: basicAuthHeader(), timeoutMs: 8000,
    });
    adguardCache = { ts: Date.now(), data };
  } catch (e) { console.warn("AdGuard:", e.message); }
}

// ─── Markets ──────────────────────────────────────────────────────────────────
async function fetchYahooQuote(asset) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(asset.symbol)}` +
              `?interval=1d&range=5d&includePrePost=false&events=div,splits`;
  const json = await fetchJson(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    timeoutMs: 10000,
  });
  const result = json?.chart?.result?.[0];
  if (!result?.meta) throw new Error(`Bad response for ${asset.symbol}`);
  const meta          = result.meta;
  const price         = Number(meta.regularMarketPrice ?? meta.previousClose ?? 0);
  const previousClose = Number(meta.chartPreviousClose ?? meta.previousClose ?? 0);
  const changePercent = previousClose ? ((price - previousClose) / previousClose) * 100 : 0;
  const asOf = new Date((meta.regularMarketTime || Math.floor(Date.now() / 1000)) * 1000)
    .toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jerusalem" });
  const closes    = result.indicators?.quote?.[0]?.close ?? [];
  const sparkline = closes.filter(v => v != null).slice(-5);  // last 5 days
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

// ─── lsof (cached) ────────────────────────────────────────────────────────────
async function getLsofLines() {
  if (lsofCache.data.length && Date.now() - lsofCache.ts < LSOF_TTL_MS) return lsofCache.data;
  try {
    const { stdout } = await execPromise("lsof -nP -iTCP -iUDP", 12000);
    lsofCache = { ts: Date.now(), data: stdout.split("\n").filter(Boolean) };
    return lsofCache.data;
  } catch { lsofCache = { ts: Date.now(), data: [] }; return []; }
}

// ─── nettop (cached) ──────────────────────────────────────────────────────────
async function sampleExternalRateMbps() {
  if (nettopCache.data !== null && Date.now() - nettopCache.ts < NETTOP_TTL_MS) return nettopCache.data;
  try {
    const { stdout } = await execPromise("nettop -P -L 1 -J bytes_in,bytes_out -x", 15000);
    let total = 0;
    for (const line of stdout.split("\n").filter(Boolean)) {
      if (!line.includes(",") || line.includes(TV_IP) || line.includes("127.0.0.1")) continue;
      for (const col of line.split(",")) {
        const t = col.trim();
        if (/^[0-9]+$/.test(t)) { total += Number(t); break; }
      }
    }
    nettopCache = { ts: Date.now(), data: Number(((total * 8) / 1_000_000).toFixed(2)) };
    return nettopCache.data;
  } catch { nettopCache = { ts: Date.now(), data: 0 }; return 0; }
}

// ─── Stremio ──────────────────────────────────────────────────────────────────
// Grace period: keep reporting "active" for 3 min after last confirmed connection
// This covers brief buffering gaps without spamming pgrep every poll
const STREMIO_GRACE_MS = 3 * 60 * 1000;
let lastStremioProcessSeenAt = 0;

// Three independent signals — any one positive = Stremio is alive
// Runs in parallel with lsof so no extra latency
async function isStremioAlive() {
  // Signal 1: process running (works even when idle, zero-cost)
  const pgrepOut = await new Promise(resolve => {
    exec("pgrep -x Stremio || pgrep -x stremio || pgrep -fi stremio.app",
      { timeout: 3000 }, (_, out) => resolve(out || ""));
  });
  if (pgrepOut.trim().length > 0) { lastStremioProcessSeenAt = Date.now(); return true; }

  // Signal 2: port is bound (confirms server is up)
  const lsofOut = await new Promise(resolve => {
    exec(`lsof -i :${STREAMIO_PORT} -sTCP:LISTEN -n -P 2>/dev/null`,
      { timeout: 4000 }, (_, out) => resolve(out || ""));
  });
  if (lsofOut.trim().length > 0) { lastStremioProcessSeenAt = Date.now(); return true; }

  // Signal 3: grace period (covers buffering gaps / screensaver)
  if (lastStremioProcessSeenAt > 0 &&
      Date.now() - lastStremioProcessSeenAt < STREMIO_GRACE_MS) return true;

  return false;
}

function classifyProfile(mbps) {
  if (!mbps || isNaN(mbps) || mbps < 2) return "Idle";
  if (mbps >= 60) return "4K HDR";
  if (mbps >= 30) return "4K";
  if (mbps >= 8)  return "1080p";
  return "Low bitrate";
}

const PRIVATE = ["127.0.0.1","->192.168.","->10.",
  ...Array.from({length:16},(_,i)=>`->172.${16+i}.`)];

function countTvConnections(lines) {
  let n = 0;
  for (const l of lines) {
    if (l.includes(TV_IP) && l.includes(`:${STREAMIO_PORT}`) && l.includes("ESTABLISHED")) n++;
  }
  if (n > 0) lastTvSeenAt = Date.now();
  return { active: n, recent: lastTvSeenAt > 0 ? Math.round((Date.now()-lastTvSeenAt)/1000) : null, responseMs: n > 0 ? 20 : 0 };
}

function countExternalPeers(lines) {
  let n = 0;
  for (const l of lines) {
    if (!l.includes("ESTABLISHED")) continue;
    if (PRIVATE.some(r=>l.includes(r)) || l.includes(TV_IP) || l.includes(`:${STREAMIO_PORT}`)) continue;
    n++;
  }
  return n;
}

async function refreshPlayback() {
  try {
    // Run process check and lsof in parallel — no extra latency
    const [stremioAlive, lines] = await Promise.all([
      isStremioAlive(),
      getLsofLines(),
    ]);
    const tv    = countTvConnections(lines);
    const ext   = countExternalPeers(lines);
    const mbps  = await sampleExternalRateMbps();
    const tpro  = classifyProfile(mbps);
    let overall = "Idle";
    if      (tv.active>0 && mbps>=60) overall = "4K HDR";
    else if (tv.active>0 && mbps>=30) overall = "4K";
    else if (tv.active>0 && mbps>=8)  overall = "1080p";
    else if (tv.active>0)             overall = "Low bitrate";
    playbackCache = { ts: Date.now(), data: {
      tvIp: TV_IP,
      stremioOpen:     stremioAlive,
      tvActive:        tv.active > 0,
      tvRecentSeconds: tv.recent,
      localStatus:     tv.active > 0 ? "TV connected" : stremioAlive ? "App open" : "Idle",
      responseMs:      tv.responseMs,
      externalConnections: ext, externalMbps: mbps,
      torrentProfile: tpro, overallProfile: overall,
      stable: tv.active>0 && ext>0 && overall!=="Idle" && overall===tpro,
    }};
  } catch (e) { console.warn("Playback:", e.message); }
}

// ─── Background loops ─────────────────────────────────────────────────────────
async function startBackgroundRefresh() {
  await Promise.allSettled([
    refreshPlayback(), refreshAdGuard(), refreshMarkets(), refreshWeather()
  ]);
  setInterval(refreshPlayback, PLAYBACK_TTL_MS);
  setInterval(refreshAdGuard,  ADGUARD_TTL_MS);
  setInterval(refreshMarkets,  5 * 60 * 1000);
  setInterval(refreshWeather,  WEATHER_TTL_MS);
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get("/api/all", (_req, res) => res.json({
  adguard:   adguardCache.data  ?? null,
  markets:   marketCache.data   ? { assets: marketCache.data } : null,
  streaming: playbackCache.data ?? null,
  weather:   weatherCache.data  ?? null,   // ← now included
  ts: Date.now(),
}));

// Debug — open http://127.0.0.1:8787/api/weather/status to see what's happening
app.get("/api/weather/status", (_req, res) => res.json({
  loaded:     weatherCache.data != null,
  age_s:      weatherCache.ts ? Math.round((Date.now() - weatherCache.ts) / 1000) : null,
  temp:       weatherCache.data?.current_weather?.temperature ?? null,
  retrying:   weatherRetryTimer != null,
  last_error: weatherLastError,   // ← now shows exactly what's failing
}));

// Force-refresh weather on demand — hit this in browser if weather ever gets stuck
app.get("/api/weather/refresh", async (_req, res) => {
  await refreshWeather();
  res.json({ ok: true, loaded: weatherCache.data != null, ts: weatherCache.ts });
});

app.get("/api/adguard/stats",   (_req, res) => res.json(adguardCache.data  ?? {}));
app.get("/api/markets/quotes",  (_req, res) => res.json({ assets: marketCache.data ?? [] }));
app.get("/api/streamio/status", (_req, res) => res.json(playbackCache.data ?? {}));
app.get("/api/weather",         (_req, res) => res.json(weatherCache.data  ?? null));
app.get("/health",              (_req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()) + "s" }));

app.use(express.static(FRONTEND_DIST));
app.use((req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
  res.sendFile(path.join(FRONTEND_DIST, "index.html"));
});

startBackgroundRefresh().then(() =>
  app.listen(PORT, () => console.log(`Dashboard on http://127.0.0.1:${PORT}`))
);