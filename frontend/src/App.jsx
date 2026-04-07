import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownCircle,
  ArrowUpCircle,
  CloudDrizzle,
  CloudMoon,
  CloudSun,
  Gauge,
  LineChart,
  MoonStar,
  Shield,
  Sun,
  Wifi,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const CONFIG = {
  weather: {
    label: "Nes Ziona, Israel",
    lat: 31.9293,
    lon: 34.7987,
    timezone: "Asia/Jerusalem",
    refreshMs: 10 * 60 * 1000,
  },
  adguard: {
    refreshMs: 60 * 1000,
  },
  market: {
    refreshMs: 16 * 60 * 1000,
    rotateMs: 10 * 1000,
  },
  streamio: {
    refreshMs: 15000,
  },
};

const weatherCodeMap = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Cloudy",
  45: "Fog",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  80: "Showers",
  81: "Rain showers",
  82: "Heavy showers",
  95: "Thunderstorm",
};

function useClock(timezone = "Asia/Jerusalem") {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const date = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: timezone,
  }).format(now);

  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(now);

  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hour12: false,
      timeZone: timezone,
    }).format(now),
  );

  return { date, time, hour };
}

function useWeather() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const fetchWeather = async () => {
      try {
        const params = new URLSearchParams({
          latitude: String(CONFIG.weather.lat),
          longitude: String(CONFIG.weather.lon),
          current: [
            "temperature_2m",
            "apparent_temperature",
            "relative_humidity_2m",
            "wind_speed_10m",
            "weather_code",
          ].join(","),
          daily: ["temperature_2m_max", "temperature_2m_min"].join(","),
          timezone: CONFIG.weather.timezone,
          forecast_days: "1",
        });

        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?${params.toString()}`
        );
        const json = await res.json();

        if (!cancelled) {
          setData(json);
          setError("");
        }
      } catch {
        if (!cancelled) setError("Weather unavailable");
      }
    };

    fetchWeather();
    const id = setInterval(fetchWeather, CONFIG.weather.refreshMs);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!data?.current) {
    return {
      loading: !error,
      error,
      location: CONFIG.weather.label,
      code: 0,
    };
  }

  return {
    loading: false,
    error: "",
    location: CONFIG.weather.label,
    temp: Math.round(data.current.temperature_2m),
    feels: Math.round(data.current.apparent_temperature),
    humidity: data.current.relative_humidity_2m,
    wind: Math.round(data.current.wind_speed_10m),
    high: Math.round(data.daily.temperature_2m_max?.[0] ?? 0),
    low: Math.round(data.daily.temperature_2m_min?.[0] ?? 0),
    condition: weatherCodeMap[data.current.weather_code] || "Weather",
    code: data.current.weather_code,
  };
}

function makeDemoSeries() {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  return hours.map((h) => {
    const wave = Math.sin(h / 3.1) * 160;
    const spike = h > 17 && h < 22 ? 220 : 0;
    const total = Math.max(
      150,
      Math.round(850 + wave + spike + Math.random() * 50)
    );
    const blocked = Math.round(total * (0.18 + Math.random() * 0.08));
    return {
      hour: `${String(h).padStart(2, "0")}:00`,
      total,
      blocked,
      allowed: total - blocked,
    };
  });
}

function useAdGuardStats() {
  const [series, setSeries] = useState(makeDemoSeries());
  const [summary, setSummary] = useState({ total: 0, blocked: 0, ratio: 0 });
  const [status, setStatus] = useState("Loading");

  useEffect(() => {
    let cancelled = false;

    const pull = async () => {
      try {
        const statsRes = await fetch("/api/adguard/stats");
        if (!statsRes.ok) throw new Error("API unreachable");

        const statsJson = await statsRes.json();
        if (cancelled) return;

        const total = Number(statsJson.num_dns_queries ?? 0);
        const blocked = Number(statsJson.num_blocked_filtering ?? 0);
        const ratio = total ? (blocked / total) * 100 : 0;

        let nextSeries = makeDemoSeries();

        if (
          Array.isArray(statsJson.dns_queries) &&
          Array.isArray(statsJson.blocked_filtering)
        ) {
          const dnsQueries = statsJson.dns_queries.slice(-24);
          const blockedQueries = statsJson.blocked_filtering.slice(-24);

          nextSeries = dnsQueries.map((val, idx) => {
            const t = Number(val ?? 0);
            const b = Number(blockedQueries[idx] ?? 0);
            return {
              hour: `${String(idx).padStart(2, "0")}:00`,
              total: t,
              blocked: b,
              allowed: Math.max(0, t - b),
            };
          });
        }

        setSeries(nextSeries);
        setSummary({ total, blocked, ratio });
        setStatus("Live");
      } catch {
        if (!cancelled) {
          setStatus("Fallback");
          setSeries(makeDemoSeries());
        }
      }
    };

    pull();
    const id = setInterval(pull, CONFIG.adguard.refreshMs);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { series, summary, status };
}

function useMarketData() {
  const [assets, setAssets] = useState([]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const pull = async () => {
      try {
        const res = await fetch("/api/markets/quotes");
        if (!res.ok) throw new Error("Quotes unavailable");
        const json = await res.json();

        if (!cancelled && Array.isArray(json.assets)) {
          setAssets(json.assets);
        }
      } catch {
        if (!cancelled) {
          setAssets([
            {
              key: "sp500",
              label: "S&P 500",
              price: 5238.1,
              changePercent: 0.42,
              suffix: "USD",
              asOf: "Fallback",
            },
            {
              key: "ta125",
              label: "TA-125",
              price: 2014.6,
              changePercent: -0.18,
              suffix: "ILS",
              asOf: "Fallback",
            },
            {
              key: "gold",
              label: "Gold",
              price: 2198.4,
              changePercent: 0.33,
              suffix: "USD",
              asOf: "Fallback",
            },
            {
              key: "btc",
              label: "Bitcoin",
              price: 68240.0,
              changePercent: 1.4,
              suffix: "USD",
              asOf: "Fallback",
            },
          ]);
        }
      }
    };

    pull();
    const refreshId = setInterval(pull, CONFIG.market.refreshMs);

    return () => {
      cancelled = true;
      clearInterval(refreshId);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((prev) => (assets.length ? (prev + 1) % assets.length : 0));
    }, CONFIG.market.rotateMs);

    return () => clearInterval(id);
  }, [assets.length]);

  const current = assets[index] || null;
  return { current, count: assets.length, index };
}

function useStreamioStatus() {
  const [data, setData] = useState({
    tvIp: "192.168.1.110",
    tvActive: false,
    tvRecentSeconds: null,
    localStatus: "Checking",
    responseMs: 0,
    externalConnections: 0,
    externalMbps: 0,
    torrentProfile: "Idle",
    overallProfile: "Idle",
    stable: false,
  });

  useEffect(() => {
    let cancelled = false;

    const pull = async () => {
      try {
        const res = await fetch("/api/streamio/status");
        if (!res.ok) throw new Error("Streamio API unavailable");
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) {
          setData({
            tvIp: "192.168.1.110",
            tvActive: false,
            tvRecentSeconds: null,
            localStatus: "Down",
            responseMs: 0,
            externalConnections: 0,
            externalMbps: 0,
            torrentProfile: "Idle",
            overallProfile: "Idle",
            stable: false,
          });
        }
      }
    };

    pull();
    const id = setInterval(pull, CONFIG.streamio.refreshMs);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return data;
}

function getThemeClasses(hour, weatherCode) {
  const rainy = [51, 53, 55, 61, 63, 65, 80, 81, 82, 95].includes(weatherCode);
  const cloudy = [1, 2, 3, 45, 48].includes(weatherCode);
  const clear = weatherCode === 0;

  if (hour >= 5 && hour < 10) {
    if (rainy) return "from-slate-600 via-slate-700 to-slate-950";
    if (cloudy) return "from-slate-500 via-slate-700 to-slate-950";
    if (clear) return "from-blue-500 via-blue-700 to-slate-950";
  }

  if (hour >= 10 && hour < 17) {
    if (rainy) return "from-slate-600 via-slate-800 to-slate-950";
    if (cloudy) return "from-slate-500 via-slate-800 to-slate-950";
    if (clear) return "from-teal-600 via-blue-800 to-slate-950";
  }

  if (hour >= 17 && hour < 20) {
    return "from-indigo-700 via-purple-800 to-slate-950";
  }

  if (rainy) return "from-slate-800 via-slate-900 to-black";
  return "from-slate-900 via-blue-950 to-black";
}

function WeatherIcon({ code, hour }) {
  const night = hour >= 19 || hour < 6;
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82, 95].includes(code)) {
    return <CloudDrizzle className="h-4 w-4" />;
  }
  if (night) return <CloudMoon className="h-4 w-4" />;
  if (code === 0) return <Sun className="h-4 w-4" />;
  return <CloudSun className="h-4 w-4" />;
}

function Card({ children, className = "" }) {
  return (
    <div className={`rounded-3xl border border-white/10 bg-white/6 shadow-xl ${className}`}>
      {children}
    </div>
  );
}

function StatCard({ icon: Icon, title, value, hint, tone = "default" }) {
  const toneClass =
    tone === "good"
      ? "text-emerald-300"
      : tone === "warn"
        ? "text-amber-300"
        : tone === "bad"
          ? "text-rose-300"
          : "text-white";

  return (
    <Card className="flex min-h-[118px] flex-col items-center justify-center p-3 text-center">
      <div className="mb-2 flex items-center gap-2 text-white/65">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[10px] uppercase tracking-[0.24em]">{title}</span>
      </div>
      <div className={`text-[2rem] font-bold leading-none tracking-tight ${toneClass}`}>
        {value}
      </div>
      <div className="mt-2 max-w-[92%] text-sm font-semibold text-white/75">
        {hint}
      </div>
    </Card>
  );
}

function GraphPanel({ data, status }) {
  const badgeClass =
    status === "Live"
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
      : "border-amber-400/20 bg-amber-400/10 text-amber-200";

  return (
    <Card className="h-full p-3">
      <div className="mb-2 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <LineChart className="h-4 w-4" />
            AdGuard analytics
          </div>
          <div className="mt-1 text-xs font-semibold text-white/65">
            Allowed vs blocked DNS activity for the last 24 hours
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-3 rounded-full border border-white/10 bg-black/15 px-3 py-1 text-[11px] font-semibold text-white/70">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-sky-400" />
              <span>Allowed</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-pink-400" />
              <span>Blocked</span>
            </div>
          </div>

          <div className={`rounded-full border px-3 py-1 text-xs font-bold ${badgeClass}`}>
            {status}
          </div>
        </div>
      </div>

      <div className="h-[190px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="blockedFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#fb7185" stopOpacity={0.48} />
                <stop offset="95%" stopColor="#fb7185" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="allowedFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.42} />
                <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
            <XAxis
              dataKey="hour"
              tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={36}
            />
            <Tooltip
              contentStyle={{
                background: "rgba(15,23,42,0.96)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 16,
                color: "white",
              }}
            />
            <Area
              type="monotone"
              dataKey="allowed"
              stroke="#38bdf8"
              strokeWidth={2.2}
              fill="url(#allowedFill)"
            />
            <Area
              type="monotone"
              dataKey="blocked"
              stroke="#fb7185"
              strokeWidth={2.2}
              fill="url(#blockedFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function MarketRotator({ asset, index, count }) {
  if (!asset) {
    return (
      <Card className="p-4">
        <div className="text-sm text-white/60">Loading market data</div>
      </Card>
    );
  }

  const positive = Number(asset.changePercent) >= 0;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.24em] text-white/45">
            Market pulse
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-white">
            {asset.label}
          </div>
          <div className="mt-2 text-xs font-semibold text-white/65">
            Rotates every 10 seconds · refreshes every 16 minutes
          </div>
        </div>
        <div className="rounded-full border border-white/10 bg-black/15 px-3 py-1 text-xs font-bold text-white/75">
          {index + 1}/{count}
        </div>
      </div>

      <div className="mt-5 flex items-end justify-between gap-6">
        <div>
          <div className="text-[3.3rem] font-bold leading-none tracking-tight text-white">
            {Number(asset.price).toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })}
          </div>
          <div className="mt-2 text-sm font-semibold text-white/70">
            {asset.suffix} · updated {asset.asOf}
          </div>
        </div>
        <div
          className={`flex items-center gap-2 rounded-2xl px-4 py-3 text-xl font-bold ${
            positive
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-rose-500/15 text-rose-300"
          }`}
        >
          {positive ? (
            <ArrowUpCircle className="h-5 w-5" />
          ) : (
            <ArrowDownCircle className="h-5 w-5" />
          )}
          {positive ? "+" : ""}
          {Number(asset.changePercent).toFixed(2)}%
        </div>
      </div>
    </Card>
  );
}

function DetailValueTile({ label, value }) {
  return (
    <div className="flex min-h-[88px] flex-col items-center justify-center rounded-2xl bg-black/15 p-3 text-center">
      <div className="text-[10px] uppercase tracking-[0.24em] text-white/45">
        {label}
      </div>
      <div className="mt-2 text-[1.35rem] font-bold leading-tight text-white">
        {value}
      </div>
    </div>
  );
}

function StreamioTile({ streamio }) {
  const sessionLabel = streamio.stable
    ? "Stable"
    : streamio.tvActive
      ? "Active"
      : "Idle";

  const torrentIn =
    streamio.externalMbps && streamio.externalMbps > 0
      ? `${streamio.externalMbps} Mbps`
      : "0 Mbps";

  const frameClass = streamio.stable
    ? "border-cyan-300/30 bg-cyan-300/10"
    : "border-white/10 bg-white/6";

  const bandClass = streamio.stable
    ? "border-cyan-300/30 bg-cyan-300/18 text-cyan-100"
    : streamio.tvActive
      ? "border-amber-300/25 bg-amber-300/15 text-amber-100"
      : "border-white/10 bg-black/15 text-white/80";

  return (
    <div className={`rounded-3xl border p-3 shadow-xl ${frameClass}`}>
      <div className={`mb-3 rounded-2xl border px-4 py-4 text-center ${bandClass}`}>
        <div className="text-[10px] uppercase tracking-[0.24em]">
          Stream stability
        </div>
        <div className="mt-1 text-[2rem] font-bold leading-none">
          {sessionLabel}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex min-h-[132px] flex-col items-center justify-center rounded-2xl bg-black/15 p-4 text-center">
          <div className="text-[10px] uppercase tracking-[0.24em] text-white/45">
            Quality
          </div>
          <div className="mt-3 text-[2.5rem] font-bold leading-none text-white">
            {streamio.overallProfile}
          </div>
        </div>

        <div className="flex min-h-[132px] flex-col items-center justify-center rounded-2xl bg-black/15 p-4 text-center">
          <div className="text-[10px] uppercase tracking-[0.24em] text-white/45">
            Torrent in
          </div>
          <div className="mt-3 text-[2.1rem] font-bold leading-none text-white">
            {torrentIn}
          </div>
        </div>
      </div>
  );
}

function ClockTile({ time, date }) {
  return (
    <Card className="rounded-[2rem] px-5 py-4">
      <div className="flex h-full flex-col items-center justify-center text-center">
        <div className="mb-2 text-[10px] uppercase tracking-[0.28em] text-sky-200/80">
          MacBook server kiosk
        </div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-white/45">
          <MoonStar className="h-3.5 w-3.5" />
          Local time
        </div>
        <div className="mt-3 text-[4.6rem] font-bold leading-none tracking-tight text-white">
          {time}
        </div>
        <div className="mt-3 text-lg font-semibold text-white/70">{date}</div>
      </div>
    </Card>
  );
}

export default function ServerKioskDashboard() {
  const { date, time, hour } = useClock(CONFIG.weather.timezone);
  const weather = useWeather();
  const { series, summary, status } = useAdGuardStats();
  const market = useMarketData();
  const streamio = useStreamioStatus();

  const blockedPercent = useMemo(
    () => `${summary.ratio.toFixed(1)}%`,
    [summary.ratio]
  );

  const themeClass = useMemo(
    () => getThemeClasses(hour, weather.code),
    [hour, weather.code]
  );

  const streamTone =
    streamio.stable
      ? "good"
      : streamio.tvActive
        ? "warn"
        : "bad";

  return (
    <div className="h-screen overflow-hidden bg-slate-950 text-white">
      <div className={`h-screen overflow-hidden bg-gradient-to-b ${themeClass} px-3 py-3 lg:px-4 lg:py-4`}>
        <div className="mx-auto flex h-full max-w-[1500px] flex-col gap-3">
          <header className="grid grid-cols-1 gap-3 xl:grid-cols-[0.72fr_1.28fr]">
            <ClockTile time={time} date={date} />

            <div className="grid grid-cols-2 gap-3">
              <StatCard
                icon={() => <WeatherIcon code={weather.code} hour={hour} />}
                title="Weather"
                value={weather.loading ? "--" : `${weather.temp}°C`}
                hint={
                  weather.loading
                    ? "Fetching Nes Ziona"
                    : `${weather.condition} · feels ${weather.feels}°`
                }
              />
              <StatCard
                icon={Shield}
                title="Blocked"
                value={blockedPercent}
                hint="Current AdGuard block ratio"
              />
              <StatCard
                icon={Activity}
                title="Queries"
                value={summary.total.toLocaleString()}
                hint="Total DNS queries"
              />
              <StatCard
                icon={Wifi}
                title="TV / Stream"
                value={streamio.stable ? "Stable" : streamio.tvActive ? "Active" : "Idle"}
                hint={`${streamio.overallProfile} · ${streamio.externalMbps || 0} Mbps`}
                tone={streamTone}
              />
            </div>
          </header>

          <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[1.08fr_0.92fr]">
            <section className="flex min-h-0 flex-col gap-3">
              <MarketRotator
                asset={market.current}
                index={market.index}
                count={market.count || 4}
              />
              <div className="min-h-0 flex-1">
                <GraphPanel data={series} status={status} />
              </div>
            </section>

            <aside className="grid min-h-0 grid-cols-1 gap-3">
              <Card className="p-3">
                <div className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
                  <Gauge className="h-4 w-4" />
                  Weather details
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <DetailValueTile
                    label="Today"
                    value={weather.loading ? "--" : `${weather.high}° / ${weather.low}°`}
                  />
                  <DetailValueTile
                    label="Wind"
                    value={weather.loading ? "--" : `${weather.wind} km/h`}
                  />
                </div>
              </Card>

              <StreamioTile streamio={streamio} />
            </aside>
          </main>
        </div>
      </div>
    </div>
  );
}