// Study: minutes and streak, the ML plan's current phase with its milestones,
// and course progress (the course itself is CourseView).
import SwiftUI

struct StudyView: View {
    @EnvironmentObject var store: Store
    @State private var logging = false

    var body: some View {
        let _ = store.revision
        let today = store.studyMinutes(Day.today)
        let ws = Day.weekStart()
        let week = store.all("sessions").filter { $0.str("date") >= ws }.reduce(0) { $0 + $1.num("minutes") }
        let course = store.courseCounts()

        Screen(title: "Study") {
            Card(title: "Today") {
                HStack(alignment: .top) {
                    Stat(value: mins(today), label: "of \(mins(store.dailyStudyGoal))", color: today >= store.dailyStudyGoal ? Theme.ok : Theme.text)
                    Stat(value: mins(week), label: "this week")
                    Stat(value: "\(store.studyStreak())", label: "day streak")
                }
                Bar(value: today / max(1, store.dailyStudyGoal))
            }

            StudyTimerCard()

            if let plan = store.plan() {
                Card(title: plan.title, trailing: "week \(plan.week)") {
                    Text(plan.phase).font(.headline)
                    if let sid = plan.subjectId {
                        let ms = store.milestones(sid)
                        Bar(value: Double(ms.filter { $0.flag("done") }.count) / Double(max(1, ms.count)), color: Theme.steel)
                        ForEach(ms, id: \.id) { m in
                            Button {
                                var r = m
                                r["done"] = .bool(!m.flag("done"))
                                r["doneAt"] = m.flag("done") ? .null : .string(Store.isoNow())
                                store.put("milestones", r)
                            } label: {
                                HStack(alignment: .top) {
                                    Image(systemName: m.flag("done") ? "checkmark.square.fill" : "square").foregroundStyle(m.flag("done") ? Theme.ok : Theme.dim)
                                    Text(m.str("title")).foregroundStyle(m.flag("done") ? Theme.dim : Theme.text).multilineTextAlignment(.leading)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }

            Card(title: "Course") {
                HStack(alignment: .top) {
                    Stat(value: "\(course.done)", label: "lessons done")
                    Stat(value: "\(course.flagged)", label: "to redo", color: course.flagged > 0 ? Theme.warn : Theme.text)
                    Stat(value: "\(course.cardsDue)", label: "cards due")
                }
                NavigationLink { CourseView() } label: { Label("Open the course", systemImage: "graduationcap") }.buttonStyle(.bordered)
            }

            let subjects = store.all("subjects").map { s in (s, store.all("sessions").filter { $0.str("subjectId") == s.id }.reduce(0) { $0 + $1.num("minutes") }) }
                .filter { $0.1 > 0 }.sorted { $0.1 > $1.1 }
            if !subjects.isEmpty {
                Card(title: "By subject") {
                    ForEach(subjects.map { $0.0 }, id: \.id) { s in
                        HStack {
                            Text(s.str("name")).foregroundStyle(Theme.muted)
                            Spacer()
                            Text(mins(subjects.first { $0.0.id == s.id }?.1 ?? 0)).font(.callout.monospacedDigit())
                        }
                    }
                }
            }
        }
        .toolbar { Button { logging = true } label: { Label("Log study", systemImage: "plus") } }
        .sheet(isPresented: $logging) { NavigationStack { StudyForm() }.sheetSize() }
    }
}

struct StudyForm: View {
    @EnvironmentObject var store: Store
    @State private var subject = ""
    @State private var minutes = "30"
    @State private var note = ""

    var body: some View {
        Form {
            TextField("Subject", text: $subject)
            TextField("Minutes", text: $minutes).numberKeyboard()
            TextField("Note", text: $note)
        }
        .navigationTitle("Log study")
        .onAppear { if subject.isEmpty, let p = store.plan() { subject = store.all("subjects").first { $0.id == p.subjectId }?.str("name") ?? "" } }
        .sheetButtons(canSave: (number(minutes) ?? 0) > 0) {
            let s = store.subject(named: subject)
            store.put("sessions", ["subjectId": .string(s.id), "minutes": .number(number(minutes) ?? 0), "date": .string(Day.today), "note": .string(note)])
        }
    }
}

/// The study stopwatch (web Study tab's timer): pick a subject and minutes, it runs in
/// focus mode; Stop logs the minutes as a session.
struct StudyTimerCard: View {
    @EnvironmentObject var store: Store
    @Environment(\.focusActive) private var inFocus
    @State private var subject = ""
    @State private var undo: JSON?

    var body: some View {
        let _ = store.revision
        let t = StudyTimer.get(store)
        Card(title: "Timer", trailing: t.map { "\($0.subject) · \(Int($0.planned)) min" } ?? "") {
            if let t {
                TimelineView(.periodic(from: .now, by: 1)) { _ in
                    let sec = Int(StudyTimer.elapsed(t))
                    let remain = Int(t.planned) * 60 - sec
                    VStack(alignment: .leading, spacing: 6) {
                        Text(String(format: "%02d:%02d", sec / 60, sec % 60)).font(.system(size: 40, weight: .light, design: .monospaced))
                            .foregroundStyle(t.pausedAt != nil ? Theme.muted : Theme.gold)
                        Bar(value: Double(sec) / max(60, t.planned * 60))
                        Text((t.pausedAt != nil ? "paused · " : "") + (remain > 0 ? "\(Int((Double(remain) / 60).rounded(.up))) min left of \(Int(t.planned))" : "\(Int(t.planned)) min done · stop when ready"))
                            .font(.caption).foregroundStyle(Theme.muted)
                    }
                }
                HStack {
                    if t.pausedAt != nil {
                        Button("Resume") { StudyTimer.resume(store) }.buttonStyle(.borderedProminent)
                    } else {
                        Button("Pause") { StudyTimer.pause(store) }.buttonStyle(.bordered)
                    }
                    Button("Stop and log") {
                        if let r = StudyTimer.stop(store) { Nav.shared.show("Logged \(r.0) min · \(r.1)") }
                    }
                    .buttonStyle(.bordered)
                    Button("Reset") {
                        let before = store.setting("timer")
                        StudyTimer.save(store, nil)
                        if let b = before { Nav.shared.show("Timer reset") { store.setSetting("timer", b) } }
                    }
                    .buttonStyle(.borderless)
                    if !inFocus {
                        Spacer()
                        Button { focus() } label: { Label("Focus", systemImage: "scope") }.buttonStyle(.bordered)
                    }
                }
            } else {
                TextField("Subject, e.g. Algorithms", text: $subject)
                    .textFieldStyle(.roundedBorder)
                HStack {
                    ForEach([25, 45, 60, 90], id: \.self) { m in
                        Button("\(m)m") {
                            StudyTimer.start(store, subject: subject.trimmingCharacters(in: .whitespaces), planned: Double(m))
                            focus()
                        }
                        .buttonStyle(.bordered)
                    }
                }
                Text("Starts a stopwatch in focus mode. Stop logs the minutes.").font(.caption).foregroundStyle(Theme.dim)
            }
        }
        .onAppear {
            if subject.isEmpty {
                if let p = store.plan(), let n = store.all("subjects").first(where: { $0.id == p.subjectId })?.str("name") { subject = n }
                else { subject = store.all("subjects").first?.str("name") ?? "" }
            }
        }
    }

    private func focus() {
        if StudyTimer.get(store)?.pausedAt != nil { StudyTimer.resume(store) }
        if let f = StudyTimer.focus(store) { Nav.shared.startFocus(f) }
    }
}
