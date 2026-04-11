import SwiftUI
import Combine

// MARK: - API Models

struct DashboardResponse: Codable {
    let adguard:   AdGuardData?
    let markets:   MarketsData?
    let streaming: StreamingData?
    let weather:   WeatherData?
}

struct AdGuardData: Codable {
    let num_blocked_filtering: Int?
    let num_dns_queries:        Int?
    let avg_processing_time:    Double?
    let dns_queries:            [Int]?
    let blocked_filtering:      [Int]?
}

struct MarketsData: Codable {
    let assets: [MarketAsset]?
}

struct MarketAsset: Codable {
    let key:           String
    let label:         String
    let price:         Double
    let changePercent: Double?
    let suffix:        String
    let sparkline:     [Double?]?
}

struct StreamingData: Codable {
    let tvActive:           Bool?
    let stremioOpen:        Bool?
    let overallProfile:     String?
    let externalMbps:       Double?
    let externalConnections: Int?
    let tvRecentSeconds:    Int?
    let localStatus:        String?
}

struct WeatherData: Codable {
    let current_weather: CurrentWeather?
    let daily:           DailyWeather?
}

struct CurrentWeather: Codable {
    let temperature: Double
    let windspeed:   Double
    let weathercode: Int
    let is_day:      Int?
}

struct DailyWeather: Codable {
    let time:               [String]?
    let weathercode:        [Int]?
    let temperature_2m_max: [Double]?
    let temperature_2m_min: [Double]?
}

// MARK: - Theme

struct DashboardTheme: Equatable {
    let bg:          Color
    let surface:     Color
    let s2:          Color
    let accent:      Color
    let wxGradTop:   Color
    let wxGradBottom: Color
    let t1:          Color
    let t2:          Color
    let t3:          Color

    static let `default` = DashboardTheme.partlyDay

    static var sunnyDay: DashboardTheme {
        .init(bg: "07101f", surface: "0c1a30", s2: "112038", accent: "f59e0b",
              wxTop: "1e4a72", wxBot: "07101f", t1: "eef2fa", t2: "7a9ab8", t3: "2e4a65")
    }
    static var clearNight: DashboardTheme {
        .init(bg: "04060e", surface: "09101e", s2: "0d1528", accent: "a78bfa",
              wxTop: "1c0f40", wxBot: "04060e", t1: "eef2fa", t2: "556080", t3: "252e4a")
    }
    static var partlyDay: DashboardTheme {
        .init(bg: "081220", surface: "0e1c30", s2: "122538", accent: "60a5fa",
              wxTop: "1a3a62", wxBot: "081220", t1: "eef2fa", t2: "6888a8", t3: "2c4060")
    }
    static var cloudy: DashboardTheme {
        .init(bg: "090f18", surface: "101828", s2: "162034", accent: "94a3b8",
              wxTop: "1e2a3e", wxBot: "090f18", t1: "eef2fa", t2: "556070", t3: "273040")
    }
    static var rain: DashboardTheme {
        .init(bg: "05090f", surface: "0a1020", s2: "0e1828", accent: "38bdf8",
              wxTop: "0c2038", wxBot: "05090f", t1: "eef2fa", t2: "486578", t3: "1e3040")
    }
    static var storm: DashboardTheme {
        .init(bg: "050508", surface: "0a0815", s2: "0f0c20", accent: "c4b5fd",
              wxTop: "1e0a38", wxBot: "050508", t1: "eef2fa", t2: "524870", t3: "221c3a")
    }

    static func from(code: Int, isDay: Bool) -> DashboardTheme {
        if code == 0 { return isDay ? .sunnyDay : .clearNight }
        if code <= 2 { return isDay ? .partlyDay : .clearNight }
        if code <= 3 { return .cloudy }
        if code <= 77 { return .rain }
        return .storm
    }

    private init(bg: String, surface: String, s2: String, accent: String,
                 wxTop: String, wxBot: String, t1: String, t2: String, t3: String) {
        self.bg          = Color(hex: bg)
        self.surface     = Color(hex: surface)
        self.s2          = Color(hex: s2)
        self.accent      = Color(hex: accent)
        self.wxGradTop   = Color(hex: wxTop)
        self.wxGradBottom = Color(hex: wxBot)
        self.t1          = Color(hex: t1)
        self.t2          = Color(hex: t2)
        self.t3          = Color(hex: t3)
    }
}

// MARK: - ViewModel

class ViewModel: ObservableObject {
    @Published var adguard:    AdGuardData?
    @Published var markets:    MarketsData?
    @Published var streaming:  StreamingData?
    @Published var weather:    WeatherData?
    @Published var theme:      DashboardTheme = .default
    @Published var lastUpdate: Date?

    private let url = URL(string: "http://127.0.0.1:8787/api/all")!
    private var timer: AnyCancellable?
    private var lastJSON = ""

    func startPolling() {
        fetch()
        timer = Timer.publish(every: 12, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in self?.fetch() }
    }

    private func fetch() {
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let self, let data else { return }
            let json = String(data: data, encoding: .utf8) ?? ""
            guard json != self.lastJSON else { return }
            self.lastJSON = json
            guard let r = try? JSONDecoder().decode(DashboardResponse.self, from: data) else { return }
            DispatchQueue.main.async {
                withAnimation(.easeInOut(duration: 0.5)) {
                    self.adguard   = r.adguard
                    self.markets   = r.markets
                    self.streaming = r.streaming
                    self.weather   = r.weather
                    self.lastUpdate = Date()
                    if let cw = r.weather?.current_weather {
                        self.theme = DashboardTheme.from(code: cw.weathercode, isDay: (cw.is_day ?? 1) == 1)
                    }
                }
            }
        }.resume()
    }
}

// MARK: - Helpers

extension Color {
    init(hex: String) {
        let h = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var n: UInt64 = 0
        Scanner(string: h).scanHexInt64(&n)
        self.init(
            red:   Double((n & 0xFF0000) >> 16) / 255,
            green: Double((n & 0x00FF00) >>  8) / 255,
            blue:  Double( n & 0x0000FF       ) / 255
        )
    }
}

func fmtK(_ n: Int) -> String {
    if n >= 1_000_000 { return String(format: "%.1fM", Double(n) / 1_000_000) }
    if n >= 1_000     { return String(format: "%.1fK", Double(n) / 1_000) }
    return "\(n)"
}

func wxIcon(code: Int, isDay: Bool) -> String {
    switch code {
    case 0:        return isDay ? "☀️" : "🌙"
    case 1, 2:     return isDay ? "⛅" : "🌤"
    case 3:        return "☁️"
    case 45, 48:   return "🌫"
    case 51...55:  return "🌦"
    case 56...67:  return "🌧"
    case 68...77:  return "❄️"
    default:       return code >= 95 ? "⛈" : "🌤"
    }
}

func wxDesc(code: Int) -> String {
    let m: [Int: String] = [
        0: "Clear sky",   1: "Mainly clear",  2: "Partly cloudy", 3: "Overcast",
        45: "Foggy",      48: "Foggy",         51: "Light drizzle", 53: "Drizzle",
        55: "Heavy drizzle", 61: "Light rain", 63: "Rainy",        65: "Heavy rain",
        71: "Light snow", 73: "Snow",          75: "Heavy snow",   77: "Sleet",
        80: "Showers",    81: "Showers",       82: "Heavy showers",
        95: "Thunderstorm", 96: "Thunderstorm", 99: "Thunderstorm"
    ]
    return m[code] ?? (code >= 95 ? "Thunderstorm" : "—")
}

let profileRank: [String: Int] = ["Idle": 0, "Low bitrate": 1, "1080p": 2, "4K": 3, "4K HDR": 4]
