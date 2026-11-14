// Gemini requests for food photos, typed meals and food tips (twin of ask() in
// js/foodscan.js and flashModels() in js/ai/gemini.js): the free Flash models, a time
// limit per try, low thinking, and when a model is busy (429/5xx) the next one takes
// over: the one that worked last time, the chat model, other Flash models, Flash Lite.
import Foundation

struct GeminiError: LocalizedError {
    let message: String
    var code = ""
    var errorDescription: String? { message }
}

enum Gemini {
    static let api = "https://generativelanguage.googleapis.com/v1beta"
    static let busy: Set<Int> = [429, 500, 502, 503, 504]

    static func key(_ s: Store) -> String { (s.setting("geminiKey")?.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }

    /// Flash models this key can use, best first (cached for a day, like the web app).
    static func flashModels(_ s: Store) async -> [String] {
        if let c = s.setting("foodModels")?.object, let list = c["list"]?.array?.compactMap({ $0.string }), !list.isEmpty,
           Date().timeIntervalSince1970 * 1000 - (c["at"]?.double ?? 0) < 86_400_000 { return list }
        var names: [String] = []
        var req = URLRequest(url: URL(string: "\(api)/models?pageSize=200")!, timeoutInterval: 8)
        req.setValue(key(s), forHTTPHeaderField: "x-goog-api-key")
        if let (data, res) = try? await URLSession.shared.data(for: req), (res as? HTTPURLResponse)?.statusCode == 200,
           let j = try? JSON.decode(data) {
            names = (j["models"]?.array ?? []).compactMap { m -> String? in
                guard (m["supportedGenerationMethods"]?.array ?? []).contains(where: { $0.string == "generateContent" }),
                      let n = m["name"]?.string?.replacingOccurrences(of: "models/", with: "") else { return nil }
                guard n.range(of: #"^gemini-[\d.]+-flash"#, options: .regularExpression) != nil,
                      n.range(of: "(image|tts|live|audio|thinking-exp|embedding)", options: .regularExpression) == nil else { return nil }
                return n
            }
        }
        func ver(_ n: String) -> Double { Double(n.replacingOccurrences(of: #"^gemini-([\d.]+).*$"#, with: "$1", options: .regularExpression)) ?? 0 }
        func lite(_ n: String) -> Int { n.contains("lite") ? 1 : 0 }
        func pre(_ n: String) -> Int { n.range(of: "preview|exp", options: .regularExpression) != nil ? 1 : 0 }
        names.sort { a, b in
            if lite(a) != lite(b) { return lite(a) < lite(b) }
            if pre(a) != pre(b) { return pre(a) < pre(b) }
            if ver(a) != ver(b) { return ver(a) > ver(b) }
            return a.count < b.count
        }
        let list = names.isEmpty ? ["gemini-2.5-flash", "gemini-2.5-flash-lite"] : names
        s.setSetting("foodModels", .object(["at": .number(Date().timeIntervalSince1970 * 1000), "list": .array(list.map { .string($0) })]))
        return list
    }

    static func thinking(_ model: String) -> [String: JSON] {
        if model.hasPrefix("gemini-2.5-flash-lite") { return [:] }
        if model.hasPrefix("gemini-2.5-flash") { return ["thinkingConfig": .object(["thinkingBudget": 0])] }
        if model.range(of: #"^gemini-[3-9]"#, options: .regularExpression) != nil { return ["thinkingConfig": .object(["thinkingLevel": "low"])] }
        return [:]
    }

    /// One request with the busy-model fallback. Returns the raw answer and the model that gave it.
    @MainActor
    static func ask(_ s: Store, parts: [JSON], config: [String: JSON] = [:], tools: [JSON]? = nil, timeout: TimeInterval = 30,
                    label: String = "Gemini", onStatus: ((String) -> Void)? = nil) async throws -> (out: JSON, model: String) {
        let k = key(s)
        if k.isEmpty { throw GeminiError(message: "This uses Gemini (free). Paste your Gemini key in Settings → AI first.", code: "nokey") }
        let all = await flashModels(s)
        var order: [String] = []
        var cands: [String] = [s.setting("foodModel")?.string ?? "", s.setting("geminiModel")?.string ?? ""]
        cands += Array(all.filter { !$0.contains("lite") }.prefix(2))
        cands += all.filter { $0.contains("lite") }
        for m in cands where !m.isEmpty && !order.contains(m) { order.append(m) }
        order = Array(order.prefix(4))
        var lastError = ""
        for (i, model) in order.enumerated() {
            if i > 0 { onStatus?("\(label) is busy. Trying \(model.replacingOccurrences(of: "gemini-", with: ""))…") }
            for think in [true, false] {
                var gen: [String: JSON] = ["temperature": 0.2]
                for (a, b) in config { gen[a] = b }
                if think { for (a, b) in thinking(model) { gen[a] = b } }
                var body: [String: JSON] = ["contents": .array([.object(["role": "user", "parts": .array(parts)])]), "generationConfig": .object(gen)]
                if let tools { body["tools"] = .array(tools) }
                var req = URLRequest(url: URL(string: "\(api)/models/\(model):generateContent")!, timeoutInterval: timeout)
                req.httpMethod = "POST"
                req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                req.setValue(k, forHTTPHeaderField: "x-goog-api-key")
                req.httpBody = try JSON.object(body).encoded()
                let data: Data, status: Int
                do {
                    let (d, r) = try await URLSession.shared.data(for: req)
                    data = d; status = (r as? HTTPURLResponse)?.statusCode ?? 0
                } catch {
                    if Task.isCancelled { throw CancellationError() }
                    let e = error as NSError
                    if e.code == NSURLErrorNotConnectedToInternet { throw GeminiError(message: "You are offline. Log it by hand, or try again when you are back online.") }
                    lastError = e.code == NSURLErrorTimedOut ? "timeout" : "network"
                    break
                }
                if status == 200, let out = try? JSON.decode(data) {
                    if s.setting("foodModel")?.string != model { s.setSetting("foodModel", .string(model)) }
                    return (out, model)
                }
                let msg = (try? JSON.decode(data))?["error"]?["message"]?.string ?? ""
                if status == 400 && think && msg.range(of: "think", options: .caseInsensitive) != nil { continue }
                if status == 400 && msg.range(of: "api key", options: .caseInsensitive) != nil { throw GeminiError(message: "Google says the Gemini key is not valid. Paste it again in Settings → AI.") }
                if status == 403 { throw GeminiError(message: "Google refused the Gemini key: \(msg.isEmpty ? "permission denied" : msg).") }
                lastError = busy.contains(status) ? "busy" : status == 404 ? "missing" : (msg.isEmpty ? "error \(status)" : msg)
                if status == 404 && s.setting("foodModel")?.string == model { s.setSetting("foodModel", "") }
                break
            }
        }
        if lastError == "busy" || lastError == "timeout" { throw GeminiError(message: "Gemini is overloaded right now (on Google's side) and every free model was busy. Try again in a minute, or log the meal by hand.") }
        if lastError == "network" { throw GeminiError(message: "Could not reach Gemini. Check your connection.") }
        throw GeminiError(message: "Gemini could not do it (\(lastError)).")
    }

    static func text(_ out: JSON) -> String {
        (out["candidates"]?.array?.first?["content"]?["parts"]?.array ?? []).filter { $0["thought"]?.bool != true }.compactMap { $0["text"]?.string }.joined()
    }
    static func json(_ out: JSON) -> JSON? {
        let t = text(out).replacingOccurrences(of: #"^```(json)?|```$"#, with: "", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
        return try? JSON.decode(Data(t.utf8))
    }
    /// Web pages Google Search used, for the "Looked up" line.
    static func sources(_ out: JSON) -> [[String: String]] {
        var seen = Set<String>(), list: [[String: String]] = []
        for c in out["candidates"]?.array?.first?["groundingMetadata"]?["groundingChunks"]?.array ?? [] {
            guard let w = c["web"], let uri = w["uri"]?.string else { continue }
            let title = w["title"]?.string ?? uri
            if seen.contains(title) { continue }
            seen.insert(title)
            let t = title.replacingOccurrences(of: #"^www\."#, with: "", options: .regularExpression)
            list.append(["title": t.isEmpty ? "source" : t, "uri": uri])
        }
        return Array(list.prefix(6))
    }
}
