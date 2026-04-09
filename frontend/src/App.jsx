import { useState, useEffect, useRef, useCallback, memo } from "react";
import "./App.css";

const POLL_MS         = 12_000;
const WEATHER_POLL_MS = 10 * 60 * 1000;

function fmtK(n) {
  if (n == null || isNaN(n)) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "K";
  return String(Math.round(n));
}
function fmtNum(n, d = 2) {
  if (n == null || isNaN(n)) return "—";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtPct(n) {
  if (n == null) return "—";
  return (n >= 0 ? "+" : "") + Number(n).toFixed(2) + "%";
}

// ─── CLOCK ────────────────────────────────────────────────────────────────────
const ClockTile = memo(function ClockTile() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    let last = -1, id;
    const tick = () => {
      const now = new Date();
      if (now.getSeconds() !== last) { last = now.getSeconds(); setTime(new Date()); }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  const p    = (n) => String(n).padStart(2, "0");
  const hhmm = `${p(time.getHours())}:${p(time.getMinutes())}`;
  const ss   = p(time.getSeconds());
  const day  = time.toLocaleDateString("en-GB", { weekday: "long" });
  const date = time.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="tile clock-tile">
      <div className="clock-meta">
        <span className="clock-day">{day}</span>
        <span className="clock-date">{date}</span>
      </div>
      <div className="clock-body">
        <span className="clock-hhmm">{hhmm}</span>
        <span className="clock-ss">{ss}</span>
      </div>
    </div>
  );
});

// ─── ADGUARD CHART ────────────────────────────────────────────────────────────
const AdGuardChart = memo(function AdGuardChart({ queries = [], blocked = [] }) {
  if (!queries.length) return <div className="chart-empty">Awaiting data…</div>;

  const count   = queries.length;
  const maxVal  = Math.max(...queries, 1);
  const BW      = 9;
  const GAP     = 4;
  const STEP    = BW + GAP;
  const VW      = count * STEP;
  const VH      = 88;
  const nowHour = new Date().getHours() % count;

  return (
    <div className="chart-wrap">
      <svg className="adguard-svg" viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="teal-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2dd4bf" stopOpacity="1" />
            <stop offset="100%" stopColor="#0d9488" stopOpacity="0.6" />
          </linearGradient>
        </defs>
        {queries.map((q, i) => {
          const b    = blocked[i] || 0;
          const x    = i * STEP;
          const qH   = Math.max(3, (q / maxVal) * (VH - 6));
          const bH   = b > 0 ? Math.max(3, (b / maxVal) * (VH - 6)) : 0;
          const dim  = i === nowHour;
          return (
            <g key={i}>
              <rect x={x} y={VH - qH} width={BW} height={qH} rx="2.5"
                fill={dim ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.065)"} />
              {bH > 0 && (
                <rect x={x} y={VH - bH} width={BW} height={bH} rx="2.5"
                  fill="url(#teal-grad)" opacity={dim ? 1 : 0.75} />
              )}
            </g>
          );
        })}
      </svg>
      <div className="chart-labels">
        <span>24 h ago</span>
        <span>now</span>
      </div>
    </div>
  );
});

// ─── ADGUARD TILE ─────────────────────────────────────────────────────────────
const AdGuardTile = memo(function AdGuardTile({ data }) {
  if (!data) return (
    <div className="tile adguard-tile">
      <span className="tile-label">AdGuard DNS</span>
      <span className="dim">Connecting…</span>
    </div>
  );

  const blocked    = data.num_blocked_filtering ?? 0;
  const total      = data.num_dns_queries       ?? 0;
  const pct        = total > 0 ? ((blocked / total) * 100).toFixed(1) : "0.0";
  const queries    = data.dns_queries       || [];
  const blockedArr = data.blocked_filtering || [];
  const latencyMs  = data.avg_processing_time != null
    ? (data.avg_processing_time * 1000).toFixed(0) + " ms"
    : null;

  return (
    <div className="tile adguard-tile">
      <div className="tile-header">
        <span className="tile-label">AdGuard DNS · 24 h</span>
        {latencyMs && <span className="tile-badge">{latencyMs} avg</span>}
      </div>
      <div className="adguard-stats">
        <div className="stat-group">
          <div className="stat-num">{fmtK(blocked)}</div>
          <div className="stat-sub">blocked</div>
        </div>
        <div className="stat-rule" />
        <div className="stat-group">
          <div className="stat-num">{fmtK(total)}</div>
          <div className="stat-sub">total</div>
        </div>
        <div className="stat-rule" />
        <div className="stat-group">
          <div className="stat-num accent">{pct}%</div>
          <div className="stat-sub">rate</div>
        </div>
      </div>
      <AdGuardChart queries={queries} blocked={blockedArr} />
    </div>
  );
});

// ─── WEATHER TILE ─────────────────────────────────────────────────────────────
function wxIcon(c) {
  if (c == null) return "—";
  if (c === 0)   return "☀";
  if (c <= 2)    return "⛅";
  if (c <= 3)    return "☁";
  if (c <= 48)   return "🌫";
  if (c <= 67)   return "🌧";
  if (c <= 77)   return "❄";
  return "⛈";
}
function wxDesc(c) {
  if (c == null) return "";
  if (c === 0)   return "Clear";
  if (c <= 2)    return "Partly cloudy";
  if (c <= 3)    return "Overcast";
  if (c <= 48)   return "Foggy";
  if (c <= 55)   return "Drizzle";
  if (c <= 67)   return "Rain";
  if (c <= 77)   return "Snow";
  return "Thunderstorm";
}

const WeatherTile = memo(function WeatherTile() {
  const [w, setW] = useState(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch(
        "https://api.open-meteo.com/v1/forecast?latitude=31.77&longitude=35.21" +
        "&current_weather=true&timezone=Asia%2FJerusalem"
      );
      const j  = await r.json();
      const cw = j.current_weather;
      setW({ temp: Math.round(cw.temperature), wind: Math.round(cw.windspeed), code: cw.weathercode });
    } catch { /* keep previous value */ }
  }, []);

  useEffect(() => {
    load(); // eslint-disable-line react-hooks/set-state-in-effect
    const t = setInterval(load, WEATHER_POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="tile weather-tile">
      <span className="tile-label">Jerusalem</span>
      {w ? (
        <>
          <div className="wx-icon">{wxIcon(w.code)}</div>
          <div className="wx-temp">{w.temp}°</div>
          <div className="wx-desc">{wxDesc(w.code)}</div>
          <div className="wx-wind">{w.wind} km/h</div>
        </>
      ) : (
        <div className="dim">—</div>
      )}
    </div>
  );
});

// ─── MARKETS TILE ─────────────────────────────────────────────────────────────
const MARKET_ORDER = ["sp500", "ta125", "gold", "btc"];

const MarketsTile = memo(function MarketsTile({ data }) {
  if (!data?.assets?.length) return (
    <div className="tile markets-tile">
      <span className="tile-label">Markets</span>
    </div>
  );
  const assets = MARKET_ORDER.map(k => data.assets.find(a => a.key === k)).filter(Boolean);

  return (
    <div className="tile markets-tile">
      {assets.map((a) => {
        const up = a.changePercent >= 0;
        return (
          <div key={a.key} className="market-card">
            <div className="market-name">{a.label}</div>
            <div className="market-price">
              {fmtNum(a.price, a.key === "btc" ? 0 : 2)}
            </div>
            <div className={`market-change ${up ? "up" : "down"}`}>
              {fmtPct(a.changePercent)}
            </div>
            <div className="market-suffix">{a.suffix}</div>
          </div>
        );
      })}
    </div>
  );
});

// ─── STREAMING TILE ───────────────────────────────────────────────────────────
const LADDER = ["Low", "1080p", "4K", "4K HDR"];
const PROFILE_RANK = { Idle: 0, "Low bitrate": 1, "1080p": 2, "4K": 3, "4K HDR": 4 };

const StreamingTile = memo(function StreamingTile({ data }) {
  const active  = data?.tvActive       ?? false;
  const profile = data?.overallProfile ?? "Idle";
  const mbps    = data?.externalMbps   ?? 0;
  const peers   = data?.externalConnections ?? 0;
  const rank    = PROFILE_RANK[profile] ?? 0;

  return (
    <div className={`tile streaming-tile${active ? " s-on" : ""}`}>
      <div className="tile-header">
        <span className="tile-label">Stremio</span>
        <span className={`s-pill ${active ? "pill-live" : "pill-idle"}`}>
          {active ? "LIVE" : "IDLE"}
        </span>
      </div>

      <div className="s-profile">{profile}</div>

      <div className="s-ladder">
        {LADDER.map((step, i) => (
          <div key={step} className="ladder-col">
            <div
              className={`ladder-bar ${i + 1 <= rank ? "bar-on" : ""}`}
              style={{ height: `${20 + i * 10}px` }}
            />
            <div className="ladder-label">{step}</div>
          </div>
        ))}
      </div>

      <div className="s-meta">
        {mbps  > 0 && <span>{fmtNum(mbps, 1)} Mbps</span>}
        {peers > 0 && <span>{peers} peers</span>}
        {data?.tvRecentSeconds != null && !active && (
          <span className="dim">last {data.tvRecentSeconds}s ago</span>
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
      if (str !== prevRef.current) {
        prevRef.current = str;
        setData(j);
        setLast(new Date());
      }
    } catch { /* keep previous value */ }
  }, []);

  useEffect(() => {
    poll(); // eslint-disable-line react-hooks/set-state-in-effect
    const t = setInterval(poll, POLL_MS);
    return () => clearInterval(t);
  }, [poll]);

  return (
    <div className="dashboard">
      <ClockTile />
      <WeatherTile />
      <AdGuardTile   data={data.adguard}   />
      <StreamingTile data={data.streaming} />
      <MarketsTile   data={data.markets}   />
      <footer className="dash-footer">
        {lastUp ? `↻ ${lastUp.toLocaleTimeString("en-GB")}` : "Connecting…"}
      </footer>
    </div>
  );
}