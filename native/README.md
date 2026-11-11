# Yaver native (Swift, iPhone + Mac)

One SwiftUI app for the iPhone and the Mac. It keeps the same records as the web
app and syncs through the same encrypted GitHub copy, so the web app, the Mac app
and the iPhone app all share one set of data.

## Getting your data in

Pick one:

- **Sync code (best).** In the web app on your iPhone: Settings → Sync → Copy sync code.
  In the native app: Settings → paste it → Join. Everything comes across, and from
  then on every change syncs both ways.
- **Backup file.** In the web app: Settings → Export backup. Send the file to the Mac
  (AirDrop) and in the native app: Settings → Import backup. Newer records win, so
  importing twice is safe.

## Mac: no Xcode needed

1. Download `Yaver-Mac.zip` from the
   [native-latest release](https://github.com/mskorkmaz08-del/yaver/releases/tag/native-latest).
2. Double-click it and drag **Yaver** into Applications.
3. Open it. The first time macOS says it can't check the app: open
   System Settings → Privacy & Security, scroll down, click **Open Anyway**.
   (Or run once in Terminal: `xattr -dr com.apple.quarantine /Applications/Yaver.app`)

After that the Mac app updates itself: when a new build is out, an **Update Yaver**
button appears at the bottom of the sidebar; one click downloads it, swaps the app and
reopens it. Keep Yaver in Applications for this to work. The Lessons & AI tab is the
live web app, so it is always current on both devices.

## iPhone

Apple only lets apps onto an iPhone that are signed for it. Two ways:

**With Xcode on the Mac** (needs a recent macOS; Xcode is free from the App Store):
1. Download this repository (Code → Download ZIP) and open `native/Yaver.xcodeproj`.
2. Click the Yaver project → Signing & Capabilities → Team: pick your Apple ID
   (Add Account… the first time). If it says the bundle id is taken, change the
   end of it, for example `io.github.mskorkmaz08.yaver2`.
3. Plug in the iPhone, pick it at the top of the window, press ▶ Run.
   On the iPhone: Settings → General → VPN & Device Management → trust your Apple ID,
   and turn on Developer Mode when asked.

**Without Xcode:** install the unsigned `Yaver-iPhone-unsigned.ipa` from the release
with Sideloadly or AltStore, signed with your Apple ID.

**How long it lasts:** with a free Apple ID the app stops opening after 7 days and
has to be installed again (AltStore can renew it by itself over Wi-Fi). With the
paid Apple Developer Program ($99 a year) an install lasts a year.
Your data is not lost when the app expires: it is on the phone and in the synced copy.

## How it is built

- `Yaver/Core/` has no UI: `JSON.swift` (records as plain JSON, so unknown fields are
  kept), `Store.swift` (twin of `js/db.js`: stamps, tombstones, merge),
  `SyncCrypto.swift` (twin of `js/crypto.js`: PBKDF2 + AES-GCM + gzip, byte-compatible),
  `Sync.swift` (twin of `js/sync.js`: the gist protocol and sync code),
  `Domain.swift` (Çetele, diet, money, study, teams, body rules).
- `Yaver/Views/`: SwiftUI screens. Tabs on the iPhone, a sidebar on the Mac.
- `Yaver.xcodeproj` is generated: after adding or renaming a Swift file run
  `python3 native/tools/gen_xcodeproj.py`.
- `CoreTests/main.swift` + `tests/native-interop.mjs`: the Mac build server checks the
  store rules and that the web app and the Swift app decrypt each other's sync file.
- `.github/workflows/native.yml` builds everything on a Mac server on every push and
  publishes the Mac app and the iPhone .ipa from main.

Not in the native app yet (still in the web app, all synced): AI chat and voice,
course lessons and review cards, food photo / typed estimates, the body muscle map
and plan, the calendar, the map, Insights.
