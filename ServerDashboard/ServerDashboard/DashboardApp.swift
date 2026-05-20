import SwiftUI
import Combine

@main
struct DashboardApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
                .onAppear { CursorHider.shared.start() }
        }
        .windowStyle(.hiddenTitleBar)
    }
}

// Auto-hide cursor after 5 seconds of no movement
class CursorHider {
    static let shared = CursorHider()
    private var timer: Timer?
    private var monitor: Any?
    private var isHidden = false

    func start() {
        // Watch for any mouse movement
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved, .leftMouseDown, .rightMouseDown, .scrollWheel]) { [weak self] event in
            self?.showCursor()
            self?.resetTimer()
            return event
        }
        resetTimer()
    }

    private func resetTimer() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: false) { [weak self] _ in
            self?.hideCursor()
        }
    }

    private func hideCursor() {
        if !isHidden {
            NSCursor.hide()
            isHidden = true
        }
    }

    private func showCursor() {
        if isHidden {
            NSCursor.unhide()
            isHidden = false
        }
    }
}

// Keep app delegate minimal
class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Disable the tab bar on macOS 12+
        NSWindow.allowsAutomaticWindowTabbing = false
    }
}
