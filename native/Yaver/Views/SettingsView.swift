// Settings: sync (join with the web app's sync code), import and export backups,
// currency and daily goals.
import SwiftUI
import UniformTypeIdentifiers

struct SettingsView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var sync: Sync
    @EnvironmentObject var updater: Updater
    @State private var code = ""
    @State private var name = ""
    @State private var busy = false
    @State private var message = ""
    @State private var importing = false
    @State private var exporting = false
    @State private var exportDoc: BackupFile?
    @State private var confirmForget = false

    var body: some View {
        let _ = store.revision
        Screen(title: "Settings") {
            Card(title: "Sync") {
                Text(sync.summary).foregroundStyle(sync.state == .error ? Theme.red : Theme.muted)
                if sync.configured {
                    HStack {
                        Button("Sync now") { sync.syncNow() }.buttonStyle(.borderedProminent).disabled(sync.state == .syncing)
                        Button("Copy sync code") { Clipboard.copy(sync.code()); message = "Sync code copied. Treat it like a password." }.buttonStyle(.bordered)
                    }
                    Button("Turn sync off on this device", role: .destructive) { confirmForget = true }.buttonStyle(.borderless)
                } else {
                    Text("In the web app on your iPhone: Settings → Sync → Copy sync code. Then paste it here. Everything already in Yaver comes across: meals, Çetele, money, study, teams, body.")
                        .font(.callout).foregroundStyle(Theme.muted)
                    TextField("yaversync1.…", text: $code).textFieldStyle(.roundedBorder).autocorrectionDisabled()
                    TextField("This device's name (\(sync.deviceName))", text: $name).textFieldStyle(.roundedBorder)
                    HStack {
                        Button("Paste") { code = Clipboard.read() }.buttonStyle(.bordered)
                        Button(busy ? "Joining…" : "Join") { join() }.buttonStyle(.borderedProminent)
                            .disabled(busy || Sync.parseCode(code) == nil)
                    }
                    Text("No sync code yet? Set sync up in the web app first (Settings → Sync), or import a backup file below.")
                        .font(.caption).foregroundStyle(Theme.dim)
                }
                if !message.isEmpty { Text(message).font(.callout).foregroundStyle(Theme.gold) }
            }

            Card(title: "Your data") {
                Text("Import merges a backup from the web app (Settings → Export backup) or from this app: for each record the newer version wins, so nothing newer is lost.")
                    .font(.callout).foregroundStyle(Theme.muted)
                HStack {
                    Button("Import backup…") { importing = true }.buttonStyle(.bordered)
                    Button("Export backup…") { exportDoc = BackupFile(json: store.exportAll()); exporting = true }.buttonStyle(.bordered)
                }
                let counts = [("meals", "meals"), ("ceteleLog", "Çetele days"), ("expenses", "expenses"), ("sessions", "study sessions"),
                              ("courseProgress", "lessons"), ("people", "people"), ("activities", "activities"), ("weighins", "weigh-ins")]
                Text(counts.map { "\(store.count($0.0)) \($0.1)" }.joined(separator: " · ")).font(.caption.monospacedDigit()).foregroundStyle(Theme.dim)
            }

            Card(title: "Money and goals") {
                Picker("Currency", selection: Binding(get: { store.currency }, set: { store.setSetting("currency", .string($0)) })) {
                    ForEach(Array(Set(Money.currencies + [store.currency])).sorted(), id: \.self) { Text($0) }
                }
                GoalField(label: "Monthly budget", key: "monthlyBudget", fallback: 0)
                GoalField(label: "Calories a day", key: "dailyCalories", fallback: 2200)
                GoalField(label: "Protein a day (g)", key: "dailyProtein", fallback: 120)
                GoalField(label: "Study minutes a day", key: "dailyStudyMin", fallback: 60)
            }

            Card(title: "About") {
                let v = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
                Text("Yaver Mark II · native \(v) (build \(updater.currentBuild))").foregroundStyle(Theme.muted)
                #if os(macOS)
                UpdateBanner()
                if updater.state == .idle {
                    Button("Check for updates") { Task { await updater.check() } }.buttonStyle(.bordered)
                }
                #else
                Text("The iPhone app updates when you install it again with Sideloadly.").font(.caption).foregroundStyle(Theme.dim)
                #endif
                Text("Data file: \(store.fileURL.path)").font(.caption).foregroundStyle(Theme.dim).textSelection(.enabled)
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
            do {
                let url = try result.get()
                let ok = url.startAccessingSecurityScopedResource()
                defer { if ok { url.stopAccessingSecurityScopedResource() } }
                let n = try store.importBackup(JSON.decode(Data(contentsOf: url)))
                message = n > 0 ? "Backup merged: \(n) records updated." : "Nothing newer in that backup."
                sync.soon()
            } catch {
                message = error.localizedDescription
            }
        }
        .fileExporter(isPresented: $exporting, document: exportDoc, contentType: .json,
                      defaultFilename: "yaver-backup-\(Day.today).json") { result in
            if case .failure(let e) = result { message = e.localizedDescription }
        }
        .confirmationDialog("Turn sync off on this device?", isPresented: $confirmForget) {
            Button("Turn off and forget the key", role: .destructive) { sync.turnOff(forget: true) }
        } message: {
            Text("Your data stays on this device and in the synced copy. You can join again with the sync code.")
        }
    }

    private func join() {
        busy = true
        message = ""
        Task { @MainActor in
            do {
                try await sync.join(code: code, name: name)
                code = ""
                message = "Joined. \(store.count("meals")) meals and \(store.count("ceteleLog")) Çetele days are here."
            } catch {
                message = error.localizedDescription
            }
            busy = false
        }
    }
}

struct GoalField: View {
    @EnvironmentObject var store: Store
    let label: String
    let key: String
    let fallback: Double
    @State private var text = ""

    var body: some View {
        HStack {
            Text(label).foregroundStyle(Theme.muted)
            Spacer()
            TextField("", text: $text)
                .numberKeyboard()
                .multilineTextAlignment(.trailing)
                .frame(width: 110)
                .textFieldStyle(.roundedBorder)
                .onSubmit(save)
                .onChange(of: text) { _ in save() }
        }
        .onAppear { text = plain(store.setting(key)?.double ?? fallback) }
    }

    private func save() {
        guard let v = number(text), v != (store.setting(key)?.double ?? fallback) else { return }
        store.setSetting(key, .number(v))
    }
}

/// A backup file for the share/save panel.
struct BackupFile: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    let json: JSON
    init(json: JSON) { self.json = json }
    init(configuration: ReadConfiguration) throws {
        json = try JSON.decode(configuration.file.regularFileContents ?? Data())
    }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: try json.encoded())
    }
}
