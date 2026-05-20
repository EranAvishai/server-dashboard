import SwiftUI
import Combine

// MARK: - App Settings (persisted via @AppStorage)

class AppSettings: ObservableObject {
    // On macOS 12 @AppStorage doesn't trigger objectWillChange automatically,
    // so we use didSet on each property to fire it manually.

    @AppStorage("fontScale") var fontScale: Double = 1.0 {
        willSet { objectWillChange.send() }
    }
    @AppStorage("accentHex") var accentHex: String = "60a5fa" {
        willSet { objectWillChange.send() }
    }
    @AppStorage("showClock") var showClock: Bool = true {
        willSet { objectWillChange.send() }
    }
    @AppStorage("showDate") var showDate: Bool = true {
        willSet { objectWillChange.send() }
    }
    @AppStorage("showWeather") var showWeather: Bool = true {
        willSet { objectWillChange.send() }
    }
    @AppStorage("showAdGuard") var showAdGuard: Bool = true {
        willSet { objectWillChange.send() }
    }
    @AppStorage("showStreaming") var showStreaming: Bool = true {
        willSet { objectWillChange.send() }
    }
    @AppStorage("showMarkets") var showMarkets: Bool = true {
        willSet { objectWillChange.send() }
    }
    @AppStorage("marketRotateSec") var marketRotateSec: Double = 5.0 {
        willSet { objectWillChange.send() }
    }
    @AppStorage("pollInterval") var pollInterval: Double = 12.0 {
        willSet { objectWillChange.send() }
    }

    var accentColor: Color { Color(hex: accentHex) }

    static let accentPresets: [(name: String, hex: String)] = [
        ("Teal",   "2dd4bf"), ("Blue",   "60a5fa"),
        ("Purple", "a78bfa"), ("Amber",  "f59e0b"),
        ("Green",  "34d399"), ("Pink",   "f472b6"),
        ("Red",    "f87171"), ("White",  "e2e8f0"),
    ]
}

// MARK: - Settings Panel

struct SettingsPanel: View {
    @ObservedObject var settings: AppSettings
    @Binding var isOpen: Bool

    var body: some View {
        ZStack(alignment: .trailing) {
            if isOpen {
                Color.black.opacity(0.35)
                    .ignoresSafeArea()
                    .onTapGesture { close() }
                    .transition(.opacity)
            }

            if isOpen {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        // Header
                        HStack {
                            Text("Settings")
                                .font(.system(size: 20, weight: .bold))
                                .foregroundColor(.white)
                            Spacer()
                            Button(action: close) {
                                Image(systemName: "xmark")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundColor(.white.opacity(0.6))
                                    .frame(width: 28, height: 28)
                                    .background(Color.white.opacity(0.1))
                                    .clipShape(Circle())
                            }
                            .buttonStyle(.plain)
                        }

                        Divider().overlay(Color.white.opacity(0.1))

                        // ── APPEARANCE ──────────────────────────────────
                        SectionHeader("Appearance")

                        SettingRow(label: "Font scale") {
                            HStack(spacing: 10) {
                                Slider(value: $settings.fontScale, in: 0.7...1.5, step: 0.05)
                                    .frame(width: 120)
                                Text(String(format: "%.0f%%", settings.fontScale * 100))
                                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                                    .foregroundColor(.white.opacity(0.6))
                                    .frame(width: 38, alignment: .trailing)
                            }
                        }

                        VStack(alignment: .leading, spacing: 8) {
                            Text("Accent colour")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundColor(.white.opacity(0.5))

                            LazyVGrid(columns: Array(repeating: .init(.flexible()), count: 4), spacing: 8) {
                                ForEach(AppSettings.accentPresets, id: \.hex) { preset in
                                    Button(action: { settings.accentHex = preset.hex }) {
                                        ZStack {
                                            Circle()
                                                .fill(Color(hex: preset.hex))
                                                .frame(width: 32, height: 32)
                                            if settings.accentHex == preset.hex {
                                                Circle()
                                                    .stroke(Color.white, lineWidth: 2)
                                                    .frame(width: 32, height: 32)
                                                Image(systemName: "checkmark")
                                                    .font(.system(size: 10, weight: .bold))
                                                    .foregroundColor(.white)
                                            }
                                        }
                                    }
                                    .buttonStyle(.plain)
                                    .help(preset.name)
                                }
                            }
                        }

                        Divider().overlay(Color.white.opacity(0.1))

                        // ── TILES ────────────────────────────────────────
                        SectionHeader("Tiles")

                        VStack(spacing: 6) {
                            TileToggle("Clock",     icon: "clock.fill",        isOn: $settings.showClock)
                            TileToggle("Date",      icon: "calendar",          isOn: $settings.showDate)
                            TileToggle("Weather",   icon: "cloud.sun.fill",    isOn: $settings.showWeather)
                            TileToggle("AdGuard",   icon: "shield.fill",       isOn: $settings.showAdGuard)
                            TileToggle("Streaming", icon: "play.tv.fill",      isOn: $settings.showStreaming)
                            TileToggle("Markets",   icon: "chart.line.uptrend.xyaxis", isOn: $settings.showMarkets)
                        }

                        Divider().overlay(Color.white.opacity(0.1))

                        // ── TIMING ───────────────────────────────────────
                        SectionHeader("Timing")

                        SettingRow(label: "Market rotation") {
                            HStack(spacing: 10) {
                                Slider(value: $settings.marketRotateSec, in: 3...15, step: 1)
                                    .frame(width: 120)
                                Text(String(format: "%.0fs", settings.marketRotateSec))
                                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                                    .foregroundColor(.white.opacity(0.6))
                                    .frame(width: 32, alignment: .trailing)
                            }
                        }

                        SettingRow(label: "Poll interval") {
                            HStack(spacing: 10) {
                                Slider(value: $settings.pollInterval, in: 5...60, step: 1)
                                    .frame(width: 120)
                                Text(String(format: "%.0fs", settings.pollInterval))
                                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                                    .foregroundColor(.white.opacity(0.6))
                                    .frame(width: 32, alignment: .trailing)
                            }
                        }

                        Spacer(minLength: 20)
                    }
                    .padding(20)
                }
                .frame(width: 280)
                .background(
                    ZStack {
                        Color(hex: "080e1c")
                        Color.white.opacity(0.03)
                    }
                )
                .overlay(
                    Rectangle()
                        .fill(Color.white.opacity(0.07))
                        .frame(width: 1),
                    alignment: .leading
                )
                .shadow(color: .black.opacity(0.5), radius: 30, x: -8, y: 0)
                .transition(.move(edge: .trailing))
                .frame(maxHeight: .infinity)
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: isOpen)
    }

    private func close() {
        withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
            isOpen = false
        }
    }
}

// MARK: - Subcomponents

struct SectionHeader: View {
    let title: String
    init(_ title: String) { self.title = title }
    var body: some View {
        Text(title.uppercased())
            .font(.system(size: 10, weight: .bold))
            
            .foregroundColor(.white.opacity(0.35))
    }
}

struct SettingRow<Control: View>: View {
    let label: String
    @ViewBuilder let control: () -> Control
    var body: some View {
        HStack {
            Text(label)
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(.white.opacity(0.75))
            Spacer()
            control()
        }
    }
}

struct TileToggle: View {
    let label: String
    let icon:  String
    @Binding var isOn: Bool

    init(_ label: String, icon: String, isOn: Binding<Bool>) {
        self.label = label
        self.icon  = icon
        self._isOn = isOn
    }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 12))
                .foregroundColor(isOn ? .white.opacity(0.7) : .white.opacity(0.25))
                .frame(width: 18)
            Text(label)
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(isOn ? .white.opacity(0.75) : .white.opacity(0.3))
            Spacer()
            Toggle("", isOn: $isOn)
                .toggleStyle(.switch)
                .labelsHidden()
                .scaleEffect(0.8)
        }
        .padding(.vertical, 2)
    }
}
