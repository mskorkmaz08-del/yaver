// The Yaver chat (native twin of js/ai/assistant.js): a floating button and sheet
// on the iPhone, a sidebar screen on the Mac. Same routes as the web app: Claude on
// the Mac when the bridge answers, else Gemini (free) or Claude (paid key).
import SwiftUI
import PhotosUI

struct ChatLine: Identifiable {
    let id = UUID()
    var role: String // user | bot
    var text: String
    var actions: [String] = []
    var via = ""
    var error = false
    var hadImage = false
}

@MainActor
final class ChatModel: ObservableObject {
    static let shared = ChatModel()
    @Published var lines: [ChatLine] = []
    @Published var busy = false
    @Published var status = ""
    @Published var open = false
    private var task: Task<Void, Never>?
    private var api: [JSON] = [], gapi: [JSON] = [], mapi: [JSON] = []
    private var loaded = false

    static let suggestions = ["What should I study today?", "Quiz me on what I studied this week", "Explain recursion with a small Python example",
                              "Log 45 min of algorithms and 3 problems", "Find a quiet cafe near me", "How much did I spend this week?"]

    func load(_ s: Store) {
        guard !loaded else { return }
        loaded = true
        let c = s.get("chats", "main") ?? [:]
        api = c["api"]?.array ?? []; gapi = c["gapi"]?.array ?? []; mapi = c["mapi"]?.array ?? []
        lines = (c["view"]?.array ?? []).map { v in
            ChatLine(role: v["role"]?.string ?? "bot", text: v["text"]?.string ?? "", actions: (v["actions"]?.array ?? []).compactMap { $0.string },
                     via: v["via"]?.string ?? "", error: v["error"]?.bool ?? false, hadImage: v["image"] != nil && v["image"]?.isNull == false)
        }
    }
    private func save(_ s: Store) {
        let view: [JSON] = lines.suffix(200).map { l in
            var o: [String: JSON] = ["role": .string(l.role), "text": .string(l.text), "actions": .array(l.actions.map { .string($0) })]
            if !l.via.isEmpty { o["via"] = .string(l.via) }
            if l.error { o["error"] = true }
            if l.hadImage { o["image"] = "photo" }
            return .object(o)
        }
        s.put("chats", ["id": "main", "api": .array(api), "gapi": .array(gapi), "mapi": .array(mapi), "view": .array(view)])
    }

    func newChat(_ s: Store) {
        guard !busy else { return }
        api = []; gapi = []; mapi = []; lines = []
        save(s)
    }

    func stop() { task?.cancel() }

    /// A plain note from Yaver in the chat (voice problems and the like).
    func notice(_ text: String) { lines.append(ChatLine(role: "bot", text: text, error: true)) }

    func send(_ s: Store, _ textIn: String, image: Data? = nil, voice: Bool = false) {
        let text = textIn.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !busy, !text.isEmpty || image != nil else { return }
        load(s)
        let asked = text.isEmpty ? "What do you see? If it is food, log it as a meal; if it is a receipt, log the expense." : text
        // In voice chat the answer is heard, not read: ask for short, plain sentences.
        let prompt = voice ? VoiceText.prompt(asked, jarvis: s.setting("jarvis")?.bool ?? true) : asked
        let talk = voice || (s.setting("speak")?.bool ?? false)
        let V = VoiceChat.shared
        if talk { V.beginReply() } else { V.hush() }
        lines.append(ChatLine(role: "user", text: text, hadImage: image != nil))
        lines.append(ChatLine(role: "bot", text: ""))
        let idx = lines.count - 1
        busy = true
        status = "Thinking…"
        task = Task { [weak self] in
            guard let self else { return }
            let cb = TurnCallbacks(
                onText: { t in self.lines[idx].text = t; if talk { V.feed(s, t, final: false) } },
                onAction: { a in self.lines[idx].actions.append(a) },
                onStatus: { t in self.status = t })
            var routes: [String] = []
            if image == nil {
                #if os(macOS)
                let tryMac = true
                #else
                let tryMac = AI.macConfigured(s)
                #endif
                if tryMac && (!voice || (s.setting("voiceMac")?.bool ?? false)) { self.status = "Checking your Mac…"; if await AI.macOnline(s) { routes.append("mac") } }
            }
            routes.append(AI.provider(s))
            routeLoop: for route in routes {
                do {
                    let out: String
                    switch route {
                    case "mac":
                        var h = self.mapi
                        h.append(.object(["role": "user", "text": .string(prompt)]))
                        out = try await AI.runMac(s, &h, cb)
                        self.mapi = h
                    case "gemini":
                        var h = self.gapi
                        h.append(AI.geminiUser(prompt, image: image))
                        out = try await AI.runGemini(s, &h, fast: voice, cb)
                        self.gapi = h
                    default:
                        var h = self.api
                        var content: [JSON] = []
                        if let image { content.append(.object(["type": "image", "source": .object(["type": "base64", "media_type": "image/jpeg", "data": .string(image.base64EncodedString())])])) }
                        content.append(.object(["type": "text", "text": .string(prompt)]))
                        h.append(.object(["role": "user", "content": .array(content)]))
                        out = try await AI.runClaude(s, &h, cb)
                        self.api = h
                    }
                    self.lines[idx].text = out.isEmpty ? (self.lines[idx].actions.isEmpty ? "…" : "Done.") : out
                    self.lines[idx].via = route
                    if talk { V.feed(s, self.lines[idx].text, final: true) }
                    break routeLoop
                } catch {
                    let e = error as? AIError
                    if route == "mac", e?.code == "offline", self.lines[idx].actions.isEmpty { self.lines[idx].text = ""; continue }
                    let aborted = e?.code == "abort" || Task.isCancelled
                    if talk { V.replyFailed() }
                    self.lines[idx].error = !aborted
                    self.lines[idx].text = aborted ? (self.lines[idx].text.isEmpty ? "Stopped." : self.lines[idx].text) : error.localizedDescription
                    break routeLoop
                }
            }
            for k in ["api", "gapi", "mapi"] {
                let n = k == "api" ? self.api.count : k == "gapi" ? self.gapi.count : self.mapi.count
                if n > 80 {
                    self.api = []; self.gapi = []; self.mapi = []
                    self.lines.append(ChatLine(role: "bot", text: "`context reset` Your data is kept; earlier messages in this chat are not."))
                    break
                }
            }
            self.busy = false
            self.status = ""
            if talk { V.afterReply() }
            self.save(s)
        }
    }
}

struct AssistantView: View {
    @EnvironmentObject var store: Store
    @ObservedObject var chat = ChatModel.shared
    @ObservedObject var voice = VoiceChat.shared
    var sheet = false
    @State private var input = ""
    @State private var photo: PhotosPickerItem?
    @State private var image: Data?
    @FocusState private var focused: Bool
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            log
            if voice.on { orb } else { inputBar }
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle("Yaver")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                Button { voice.toggle(store) } label: { Label("Voice chat", systemImage: voice.on ? "waveform.circle.fill" : "waveform") }
            }
            ToolbarItem(placement: .automatic) {
                Button { chat.newChat(store) } label: { Label("New chat", systemImage: "square.and.pencil") }.disabled(chat.busy)
            }
            #if os(iOS)
            if sheet { ToolbarItem(placement: .cancellationAction) { Button { dismiss() } label: { Image(systemName: "chevron.down") } } }
            #endif
        }
        .onAppear { chat.load(store) }
        .onDisappear { if !sheet || !chat.open { voice.end() } }
        .onChange(of: photo) { item in
            guard let item else { return }
            Task { if let d = try? await item.loadTransferable(type: Data.self) { image = shrinkJPEG(d) }; photo = nil }
        }
    }

    private var log: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    if chat.lines.isEmpty { empty }
                    ForEach(chat.lines) { l in bubble(l).id(l.id) }
                    if chat.busy && !chat.status.isEmpty {
                        HStack(spacing: 8) { ProgressView().controlSize(.small); Text(chat.status).font(.caption).foregroundStyle(Theme.dim) }.id("status")
                    }
                }
                .padding(16)
                .frame(maxWidth: 760)
                .frame(maxWidth: .infinity)
            }
            .onChange(of: chat.lines.last?.text) { _ in withAnimation { proxy.scrollTo(chat.lines.last?.id, anchor: .bottom) } }
            .onChange(of: chat.lines.count) { _ in proxy.scrollTo(chat.lines.last?.id, anchor: .bottom) }
            .onAppear { proxy.scrollTo(chat.lines.last?.id, anchor: .bottom) }
        }
    }

    private var empty: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Ask Yaver anything. It can read and change everything in the app: meals, money, meetings, study, the course, Çetele, teams and body.")
                .font(.callout).foregroundStyle(Theme.muted)
            if AI.provider(store) == "gemini" && Gemini.key(store).isEmpty && (store.setting("apiKey")?.string ?? "").isEmpty {
                Text("First paste a Gemini key (free) in Settings → AI.").font(.callout).foregroundStyle(Theme.warn)
            }
            ForEach(ChatModel.suggestions, id: \.self) { s in
                Button(s) { chat.send(store, s) }.buttonStyle(.bordered).font(.callout)
            }
        }
    }

    @ViewBuilder private func bubble(_ l: ChatLine) -> some View {
        if l.role == "user" {
            HStack {
                Spacer(minLength: 40)
                VStack(alignment: .trailing, spacing: 4) {
                    if l.hadImage { Label("photo", systemImage: "photo").font(.caption).foregroundStyle(Theme.dim) }
                    if !l.text.isEmpty { Text(l.text).textSelection(.enabled) }
                }
                .padding(10).background(Theme.plate2, in: RoundedRectangle(cornerRadius: 12))
            }
        } else {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(l.actions, id: \.self) { a in
                    Label(a, systemImage: "checkmark.circle.fill").font(.caption).foregroundStyle(Theme.ok)
                }
                if l.error { Text(l.text).foregroundStyle(Theme.red) }
                else if !l.text.isEmpty { MarkdownView(text: l.text).textSelection(.enabled) }
                if !l.via.isEmpty {
                    Text(l.via == "mac" ? "Claude on your Mac" : l.via == "gemini" ? "Gemini" : "Claude").font(.caption2).foregroundStyle(Theme.dim)
                }
            }
        }
    }

    private var inputBar: some View {
        VStack(spacing: 6) {
            if let image, let img = imageView(image) {
                HStack {
                    img.resizable().scaledToFill().frame(width: 48, height: 48).clipShape(RoundedRectangle(cornerRadius: 8))
                    Text("meal, receipt, notes, code…").font(.caption).foregroundStyle(Theme.dim)
                    Spacer()
                    Button { self.image = nil } label: { Image(systemName: "xmark.circle.fill") }.buttonStyle(.plain)
                }
            }
            HStack(alignment: .bottom, spacing: 8) {
                PhotosPicker(selection: $photo, matching: .images) { Image(systemName: "camera").padding(6) }.buttonStyle(.plain)
                TextField("Ask Yaver anything…", text: $input, axis: .vertical)
                    .lineLimit(1...6)
                    .textFieldStyle(.plain)
                    .padding(8)
                    .background(Theme.plate, in: RoundedRectangle(cornerRadius: 10))
                    .focused($focused)
                    .onSubmit(send)
                Button { voice.state == "listening" ? voice.stopListening() : voice.listen(store) } label: {
                    Image(systemName: voice.state == "listening" ? "mic.fill" : "mic").padding(6).foregroundStyle(voice.state == "listening" ? Theme.gold : Theme.muted)
                }
                .buttonStyle(.plain)
                .disabled(chat.busy)
                Button { chat.busy ? chat.stop() : send() } label: {
                    Image(systemName: chat.busy ? "stop.circle.fill" : "arrow.up.circle.fill").font(.title2)
                }
                .buttonStyle(.plain)
                .keyboardShortcut(.return, modifiers: .command)
                .disabled(!chat.busy && input.trimmingCharacters(in: .whitespaces).isEmpty && image == nil)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .frame(maxWidth: 760)
        .frame(maxWidth: .infinity)
        .background(Theme.bg)
    }

    /// Voice chat: one big button. Tap to talk; tap while it speaks to interrupt.
    private var orb: some View {
        let label = ["listening": "listening…", "thinking": "thinking…", "voicing": "getting the voice…", "speaking": "speaking · tap to interrupt"][voice.state] ?? "tap to talk"
        return VStack(spacing: 8) {
            if !voice.heard.isEmpty { Text(voice.heard).font(.callout).foregroundStyle(Theme.muted).lineLimit(3).multilineTextAlignment(.center) }
            Button {
                if voice.state == "listening" { voice.stopListening() }
                else if voice.speaking { voice.hush(); voice.listen(store) }
                else if chat.busy { chat.stop() }
                else { voice.listen(store) }
            } label: {
                TimelineView(.animation(paused: voice.state.isEmpty)) { tl in
                    let t = tl.date.timeIntervalSinceReferenceDate
                    let pulse = voice.state.isEmpty ? 1 : 1 + 0.08 * Foundation.sin(t * (voice.state == "listening" ? 6 : 3))
                    ZStack {
                        Circle().fill(RadialGradient(colors: [Theme.gold.opacity(0.9), Theme.gold.opacity(0.15)], center: .center, startRadius: 4, endRadius: 46))
                        Circle().stroke(Theme.gold.opacity(0.6), lineWidth: 2)
                        Image(systemName: voice.state == "listening" ? "waveform" : voice.state == "speaking" ? "speaker.wave.2.fill" : "mic.fill").font(.title2).foregroundStyle(Theme.bg)
                    }
                    .frame(width: 84, height: 84)
                    .scaleEffect(pulse)
                }
            }
            .buttonStyle(.plain)
            Text(label).font(.callout.weight(.semibold)).foregroundStyle(Theme.text)
            Text("voice chat · tap the wave icon at the top to end").font(.caption2).foregroundStyle(Theme.dim)
        }
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity)
        .background(Theme.bg)
    }

    private func send() {
        guard !chat.busy else { return }
        let t = input, img = image
        input = ""; image = nil
        chat.send(store, t, image: img)
    }
}

/// The round Yaver button on the iPhone that opens the chat from any screen.
struct AssistantButton: View {
    @ObservedObject var chat = ChatModel.shared
    var body: some View {
        Button { chat.open = true } label: {
            Image(systemName: "sparkles")
                .font(.title2.weight(.semibold))
                .foregroundStyle(Theme.bg)
                .frame(width: 54, height: 54)
                .background(Theme.gold, in: Circle())
                .shadow(color: .black.opacity(0.4), radius: 6, y: 3)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Ask Yaver")
    }
}
