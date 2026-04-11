# ServerDashboard — SwiftUI Setup

## Requirements
- macOS 12 (Monterey) or later
- Xcode 14 or later (free from Mac App Store)
- Your Node server running on port 8787

---

## Step 1 — Create the Xcode project

1. Open **Xcode**
2. File → New → Project
3. Choose **macOS** → **App** → Next
4. Fill in:
   - Product Name: `ServerDashboard`
   - Interface: **SwiftUI**
   - Language: **Swift**
   - Uncheck "Include Tests"
5. Save anywhere (e.g. ~/Projects/ServerDashboard)

---

## Step 2 — Replace the default files

1. In Xcode's file navigator, **delete** the default `ContentView.swift` (move to trash)
2. Also delete `ServerDashboardApp.swift`
3. Drag all 4 Swift files into the project navigator:
   - `DashboardApp.swift`
   - `Models.swift`
   - `TileViews.swift`
   - `ContentView.swift`
4. When prompted: ✅ "Copy items if needed", Target: ServerDashboard

---

## Step 3 — Allow localhost HTTP

Your server runs on `http://` (not https). macOS blocks this by default.

1. In Xcode, click your project name in the navigator (top item)
2. Select the **ServerDashboard target** → **Info** tab
3. Right-click anywhere in the list → **Add Row**
4. Key: `App Transport Security Settings` (type: Dictionary)
5. Expand it → Add Row inside:
   - Key: `Allow Arbitrary Loads` → Type: Boolean → Value: **YES**

Or, add this to your `Info.plist` directly:
```xml
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsArbitraryLoads</key>
    <true/>
</dict>
```

---

## Step 4 — Set minimum deployment

1. Click your project in the navigator
2. Select **ServerDashboard target** → **General** tab
3. Minimum Deployments → **macOS 12.0**

---

## Step 5 — Build & Run

1. Press **⌘R** (or Product → Run)
2. The dashboard window opens and goes fullscreen automatically
3. Press **Escape** or **⌃⌘F** to exit fullscreen if needed

---

## Step 6 — Auto-launch on login (optional)

To have it start automatically with your Mac:

```bash
# Build a release version first: Product → Archive in Xcode
# Then add to login items:
# System Settings → General → Login Items → Add → select ServerDashboard.app
```

---

## Troubleshooting

**"Cannot connect" in footer** — Make sure your Node server is running:
```bash
cd ~/Projects/server-dashboard/backend && node server.js
```

**Weather not loading** — The server fetches weather, not the app.
Open http://127.0.0.1:8787/api/weather/refresh in Safari.

**Window won't go fullscreen** — Click the green traffic light button,
or press ⌃⌘F after the app launches.

**Casting to TV** — Use AirPlay from the menu bar → mirror display.
The app fills whatever screen it's on.
