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
    }
}

enum Pane: String, CaseIterable, Identifiable {
    case home, assistant, cetele, course, diet, money, study, teams, body, settings
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
    @State private var section: Pane? = .home
    @ObservedObject private var chat = ChatModel.shared
    private let tick = Timer.publish(every: 120, on: .main, in: .common).autoconnect()

    var body: some View {
        content
            .onAppear { sync.syncNow(); checkUpdate() }
            .onChange(of: phase) { p in
                if p == .active { sync.syncNow(); checkUpdate() } else { store.flush() }
            }
            .onReceive(tick) { _ in sync.syncNow() }
    }

    private func checkUpdate() {
        #if os(macOS)
        Task { await updater.check() }
        #endif
    }

    @ViewBuilder private var content: some View {
        #if os(macOS)
        NavigationSplitView {
            List(Pane.allCases, selection: $section) { s in
                Label(s.title, systemImage: s.icon).tag(s)
            }
            .navigationSplitViewColumnWidth(min: 180, ideal: 200)
            .safeAreaInset(edge: .bottom) {
                VStack(alignment: .leading, spacing: 8) {
                    UpdateBanner()
                    Text(sync.summary).font(.caption).foregroundStyle(Theme.dim)
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
            }
        } detail: {
            NavigationStack { (section ?? Pane.home).screen }
        }
        #else
        TabView {
            ForEach([Pane.home, .cetele, .course, .diet], id: \.self) { s in
                NavigationStack { s.screen }.tabItem { Label(s.title, systemImage: s.icon) }
            }
            NavigationStack { MoreView() }.tabItem { Label("More", systemImage: "ellipsis") }
        }
        .overlay(alignment: .bottomTrailing) { AssistantButton().padding(.trailing, 16).padding(.bottom, 64) }
        .sheet(isPresented: $chat.open) { NavigationStack { AssistantView(sheet: true) }.environmentObject(store) }
        #endif
    }
}

struct MoreView: View {
    var body: some View {
        List {
            ForEach([Pane.money, .study, .teams, .body, .settings], id: \.self) { s in
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
