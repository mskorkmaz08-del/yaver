// The assistant's brains (native twin of js/ai/claude.js, gemini.js, mac.js and
// provider.js). Every tool runs on this device (Tools.swift); the AI only thinks.
// Routes, in order: Claude on the Mac (the bridge, under Mustafa's subscription)
// when it answers, then the chosen API: Gemini (free) or Claude (paid key).
import Foundation
import CryptoKit

struct AIError: LocalizedError {
    let message: String
    var code = ""
    var errorDescription: String? { message }
}

struct TurnCallbacks {
    var onText: (String) -> Void = { _ in }
    var onAction: (String) -> Void = { _ in }
    var onStatus: (String) -> Void = { _ in }
}

enum AI {
    static let models: [(id: String, label: String)] = [
        ("claude-opus-5-5", "Claude Opus 5.5 · smartest"), ("claude-sonnet-5-5", "Claude Sonnet 5.5 · fast & smart"), ("claude-haiku-5-5", "Claude Haiku 5.5 · fastest & cheapest"),
    ]

    // MARK: keys and provider (provider.js)
    static func kindOfKey(_ v: String) -> String { v.isEmpty ? "" : v.hasPrefix("sk-ant-") ? "anthropic" : "gemini" }
    static func cleanKey(_ v: String) -> String { v.filter { !$0.isWhitespace && !"\"'`".contains($0) } }
    static func provider(_ s: Store) -> String {
        let p = s.setting("provider")?.string ?? ""
        let has = ["anthropic": !(s.setting("apiKey")?.string ?? "").isEmpty, "gemini": !(s.setting("geminiKey")?.string ?? "").isEmpty]
        if has[p] == true { return p }
        if has["gemini"] == true { return "gemini" }
        if has["anthropic"] == true { return "anthropic" }
        return "gemini"
    }
    /// Stores a pasted key under the right AI and switches to it.
    static func saveKey(_ s: Store, _ raw: String) throws {
        let v = cleanKey(raw)
        if v.count < 20 { throw AIError(message: "That key looks too short. Copy the whole key again.") }
        let kind = kindOfKey(v)
        s.setSetting(kind == "gemini" ? "geminiKey" : "apiKey", .string(v))
        s.setSetting("provider", .string(kind))
        if kind == "gemini" { s.setSetting("geminiModel", ""); s.setSetting("foodModels", .null) }
    }

    static func dynamicContext(_ s: Store) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.dateFormat = "EEEE d MMMM yyyy, HH:mm"
        let name = s.setting("userName")?.string ?? ""
        let about = s.setting("aboutMe")?.string ?? ""
        var t = "Current local date and time: \(f.string(from: Date())) (\(TimeZone.current.identifier)). Today is \(Day.today).\nUser's name: \(name.isEmpty ? "unknown" : name). Currency: \(s.currency)."
        if !about.isEmpty { t += "\nAbout the user, in their words: \(about)" }
        return t
    }
    static let noSearch = "Web search is not available in this mode: answer from what you know, and say plainly when something may be out of date."

    @MainActor
    private static func runTool(_ s: Store, _ name: String, _ input: [String: JSON], _ cb: TurnCallbacks) async -> JSON {
        cb.onStatus(Tools.statusFor(name))
        let out = await Tools.run(s, name, input)
        if AssistantDefs.writeTools.contains(name), out["error"] == nil, let label = Tools.describe(name, input) { cb.onAction(label) }
        return out
    }

    // MARK: Claude API (claude.js)

    private static var noFallbacks = false, noWebSearch = false

    @MainActor
    static func runClaude(_ s: Store, _ messages: inout [JSON], _ cb: TurnCallbacks) async throws -> String {
        let key = s.setting("apiKey")?.string ?? ""
        if key.isEmpty { throw AIError(message: "No Claude key yet. Paste your free Gemini key (or a Claude key) in Settings → AI.", code: "nokey") }
        var text = ""
        for _ in 0..<12 {
            cb.onStatus("Thinking…")
            let final = try await claudeOnce(s, key, messages)
            let content = final["content"]?.array ?? []
            messages.append(.object(["role": "assistant", "content": .array(content)]))
            let said = content.filter { $0["type"]?.string == "text" }.compactMap { $0["text"]?.string }.joined()
            if !said.isEmpty { text += said; cb.onText(text) }
            let stop = final["stop_reason"]?.string ?? ""
            if stop == "refusal" { text += (text.isEmpty ? "" : "\n\n") + "I can't help with that one."; cb.onText(text); return text }
            if stop == "pause_turn" { continue }
            let calls = content.filter { $0["type"]?.string == "tool_use" }
            if calls.isEmpty { break }
            var results: [JSON] = []
            for c in calls {
                let out = await runTool(s, c["name"]?.string ?? "", c["input"]?.object ?? [:], cb)
                var r: [String: JSON] = ["type": "tool_result", "tool_use_id": c["id"] ?? .null, "content": .string(String(data: (try? out.encoded()) ?? Data(), encoding: .utf8) ?? "{}")]
                if out["error"] != nil { r["is_error"] = true }
                results.append(.object(r))
            }
            messages.append(.object(["role": "user", "content": .array(results)]))
            if !text.isEmpty && !text.hasSuffix("\n") { text += "\n\n" }
        }
        cb.onStatus("")
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    @MainActor
    private static func claudeOnce(_ s: Store, _ key: String, _ messages: [JSON]) async throws -> JSON {
        for _ in 0..<3 {
            var tools = AssistantDefs.tools.map { t -> JSON in .object(["name": t["name"] ?? .null, "description": t["description"] ?? .null, "input_schema": t["input_schema"] ?? .object([:])]) }
            if s.setting("webSearch")?.bool ?? true, !noWebSearch { tools.append(.object(["type": "web_search_20260209", "name": "web_search", "max_uses": 3])) }
            var body: [String: JSON] = [
                "model": .string(s.setting("model")?.string ?? "claude-opus-5-5"),
                "max_tokens": 16000,
                "thinking": .object(["type": "adaptive"]),
                "output_config": .object(["effort": .string(s.setting("effort")?.string ?? "low")]),
                "system": .array([.object(["type": "text", "text": .string(AssistantDefs.system), "cache_control": .object(["type": "ephemeral"])]),
                                  .object(["type": "text", "text": .string(dynamicContext(s))])]),
                "tools": .array(tools),
                "messages": .array(messages),
            ]
            var req = URLRequest(url: URL(string: "https://api.anthropic.com/v1/messages")!, timeoutInterval: 600)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "content-type")
            req.setValue(key, forHTTPHeaderField: "x-api-key")
            req.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
            if !noFallbacks { body["fallbacks"] = "default"; req.setValue("server-side-fallback-2026-07-01", forHTTPHeaderField: "anthropic-beta") }
            req.httpBody = try JSON.object(body).encoded()
            let data: Data, status: Int
            do {
                let (d, r) = try await URLSession.shared.data(for: req)
                data = d; status = (r as? HTTPURLResponse)?.statusCode ?? 0
            } catch {
                if Task.isCancelled { throw AIError(message: "Stopped.", code: "abort") }
                throw AIError(message: (error as NSError).code == NSURLErrorNotConnectedToInternet ? "You are offline. Your trackers still work; Yaver needs internet to think." : "Could not reach Claude. Check your connection.")
            }
            let j = (try? JSON.decode(data)) ?? .null
            if status == 200 { return j }
            let msg = j["error"]?["message"]?.string ?? ""
            if status == 400 && !noFallbacks && msg.range(of: "fallback|beta", options: [.regularExpression, .caseInsensitive]) != nil { noFallbacks = true; continue }
            if status == 400 && !noWebSearch && msg.range(of: "web_search|web search", options: [.regularExpression, .caseInsensitive]) != nil { noWebSearch = true; continue }
            switch status {
            case 401: throw AIError(message: "Your API key was rejected. Check it in Settings.")
            case 403: throw AIError(message: "This API key is not allowed to use that model. Try another model in Settings.")
            case 429: throw AIError(message: "Too many requests right now (or your API credit ran out). Try again in a moment.")
            case 500...599: throw AIError(message: "Claude is having a moment (server error). Try again.")
            default: throw AIError(message: msg.isEmpty ? "Claude returned an error (\(status))." : msg)
            }
        }
        throw AIError(message: "Could not reach Claude.")
    }

    static func testClaude(_ s: Store) async throws {
        var req = URLRequest(url: URL(string: "https://api.anthropic.com/v1/models/\(s.setting("model")?.string ?? "claude-opus-5-5")")!, timeoutInterval: 15)
        req.setValue(s.setting("apiKey")?.string ?? "", forHTTPHeaderField: "x-api-key")
        req.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        let (_, r) = try await URLSession.shared.data(for: req)
        let st = (r as? HTTPURLResponse)?.statusCode ?? 0
        if st == 401 { throw AIError(message: "Your API key was rejected. Check it in Settings.") }
        if st != 200 { throw AIError(message: "Claude answered \(st).") }
    }

    // MARK: Gemini chat (gemini.js)

    static func cleanSchema(_ j: JSON) -> JSON {
        switch j {
        case .object(let o): return .object(o.filter { $0.key != "additionalProperties" }.mapValues(cleanSchema))
        case .array(let a): return .array(a.map(cleanSchema))
        default: return j
        }
    }
    static func functionDeclarations() -> [JSON] {
        AssistantDefs.tools.map { t in
            var d: [String: JSON] = ["name": t["name"] ?? .null, "description": t["description"] ?? .null]
            if let p = t["input_schema"]?["properties"]?.object, !p.isEmpty { d["parameters"] = cleanSchema(t["input_schema"]!) }
            return .object(d)
        }
    }
    static func geminiUser(_ text: String, image: Data?) -> JSON {
        var parts: [JSON] = []
        if let image { parts.append(.object(["inlineData": .object(["mimeType": "image/jpeg", "data": .string(image.base64EncodedString())])])) }
        parts.append(.object(["text": .string(text)]))
        return .object(["role": "user", "parts": .array(parts)])
    }

    /// The best stable Flash model for chat (remembered in geminiModel).
    @MainActor
    static func chatModel(_ s: Store) async -> String {
        if let m = s.setting("geminiModel")?.string, !m.isEmpty { return m }
        let m = await Gemini.flashModels(s).first { !$0.contains("lite") } ?? "gemini-2.5-flash"
        s.setSetting("geminiModel", .string(m))
        return m
    }

    @MainActor
    static func runGemini(_ s: Store, _ contents: inout [JSON], fast: Bool = false, _ cb: TurnCallbacks) async throws -> String {
        let key = Gemini.key(s)
        if key.isEmpty { throw AIError(message: "Paste your free Gemini key in Settings → AI.", code: "nokey") }
        var text = ""
        for _ in 0..<10 {
            let base = text
            let (parts, finish) = try await geminiStream(s, key, contents, fast: fast, cb) { t in text = base + t; cb.onText(text) }
            if parts.isEmpty {
                if finish == "SAFETY" || finish == "PROHIBITED_CONTENT" { text += "I can't help with that one." }
                break
            }
            contents.append(.object(["role": "model", "parts": .array(parts)]))
            let calls = parts.compactMap { $0["functionCall"] }
            if calls.isEmpty { break }
            var responses: [JSON] = []
            for fc in calls {
                let name = fc["name"]?.string ?? ""
                let out = await runTool(s, name, fc["args"]?.object ?? [:], cb)
                var r: [String: JSON] = ["name": .string(name), "response": out.array != nil ? .object(["result": out]) : (out.object != nil ? out : .object(["ok": true]))]
                if let id = fc["id"] { r["id"] = id }
                responses.append(.object(["functionResponse": .object(r)]))
            }
            contents.append(.object(["role": "user", "parts": .array(responses)]))
            if !text.isEmpty && !text.hasSuffix("\n") { text += "\n\n" }
        }
        cb.onStatus("")
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// One streamed answer, moving to other Flash models while Google says busy.
    @MainActor
    private static func geminiStream(_ s: Store, _ key: String, _ contents: [JSON], fast: Bool, _ cb: TurnCallbacks, onDelta: (String) -> Void) async throws -> ([JSON], String) {
        let first = await chatModel(s)
        var order = [first]
        var tried = 0
        while tried < order.count {
            let model = order[tried]
            if tried > 0 { cb.onStatus("Gemini is busy. Trying \(model.replacingOccurrences(of: "gemini-", with: ""))…") }
            if let r = try await geminiModel(s, key, model, contents, fast: fast, onDelta: onDelta) { return r }
            if tried == 0 { order += Array(await Gemini.flashModels(s).filter { $0 != first }.prefix(3)) }
            tried += 1
        }
        throw AIError(message: "Gemini is overloaded or at its free limit right now (on Google's side, not your key), and the backup models were busy too. Try again in a minute.")
    }

    /// nil means busy (try another model).
    @MainActor
    private static func geminiModel(_ s: Store, _ key: String, _ model: String, _ contents: [JSON], fast: Bool, onDelta: (String) -> Void) async throws -> ([JSON], String)? {
        var gen: [String: JSON] = ["maxOutputTokens": 8192]
        if fast { for (k, v) in Gemini.thinking(model) { gen[k] = v } }
        let body: [String: JSON] = [
            "systemInstruction": .object(["parts": .array([.object(["text": .string("\(AssistantDefs.system)\n\n\(noSearch)\n\n\(dynamicContext(s))")])])]),
            "contents": .array(contents),
            "tools": .array([.object(["functionDeclarations": .array(functionDeclarations())])]),
            "generationConfig": .object(gen),
        ]
        var req = URLRequest(url: URL(string: "\(Gemini.api)/models/\(model):streamGenerateContent?alt=sse")!, timeoutInterval: 120)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(key, forHTTPHeaderField: "x-goog-api-key")
        req.httpBody = try JSON.object(body).encoded()
        let bytes: URLSession.AsyncBytes, status: Int
        do {
            let (b, r) = try await URLSession.shared.bytes(for: req)
            bytes = b; status = (r as? HTTPURLResponse)?.statusCode ?? 0
        } catch {
            if Task.isCancelled { throw AIError(message: "Stopped.", code: "abort") }
            throw AIError(message: (error as NSError).code == NSURLErrorNotConnectedToInternet ? "You are offline. Your trackers still work; Yaver needs internet to think." : "Could not reach Gemini. Check your connection.")
        }
        if status == 400 && fast { return try await geminiModel(s, key, model, contents, fast: false, onDelta: onDelta) }
        if Gemini.busy.contains(status) { return nil }
        if status != 200 {
            var raw = Data()
            for try await b in bytes { raw.append(b) }
            let msg = (try? JSON.decode(raw))?["error"]?["message"]?.string ?? ""
            if status == 400 && msg.range(of: "api key", options: .caseInsensitive) != nil { throw AIError(message: "Google says this key is not valid. Copy it again from aistudio.google.com/apikey.") }
            if status == 403 { throw AIError(message: "Google refused this key: \(msg.isEmpty ? "permission denied" : msg).") }
            if status == 404 { s.setSetting("geminiModel", ""); throw AIError(message: "That Gemini model is not available to your key. Try again; Yaver will pick another.") }
            throw AIError(message: msg.isEmpty ? "Gemini error \(status)" : msg)
        }
        var parts: [JSON] = [], finish = "", text = ""
        do {
            for try await line in bytes.lines {
                guard line.hasPrefix("data:"), let chunk = try? JSON.decode(Data(line.dropFirst(5).utf8)) else { continue }
                let cand = chunk["candidates"]?.array?.first
                if let f = cand?["finishReason"]?.string { finish = f }
                for p in cand?["content"]?["parts"]?.array ?? [] {
                    parts.append(p) // kept as sent: thought signatures must go back unchanged
                    if let t = p["text"]?.string, p["thought"]?.bool != true { text += t; onDelta(text) }
                }
            }
        } catch {
            if Task.isCancelled { throw AIError(message: "Stopped.", code: "abort") }
            throw AIError(message: "Lost the connection to Gemini.")
        }
        return (parts, finish)
    }

    // MARK: Claude on the Mac (mac.js)

    static let bridgeCommand = "mkdir -p ~/yaver-bridge && curl -fsSL -o ~/yaver-bridge/yaver-bridge.mjs https://raw.githubusercontent.com/mskorkmaz08-del/yaver/main/bridge/yaver-bridge.mjs && node ~/yaver-bridge/yaver-bridge.mjs --install"
    static func macBase(_ s: Store) -> String {
        var b = (s.setting("macUrl")?.string ?? "").trimmingCharacters(in: .whitespaces)
        while b.hasSuffix("/") { b.removeLast() }
        return b
    }
    static func macToken(_ s: Store) -> String { (s.setting("macToken")?.string ?? "").trimmingCharacters(in: .whitespaces) }
    static func macConfigured(_ s: Store) -> Bool { !macBase(s).isEmpty && !macToken(s).isEmpty }
    private static var macLast: (at: Date, ok: Bool) = (.distantPast, false)
    private static var pairedAt = Date.distantPast

    /// "yaver1." + base64url of {u: address, t: token}
    static func parseCode(_ raw: String) -> (url: String, token: String)? {
        guard let r = raw.range(of: #"yaver1\.[A-Za-z0-9_-]+"#, options: .regularExpression) else { return nil }
        var b = String(raw[r].dropFirst(7)).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b.count % 4 != 0 { b += "=" }
        guard let d = Data(base64Encoded: b), let j = try? JSON.decode(d), let u = j["u"]?.string, let t = j["t"]?.string,
              u.hasPrefix("http://") || u.hasPrefix("https://"), !t.isEmpty else { return nil }
        return (u, t)
    }
    static func useCode(_ s: Store, _ raw: String) throws {
        guard let c = parseCode(raw) else { throw AIError(message: "That is not a Yaver connection code. Copy it again from the bridge window.") }
        s.setSetting("macUrl", .string(c.url)); s.setSetting("macToken", .string(c.token))
        macLast = (.distantPast, false)
    }

    private static func macRequest(_ s: Store, _ path: String, timeout: TimeInterval) -> URLRequest {
        var req = URLRequest(url: URL(string: macBase(s) + path) ?? URL(string: "http://127.0.0.1:8787")!, timeoutInterval: timeout)
        req.setValue("Bearer \(macToken(s))", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return req
    }

    /// On the Mac the bridge runs on 127.0.0.1 and hands over its address and token.
    @MainActor
    static func pairLocal(_ s: Store, force: Bool = false) async -> Bool {
        #if os(macOS)
        if !force && Date().timeIntervalSince(pairedAt) < 60 { return false }
        pairedAt = Date()
        guard let (d, r) = try? await URLSession.shared.data(for: URLRequest(url: URL(string: "http://127.0.0.1:8787/pair")!, timeoutInterval: 1)),
              (r as? HTTPURLResponse)?.statusCode == 200, let j = try? JSON.decode(d),
              let url = j["url"]?.string, url.range(of: #"^http://127\.0\.0\.1:\d+$"#, options: .regularExpression) != nil,
              let token = j["token"]?.string, !token.isEmpty else { return false }
        if url != macBase(s) { s.setSetting("macUrl", .string(url)) }
        if token != macToken(s) { s.setSetting("macToken", .string(token)) }
        macLast = (Date(), true)
        return true
        #else
        return false
        #endif
    }

    private static func healthy(_ s: Store, timeout: TimeInterval = 1.5) async -> Bool {
        guard let (_, r) = try? await URLSession.shared.data(for: macRequest(s, "/health", timeout: timeout)) else { return false }
        return (r as? HTTPURLResponse)?.statusCode == 200
    }

    /// Quick check before each message; remembered for 30 seconds (60 when offline).
    @MainActor
    static func macOnline(_ s: Store, force: Bool = false) async -> Bool {
        if !macConfigured(s) { return await pairLocal(s, force: force) }
        if !force && Date().timeIntervalSince(macLast.at) < (macLast.ok ? 30 : 60) { return macLast.ok }
        var ok = await healthy(s)
        if !ok { ok = await pairLocal(s, force: force) }
        macLast = (Date(), ok)
        if !ok { Task { if await rediscover(s) { macLast = (.distantPast, false) } } }
        return ok
    }

    /// The bridge posts its new link to ntfy.sh under a hash of the token when it restarts.
    @MainActor
    static func rediscover(_ s: Store) async -> Bool {
        let token = macToken(s)
        if token.isEmpty { return false }
        let topic = "yaver-" + SHA256.hash(data: Data("yaver-bridge:\(token)".utf8)).map { String(format: "%02x", $0) }.joined().prefix(32)
        guard let (d, _) = try? await URLSession.shared.data(for: URLRequest(url: URL(string: "https://ntfy.sh/\(topic)/json?poll=1&since=24h")!, timeoutInterval: 3)) else { return false }
        let urls = String(decoding: d, as: UTF8.self).split(separator: "\n").compactMap { try? JSON.decode(Data($0.utf8)) }
            .filter { $0["event"]?.string == "message" }.compactMap { $0["message"]?.string?.trimmingCharacters(in: .whitespaces) }
            .filter { $0.range(of: #"^https://[a-z0-9-]+\.trycloudflare\.com$"#, options: .regularExpression) != nil }
        guard let url = urls.last, url != macBase(s) else { return false }
        s.setSetting("macUrl", .string(url))
        return true
    }

    @MainActor
    static func testMac(_ s: Store) async throws -> String {
        if await pairLocal(s, force: true) { return "Connected to Claude on this Mac." }
        if !macConfigured(s) {
            #if os(macOS)
            throw AIError(message: "No bridge running on this Mac. Run the one-line setup below once.")
            #else
            throw AIError(message: "Paste the connection code from your Mac first.")
            #endif
        }
        if !(await healthy(s)) { _ = await rediscover(s) }
        guard let (_, r) = try? await URLSession.shared.data(for: macRequest(s, "/health", timeout: 5)) else { throw AIError(message: "Could not reach your Mac. Is it awake with the bridge running?") }
        let st = (r as? HTTPURLResponse)?.statusCode ?? 0
        if st == 401 { throw AIError(message: "The Mac refused the token. Copy the connection code again.") }
        if st != 200 { throw AIError(message: "The bridge answered \(st).") }
        macLast = (Date(), true)
        return "Connected to Claude on your Mac."
    }

    @MainActor
    static func runMac(_ s: Store, _ history: inout [JSON], _ cb: TurnCallbacks) async throws -> String {
        var text = ""
        let names = Set(AssistantDefs.tools.compactMap { $0["name"]?.string })
        let tools = AssistantDefs.tools.map { t -> JSON in .object(["name": t["name"] ?? .null, "description": t["description"] ?? .null, "input_schema": t["input_schema"] ?? .object([:])]) }
        for _ in 0..<8 {
            cb.onStatus("Thinking on your Mac…")
            var req = macRequest(s, "/chat", timeout: 300)
            req.httpMethod = "POST"
            req.httpBody = try JSON.object([
                "system": .string("\(AssistantDefs.system)\n\n\(noSearch)\n\n\(dynamicContext(s))"),
                "transcript": .array(history), "tools": .array(tools), "model": .string(s.setting("macModel")?.string ?? "sonnet"),
            ]).encoded()
            let data: Data, status: Int
            do {
                let (d, r) = try await URLSession.shared.data(for: req)
                data = d; status = (r as? HTTPURLResponse)?.statusCode ?? 0
            } catch {
                macLast = (.distantPast, false)
                if Task.isCancelled { throw AIError(message: "Stopped.", code: "abort") }
                throw AIError(message: "Lost the connection to your Mac.", code: "offline")
            }
            let out = (try? JSON.decode(data)) ?? .null
            if status != 200 { throw AIError(message: out["error"]?.string ?? "Mac bridge error \(status)") }
            let calls = (out["tool_calls"]?.array ?? []).filter { names.contains($0["name"]?.string ?? "") }
            let reply = out["reply"]?.string ?? ""
            if !reply.isEmpty { text += (text.isEmpty ? "" : "\n\n") + reply; cb.onText(text) }
            history.append(.object(["role": "assistant", "text": .string(reply), "calls": .array(calls)]))
            if calls.isEmpty { break }
            var results: [JSON] = []
            for c in calls {
                let name = c["name"]?.string ?? ""
                let r = await runTool(s, name, c["args"]?.object ?? [:], cb)
                results.append(.object(["tool": .string(name), "result": r]))
            }
            history.append(.object(["role": "tool", "text": .string(String(data: (try? JSON.array(results).encoded()) ?? Data(), encoding: .utf8) ?? "[]")]))
        }
        cb.onStatus("")
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
