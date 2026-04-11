import SwiftUI

struct ContentView: View {
    @StateObject private var vm = ViewModel()

    var body: some View {
        GeometryReader { _ in
            ZStack {
                // Background transitions smoothly with weather theme
                vm.theme.bg.ignoresSafeArea()
                    .animation(.easeInOut(duration: 0.9), value: vm.theme.bg)

                // ─── Dashboard grid ────────────────────────────────────────
                // Mirrors the CSS grid:
                //   col1=215  │ col2=1fr  │ col3=250
                //   clock     │ weather   │ date       ← 96pt
                //   stream    │ weather   │ adguard    ← 1fr
                //   stream    │ markets   │ markets    ← 195pt
                // ───────────────────────────────────────────────────────────
                HStack(spacing: 10) {

                    // ── LEFT COLUMN: clock + streaming ──────────────────────
                    VStack(spacing: 10) {
                        ClockTile(theme: vm.theme)
                            .frame(height: 96)

                        StreamingTile(data: vm.streaming, theme: vm.theme)
                    }
                    .frame(width: 215)

                    // ── CENTER + RIGHT ──────────────────────────────────────
                    VStack(spacing: 10) {

                        // Rows 1 + 2: weather hero + date/adguard column
                        HStack(spacing: 10) {
                            WeatherTile(data: vm.weather, theme: vm.theme)

                            // RIGHT COLUMN
                            VStack(spacing: 10) {
                                DateTile(theme: vm.theme)
                                    .frame(height: 96)

                                AdGuardTile(data: vm.adguard, theme: vm.theme)
                            }
                            .frame(width: 250)
                        }

                        // Row 3: markets — spans center + right
                        MarketsTile(data: vm.markets, theme: vm.theme)
                            .frame(height: 195)
                    }
                }
                .padding(10)

                // ── Footer ──────────────────────────────────────────────────
                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        Text(footerText)
                            .font(.system(size: 10))
                            .foregroundColor(vm.theme.t3)
                    }
                    .padding(.horizontal, 14)
                    .padding(.bottom, 8)
                }
            }
        }
        .frame(minWidth: 900, minHeight: 600)
        .onAppear {
            vm.startPolling()
            // Go fullscreen after window is ready
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                NSApp.windows.first?.toggleFullScreen(nil)
            }
        }
    }

    private var footerText: String {
        if let t = vm.lastUpdate {
            let f = DateFormatter(); f.dateFormat = "HH:mm:ss"
            return "↻ \(f.string(from: t))"
        }
        return "Connecting…"
    }
}

#Preview {
    ContentView()
        .frame(width: 1280, height: 800)
}
