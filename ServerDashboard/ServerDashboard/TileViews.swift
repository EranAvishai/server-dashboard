import SwiftUI
import Combine

// ── Tile Container ──────────────────────────────────────────────
struct Tile<Content: View>: View {
    let theme: DashboardTheme
    @ViewBuilder let content: () -> Content
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 16).fill(theme.surface)
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.white.opacity(0.07), lineWidth: 1))
            VStack(alignment: .leading, spacing: 8) { content() }.padding(16)
        }
    }
}

// ── CLOCK ────────────────────────────────────────────────────────
struct ClockTile: View {
    let now: Date; let theme: DashboardTheme; var fontScale: Double = 1.0
    var body: some View {
        Tile(theme: theme) {
            Spacer(minLength: 0)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                // Use system heavy rounded — guaranteed to have ":" on macOS 12
                Text(hh).font(.system(size: 82 * fontScale, weight: .heavy, design: .rounded))
                    .monospacedDigit().foregroundColor(theme.t1)
                Text(":").font(.system(size: 72 * fontScale, weight: .heavy, design: .rounded))
                    .foregroundColor(theme.t1).padding(.bottom, 2)
                Text(mm).font(.system(size: 82 * fontScale, weight: .heavy, design: .rounded))
                    .monospacedDigit().foregroundColor(theme.t1)
                Text(ss).font(.system(size: 32 * fontScale, weight: .heavy, design: .rounded))
                    .monospacedDigit().foregroundColor(theme.t3).padding(.bottom, 4)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .minimumScaleFactor(0.6).lineLimit(1)
            Spacer(minLength: 0)
        }
    }
    private var hh: String { let f = DateFormatter(); f.dateFormat = "HH"; return f.string(from: now) }
    private var mm: String { let f = DateFormatter(); f.dateFormat = "mm"; return f.string(from: now) }
    private var ss: String { let f = DateFormatter(); f.dateFormat = "ss"; return f.string(from: now) }
}

// ── DATE ─────────────────────────────────────────────────────────
struct DateTile: View {
    let now: Date; let theme: DashboardTheme; var fontScale: Double = 1.0
    private var weekday: String { let f = DateFormatter(); f.dateFormat = "EEEE"; return f.string(from: now).uppercased() }
    private var fullDate: String { let f = DateFormatter(); f.dateFormat = "d MMMM yyyy"; return f.string(from: now) }
    var body: some View {
        Tile(theme: theme) {
            Spacer(minLength: 0)
            VStack(spacing: 4) {
                Text(weekday).font(.system(size: 34 * fontScale, weight: .heavy)).foregroundColor(theme.accent)
                Text(fullDate).font(.system(size: 17 * fontScale, weight: .bold)).foregroundColor(theme.t2)
            }.frame(maxWidth: .infinity)
            Spacer(minLength: 0)
        }
    }
}

// ── WEATHER ──────────────────────────────────────────────────────
struct WeatherTile: View {
    let data: WeatherData?; let theme: DashboardTheme
    var body: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 16)
                .fill(LinearGradient(colors: [theme.wxGradTop, theme.wxGradBottom],
                                     startPoint: .topLeading, endPoint: .bottomTrailing))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.white.opacity(0.07), lineWidth: 1))

            VStack(alignment: .leading, spacing: 8) {
                Text("NESS ZIONA").font(.system(size: 11, weight: .bold)).foregroundColor(.white.opacity(0.42))
                Spacer(minLength: 0)
                if let cw = data?.current_weather {
                    HStack(alignment: .center, spacing: 10) {
                        Text(wxIcon(code: cw.weathercode, isDay: cw.is_day == 1)).font(.system(size: 56))
                        Text("\(Int(cw.temperature))°").font(.custom("Impact", size: 120)).foregroundColor(.white)
                    }.frame(maxWidth: .infinity, alignment: .center)

                    Text(wxDesc(code: cw.weathercode)).font(.system(size: 22, weight: .medium))
                        .foregroundColor(.white.opacity(0.72)).frame(maxWidth: .infinity, alignment: .center)

                    if let d = data?.daily, let hi = d.temperature_2m_max, let lo = d.temperature_2m_min {
                        HStack(spacing: 16) {
                            Text("↑ \(Int(hi[0]))°").font(.system(size: 20, weight: .semibold)).foregroundColor(Color(hex: "ffd264"))
                            Text("↓ \(Int(lo[0]))°").font(.system(size: 20, weight: .semibold)).foregroundColor(Color(hex: "8cbaff"))
                            Text("\(Int(cw.windspeed)) km/h").font(.system(size: 18)).foregroundColor(.white.opacity(0.55))
                        }.frame(maxWidth: .infinity, alignment: .center)
                    }
                } else {
                    Text("Loading…").foregroundColor(.white.opacity(0.4)).frame(maxWidth: .infinity, alignment: .center)
                }
                Spacer(minLength: 0)

                if let d = data?.daily, let hi = d.temperature_2m_max, let lo = d.temperature_2m_min,
                   let codes = d.weathercode, let days = d.time {
                    HStack(spacing: 8) {
                        ForEach(1..<min(4, days.count), id: \.self) { i in
                            ForecastCard(day: shortDay(days[i]), icon: wxIcon(code: codes[i], isDay: true),
                                         high: Int(hi[i]), low: Int(lo[i]), theme: theme)
                        }
                    }
                }
            }.padding(16)
        }
    }
    private func shortDay(_ iso: String) -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: iso) else { return "—" }
        let df = DateFormatter(); df.dateFormat = "EEE"; return df.string(from: d).uppercased()
    }
}

struct ForecastCard: View {
    let day: String; let icon: String; let high: Int; let low: Int; let theme: DashboardTheme
    var body: some View {
        VStack(spacing: 4) {
            Text(day).font(.system(size: 13, weight: .heavy)).foregroundColor(.white.opacity(0.7))
            Text(icon).font(.system(size: 32))
            Text("↑\(high)°").font(.system(size: 20, weight: .bold)).foregroundColor(Color(hex: "ffd264"))
            Text("↓\(low)°").font(.system(size: 17, weight: .medium)).foregroundColor(Color(hex: "8cbaff").opacity(0.7))
        }
        .frame(maxWidth: .infinity).padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.06)))
    }
}

// ── ADGUARD ──────────────────────────────────────────────────────
struct AdGuardTile: View {
    let data: AdGuardData?; let theme: DashboardTheme
    var body: some View {
        Tile(theme: theme) {
            HStack {
                Text("ADGUARD").font(.system(size: 10, weight: .bold)).foregroundColor(theme.t3)
                Spacer()
                if let ms = data?.avgMs {
                    Text("\(Int(ms)) ms").font(.system(size: 10, weight: .bold))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(RoundedRectangle(cornerRadius: 6).fill(theme.accent.opacity(0.18)))
                        .foregroundColor(theme.accent)
                }
            }
            if let s = data {
                agRow("BLOCKED", fmtK(Double(s.blocked)), theme.accent)
                agRow("QUERIES", fmtK(Double(s.queries)), theme.t1)
                agRow("RATE", String(format: "%.1f%%", s.rate), Color(hex: "f87171"))
                Spacer(minLength: 4)
                AdGuardChart(queries: s.hourlyQueries ?? [], blocked: s.hourlyBlocked ?? [], accent: theme.accent)
                HStack {
                    Text("24h ago").font(.system(size: 9, weight: .semibold)).foregroundColor(theme.t3)
                    Spacer()
                    Text("now").font(.system(size: 9, weight: .semibold)).foregroundColor(theme.t3)
                }
            } else { Spacer(); Text("Loading…").font(.system(size: 12)).foregroundColor(theme.t3).frame(maxWidth: .infinity, alignment: .center); Spacer() }
        }
    }
    private func agRow(_ label: String, _ value: String, _ color: Color) -> some View {
        HStack {
            Text(label).font(.system(size: 10, weight: .bold)).foregroundColor(theme.t3)
            Spacer()
            Text(value).font(.custom("Impact", size: 28)).monospacedDigit().foregroundColor(color)
        }
    }
    private func fmtK(_ n: Double) -> String {
        if n >= 1_000_000 { return String(format: "%.1fM", n / 1_000_000) }
        if n >= 1_000     { return String(format: "%.1fK", n / 1_000) }
        return "\(Int(n))"
    }
}

struct AdGuardChart: View {
    let queries: [Int]; let blocked: [Int]; let accent: Color
    private let nowH = Calendar.current.component(.hour, from: Date())
    var body: some View {
        GeometryReader { geo in
            let c = queries.count; let mx = CGFloat(queries.max() ?? 1)
            let step = geo.size.width / CGFloat(c); let bw = step * 0.65
            ZStack(alignment: .bottomLeading) {
                ForEach(0..<c, id: \.self) { i in
                    let x = step * CGFloat(i)
                    let qH = max(2, CGFloat(queries[i]) / mx * geo.size.height * 0.94)
                    let bH = i < blocked.count ? max(2, CGFloat(blocked[i]) / mx * geo.size.height * 0.94) : 0
                    let isN = (i % 24) == (nowH % 24)
                    RoundedRectangle(cornerRadius: 1.5).fill(isN ? Color.white.opacity(0.18) : Color.white.opacity(0.055))
                        .frame(width: bw, height: qH).position(x: x + bw/2, y: geo.size.height - qH/2)
                    if bH > 0 {
                        RoundedRectangle(cornerRadius: 1.5).fill(accent.opacity(isN ? 0.9 : 0.65))
                            .frame(width: bw, height: bH).position(x: x + bw/2, y: geo.size.height - bH/2)
                    }
                }
            }
        }.frame(minHeight: 60)
    }
}

// ── STREAMING ────────────────────────────────────────────────────
struct StreamingTile: View {
    let data: StreamingData?; let theme: DashboardTheme
    private var active: Bool { data?.tvActive == true }
    private var profile: String { data?.overallProfile ?? "Idle" }
    private var mbps: Double { data?.externalMbps ?? 0 }
    private var peers: Int { data?.externalConnections ?? 0 }
    private var rank: Int { profileRank[profile] ?? 0 }
    private let teal = Color(hex: "2dd4bf")

    // Clean up torrent title for display
    private var nowPlayingTitle: String? {
        guard let raw = data?.nowPlaying?.title, active else { return nil }
        return cleanTitle(raw)
    }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 16).fill(theme.surface)
                .overlay(RoundedRectangle(cornerRadius: 16)
                    .stroke(active ? teal.opacity(0.35) : Color.white.opacity(0.07), lineWidth: 1))
            VStack(alignment: .leading, spacing: 10) {
                // Header
                HStack {
                    Text("STREMIO").font(.system(size: 11, weight: .bold)).foregroundColor(theme.t3)
                    Spacer()
                    Text(active ? "LIVE" : "IDLE").font(.system(size: 10, weight: .heavy))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(RoundedRectangle(cornerRadius: 6)
                            .fill(active ? teal.opacity(0.18) : Color.white.opacity(0.06)))
                        .foregroundColor(active ? teal : theme.t3)
                }

                // Now Playing title (shown when streaming)
                if let title = nowPlayingTitle {
                    Text(title)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(teal.opacity(0.9))
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }

                ArcGaugeView(rank: rank, active: active, accent: teal)

                // MBPS
                HStack(alignment: .lastTextBaseline, spacing: 6) {
                    Text(mbps > 0 ? String(format: "%.1f", mbps) : "—")
                        .font(.custom("Impact", size: 38)).monospacedDigit().foregroundColor(active ? teal : theme.t1)
                    Text("MBPS").font(.system(size: 12, weight: .bold)).foregroundColor(theme.t2)
                }
                // PEERS
                HStack(alignment: .lastTextBaseline, spacing: 6) {
                    Text(peers > 0 ? "\(peers)" : "—")
                        .font(.custom("Impact", size: 38)).monospacedDigit().foregroundColor(active ? teal : theme.t1)
                    Text("PEERS").font(.system(size: 12, weight: .bold)).foregroundColor(theme.t2)
                }
            }.padding(16)
        }
    }

    /// Strip file extension, codec tags, resolution tags, and common torrent junk
    private func cleanTitle(_ raw: String) -> String {
        var t = raw
        // Remove file extension
        let extensions = [".mkv", ".mp4", ".avi", ".mov", ".webm", ".ts"]
        for ext in extensions {
            if t.lowercased().hasSuffix(ext) {
                t = String(t.dropLast(ext.count))
                break
            }
        }
        // Replace dots and underscores with spaces
        t = t.replacingOccurrences(of: ".", with: " ")
        t = t.replacingOccurrences(of: "_", with: " ")
        // Remove codec/resolution/quality tags
        let junkPatterns = [
            "\\b(x264|x265|h264|h265|hevc|avc|aac|ac3|dts|flac|eac3|atmos)\\b",
            "\\b(720p|1080p|2160p|4k|uhd|hdr|hdr10|dolby|vision|remux|bluray|blu ray|bdrip|brrip|webrip|web dl|web-dl|hdtv|dvdrip)\\b",
            "\\b(yts|yify|rarbg|ettv|sparks|geckos|ntb|megusta|cmrg|evo)\\b",
            "\\[.*?\\]",
            "\\(.*?\\)",
        ]
        for pattern in junkPatterns {
            if let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) {
                t = regex.stringByReplacingMatches(in: t, range: NSRange(location: 0, length: t.utf16.count), withTemplate: "")
            }
        }
        // Collapse multiple spaces, trim
        while t.contains("  ") { t = t.replacingOccurrences(of: "  ", with: " ") }
        t = t.trimmingCharacters(in: .whitespacesAndNewlines)
        // Detect S01E04 pattern and format nicely
        if let regex = try? NSRegularExpression(pattern: "(?i)(s\\d{1,2}e\\d{1,2})", options: []),
           let match = regex.firstMatch(in: t, range: NSRange(location: 0, length: t.utf16.count)) {
            let nsRange = match.range
            let epStart = t.index(t.startIndex, offsetBy: nsRange.location)
            let epEnd = t.index(epStart, offsetBy: nsRange.length)
            let episode = String(t[epStart..<epEnd]).uppercased()
            let show = String(t[t.startIndex..<epStart]).trimmingCharacters(in: .whitespaces)
            return "\(show) \(episode)"
        }
        return t
    }
}

// ── Arc Gauge ────────────────────────────────────────────────────
struct FillArcShape: Shape {
    var endAngleDeg: Double
    var animatableData: Double { get { endAngleDeg } set { endAngleDeg = newValue } }
    func path(in rect: CGRect) -> Path {
        var p = Path(); guard abs(endAngleDeg - 90) > 0.5 else { return p }
        let cx = rect.width * 0.18, cy = rect.midY, r = min(rect.width * 0.44, rect.height * 0.44)
        p.addArc(center: CGPoint(x: cx, y: cy), radius: r, startAngle: .degrees(90), endAngle: .degrees(endAngleDeg), clockwise: true)
        return p
    }
}
struct NeedleShape: Shape {
    var angleDeg: Double
    var animatableData: Double { get { angleDeg } set { angleDeg = newValue } }
    func path(in rect: CGRect) -> Path {
        var p = Path(); let cx = rect.width * 0.18, cy = rect.midY
        let len = min(rect.width * 0.44, rect.height * 0.44) * 0.76, rad = angleDeg * .pi / 180.0
        p.move(to: CGPoint(x: cx, y: cy)); p.addLine(to: CGPoint(x: cx + len * cos(rad), y: cy + len * sin(rad)))
        return p
    }
}
struct ArcGaugeView: View {
    let rank: Int; let active: Bool; let accent: Color
    @State private var animRank: Double = 0
    private let labels = ["Idle", "Low", "1080p", "4K", "4K HDR"]
    private func deg(_ r: Double) -> Double { 90.0 - r * 45.0 }
    private func dot(_ r: Double, _ rect: CGRect) -> CGPoint {
        let cx = rect.width * 0.18, cy = rect.midY, ra = min(rect.width * 0.44, rect.height * 0.44)
        let a = deg(r) * .pi / 180.0; return CGPoint(x: cx + ra * cos(a), y: cy + ra * sin(a))
    }
    var body: some View {
        ZStack {
            GeometryReader { geo in
                let rect = geo.frame(in: .local)
                let cx = rect.width * 0.18, cy = rect.midY, R = min(rect.width * 0.44, rect.height * 0.44)
                Path { p in p.addArc(center: CGPoint(x: cx, y: cy), radius: R, startAngle: .degrees(90), endAngle: .degrees(-90), clockwise: true) }
                    .stroke(Color.white.opacity(0.08), style: StrokeStyle(lineWidth: 4.5, lineCap: .round))
                FillArcShape(endAngleDeg: deg(animRank)).stroke(accent.opacity(active ? 0.8 : 0), style: StrokeStyle(lineWidth: 4.5, lineCap: .round))
                NeedleShape(angleDeg: deg(animRank)).stroke(active ? Color.white.opacity(0.92) : Color.white.opacity(0.25), style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                ForEach(0..<labels.count, id: \.self) { i in
                    let pos = dot(Double(i), rect)
                    Circle().fill(i <= rank && active ? accent : Color.white.opacity(0.2)).frame(width: 6, height: 6).position(pos)
                    Text(labels[i]).font(.system(size: 10, weight: .semibold))
                        .foregroundColor(i == rank ? Color.white.opacity(0.9) : Color.white.opacity(0.35))
                        .position(x: pos.x + R * 0.38, y: pos.y)
                }
            }
        }
        .onChange(of: rank) { _ in withAnimation(.interpolatingSpring(stiffness: 180, damping: 15)) { animRank = Double(rank) } }
        .onAppear { animRank = Double(rank) }
    }
}

// ── MARKETS ──────────────────────────────────────────────────────
struct MarketsTile: View {
    let data: MarketsData?; let theme: DashboardTheme; var rotateSec: Double = 5.0
    private let order = ["sp500","ta125","gold","btc"]
    private let labels = ["sp500":"S&P 500","ta125":"TA-125","gold":"Gold","btc":"Bitcoin"]
    private var rotateTick: Publishers.Autoconnect<Timer.TimerPublisher> { Timer.publish(every: rotateSec, on: .main, in: .common).autoconnect() }
    @State private var idx = 0; @State private var visible = true
    private var assets: [MarketAsset] { guard let all = data?.assets else { return [] }; return order.compactMap { k in all.first { $0.key == k } } }

    var body: some View {
        Tile(theme: theme) {
            if assets.isEmpty {
                Spacer(); Text("Markets loading…").foregroundColor(theme.t3).frame(maxWidth: .infinity, alignment: .center); Spacer()
            } else {
                let a = assets[idx]; let up = (a.changePercent ?? 0) >= 0
                Spacer(minLength: 0)
                HStack(alignment: .center, spacing: 20) {
                    VStack(spacing: 4) {
                        Text(labels[a.key] ?? a.label).font(.system(size: 20, weight: .heavy)).foregroundColor(.white.opacity(0.9))
                        Text(priceStr(a)).font(.custom("Impact", size: 68)).monospacedDigit().foregroundColor(theme.t1).minimumScaleFactor(0.5).lineLimit(1)
                        HStack(spacing: 10) {
                            Text(pctStr(a.changePercent)).font(.system(size: 18, weight: .bold)).foregroundColor(up ? Color(hex: "34d399") : Color(hex: "f87171"))
                            Text(a.suffix).font(.system(size: 13, weight: .bold)).foregroundColor(theme.t3)
                        }
                    }
                    let spark = (a.sparkline ?? []).compactMap { $0 }
                    if spark.count >= 2 { SparklineView(data: spark, isUp: up).frame(width: 130, height: 75) }
                }
                .frame(maxWidth: .infinity, alignment: .center)
                .opacity(visible ? 1 : 0).offset(x: visible ? 0 : 22)
                .animation(.easeInOut(duration: 0.35), value: visible)
                Spacer(minLength: 0)
                HStack(spacing: 6) { Spacer()
                    ForEach(0..<assets.count, id: \.self) { i in
                        Circle().fill(i == idx ? theme.accent : theme.t3).frame(width: 5, height: 5)
                            .scaleEffect(i == idx ? 1.4 : 1).animation(.easeInOut(duration: 0.35), value: idx)
                    }
                }
            }
        }
        .onReceive(rotateTick) { _ in
            guard assets.count > 1 else { return }; visible = false
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { idx = (idx+1) % assets.count; visible = true }
        }
    }
    private func priceStr(_ a: MarketAsset) -> String { a.price.formatted(.number.grouping(.automatic).precision(.fractionLength(a.key == "btc" ? 0 : 2))) }
    private func pctStr(_ p: Double?) -> String { guard let p else { return "—" }; return (p >= 0 ? "+" : "") + String(format: "%.2f%%", p) }
}

// ── Sparkline ────────────────────────────────────────────────────
struct SparklineView: View {
    let data: [Double]; let isUp: Bool
    var body: some View {
        GeometryReader { geo in
            let W = geo.size.width, H = geo.size.height, mn = data.min()!, mx = data.max()!
            let rng = (mx-mn) > 0 ? (mx-mn) : mn * 0.002
            let pts: [CGPoint] = data.enumerated().map { i, v in
                CGPoint(x: CGFloat(i)/CGFloat(data.count-1)*W, y: H - CGFloat((v-mn)/rng)*H*0.78 - H*0.11)
            }
            let color = isUp ? Color(hex: "34d399") : Color(hex: "f87171")
            Path { p in p.move(to: pts[0]); pts.dropFirst().forEach { p.addLine(to: $0) }; p.addLine(to: CGPoint(x: W, y: H)); p.addLine(to: CGPoint(x: 0, y: H)); p.closeSubpath() }
                .fill(LinearGradient(colors: [color.opacity(0.28), color.opacity(0)], startPoint: .top, endPoint: .bottom))
            Path { p in p.move(to: pts[0]); pts.dropFirst().forEach { p.addLine(to: $0) } }
                .stroke(color, style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
            if let last = pts.last { Circle().fill(color).frame(width: 8, height: 8).position(x: last.x, y: last.y) }
        }
    }
}

// ── THERMALS ─────────────────────────────────────────────────────
struct ThermalsTile: View {
    let data: ThermalData?; let theme: DashboardTheme
    private var temp: Double { data?.cpuTemp ?? 0 }
    private var load: Double { data?.cpuLoad ?? 0 }
    private var fan: Int { data?.fanSpeed ?? 0 }
    private var hasData: Bool { data != nil }
    private var tempColor: Color {
        if temp >= 85 { return Color(hex: "f87171") }
        if temp >= 70 { return Color(hex: "fbbf24") }
        return Color(hex: "34d399")
    }
    var body: some View {
        Tile(theme: theme) {
            HStack {
                Text("CPU").font(.system(size: 10, weight: .bold)).foregroundColor(theme.t3)
                Spacer()
                if hasData && fan > 0 { Text("\(fan) RPM").font(.system(size: 10, weight: .bold)).foregroundColor(theme.t3) }
            }
            if hasData {
                Spacer(minLength: 0)
                VStack(spacing: 8) {
                    HStack(alignment: .lastTextBaseline, spacing: 2) {
                        Text(String(format: "%.0f", temp)).font(.custom("Impact", size: 54)).monospacedDigit().foregroundColor(tempColor)
                        Text("°C").font(.system(size: 18, weight: .bold)).foregroundColor(tempColor.opacity(0.7))
                    }
                    VStack(spacing: 4) {
                        HStack {
                            Text("LOAD").font(.system(size: 9, weight: .bold)).foregroundColor(theme.t3); Spacer()
                            Text(String(format: "%.0f%%", load)).font(.system(size: 12, weight: .heavy, design: .monospaced)).foregroundColor(theme.t2)
                        }
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                RoundedRectangle(cornerRadius: 3).fill(Color.white.opacity(0.08)).frame(height: 6)
                                RoundedRectangle(cornerRadius: 3).fill(tempColor.opacity(0.7))
                                    .frame(width: max(4, geo.size.width * CGFloat(load/100)), height: 6)
                            }
                        }.frame(height: 6)
                    }
                }.frame(maxWidth: .infinity)
                Spacer(minLength: 0)
            } else {
                Spacer()
                Text("No thermal data").font(.system(size: 12)).foregroundColor(theme.t3).frame(maxWidth: .infinity, alignment: .center)
                Spacer()
            }
        }
    }
}
