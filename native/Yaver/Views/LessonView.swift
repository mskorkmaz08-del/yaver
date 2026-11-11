// One lesson (twin of js/views/lesson.js): timer, steps, recall warm-up, questions with
// marks, practice tasks with a hint ladder, optional LeetCode, notes and the complete flow.
// Also the course sessions: review cards, weekly test, ship & review, flagged, prepare.
import SwiftUI
import UniformTypeIdentifiers

private let stepLabel = ["warmup": "recall", "example": "first example"]
private let stepIcon = ["warmup": "clock", "example": "scope", "learn": "book", "practice": "terminal", "exit": "checkmark.seal", "reflect": "pencil",
                        "read": "book", "summary": "pencil", "cards": "rectangle.stack", "plan": "scope", "build": "hammer", "test": "checkmark.seal",
                        "log": "pencil", "simulate": "bolt", "measure": "ruler", "teachnotes": "person.wave.2", "handout": "doc.text"]

private func roman(_ n: Int) -> String {
    let m = [(10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i")]
    var n = n, out = ""
    for (v, s) in m { while n >= v { out += s; n -= v } }
    return out
}

/// What you've revealed, marked and typed in this lesson (kept while the screen is open).
final class LessonState: ObservableObject {
    @Published var revealed: Set<String> = []
    @Published var unknown: Set<String> = []
    @Published var marks: [String: Bool] = [:]
    @Published var diag: [String: String] = [:]
    @Published var hints: [String: Int] = [:]
    @Published var answers: [String: String] = [:]
    @Published var hintsUsed = 0
    @Published var solutions = 0
}

struct TextFileDoc: FileDocument {
    static var readableContentTypes: [UTType] { [.plainText, .commaSeparatedText, .cPlusPlusSource, .pythonScript] }
    var text: String
    init(text: String) { self.text = text }
    init(configuration: ReadConfiguration) throws { text = String(data: configuration.file.regularFileContents ?? Data(), encoding: .utf8) ?? "" }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: Data(text.utf8)) }
}

struct LessonView: View {
    let lessonId: String
    var retake = false
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    @StateObject private var st = LessonState()
    @State private var notes = ""
    @State private var askUnmarked = false
    @State private var askMinutes = false
    @State private var minutesText = ""
    @State private var askEarly = false
    @State private var pending: (score: Double?, minutes: Int?) = (nil, nil)
    @State private var result: String?
    @State private var exportDoc: TextFileDoc?
    @State private var exportName = ""
    @State private var exportType: UTType = .plainText
    @State private var exporting = false
    @State private var problem: String?

    var body: some View {
        let _ = store.revision
        let C = Course.shared
        if let l = C.lesson(store, lessonId) {
            content(l)
        } else {
            Screen(title: "Lesson") {
                Card { Text("This lesson isn't in the app yet. Weeks from 16 on are prepared on the Course screen.").font(.callout).foregroundStyle(Theme.muted) }
            }
        }
    }

    @ViewBuilder private func content(_ l: Row) -> some View {
        let C = Course.shared
        let p = C.progress(store, l.id) ?? [:]
        let status = C.status(store, l.id)
        let steps = (l["steps"]?.array ?? []).compactMap { $0.object }
        let doneSteps = Set((p["stepsDone"]?.array ?? []).compactMap { $0.double.map(Int.init) })
        let tb = l.str("track") == "robo" ? C.teachBy(store, l) : nil
        Screen(title: l.str("title")) {
            // header
            HStack(spacing: 6) {
                Circle().fill(trackColor(l.str("track"))).frame(width: 8, height: 8)
                Text([l.str("track") == "mixed" ? "mixed" : C.trackName(l.str("track")), "wk \(l.str("week"))", "\(Int(l.num("minutes"))) min", status,
                      p["score"]?.double.map { "\(Int(($0 * 100).rounded()))%" } ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.caption.monospaced()).foregroundStyle(Theme.muted)
                if let tb, !tb.isEmpty {
                    Text("· teach by \(tb)").font(.caption.monospaced())
                        .foregroundStyle(C.deadlines(store, within: 7).contains { $0.lesson.id == l.id } ? Theme.red : Theme.muted)
                }
            }
            TimerCard(lesson: l, steps: steps, status: status)

            Card {
                Text("OBJECTIVES").font(.caption.weight(.semibold)).tracking(1.2).foregroundStyle(Theme.dim)
                ForEach(Array((l["objectives"]?.array ?? []).enumerated()), id: \.offset) { _, o in
                    HStack(alignment: .firstTextBaseline, spacing: 8) { Text("•").foregroundStyle(Theme.gold); Text(MD.inline(o.string ?? "")) }
                }
                let res = (l["resources"]?.array ?? []).compactMap { $0.object }
                if !res.isEmpty {
                    Text("RESOURCES").font(.caption.weight(.semibold)).tracking(1.2).foregroundStyle(Theme.dim).padding(.top, 4)
                    ForEach(Array(res.enumerated()), id: \.offset) { _, r in
                        if let u = URL(string: r.str("url")) {
                            Link(destination: u) {
                                HStack(alignment: .top) {
                                    Image(systemName: "arrow.up.right.square")
                                    VStack(alignment: .leading) {
                                        Text(r.str("title")).font(.callout.weight(.semibold))
                                        if !r.str("part").isEmpty { Text(r.str("part")).font(.caption).foregroundStyle(Theme.dim) }
                                    }
                                }
                            }
                        }
                    }
                }
                if !l.str("safety").isEmpty {
                    Label(l.str("safety"), systemImage: "bolt.fill").font(.callout).foregroundStyle(Theme.warn)
                }
                if l["sim"] != nil && l["sim"]?.isNull == false {
                    Text("This lesson has an interactive simulator. It comes to the native app in a later update; it is in the web app meanwhile.")
                        .font(.caption).foregroundStyle(Theme.dim)
                }
            }

            ForEach(Array(steps.enumerated()), id: \.offset) { i, s in
                stepCard(l, s, i, done: doneSteps.contains(i))
            }

            leetcode(l)

            if !l.str("deliverable").isEmpty {
                Card(title: "Deliverable") { Text(MD.inline(l.str("deliverable"))).font(.callout) }
            }

            Card(title: "Notes") {
                TextEditor(text: $notes).frame(minHeight: 70).scrollContentBackground(.hidden)
                    .padding(6).background(Theme.plate2, in: RoundedRectangle(cornerRadius: 8))
                    .onAppear { notes = p.str("notes") }
                Button("Save notes") { C.setNotes(store, l.id, notes) }.buttonStyle(.borderless)
            }

            if let problem { Text(problem).font(.callout).foregroundStyle(Theme.red) }
            Button { complete(l) } label: {
                Label(retake ? "Save retake" : status == "done" ? "Complete again" : "Complete", systemImage: "checkmark").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent).controlSize(.large)
        }
        .fileExporter(isPresented: $exporting, document: exportDoc, contentType: exportType, defaultFilename: exportName) { _ in }
        .alert("Exit ticket not marked", isPresented: $askUnmarked) {
            Button("Complete without score") { pending.score = nil; askTime(l) }
            Button("Cancel", role: .cancel) {}
        } message: { Text("Mark each exit-ticket answer right or wrong first: that score decides mastery (80%). Or complete without a score.") }
        .alert("How long did it take?", isPresented: $askMinutes) {
            TextField("Minutes", text: $minutesText).numberKeyboard()
            Button("Complete") { pending.minutes = number(minutesText).map { max(1, Int($0)) } ?? Int(l.num("minutes")); checkEarly(l) }
            Button("Cancel", role: .cancel) {}
        }
        .alert("Finish early?", isPresented: $askEarly) {
            Button("Finish anyway") { finish(l) }
            Button("Cancel", role: .cancel) {}
        } message: { Text("Planned \(Int(l.num("minutes"))) min, you did \(pending.minutes ?? 0). Finish anyway?") }
        .alert(result ?? "", isPresented: Binding(get: { result != nil }, set: { if !$0 { result = nil; dismiss() } })) {
            Button("OK") {}
        }
    }

    // MARK: steps

    @ViewBuilder private func stepCard(_ l: Row, _ s: [String: JSON], _ i: Int, done: Bool) -> some View {
        let kind = s.str("kind")
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("\(roman(i + 1)) · \(stepLabel[kind] ?? kind) · \(Int(s.num("minutes"))) min", systemImage: stepIcon[kind] ?? "book")
                    .font(.caption.weight(.semibold)).foregroundStyle(Theme.dim)
                Spacer()
                Button { Course.shared.setStepDone(store, l.id, i, !done) } label: {
                    Image(systemName: done ? "checkmark.circle.fill" : "circle").font(.title3).foregroundStyle(done ? Theme.ok : Theme.dim)
                }
                .buttonStyle(.borderless)
            }
            Text(s.str("title")).font(.title3.weight(.semibold))
            if !s.str("body").isEmpty { MarkdownView(text: s.str("body")) }
            if kind == "warmup" {
                warmup(l, s, i)
            } else if let qs = s["questions"]?.array, !qs.isEmpty {
                questions(qs.compactMap { $0.object }, i, scored: kind == "exit")
            }
            ForEach(Array((s["tasks"]?.array ?? []).compactMap { $0.object }.enumerated()), id: \.offset) { j, t in
                task(l, t, i, j, diag: l.str("kind") == "diagnostic")
            }
            if !s.str("teachBack").isEmpty {
                Text("TEACH BACK").font(.caption.weight(.semibold)).tracking(1.2).foregroundStyle(Theme.dim)
                Text(MD.inline(s.str("teachBack"))).font(.callout)
                answerField("\(i)-tb", placeholder: "Three sentences for a first-year student…")
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.plate, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(done ? Theme.ok.opacity(0.4) : Theme.line))
        .opacity(done ? 0.85 : 1)
    }

    private func answerField(_ k: String, placeholder: String) -> some View {
        TextField(placeholder, text: Binding(get: { st.answers[k] ?? "" }, set: { st.answers[k] = $0 }), axis: .vertical)
            .lineLimit(2...6).textFieldStyle(.plain)
            .padding(8).background(Theme.plate2, in: RoundedRectangle(cornerRadius: 8))
    }

    @ViewBuilder private func warmup(_ l: Row, _ s: [String: JSON], _ i: Int) -> some View {
        let C = Course.shared
        let ids = s["cardIds"]?.array?.compactMap { $0.string } ?? C.dueCards(store, limit: 5, track: l.str("track")).map(\.id)
        let cards = ids.compactMap { store.get("cards", $0) }
        if !cards.isEmpty {
            Text("\(cards.count) due review card\(cards.count > 1 ? "s" : "") from \(l.str("track") == "mixed" ? "all tracks" : C.trackName(l.str("track"))).")
                .font(.caption).foregroundStyle(Theme.muted)
            ForEach(cards, id: \.id) { c in
                let k = "card-\(c.id)"
                VStack(alignment: .leading, spacing: 6) {
                    MarkdownView(text: c.str("front")).font(.callout.weight(.semibold))
                    if st.revealed.contains(k) {
                        answerBox(c.str("back"))
                        HStack { ForEach(["again", "hard", "good", "easy"], id: \.self) { g in chip(g) { C.gradeCard(store, c.id, g) } } }
                    } else {
                        chip("show answer") { st.revealed.insert(k) }
                    }
                }
                .qaBox()
            }
        } else {
            let all = (s["questions"]?.array ?? []).compactMap { $0.object }
            let skipped = all.filter { !$0.str("from").isEmpty && !C.completed(store, $0.str("from")) }.count
            let qs = recall(l, all)
            if skipped > 0 {
                Text("\(skipped) question\(skipped > 1 ? "s" : "") skipped: \(skipped > 1 ? "they come" : "it comes") from a lesson you haven't done yet.")
                    .font(.caption).foregroundStyle(Theme.dim)
            }
            if qs.isEmpty {
                Text("Nothing to recall yet: everything today is new. Go straight to the first example.").font(.callout).foregroundStyle(Theme.muted)
            } else {
                questions(qs, i, scored: false)
            }
        }
    }

    /// One path, no guessing: recall only asks about lessons you have finished.
    private func recall(_ l: Row, _ all: [[String: JSON]]) -> [[String: JSON]] {
        let C = Course.shared
        var qs = all.filter { $0.str("from").isEmpty || C.completed(store, $0.str("from")) }
        if qs.count < 2 { qs += C.recallFromFinished(store, track: l.str("track"), 2 - qs.count, skip: Set(qs.map { $0.str("q") })) }
        return qs
    }

    @ViewBuilder private func questions(_ qs: [[String: JSON]], _ i: Int, scored: Bool) -> some View {
        let C = Course.shared
        ForEach(Array(qs.enumerated()), id: \.offset) { j, q in
            let k = "\(i)-\(j)"
            let mark = st.marks[k]
            VStack(alignment: .leading, spacing: 6) {
                if !q.str("from").isEmpty, let src = C.lesson(store, q.str("from")) {
                    Text("from \(src.str("title"))").font(.caption2.monospaced()).foregroundStyle(Theme.dim)
                }
                MarkdownView(text: q.str("q"))
                answerField("q-\(k)", placeholder: "Your answer")
                if st.revealed.contains(k) {
                    answerBox(q.str("a"))
                    if scored && !st.unknown.contains(k) {
                        HStack {
                            chip("right", on: mark == true) { st.marks[k] = true }
                            chip("wrong", on: mark == false) { st.marks[k] = false }
                        }
                    }
                    if st.unknown.contains(k) {
                        Text("Read the answer above, then try it again tomorrow: it comes back as a card.").font(.caption).foregroundStyle(Theme.dim)
                    }
                } else {
                    HStack {
                        chip("show answer") { st.revealed.insert(k) }
                        chip("don't know yet") { st.unknown.insert(k); st.revealed.insert(k); if scored { st.marks[k] = false } }
                    }
                }
            }
            .qaBox(mark: mark)
        }
        if scored {
            let marks = qs.indices.map { st.marks["\(i)-\($0)"] }
            Text("\(marks.filter { $0 == true }.count)/\(qs.count) right · \(marks.filter { $0 != nil }.count)/\(qs.count) marked · mastery needs \(Int((Double(qs.count) * 0.8).rounded(.up)))")
                .font(.caption.monospaced()).foregroundStyle(Theme.muted)
        }
    }

    @ViewBuilder private func task(_ l: Row, _ t: [String: JSON], _ i: Int, _ j: Int, diag: Bool) -> some View {
        let k = "\(i)-\(j)"
        let hints = (t["hints"]?.array ?? []).compactMap { $0.string }
        let shown = st.hints[k] ?? 0
        let solShown = st.revealed.contains("sol-\(k)")
        VStack(alignment: .leading, spacing: 8) {
            MarkdownView(text: t.str("prompt"))
            if !t.str("from").isEmpty {
                Text("from \(t.str("fromTitle").isEmpty ? t.str("from") : t.str("fromTitle"))").font(.caption2.monospaced()).foregroundStyle(Theme.dim)
            }
            ForEach(Array(hints.prefix(shown).enumerated()), id: \.offset) { n, h in
                HStack(alignment: .top, spacing: 8) {
                    Text("hint \(n + 1)").font(.caption.monospaced()).foregroundStyle(Theme.gold)
                    MarkdownView(text: h)
                }
            }
            if !t.str("check").isEmpty {
                DisclosureGroup { MarkdownView(text: t.str("check")) } label: { Text("how to check").font(.caption.monospaced()).foregroundStyle(Theme.muted) }
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    if !hints.isEmpty {
                        chip(shown >= hints.count ? "no more hints" : "hint \(shown + 1)/\(hints.count)") { st.hints[k] = shown + 1; st.hintsUsed += 1 }
                            .disabled(shown >= hints.count)
                    }
                    if !t.str("solution").isEmpty && !solShown {
                        chip("I've tried; show it") { st.revealed.insert("sol-\(k)"); st.solutions += 1 }
                    }
                    if !t.str("lang").isEmpty && !t.str("tests").isEmpty {
                        chip("starter file") {
                            let f = Course.shared.starterFile(l, t, i, j)
                            exportDoc = TextFileDoc(text: f.text)
                            exportName = f.name
                            exportType = f.name.hasSuffix(".cpp") ? .cPlusPlusSource : .pythonScript
                            exporting = true
                        }
                    }
                }
            }
            if diag {
                HStack { ForEach(["solved", "partly", "stuck"], id: \.self) { v in chip(v, on: st.diag[k] == v) { st.diag[k] = v } } }
            }
            if solShown { answerBox(t.str("solution")) }
        }
        .qaBox()
    }

    @ViewBuilder private func leetcode(_ l: Row) -> some View {
        let probs = (l["leetcode"]?.array ?? []).compactMap { $0.object }
        if !probs.isEmpty {
            let done = store.setting("leetcode")?.object ?? [:]
            Card(title: "LeetCode · optional") {
                Text("Extra practice on leetcode.com. Each problem needs only what you've learned so far, and says where. Try it there first.")
                    .font(.caption).foregroundStyle(Theme.muted)
                ForEach(Array(probs.enumerated()), id: \.offset) { _, p in
                    let slug = p.str("url").components(separatedBy: "/problems/").last?.trimmingCharacters(in: CharacterSet(charactersIn: "/")) ?? p.str("url")
                    let state = done[slug]?["state"]?.string
                    VStack(alignment: .leading, spacing: 6) {
                        if let u = URL(string: p.str("url")) {
                            Link(destination: u) {
                                VStack(alignment: .leading) {
                                    Text(p.str("title")).font(.callout.weight(.semibold))
                                    Text("\(p.str("level")) · uses \(p.str("uses"))").font(.caption).foregroundStyle(Theme.dim)
                                }
                            }
                        }
                        HStack {
                            ForEach(["solved", "stuck"], id: \.self) { v in
                                chip(v, on: state == v) {
                                    var all = store.setting("leetcode")?.object ?? [:]
                                    if state == v { all[slug] = nil } else { all[slug] = .object(["state": .string(v), "at": .string(Store.isoNow()), "lessonId": .string(l.id)]) }
                                    store.setSetting("leetcode", .object(all))
                                }
                            }
                        }
                    }
                    .qaBox()
                }
            }
        }
    }

    // MARK: completing

    private func complete(_ l: Row) {
        let C = Course.shared
        problem = nil
        pending = (nil, nil)
        let steps = (l["steps"]?.array ?? []).compactMap { $0.object }
        if l.str("kind") == "diagnostic" {
            let keys = steps.enumerated().flatMap { i, s in (s["tasks"]?.array ?? []).indices.map { "\(i)-\($0)" } }
            let v = keys.map { st.diag[$0] }
            if v.contains(where: { $0 == nil }) { problem = "Mark every problem solved, partly or stuck first."; return }
            let pts = v.reduce(0.0) { $0 + ($1 == "solved" ? 1 : $1 == "partly" ? 0.5 : 0) }
            C.recordDiagnostic(store, score: pts, total: keys.count, marks: v.compactMap { $0 })
            if retake {
                let hist = C.diagnosticHistory(store)
                let first = hist.first?["results"]?["score"]?.double ?? pts
                result = hist.count > 1 ? "Diagnostic: \(fmt(first, 1))/\(keys.count) then, \(fmt(pts, 1))/\(keys.count) now." : "Diagnostic saved: \(fmt(pts, 1))/\(keys.count)."
                return
            }
        } else if let ei = steps.firstIndex(where: { $0.str("kind") == "exit" && !($0["questions"]?.array ?? []).isEmpty }) {
            let n = steps[ei]["questions"]?.array?.count ?? 0
            let marks = (0..<n).map { st.marks["\(ei)-\($0)"] }
            if marks.contains(where: { $0 == nil }) { askUnmarked = true; return }
            pending.score = Double(marks.filter { $0 == true }.count) / Double(n)
        }
        askTime(l)
    }

    private func askTime(_ l: Row) {
        let C = Course.shared
        if let t = C.timer(store, for: l.id) {
            pending.minutes = max(1, Int((C.elapsed(t) / 60).rounded()))
            checkEarly(l)
        } else {
            minutesText = "\(Int(l.num("minutes")))"
            askMinutes = true
        }
    }

    private func checkEarly(_ l: Row) {
        if Double(pending.minutes ?? 0) < l.num("minutes") * 0.75 { askEarly = true } else { finish(l) }
    }

    private func finish(_ l: Row) {
        let C = Course.shared
        if notes != (C.progress(store, l.id)?.str("notes") ?? "") { C.setNotes(store, l.id, notes) }
        let r = C.completeLesson(store, lessonId: l.id, minutes: pending.minutes, score: pending.score, notes: notes, hintsUsed: st.hintsUsed, solutionsRevealed: st.solutions)
        result = r.mastered
            ? "Done\(r.score.map { " · \(Int(($0 * 100).rounded()))%" } ?? ""). \(mins(Double(r.minutes))) logged."
            : "Flagged at \(Int(((r.score ?? 0) * 100).rounded()))%: cards come back tomorrow and it returns in the next buffer slot."
    }
}

/// Stopwatch with the planned minutes and the step you should be on.
struct TimerCard: View {
    let lesson: Row
    let steps: [[String: JSON]]
    let status: String
    @EnvironmentObject var store: Store
    @State private var undo: JSON?

    var body: some View {
        let C = Course.shared
        let t = C.timer(store, for: lesson.id)
        let planned = lesson.num("minutes")
        Card(title: "Timer", trailing: "\(Int(planned)) min planned") {
            TimelineView(.periodic(from: .now, by: 1)) { _ in
                let sec = Int(t.map { C.elapsed($0) } ?? 0)
                let m = Double(sec) / 60
                VStack(alignment: .leading, spacing: 6) {
                    Text(String(format: "%02d:%02d", sec / 60, sec % 60)).font(.system(size: 40, weight: .light, design: .monospaced))
                        .foregroundStyle(t == nil ? Theme.dim : t?.pausedAt != nil ? Theme.muted : Theme.gold)
                    Bar(value: planned > 0 ? m / planned : 0)
                    Text(now(t, m)).font(.caption).foregroundStyle(Theme.muted)
                }
            }
            HStack {
                if t == nil || t?.pausedAt != nil {
                    Button(t != nil || status == "in progress" ? "Resume" : "Start") { C.startLesson(store, lesson.id) }.buttonStyle(.borderedProminent)
                } else {
                    Button("Pause") { C.pauseLesson(store) }.buttonStyle(.bordered)
                }
                if t != nil {
                    Button("Reset") { undo = store.setting("lessonTimer"); C.resetTimer(store) }.buttonStyle(.bordered)
                }
                if let u = undo, t == nil {
                    Button("Undo reset") { store.setSetting("lessonTimer", u); undo = nil }.buttonStyle(.borderless)
                }
            }
        }
    }

    private func now(_ t: Course.LessonTimer?, _ m: Double) -> String {
        guard let t else { return status == "done" ? "completed" : "not started" }
        var at = 0.0
        var line = "\(Int(lesson.num("minutes"))) min done · complete when ready"
        for s in steps {
            let to = at + s.num("minutes")
            if m >= at && m < to { line = "\(s.str("title")) · \(Int((to - m).rounded(.up))) min left in step"; break }
            at = to
        }
        return t.pausedAt != nil ? "paused · \(line)" : line
    }
}

// MARK: small pieces

func chip(_ label: String, on: Bool = false, _ action: @escaping () -> Void) -> some View {
    Button(action: action) {
        Text(label).font(.caption.weight(.semibold))
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(on ? Theme.gold.opacity(0.25) : Theme.plate2, in: Capsule())
            .overlay(Capsule().stroke(on ? Theme.gold : Theme.line))
            .foregroundStyle(on ? Theme.gold : Theme.text)
    }
    .buttonStyle(.plain)
}

func answerBox(_ text: String) -> some View {
    MarkdownView(text: text)
        .padding(10)
        .background(Theme.steel.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
        .overlay(alignment: .leading) { Rectangle().fill(Theme.steel).frame(width: 2) }
}

extension View {
    func qaBox(mark: Bool? = nil) -> some View {
        padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.plate2.opacity(0.5), in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(mark == true ? Theme.ok.opacity(0.6) : mark == false ? Theme.red.opacity(0.6) : Theme.line.opacity(0.6)))
    }
}

// MARK: Review cards (evening slot)

struct ReviewView: View {
    @EnvironmentObject var store: Store
    @State private var flipped = false
    @State private var well = ""
    @State private var change = ""
    @State private var saved: String?

    var body: some View {
        let _ = store.revision
        let C = Course.shared
        let due = C.dueCards(store, limit: 200)
        let card = due.first
        let tomorrow = Day.add(Day.today, 1)
        let log = C.dayLog(store)
        Screen(title: "Review") {
            Text("\(due.count) due · space reveals · 1 again · 2 hard · 3 good · 4 easy").font(.caption.monospaced()).foregroundStyle(Theme.muted)
            if let card {
                Card {
                    HStack(spacing: 6) {
                        Circle().fill(trackColor(card.str("track"))).frame(width: 8, height: 8)
                        Text("\(C.trackName(card.str("track"))) · box \(Int(card.num("box")))").font(.caption.monospaced()).foregroundStyle(Theme.muted)
                    }
                    MarkdownView(text: card.str("front")).font(.title3)
                    if flipped {
                        answerBox(card.str("back"))
                        HStack {
                            ForEach(Array(["again", "hard", "good", "easy"].enumerated()), id: \.offset) { n, g in
                                Button { flipped = false; C.gradeCard(store, card.id, g) } label: {
                                    Text("\(n + 1) \(g)").frame(maxWidth: .infinity)
                                }
                                .buttonStyle(.bordered)
                                .keyboardShortcut(KeyEquivalent(Character("\(n + 1)")), modifiers: [])
                            }
                        }
                    } else {
                        Button("Show answer") { flipped = true }.buttonStyle(.borderedProminent).keyboardShortcut(.space, modifiers: [])
                    }
                }
            } else {
                Card { Text("No cards due. \(store.count("cards") > 0 ? "Next ones come back on their dates." : "Cards appear as you complete lessons.")").font(.callout) }
            }

            Card(title: "Log the day") {
                TextField("What went well", text: $well).textFieldStyle(.roundedBorder)
                TextField("What to change", text: $change).textFieldStyle(.roundedBorder)
                Text("TOMORROW").font(.caption.weight(.semibold)).tracking(1.2).foregroundStyle(Theme.dim)
                let plan = C.planFor(store, tomorrow)
                if plan.isEmpty { Text("Nothing scheduled.").font(.caption).foregroundStyle(Theme.muted) }
                ForEach(plan, id: \.self) { Text($0).font(.caption.monospaced()) }
                Button(log["confirmedAt"] != nil ? "Confirmed ✓ (save again)" : "Save log and confirm tomorrow") {
                    C.saveDayLog(store, Day.today, well: well, change: change, plan: plan)
                    saved = "Tomorrow: \(plan.first ?? "free")"
                }
                .buttonStyle(.borderedProminent)
                if let saved { Text(saved).font(.caption).foregroundStyle(Theme.ok) }
            }
            .onAppear { well = log["well"]?.string ?? ""; change = log["change"]?.string ?? "" }
        }
    }
}

// MARK: Weekly test (Sunday)

struct WeeklyTestView: View {
    @EnvironmentObject var store: Store
    @State private var qs: [[String: String]]?
    @State private var answers: [Int: String] = [:]
    @State private var revealed: Set<Int> = []
    @State private var unknown: Set<Int> = []
    @State private var marks: [Int: Bool] = [:]
    @State private var message: String?

    var body: some View {
        let _ = store.revision
        let C = Course.shared
        let w = max(1, C.weekOf(store))
        let list = qs ?? []
        let done = C.testResults(store).first { Int($0.num("week")) == w }
        Screen(title: "Weekly test") {
            Text("Week \(w) · \(list.count) questions from this week's exit tickets plus earlier cards, mixed across tracks. Answer from memory, then reveal and mark. Under 70% in a track flags that track's lessons for Monday.")
                .font(.callout).foregroundStyle(Theme.muted)
            if let done {
                Text("saved: " + (done["scores"]?.array ?? []).map { "\(C.trackName($0["track"]?.string)) \(Int($0["right"]?.double ?? 0))/\(Int($0["total"]?.double ?? 0))" }.joined(separator: " · "))
                    .font(.caption.monospaced()).foregroundStyle(Theme.gold)
            }
            if list.isEmpty {
                Card { Text("No lessons completed this week yet, so there is nothing to test. Clear your review cards instead.").font(.callout).foregroundStyle(Theme.muted) }
            }
            ForEach(Array(list.enumerated()), id: \.offset) { j, q in
                let mark = marks[j]
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        Circle().fill(trackColor(q["track"])).frame(width: 8, height: 8)
                        Text("\(j + 1). \(C.trackName(q["track"]))").font(.caption.monospaced()).foregroundStyle(Theme.muted)
                    }
                    MarkdownView(text: q["q"] ?? "")
                    TextField("Answer", text: Binding(get: { answers[j] ?? "" }, set: { answers[j] = $0 }), axis: .vertical)
                        .lineLimit(2...5).textFieldStyle(.plain).padding(8).background(Theme.plate2, in: RoundedRectangle(cornerRadius: 8))
                    if revealed.contains(j) {
                        answerBox(q["a"] ?? "")
                        if !unknown.contains(j) {
                            HStack {
                                chip("right", on: mark == true) { marks[j] = true }
                                chip("wrong", on: mark == false) { marks[j] = false }
                            }
                        }
                    } else {
                        HStack {
                            chip("show answer") { revealed.insert(j) }
                            chip("don't know yet") { unknown.insert(j); revealed.insert(j); marks[j] = false }
                        }
                    }
                }
                .qaBox(mark: mark)
            }
            if let message { Text(message).font(.callout).foregroundStyle(Theme.gold) }
            Button("Save scores") {
                guard !list.isEmpty else { return }
                if list.indices.contains(where: { marks[$0] == nil }) { message = "Mark every question first."; return }
                var by: [String: (Int, Int)] = [:]
                var order: [String] = []
                for (j, q) in list.enumerated() {
                    let tr = q["track"] ?? ""
                    if by[tr] == nil { order.append(tr) }
                    let cur = by[tr] ?? (0, 0)
                    by[tr] = (cur.0 + (marks[j] == true ? 1 : 0), cur.1 + 1)
                }
                let weak = C.recordTest(store, week: w, scores: order.map { (track: $0, right: by[$0]!.0, total: by[$0]!.1) })
                message = weak.isEmpty ? "Saved. Every track at 70% or more." : "Saved. Flagged for Monday: \(weak.map { C.trackName($0) }.joined(separator: ", "))."
            }
            .buttonStyle(.borderedProminent)
            .disabled(list.isEmpty)
        }
        .onAppear { if qs == nil { qs = C.testQuestions(store, week: w) } }
    }
}

// MARK: Ship & weekly review (Sunday)

struct ShipView: View {
    @EnvironmentObject var store: Store
    @State private var change = ""
    private let items = [
        ("push", "Push the week's project (README, tests passing, clean commit)."),
        ("log", "Write the weekly log in learning-log: what you built, what was hard."),
        ("pace", "Review pace per track (below)."),
        ("teach", "Confirm next week's teaching topics and dates."),
        ("ics", "Put next week in the Calendar."),
    ]

    var body: some View {
        let _ = store.revision
        let C = Course.shared
        let w = max(0, C.weekOf(store))
        let key = String(format: "courseShip:w%02d", w)
        let v = store.setting(key)?.object ?? [:]
        let pace = C.pace(store).values.sorted { $0.name < $1.name }
        let next = w + 1
        let needPrep = next >= 16 && C.weekMeta(next)?["consolidation"]?.bool != true && !C.hasWeek(store, next)
        Screen(title: "Ship & weekly review") {
            Card(title: "Week \(w)") {
                ForEach(items.indices, id: \.self) { n in
                    let id = items[n].0, label = items[n].1
                    Toggle(isOn: Binding(get: { v[id]?.bool ?? false }, set: { on in
                        var cur = store.setting(key)?.object ?? [:]; cur[id] = .bool(on); store.setSetting(key, .object(cur))
                    })) { Text(label).font(.callout) }
                }
                TextField("One thing to change next week", text: $change).textFieldStyle(.roundedBorder)
                    .onSubmit { var cur = store.setting(key)?.object ?? [:]; cur["change"] = .string(change); store.setSetting(key, .object(cur)) }
                Button("Save") { var cur = store.setting(key)?.object ?? [:]; cur["change"] = .string(change); store.setSetting(key, .object(cur)) }.buttonStyle(.borderless)
            }
            .onAppear { change = v["change"]?.string ?? "" }
            Card(title: "Pace") {
                if pace.isEmpty { Text("Pace starts counting in Week 1.").font(.callout).foregroundStyle(Theme.muted) }
                ForEach(pace, id: \.track) { t in
                    HStack {
                        Circle().fill(trackColor(t.track)).frame(width: 8, height: 8)
                        VStack(alignment: .leading) {
                            Text(t.name).font(.callout.weight(.semibold))
                            Text("\(t.done) done of \(t.expected) scheduled so far").font(.caption).foregroundStyle(Theme.dim)
                        }
                        Spacer()
                        let c = C.paceColor(store, t)
                        Text(t.label).font(.caption.weight(.semibold)).foregroundStyle(c == "green" ? Theme.ok : c == "yellow" ? Theme.gold : Theme.red)
                    }
                }
                Text("Behind: continue where you are, nothing is skipped; Friday's buffer goes to the most-behind track. Ahead: pull next week forward, never add a subject.")
                    .font(.caption).foregroundStyle(Theme.muted)
            }
            if needPrep {
                NavigationLink { PrepareView(week: next) } label: { Label("Prepare week \(next)", systemImage: "sparkles") }.buttonStyle(.borderedProminent)
            }
        }
    }
}

// MARK: Consolidation: redo flagged practice

struct FlaggedView: View {
    @EnvironmentObject var store: Store
    var body: some View {
        let _ = store.revision
        let C = Course.shared
        let flagged = store.all("courseProgress").filter { $0.str("status") == "flagged" }.compactMap { C.lesson(store, $0.str("lessonId")) }
        Screen(title: "Redo flagged practice") {
            if flagged.isEmpty {
                Card { Text("Nothing flagged. Use the time for review cards and your weakest track's practice tasks.").font(.callout).foregroundStyle(Theme.muted) }
            }
            ForEach(flagged, id: \.id) { l in
                NavigationLink { LessonView(lessonId: l.id) } label: {
                    HStack {
                        Circle().fill(trackColor(l.str("track"))).frame(width: 8, height: 8)
                        VStack(alignment: .leading) {
                            Text(l.str("title")).font(.callout.weight(.semibold))
                            Text("\(C.trackName(l.str("track"))) · week \(l.str("week"))").font(.caption).foregroundStyle(Theme.dim)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").foregroundStyle(Theme.dim)
                    }
                    .padding(12).background(Theme.plate, in: RoundedRectangle(cornerRadius: 12)).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }
}

// MARK: Prepare week N (weeks 16+, written by the AI)

struct PrepareView: View {
    let week: Int
    @EnvironmentObject var store: Store
    var body: some View {
        let C = Course.shared
        let w = C.weekMeta(week)
        Screen(title: "Prepare week \(week)") {
            Card {
                Text(w?["theme"]?.string ?? "").font(.callout)
                if C.hasWeek(store, week) {
                    Text("This week is ready.").font(.callout.monospaced()).foregroundStyle(Theme.gold)
                } else {
                    Text("Yaver's AI writes this week's day-level lessons from the outline and saves them to the synced copy, so every device gets them. The AI assistant is coming to the native app in the next update; until then, prepare the week in the web app and it arrives here through sync.")
                        .font(.callout).foregroundStyle(Theme.muted)
                }
            }
        }
    }
}
