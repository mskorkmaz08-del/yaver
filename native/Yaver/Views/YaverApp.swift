// Yaver for iPhone and Mac: one SwiftUI app, one target, both platforms.
// Tabs on the iPhone, a sidebar on the Mac. Data lives on the device (Store)
// and syncs through the same encrypted GitHub copy as the web app (Sync).
import SwiftUI

@main
struct YaverApp: App {
    @StateObject private var store: Store
    @StateObject private var sync: Sync
    @StateObject private var updater = Updater()

    init() {
        let s = Store()
        _store = StateObject(wrappedValue: s)
        _sync = StateObject(wrappedValue: Sync(store: s))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .environmentObject(sync)
                .environmentObject(updater)
                .preferredColorScheme(.dark)
                .tint(Theme.gold)
        }
        #if os(macOS)
        .defaultSize(width: 1100, height: 760)
        #endif
        .commands { YaverCommands() }
    }
}

/// Keyboard shortcuts (twin of js/keys.js), listed in the menu bar on the Mac:
/// ⌘K command bar, ⌘1–8 screens, ⌘/ ask Yaver, ⌘⇧ letters for forms and screens.
struct YaverCommands: Commands {
    var body: some Commands {
        CommandMenu("Go") {
            Button("Command bar…") { Nav.shared.command = true }.keyboardShortcut("k", modifiers: .command)
            Button("Ask Yaver") { Nav.shared.go(.assistant) }.keyboardShortcut("/", modifiers: .command)
            Divider()
            ForEach(Array(YaverCommands.numbered.enumerated()), id: \.offset) { i, p in
                Button(p.title) { Nav.shared.go(p) }.keyboardShortcut(KeyEquivalent(Character(String(i + 1))), modifiers: .command)
            }
            Button("Course") { Nav.shared.go(.course) }.keyboardShortcut("c", modifiers: [.command, .shift])
            Button("Teams") { Nav.shared.go(.teams) }.keyboardShortcut("t", modifiers: [.command, .shift])
            Button("Body") { Nav.shared.go(.body) }.keyboardShortcut("b", modifiers: [.command, .shift])
            Button("Settings") { Nav.shared.go(.settings) }.keyboardShortcut(",", modifiers: .command)
        }
        CommandMenu("Log") {
            Button("Expense…") { Nav.shared.present(.expense) }.keyboardShortcut("e", modifiers: [.command, .shift])
            Button("Meal…") { Nav.shared.present(.meal) }.keyboardShortcut("m", modifiers: [.command, .shift])
            Button("Study time…") { Nav.shared.present(.study) }.keyboardShortcut("s", modifiers: [.command, .shift])
            Button("Meeting…") { Nav.shared.present(.meeting) }.keyboardShortcut("n", modifiers: [.command, .shift])
            Button("To-do…") { Nav.shared.present(.task) }.keyboardShortcut("d", modifiers: [.command, .shift])
            Button("Review cards") { Nav.shared.present(.review) }.keyboardShortcut("r", modifiers: [.command, .shift])
        }
    }
    static let numbered: [Pane] = [.home, .cetele, .study, .meet, .money, .diet, .map, .skills]
}

enum Pane: String, CaseIterable, Identifiable {
    case home, assistant, cetele, course, diet, meet, money, study, skills, teams, body, map, settings
    var id: String { rawValue }
    var title: String {
        switch self {
        case .home: return "Home"
        case .assistant: return "Yaver"
        case .cetele: return "Çetele"
        case .course: return "Course"
        case .diet: return "Diet"
        case .money: return "Money"
        case .study: return "Study"
        case .meet: return "Meet"
        case .map: return "Map"
        case .skills: return "Skills"
        case .teams: return "Teams"
        case .body: return "Body"
        case .settings: return "Settings"
        }
    }
    var icon: String {
        switch self {
        case .home: return "house"
        case .assistant: return "sparkles"
        case .cetele: return "moon.stars"
        case .course: return "graduationcap"
        case .diet: return "fork.knife"
        case .money: return "creditcard"
        case .study: return "book"
        case .meet: return "calendar"
        case .map: return "map"
        case .skills: return "hexagon"
        case .teams: return "person.2"
        case .body: return "figure.strengthtraining.traditional"
        case .settings: return "gearshape"
        }
    }
    @ViewBuilder var screen: some View {
        switch self {
        case .home: HomeView()
        case .assistant: AssistantView()
        case .cetele: CeteleView()
        case .course: CourseView()
        case .diet: DietView()
        case .money: MoneyView()
        case .study: StudyView()
        case .meet: MeetView()
        case .map: MapView()
        case .skills: SkillsView()
        case .teams: TeamsView()
        case .body: BodyView()
        case .settings: SettingsView()
        }
    }
}

struct RootView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var sync: Sync
    @EnvironmentObject var updater: Updater
    @Environment(\.scenePhase) private var phase
    @ObservedObject private var chat = ChatModel.shared
    @ObservedObject private var nav = Nav.shared
    private let tick = Timer.publish(every: 120, on: .main, in: .common).autoconnect()

    var body: some View {
        content
            .onAppear { sync.syncNow(); checkUpdate(); refreshDevice() }
            .onChange(of: phase) { p in
                if p == .active { sync.syncNow(); checkUpdate(); refreshDevice() } else { store.flush() }
            }
            .onReceive(tick) { _ in sync.syncNow() }
            .sheet(isPresented: $nav.command) { CommandBar().environmentObject(store) }
            .sheet(item: $nav.sheet) { s in sheet(s).environmentObject(store) }
            .overlay(alignment: .bottom) { ToastView().padding(.bottom, 90).animation(.easeOut(duration: 0.2), value: nav.toast) }
            .overlay { if let f = nav.focus { FocusView(spec: f).environmentObject(store).transition(.opacity) } }
            .animation(.easeInOut(duration: 0.25), value: nav.focus?.id)
    }

    @ViewBuilder private func sheet(_ s: CmdSheet) -> some View {
        switch s {
        case .expense: NavigationStack { ExpenseForm(expense: nil) }.sheetSize()
        case .meal: NavigationStack { MealForm(day: Day.today, meal: nil) }.sheetSize()
        case .study: NavigationStack { StudyForm() }.sheetSize()
        case .meeting: MeetingForm(existing: nil, day: Day.today, presetStart: nil)
        case .task: NavigationStack { TaskForm() }.sheetSize()
        case .review: SheetScreen { ReviewView() }
        case .lesson(let id): SheetScreen { LessonView(lessonId: id) }
        case .pane(let p): SheetScreen { p.screen }
        }
    }

    /// Apple Calendar copy and this device's notifications.
    private func refreshDevice() {
        Task {
            if AppleCalendar.enabled(store) { await AppleCalendar.sync(store) }
            await Notifications.requestIfNeeded()
            await Notifications.reschedule(store)
        }
    }

    private func checkUpdate() {
        #if os(macOS)
        Task { await updater.check() }
        #endif
    }

    @ViewBuilder private var content: some View {
        #if os(macOS)
        NavigationSplitView {
            List(Pane.allCases, selection: Binding<Pane?>(get: { nav.pane }, set: { if let p = $0 { nav.pane = p } })) { s in
                Label(s.title, systemImage: s.icon).tag(s)
            }
            .navigationSplitViewColumnWidth(min: 180, ideal: 200)
            .safeAreaInset(edge: .bottom) {
                VStack(alignment: .leading, spacing: 8) {
                    Button { nav.command = true } label: {
                        HStack { Image(systemName: "magnifyingglass"); Text("Command bar"); Spacer(); Text("⌘K").foregroundStyle(Theme.dim) }
                    }
                    .buttonStyle(.plain).font(.callout).foregroundStyle(Theme.muted)
                    UpdateBanner()
                    Text(sync.summary).font(.caption).foregroundStyle(Theme.dim)
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
            }
        } detail: {
            NavigationStack { nav.pane.screen }.id(nav.pane)
        }
        .onChange(of: chat.open) { o in if o { nav.pane = .assistant; chat.open = false } }
        #else
        TabView(selection: $nav.tab) {
            ForEach(Nav.tabs, id: \.self) { s in
                NavigationStack { s.screen }.tabItem { Label(s.title, systemImage: s.icon) }.tag(s.rawValue)
            }
            NavigationStack { MoreView() }.tabItem { Label("More", systemImage: "ellipsis") }.tag("more")
        }
        .overlay(alignment: .bottomTrailing) { AssistantButton().padding(.trailing, 16).padding(.bottom, 64) }
        .sheet(isPresented: $chat.open) { NavigationStack { AssistantView(sheet: true) }.environmentObject(store) }
        #endif
    }
}

struct MoreView: View {
    var body: some View {
        List {
            ForEach([Pane.meet, .money, .study, .skills, .teams, .body, .map, .settings], id: \.self) { s in
                NavigationLink { s.screen } label: { Label(s.title, systemImage: s.icon) }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle("More")
    }
}

/// Mac only: "Update available" with one button that installs and reopens Yaver.
struct UpdateBanner: View {
    @EnvironmentObject var updater: Updater
    @EnvironmentObject var store: Store
    var body: some View {
        #if os(macOS)
        switch updater.state {
        case .available:
            Button { Task { await updater.install { store.flush() } } } label: {
                Label("Update Yaver", systemImage: "arrow.down.circle.fill").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
        case .installing:
            HStack { ProgressView().controlSize(.small); Text("Updating…").font(.caption) }
        case .failed(let why):
            Text(why).font(.caption).foregroundStyle(Theme.warn)
        case .idle:
            EmptyView()
        }
        #else
        EmptyView()
        #endif
    }
}
