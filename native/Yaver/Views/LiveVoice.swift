// Live voice (twin of js/ai/live.js): a real-time conversation with Gemini's Live API
// over a WebSocket. The microphone streams straight to the model and its own voice
// streams back, with no speech-to-text and text-to-speech steps in between, so it
// answers in about a second and you can talk over it. Yaver's tools still work: the
// model asks for a tool call, the device runs it and sends the result back; hard
// questions go to Claude on the Mac through ask_claude when the bridge is set up.
import Foundation
import AVFoundation

@MainActor
final class LiveVoice {
    static let shared = LiveVoice()

    struct Callbacks {
        /// connecting | reconnecting | live | thinking | speaking | claude | ended
        var onState: @MainActor (String) -> Void = { _ in }
        var onUser: @MainActor (String) -> Void = { _ in }
        var onModel: @MainActor (String) -> Void = { _ in }
        var onAction: @MainActor (String) -> Void = { _ in }
        var onError: @MainActor (String, Bool) -> Void = { _, _ in }
        var onIdle: @MainActor () -> Void = {}
    }

    static let wsURL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
    static func available(_ s: Store) -> Bool { !Gemini.key(s).isEmpty }
    static func wanted(_ s: Store) -> Bool { (s.setting("voiceEngine")?.string ?? "live") == "live" && available(s) }

    private var cb = Callbacks()
    private weak var store: Store?
    private var ws: URLSessionWebSocketTask?
    private var gen = 0
    private(set) var active = false
    private var ready = false
    private var tuned = true
    private var retriedUntuned = false
    private var attempts = 0
    private var resumeHandle: String?
    private var early: [Data] = []
    private var userText = "", modelText = "", lastAsked = ""
    private var waiting = false
    private var stall: Task<Void, Never>?
    private var idle: Task<Void, Never>?
    private var speakingEnd: Task<Void, Never>?

    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let outFormat = AVAudioFormat(standardFormatWithSampleRate: 24000, channels: 1)!
    private var pending = 0
    private var epoch = 0

    // MARK: start and stop

    func start(_ s: Store, _ callbacks: Callbacks) async throws {
        stop(silent: true)
        store = s; cb = callbacks
        attempts = 0; resumeHandle = nil; tuned = true; retriedUntuned = false
        active = true
        cb.onState("connecting")
        try await startAudio()
        connect(resend: "")
    }

    func stop(silent: Bool = false) {
        guard active else { return }
        active = false
        closeSocket()
        idle?.cancel(); speakingEnd?.cancel()
        stopPlayback()
        engine.inputNode.removeTap(onBus: 0)
        if engine.isRunning { engine.stop() }
        if !silent { cb.onState("ended") }
    }

    /// Stops the model's voice (a tap on the orb while it speaks).
    func interrupt() { stopPlayback(); cb.onState("live") }

    // MARK: audio

    private static func micPermission() async -> Bool {
        #if os(iOS)
        return await withCheckedContinuation { c in AVAudioSession.sharedInstance().requestRecordPermission { c.resume(returning: $0) } }
        #else
        return await AVCaptureDevice.requestAccess(for: .audio)
        #endif
    }

    private func startAudio() async throws {
        guard await Self.micPermission() else {
            throw AIError(message: "Yaver needs the microphone for live voice. Allow it in Settings → Privacy → Microphone.")
        }
        #if os(iOS)
        let ses = AVAudioSession.sharedInstance()
        try? ses.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
        try? ses.setActive(true)
        #endif
        let input = engine.inputNode
        // Echo cancellation, so the model doesn't hear itself through the speaker.
        try? input.setVoiceProcessingEnabled(true)
        if player.engine == nil { engine.attach(player) }
        engine.connect(player, to: engine.mainMixerNode, format: outFormat)
        input.removeTap(onBus: 0)
        Self.installTap(input) { [weak self] chunk in
            Task { @MainActor in self?.mic(chunk) }
        }
        engine.prepare()
        do { try engine.start() } catch { throw AIError(message: "The microphone could not start.") }
        player.play()
    }

    /// Captures the mic at the device rate and hands out 16 kHz 16-bit PCM in ~40 ms chunks.
    private nonisolated static func installTap(_ input: AVAudioInputNode, _ sink: @escaping @Sendable (Data) -> Void) {
        let inFmt = input.outputFormat(forBus: 0)
        guard let target = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true),
              let conv = AVAudioConverter(from: inFmt, to: target) else { return }
        conv.downmix = true
        let box = TapBox()
        input.installTap(onBus: 0, bufferSize: 1024, format: inFmt) { buf, _ in
            let cap = AVAudioFrameCount(Double(buf.frameLength) * 16000 / max(1, inFmt.sampleRate)) + 32
            guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: cap) else { return }
            var fed = false
            var err: NSError?
            conv.convert(to: out, error: &err) { _, status in
                if fed { status.pointee = .noDataNow; return nil }
                fed = true
                status.pointee = .haveData
                return buf
            }
            guard err == nil, out.frameLength > 0, let p = out.int16ChannelData else { return }
            box.acc.append(Data(bytes: p[0], count: Int(out.frameLength) * 2))
            if box.acc.count >= 1280 { let chunk = box.acc; box.acc = Data(); sink(chunk) }
        }
    }
    private final class TapBox: @unchecked Sendable { var acc = Data() }

    private func mic(_ chunk: Data) {
        guard active else { return }
        if ready { send(audioMessage(chunk)); return }
        early.append(chunk)
        if early.count > 75 { early.removeFirst() } // keep about 3 s
    }

    private func audioMessage(_ d: Data) -> JSON {
        .object(["realtimeInput": .object(["audio": .object(["data": .string(d.base64EncodedString()), "mimeType": "audio/pcm;rate=16000"])])])
    }

    /// Model audio: 24 kHz 16-bit PCM pieces, played back to back.
    private func play(_ b64: String) {
        guard let d = Data(base64Encoded: b64), d.count >= 2 else { return }
        let n = d.count / 2
        guard let buf = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: AVAudioFrameCount(n)), let ch = buf.floatChannelData?[0] else { return }
        buf.frameLength = AVAudioFrameCount(n)
        d.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
            for i in 0..<n {
                let v = Int16(bitPattern: UInt16(raw[2 * i]) | UInt16(raw[2 * i + 1]) << 8)
                ch[i] = Float(v) / 32768
            }
        }
        pending += 1
        speakingEnd?.cancel()
        let e = epoch
        Self.schedule(player, buf) { [weak self] in Task { @MainActor in self?.played(e) } }
        if !player.isPlaying { player.play() }
        cb.onState("speaking")
    }
    private nonisolated static func schedule(_ p: AVAudioPlayerNode, _ b: AVAudioPCMBuffer, _ done: @escaping @Sendable () -> Void) {
        p.scheduleBuffer(b, completionHandler: done)
    }
    private func played(_ e: Int) {
        guard e == epoch else { return }
        pending = max(0, pending - 1)
        guard pending == 0, active else { return }
        speakingEnd = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 150_000_000)
            if !Task.isCancelled, self.pending == 0, self.active { self.cb.onState("live") }
        }
    }
    private func stopPlayback() {
        epoch += 1
        pending = 0
        player.stop()
        if engine.isRunning { player.play() }
    }

    // MARK: the connection

    private func send(_ j: JSON) {
        guard let ws, let d = try? j.encoded(), let t = String(data: d, encoding: .utf8) else { return }
        ws.send(.string(t)) { _ in }
    }

    private func connect(resend: String) {
        guard let s = store, active else { return }
        gen += 1
        let g = gen
        ready = false
        Task { @MainActor in
            let model = await Self.pickModel(s)
            guard g == self.gen, self.active else { return }
            var comps = URLComponents(string: Self.wsURL)!
            comps.queryItems = [URLQueryItem(name: "key", value: Gemini.key(s))]
            let task = URLSession.shared.webSocketTask(with: comps.url!)
            task.maximumMessageSize = 16 << 20
            self.ws = task
            task.resume()
            self.send(self.setupMessage(s, model: model))
            self.receive(task, g, model: model, resend: resend)
        }
    }

    private func closeSocket() {
        gen += 1
        ready = false
        disarm()
        ws?.cancel(with: .normalClosure, reason: nil)
        ws = nil
    }

    private func receive(_ task: URLSessionWebSocketTask, _ g: Int, model: String, resend: String) {
        Task { @MainActor in
            while g == self.gen {
                let msg: URLSessionWebSocketTask.Message
                do { msg = try await task.receive() } catch {
                    if g == self.gen { self.dropped(task) }
                    return
                }
                let data: Data
                switch msg {
                case .data(let d): data = d
                case .string(let t): data = Data(t.utf8)
                @unknown default: continue
                }
                guard let m = try? JSON.decode(data) else { continue }
                await self.handle(m, g, model: model, resend: resend)
            }
        }
    }

    private func handle(_ m: JSON, _ g: Int, model: String, resend: String) async {
        guard let s = store, g == gen else { return }
        if m["setupComplete"] != nil {
            ready = true
            s.setSetting("liveModel", .string(model)) // skip the model lookup next time
            for d in early { send(audioMessage(d)) }
            early = []
            cb.onState("live")
            bumpIdle()
            // After a reconnect, repeat what you said so the answer still comes.
            if !resend.isEmpty {
                send(.object(["clientContent": .object(["turns": .array([.object(["role": "user", "parts": .array([.object(["text": .string(resend)])])])]), "turnComplete": true])]))
                cb.onState("thinking")
                arm()
            }
            return
        }
        if let u = m["sessionResumptionUpdate"], u["resumable"]?.bool == true, let h = u["newHandle"]?.string, !h.isEmpty { resumeHandle = h }
        if m["goAway"] != nil { reconnect(""); return }
        if let calls = m["toolCall"]?["functionCalls"]?.array {
            disarm()
            var responses: [JSON] = []
            for fc in calls {
                let name = fc["name"]?.string ?? ""
                let args = fc["args"]?.object ?? [:]
                if name == "ask_claude" {
                    cb.onState("claude")
                    let r = await askClaude(s, args["question"]?.string ?? userText)
                    responses.append(.object(["id": fc["id"] ?? .null, "name": .string(name), "response": r]))
                    continue
                }
                let out = await Tools.run(s, name, args)
                if AssistantDefs.writeTools.contains(name), out["error"] == nil, let label = Tools.describe(name, args) { cb.onAction(label) }
                let resp: JSON = out["error"] != nil ? .object(["error": out["error"]!]) : .object(["result": out.isNull ? .object(["ok": true]) : out])
                responses.append(.object(["id": fc["id"] ?? .null, "name": .string(name), "response": resp]))
            }
            guard g == gen else { return }
            send(.object(["toolResponse": .object(["functionResponses": .array(responses)])]))
            arm() // the spoken answer should follow the tool result
            return
        }
        guard let sc = m["serverContent"] else { return }
        let interrupted = sc["interrupted"]?.bool == true
        if interrupted { stopPlayback(); cb.onState("live") }
        // While you talk, keep pushing the stall check back; it fires only after you stop.
        if let t = sc["inputTranscription"]?["text"]?.string, !t.isEmpty {
            userText += t
            lastAsked = userText.trimmingCharacters(in: .whitespacesAndNewlines)
            bumpIdle()
            if pending == 0 { arm() }
        }
        if let t = sc["outputTranscription"]?["text"]?.string, !t.isEmpty { modelText += t; disarm() }
        for p in sc["modelTurn"]?["parts"]?.array ?? [] {
            if let d = p["inlineData"]?["data"]?.string { disarm(); play(d) }
        }
        let complete = sc["turnComplete"]?.bool == true
        if complete { disarm(); attempts = 0 }
        if complete || interrupted {
            let u = userText.trimmingCharacters(in: .whitespacesAndNewlines), b = modelText.trimmingCharacters(in: .whitespacesAndNewlines)
            if !u.isEmpty { cb.onUser(u) }
            if !b.isEmpty { cb.onModel(b) }
            userText = ""; modelText = ""
        }
    }

    /// The socket closed without us closing it.
    private func dropped(_ task: URLSessionWebSocketTask) {
        guard active else { return }
        if !ready {
            // Retry once without the turn-taking tweak, and with a fresh model lookup.
            if !retriedUntuned {
                retriedUntuned = true
                tuned = false
                store?.setSetting("liveModel", "")
                connect(resend: "")
                return
            }
            let why = task.closeReason.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            stop()
            cb.onError("Live voice could not start\(why.isEmpty ? "" : ": \(why)").", true)
            return
        }
        // An unexpected drop mid-conversation: reconnect quietly instead of ending.
        reconnect(waiting ? lastAsked : "")
    }

    /// A fresh connection that resumes this conversation and, if you were waiting, asks again.
    private func reconnect(_ again: String) {
        guard active else { return }
        closeSocket()
        stopPlayback()
        if attempts >= 2 {
            stop()
            cb.onError("Gemini is not answering right now. Try again in a moment.", true)
            return
        }
        attempts += 1
        cb.onState("reconnecting")
        connect(resend: again)
    }

    // If the model hasn't started answering 7 s after you stopped talking, reconnect and ask again.
    private func arm() {
        disarm()
        waiting = true
        let g = gen
        stall = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 7_000_000_000)
            if !Task.isCancelled, g == self.gen, self.active { self.reconnect(self.lastAsked) }
        }
    }
    private func disarm() { stall?.cancel(); stall = nil; waiting = false }

    /// Ends the session after 90 s of quiet.
    private func bumpIdle() {
        idle?.cancel()
        idle = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 90_000_000_000)
            if !Task.isCancelled, self.active, self.pending == 0 { self.stop(); self.cb.onIdle() }
        }
    }

    // MARK: setup

    private func setupMessage(_ s: Store, model: String) -> JSON {
        var decls = AI.functionDeclarations()
        let mac = AI.macConfigured(s)
        if mac {
            decls.append(.object([
                "name": "ask_claude",
                "description": "Ask Claude on the user's Mac a hard question: deep explanations, code, plans, careful reasoning. Takes several seconds. Pass the full question with any context it needs.",
                "parameters": .object(["type": "OBJECT", "properties": .object(["question": .object(["type": "STRING", "description": "The question, self-contained."])]), "required": .array(["question"])]),
            ]))
        }
        var setup: [String: JSON] = [
            "model": .string("models/\(model)"),
            "generationConfig": .object(["responseModalities": .array(["AUDIO"]),
                                         "speechConfig": .object(["voiceConfig": .object(["prebuiltVoiceConfig": .object(["voiceName": .string(s.setting("ttsVoice")?.string ?? "Charon")])])])]),
            "systemInstruction": .object(["parts": .array([.object(["text": .string(systemText(s, mac: mac))])])]),
            "tools": .array([.object(["functionDeclarations": .array(decls)])]),
            "inputAudioTranscription": .object([:]),
            "outputAudioTranscription": .object([:]),
        ]
        if tuned {
            // Faster turn-taking, and resumable sessions that don't run out of context.
            setup["realtimeInputConfig"] = .object(["automaticActivityDetection": .object(["endOfSpeechSensitivity": "END_SENSITIVITY_HIGH", "silenceDurationMs": 500, "prefixPaddingMs": 100])])
            setup["sessionResumption"] = resumeHandle.map { .object(["handle": .string($0)]) } ?? .object([:])
            setup["contextWindowCompression"] = .object(["slidingWindow": .object([:])])
        }
        return .object(["setup": .object(setup)])
    }

    private func systemText(_ s: Store, mac: Bool) -> String {
        let jarvis = s.setting("jarvis")?.bool ?? true
        var t = "\(AssistantDefs.system)\n\nThis is a live voice conversation: you are heard, not read. Answer in a few short spoken sentences; no lists, markdown or code unless asked. Act on clear requests with your tools straight away and confirm in a few words."
        if jarvis { t += " Speak like JARVIS: calm, precise and understated, with a British accent and British English, a touch of dry wit; now and then address the user as \"sir\". No American filler." }
        t += "\nWeb search is not available here."
        if mac { t += " For hard questions (deep explanations, code, plans, anything needing careful reasoning) call ask_claude: it asks Claude on the user's Mac. First say a few words like \"Let me ask Claude\", then read the answer naturally." }
        return t + "\n\n" + AI.dynamicContext(s)
    }

    /// Models this key can use for live sessions, stable before preview.
    private static var liveModels: [String]?
    static func pickModel(_ s: Store) async -> String {
        if let m = s.setting("liveModel")?.string, !m.isEmpty { return m }
        if liveModels == nil {
            var req = URLRequest(url: URL(string: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200")!)
            req.setValue(Gemini.key(s), forHTTPHeaderField: "x-goog-api-key")
            var list: [String] = []
            if let (d, r) = try? await URLSession.shared.data(for: req), (r as? HTTPURLResponse)?.statusCode == 200, let j = try? JSON.decode(d) {
                list = (j["models"]?.array ?? [])
                    .filter { m in (m["supportedGenerationMethods"]?.array ?? []).contains { $0.string == "bidiGenerateContent" } }
                    .compactMap { $0["name"]?.string?.replacingOccurrences(of: "models/", with: "") }
            }
            func ver(_ n: String) -> Double {
                guard let r = n.range(of: "gemini-[0-9.]+", options: .regularExpression) else { return 0 }
                return Double(n[r].dropFirst(7).trimmingCharacters(in: CharacterSet(charactersIn: "."))) ?? 0
            }
            func preview(_ n: String) -> Int { n.range(of: "preview|exp", options: .regularExpression) != nil ? 1 : 0 }
            func native(_ n: String) -> Int { n.contains("native-audio") ? 1 : 0 }
            liveModels = list.sorted { a, b in
                if preview(a) != preview(b) { return preview(a) < preview(b) }
                if native(a) != native(b) { return native(a) > native(b) }
                return ver(a) > ver(b)
            }
        }
        return liveModels?.first ?? "gemini-3.8-live"
    }

    /// Claude on the Mac as a tool of the live voice: Gemini keeps talking, Claude thinks.
    private func askClaude(_ s: Store, _ question: String) async -> JSON {
        guard await AI.macOnline(s) else { return .object(["error": "Claude on the Mac is offline right now. Answer yourself and say so briefly."]) }
        var hist: [JSON] = [.object(["role": "user", "text": .string("\(question)\n\n(This answer will be read aloud in a voice conversation: a few short spoken sentences, no lists or code unless essential.)")])]
        do {
            let text = try await AI.runMac(s, &hist, TurnCallbacks())
            return .object(["answer": .string(text.isEmpty ? "(no answer)" : text)])
        } catch {
            return .object(["error": .string("Claude on the Mac failed: \((error as? AIError)?.message ?? error.localizedDescription)")])
        }
    }
}
