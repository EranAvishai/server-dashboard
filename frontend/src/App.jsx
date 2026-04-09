import { useState, useEffect, useRef, useCallback, memo } from "react";
import "./App.css";

const POLL_MS          = 12_000;
const WEATHER_POLL_MS  = 10 * 60 * 1000;
const MARKET_ROTATE_MS = 5_000;

// ─── Formatters ───────────────────────────────────────────────────────────────
const fmtK = (n) => {
  if (n == null || isNaN(n)) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "K";
  return String(Math.round(n));
};
const fmtNum = (n, d = 2) => {
  if (n == null || isNaN(n)) return "—";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
};
const fmtPct = (n) => n == null ? "—" : (n >= 0 ? "+" : "") + Number(n).toFixed(2) + "%";

// ─── Weather theme engine — changes the whole dashboard feel ─────────────────
const THEMES = {
  sunnyDay: {
    bg: "#07101f", surface: "#0c1a30", surface2: "#112038",
    accent: "#f59e0b", accentDim: "rgba(245,158,11,0.14)",
    wxGrad: "linear-gradient(165deg, #1b4060 0%, #0d2540 55%, #07101f 100%)",
    text2: "#7a9ab8", text3: "#2e4a65", border: "rgba(255,255,255,0.07)",
  },
  clearNight: {
    bg: "#04060e", surface: "#090e1c", surface2: "#0d1428",
    accent: "#a78bfa", accentDim: "rgba(167,139,250,0.14)",
    wxGrad: "linear-gradient(165deg, #180f38 0%, #0c0a25 55%, #04060e 100%)",
    text2: "#556080", text3: "#252e4a", border: "rgba(255,255,255,0.06)",
  },
  partlyDay: {
    bg: "#081220", surface: "#0e1c30", surface2: "#122538",
    accent: "#60a5fa", accentDim: "rgba(96,165,250,0.14)",
    wxGrad: "linear-gradient(165deg, #1a3558 0%, #0d2040 55%, #081220 100%)",
    text2: "#6888a8", text3: "#2c4060", border: "rgba(255,255,255,0.07)",
  },
  cloudy: {
    bg: "#09101a", surface: "#10182a", surface2: "#162035",
    accent: "#94a3b8", accentDim: "rgba(148,163,184,0.14)",
    wxGrad: "linear-gradient(165deg, #1e2a3a 0%, #111e2e 55%, #09101a 100%)",
    text2: "#556070", text3: "#273040", border: "rgba(255,255,255,0.07)",
  },
  rain: {
    bg: "#05090f", surface: "#0a1020", surface2: "#0e1828",
    accent: "#38bdf8", accentDim: "rgba(56,189,248,0.14)",
    wxGrad: "linear-gradient(165deg, #0c2035 0%, #081525 55%, #05090f 100%)",
    text2: "#486578", text3: "#1e3040", border: "rgba(255,255,255,0.06)",
  },
  storm: {
    bg: "#050508", surface: "#0a0815", surface2: "#0f0c20",
    accent: "#c4b5fd", accentDim: "rgba(196,181,253,0.14)",
    wxGrad: "linear-gradient(165deg, #1a0a35 0%, #100820 55%, #050508 100%)",
    text2: "#524870", text3: "#221c3a", border: "rgba(255,255,255,0.06)",
  },
};

function getThemeName(code, isDay) {
  if (code == null) return "partlyDay";
  if (code === 0)  return isDay ? "sunnyDay" : "clearNight";
  if (code <= 2)   return isDay ? "partlyDay" : "clearNight";
  if (code <= 3)   return "cloudy";
  if (code <= 77)  return "rain";
  return "storm";
}

function applyTheme(code, isDay) {
  const t = THEMES[getThemeName(code, isDay)];
  const s = document.documentElement.style;
  s.setProperty("--bg",        t.bg);
  s.setProperty("--surface",   t.surface);
  s.setProperty("--s2",        t.surface2);
  s.setProperty("--accent",    t.accent);
  s.setProperty("--acd",       t.accentDim);
  s.setProperty("--wx-grad",   t.wxGrad);
  s.setProperty("--t2",        t.text2);
  s.setProperty("--t3",        t.text3);
  s.setProperty("--border",    t.border);
}

// ─── Weather helpers ──────────────────────────────────────────────────────────
const WX_ICON = (code, isDay = 1) => {
  if (code == null) return "—";
  if (code === 0)  return isDay ? "☀️" : "🌙";
  if (code <= 2)   return isDay ? "⛅" : "🌤";
  if (code <= 3)   return "☁️";
  if (code <= 48)  return "🌫";
  if (code <= 55)  return "🌦";
  if (code <= 67)  return "🌧";
  if (code <= 77)  return "❄️";
  return "⛈";
};
const WX_DESC = (code) => {
  if (code == null) return "";
  if (code === 0)  return "Clear sky";
  if (code <= 2)   return "Partly cloudy";
  if (code <= 3)   return "Overcast";
  if (code <= 48)  return "Foggy";
  if (code <= 55)  return "Drizzle";
  if (code <= 67)  return "Rainy";
  if (code <= 77)  return "Snow";
  return "Thunderstorm";
};

// ─── Market sparkline ─────────────────────────────────────────────────────────
function Sparkline({ data, up }) {
  if (!data?.length || data.length < 2) return null;
  const valid = data.filter((v) => v != null);
  if (valid.length < 2) return null;
  const W = 90, H = 42;
  const min = Math.min(...valid), max = Math.max(...valid);
  const range = max - min || min * 0.002 || 1;
  const pts = valid.map((v, i) => {
    const x = (i / (valid.length - 1)) * W;
    const y = H - ((v - min) / range) * (H * 0.78) - H * 0.11;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const lx = W;
  const ly = H - ((valid[valid.length - 1] - min) / range) * (H * 0.78) - H * 0.11;
  const color = up ? "#34d399" : "#f87171";
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible", flexShrink: 0 }}>
      <polyline points={pts} fill="none" stroke={color}
        strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="3.5" fill={color} />
    </svg>
  );
}

// ─── CLOCK TILE ───────────────────────────────────────────────────────────────
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
  const p = (n) => String(n).padStart(2, "0");
  return (
    <div className="tile clock-tile">
      <div className="clock-time">
        <span className="clock-hhmm">{p(t.getHours())}:{p(t.getMinutes())}</span>
        <span className="clock-ss">{p(t.getSeconds())}</span>
      </div>
    </div>
  );
});

// ─── DATE TILE ────────────────────────────────────────────────────────────────
const DateTile = memo(function DateTile() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const weekday = t.toLocaleDateString("en-GB", { weekday: "long" });
  const dayNum  = t.toLocaleDateString("en-GB", { day: "numeric" });
  const month   = t.toLocaleDateString("en-GB", { month: "long" });
  const year    = t.getFullYear();
  return (
    <div className="tile date-tile">
      <div className="date-weekday">{weekday}</div>
      <div className="date-full">
        <span className="date-num">{dayNum}</span>
        <span className="date-month"> {month} {year}</span>
      </div>
    </div>
  );
});

// ─── WEATHER TILE ─────────────────────────────────────────────────────────────
const WeatherTile = memo(function WeatherTile() {
  const [w, setW] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(
        "https://api.open-meteo.com/v1/forecast" +
        "?latitude=31.93&longitude=34.80" +
        "&current_weather=true" +
        "&daily=weathercode,temperature_2m_max,temperature_2m_min,time" +
        "&forecast_days=4" +
        "&timezone=Asia%2FJerusalem"
      );
      const j  = await r.json();
      const cw = j.current_weather;
      const d  = j.daily;
      setW({
        temp:  Math.round(cw.temperature),
        wind:  Math.round(cw.windspeed),
        code:  cw.weathercode,
        isDay: cw.is_day,
        daily: {
          times:   d.time,
          codes:   d.weathercode,
          maxT:    d.temperature_2m_max.map(Math.round),
          minT:    d.temperature_2m_min.map(Math.round),
        },
      });
      applyTheme(cw.weathercode, cw.is_day);
    } catch { /* keep previous */ }
  }, []);

  useEffect(() => {
    load(); // eslint-disable-line react-hooks/set-state-in-effect
    const id = setInterval(load, WEATHER_POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  if (!w) return (
    <div className="tile wx-tile">
      <div className="wx-loc-label">Ness Ziona</div>
    </div>
  );

  const fmtDay = (dateStr, i) => {
    if (i === 0) return "Today";
    return new Date(dateStr).toLocaleDateString("en-GB", { weekday: "short" });
  };

  return (
    <div className="tile wx-tile">
      <div className="wx-loc-label">Ness Ziona</div>

      {/* Current conditions */}
      <div className="wx-current">
        <span className="wx-icon" style={{ animation: "wxFloat 5s ease-in-out infinite" }}>
          {WX_ICON(w.code, w.isDay)}
        </span>
        <span className="wx-temp">{w.temp}°</span>
      </div>

      <div className="wx-cond">{WX_DESC(w.code)}</div>

      <div className="wx-range">
        <span className="wx-hi">↑ {w.daily.maxT[0]}°</span>
        <span className="wx-lo">↓ {w.daily.minT[0]}°</span>
        <span className="wx-wind">{w.wind} km/h</span>
      </div>

      {/* 3-day forecast cards */}
      <div className="wx-forecast">
        {w.daily.times.slice(1, 4).map((d, i) => (
          <div key={d} className="wx-fc-card" style={{ animationDelay: `${i * 0.07}s` }}>
            <div className="wx-fc-day">{fmtDay(d, i + 1)}</div>
            <div className="wx-fc-icon">{WX_ICON(w.daily.codes[i + 1], 1)}</div>
            <div className="wx-fc-hi">↑{w.daily.maxT[i + 1]}°</div>
            <div className="wx-fc-lo">↓{w.daily.minT[i + 1]}°</div>
          </div>
        ))}
      </div>
    </div>
  );
});

// ─── ADGUARD TILE (compact) ───────────────────────────────────────────────────
const AdGuardTile = memo(function AdGuardTile({ data }) {
  const blocked    = data?.num_blocked_filtering ?? 0;
  const total      = data?.num_dns_queries       ?? 0;
  const pct        = total > 0 ? ((blocked / total) * 100).toFixed(1) : "0.0";
  const barW       = Math.min(100, parseFloat(pct));
  const latMs      = data?.avg_processing_time != null
    ? (data.avg_processing_time * 1000).toFixed(0) + " ms" : null;

  return (
    <div className="tile ag-tile">
      <div className="tile-hdr">
        <span className="tile-label">AdGuard</span>
        {latMs && <span className="tile-badge">{latMs}</span>}
      </div>
      <div className="ag-row">
        <div className="ag-stat">
          <div className="ag-num">{fmtK(blocked)}</div>
          <div className="ag-sub">blocked</div>
        </div>
        <div className="ag-rule" />
        <div className="ag-stat">
          <div className="ag-num">{fmtK(total)}</div>
          <div className="ag-sub">queries</div>
        </div>
        <div className="ag-rule" />
        <div className="ag-stat">
          <div className="ag-num ag-pct">{pct}%</div>
          <div className="ag-sub">rate</div>
        </div>
      </div>
      {/* Simple progress bar — no full chart in compact tile */}
      <div className="ag-bar-track">
        <div className="ag-bar-fill" style={{ width: `${barW}%` }} />
      </div>
    </div>
  );
});

// ─── MARKETS TILE (rotating with sparkline) ───────────────────────────────────
const MARKET_ORDER  = ["sp500", "ta125", "gold", "btc"];
const MARKET_LABELS = { sp500: "S&P 500", ta125: "TA-125", gold: "Gold", btc: "Bitcoin" };

const MarketsTile = memo(function MarketsTile({ data }) {
  const [idx, setIdx] = useState(0);
  const [vis, setVis] = useState(true);

  const assets = data?.assets
    ? MARKET_ORDER.map((k) => data.assets.find((a) => a.key === k)).filter(Boolean)
    : [];

  useEffect(() => {
    if (assets.length < 2) return;
    const id = setInterval(() => {
      setVis(false);
      setTimeout(() => { setIdx((i) => (i + 1) % assets.length); setVis(true); }, 380);
    }, MARKET_ROTATE_MS);
    return () => clearInterval(id);
  }, [assets.length]);

  if (!assets.length) return (
    <div className="tile mkt-tile"><span className="tile-label">Markets</span></div>
  );

  const a  = assets[idx];
  const up = (a.changePercent ?? 0) >= 0;

  return (
    <div className="tile mkt-tile">
      <div className={`mkt-inner ${vis ? "mkt-in" : "mkt-out"}`}>
        <div className="mkt-left">
          {/* Stock name — bigger, bolder, light */}
          <div className="mkt-name">{MARKET_LABELS[a.key] || a.label}</div>
          <div className="mkt-price">
            {fmtNum(a.price, a.key === "btc" ? 0 : 2)}
          </div>
          <div className="mkt-bottom">
            <span className={`mkt-chg ${up ? "mkt-up" : "mkt-dn"}`}>
              {fmtPct(a.changePercent)}
            </span>
            <span className="mkt-suf">{a.suffix}</span>
          </div>
        </div>
        <div className="mkt-right">
          <Sparkline data={a.sparkline} up={up} />
        </div>
      </div>
      <div className="mkt-dots">
        {assets.map((_, i) => (
          <div key={i} className={`mkt-dot${i === idx ? " mkt-dot-on" : ""}`} />
        ))}
      </div>
    </div>
  );
});

// ─── STREAMING TILE (large) ───────────────────────────────────────────────────
const LADDER_STEPS  = ["Low", "1080p", "4K", "4K HDR"];
const PROFILE_RANK  = { Idle: 0, "Low bitrate": 1, "1080p": 2, "4K": 3, "4K HDR": 4 };

const StreamingTile = memo(function StreamingTile({ data }) {
  const active  = data?.tvActive       ?? false;
  const profile = data?.overallProfile ?? "Idle";
  const mbps    = data?.externalMbps   ?? 0;
  const peers   = data?.externalConnections ?? 0;
  const rank    = PROFILE_RANK[profile] ?? 0;

  return (
    <div className={`tile stream-tile${active ? " s-live" : ""}`}>
      <div className="tile-hdr">
        <span className="tile-label">Stremio</span>
        <span className={`s-pill ${active ? "pill-on" : "pill-off"}`}>
          {active ? "LIVE" : "IDLE"}
        </span>
      </div>

      {/* Big profile text — centrepiece of tile */}
      <div className="s-profile-wrap">
        <div className="s-profile">{profile}</div>
      </div>

      {/* Quality bars — like a signal meter */}
      <div className="s-ladder">
        {LADDER_STEPS.map((step, i) => (
          <div key={step} className="s-col">
            <div
              className={`s-bar${i + 1 <= rank ? " s-bar-on" : ""}`}
              style={{ height: `${22 + i * 14}px` }}
            />
            <div className="s-bar-lbl">{step}</div>
          </div>
        ))}
      </div>

      <div className="s-meta">
        {mbps  > 0 && <span>{fmtNum(mbps, 1)} Mbps</span>}
        {peers > 0 && <span>{peers} peers</span>}
        {data?.tvRecentSeconds != null && !active && (
          <span className="s-dim">last seen {data.tvRecentSeconds}s ago</span>
        )}
      </div>
    </div>
  );
});

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [data, setData]   = useState({});
  const [lastUp, setLast] = useState(null);
  const prevRef           = useRef("{}");

  const poll = useCallback(async () => {
    try {
      const r   = await fetch("/api/all");
      if (!r.ok) return;
      const j   = await r.json();
      const str = JSON.stringify(j);
      if (str !== prevRef.current) { prevRef.current = str; setData(j); setLast(new Date()); }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    poll(); // eslint-disable-line react-hooks/set-state-in-effect
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  return (
    <div className="dashboard">
      <ClockTile />
      <DateTile />
      <AdGuardTile   data={data.adguard}   />
      <StreamingTile data={data.streaming} />
      <WeatherTile />
      <MarketsTile   data={data.markets}   />
      <footer className="dash-footer">
        {lastUp ? `↻ ${lastUp.toLocaleTimeString("en-GB")}` : "Connecting…"}
      </footer>
    </div>
  );
}