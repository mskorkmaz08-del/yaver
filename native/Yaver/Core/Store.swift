// The local database, the native twin of js/db.js. Same stores, same record
// shapes and the same merge rules, so the native app, the web app and the
// encrypted sync copy all agree record by record:
// - every write is stamped with updatedAt (ISO time with milliseconds, UTC),
//   createdAt and deviceId;
// - every delete leaves a tombstone "<store>/<id>";
// - merging keeps the newest updatedAt; a newer tombstone deletes the record.
// Everything is held in memory and saved as one JSON file in Application Support.
import Foundation
import Combine

final class Store: ObservableObject {
    static let stores = ["expenses", "events", "subjects", "sessions", "meals", "tasks", "milestones", "chats", "kv",
                         "courseProgress", "cards", "courseLessons", "courseTests", "ceteleItems", "ceteleLog", "applecal",
                         "people", "activities", "weighins", "workouts", "checkins", "tombstones"]
    // Settings that belong to one device only (same list as LOCAL_KEYS in js/db.js).
    static let localKeys: Set<String> = ["apiKey", "geminiKey", "provider", "model", "effort", "geminiModel", "geminiModels", "speak",
        "voiceLang", "voiceStyle", "ttsVoice", "voiceAuto", "jarvis", "voiceMac", "deviceVoice", "voiceV16", "voiceEngine", "liveModel",
        "lastLoc", "onboarded", "webSearch", "deviceId", "deviceName", "autoBackups", "macUrl", "macToken", "macModel", "sounds", "sfx",
        "sfxRec", "music", "appleCal", "appleCalStatus", "foodModel", "foodModels", "foodTips", "insightsHidden"]
    static func isLocalKey(_ id: String) -> Bool { localKeys.contains(id) || id.hasPrefix("sync") }
    static let localStores: Set<String> = ["chats", "applecal"]
    static let secretKeys: Set<String> = ["apiKey", "geminiKey", "macToken"]

    /// Bumped on every change, so SwiftUI screens redraw.
    @Published private(set) var revision = 0
    private var mem: [String: [String: Row]] = [:]
    private(set) var deviceId = ""
    let fileURL: URL
    /// Called after a change made on this device (not by a merge): sync uses it.
    var onLocalChange: ((String, String) -> Void)?

    init(directory: URL? = nil) {
        let dir = directory ?? Store.defaultDirectory()
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        fileURL = dir.appendingPathComponent("yaver-db.json")
        for s in Store.stores { mem[s] = [:] }
        load()
        deviceId = setting("deviceId")?.string ?? ""
        if deviceId.isEmpty {
            deviceId = Store.uid()
            setSetting("deviceId", .string(deviceId))
        }
    }

    static func defaultDirectory() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return base.appendingPathComponent("Yaver", isDirectory: true)
    }

    // MARK: Time and ids, in the same formats the web app writes.

    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }()
    static func isoNow() -> String { iso.string(from: Date()) }
    static func isoString(_ d: Date) -> String { iso.string(from: d) }
    static func parseISO(_ s: String) -> Date? {
        if let d = iso.date(from: s) { return d }
        let f = ISO8601DateFormatter()
        return f.date(from: s)
    }
    static func uid() -> String {
        let ms = Int64(Date().timeIntervalSince1970 * 1000)
        let chars = Array("abcdefghijklmnopqrstuvwxyz0123456789")
        return String(ms, radix: 36) + String((0..<6).map { _ in chars.randomElement()! })
    }

    // MARK: Reading

    func all(_ store: String) -> [Row] { Array((mem[store] ?? [:]).values) }
    func get(_ store: String, _ id: String) -> Row? { mem[store]?[id] }
    func count(_ store: String) -> Int { mem[store]?.count ?? 0 }

    func setting(_ key: String) -> JSON? { mem["kv"]?[key]?["value"] }
    func setSetting(_ key: String, _ value: JSON) { put("kv", ["id": .string(key), "value": value]) }

    // MARK: Writing

    @discardableResult
    func put(_ store: String, _ input: Row) -> Row {
        var row = input
        if row.id.isEmpty { row["id"] = .string(Store.uid()) }
        let now = Store.isoNow()
        if row["createdAt"]?.string == nil { row["createdAt"] = .string(now) }
        row["updatedAt"] = .string(now)
        row["deviceId"] = .string(deviceId)
        mem[store, default: [:]][row.id] = row
        mem["tombstones"]?.removeValue(forKey: "\(store)/\(row.id)")
        changed(store, row.id, local: true)
        return row
    }

    func remove(_ store: String, _ id: String) {
        mem[store]?.removeValue(forKey: id)
        if store != "tombstones" && !(store == "kv" && Store.isLocalKey(id)) {
            let tid = "\(store)/\(id)"
            mem["tombstones"]?[tid] = ["id": .string(tid), "store": .string(store), "rid": .string(id), "deletedAt": .string(Store.isoNow())]
        }
        changed(store, id, local: true)
    }

    private func changed(_ store: String, _ id: String, local: Bool) {
        save()
        revision &+= 1
        if local && !(store == "kv" && Store.isLocalKey(id)) && !Store.localStores.contains(store) { onLocalChange?(store, id) }
    }

    // MARK: Merging (sync and Import)

    /// Newest updatedAt wins; a tombstone newer than the record deletes it.
    /// Returns how many rows changed here. Merged rows keep their own stamps.
    @discardableResult
    func merge(_ data: [String: [Row]], local: Bool = false) -> Int {
        var n = 0
        for t in data["tombstones"] ?? [] {
            let tid = t.id
            guard !tid.isEmpty else { continue }
            let deletedAt = t.str("deletedAt")
            if let mine = mem["tombstones"]?[tid], mine.str("deletedAt") >= deletedAt {} else { mem["tombstones"]?[tid] = t }
            let s = t.str("store"), rid = t.str("rid")
            if let row = mem[s]?[rid], row.str("updatedAt") < deletedAt {
                mem[s]?.removeValue(forKey: rid)
                n += 1
            }
        }
        for s in Store.stores where s != "tombstones" {
            guard let rows = data[s], local || !Store.localStores.contains(s) else { continue }
            for var row in rows {
                let id = row.id
                if id.isEmpty { continue }
                if s == "kv" && !local && Store.isLocalKey(id) { continue }
                let upd = row.str("updatedAt")
                if let t = mem["tombstones"]?["\(s)/\(id)"], t.str("deletedAt") >= upd { continue }
                if let mine = mem[s]?[id], mine.str("updatedAt") >= upd { continue }
                if upd.isEmpty { row["updatedAt"] = .string(row["createdAt"]?.string ?? "1970-01-01T00:00:00.000Z") }
                mem[s, default: [:]][id] = row
                n += 1
            }
        }
        pruneTombstones()
        save()
        if n > 0 { revision &+= 1 }
        return n
    }

    private func pruneTombstones() {
        let cutoff = Store.isoString(Date().addingTimeInterval(-90 * 86400))
        for (k, t) in mem["tombstones"] ?? [:] where t.str("deletedAt") < cutoff { mem["tombstones"]?.removeValue(forKey: k) }
    }

    /// Everything that syncs between devices: no keys, no device-only settings, no chats.
    func syncPayload() -> [String: [Row]] {
        var out: [String: [Row]] = [:]
        for s in Store.stores where !Store.localStores.contains(s) {
            out[s] = all(s).filter { !(s == "kv" && Store.isLocalKey($0.id)) }
        }
        return out
    }

    func isEmpty() -> Bool {
        let rowsEmpty = Store.stores.allSatisfy { $0 == "kv" || $0 == "tombstones" || count($0) == 0 }
        return rowsEmpty && !all("kv").contains { !Store.isLocalKey($0.id) }
    }

    static func countRows(_ data: [String: [Row]]) -> Int {
        data.filter { $0.key != "tombstones" }.reduce(0) { $0 + $1.value.count }
    }

    // MARK: Backups (same file format as Settings → Export in the web app)

    func exportAll() -> JSON {
        var data: [String: JSON] = [:]
        for s in Store.stores {
            data[s] = .array(all(s).filter { r in !(s == "kv" && (Store.secretKeys.contains(r.id) || r.id.hasPrefix("sync") || r.id == "autoBackups")) }.map { .object($0) })
        }
        return .object(["app": "yaver", "version": 9, "exportedAt": .string(Store.isoNow()), "data": .object(data)])
    }

    /// Merges a web-app or native backup in. Returns how many records changed.
    func importBackup(_ backup: JSON) throws -> Int {
        guard backup["app"]?.string == "yaver", let data = backup["data"]?.object else {
            throw NSError(domain: "Yaver", code: 1, userInfo: [NSLocalizedDescriptionKey: "This is not a Yaver backup file."])
        }
        var clean: [String: [Row]] = [:]
        for s in Store.stores {
            var rows: [Row] = (data[s]?.array ?? []).compactMap { $0.object }.map { r in
                var r = r
                if r["updatedAt"]?.string == nil { r["updatedAt"] = .string(r["createdAt"]?.string ?? "1970-01-01T00:00:00.000Z") }
                return r
            }
            if s == "kv" {
                rows = rows.filter { r in !(Store.secretKeys.contains(r.id) || r.id == "deviceId" || r.id.hasPrefix("sync")) }
            }
            clean[s] = rows
        }
        return merge(clean, local: true)
    }

    static func rows(from json: JSON?) -> [String: [Row]] {
        var out: [String: [Row]] = [:]
        for (k, v) in json?.object ?? [:] { out[k] = (v.array ?? []).compactMap { $0.object } }
        return out
    }

    // MARK: File

    private func load() {
        guard let data = try? Data(contentsOf: fileURL), let json = try? JSON.decode(data) else { return }
        for (s, rows) in Store.rows(from: json["stores"]) where mem[s] != nil {
            for r in rows where !r.id.isEmpty { mem[s]?[r.id] = r }
        }
    }

    private var pending: DispatchWorkItem?
    /// Saves soon (writes come in bursts); flush() saves right away.
    private func save() {
        pending?.cancel()
        let w = DispatchWorkItem { [weak self] in self?.flush() }
        pending = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: w)
    }

    func flush() {
        pending?.cancel()
        pending = nil
        var stores: [String: JSON] = [:]
        for (s, rows) in mem { stores[s] = .array(rows.values.map { .object($0) }) }
        guard let data = try? JSON.object(["app": "yaver-native", "stores": .object(stores)]).encoded() else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    /// Writes a copy of everything to a dated backup file next to the database.
    @discardableResult
    func snapshot(_ label: String) -> URL? {
        let dir = fileURL.deletingLastPathComponent().appendingPathComponent("Backups", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let stamp = Store.isoNow().replacingOccurrences(of: ":", with: "-")
        let url = dir.appendingPathComponent("yaver-\(label)-\(stamp).json")
        guard let data = try? exportAll().encoded() else { return nil }
        try? data.write(to: url, options: .atomic)
        return url
    }
}
