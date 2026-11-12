// Sync with no Yaver server, the native twin of js/sync.js: one secret GitHub
// Gist holds the whole database, encrypted on the device first. The native app,
// the web app on any device and this file all read and write the same copy.
// Order: pull → merge record by record (newest updatedAt wins) → push.
// The GitHub key and passphrase stay on this device (not in the synced data).
import Foundation
import Combine

final class Sync: ObservableObject {
    static let api = "https://api.github.com"
    static let desc = "Yaver sync, encrypted"
    static let file = "yaver-sync.enc"
    static let part = 900_000
    static let tokenURL = URL(string: "https://github.com/settings/tokens/new?scopes=gist&description=Yaver%20sync")!

    enum State: String { case off, syncing, ok, error, offline }

    @Published private(set) var state: State = .off
    @Published private(set) var errorText = ""
    @Published private(set) var lastAt: Date?
    @Published private(set) var lastFrom = ""

    let store: Store
    private let defaults: UserDefaults
    private var running: Task<Void, Never>?
    private var debounce: DispatchWorkItem?

    init(store: Store, defaults: UserDefaults = .standard) {
        self.store = store
        self.defaults = defaults
        lastAt = defaults.object(forKey: "syncLastAt") as? Date
        lastFrom = defaults.string(forKey: "syncLastFrom") ?? ""
        state = configured ? .ok : .off
        store.onLocalChange = { [weak self] _, _ in self?.soon() }
    }

    // MARK: Settings on this device

    var token: String { defaults.string(forKey: "syncToken") ?? "" }
    var pass: String { defaults.string(forKey: "syncPass") ?? "" }
    var gistId: String { defaults.string(forKey: "syncGistId") ?? "" }
    var enabled: Bool { defaults.bool(forKey: "syncEnabled") }
    var configured: Bool { !token.isEmpty && !pass.isEmpty && enabled }
    var deviceName: String {
        get {
            if let n = defaults.string(forKey: "deviceName"), !n.isEmpty { return n }
            #if os(macOS)
            return "MacBook (app)"
            #else
            return "iPhone (app)"
            #endif
        }
        set { defaults.set(newValue, forKey: "deviceName") }
    }

    // MARK: GitHub

    struct GitHubError: LocalizedError {
        let message: String
        var status = 0
        var errorDescription: String? { message }
    }

    private func gh(_ path: String, method: String = "GET", body: JSON? = nil) async throws -> JSON {
        var req = URLRequest(url: URL(string: Sync.api + path)!)
        req.httpMethod = method
        req.timeoutInterval = 60
        req.cachePolicy = .reloadIgnoringLocalCacheData
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try body.encoded()
        }
        let (data, resp) = try await URLSession.shared.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw GitHubError(message: "GitHub rejected the key (expired or deleted). Make a new one and set up sync again.", status: 401) }
        if status == 403 {
            let left = (resp as? HTTPURLResponse)?.value(forHTTPHeaderField: "x-ratelimit-remaining")
            throw GitHubError(message: left == "0" ? "GitHub says too many requests. Sync will try again later." : "This GitHub key can't use gists. Make a new one with the gist box ticked.", status: 403)
        }
        guard (200..<300).contains(status) else {
            let m = (try? JSON.decode(data))?["message"]?.string ?? ""
            throw GitHubError(message: "GitHub error \(status)\(m.isEmpty ? "" : ": \(m)")", status: status)
        }
        return status == 204 || data.isEmpty ? .null : try JSON.decode(data)
    }

    private func findGist() async throws -> JSON? {
        if !gistId.isEmpty {
            do { return try await gh("/gists/\(gistId)") } catch let e as GitHubError where e.status == 404 {}
        }
        for page in 1...5 {
            let list = try await gh("/gists?per_page=100&page=\(page)").array ?? []
            if let hit = list.first(where: { $0["description"]?.string == Sync.desc }), let id = hit["id"]?.string {
                defaults.set(id, forKey: "syncGistId")
                return try await gh("/gists/\(id)")
            }
            if list.count < 100 { break }
        }
        return nil
    }

    private static func partNo(_ n: String) -> Int { n == file ? 1 : Int(n.dropFirst(file.count + 1)) ?? 1 }
    private static func isPart(_ n: String) -> Bool { n == file || n.hasPrefix(file + ".") }

    private func readGist(_ g: JSON) async throws -> String? {
        let files = g["files"]?.object ?? [:]
        let names = files.keys.filter(Sync.isPart).sorted { Sync.partNo($0) < Sync.partNo($1) }
        if names.isEmpty { return nil }
        var text = ""
        for n in names {
            let f = files[n] ?? .null
            if f["truncated"]?.bool == true, let raw = f["raw_url"]?.string, let url = URL(string: raw) {
                let (data, _) = try await URLSession.shared.data(from: url)
                text += String(decoding: data, as: UTF8.self)
            } else {
                text += f["content"]?.string ?? ""
            }
        }
        return text
    }

    private static func files(for text: String, existing: [String: JSON] = [:]) -> JSON {
        var out: [String: JSON] = [:]
        let chars = Array(text)
        var i = 0, n = 0
        while i < chars.count {
            let chunk = String(chars[i..<min(i + part, chars.count)])
            out[n == 0 ? file : "\(file).\(n + 1)"] = .object(["content": .string(chunk)])
            i += part; n += 1
        }
        for name in existing.keys where isPart(name) && out[name] == nil { out[name] = .null }
        return .object(out)
    }

    // MARK: Running a sync

    /// Sync in ten seconds (local edits come in bursts).
    func soon() {
        guard configured else { return }
        debounce?.cancel()
        let w = DispatchWorkItem { [weak self] in self?.syncNow() }
        debounce = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 10, execute: w)
    }

    func syncNow() {
        guard configured, running == nil else { return }
        running = Task { @MainActor in
            await self.run(allowEmptyPush: false)
            self.running = nil
        }
    }

    /// One full sync. Throws nothing: problems end up in state and errorText.
    @MainActor
    func run(allowEmptyPush: Bool) async {
        guard configured else { return }
        set(.syncing)
        let pass = self.pass
        do {
            for _ in 0..<3 {
                var g = try await findGist()
                var remote: JSON?
                if let gist = g, let text = try await readGist(gist) {
                    remote = try SyncCrypto.decrypt(text, pass: pass) // wrong passphrase: throws, nothing changed
                }
                if let r = remote, r["data"] != nil {
                    if !defaults.bool(forKey: "syncFirstDone") && !store.isEmpty() { store.snapshot("before-first-sync") }
                    let changed = store.merge(Store.rows(from: r["data"]))
                    if changed > 0, let from = r["deviceName"]?.string {
                        lastFrom = from
                        defaults.set(from, forKey: "syncLastFrom")
                    }
                }
                let data = store.syncPayload()
                if let r = remote, Store.countRows(data) == 0, Store.countRows(Store.rows(from: r["data"])) > 0, !allowEmptyPush {
                    set(.error, "This device is empty and the synced copy is not. Nothing was uploaded.")
                    return
                }
                let payload: JSON = .object([
                    "app": "yaver", "deviceId": .string(store.deviceId), "deviceName": .string(deviceName), "at": .string(Store.isoNow()),
                    "data": .object(data.mapValues { .array($0.map { .object($0) }) }),
                ])
                let body = try SyncCrypto.encrypt(payload, pass: pass)
                if let gist = g, let id = gist["id"]?.string {
                    // Did another device push while we were merging? Then pull again first.
                    let fresh = try await gh("/gists/\(id)")
                    if fresh["updated_at"]?.string != gist["updated_at"]?.string { continue }
                    g = try await gh("/gists/\(id)", method: "PATCH", body: .object(["files": Sync.files(for: body, existing: gist["files"]?.object ?? [:])]))
                } else {
                    let made = try await gh("/gists", method: "POST", body: .object(["description": .string(Sync.desc), "public": false, "files": Sync.files(for: body)]))
                    defaults.set(made["id"]?.string ?? "", forKey: "syncGistId")
                }
                defaults.set(true, forKey: "syncFirstDone")
                lastAt = Date()
                defaults.set(lastAt, forKey: "syncLastAt")
                store.flush()
                set(.ok)
                return
            }
            set(.error, "The other device kept syncing at the same moment. Try again.")
        } catch let e as URLError where [.notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotFindHost].contains(e.code) {
            set(.offline, "Offline, will sync later.")
        } catch {
            set(.error, error.localizedDescription)
        }
    }

    private func set(_ s: State, _ text: String = "") {
        state = s
        errorText = text
    }

    var summary: String {
        if !configured { return "Sync is off." }
        switch state {
        case .syncing: return "Syncing…"
        case .offline: return "Offline, will sync later."
        case .error: return "Sync problem: \(errorText)"
        default: break
        }
        guard let at = lastAt else { return "Not synced yet." }
        let m = Int(Date().timeIntervalSince(at) / 60)
        let ago = m < 1 ? "just now" : m < 60 ? "\(m) min ago" : m < 1440 ? "\(m / 60) h ago" : "\(m / 1440) d ago"
        let from = !lastFrom.isEmpty && lastFrom != deviceName ? " · last changes from \(lastFrom)" : ""
        return "Synced \(ago)\(from)."
    }

    // MARK: Setting up

    /// The sync code from the web app or another device: yaversync1.<base64url JSON {t, p, g}>.
    static func parseCode(_ raw: String) -> (token: String, pass: String, gistId: String)? {
        guard let r = raw.range(of: #"yaversync1\.[A-Za-z0-9_-]+"#, options: .regularExpression) else { return nil }
        var b = String(raw[r].dropFirst("yaversync1.".count)).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b.count % 4 != 0 { b += "=" }
        guard let data = Data(base64Encoded: b), let j = try? JSON.decode(data),
              let t = j["t"]?.string, let p = j["p"]?.string, !t.isEmpty, !p.isEmpty else { return nil }
        return (t, p, j["g"]?.string ?? "")
    }

    func code() -> String {
        guard configured else { return "" }
        let j: JSON = .object(["t": .string(token), "p": .string(pass), "g": .string(gistId)])
        let b = ((try? j.encoded()) ?? Data()).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        return "yaversync1." + b
    }

    /// Joins the shared copy with a sync code, then pulls everything in.
    @MainActor
    func join(code raw: String, name: String) async throws {
        guard let c = Sync.parseCode(raw) else {
            throw GitHubError(message: "That is not a Yaver sync code. In the web app open Settings → Sync and tap Copy sync code.")
        }
        defaults.set(c.token, forKey: "syncToken")
        defaults.set(c.pass, forKey: "syncPass")
        if !c.gistId.isEmpty { defaults.set(c.gistId, forKey: "syncGistId") }
        if !name.trimmingCharacters(in: .whitespaces).isEmpty { deviceName = name.trimmingCharacters(in: .whitespaces) }
        defaults.set(true, forKey: "syncEnabled")
        defaults.set(false, forKey: "syncFirstDone")
        await run(allowEmptyPush: false)
        if state == .error { throw GitHubError(message: errorText) }
    }

    func turnOff(forget: Bool) {
        defaults.set(false, forKey: "syncEnabled")
        if forget { for k in ["syncToken", "syncPass", "syncGistId", "syncLastAt", "syncLastFrom", "syncFirstDone"] { defaults.removeObject(forKey: k) } }
        lastAt = nil
        set(.off)
    }
}
