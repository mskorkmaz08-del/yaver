// The command bar (twin of js/command.js): ⌘K on the Mac, a long press on the Yaver
// button on the iPhone. One list: things to do (next lesson, log forms, review cards,
// voice, Brief me), Çetele steps not yet met (with Undo), and every screen. Typing
// filters it; anything else becomes "Ask Yaver: …".
import SwiftUI

struct Command: Identifiable {
    var id: String { group + "/" + label }
    let group: String
    let icon: String
    let label: String
    var hint: String = ""
    var keys: String = ""
    let run: () -> Void
}

struct CommandBar: View {
    @EnvironmentObject var store: Store
    @ObservedObject private var nav = Nav.shared
    @State private var query = ""
    @FocusState private var typing: Bool

    var body: some View {
        let list = shown()
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundStyle(Theme.dim)
                TextField("Do, log, go to or ask…", text: $query)
                    .textFieldStyle(.plain)
                    .font(.title3)
                    .focused($typing)
                    .onSubmit { list.first?.run() }
                    #if os(iOS)
                    .submitLabel(.go)
                    #endif
                Button("Close") { nav.command = false }
                    .buttonStyle(.plain).foregroundStyle(Theme.muted)
                    .keyboardShortcut(.cancelAction)
            }
            .padding(16)
            Divider().overlay(Theme.line)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 2) {
                    ForEach(groups(list), id: \.self) { g in
                        Text(g.uppercased()).font(.caption2.weight(.semibold)).foregroundStyle(Theme.dim)
                            .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 4)
                        ForEach(list.filter { $0.group == g }) { c in row(c, first: c.id == list.first?.id) }
                    }
                }
                .padding(.bottom, 12)
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .onAppear { typing = true }
        #if os(macOS)
        .frame(width: 560, height: 520)
        #endif
    }

    private func row(_ c: Command, first: Bool) -> some View {
        Button { c.run() } label: {
            HStack(spacing: 12) {
                Image(systemName: c.icon).frame(width: 22).foregroundStyle(Theme.gold)
                Text(c.label).foregroundStyle(Theme.text).lineLimit(1)
                Spacer()
                if !c.hint.isEmpty { Text(c.hint).font(.caption).foregroundStyle(Theme.dim).lineLimit(1) }
                if first && !query.isEmpty { Image(systemName: "return").font(.caption).foregroundStyle(Theme.dim) }
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
            .background(first && !query.isEmpty ? Theme.plate2 : .clear, in: RoundedRectangle(cornerRadius: 6))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 6)
    }

    private func groups(_ list: [Command]) -> [String] {
        var seen: [String] = []
        for c in list where !seen.contains(c.group) { seen.append(c.group) }
        return seen
    }

    private func shown() -> [Command] {
        let all = commands()
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return all }
        let words = fold(q).split(separator: " ").map(String.init)
        var out = all.filter { c in
            let hay = fold("\(c.label) \(c.hint) \(c.keys) \(c.group)")
            return words.allSatisfy { hay.contains($0) }
        }
        out.append(Command(group: "Ask", icon: "sparkles", label: "Ask Yaver: “\(q)”") { nav.ask(store, q) })
        return out
    }

    /// Lowercase without accents, so "cetele" finds Çetele.
    private func fold(_ s: String) -> String { s.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current).lowercased() }

    private func commands() -> [Command] {
        let s = store
        var out: [Command] = []
        let C = Course.shared
        if C.active(s), let next = C.nextBlock(s)?.slot.lesson {
            let begun = !(C.progress(s, next.id)?["stepsDone"]?.array ?? []).isEmpty
            out.append(Command(group: "Do", icon: "book", label: "\(begun ? "Resume" : "Begin") \(next.str("title"))",
                               hint: "next lesson · \(Int(next.num("minutes"))) min", keys: "lesson study start") { nav.present(.lesson(next.id)) })
        }
        out += [
            Command(group: "Do", icon: "creditcard", label: "Log an expense", keys: "money spend spent pay buy") { nav.present(.expense) },
            Command(group: "Do", icon: "fork.knife", label: "Log a meal", keys: "food eat diet calories") { nav.present(.meal) },
            Command(group: "Do", icon: "clock", label: "Log study time", keys: "session hours minutes") { nav.present(.study) },
            Command(group: "Do", icon: "calendar", label: "New meeting", keys: "event calendar meet") { nav.present(.meeting) },
            Command(group: "Do", icon: "checkmark.circle", label: "Add a to-do", keys: "task todo") { nav.present(.task) },
        ]
        if C.active(s) {
            let due = C.dueCount(s)
            out.append(Command(group: "Do", icon: "arrow.triangle.2.circlepath", label: "Review cards", hint: due > 0 ? "\(due) due" : "none due", keys: "flashcards spaced") { nav.present(.review) })
        }
        if let t = StudyTimer.get(s) {
            out.append(Command(group: "Do", icon: "scope", label: "Focus on \(t.subject)", hint: "study timer running", keys: "focus timer") {
                if let f = StudyTimer.focus(s) { nav.startFocus(f) }
            })
        }
        out += [
            Command(group: "Do", icon: "waveform", label: "Talk to Yaver", hint: "voice chat", keys: "voice speak") { nav.ask(s, nil, voice: true) },
            Command(group: "Do", icon: "sparkles", label: "Brief me", hint: "what needs attention today", keys: "summary today") {
                nav.ask(s, "Brief me: what needs my attention today (çetele minimums, meetings, study and roadmap, tasks, money, diet). Facts and next steps only.")
            },
        ]
        for r in s.cetele() where !r.met {
            let check = r.isCheck
            out.append(Command(group: "Çetele", icon: "moon.stars", label: check ? "\(r.name) done" : "\(r.name) +\(plain(r.step))",
                               hint: check ? "" : "\(plain(r.progress))/\(plain(r.target))\(r.weekly ? " this week" : "")", keys: "cetele log") {
                let before = r.value
                let after = check ? 1 : before + r.step
                s.setCetele(r.id, after)
                let metNow = r.progress - before + after >= r.target
                nav.command = false
                nav.show(metNow ? "\(r.name): minimum met" : "\(r.name) \(check ? "done" : "+\(plain(r.step))")") { s.setCetele(r.id, before) }
            })
        }
        for p in Pane.allCases {
            out.append(Command(group: "Go to", icon: p.icon, label: p.title, keys: p.rawValue) { nav.go(p) })
        }
        return out
    }
}
