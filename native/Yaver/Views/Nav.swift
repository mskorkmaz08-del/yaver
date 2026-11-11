// App-wide navigation and the small pieces the command bar, keyboard shortcuts and
// focus mode share (twins of js/command.js, js/keys.js and js/focus.js):
// which screen is open, which form or lesson sheet is up, a toast with Undo,
// the Study stopwatch, and the focus screen itself.
import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// A form, lesson or screen opened from the command bar or a shortcut.
enum CmdSheet: Identifiable {
    case expense, meal, study, meeting, task, review
    case lesson(String)
    case pane(Pane)
    var id: String {
        switch self {
        case .expense: return "expense"
        case .meal: return "meal"
        case .study: return "study"
        case .meeting: return "meeting"
        case .task: return "task"
        case .review: return "review"
        case .lesson(let l): return "lesson/\(l)"
        case .pane(let p): return "pane/\(p.rawValue)"
        }
    }
}

/// What focus mode shows: a title, the planned minutes and where the clock starts.
struct FocusSpec: Identifiable {
    let id = UUID()
    var title: String
    var planned: Double
    var lessonId: String?
    /// When the running time began, or nil when nothing runs.
    var start: () -> Date?
}

struct Toast: Identifiable, Equatable {
    let id = UUID()
    var text: String
    var undo: (() -> Void)?
    static func == (a: Toast, b: Toast) -> Bool { a.id == b.id }
}

@MainActor
final class Nav: ObservableObject {
    static let shared = Nav()
    /// The Mac sidebar selection, and the iPhone tab when the screen is a tab.
    @Published var pane: Pane = .home
    @Published var tab = Pane.home.rawValue
    @Published var command = false
    @Published var sheet: CmdSheet?
    @Published var focus: FocusSpec?
    @Published var toast: Toast?

    static let tabs: [Pane] = [.home, .cetele, .course, .diet]

    func go(_ p: Pane) {
        command = false
        #if os(macOS)
        sheet = nil
        pane = p
        #else
        if p == .assistant { later { ChatModel.shared.open = true } }
        else if Nav.tabs.contains(p) { sheet = nil; tab = p.rawValue }
        else { present(.pane(p)) }
        #endif
    }

    /// Opens a sheet once the command bar has closed (one sheet at a time).
    func present(_ s: CmdSheet) {
        command = false
        ChatModel.shared.open = false
        later { self.sheet = s }
    }

    func ask(_ store: Store, _ prompt: String?, voice: Bool = false) {
        command = false
        later {
            ChatModel.shared.load(store)
            ChatModel.shared.open = true
            if let p = prompt, !p.isEmpty { ChatModel.shared.send(store, p) }
            if voice && !VoiceChat.shared.on { VoiceChat.shared.start(store) }
        }
    }

    func startFocus(_ f: FocusSpec) {
        command = false
        sheet = nil
        ChatModel.shared.open = false
        later { self.focus = f }
    }

    func show(_ text: String, undo: (() -> Void)? = nil) {
        let t = Toast(text: text, undo: undo)
        toast = t
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 4_500_000_000)
            if self.toast == t { self.toast = nil }
        }
    }

    private func later(_ f: @escaping @MainActor () -> Void) {
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 500_000_000)
            f()
        }
    }
}

// MARK: - Study stopwatch (setting "timer", same shape as the web app's)

enum StudyTimer {
    struct T { var subject: String; var start: Double; var pausedAt: Double?; var planned: Double }
    static func get(_ s: Store) -> T? {
        guard let t = s.setting("timer"), let start = t["start"]?.double else { return nil }
        return T(subject: t["subject"]?.string ?? "General", start: start, pausedAt: t["pausedAt"]?.double, planned: t["plannedMin"]?.double ?? 25)
    }
    static func save(_ s: Store, _ t: T?) {
        guard let t else { s.setSetting("timer", .null); return }
        s.setSetting("timer", .object(["subject": .string(t.subject), "start": .number(t.start), "pausedAt": t.pausedAt.map { .number($0) } ?? .null, "plannedMin": .number(t.planned)]))
    }
    static var nowMs: Double { Date().timeIntervalSince1970 * 1000 }
    static func elapsed(_ t: T) -> Double { max(0, ((t.pausedAt ?? nowMs) - t.start) / 1000) }
    static func start(_ s: Store, subject: String, planned: Double) {
        save(s, T(subject: subject.isEmpty ? "General" : subject, start: nowMs, pausedAt: nil, planned: planned))
    }
    static func pause(_ s: Store) { if var t = get(s), t.pausedAt == nil { t.pausedAt = nowMs; save(s, t) } }
    static func resume(_ s: Store) {
        guard var t = get(s), let p = t.pausedAt else { return }
        t.start += nowMs - p
        t.pausedAt = nil
        save(s, t)
    }
    /// Stops and logs the minutes as a study session; returns what was logged.
    @discardableResult static func stop(_ s: Store) -> (Int, String)? {
        guard let t = get(s) else { return nil }
        let m = max(1, Int((elapsed(t) / 60).rounded()))
        save(s, nil)
        let subj = s.subject(named: t.subject)
        s.put("sessions", ["subjectId": .string(subj.id), "minutes": .number(Double(m)), "date": .string(Day.today), "note": ""])
        return (m, t.subject)
    }
    static func focus(_ s: Store) -> FocusSpec? {
        guard let t = get(s) else { return nil }
        return FocusSpec(title: t.subject, planned: t.planned, lessonId: nil) {
            StudyTimer.get(s).map { Date(timeIntervalSinceNow: -StudyTimer.elapsed($0)) }
        }
    }
}

extension Course {
    func focusSpec(_ s: Store, lesson l: Row) -> FocusSpec {
        FocusSpec(title: l.str("title"), planned: l.num("minutes"), lessonId: l.id) {
            Course.shared.timer(s, for: l.id).map { Date(timeIntervalSinceNow: -Course.shared.elapsed($0)) }
        }
    }
}

// MARK: - Focus mode

private struct FocusActiveKey: EnvironmentKey { static let defaultValue = false }
extension EnvironmentValues {
    /// True inside focus mode, so screens hide their own Focus buttons.
    var focusActive: Bool {
        get { self[FocusActiveKey.self] }
        set { self[FocusActiveKey.self] = newValue }
    }
}

/// The screen empties: in a lesson only the lesson stays, from Study it is simply dark
/// with the subject. A small stopwatch chip shows the time; tap it and it fades to a
/// faint dot. The screen stays awake; on the Mac the window goes full screen. Esc leaves.
struct FocusView: View {
    let spec: FocusSpec
    @EnvironmentObject var store: Store
    @ObservedObject private var nav = Nav.shared
    @AppStorage("focusChipFaint") private var faint = false
    @State private var rang = false
    #if os(macOS)
    @State private var activity: NSObjectProtocol?
    @State private var wentFull = false
    #endif

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            if let id = spec.lessonId {
                NavigationStack { LessonView(lessonId: id) }.environment(\.focusActive, true)
            } else {
                VStack(spacing: 10) {
                    Text(spec.title).font(.system(size: 28, weight: .light, design: .serif)).foregroundStyle(Theme.muted)
                    Text("focus").font(.caption.smallCaps()).foregroundStyle(Theme.dim)
                }
            }
        }
        .overlay(alignment: .topTrailing) {
            Button { exit() } label: {
                Image(systemName: "xmark").font(.body.weight(.semibold)).foregroundStyle(Theme.muted)
                    .frame(width: 36, height: 36).background(Theme.plate.opacity(0.9), in: Circle())
            }
            .buttonStyle(.plain)
            .keyboardShortcut(.cancelAction)
            .accessibilityLabel("Leave focus mode")
            .padding(14)
        }
        .overlay(alignment: .bottom) { chip.padding(.bottom, 22) }
        .onAppear { keepAwake(true) }
        .onDisappear { keepAwake(false) }
    }

    private var chip: some View {
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            let sec = Int(spec.start().map { Date().timeIntervalSince($0) } ?? 0)
            let over = spec.planned > 0 && Double(sec) >= spec.planned * 60
            Button { withAnimation(.easeInOut(duration: 0.3)) { faint.toggle() } } label: {
                if faint {
                    Circle().fill(over ? Theme.ok : Theme.gold).frame(width: 8, height: 8).opacity(0.5).padding(14)
                } else {
                    HStack(spacing: 8) {
                        StopwatchGlyph(second: sec % 60).frame(width: 18, height: 18)
                        Text(String(format: "%02d:%02d", sec / 60, sec % 60)).font(.callout.monospacedDigit().weight(.medium))
                    }
                    .foregroundStyle(over ? Theme.ok : Theme.gold)
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .background(Theme.plate.opacity(0.92), in: Capsule())
                    .overlay(Capsule().stroke(Theme.line))
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Hide or show the timer")
            .onChange(of: over) { o in if o && !rang { rang = true; buzz() } }
        }
    }

    private func exit() { nav.focus = nil }

    private func buzz() {
        #if os(iOS)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        #endif
    }

    private func keepAwake(_ on: Bool) {
        #if os(iOS)
        UIApplication.shared.isIdleTimerDisabled = on
        #else
        if on {
            activity = ProcessInfo.processInfo.beginActivity(options: [.idleDisplaySleepDisabled, .userInitiated], reason: "Focus mode")
            if let w = NSApp.keyWindow, !w.styleMask.contains(.fullScreen) { w.toggleFullScreen(nil); wentFull = true }
        } else {
            if let a = activity { ProcessInfo.processInfo.endActivity(a); activity = nil }
            if wentFull, let w = NSApp.keyWindow, w.styleMask.contains(.fullScreen) { w.toggleFullScreen(nil) }
            wentFull = false
        }
        #endif
    }
}

struct StopwatchGlyph: View {
    let second: Int
    var body: some View {
        Canvas { ctx, size in
            let r = Double(min(size.width, size.height)) / 2 - 2
            let c = CGPoint(x: Double(size.width) / 2, y: Double(size.height) / 2 + 1)
            ctx.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .foreground, lineWidth: 1.6)
            ctx.fill(Path(CGRect(x: c.x - 1.5, y: c.y - r - 3, width: 3, height: 2.5)), with: .foreground)
            let a = Double(second) / 60 * 2 * Double.pi
            var hand = Path()
            hand.move(to: c)
            hand.addLine(to: CGPoint(x: c.x + Foundation.sin(a) * r * 0.7, y: c.y - Foundation.cos(a) * r * 0.7))
            ctx.stroke(hand, with: .foreground, style: StrokeStyle(lineWidth: 1.6, lineCap: .round))
        }
    }
}

/// The toast at the bottom of the window, with Undo when there is one.
struct ToastView: View {
    @ObservedObject private var nav = Nav.shared
    var body: some View {
        if let t = nav.toast {
            HStack(spacing: 14) {
                Text(t.text).font(.callout)
                if let u = t.undo {
                    Button("Undo") { u(); nav.toast = nil }.font(.callout.weight(.semibold)).foregroundStyle(Theme.gold).buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
            .background(Theme.plate, in: Capsule())
            .overlay(Capsule().stroke(Theme.line))
            .shadow(color: .black.opacity(0.35), radius: 8, y: 3)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .id(t.id)
        }
    }
}

/// A to-do for the tasks list (the web app's task form).
struct TaskForm: View {
    @EnvironmentObject var store: Store
    @State private var title = ""
    @State private var hasDue = false
    @State private var due = Date()

    var body: some View {
        Form {
            TextField("What needs doing", text: $title)
            Toggle("Due date", isOn: $hasDue)
            if hasDue { DatePicker("Due", selection: $due, displayedComponents: .date) }
        }
        .navigationTitle("Add a to-do")
        .sheetButtons(canSave: !title.trimmingCharacters(in: .whitespaces).isEmpty) {
            store.put("tasks", ["title": .string(title.trimmingCharacters(in: .whitespaces)), "due": hasDue ? .string(Day.key(due)) : .null, "done": false])
        }
    }
}

/// A screen, lesson or review opened in a sheet, with Done on the Mac.
struct SheetScreen<C: View>: View {
    @Environment(\.dismiss) private var dismiss
    @ViewBuilder var content: C
    var body: some View {
        NavigationStack {
            content
                #if os(macOS)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
                #endif
        }
        #if os(macOS)
        .frame(minWidth: 820, minHeight: 640)
        #endif
    }
}
