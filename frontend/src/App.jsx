import { useState, useEffect, useRef, useCallback, memo } from "react";
import "./App.css";

const POLL_MS         = 12_000;
const WEATHER_POLL_MS = 10 * 60 * 1000;

// ─── Weather-driven themes ────────────────────────────────────────────────────
// Each theme paints the entire dashboard atmosphere, like OnePlus weather app.
// Tiles are semi-transparent, so the sky gradient bleeds through everything.
const THEMES = {
  clear_day: {
    grad:   "linear-gradient(170deg, #0e0700 0%, #1d0e00 50%, #0b0500 100%)",
    glow:   "radial-gradient(ellipse at 62% 2%, rgba(251,146,60,0.30) 0%, transparent 52%)",
    accent: "#f97316", teal: "#fb923c",
    tile:   "rgba(22,13,4,0.82)", border: "rgba(249,115,22,0.14)", text2: "#a05a1e",
  },
  clear_night: {
    grad:   "linear-gradient(170deg, #010210 0%, #030a1c 50%, #010410 100%)",
    glow:   "radial-gradient(ellipse at 50% 0%, rgba(99,102,241,0.20) 0%, transparent 50%)",
    accent: "#818cf8", teal: "#a5b4fc",
    tile:   "rgba(4,5,18,0.88)", border: "rgba(129,140,248,0.14)", text2: "#3730a3",
  },
  cloudy_day: {
    grad:   "linear-gradient(170deg, #06090f 0%, #0b1320 50%, #050810 100%)",
    glow:   "radial-gradient(ellipse at 55% 2%, rgba(147,197,253,0.15) 0%, transparent 52%)",
    accent: "#60a5fa", teal: "#93c5fd",
    tile:   "rgba(8,12,22,0.86)", border: "rgba(96,165,250,0.13)", text2: "#1e3a8a",
  },
  cloudy_night: {
    grad:   "linear-gradient(170deg, #050709 0%, #090c14 50%, #040608 100%)",
    glow:   "radial-gradient(ellipse at 50% 0%, rgba(71,85,105,0.12) 0%, transparent 50%)",
    accent: "#64748b", teal: "#94a3b8",
    tile:   "rgba(6,8,14,0.88)", border: "rgba(100,116,139,0.10)", text2: "#334155",
  },
  rain: {
    grad:   "linear-gradient(170deg, #01040b 0%, #020c1c 50%, #010508 100%)",
    glow:   "radial-gradient(ellipse at 38% 0%, rgba(14,165,233,0.20) 0%, transparent 50%)",
    accent: "#38bdf8", teal: "#0ea5e9",
    tile:   "rgba(2,6,16,0.88)", border: "rgba(56,189,248,0.15)", text2: "#0369a1",
  },
  snow: {
    grad:   "linear-gradient(170deg, #060c16 0%, #0c1828 50%, #040a14 100%)",
    glow:   "radial-gradient(ellipse at 50% 0%, rgba(186,230,253,0.22) 0%, transparent 55%)",
    accent: "#bae6fd", teal: "#7dd3fc",
    tile:   "rgba(6,10,22,0.88)", border: "rgba(186,230,253,0.16)", text2: "#0c4a6e",
  },
  fog: {
    grad:   "linear-gradient(170deg, #07090c 0%, #0d1018 50%, #050709 100%)",
    glow:   "radial-gradient(ellipse at 50% 10%, rgba(148,163,184,0.10) 0%, transparent 55%)",
    accent: "#94a3b8", teal: "#cbd5e1",
    tile:   "rgba(8,10,16,0.88)", border: "rgba(148,163,184,0.09)", text2: "#334155",
  },
  storm: {
    grad:   "linear-gradient(170deg, #040208 0%, #090414 50%, #030108 100%)",
    glow:   "radial-gradient(ellipse at 50% 0%, rgba(168,85,247,0.24) 0%, transparent 50%)",
    accent: "#c084fc", teal: "#a855f7",
    tile:   "rgba(5,3,12,0.90)", border: "rgba(192,132,252,0.17)", text2: "#4c1d95",
  },
};

function getTheme(code, isDay) {
  if (code == null) return isDay ? THEMES.cloudy_day   : THEMES.cloudy_night;
  if (code === 0)   return isDay ? THEMES.clear_day    : THEMES.clear_night;
  if (code <= 2)    return isDay ? THEMES.cloudy_day   : THEMES.cloudy_night;
  if (code <= 3)    return isDay ? THEMES.cloudy_day   : THEMES.cloudy_night;
  if (code <= 48)   return THEMES.fog;
  if (code <= 67)   return THEMES.rain;
  if (code <= 77)   return THEMES.snow;
  return THEMES.storm;
}

// ─── Weather display helpers ──────────────────────────────────────────────────
function wxIcon(c, d) {
  if (c == null) return d ? "⛅" : "🌙";
  if (c === 0)   return d ? "☀"  : "🌙";
  if (c <= 2)    return "⛅";
  if (c <= 3)    return "☁";
  if (c <= 48)   return "🌫";
  if (c <= 55)   return "🌦";
  if (c <= 67)   return "🌧";
  if (c <= 77)   return "❄";
  return "⛈";
}
function wxDesc(c) {
  if (c == null) return "";
  if (c === 0)   return "Clear sky";
  if (c <= 2)    return "Partly cloudy";
  if (c <= 3)    return "Overcast";
  if (c <= 48)   return "Foggy";
  if (c <= 55)   return "Drizzle";
  if (c <= 67)   return "Rainy";
  if (c <= 77)   return "Snowing";
  return "Thunderstorm";
}

// ─── Formatters ───────────────────────────────────────────────────────────────
const fmtK   = n => !n || isNaN(n) ? "—" : n >= 1e6 ? (n/1e6).toFixed(1)+"M" : n >= 1e3 ? (n/1e3).toFixed(1)+"K" : String(Math.round(n));
const fmtNum = (n, d=2) => n == null || isNaN(n) ? "—" : Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = n => n == null ? "—" : (n >= 0 ? "+" : "") + Number(n).toFixed(2) + "%";

// ─── Sparkline ────────────────────────────────────────────────────────────────
function Sparkline({ prices, up }) {
  const valid = (prices || []).filter(p => p != null && !isNaN(p));
  if (valid.length < 2) return <div className="spark-empty" />;
  const min = Math.min(...valid), max = Math.max(...valid);
  const rng = max - min || 1;
  const W = 110, H = 42, pad = 5;
  const pts = valid.map((p, i) => {
    const x = pad + (i / (valid.length - 1)) * (W - pad * 2);
    const y = H - pad - ((p - min) / rng) * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = pts.join(" ");
  const area = `${pad},${H - pad} ${line} ${W - pad},${H - pad}`;
  const clr  = up ? "#34d399" : "#f87171";
  const fill = up ? "rgba(52,211,153,0.13)" : "rgba(248,113,113,0.13)";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="sparkline">
      <polygon points={area} fill={fill} />
      <polyline points={line} fill="none" stroke={clr} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── CLOCK ────────────────────────────────────────────────────────────────────
const ClockTile = memo(function ClockTile() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => {
    let last = -1, id;
    const tick = () => {
      const n = new Date();
      if (n.getSeconds() !== last) { last = n.getSeconds(); setT(new Date()); }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);
  const p = n => String(n).padStart(2, "0");
  return (
    <div className="tile clock-tile">
      <div className="clock-top">
        <span className="clock-day">{t.toLocaleDateString("en-GB", { weekday: "long" })}</span>
        <span className="clock-date">{t.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}</span>
      </div>
      <div className="clock-face">
        <span className="clock-hm">{p(t.getHours())}:{p(t.getMinutes())}</span>
        <span className="clock-ss">{p(t.getSeconds())}</span>
      </div>
    </div>
  );
});

// ─── WEATHER — transparent tile, IS the sky ───────────────────────────────────
const WeatherTile = memo(function WeatherTile({ onWeather }) {
  const [w, setW] = useState(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch(
        "https://api.open-meteo.com/v1/forecast" +
        "?latitude=31.9322&longitude=34.797" +
        "&current=temperature_2m,weather_code,wind_speed_10m,is_day" +
        "&timezone=Asia%2FJerusalem"
      );
      const j = await r.json(), c = j.current;
      const d = { temp: Math.round(c.temperature_2m), wind: Math.round(c.wind_speed_10m), code: c.weather_code, isDay: c.is_day === 1 };
      setW(d);
      onWeather?.(d);
    } catch { /* keep previous value */ }
  }, [onWeather]);

  useEffect(() => { load(); const t = setInterval(load, WEATHER_POLL_MS); return () => clearInterval(t); }, [load]); // eslint-disable-line react-hooks/set-state-in-effect

  return (
    <div className="tile wx-tile">
      <div className="wx-scrim" />
      {w ? (
        <>
          <div className="wx-loc">Ness Ziona</div>
          <div className="wx-icon">{wxIcon(w.code, w.isDay)}</div>
          <div className="wx-temp">{w.temp}°</div>
          <div className="wx-desc">{wxDesc(w.code)}</div>
          <div className="wx-wind">{w.wind} km/h</div>
        </>
      ) : <div className="wx-loading">…</div>}
    </div>
  );
});

// ─── ADGUARD (compact strip) ──────────────────────────────────────────────────
const AdGuardTile = memo(function AdGuardTile({ data }) {
  if (!data) return <div className="tile ag-tile"><span className="tile-label">AdGuard</span></div>;
  const blocked = data.num_blocked_filtering ?? 0;
  const total   = data.num_dns_queries       ?? 0;
  const pct     = total > 0 ? ((blocked / total) * 100).toFixed(1) : "0.0";
  const bar     = Math.min(100, parseFloat(pct));
  return (
    <div className="tile ag-tile">
      <div className="tile-label">AdGuard DNS</div>
      <div className="ag-row">
        <div className="ag-stat"><span className="ag-num">{fmtK(blocked)}</span><span className="ag-sub">blocked</span></div>
        <div className="ag-rule" />
        <div className="ag-stat"><span className="ag-num">{fmtK(total)}</span><span className="ag-sub">total</span></div>
        <div className="ag-rule" />
        <div className="ag-stat"><span className="ag-num accent">{pct}%</span><span className="ag-sub">rate</span></div>
      </div>
      <div className="ag-track"><div className="ag-fill" style={{ width: `${bar}%` }} /></div>
    </div>
  );
});

// ─── STREAMING (large) ────────────────────────────────────────────────────────
const LADDER_STEPS = ["Low", "1080p", "4K", "4K HDR"];
const PROFILE_RANK = { Idle: 0, "Low bitrate": 1, "1080p": 2, "4K": 3, "4K HDR": 4 };

const StreamingTile = memo(function StreamingTile({ data }) {
  const active  = data?.tvActive ?? false;
  const profile = data?.overallProfile ?? "Idle";
  const rank    = PROFILE_RANK[profile] ?? 0;
  const mbps    = data?.externalMbps ?? 0;
  const peers   = data?.externalConnections ?? 0;
  return (
    <div className={`tile stream-tile${active ? " s-on" : ""}`}>
      <div className="stream-head">
        <span className="tile-label">Stremio</span>
        <span className={`s-pill ${active ? "pill-live" : "pill-idle"}`}>{active ? "LIVE" : "IDLE"}</span>
      </div>
      <div className="stream-profile">{profile}</div>
      <div className="stream-ladder">
        {LADDER_STEPS.map((lbl, i) => (
          <div key={lbl} className="ladder-col">
            <div className={`ladder-bar${i + 1 <= rank ? " bar-on" : ""}`} style={{ height: `${18 + i * 14}px` }} />
            <span className="ladder-lbl">{lbl}</span>
          </div>
        ))}
      </div>
      <div className="stream-meta">
        {mbps  > 0 && <span>{fmtNum(mbps, 1)} Mbps</span>}
        {peers > 0 && <span>{peers} peers</span>}
        {!active && data?.tvRecentSeconds != null && <span className="dim">{data.tvRecentSeconds}s ago</span>}
      </div>
    </div>
  );
});

// ─── STOCKS (single rotating tile with sparkline) ─────────────────────────────
const STOCK_ORDER = ["sp500", "ta125", "gold", "btc"];

function StocksTile({ data }) {
  const assets  = STOCK_ORDER.map(k => data?.assets?.find(a => a.key === k)).filter(Boolean);
  const [idx, setIdx]       = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!assets.length) return;
    const t = setInterval(() => {
      setVisible(false);
      setTimeout(() => { setIdx(i => (i + 1) % assets.length); setVisible(true); }, 340);
    }, 5500);
    return () => clearInterval(t);
  }, [assets.length]);

  if (!assets.length) return <div className="tile stocks-tile"><span className="tile-label">Markets</span></div>;

  const a  = assets[idx];
  const up = a.changePercent >= 0;
  return (
    <div className="tile stocks-tile">
      <div className="stocks-body" style={{ opacity: visible ? 1 : 0, transition: "opacity 0.32s ease" }}>
        <div className="stock-row">
          <div className="stock-left">
            <span className="stock-name">{a.label}</span>
            <span className="stock-price">{fmtNum(a.price, a.key === "btc" ? 0 : 2)}</span>
            <span className={`stock-chg ${up ? "up" : "dn"}`}>
              {fmtPct(a.changePercent)}&nbsp;<span className="stock-sfx">{a.suffix}</span>
            </span>
          </div>
          <Sparkline prices={a.sparkline} up={up} />
        </div>
        <div className="stock-dots">
          {assets.map((_, i) => <div key={i} className={`sdot${i === idx ? " sdot-on" : ""}`} />)}
        </div>
      </div>
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [data, setData] = useState({});
  const [lastUp, setLast] = useState(null);
  const prevRef = useRef("{}");

  // Two bg layers that crossfade — only way to transition between CSS gradients
  const bg1Ref = useRef(), bg2Ref = useRef(), activeB = useRef(1);

  const applyTheme = useCallback((wx) => {
    if (!wx) return;
    const th = getTheme(wx.code, wx.isDay);
    // Crossfade
    if (activeB.current === 1) {
      bg2Ref.current.style.background = th.grad;
      bg2Ref.current.style.opacity    = "1";
      bg1Ref.current.style.opacity    = "0";
      activeB.current = 2;
    } else {
      bg1Ref.current.style.background = th.grad;
      bg1Ref.current.style.opacity    = "1";
      bg2Ref.current.style.opacity    = "0";
      activeB.current = 1;
    }
    // Update glow + tile variables
    const r = document.documentElement;
    r.style.setProperty("--accent",      th.accent);
    r.style.setProperty("--teal",        th.teal);
    r.style.setProperty("--tile-bg",     th.tile);
    r.style.setProperty("--tile-border", th.border);
    r.style.setProperty("--text-2",      th.text2);
    r.style.setProperty("--glow-bg",     th.glow);
  }, []);

  const poll = useCallback(async () => {
    try {
      const r = await fetch("/api/all");
      if (!r.ok) return;
      const j = await r.json(), s = JSON.stringify(j);
      if (s !== prevRef.current) { prevRef.current = s; setData(j); setLast(new Date()); }
    } catch { /* keep previous value */ }
  }, []);

  useEffect(() => { poll(); const t = setInterval(poll, POLL_MS); return () => clearInterval(t); }, [poll]); // eslint-disable-line react-hooks/set-state-in-effect

  return (
    <>
      {/* Sky atmosphere — crossfades on weather change */}
      <div ref={bg1Ref} className="bg-layer"
        style={{ background: "linear-gradient(170deg,#07090d 0%,#0e1117 50%,#07080f 100%)", opacity: 1 }} />
      <div ref={bg2Ref} className="bg-layer" style={{ opacity: 0 }} />
      <div className="bg-glow" />

      <div className="dashboard">
        <ClockTile />
        <WeatherTile onWeather={applyTheme} />
        <AdGuardTile   data={data.adguard}   />
        <StreamingTile data={data.streaming} />
        <StocksTile    data={data.markets}   />
        <footer className="dash-footer">
          {lastUp ? `↻  ${lastUp.toLocaleTimeString("en-GB")}` : ""}
        </footer>
      </div>
    </>
  );
}