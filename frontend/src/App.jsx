import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownCircle,
  ArrowUpCircle,
  BadgeCheck,
  CloudDrizzle,
  CloudMoon,
  CloudSun,
  Gauge,
  LineChart,
  MoonStar,
  Server,
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
    refreshMs: 60 * 1000,
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

        const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
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
    const total = Math.max(150, Math.round(850 + wave + spike + Math.random() * 50));
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
  const [status, setStatus] = useState("Loading AdGuard");

  useEffect(() => {
    let cancelled = false;

    const pull = async () => {
      try {
        const [statsRes, historyRes] = await Promise.all([
          fetch("/api/adguard/stats"),
          fetch("/api/adguard/history"),
        ]);

        if (!statsRes.ok || !historyRes.ok) throw new Error("API unreachable");

        const statsJson = await statsRes.json();
        const historyJson = await historyRes.json();

        if (cancelled) return;

        const total = Number(statsJson.num_dns_queries ?? 0);
        const blocked = Number(statsJson.num_blocked_filtering ?? 0);
        const ratio = total ? (blocked / total) * 100 : 0;

        let nextSeries = makeDemoSeries();
        if (Array.isArray(historyJson.dns_queries) && Array.isArray(historyJson.blocked_filtering)) {
          const dnsQueries = historyJson.dns_queries.slice(-24);
          const blockedQueries = historyJson.blocked_filtering.slice(-24);
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
        if (!cancelled) setStatus("Demo");
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
            { key: "sp500", label: "S&P 500", price: 5238.1, changePercent: 0.42, suffix: "USD", asOf: "Demo" },
            { key: "ta125", label: "TA-125", price: 2014.6, changePercent: -0.18, suffix: "ILS", asOf: "Demo" },
            { key: "gold", label: "Gold", price: 2198.4, changePercent: 0.33, suffix: "USD", asOf: "Demo" },
            { key: "btc", label: "Bitcoin", price: 68240.0, changePercent: 1.4, suffix: "USD", asOf: "Demo" },
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
  const [data, setData] = useState({ status: "Checking", quality: "Unknown", mbps: 0, responseMs: 0 });

  useEffect(() => {
    let cancelled = false;

    const pull = async () => {
      try {
        const res = await fetch("/api/streamio/status");
        if (!res.ok) throw new Error("Streamio API unavailable");
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setData({ status: "Down", quality: "Unknown", mbps: 0, responseMs: 0 });
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

function pickTheme(hour, weatherCode) {
  const rainy = [51, 53, 55, 61, 63, 65, 80, 81, 82, 95].includes(weatherCode);
  const cloudy = [1, 2, 3, 45, 48].includes(weatherCode);

  if (hour >= 5 && hour < 11) {
    return rainy
      ? "bg-[radial-gradient(circle_at_top_left,_rgba(125,211,252,0.20),_transparent_32%),linear-gradient(180deg,_#0f172a_0%,_#1e293b_55%,_#0f172a_100%)]"
      : cloudy
        ? "bg-[radial-gradient(circle_at_top_left,_rgba(148,163,184,0.18),_transparent_32%),linear-gradient(180deg,_#172554_0%,_#1e3a8a_52%,_#0f172a_100%)]"
        : "bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.22),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.16),_transparent_26%),linear-gradient(180deg,_#1e3a8a_0%,_#0f172a_100%)]";
  }

  if (hour >= 11 && hour < 18) {
    return rainy
      ? "bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.18),_transparent_28%),linear-gradient(180deg,_#0f172a_0%,_#1e293b_50%,_#111827_100%)]"
      : cloudy
        ? "bg-[radial-gradient(circle_at_top_left,_rgba(148,163,184,0.18),_transparent_30%),linear-gradient(180deg,_#0f172a_0%,_#1f2937_48%,_#020617_100%)]"
        : "bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.16),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(251,191,36,0.16),_transparent_26%),linear-gradient(180deg,_#082f49_0%,_#0f172a_100%)]";
  }

  if (hour >= 18 && hour < 21) {
    return rainy
      ? "bg-[radial-gradient(circle_at_top_left,_rgba(125,211,252,0.14),_transparent_32%),radial-gradient(circle_at_top_right,_rgba(244,114,182,0.12),_transparent_28%),linear-gradient(180deg,_#1e293b_0%,_#0f172a_100%)]"
      : "bg-[radial-gradient(circle_at_top_left,_rgba(251,146,60,0.20),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(244,114,182,0.16),_transparent_26%),linear-gradient(180deg,_#312e81_0%,_#0f172a_100%)]";
  }

  return rainy
    ? "bg-[radial-gradient(circle_at_top_left,_rgba(96,165,250,0.14),_transparent_30%),linear-gradient(180deg,_#020617_0%,_#111827_50%,_#0f172a_100%)]"
    : "bg-[radial-gradient(circle_at_top_left,_rgba(129,140,248,0.16),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.10),_transparent_24%),linear-gradient(180deg,_#020617_0%,_#0f172a_55%,_#111827_100%)]";
}

function WeatherIcon({ code, hour }) {
  const night = hour >= 19 || hour < 6;
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82, 95].includes(code)) return <CloudDrizzle className="h-5 w-5" />;
  if (night) return <CloudMoon className="h-5 w-5" />;
  if (code === 0) return <Sun className="h-5 w-5" />;
  return <CloudSun className="h-5 w-5" />;
}

function StatCard({ icon: Icon, title, value, hint, tone = "default" }) {
  const toneClass = tone === "good"
    ? "text-emerald-300"
    : tone === "warn"
      ? "text-amber-300"
      : tone === "bad"
        ? "text-rose-300"
        : "text-white";

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-2xl backdrop-blur-sm">
      <div className="mb-3 flex items-center gap-2 text-white/65">
        <Icon className="h-4 w-4" />
        <span className="text-xs uppercase tracking-[0.22em]">{title}</span>
      </div>
      <div className={`text-3xl font-semibold tracking-tight ${toneClass}`}>{value}</div>
      <div className="mt-2 text-sm text-white/50">{hint}</div>
    </div>
  );
}

function GraphPanel({ data, status }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-2xl backdrop-blur-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            <LineChart className="h-4 w-4" />
            AdGuard analytics
          </div>
          <div className="mt-1 text-sm text-white/55">Allowed vs blocked DNS activity for the last 24 hours</div>
        </div>
        <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-white/70">{status}</div>
      </div>

      <div className="h-[330px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="blockedFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#fb7185" stopOpacity={0.55} />
                <stop offset="95%" stopColor="#fb7185" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="allowedFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.45} />
                <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
            <XAxis dataKey="hour" tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} tickLine={false} axisLine={false} width={46} />
            <Tooltip
              contentStyle={{
                background: "rgba(15,23,42,0.95)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 16,
                color: "white",
              }}
            />
            <Area type="monotone" dataKey="allowed" stroke="#38bdf8" strokeWidth={2.2} fill="url(#allowedFill)" />
            <Area type="monotone" dataKey="blocked" stroke="#fb7185" strokeWidth={2.2} fill="url(#blockedFill)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function MarketRotator({ asset, index, count }) {
  if (!asset) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-2xl backdrop-blur-sm">
        <div className="text-sm text-white/60">Loading market data</div>
      </div>
    );
  }

  const positive = Number(asset.changePercent) >= 0;

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-2xl backdrop-blur-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-white/45">Market pulse</div>
          <div className="mt-2 text-3xl font-semibold tracking-tight text-white">{asset.label}</div>
          <div className="mt-2 text-sm text-white/55">Rotates every 10 seconds · refreshes every 16 minutes</div>
        </div>
        <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-white/70">
          {index + 1}/{count}
        </div>
      </div>

      <div className="mt-8 flex items-end justify-between gap-6">
        <div>
          <div className="text-5xl font-semibold tracking-tight text-white">
            {Number(asset.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
          <div className="mt-2 text-sm text-white/50">{asset.suffix} · updated {asset.asOf}</div>
        </div>
        <div className={`flex items-center gap-2 rounded-2xl px-4 py-3 text-lg font-medium ${positive ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>
          {positive ? <ArrowUpCircle className="h-5 w-5" /> : <ArrowDownCircle className="h-5 w-5" />}
          {positive ? "+" : ""}{Number(asset.changePercent).toFixed(2)}%
        </div>
      </div>
    </div>
  );
}

export default function ServerKioskDashboard() {
  const { date, time, hour } = useClock(CONFIG.weather.timezone);
  const weather = useWeather();
  const { series, summary, status } = useAdGuardStats();
  const market = useMarketData();
  const streamio = useStreamioStatus();

  const blockedPercent = useMemo(() => `${summary.ratio.toFixed(1)}%`, [summary.ratio]);
  const themeClass = useMemo(() => pickTheme(hour, weather.code), [hour, weather.code]);

  const streamTone = streamio.status !== "Up"
    ? "bad"
    : streamio.quality.includes("HDR")
      ? "good"
      : streamio.quality.includes("4K")
        ? "good"
        : streamio.quality.includes("1080")
          ? "warn"
          : "warn";

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className={`min-h-screen px-5 py-5 lg:px-6 lg:py-6 ${themeClass}`}>
        <div className="mx-auto flex h-full max-w-[1600px] flex-col gap-5">
          <header className="grid grid-cols-1 gap-5 xl:grid-cols-[1.35fr_1fr]">
            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur-sm">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.28em] text-sky-200/80">
                    <Server className="h-4 w-4" />
                    MacBook server kiosk
                  </div>
                  <h1 className="mt-4 text-5xl font-semibold tracking-tight text-white lg:text-6xl">Operations Wallboard</h1>
                  <p className="mt-3 max-w-2xl text-base text-white/60 lg:text-lg">
                    Live weather, rotating markets, AdGuard analytics, and Stremio health in a kiosk layout tuned for a 13.3&quot; Retina display.
                  </p>
                </div>
                <div className="hidden text-right lg:block">
                  <div className="flex items-center justify-end gap-2 text-xs uppercase tracking-[0.24em] text-white/45">
                    <MoonStar className="h-4 w-4" />
                    Local time
                  </div>
                  <div className="mt-3 text-5xl font-semibold tracking-tight">{time}</div>
                  <div className="mt-2 text-sm text-white/55">{date}</div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-2">
              <StatCard
                icon={() => <WeatherIcon code={weather.code} hour={hour} />}
                title="Weather"
                value={weather.loading ? "--" : `${weather.temp}°C`}
                hint={weather.loading ? "Fetching Nes Ziona" : `${weather.condition} • feels ${weather.feels}°`}
              />
              <StatCard icon={Shield} title="Blocked" value={blockedPercent} hint="Current AdGuard block ratio" />
              <StatCard icon={Activity} title="Queries" value={summary.total.toLocaleString()} hint="Total DNS queries" />
              <StatCard
                icon={Wifi}
                title="Stremio"
                value={streamio.status}
                hint={`${streamio.quality} • ${streamio.mbps ? `${streamio.mbps} Mbps` : "No speed sample"}`}
                tone={streamTone}
              />
            </div>
          </header>

          <main className="grid grid-cols-1 gap-5 xl:grid-cols-[1.2fr_0.95fr]">
            <section className="flex flex-col gap-5">
              <MarketRotator asset={market.current} index={market.index} count={market.count || 4} />
              <GraphPanel data={series} status={status} />
            </section>

            <aside className="grid grid-cols-1 gap-5">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-2xl backdrop-blur-sm">
                <div className="mb-4 flex items-center gap-2 text-sm font-medium text-white">
                  <Gauge className="h-4 w-4" />
                  Weather details
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-2xl bg-black/20 p-4">
                    <div className="text-xs uppercase tracking-[0.22em] text-white/45">Location</div>
                    <div className="mt-2 text-lg font-semibold">{weather.location}</div>
                  </div>
                  <div className="rounded-2xl bg-black/20 p-4">
                    <div className="text-xs uppercase tracking-[0.22em] text-white/45">Today</div>
                    <div className="mt-2 text-lg font-semibold">{weather.loading ? "--" : `${weather.high}° / ${weather.low}°`}</div>
                  </div>
                  <div className="rounded-2xl bg-black/20 p-4">
                    <div className="text-xs uppercase tracking-[0.22em] text-white/45">Humidity</div>
                    <div className="mt-2 text-lg font-semibold">{weather.loading ? "--" : `${weather.humidity}%`}</div>
                  </div>
                  <div className="rounded-2xl bg-black/20 p-4">
                    <div className="text-xs uppercase tracking-[0.22em] text-white/45">Wind</div>
                    <div className="mt-2 text-lg font-semibold">{weather.loading ? "--" : `${weather.wind} km/h`}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-2xl backdrop-blur-sm">
                <div className="mb-4 flex items-center gap-2 text-sm font-medium text-white">
                  <BadgeCheck className="h-4 w-4" />
                  Stremio health tile
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-2xl bg-black/20 p-4">
                    <div className="text-xs uppercase tracking-[0.22em] text-white/45">Server</div>
                    <div className={`mt-2 text-lg font-semibold ${streamio.status === "Up" ? "text-emerald-300" : "text-rose-300"}`}>{streamio.status}</div>
                  </div>
                  <div className="rounded-2xl bg-black/20 p-4">
                    <div className="text-xs uppercase tracking-[0.22em] text-white/45">Profile</div>
                    <div className={`mt-2 text-lg font-semibold ${streamTone === "good" ? "text-emerald-300" : streamTone === "warn" ? "text-amber-300" : "text-rose-300"}`}>{streamio.quality}</div>
                  </div>
                  <div className="rounded-2xl bg-black/20 p-4">
                    <div className="text-xs uppercase tracking-[0.22em] text-white/45">Speed sample</div>
                    <div className="mt-2 text-lg font-semibold">{streamio.mbps ? `${streamio.mbps} Mbps` : "--"}</div>
                  </div>
                  <div className="rounded-2xl bg-black/20 p-4">
                    <div className="text-xs uppercase tracking-[0.22em] text-white/45">Response</div>
                    <div className="mt-2 text-lg font-semibold">{streamio.responseMs ? `${streamio.responseMs} ms` : "--"}</div>
                  </div>
                </div>
              </div>
            </aside>
          </main>
        </div>
      </div>
    </div>
  );
}
