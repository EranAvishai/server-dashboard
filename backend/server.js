const express = require("express");
const path    = require("path");
const { exec, execSync } = require("child_process");

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
let weatherCache  = { ts: 0, data: null };
let thermalsCache = { ts: 0, data: null };
let lsofCache     = { ts: 0, data: [] };
let nettopCache   = { ts: 0, data: 0 };
let lastTvSeenAt  = 0;

const MARKET_TTL_MS   = 16 * 60 * 1000;
const ADGUARD_TTL_MS  =      30 * 1000;
const LSOF_TTL_MS     =      10 * 1000;
const NETTOP_TTL_MS   =      30 * 1000;
const PLAYBACK_TTL_MS =      12 * 1000;
const WEATHER_TTL_MS  =  10 * 60 * 1000;
const THERMALS_TTL_MS =      10 * 1000;

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

async function refreshWeather() {
  try {
    const raw = await httpsGet(WEATHER_URL, 15000);
    const cur = raw?.current ?? raw?.current_weather;
    if (!cur) throw new Error("No current data — response: " + JSON.stringify(raw).slice(0, 200));
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

// ─── Thermals (CPU temp, load, fan speed) ─────────────────────────────────────
async function refreshThermals() {
  try {
    let cpuLoad = null;
    try {
      const topOut = execSync(
        'top -l 2 -s 1 -n 0 2>/dev/null | grep "CPU usage" | tail -1',
        { encoding: "utf8", timeout: 5000 }
      );
      const match = topOut.match(/([\d.]+)% user.*?([\d.]+)% sys/);
      if (match) cpuLoad = Math.round((parseFloat(match[1]) + parseFloat(match[2])) * 10) / 10;
    } catch {}

    let cpuTemp = null;
    try {
      const tempOut = execSync("/usr/local/bin/istats cpu temp --value-only 2>/dev/null", {
        encoding: "utf8", timeout: 3000,
      });
      cpuTemp = parseFloat(tempOut.trim());
      if (isNaN(cpuTemp)) cpuTemp = null;
    } catch {}

    let fanSpeed = null;
    try {
      const fanOut = execSync("/usr/local/bin/istats fan speed --value-only 2>/dev/null", {
        encoding: "utf8", timeout: 3000,
      });
      fanSpeed = parseInt(fanOut.trim());
      if (isNaN(fanSpeed)) fanSpeed = null;
    } catch {}

    thermalsCache = { ts: Date.now(), data: { cpuTemp, cpuLoad, fanSpeed } };
  } catch (e) {
    console.warn("Thermals:", e.message);
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
  const sparkline = closes.filter(v => v != null).slice(-5);
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

// ─── nettop (cached) — TWO samples for real rate, scoped to Stremio PID ────────
async function sampleExternalRateMbps() {
  if (nettopCache.data !== null && Date.now() - nettopCache.ts < NETTOP_TTL_MS) return nettopCache.data;
  try {
    const pidOut = await new Promise(resolve => {
      exec("pgrep -x Stremio || pgrep -x stremio", { timeout: 3000 }, (_, out) => resolve(out || ""));
    });
    const pid = pidOut.trim().split("\n")[0];
    if (!pid) { nettopCache = { ts: Date.now(), data: 0 }; return 0; }

    const { stdout } = await execPromise(
      `nettop -P -L 2 -s 1 -J bytes_in,bytes_out -p ${pid} 2>/dev/null`, 15000
    );
    const lines = stdout.split("\n").filter(l => l.includes(","));
    const deltaLine = lines[lines.length - 1] || "";
    let totalBytes = 0;
    for (const col of deltaLine.split(",")) {
      const t = col.trim();
      if (/^[0-9]+$/.test(t)) { totalBytes += Number(t); break; }
    }
    const mbps = Number(((totalBytes * 8) / 1_000_000).toFixed(2));
    nettopCache = { ts: Date.now(), data: mbps };
    return mbps;
  } catch { nettopCache = { ts: Date.now(), data: 0 }; return 0; }
}

// ─── Stremio ──────────────────────────────────────────────────────────────────
const STREMIO_GRACE_MS = 3 * 60 * 1000;
let lastStremioProcessSeenAt = 0;

// How long a "selected" torrent is still trusted as "now playing" after
// the last time it actually moved bytes. Needed because:
//   1. Stremio's engine leaves a file marked `selected` even after
//      playback has stopped — it doesn't clear this on its own.
//   2. When the TV powers off, it doesn't send a TCP FIN/RST, so the
//      socket can sit as ESTABLISHED in `lsof` for a long time with
//      no traffic at all.
// Selection state and connection state can both lie; only real,
// recent data movement is trustworthy. 90s covers normal buffering
// pauses without leaving a stale "LIVE" badge for minutes after the
// TV is actually off.
const PLAYBACK_ACTIVITY_GRACE_MS = 90 * 1000;
const torrentActivity = new Map(); // infoHash -> { lastDownloaded, lastActivityAt }

// Ground-truth playback state from the local streaming-server
async function fetchStremioStats() {
  try {
    const json = await fetchJson(`http://127.0.0.1:${STREAMIO_PORT}/stats.json`, { timeoutMs: 4000 });
    const seenIds = new Set(Object.keys(json || {}));

    // Prune activity tracking for torrents that no longer exist at all
    for (const id of torrentActivity.keys()) {
      if (!seenIds.has(id)) torrentActivity.delete(id);
    }

    const torrents = Object.entries(json || {}).map(([infoHash, t]) => {
      const wires = Array.isArray(t.wires) ? t.wires : [];
      const downBps = wires.reduce((s, w) => s + (Number(w.downSpeed) || 0), 0);
      const upBps   = wires.reduce((s, w) => s + (Number(w.upSpeed)   || 0), 0);
      const downloadedBytes = Number(t.downloaded) || 0;

      // Detect real activity two ways: instantaneous wire speed right now,
      // or the cumulative downloaded counter having grown since our last
      // poll (catches transfers that happened between samples).
      const prev = torrentActivity.get(infoHash);
      const bytesGrew = prev ? downloadedBytes > prev.lastDownloaded : false;
      const transferringNow = downBps > 0 || upBps > 0 || bytesGrew;
      const lastActivityAt = transferringNow ? Date.now() : (prev?.lastActivityAt || 0);
      torrentActivity.set(infoHash, { lastDownloaded: downloadedBytes, lastActivityAt });
      const recentlyActive = lastActivityAt > 0 && (Date.now() - lastActivityAt) < PLAYBACK_ACTIVITY_GRACE_MS;

      return {
        infoHash,
        title: t.name || infoHash,
        peers: Number(t.peers) || 0,
        swarmConnections: Number(t.swarmConnections) || 0,
        swarmSize:        Number(t.swarmSize) || 0,
        paused: !!t.swarmPaused,
        // A torrent only counts as "now playing" if a file is actually
        // selected for streaming AND it has moved bytes recently.
        // Selection alone isn't enough — see PLAYBACK_ACTIVITY_GRACE_MS
        // above for why.
        selected: Array.isArray(t.selections) && t.selections.length > 0,
        recentlyActive,
        downMbps: Number(((downBps * 8) / 1_000_000).toFixed(2)),
        upMbps:   Number(((upBps   * 8) / 1_000_000).toFixed(2)),
      };
    });

    const candidates = torrents.filter(t => t.selected && t.recentlyActive);
    candidates.sort((a, b) =>
      (b.downMbps + b.upMbps) - (a.downMbps + a.upMbps) || b.peers - a.peers);

    return { torrents, active: candidates[0] || null };
  } catch {
    return null;
  }
}

async function isStremioAlive() {
  const pgrepOut = await new Promise(resolve => {
    exec("pgrep -x Stremio || pgrep -x stremio || pgrep -fi stremio.app",
      { timeout: 3000 }, (_, out) => resolve(out || ""));
  });
  if (pgrepOut.trim().length > 0) { lastStremioProcessSeenAt = Date.now(); return true; }

  const lsofOut = await new Promise(resolve => {
    exec(`lsof -i :${STREAMIO_PORT} -sTCP:LISTEN -n -P 2>/dev/null`,
      { timeout: 4000 }, (_, out) => resolve(out || ""));
  });
  if (lsofOut.trim().length > 0) { lastStremioProcessSeenAt = Date.now(); return true; }

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
    if (!l.includes("ESTABLISHED"))          continue;
    if (!l.includes(`:${STREAMIO_PORT}`))    continue;
    if (PRIVATE.some(r => l.includes(r)))    continue;
    if (l.includes(TV_IP))                   continue;
    n++;
  }
  return n;
}

async function refreshPlayback() {
  try {
    const [stremioAlive, lines, stremioStats] = await Promise.all([
      isStremioAlive(),
      getLsofLines(),
      fetchStremioStats(),
    ]);
    const tv   = countTvConnections(lines);
    const ext  = countExternalPeers(lines);

    // nettop measures OS-level traffic scoped to Stremio PID
    // Stremio stats measure BitTorrent wire speed internally
    // Use nettop when available, fall back to Stremio stats
    const nettopMbps  = await sampleExternalRateMbps();
    const stremioMbps = stremioStats?.active?.downMbps ?? 0;
    const mbps = nettopMbps > 0 ? nettopMbps : stremioMbps;

    // TV is streaming if:
    //   1. TV has ESTABLISHED connection to Stremio port, AND
    //   2. Either data is flowing (mbps > 2) OR there's an active non-paused torrent
    //      (content may be buffered — Stremio serves via HTTP to the TV even when
    //       BitTorrent wires are idle and nettop reads 0)
    const hasActiveTorrent = stremioStats?.active != null && !stremioStats.active.paused;
    const tvStreaming = tv.active > 0 && (mbps > 2 || hasActiveTorrent);

    let overall = "Idle";
    if (tvStreaming) {
      if      (mbps >= 60) overall = "4K HDR";
      else if (mbps >= 30) overall = "4K";
      else if (mbps >= 8)  overall = "1080p";
      else if (mbps >= 2)  overall = "Low bitrate";
      else {
        // mbps is 0 (buffered playback) — infer from title resolution
        const title = (stremioStats?.active?.title || "").toLowerCase();
        if (title.includes("2160p") || title.includes("4k"))   overall = "4K HDR";
        else if (title.includes("1080p"))                       overall = "1080p";
        else if (title.includes("720p"))                        overall = "Low bitrate";
        else                                                    overall = "Low bitrate";
      }
    }

    // Use Stremio stats peer count as fallback for external peers
    const peerCount = ext > 0 ? ext : (stremioStats?.active?.peers ?? 0);
    const nowPlaying = stremioStats?.active ?? null;

    playbackCache = { ts: Date.now(), data: {
      tvIp: TV_IP,
      stremioOpen:     stremioAlive,
      tvActive:        tvStreaming,
      tvRecentSeconds: tv.recent,
      localStatus:     tvStreaming ? "TV streaming" : tv.active > 0 ? "TV connected" : stremioAlive ? "App open" : "Idle",
      responseMs:      tv.responseMs,
      externalConnections: tvStreaming ? peerCount : 0,
      externalMbps:        tvStreaming ? mbps : 0,
      torrentProfile: classifyProfile(mbps),
      overallProfile: overall,
      stable: tvStreaming && peerCount > 0 && overall !== "Idle",
      nowPlaying,
      torrentsTotal: stremioStats?.torrents?.length ?? 0,
    }};
  } catch (e) { console.warn("Playback:", e.message); }
}

// ─── Background loops ─────────────────────────────────────────────────────────
async function startBackgroundRefresh() {
  await Promise.allSettled([
    refreshPlayback(), refreshAdGuard(), refreshMarkets(), refreshWeather(), refreshThermals()
  ]);
  setInterval(refreshPlayback, PLAYBACK_TTL_MS);
  setInterval(refreshAdGuard,  ADGUARD_TTL_MS);
  setInterval(refreshMarkets,  5 * 60 * 1000);
  setInterval(refreshWeather,  WEATHER_TTL_MS);
  setInterval(refreshThermals, THERMALS_TTL_MS);
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get("/api/all", (_req, res) => res.json({
  adguard:   adguardCache.data  ?? null,
  markets:   marketCache.data   ? { assets: marketCache.data } : null,
  streaming: playbackCache.data ?? null,
  weather:   weatherCache.data  ?? null,
  thermals:  thermalsCache.data ?? null,
  ts: Date.now(),
}));

app.get("/api/weather/status", (_req, res) => res.json({
  loaded:     weatherCache.data != null,
  age_s:      weatherCache.ts ? Math.round((Date.now() - weatherCache.ts) / 1000) : null,
  temp:       weatherCache.data?.current_weather?.temperature ?? null,
  retrying:   weatherRetryTimer != null,
  last_error: weatherLastError,
}));

app.get("/api/weather/refresh", async (_req, res) => {
  await refreshWeather();
  res.json({ ok: true, loaded: weatherCache.data != null, ts: weatherCache.ts });
});

app.get("/api/thermals", (_req, res) => res.json(thermalsCache.data ?? null));
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