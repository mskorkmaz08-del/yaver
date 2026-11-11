// The Mac app updates itself: it checks the native-latest release for a newer build
// (version.json, written by the build server), downloads Yaver-Mac.zip, swaps the app
// in place and opens the new one. Your data lives in Application Support, so it stays.
// The iPhone can't do this (Apple only allows installs through signing tools), but the
// Lessons & AI tab is the live web app and updates by itself on both.
import Foundation
import Combine
#if os(macOS)
import AppKit
#endif

final class Updater: ObservableObject {
    static let release = "https://github.com/mskorkmaz08-del/yaver/releases/download/native-latest/"

    enum State: Equatable { case idle, available(Int), installing, failed(String) }
    @Published private(set) var state: State = .idle

    var currentBuild: Int { Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "") ?? 0 }

    #if os(macOS)
    @MainActor
    func check() async {
        if case .installing = state { return }
        guard let url = URL(string: Updater.release + "version.json") else { return }
        var req = URLRequest(url: url)
        req.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (data, _) = try? await URLSession.shared.data(for: req),
              let j = try? JSON.decode(data), let build = j["build"]?.double.map(Int.init) else { return }
        state = build > currentBuild ? .available(build) : .idle
    }

    /// Download, swap and relaunch. Calls `beforeQuit` (save data) right before quitting.
    @MainActor
    func install(beforeQuit: @escaping () -> Void) async {
        let app = Bundle.main.bundleURL
        if app.path.contains("AppTranslocation") || !FileManager.default.isWritableFile(atPath: app.deletingLastPathComponent().path) {
            state = .failed("Move Yaver into the Applications folder first (drag it there from Downloads), open it from there, then update.")
            return
        }
        state = .installing
        do {
            let fm = FileManager.default
            let dir = fm.temporaryDirectory.appendingPathComponent("yaver-update-\(UUID().uuidString)")
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            let (tmp, _) = try await URLSession.shared.download(from: URL(string: Updater.release + "Yaver-Mac.zip")!)
            let zip = dir.appendingPathComponent("Yaver-Mac.zip")
            try fm.moveItem(at: tmp, to: zip)
            try run("/usr/bin/ditto", ["-x", "-k", zip.path, dir.path])
            let fresh = dir.appendingPathComponent("Yaver.app")
            guard fm.fileExists(atPath: fresh.appendingPathComponent("Contents/MacOS/Yaver").path) else {
                throw NSError(domain: "Yaver", code: 2, userInfo: [NSLocalizedDescriptionKey: "The download did not contain the app."])
            }
            // A small script finishes the swap after this app has quit.
            let script = """
            while kill -0 \(ProcessInfo.processInfo.processIdentifier) 2>/dev/null; do sleep 0.2; done
            rm -rf "\(app.path).old"
            mv "\(app.path)" "\(app.path).old" && mv "\(fresh.path)" "\(app.path)" && rm -rf "\(app.path).old"
            [ -d "\(app.path)" ] || mv "\(app.path).old" "\(app.path)"
            xattr -dr com.apple.quarantine "\(app.path)" 2>/dev/null
            open "\(app.path)"
            rm -rf "\(dir.path)"
            """
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/bin/sh")
            p.arguments = ["-c", script]
            try p.run()
            beforeQuit()
            NSApp.terminate(nil)
        } catch {
            state = .failed("Update failed: \(error.localizedDescription)")
        }
    }

    private func run(_ tool: String, _ args: [String]) throws {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: tool)
        p.arguments = args
        try p.run()
        p.waitUntilExit()
        if p.terminationStatus != 0 { throw NSError(domain: "Yaver", code: 3, userInfo: [NSLocalizedDescriptionKey: "Could not unpack the update."]) }
    }
    #endif
}
