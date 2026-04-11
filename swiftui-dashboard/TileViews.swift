import SwiftUI
import Combine

// MARK: - Tile container

struct Tile<Content: View>: View {
    let theme: DashboardTheme
    @ViewBuilder let content: () -> Content

    var body: some View {
        ZStack(alignment: .top) {
            RoundedRectangle(cornerRadius: 16)
                .fill(theme.surface)
                .overlay(RoundedRectangle(cornerRadius: 16)
                    .stroke(Color.white.opacity(0.075), lineWidth: 1))
            // Top-edge highlight
            RoundedRectangle(cornerRadius: 16)
                .fill(Color.white.opacity(0.09))
                .frame(height: 1)
                .padding(.horizontal, 24)
                .frame(maxHeight: .infinity, alignment: .top)
                .allowsHitTesting(false)
            VStack(alignment: .leading, spacing: 8) {
                content()
            }
            .padding(16)
        }
    }
}

// MARK: - CLOCK

struct ClockTile: View {
    let theme: DashboardTheme
    @State private var now = Date()
    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        Tile(theme: theme) {
            Spacer(minLength: 0)
            HStack(alignment: .lastTextBaseline, spacing: 4) {
                Text(hhMM)
                    .font(.custom("Impact", size: 80))
                    .monospacedDigit()
                    .foregroundColor(theme.t1)
                Text(ss)
                    .font(.custom("Impact", size: 30))
                    .monospacedDigit()
                    .foregroundColor(theme.t3)
                    .padding(.bottom, 4)
            }
            Spacer(minLength: 0)
        }
        .onReceive(ticker) { now = $0 }
    }

    private var hhMM: String {
        let f = DateFormatter(); f.dateFormat = "HH:mm"
        return f.string(from: now)
    }
    private var ss: String {
        let f = DateFormatter(); f.dateFormat = "ss"
        return f.string(from: now)
    }
}

// MARK: - DATE

struct DateTile: View {
    let theme: DashboardTheme
    @State private var now = Date()
    private let ticker = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

    private var weekday: String {
        let f = DateFormatter(); f.dateFormat = "EEEE"
        return f.string(from: now).uppercased()
    }
    private var fullDate: String {
        let f = DateFormatter(); f.dateFormat = "d MMMM yyyy"
        return f.string(from: now)
    }

    var body: some View {
        Tile(theme: theme) {
            Spacer(minLength: 0)
            VStack(alignment: .center, spacing: 3) {
                Text(weekday)
                    .font(.system(size: 34, weight: .heavy))
                    .tracking(1)
                    .foregroundColor(theme.accent)
                Text(fullDate)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(theme.t2)
            }
            .frame(maxWidth: .infinity, alignment: .center)
            Spacer(minLength: 0)
        }
        .onReceive(ticker) { now = $0 }
    }
}

// MARK: - WEATHER

struct WeatherTile: View {
    let data: WeatherData?
    let theme: DashboardTheme

    var body: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 16)
                .fill(LinearGradient(
                    colors: [theme.wxGradTop, theme.wxGradBottom],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ))
                .overlay(RoundedRectangle(cornerRadius: 16)
                    .stroke(Color.white.opacity(0.075), lineWidth: 1))

            VStack(alignment: .leading, spacing: 8) {
                Text("NESS ZIONA")
                    .font(.system(size: 10, weight: .bold))
                    .tracking(2)
                    .foregroundColor(.white.opacity(0.42))

                if let cw = data?.current_weather {
                    HStack(alignment: .center, spacing: 10) {
                        Text(wxIcon(code: cw.weathercode, isDay: cw.is_day == 1))
                            .font(.system(size: 52))
                        Text("\(Int(cw.temperature))°")
                            .font(.custom("Impact", size: 110))
                            .foregroundColor(.white)
                    }
                    .frame(maxWidth: .infinity, alignment: .center)

                    Text(wxDesc(code: cw.weathercode))
                        .font(.system(size: 15, weight: .medium))
                        .foregroundColor(.white.opacity(0.72))
                        .frame(maxWidth: .infinity, alignment: .center)

                    if let d = data?.daily,
                       let hiArr = d.temperature_2m_max,
                       let loArr = d.temperature_2m_min {
                        HStack(spacing: 14) {
                            Text("↑ \(Int(hiArr[0]))°")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundColor(Color(hex: "ffd264").opacity(0.95))
                            Text("↓ \(Int(loArr[0]))°")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundColor(Color(hex: "8cbaff").opacity(0.95))
                            Text("\(Int(cw.windspeed)) km/h")
                                .font(.system(size: 13))
                                .foregroundColor(.white.opacity(0.36))
                        }
                    }

                    Spacer(minLength: 0)

                    // 3-day forecast
                    if let d = data?.daily,
                       let times  = d.time,       times.count  >= 4,
                       let codes  = d.weathercode, codes.count  >= 4,
                       let maxT   = d.temperature_2m_max, maxT.count >= 4,
                       let minT   = d.temperature_2m_min, minT.count >= 4 {
                        HStack(spacing: 8) {
                            ForEach(1..<4, id: \.self) { i in
                                ForecastCard(
                                    day:  shortDay(from: times[i], index: i),
                                    icon: wxIcon(code: codes[i], isDay: true),
                                    high: Int(maxT[i]),
                                    low:  Int(minT[i])
                                )
                            }
                        }
                    }
                } else {
                    Spacer()
                    VStack(spacing: 8) {
                        Text("—°")
                            .font(.custom("Impact", size: 80))
                            .foregroundColor(.white.opacity(0.15))
                        Text("Loading weather…")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(.white.opacity(0.3))
                    }
                    .frame(maxWidth: .infinity, alignment: .center)
                    Spacer()
                }
            }
            .padding(16)
        }
    }

    private func shortDay(from dateStr: String, index: Int) -> String {
        if index == 0 { return "TODAY" }
        let f1 = DateFormatter(); f1.dateFormat = "yyyy-MM-dd"
        guard let d = f1.date(from: dateStr) else { return "" }
        let f2 = DateFormatter(); f2.dateFormat = "EEE"
        return f2.string(from: d).uppercased()
    }
}

struct ForecastCard: View {
    let day: String; let icon: String; let high: Int; let low: Int

    var body: some View {
        VStack(spacing: 5) {
            Text(day)
                .font(.system(size: 9, weight: .heavy))
                .tracking(0.8)
                .foregroundColor(.white.opacity(0.48))
            Text(icon).font(.system(size: 22))
            Text("↑\(high)°")
                .font(.system(size: 13, weight: .bold))
                .foregroundColor(Color(hex: "ffd264").opacity(0.95))
            Text("↓\(low)°")
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(Color(hex: "8cbaff").opacity(0.82))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(Color.white.opacity(0.09))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.white.opacity(0.13), lineWidth: 1))
        .cornerRadius(10)
    }
}

// MARK: - ADGUARD

struct AdGuardTile: View {
    let data: AdGuardData?
    let theme: DashboardTheme

    private var blocked: Int    { data?.num_blocked_filtering ?? 0 }
    private var total:   Int    { data?.num_dns_queries ?? 0 }
    private var pct:     Double { total > 0 ? Double(blocked) / Double(total) * 100 : 0 }
    private var latMs: String? {
        guard let t = data?.avg_processing_time else { return nil }
        return "\(Int(t * 1000)) ms"
    }

    var body: some View {
        Tile(theme: theme) {
            HStack {
                Text("ADGUARD")
                    .font(.system(size: 10, weight: .bold))
                    .tracking(1.5)
                    .foregroundColor(theme.t3)
                Spacer()
                if let l = latMs {
                    Text(l)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(theme.accent)
                        .padding(.horizontal, 9).padding(.vertical, 2)
                        .background(theme.accent.opacity(0.14))
                        .cornerRadius(20)
                }
            }

            VStack(spacing: 4) {
                ForEach([
                    ("BLOCKED", fmtK(blocked), false),
                    ("QUERIES", fmtK(total),   false),
                    ("RATE",    String(format: "%.1f%%", pct), true)
                ], id: \.0) { label, val, isAcc in
                    HStack(alignment: .lastTextBaseline) {
                        Text(label)
                            .font(.system(size: 11, weight: .bold))
                            .tracking(1)
                            .foregroundColor(theme.t3)
                        Spacer()
                        Text(val)
                            .font(.custom("Impact", size: 36))
                            .monospacedDigit()
                            .foregroundColor(isAcc ? theme.accent : theme.t1)
                    }
                    Divider().overlay(Color.white.opacity(0.04))
                }
            }

            // Progress bar
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(theme.s2).frame(height: 3)
                    Capsule().fill(theme.accent)
                        .frame(width: geo.size.width * min(1, CGFloat(pct / 100)), height: 3)
                        .animation(.easeInOut(duration: 0.6), value: pct)
                }
            }
            .frame(height: 3)

            // 24h bar chart
            if let q = data?.dns_queries, !q.isEmpty {
                AdGuardChart(queries: q, blocked: data?.blocked_filtering ?? [], accent: theme.accent)
                HStack {
                    Text("24h ago"); Spacer(); Text("now")
                }
                .font(.system(size: 9, weight: .semibold))
                .tracking(0.5)
                .foregroundColor(theme.t3)
            }
        }
    }
}

struct AdGuardChart: View {
    let queries: [Int]
    let blocked: [Int]
    let accent:  Color
    private let nowH = Calendar.current.component(.hour, from: Date())

    var body: some View {
        GeometryReader { geo in
            let count  = queries.count
            let maxVal = CGFloat(queries.max() ?? 1)
            let step   = geo.size.width / CGFloat(count)
            let bw     = step * 0.65

            ZStack(alignment: .bottomLeading) {
                ForEach(0..<count, id: \.self) { i in
                    let x  = step * CGFloat(i)
                    let qH = max(2, CGFloat(queries[i]) / maxVal * geo.size.height * 0.94)
                    let bH = i < blocked.count
                        ? max(2, CGFloat(blocked[i]) / maxVal * geo.size.height * 0.94) : 0
                    let now = (i % 24) == (nowH % 24)

                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(now ? Color.white.opacity(0.18) : Color.white.opacity(0.055))
                        .frame(width: bw, height: qH)
                        .position(x: x + bw / 2, y: geo.size.height - qH / 2)

                    if bH > 0 {
                        RoundedRectangle(cornerRadius: 1.5)
                            .fill(accent.opacity(now ? 0.9 : 0.65))
                            .frame(width: bw, height: bH)
                            .position(x: x + bw / 2, y: geo.size.height - bH / 2)
                    }
                }
            }
        }
        .frame(minHeight: 60)
    }
}

// MARK: - MARKETS

struct MarketsTile: View {
    let data:  MarketsData?
    let theme: DashboardTheme

    private let order  = ["sp500", "ta125", "gold", "btc"]
    private let labels = ["sp500": "S&P 500", "ta125": "TA-125", "gold": "Gold", "btc": "Bitcoin"]
    private let rotateTick = Timer.publish(every: 5, on: .main, in: .common).autoconnect()

    @State private var idx     = 0
    @State private var visible = true

    private var assets: [MarketAsset] {
        guard let all = data?.assets else { return [] }
        return order.compactMap { k in all.first { $0.key == k } }
    }

    var body: some View {
        Tile(theme: theme) {
            if assets.isEmpty {
                Text("Markets loading…").foregroundColor(theme.t3)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            } else {
                let a  = assets[idx]
                let up = (a.changePercent ?? 0) >= 0

                HStack(alignment: .center, spacing: 16) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(labels[a.key] ?? a.label)
                            .font(.system(size: 20, weight: .heavy))
                            .tracking(1)
                            .foregroundColor(.white.opacity(0.9))

                        Text(priceStr(a))
                            .font(.custom("Impact", size: 68))
                            .monospacedDigit()
                            .foregroundColor(theme.t1)
                            .minimumScaleFactor(0.6)
                            .lineLimit(1)

                        HStack(spacing: 10) {
                            Text(pctStr(a.changePercent))
                                .font(.system(size: 18, weight: .bold))
                                .foregroundColor(up ? Color(hex: "34d399") : Color(hex: "f87171"))
                            Text(a.suffix)
                                .font(.system(size: 13, weight: .bold))
                                .tracking(1)
                                .foregroundColor(theme.t3)
                        }
                    }

                    Spacer()

                    let spark = (a.sparkline ?? []).compactMap { $0 }
                    if spark.count >= 2 {
                        SparklineView(data: spark, isUp: up)
                            .frame(width: 120, height: 70)
                    }
                }
                .opacity(visible ? 1 : 0)
                .offset(x: visible ? 0 : 22)
                .animation(.easeInOut(duration: 0.35), value: visible)

                HStack(spacing: 6) {
                    Spacer()
                    ForEach(0..<assets.count, id: \.self) { i in
                        Circle()
                            .fill(i == idx ? theme.accent : theme.t3)
                            .frame(width: 5, height: 5)
                            .scaleEffect(i == idx ? 1.4 : 1)
                            .animation(.easeInOut(duration: 0.35), value: idx)
                    }
                }
            }
        }
        .onReceive(rotateTick) { _ in
            guard assets.count > 1 else { return }
            visible = false
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                idx = (idx + 1) % assets.count
                visible = true
            }
        }
    }

    private func priceStr(_ a: MarketAsset) -> String {
        let d = a.key == "btc" ? 0 : 2
        return a.price.formatted(.number.grouping(.automatic).precision(.fractionLength(d)))
    }
    private func pctStr(_ p: Double?) -> String {
        guard let p else { return "—" }
        return (p >= 0 ? "+" : "") + String(format: "%.2f%%", p)
    }
}

// MARK: - Sparkline

struct SparklineView: View {
    let data: [Double]; let isUp: Bool

    var body: some View {
        GeometryReader { geo in
            let W = geo.size.width, H = geo.size.height
            let mn = data.min()!, mx = data.max()!
            let rng = (mx - mn) > 0 ? (mx - mn) : mn * 0.002

            let pts: [CGPoint] = data.enumerated().map { i, v in
                CGPoint(
                    x: CGFloat(i) / CGFloat(data.count - 1) * W,
                    y: H - (CGFloat((v - mn) / rng)) * H * 0.78 - H * 0.11
                )
            }
            let color = isUp ? Color(hex: "34d399") : Color(hex: "f87171")

            // Fill under line
            Path { p in
                p.move(to: pts[0])
                pts.dropFirst().forEach { p.addLine(to: $0) }
                p.addLine(to: CGPoint(x: W, y: H))
                p.addLine(to: CGPoint(x: 0, y: H))
                p.closeSubpath()
            }
            .fill(LinearGradient(colors: [color.opacity(0.28), color.opacity(0)],
                                 startPoint: .top, endPoint: .bottom))

            // Line
            Path { p in
                p.move(to: pts[0])
                pts.dropFirst().forEach { p.addLine(to: $0) }
            }
            .stroke(color, style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))

            // End dot
            if let last = pts.last {
                Circle().fill(color).frame(width: 8, height: 8)
                    .position(x: last.x, y: last.y)
            }
        }
    }
}

// MARK: - STREAMING

struct StreamingTile: View {
    let data:  StreamingData?
    let theme: DashboardTheme

    private var active:  Bool   { data?.tvActive == true }
    private var profile: String { data?.overallProfile ?? "Idle" }
    private var mbps:    Double { data?.externalMbps ?? 0 }
    private var peers:   Int    { data?.externalConnections ?? 0 }
    private var rank:    Int    { profileRank[profile] ?? 0 }

    private let teal = Color(hex: "2dd4bf")

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 16)
                .fill(theme.surface)
                .overlay(RoundedRectangle(cornerRadius: 16)
                    .stroke(active ? teal.opacity(0.35) : Color.white.opacity(0.075), lineWidth: 1))

            VStack(alignment: .leading, spacing: 8) {
                // Header
                HStack {
                    Text("STREMIO")
                        .font(.system(size: 10, weight: .bold))
                        .tracking(1.5)
                        .foregroundColor(theme.t3)
                    Spacer()
                    Text(active ? "LIVE" : "IDLE")
                        .font(.system(size: 10, weight: .heavy))
                        .tracking(1.5)
                        .foregroundColor(active ? teal : theme.t3)
                        .padding(.horizontal, 9).padding(.vertical, 3)
                        .background(active ? teal.opacity(0.15) : theme.s2)
                        .overlay(RoundedRectangle(cornerRadius: 20)
                            .stroke(active ? teal.opacity(0.3) : Color.white.opacity(0.075), lineWidth: 1))
                        .cornerRadius(20)
                }

                // Arc gauge
                ArcGaugeView(rank: rank, active: active, accent: active ? teal : Color(hex: "2a4a5a"))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                // Readouts
                Divider().overlay(Color.white.opacity(0.05))

                HStack(alignment: .lastTextBaseline, spacing: 6) {
                    Text(mbps > 0 ? String(format: "%.1f", mbps) : "—")
                        .font(.custom("Impact", size: 34))
                        .monospacedDigit()
                        .foregroundColor(active ? teal : .white)
                    Text("MBPS")
                        .font(.system(size: 11, weight: .bold))
                        .tracking(1)
                        .foregroundColor(theme.t2)
                }

                HStack(alignment: .lastTextBaseline, spacing: 6) {
                    Text(peers > 0 ? "\(peers)" : "—")
                        .font(.custom("Impact", size: 34))
                        .monospacedDigit()
                        .foregroundColor(active ? teal : .white)
                    Text("PEERS")
                        .font(.system(size: 11, weight: .bold))
                        .tracking(1)
                        .foregroundColor(theme.t2)
                }
            }
            .padding(16)
        }
    }
}

// MARK: - Arc Gauge

// Animatable arc fill — SwiftUI interpolates endAngleDeg between frames
struct FillArcShape: Shape {
    var endAngleDeg: Double
    var animatableData: Double {
        get { endAngleDeg }
        set { endAngleDeg = newValue }
    }
    func path(in rect: CGRect) -> Path {
        var p = Path()
        guard abs(endAngleDeg - 90) > 0.5 else { return p }
        let cx = rect.width * 0.16
        let cy = rect.midY
        let r  = min(rect.width * 0.38, rect.height * 0.38)
        p.addArc(center: CGPoint(x: cx, y: cy), radius: r,
                 startAngle: .degrees(90), endAngle: .degrees(endAngleDeg), clockwise: true)
        return p
    }
}

// Animatable needle — SwiftUI interpolates angleDeg between frames
struct NeedleShape: Shape {
    var angleDeg: Double
    var animatableData: Double {
        get { angleDeg }
        set { angleDeg = newValue }
    }
    func path(in rect: CGRect) -> Path {
        var p = Path()
        let cx  = rect.width * 0.16
        let cy  = rect.midY
        let len = min(rect.width * 0.38, rect.height * 0.38) * 0.76
        let rad = angleDeg * .pi / 180.0
        p.move(to: CGPoint(x: cx, y: cy))
        p.addLine(to: CGPoint(x: cx + len * cos(rad), y: cy + len * sin(rad)))
        return p
    }
}

struct ArcGaugeView: View {
    let rank:   Int
    let active: Bool
    let accent: Color

    @State private var animRank: Double = 0

    private let labels = ["Idle", "Low", "1080p", "4K", "4K HDR"]

    // Angle for a quality rank: 90° = bottom (Idle), -90° = top (4K HDR)
    private func deg(_ r: Double) -> Double { 90.0 - r * 45.0 }

    // Dot position for a rank within a given rect
    private func dot(_ r: Double, _ rect: CGRect) -> CGPoint {
        let cx = rect.width * 0.16
        let cy = rect.midY
        let ra = min(rect.width * 0.38, rect.height * 0.38)
        let a  = deg(r) * .pi / 180.0
        return CGPoint(x: cx + ra * cos(a), y: cy + ra * sin(a))
    }

    var body: some View {
        ZStack {
            GeometryReader { geo in
                let rect = geo.frame(in: .local)
                let cx   = rect.width * 0.16
                let cy   = rect.midY
                let R    = min(rect.width * 0.38, rect.height * 0.38)

                // Full track (dim)
                Path { p in
                    p.addArc(center: CGPoint(x: cx, y: cy), radius: R,
                             startAngle: .degrees(90), endAngle: .degrees(-90), clockwise: true)
                }
                .stroke(Color.white.opacity(0.07),
                        style: StrokeStyle(lineWidth: 4.5, lineCap: .round))

                // Quality stops: glow, dot, label
                ForEach(0..<labels.count, id: \.self) { i in
                    let p       = dot(Double(i), rect)
                    let isCur   = Int(round(animRank)) == i
                    let reached = Double(i) <= animRank
                    let lx      = max(p.x + 16, cx + 20) // label left edge

                    if isCur {
                        Circle().fill(accent.opacity(0.18))
                            .frame(width: 34, height: 34)
                            .position(x: p.x, y: p.y)
                    }
                    Circle()
                        .fill(reached ? accent : Color.white.opacity(0.09))
                        .overlay(Circle()
                            .stroke(reached ? accent : Color.white.opacity(0.15), lineWidth: 1.5))
                        .frame(width: isCur ? 14 : 10, height: isCur ? 14 : 10)
                        .position(x: p.x, y: p.y)

                    Text(labels[i])
                        .font(.system(size: isCur ? 13 : 11,
                                      weight: isCur ? .bold : .medium))
                        .foregroundColor(
                            isCur   ? .white :
                            reached ? .white.opacity(0.55) :
                                      .white.opacity(0.2)
                        )
                        // Left-align from lx: add half approx text width (50pt) as center
                        .position(x: lx + 24, y: p.y)
                }

                // Center pivot dot
                Circle().fill(accent)
                    .frame(width: 10, height: 10)
                    .position(x: cx, y: cy)
            }

            // Animated fill arc
            FillArcShape(endAngleDeg: deg(animRank))
                .stroke(accent.opacity(animRank > 0 ? 0.8 : 0),
                        style: StrokeStyle(lineWidth: 4.5, lineCap: .round))

            // Animated needle
            NeedleShape(angleDeg: deg(animRank))
                .stroke(active ? Color.white.opacity(0.92) : Color.white.opacity(0.25),
                        style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
        }
        .onChange(of: rank) { newRank in
            withAnimation(.interpolatingSpring(stiffness: 180, damping: 15)) {
                animRank = Double(newRank)
            }
        }
        .onAppear { animRank = Double(rank) }
    }
}
