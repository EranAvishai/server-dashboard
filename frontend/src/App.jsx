import { useState, useEffect, useRef, useCallback, memo } from "react";
import "./App.css";

const POLL_MS          = 12_000;
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

// ─── Weather theme — sets CSS vars so the whole dashboard shifts ──────────────
const THEMES = {
  sunnyDay:   { bg:"#07101f", surface:"#0c1a30", s2:"#112038", accent:"#f59e0b", acd:"rgba(245,158,11,0.14)", wxGrad:"linear-gradient(155deg,#1e4a72 0%,#0d2848 60%,#07101f 100%)", t2:"#7a9ab8", t3:"#2e4a65" },
  clearNight: { bg:"#04060e", surface:"#09101e", s2:"#0d1528", accent:"#a78bfa", acd:"rgba(167,139,250,0.14)", wxGrad:"linear-gradient(155deg,#1c0f40 0%,#0d0a28 60%,#04060e 100%)", t2:"#556080", t3:"#252e4a" },
  partlyDay:  { bg:"#081220", surface:"#0e1c30", s2:"#122538", accent:"#60a5fa", acd:"rgba(96,165,250,0.14)",  wxGrad:"linear-gradient(155deg,#1a3a62 0%,#0d2248 60%,#081220 100%)", t2:"#6888a8", t3:"#2c4060" },
  cloudy:     { bg:"#090f18", surface:"#101828", s2:"#162034", accent:"#94a3b8", acd:"rgba(148,163,184,0.14)",wxGrad:"linear-gradient(155deg,#1e2a3e 0%,#111e2e 60%,#090f18 100%)", t2:"#556070", t3:"#273040" },
  rain:       { bg:"#05090f", surface:"#0a1020", s2:"#0e1828", accent:"#38bdf8", acd:"rgba(56,189,248,0.14)",  wxGrad:"linear-gradient(155deg,#0c2038 0%,#081525 60%,#05090f 100%)", t2:"#486578", t3:"#1e3040" },
  storm:      { bg:"#050508", surface:"#0a0815", s2:"#0f0c20", accent:"#c4b5fd", acd:"rgba(196,181,253,0.14)",wxGrad:"linear-gradient(155deg,#1e0a38 0%,#100820 60%,#050508 100%)", t2:"#524870", t3:"#221c3a" },
};

function getThemeName(code, isDay) {
  if (code == null) return "partlyDay";
  if (code === 0)  return isDay ? "sunnyDay"  : "clearNight";
  if (code <= 2)   return isDay ? "partlyDay" : "clearNight";
  if (code <= 3)   return "cloudy";
  if (code <= 77)  return "rain";
  return "storm";
}
function applyTheme(code, isDay) {
  const t = THEMES[getThemeName(code, isDay)];
  const s = document.documentElement.style;
  s.setProperty("--bg",      t.bg);      s.setProperty("--surface", t.surface);
  s.setProperty("--s2",      t.s2);      s.setProperty("--accent",  t.accent);
  s.setProperty("--acd",     t.acd);     s.setProperty("--wx-grad", t.wxGrad);
  s.setProperty("--t2",      t.t2);      s.setProperty("--t3",      t.t3);
}

// ─── Weather helpers ──────────────────────────────────────────────────────────
const wxIcon = (code, isDay = 1) => {
  if (code == null) return "🌤";
  if (code === 0)  return isDay ? "☀️" : "🌙";
  if (code <= 2)   return isDay ? "⛅" : "🌤";
  if (code <= 3)   return "☁️";
  if (code <= 48)  return "🌫";
  if (code <= 55)  return "🌦";
  if (code <= 67)  return "🌧";
  if (code <= 77)  return "❄️";
  return "⛈";
};
const wxDesc = (code) => {
  const MAP = [null,"Clear sky","Partly cloudy","Partly cloudy","Overcast",null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,"Foggy","Foggy","Foggy","Foggy","Foggy","Foggy","Foggy","Drizzle","Drizzle","Drizzle","Drizzle","Drizzle","Drizzle","Rainy","Rainy","Rainy","Rainy","Rainy","Rainy","Rainy","Rainy","Rainy","Rainy","Rainy","Rainy","Rainy","Rainy","Rainy","Rainy","Rainy","Rainy","Snow","Snow","Snow","Snow","Snow","Snow","Snow","Snow","Snow","Snow","Snow","Snow","Snow","Snow","Snow","Snow","Snow","Snow","Snow","Snow","Snow","Snow","Snow"];
  return (code != null && MAP[code]) ? MAP[code] : code >= 95 ? "Thunderstorm" : "—";
};
const shortDay = (dateStr, idx) => {
  if (idx === 0) return "Today";
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short" });
};

// ─── Large sparkline for the market tile ──────────────────────────────────────
function Sparkline({ data, up }) {
  const valid = (data || []).filter(v => v != null);
  if (valid.length < 2) return null;
  const W = 220, H = 110;
  const mn = Math.min(...valid), mx = Math.max(...valid);
  const rng = mx - mn || mn * 0.002 || 1;
  const pts = valid.map((v, i) => {
    const x = (i / (valid.length - 1)) * W;
    const y = H - ((v - mn) / rng) * (H * 0.78) - H * 0.11;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const lx = W;
  const ly = H - ((valid[valid.length-1] - mn) / rng) * (H * 0.78) - H * 0.11;
  const color = up ? "#34d399" : "#f87171";
  // Fill below the line for extra visual weight
  const fillPts = `${pts} ${W},${H} 0,${H}`;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}
      style={{ overflow: "visible", flexShrink: 0, display: "block" }}>
      <defs>
        <linearGradient id={`sg-${up?"u":"d"}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={fillPts} fill={`url(#sg-${up?"u":"d"})`} />
      <polyline points={pts} fill="none" stroke={color}
        strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="5" fill={color} />
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
      <div className="clock-row">
        <span className="clock-hhmm">{p(t.getHours())}:{p(t.getMinutes())}</span>
        <span className="clock-ss">{p(t.getSeconds())}</span>
      </div>
    </div>
  );
});

// ─── DATE ─────────────────────────────────────────────────────────────────────
const DateTile = memo(function DateTile() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setT(new Date()), 30_000); return () => clearInterval(id); }, []);
  return (
    <div className="tile date-tile">
      <div className="date-weekday">{t.toLocaleDateString("en-GB", { weekday: "long" })}</div>
      <div className="date-rest">
        {t.getDate()} {t.toLocaleDateString("en-GB", { month: "long" })} {t.getFullYear()}
      </div>
    </div>
  );
});

// ─── WEATHER (data from /api/all — no browser fetch) ─────────────────────────
const WeatherTile = memo(function WeatherTile({ raw }) {
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (raw?.current_weather) {
      applyTheme(raw.current_weather.weathercode, raw.current_weather.is_day ?? 1);
    }
  }, [raw]);

  const forceRefresh = useCallback(async () => {
    setRetrying(true);
    try { await fetch("/api/weather/refresh"); } catch {}
    // The next /api/all poll (12s) will pick up the new data
    setTimeout(() => setRetrying(false), 13_000);
  }, []);

  const cw = raw?.current_weather;
  const d  = raw?.daily;

  return (
    <div className="tile wx-tile">
      <div className="wx-loc">Ness Ziona</div>

      {!cw ? (
        <div className="wx-placeholder">
          <span className="wx-ph-temp">—°</span>
          <span className="wx-ph-label">
            {retrying ? "Refreshing…" : "Weather loading…"}
          </span>
          {!retrying && (
            <button className="wx-retry-btn" onClick={forceRefresh}>
              ↺ Retry now
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="wx-main">
            <span className="wx-icon" style={{ animation: "wxFloat 5s ease-in-out infinite" }}>
              {wxIcon(cw.weathercode, cw.is_day ?? 1)}
            </span>
            <span className="wx-temp">{Math.round(cw.temperature)}°</span>
          </div>

          <div className="wx-cond">{wxDesc(cw.weathercode)}</div>

          {d && (
            <div className="wx-range">
              <span className="wx-hi">↑ {Math.round(d.temperature_2m_max[0])}°</span>
              <span className="wx-lo">↓ {Math.round(d.temperature_2m_min[0])}°</span>
              <span className="wx-wind">{Math.round(cw.windspeed)} km/h</span>
            </div>
          )}

          {d && (
            <div className="wx-forecast">
              {d.time.slice(1, 4).map((day, i) => (
                <div key={day} className="wx-fc-card"
                  style={{ animationDelay: `${0.04 + i * 0.07}s` }}>
                  <div className="wx-fc-day">{shortDay(day, i + 1)}</div>
                  <div className="wx-fc-icon">{wxIcon(d.weathercode[i + 1], 1)}</div>
                  <div className="wx-fc-hi">↑{Math.round(d.temperature_2m_max[i + 1])}°</div>
                  <div className="wx-fc-lo">↓{Math.round(d.temperature_2m_min[i + 1])}°</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
});

// ─── ADGUARD (compact right panel) ────────────────────────────────────────────
const AdGuardTile = memo(function AdGuardTile({ data }) {
  const blocked    = data?.num_blocked_filtering ?? 0;
  const total      = data?.num_dns_queries       ?? 0;
  const pct        = total > 0 ? ((blocked / total) * 100).toFixed(1) : "0.0";
  const queries    = data?.dns_queries       || [];
  const blockedArr = data?.blocked_filtering || [];
  const latMs      = data?.avg_processing_time != null
    ? (data.avg_processing_time * 1000).toFixed(0) + " ms" : null;

  // Mini bar chart
  const count  = queries.length;
  const maxVal = Math.max(...queries, 1);
  const BW = 6, GAP = 3, STEP = BW + GAP;
  const VW = count * STEP, VH = 70;
  const nowH = new Date().getHours() % (count || 24);

  return (
    <div className="tile ag-tile">
      <div className="tile-hdr">
        <span className="tile-label">AdGuard</span>
        {latMs && <span className="tile-badge">{latMs}</span>}
      </div>

      {/* 3 stats stacked vertically — fits narrow column */}
      <div className="ag-stats">
        {[
          { label: "Blocked",  val: fmtK(blocked), accent: false },
          { label: "Queries",  val: fmtK(total),   accent: false },
          { label: "Rate",     val: pct + "%",      accent: true  },
        ].map(({ label, val, accent }) => (
          <div key={label} className="ag-row">
            <span className="ag-label">{label}</span>
            <span className={`ag-val${accent ? " ag-accent" : ""}`}>{val}</span>
          </div>
        ))}
      </div>

      {/* Bar progress */}
      <div className="ag-bar-track">
        <div className="ag-bar-fill" style={{ width: `${Math.min(100, parseFloat(pct))}%` }} />
      </div>

      {/* Mini chart */}
      {count > 0 && (
        <div className="ag-chart-wrap">
          <svg className="ag-svg" viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none">
            <defs>
              <linearGradient id="ag-g" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.9" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.3" />
              </linearGradient>
            </defs>
            {queries.map((q, i) => {
              const b  = blockedArr[i] || 0;
              const x  = i * STEP;
              const qH = Math.max(2, (q / maxVal) * (VH - 3));
              const bH = b > 0 ? Math.max(2, (b / maxVal) * (VH - 3)) : 0;
              return (
                <g key={i}>
                  <rect x={x} y={VH-qH} width={BW} height={qH} rx="1.5"
                    fill={i===nowH ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.055)"} />
                  {bH>0 && <rect x={x} y={VH-bH} width={BW} height={bH} rx="1.5"
                    fill="url(#ag-g)" opacity={i===nowH?1:0.7} />}
                </g>
              );
            })}
          </svg>
          <div className="ag-axis"><span>24h ago</span><span>now</span></div>
        </div>
      )}
    </div>
  );
});

// ─── MARKETS (full tile: huge price + large sparkline) ────────────────────────
const MARKET_ORDER  = ["sp500", "ta125", "gold", "btc"];
const MARKET_LABELS = { sp500: "S&P 500", ta125: "TA-125", gold: "Gold", btc: "Bitcoin" };

const MarketsTile = memo(function MarketsTile({ data }) {
  const [idx, setIdx] = useState(0);
  const [vis, setVis] = useState(true);

  const assets = data?.assets
    ? MARKET_ORDER.map(k => data.assets.find(a => a.key === k)).filter(Boolean)
    : [];

  useEffect(() => {
    if (assets.length < 2) return;
    const id = setInterval(() => {
      setVis(false);
      setTimeout(() => { setIdx(i => (i + 1) % assets.length); setVis(true); }, 350);
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
      {/* Transition wrapper */}
      <div className={`mkt-inner ${vis ? "mkt-in" : "mkt-out"}`}>

        {/* Left: name + giant price + change */}
        <div className="mkt-text">
          <div className="mkt-name">{MARKET_LABELS[a.key] || a.label}</div>
          <div className="mkt-price">
            {fmtNum(a.price, a.key === "btc" ? 0 : 2)}
          </div>
          <div className="mkt-meta">
            <span className={`mkt-chg ${up ? "mkt-up" : "mkt-dn"}`}>
              {fmtPct(a.changePercent)}
            </span>
            <span className="mkt-suf">{a.suffix}</span>
          </div>
        </div>

        {/* Right: large sparkline fills the tile height */}
        <div className="mkt-graph">
          <Sparkline data={a.sparkline} up={up} />
        </div>
      </div>

      {/* Small dot indicator bottom-right */}
      <div className="mkt-dots">
        {assets.map((_, i) => (
          <div key={i} className={`mkt-dot${i === idx ? " mkt-dot-on" : ""}`} />
        ))}
      </div>
    </div>
  );
});

// ─── STREAMING (left column, tall) ────────────────────────────────────────────
const LADDER_STEPS = ["Low", "1080p", "4K", "4K HDR"];
const PROFILE_RANK = { Idle: 0, "Low bitrate": 1, "1080p": 2, "4K": 3, "4K HDR": 4 };

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
      <div className="s-profile-wrap">
        <div className="s-profile">{profile}</div>
      </div>
      <div className="s-ladder">
        {LADDER_STEPS.map((step, i) => (
          <div key={step} className="s-col">
            <div className={`s-bar${i+1 <= rank ? " s-bar-on" : ""}`}
              style={{ height: `${22 + i * 13}px` }} />
            <div className="s-lbl">{step}</div>
          </div>
        ))}
      </div>
      <div className="s-meta">
        {mbps  > 0 && <span>{fmtNum(mbps, 1)} Mbps</span>}
        {peers > 0 && <span>{peers} peers</span>}
        {data?.tvRecentSeconds != null && !active && (
          <span className="s-dim">last {data.tvRecentSeconds}s ago</span>
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
      const r = await fetch("/api/all");
      if (!r.ok) return;
      const j   = await r.json();
      const str = JSON.stringify(j);
      if (str !== prevRef.current) {
        prevRef.current = str;
        setData(j);
        setLast(new Date());
      }
    } catch {}
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
      <WeatherTile   raw={data.weather}    />
      <MarketsTile   data={data.markets}   />
      <footer className="dash-footer">
        {lastUp ? `↻ ${lastUp.toLocaleTimeString("en-GB")}` : "Connecting…"}
      </footer>
    </div>
  );
}