import SwiftUI
import Combine

struct ContentView: View {
    @StateObject private var vm       = ViewModel()
    @StateObject private var settings = AppSettings()
    @State private var settingsOpen   = false
    @State private var now = Date()
    private let clockTick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private var accent: Color { settings.accentColor }
    private var fs: Double { settings.fontScale }

    var body: some View {
        GeometryReader { _ in
            ZStack {
                themed.bg.ignoresSafeArea()
                    .animation(.easeInOut(duration: 0.9), value: vm.theme.bg)

                HStack(alignment: .top, spacing: 8) {
                    // LEFT: Clock + Streaming (240pt wide)
                    VStack(spacing: 8) {
                        if settings.showClock {
                            ClockTile(now: now, theme: themed, fontScale: fs)
                                .frame(height: 115)
                        }
                        if settings.showStreaming {
                            StreamingTile(data: vm.streaming, theme: themed)
                        }
                    }
                    .frame(width: 240)

                    // CENTER + RIGHT
                    VStack(spacing: 8) {
                        HStack(alignment: .top, spacing: 8) {
                            if settings.showWeather {
                                WeatherTile(data: vm.weather, theme: themed)
                            }
                            VStack(spacing: 8) {
                                if settings.showDate {
                                    DateTile(now: now, theme: themed, fontScale: fs)
                                        .frame(height: 115)
                                }
                                if settings.showAdGuard {
                                    AdGuardTile(data: vm.adguard, theme: themed)
                                }
                            }
                            .frame(width: 260)
                        }

                        if settings.showMarkets {
                            HStack(spacing: 8) {
                                MarketsTile(data: vm.markets, theme: themed, rotateSec: settings.marketRotateSec)
                                ThermalsTile(data: vm.thermals, theme: themed)
                                    .frame(width: 260)
                            }
                            .frame(height: 195)
                        }
                    }
                }
                .padding(10)

                // Footer
                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        Text(footerText)
                            .font(.system(size: 10))
                            .foregroundColor(themed.t3)
                        Button(action: {
                            withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) { settingsOpen.toggle() }
                        }) {
                            Image(systemName: "gearshape.fill")
                                .font(.system(size: 13))
                                .foregroundColor(.white.opacity(settingsOpen ? 0.7 : 0.2))
                                .frame(width: 28, height: 28)
                                .background(Circle().fill(.white.opacity(settingsOpen ? 0.12 : 0)))
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 14).padding(.bottom, 8)
                }

                HStack(spacing: 0) {
                    Spacer()
                    SettingsPanel(settings: settings, isOpen: $settingsOpen)
                }.ignoresSafeArea()
            }
        }
        .frame(minWidth: 900, minHeight: 600)
        .onAppear {
            vm.startPolling(interval: settings.pollInterval)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                NSApp.windows.first?.toggleFullScreen(nil)
            }
        }
        .onReceive(clockTick) { now = $0 }
        .onChange(of: settings.pollInterval) { _ in vm.restartPolling(interval: settings.pollInterval) }
    }

    private var themed: DashboardTheme {
        DashboardTheme.withAccent(base: vm.theme, accent: accent)
    }
    private var footerText: String {
        guard let t = vm.lastUpdate else { return "Connecting…" }
        let f = DateFormatter(); f.dateFormat = "HH:mm:ss"
        return "↻ \(f.string(from: t))"
    }
}
