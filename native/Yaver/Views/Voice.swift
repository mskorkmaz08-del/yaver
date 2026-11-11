// Voice chat (native twin of js/ai/voice.js and the voice parts of assistant.js):
// listen with Apple's speech recognition, send the words to Yaver, and read each
// reply aloud a sentence or two at a time while it is still being written. Replies
// use the device voice (British male first, like the web app) or Gemini's voice.
import Foundation
import AVFoundation
import Speech

enum VoiceText {
    static let geminiVoices = [("Charon", "Charon · male, calm"), ("Orus", "Orus · male, firm"), ("Iapetus", "Iapetus · male, clear"), ("Puck", "Puck · male, upbeat"),
                               ("Fenrir", "Fenrir · male, lively"), ("Kore", "Kore · female, firm"), ("Sulafat", "Sulafat · female, warm"), ("Aoede", "Aoede · female, light")]
    static let languages = [("tr-TR", "Türkçe"), ("en-US", "English (US)"), ("en-GB", "English (UK)"), ("ru-RU", "Русский"), ("kk-KZ", "Қазақша")]

    /// Markdown and code read badly; strip them before speaking.
    static func clean(_ t: String) -> String {
        var s = t.replacingOccurrences(of: "```[\\s\\S]*?```", with: " (code on screen) ", options: .regularExpression)
        s = s.replacingOccurrences(of: "`([^`]*)`", with: "$1", options: .regularExpression)
        s = s.replacingOccurrences(of: "\\[([^\\]]+)\\]\\([^)]+\\)", with: "$1", options: .regularExpression)
        s = s.replacingOccurrences(of: "[*_#>|]", with: "", options: .regularExpression)
        s = s.replacingOccurrences(of: "(?m)^\\s*[-•]\\s+", with: "", options: .regularExpression)
        return s
    }

    /// The first sentence alone (so speech starts fast), then up to ~260 characters per piece.
    static func chunks(_ text: String, firstAlone: Bool = true) -> [String] {
        let ns = text as NSString
        let re = try! NSRegularExpression(pattern: "[^.!?…]+(?:[.!?…]+|$)\\s*")
        var sentences = re.matches(in: text, range: NSRange(location: 0, length: ns.length)).map { ns.substring(with: $0.range).trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        if sentences.isEmpty { sentences = [text] }
        var out: [String] = []
        for s in sentences {
            if (out.count > 1 || (!out.isEmpty && !firstAlone)) && (out[out.count - 1] + " " + s).count <= 260 { out[out.count - 1] += " " + s }
            else if out.count == 1 && out[0].count < 12 { out[0] += " " + s }
            else { out.append(s) }
        }
        return out
    }

    static func prompt(_ asked: String, jarvis: Bool) -> String {
        asked + "\n\n(Voice chat: this reply is read aloud. Answer in a few short spoken sentences, no markdown, lists, tables or code unless I ask."
            + (jarvis ? " Speak like JARVIS: calm, precise and understated, British English, a touch of dry wit, now and then address me as \"sir\". No American filler like \"Great question\" or \"Awesome\"." : "") + ")"
    }
}

/// Gemini text-to-speech: raw 16-bit PCM wrapped as WAV for AVAudioPlayer.
enum GeminiVoice {
    private static var models: [String]?
    static var pausedUntil = Date.distantPast

    static func available(_ s: Store) -> Bool { (s.setting("voiceStyle")?.string ?? "device") == "natural" && !Gemini.key(s).isEmpty && Date() > pausedUntil }

    private static func ttsModels(_ key: String) async -> [String] {
        if let models { return models }
        var req = URLRequest(url: URL(string: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200")!)
        req.setValue(key, forHTTPHeaderField: "x-goog-api-key")
        var names: [String] = []
        if let (d, r) = try? await URLSession.shared.data(for: req), (r as? HTTPURLResponse)?.statusCode == 200, let j = JSON.decode(d) {
            names = (j["models"]?.array ?? []).compactMap { $0["name"]?.string?.replacingOccurrences(of: "models/", with: "") }.filter { $0.contains("tts") }
        }
        func ver(_ n: String) -> Double { Double(n.range(of: "gemini-([\\d.]+)", options: .regularExpression).map { String(n[$0].dropFirst(7)) } ?? "0") ?? 0 }
        func rank(_ n: String) -> Double { (n.contains("preview") || n.contains("exp") ? 2 : 0) + (n.contains("pro") ? 1 : 0) + (n.contains("lite") ? -0.5 : 0) }
        names.sort { rank($0) != rank($1) ? rank($0) < rank($1) : ver($0) != ver($1) ? ver($0) > ver($1) : $0.count < $1.count }
        let m = names.isEmpty ? ["gemini-2.5-flash-preview-tts"] : names
        models = m
        return m
    }

    static func synth(_ s: Store, _ text: String) async throws -> Data {
        let key = Gemini.key(s)
        let voice = s.setting("ttsVoice")?.string ?? "Charon"
        for model in await ttsModels(key).prefix(3) {
            var req = URLRequest(url: URL(string: "https://generativelanguage.googleapis.com/v1beta/models/\(model):generateContent")!)
            req.httpMethod = "POST"; req.timeoutInterval = 30
            req.setValue(key, forHTTPHeaderField: "x-goog-api-key"); req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let part: JSON = .object(["text": .string(text)])
            let contents: JSON = .array([.object(["role": "user", "parts": .array([part])])])
            let speech: JSON = .object(["voiceConfig": .object(["prebuiltVoiceConfig": .object(["voiceName": .string(voice)])])])
            let body: JSON = .object(["contents": contents, "generationConfig": .object(["responseModalities": .array(["AUDIO"]), "speechConfig": speech])])
            req.httpBody = body.encoded()
            guard let (d, r) = try? await URLSession.shared.data(for: req) else { continue }
            let code = (r as? HTTPURLResponse)?.statusCode ?? 0
            if code != 200 { if [400, 403, 404, 429].contains(code) { models?.removeAll { $0 == model } }; continue }
            guard let j = JSON.decode(d),
                  let part = j["candidates"]?.array?.first?["content"]?["parts"]?.array?.first(where: { $0["inlineData"] != nil })?["inlineData"],
                  let b64 = part["data"]?.string, let pcm = Data(base64Encoded: b64) else { continue }
            let mime = part["mimeType"]?.string ?? ""
            let rate = Int(mime.range(of: "rate=(\\d+)", options: .regularExpression).map { String(mime[$0].dropFirst(5)) } ?? "24000") ?? 24000
            return wav(pcm, rate: rate)
        }
        pausedUntil = Date().addingTimeInterval(600) // all failed: device voice for 10 minutes
        throw AIError(message: "Gemini voice unavailable")
    }

    static func wav(_ pcm: Data, rate: Int) -> Data {
        var d = Data()
        func u32(_ v: Int) { var x = UInt32(v).littleEndian; d.append(Data(bytes: &x, count: 4)) }
        func u16(_ v: Int) { var x = UInt16(v).littleEndian; d.append(Data(bytes: &x, count: 2)) }
        d.append("RIFF".data(using: .ascii)!); u32(36 + pcm.count); d.append("WAVEfmt ".data(using: .ascii)!)
        u32(16); u16(1); u16(1); u32(rate); u32(rate * 2); u16(2); u16(16)
        d.append("data".data(using: .ascii)!); u32(pcm.count); d.append(pcm)
        return d
    }
}

@MainActor
final class VoiceChat: NSObject, ObservableObject, AVSpeechSynthesizerDelegate, AVAudioPlayerDelegate {
    static let shared = VoiceChat()
    /// "" | listening | thinking | voicing | speaking
    @Published var state = ""
    @Published var on = false
    @Published var heard = ""

    private let synth = AVSpeechSynthesizer()
    private var player: AVAudioPlayer?
    private var queue: [Task<(text: String, wav: Data?), Never>] = []
    private var running = false, closed = false
    private var said = 0
    private var finishOne: CheckedContinuation<Void, Never>?

    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var recTask: SFSpeechRecognitionTask?
    private var quiet: Task<Void, Never>?
    private weak var store: Store?

    override init() { super.init(); synth.delegate = self }

    var speaking: Bool { running || synth.isSpeaking || player?.isPlaying == true }

    func toggle(_ s: Store) { on ? end() : start(s) }
    func start(_ s: Store) { store = s; on = true; listen(s) }
    func end() { on = false; stopListening(); hush(); state = "" }

    // MARK: listening

    func listen(_ s: Store) {
        store = s
        guard recTask == nil, !ChatModel.shared.busy else { return }
        hush()
        Task {
            guard await Self.permissions() else {
                ChatModel.shared.notice("Yaver needs the microphone and speech recognition. Allow them in Settings → Privacy, then try again.")
                end(); return
            }
            beginRecognition(s)
        }
    }

    static func permissions() async -> Bool {
        let speech = await withCheckedContinuation { c in SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0 == .authorized) } }
        guard speech else { return false }
        #if os(iOS)
        return await withCheckedContinuation { c in AVAudioSession.sharedInstance().requestRecordPermission { c.resume(returning: $0) } }
        #else
        return await AVCaptureDevice.requestAccess(for: .audio)
        #endif
    }

    private func beginRecognition(_ s: Store) {
        let lang = s.setting("voiceLang")?.string ?? Locale.preferredLanguages.first ?? "en-US"
        guard let rec = SFSpeechRecognizer(locale: Locale(identifier: lang)) ?? SFSpeechRecognizer(), rec.isAvailable else {
            ChatModel.shared.notice("Speech recognition is not available right now. Type instead; replies are still read aloud.")
            state = ""; return
        }
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .spokenAudio, options: [.defaultToSpeaker, .allowBluetooth, .duckOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        #endif
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if rec.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
        request = req
        heard = ""
        let input = engine.inputNode
        let fmt = input.outputFormat(forBus: 0)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: fmt) { [weak req] buf, _ in req?.append(buf) }
        engine.prepare()
        do { try engine.start() } catch { ChatModel.shared.notice("The microphone could not start."); state = ""; return }
        state = "listening"
        recTask = rec.recognitionTask(with: req) { [weak self] result, error in
            Task { @MainActor in
                guard let self else { return }
                if let result {
                    self.heard = result.bestTranscription.formattedString
                    // Stop after 0.8 s without new words, like the web app.
                    self.quiet?.cancel()
                    self.quiet = Task { try? await Task.sleep(nanoseconds: 800_000_000); if !Task.isCancelled { self.request?.endAudio() } }
                    if result.isFinal { self.finishListening() }
                } else if error != nil { self.finishListening() }
            }
        }
    }

    private func finishListening() {
        guard recTask != nil else { return }
        stopListening()
        let text = heard.trimmingCharacters(in: .whitespacesAndNewlines)
        heard = ""
        if !text.isEmpty, let s = store { ChatModel.shared.send(s, text, voice: on) } else { state = "" }
    }

    func stopListening() {
        quiet?.cancel()
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        recTask?.cancel()
        recTask = nil; request = nil
        if state == "listening" { state = "" }
    }

    // MARK: speaking

    /// Called with the reply so far; speaks finished sentences as they arrive.
    func feed(_ s: Store, _ t: String, final: Bool) {
        let chars = Array(t)
        guard chars.count >= said else { return }
        let rest = String(chars[said...])
        if final {
            let first = said == 0
            said = chars.count
            for c in VoiceText.chunks(VoiceText.clean(rest), firstAlone: first) { say(s, c) }
            closed = true
            if !running && queue.isEmpty { done() }
            return
        }
        guard let m = rest.range(of: "^[\\s\\S]*?[.!?…](?=\\s)", options: .regularExpression) else { return }
        if said == 0 && rest.distance(from: rest.startIndex, to: m.upperBound) < 12 { return }
        var piece = String(rest[m])
        if said > 0 {
            guard let full = rest.range(of: "^[\\s\\S]*[.!?…](?=\\s)", options: .regularExpression) else { return }
            piece = String(rest[full])
            if piece.count < 140 { return }
        }
        let firstAlone = said == 0
        said += piece.count
        for c in VoiceText.chunks(VoiceText.clean(piece), firstAlone: firstAlone) { say(s, c) }
    }

    /// The reply is complete: listen again once speaking ends (or now, if nothing is spoken).
    func afterReply() { if !running && queue.isEmpty && closed { done() } else if !running && queue.isEmpty && state == "thinking" { state = "" } }

    func beginReply() { hush(); said = 0; closed = false; state = "thinking" }
    func replyFailed() { hush(); if !speaking { state = "" } }

    private func say(_ s: Store, _ text: String) {
        let natural = GeminiVoice.available(s)
        queue.append(Task { @MainActor in
            if natural, let d = try? await GeminiVoice.synth(s, text) { return (text, d) }
            return (text, nil)
        })
        if state != "speaking" { state = "voicing" }
        pump(s)
    }

    private func pump(_ s: Store) {
        guard !running else { return }
        running = true
        Task { @MainActor in
            #if os(iOS)
            try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
            try? AVAudioSession.sharedInstance().setActive(true)
            #endif
            while !queue.isEmpty {
                let item = await queue.removeFirst().value
                if !running { break }
                state = "speaking"
                await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
                    finishOne = c
                    if let wav = item.wav, let p = try? AVAudioPlayer(data: wav) {
                        player = p; p.delegate = self; p.play()
                    } else {
                        speakDevice(s, item.text)
                    }
                }
            }
            let wasRunning = running
            running = false
            if wasRunning && closed { done() }
        }
    }

    private func done() {
        guard !running else { return }
        if ChatModel.shared.busy { return }
        state = ""
        if on, let s = store, s.setting("voiceAuto")?.bool ?? true {
            Task { try? await Task.sleep(nanoseconds: 350_000_000); if on && !ChatModel.shared.busy && !speaking { listen(s) } }
        }
    }

    func hush() {
        queue.forEach { $0.cancel() }
        queue = []
        running = false
        player?.stop(); player = nil
        if synth.isSpeaking { synth.stopSpeaking(at: .immediate) }
        let c = finishOne; finishOne = nil; c?.resume()
    }

    private func speakDevice(_ s: Store, _ text: String) {
        let pref = s.setting("voiceLang")?.string ?? "en-US"
        let lang = text.range(of: "[çğıöşüÇĞİÖŞÜ]", options: .regularExpression) != nil ? "tr-TR"
            : text.range(of: "[а-яёА-ЯЁ]", options: .regularExpression) != nil ? (pref.hasPrefix("kk") ? "kk-KZ" : "ru-RU") : "en-GB"
        let u = AVSpeechUtterance(string: text)
        u.voice = Self.pickVoice(s, lang)
        let jarvis = s.setting("jarvis")?.bool ?? true
        u.rate = AVSpeechUtteranceDefaultSpeechRate * (jarvis ? 1.0 : 1.05)
        u.pitchMultiplier = jarvis ? 0.9 : 1
        synth.speak(u)
    }

    // Jarvis-like first: British male voices, premium/enhanced before the basic ones.
    static let britishMale = ["arthur", "daniel", "oliver", "malcolm", "jamie", "george", "ryan", "thomas"]
    static func quality(_ v: AVSpeechSynthesisVoice) -> Int { v.quality == .premium ? 0 : v.quality == .enhanced ? 1 : 2 }
    static func deviceVoices() -> [AVSpeechSynthesisVoice] {
        AVSpeechSynthesisVoice.speechVoices().filter { $0.language.hasPrefix("en") || $0.language.hasPrefix("tr") }
            .sorted { $0.language != $1.language ? $0.language < $1.language : quality($0) != quality($1) ? quality($0) < quality($1) : $0.name < $1.name }
    }
    static func pickVoice(_ s: Store, _ lang: String) -> AVSpeechSynthesisVoice? {
        let all = AVSpeechSynthesisVoice.speechVoices()
        let two = String(lang.prefix(2)).lowercased()
        if two == "en" {
            if let id = s.setting("deviceVoice")?.string, !id.isEmpty, let v = all.first(where: { $0.identifier == id }) { return v }
            func male(_ v: AVSpeechSynthesisVoice) -> Int { britishMale.firstIndex { v.name.lowercased().contains($0) } ?? -1 }
            let gb = all.filter { $0.language == "en-GB" && male($0) >= 0 }.sorted { quality($0) != quality($1) ? quality($0) < quality($1) : male($0) < male($1) }
            if let v = gb.first { return v }
        }
        let same = all.filter { $0.language.lowercased().hasPrefix(two) }.sorted { quality($0) < quality($1) }
        return same.first { $0.language == "en-GB" } ?? same.first ?? AVSpeechSynthesisVoice(language: lang)
    }

    /// "Hear this voice" in Settings.
    func tryVoice(_ s: Store) async throws {
        hush()
        let line = "Good evening. Your study streak is intact, and the kettle, I'm told, is on."
        if (s.setting("voiceStyle")?.string ?? "device") == "natural" {
            let d = try await GeminiVoice.synth(s, line)
            player = try AVAudioPlayer(data: d); player?.play()
        } else { speakDevice(s, line) }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) { Task { @MainActor in self.finishedOne() } }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) { Task { @MainActor in self.finishedOne() } }
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) { Task { @MainActor in self.finishedOne() } }
    private func finishedOne() { let c = finishOne; finishOne = nil; c?.resume() }
}
