const express = require("express");
const path    = require("path");
const { exec } = require("child_process");

const app  = express();
const PORT = process.env.PORT || 8787;

const ADGUARD_BASE  = process.env.ADGUARD_BASE  || "http://127.0.0.1:3000";
const ADGUARD_USER  = process.env.ADGUARD_USER  || "";
const ADGUARD_PASS  = process.env.ADGUARD_PASS  || "";
const STREAMIO_PORT = process.env.STREAMIO_PORT || "11470";
const TV_IP         = process.env.TV_IP         || "192.168.1.110";
const FRONTEND_DIST = path.join(__dirname, "..", "frontend", "dist");

// ─── TTLs ─────────────────────────────────────────────────────────────────────
const MARKET_TTL_MS   = 16 * 60 * 1000;
const ADGUARD_TTL_MS  = 30 * 1000;
const PLAYBACK_TTL_MS = 15 * 1000;
const LSOF_TTL_MS     = 10 * 1000;
const NETTOP_TTL_MS   = 30 * 1000;

// How long (ms) to keep Stremio "active" after the last confirmed connection
// even if lsof stops seeing it. 3 minutes handles brief idle gaps.
const STREMIO_GRACE_MS = 3 * 60 * 1000;

// ─── Cache buckets ────────────────────────────────────────────────────────────
let marketCache   = { ts: 0, data: null };
let adguardCache  = { ts: 0, data: null };
let playbackCache = { ts: 0, data: null };
let lsofCache     = { ts: 0, data: [] };
let nettopCache   = { ts: 0, data: 0 };
let lastTvSeenAt  = 0;       // last time TV_IP had an ESTABLISHED connection
let lastStremioProcessSeenAt = 0; // last time Stremio process was alive

// ─── Helpers ──────────────────────────────────────────────────────────────────
function run(cmd, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const child = exec(cmd, { timeout: timeoutMs }, (err, stdout) => {
      resolve(err ? "" : stdout);
    });
    // ensure no zombie on timeout
    child.on("error", () => resolve(""));
  });
}

// ─── Stremio process detection ───────────────────────────────────────────────
// Uses THREE independent signals and treats any single positive as "alive":
//
//   1. pgrep  – Is the Stremio process running? (most reliable, zero cost)
//   2. lsof   – Is port 11470 actively bound? (reliable when streaming)
//   3. grace  – Was it seen recently? (covers brief idle/buffering gaps)
//
async function isStremioAlive() {
  // Signal 1: process exists (works even when idle, no active stream)
  const pgrepOut = await run("pgrep -x Stremio || pgrep -x stremio || pgrep -fi stremio.app", 3000);
  if (pgrepOut.trim().length > 0) {
    lastStremioProcessSeenAt = Date.now();
    return true;
  }

  // Signal 2: port is bound (confirms the server is up)
  const lsofOut = await run(`lsof -i :${STREAMIO_PORT} -sTCP:LISTEN -n -P 2>/dev/null`, 4000);
  if (lsofOut.trim().length > 0) {
    lastStremioProcessSeenAt = Date.now();
    return true;
  }

  // Signal 3: grace period – if Stremio was alive within the last 3 minutes,
  // keep reporting it as active (handles buffering gaps, screensaver, etc.)
  if (lastStremioProcessSeenAt > 0) {
    const msSinceSeen = Date.now() - lastStremioProcessSeenAt;
    if (msSinceSeen < STREMIO_GRACE_MS) {
      return true; // still within grace window
    }
  }

  return false;
}

// ─── lsof full connection list (cached) ──────────────────────────────────────
async function getLsofLines() {
  if (lsofCache.data.length && Date.now() - lsofCache.ts < LSOF_TTL_MS) {
    return lsofCache.data;
  }
  const raw = await run(
    `lsof -nP -iTCP:${STREAMIO_PORT} -iUDP 2>/dev/null`,
    6000
  );
  const lines = raw ? raw.split("\n").filter(Boolean) : [];
  lsofCache = { ts: Date.now(), data: lines };
  return lines;
}

// ─── nettop sampling (cached, 30s TTL) ───────────────────────────────────────
async function sampleExternalRateMbps() {
  if (Date.now() - nettopCache.ts < NETTOP_TTL_MS) return nettopCache.data;
  try {
    const raw = await run("nettop -P -L 1 -t external -k time,bytes_in 2>/dev/null", 6000);
    let totalBytesIn = 0;
    for (const line of raw.split("\n").slice(1)) {
      const cols = line.split(",");
      for (const col of cols) {
        const trimmed = col.trim();
        if (/^\d+$/.test(trimmed)) { totalBytesIn += Number(trimmed); break; }
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

// ─── Profile classification ───────────────────────────────────────────────────
function classifyProfile(mbps) {
  if (!mbps || isNaN(mbps) || mbps < 2) return "Idle";
  if (mbps >= 60) return "4K HDR";
  if (mbps >= 30) return "4K";
  if (mbps >= 8)  return "1080p";
  return "Low bitrate";
}

// ─── TV connection counting ───────────────────────────────────────────────────
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

const PRIVATE_RANGES = [
  "127.0.0.1", "->192.168.", "->10.",
  ...Array.from({ length: 16 }, (_, i) => `->172.${16 + i}.`),
];

function countExternalPeerConnections(lines) {
  let count = 0;
  for (const line of lines) {
    if (!line.includes("ESTABLISHED"))                       continue;
    if (PRIVATE_RANGES.some((r) => line.includes(r)))       continue;
    if (line.includes(TV_IP))                               continue;
    if (line.includes(`:${STREAMIO_PORT}`))                 continue;
    count++;
  }
  return count;
}

// ─── Playback refresh (background) ───────────────────────────────────────────
async function refreshPlayback() {
  try {
    // Run process check and connection check in parallel
    const [stremioAlive, lines] = await Promise.all([
      isStremioAlive(),
      getLsofLines(),
    ]);

    const tv                  = countTvConnections(lines);
    const externalConnections = countExternalPeerConnections(lines);
    const externalMbps        = await sampleExternalRateMbps();
    const torrentProfile      = classifyProfile(externalMbps);

    let overallProfile = "Idle";
    if      (tv.active > 0 && externalMbps >= 60) overallProfile = "4K HDR";
    else if (tv.active > 0 && externalMbps >= 30) overallProfile = "4K";
    else if (tv.active > 0 && externalMbps >= 8)  overallProfile = "1080p";
    else if (tv.active > 0)                        overallProfile = "Low bitrate";

    const stable = tv.active > 0 && externalConnections > 0 &&
                   overallProfile !== "Idle" && overallProfile === torrentProfile;

    // stremioAlive = true means the app is open (even if no active stream)
    // tvActive     = true means the TV is actively receiving data right now
    playbackCache = {
      ts: Date.now(),
      data: {
        tvIp:            TV_IP,
        stremioOpen:     stremioAlive,          // NEW: app is running
        tvActive:        tv.active > 0,         // TV has active connection
        tvRecentSeconds: tv.recent,
        localStatus:     tv.active > 0 ? "TV connected" : stremioAlive ? "App open" : "Idle",
        responseMs:      tv.responseMs,
        externalConnections,
        externalMbps,
        torrentProfile,
        overallProfile,
        stable,
        // Grace info — useful for debugging from /api/streamio/status
        stremioLastSeen: lastStremioProcessSeenAt > 0
          ? Math.round((Date.now() - lastStremioProcessSeenAt) / 1000)
          : null,
      },
    };
  } catch (err) {
    console.warn("Playback refresh failed:", err.message);
  }
}

// ─── AdGuard refresh ─────────────────────────────────────────────────────────
async function refreshAdGuard() {
  try {
    const headers = { "Content-Type": "application/json" };
    if (ADGUARD_USER) {
      headers["Authorization"] =
        "Basic " + Buffer.from(`${ADGUARD_USER}:${ADGUARD_PASS}`).toString("base64");
    }
    const res  = await fetch(`${ADGUARD_BASE}/control/stats`, { headers });
    const data = await res.json();
    adguardCache = { ts: Date.now(), data };
  } catch (err) {
    console.warn("AdGuard refresh failed:", err.message);
  }
}

// ─── Markets refresh ─────────────────────────────────────────────────────────
const SYMBOLS = ["BTC-USD", "ETH-USD", "SPY", "QQQ", "GLD"];

async function refreshMarkets() {
  if (Date.now() - marketCache.ts < MARKET_TTL_MS) return; // still fresh
  try {
    const query  = SYMBOLS.map((s) => encodeURIComponent(s)).join(",");
    const url    = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${query}`;
    const res    = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const json   = await res.json();
    const assets = (json?.quoteResponse?.result ?? []).map((q) => ({
      symbol:        q.symbol,
      price:         q.regularMarketPrice,
      change:        q.regularMarketChange,
      changePercent: q.regularMarketChangePercent,
      name:          q.shortName || q.symbol,
    }));
    marketCache = { ts: Date.now(), data: assets };
  } catch (err) {
    console.warn("Markets refresh failed:", err.message);
  }
}

// ─── Background refresh loop ──────────────────────────────────────────────────
async function startBackgroundRefresh() {
  await Promise.allSettled([refreshPlayback(), refreshAdGuard(), refreshMarkets()]);

  setInterval(refreshPlayback, PLAYBACK_TTL_MS);
  setInterval(refreshAdGuard,  ADGUARD_TTL_MS);
  setInterval(refreshMarkets,  5 * 60 * 1000);
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get("/api/all", (_req, res) => {
  res.json({
    adguard:   adguardCache.data ?? null,
    markets:   marketCache.data  ? { assets: marketCache.data } : null,
    streaming: playbackCache.data ?? null,
    ts:        Date.now(),
  });
});

app.get("/api/adguard/stats",   (_req, res) => res.json(adguardCache.data  ?? {}));
app.get("/api/markets/quotes",  (_req, res) => res.json({ assets: marketCache.data ?? [] }));
app.get("/api/streamio/status", (_req, res) => res.json(playbackCache.data ?? {}));

app.get("/health", (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

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