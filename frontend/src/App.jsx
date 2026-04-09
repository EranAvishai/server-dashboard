import { useState, useEffect, useRef, useCallback, memo } from "react";
import "./App.css";

// ─── Constants ────────────────────────────────────────────────────────────────
const POLL_MS = 12_000; // one fetch every 12 s — all tiles update together

// ─── Utilities ────────────────────────────────────────────────────────────────
function fmt(n, decimals = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtPct(n) {
  if (n == null) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${Number(n).toFixed(2)}%`;
}

// ─── Clock tile ───────────────────────────────────────────────────────────────
// Uses requestAnimationFrame — smooth, no extra interval.
const ClockTile = memo(function ClockTile() {
  const [time, setTime] = useState(() => new Date());
  const rafRef = useRef(null);

  useEffect(() => {
    let last = -1;
    function tick() {
      const now = new Date();
      if (now.getSeconds() !== last) {
        last = now.getSeconds();
        setTime(now);
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const hh = String(time.getHours()).padStart(2, "0");
  const mm = String(time.getMinutes()).padStart(2, "0");
  const ss = String(time.getSeconds()).padStart(2, "0");
  const dateStr = time.toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long",
  });

  return (
    <div className="tile tile--clock">
      <div className="clock__time">
        <span className="clock__hhmm">{hh}:{mm}</span>
        <span className="clock__ss">{ss}</span>
      </div>
      <div className="clock__date">{dateStr}</div>
    </div>
  );
});

// ─── AdGuard tile ─────────────────────────────────────────────────────────────
const AdGuardTile = memo(function AdGuardTile({ data }) {
  if (!data) return <div className="tile tile--adguard tile--empty">AdGuard loading…</div>;

  const blocked   = data.num_blocked_filtering ?? 0;
  const total     = data.num_dns_queries       ?? 0;
  const pct       = total > 0 ? ((blocked / total) * 100).toFixed(1) : "0.0";
  const barWidth  = Math.min(100, parseFloat(pct));

  return (
    <div className="tile tile--adguard">
      <div className="tile__label">AdGuard DNS</div>
      <div className="adguard__stats">
        <div className="adguard__stat">
          <span className="adguard__num">{fmt(blocked)}</span>
          <span className="adguard__desc">blocked</span>
        </div>
        <div className="adguard__divider" />
        <div className="adguard__stat">
          <span className="adguard__num">{fmt(total)}</span>
          <span className="adguard__desc">total queries</span>
        </div>
        <div className="adguard__divider" />
        <div className="adguard__stat">
          <span className="adguard__num adguard__num--pct">{pct}%</span>
          <span className="adguard__desc">blocked rate</span>
        </div>
      </div>
      {/* CSS transition on width — only paints when data changes, not continuously */}
      <div className="adguard__bar-track">
        <div className="adguard__bar-fill" style={{ width: `${barWidth}%` }} />
      </div>
    </div>
  );
});

// ─── Market tile ──────────────────────────────────────────────────────────────
const MarketAsset = memo(function MarketAsset({ asset }) {
  const up = asset.changePercent >= 0;
  return (
    <div className={`market__asset market__asset--${up ? "up" : "down"}`}>
      <div className="market__label">{asset.label}</div>
      <div className="market__price">
        {fmt(asset.price, asset.key === "btc" ? 0 : 2)}
        <span className="market__suffix"> {asset.suffix}</span>
      </div>
      <div className="market__change">{fmtPct(asset.changePercent)}</div>
      <div className="market__asof">{asset.asOf}</div>
    </div>
  );
});

const MarketsTile = memo(function MarketsTile({ data }) {
  if (!data?.assets?.length)
    return <div className="tile tile--markets tile--empty">Markets loading…</div>;

  return (
    <div className="tile tile--markets">
      <div className="tile__label">Markets</div>
      <div className="markets__grid">
        {data.assets.map((a) => (
          <MarketAsset key={a.key} asset={a} />
        ))}
      </div>
    </div>
  );
});

// ─── Streaming / Stremio tile ─────────────────────────────────────────────────
const PROFILE_RANK = { Idle: 0, "Low bitrate": 1, "1080p": 2, "4K": 3, "4K HDR": 4 };

const StreamingTile = memo(function StreamingTile({ data }) {
  if (!data) return <div className="tile tile--streaming tile--empty">Stremio loading…</div>;

  const active  = data.tvActive;
  const profile = data.overallProfile ?? "Idle";
  const rank    = PROFILE_RANK[profile] ?? 0;

  return (
    <div className={`tile tile--streaming ${active ? "tile--active" : ""}`}>
      <div className="tile__label">Stremio</div>

      <div className="streaming__status">
        {/* Indicator dot — CSS transition handles the color change smoothly */}
        <span className={`streaming__dot streaming__dot--${active ? "on" : "off"}`} />
        <span className="streaming__label-text">
          {active ? "TV connected" : "Idle"}
        </span>
      </div>

      <div className="streaming__profile">
        <span className="streaming__profile-badge">{profile}</span>
      </div>

      {/* Quality bar — 5 steps, CSS transition on width */}
      <div className="streaming__quality-track">
        {[1, 2, 3, 4, 5].map((step) => (
          <div
            key={step}
            className={`streaming__quality-step ${step <= rank ? "streaming__quality-step--filled" : ""}`}
          />
        ))}
      </div>

      <div className="streaming__meta">
        {data.externalMbps > 0 && (
          <span>{fmt(data.externalMbps, 1)} Mbps</span>
        )}
        {data.externalConnections > 0 && (
          <span>{data.externalConnections} peers</span>
        )}
        {data.tvRecentSeconds != null && !active && (
          <span>last seen {data.tvRecentSeconds}s ago</span>
        )}
      </div>
    </div>
  );
});

// ─── Weather tile ─────────────────────────────────────────────────────────────
// Fetched separately since it's an external API — longer TTL is fine.
// Kept as its own fetch so it doesn't slow down the /api/all response.
const WEATHER_POLL_MS = 10 * 60 * 1000; // 10 min

const WeatherTile = memo(function WeatherTile() {
  const [weather, setWeather] = useState(null);
  const timerRef = useRef(null);

  const loadWeather = useCallback(async () => {
    try {
      // Open-Meteo — no API key needed
      const res = await fetch(
        "https://api.open-meteo.com/v1/forecast?latitude=31.77&longitude=35.21" +
        "&current_weather=true&hourly=relativehumidity_2m&timezone=Asia%2FJerusalem"
      );
      const json = await res.json();
      const cw = json.current_weather;
      setWeather({
        temp: Math.round(cw.temperature),
        windspeed: Math.round(cw.windspeed),
        code: cw.weathercode,
      });
    } catch {
      /* silently skip — old value stays */
    }
  }, []);

  useEffect(() => {
    loadWeather(); // eslint-disable-line react-hooks/set-state-in-effect
    timerRef.current = setInterval(loadWeather, WEATHER_POLL_MS);
    return () => clearInterval(timerRef.current);
  }, [loadWeather]);

  const icon = weatherIcon(weather?.code);

  return (
    <div className="tile tile--weather">
      <div className="tile__label">Jerusalem</div>
      {weather ? (
        <>
          <div className="weather__main">
            <span className="weather__icon">{icon}</span>
            <span className="weather__temp">{weather.temp}°C</span>
          </div>
          <div className="weather__wind">{weather.windspeed} km/h wind</div>
        </>
      ) : (
        <div className="weather__loading">Loading…</div>
      )}
    </div>
  );
});

function weatherIcon(code) {
  if (code == null) return "☁";
  if (code === 0)           return "☀";
  if (code <= 2)            return "⛅";
  if (code <= 3)            return "☁";
  if (code <= 67)           return "🌧";
  if (code <= 77)           return "🌨";
  return "⛈";
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [data, setData]       = useState({});
  const [lastUpdate, setLastUpdate] = useState(null);
  const [error, setError]     = useState(null);
  const timerRef              = useRef(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/all");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      // Only update if something actually changed — avoids React re-render noise
      setData((prev) => {
        const next = JSON.stringify(json);
        if (JSON.stringify(prev) === next) return prev;
        return json;
      });
      setLastUpdate(new Date());
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    poll();
    timerRef.current = setInterval(poll, POLL_MS);
    return () => clearInterval(timerRef.current);
  }, [poll]);

  return (
    <div className="dashboard">
      <ClockTile />
      <WeatherTile />
      <AdGuardTile data={data.adguard} />
      <MarketsTile data={data.markets} />
      <StreamingTile data={data.streaming} />

      {/* Subtle last-update indicator — no animation, just a timestamp */}
      <div className="dashboard__footer">
        {error
          ? <span className="footer__error">⚠ {error}</span>
          : lastUpdate
          ? <span className="footer__ts">Updated {lastUpdate.toLocaleTimeString("en-GB")}</span>
          : null}
      </div>
    </div>
  );
}