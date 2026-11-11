// Course overview (twin of js/views/course.js): the day as a timeline of slots,
// tracks with pace, the week calendar, teaching deadlines, tests and course settings.
import SwiftUI

extension Color {
    init(css: String) {
        let h = css.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        self = UInt32(h, radix: 16).map { Color(hex: $0) } ?? Theme.dim
    }
}

func trackColor(_ track: String?) -> Color {
    if track == "mixed" { return Theme.text }
    guard let track else { return Theme.dim }
    return Color(css: Course.shared.trackColor(track))
}

/// Where a slot or a link goes: a lesson or one of the course sessions.
struct SessionView: View {
    let target: String
    @EnvironmentObject var store: Store
    var body: some View {
        let C = Course.shared
        switch target {
        case "review": ReviewView()
        case "test": WeeklyTestView()
        case "ship": ShipView()
        case "flagged": FlaggedView()
        case "diagnostic":
            if let l = C.laneLessons(store, "setup").first(where: { $0.str("kind") == "diagnostic" }) { LessonView(lessonId: l.id, retake: C.status(store, l.id) == "done") }
        default:
            if target.hasPrefix("prepare-") { PrepareView(week: Int(target.dropFirst(8)) ?? 16) } else { LessonView(lessonId: target) }
        }
    }
}

/// Today's blocks, each opening its lesson.
struct TodayCard: View {
    @EnvironmentObject var store: Store
    var key = Day.today
    var title = "Today"
    var compact = false

    var body: some View {
        let C = Course.shared
        let d = C.day(store, key)
        let isToday = key == Day.today
        let now = Course.nowMin()
        let head = d.beforeStart ? "not started" : d.week == 0 ? "week 0 · setup" : "week \(d.week)\(d.consolidation ? " · consolidation" : " · phase \(d.phase ?? "")")"
        let nowIndex = isToday ? (d.slots.firstIndex { Course.toMin($0.start) > now } ?? d.slots.count) : -1
        Card(title: title, trailing: head) {
            if d.beforeStart {
                Text("The course starts \(C.startKey(store)). Week 0 (setup) begins four days earlier.").font(.callout).foregroundStyle(Theme.muted)
            }
            if !compact { WeekStrip(key: key) }
            ForEach(Array(d.slots.enumerated()), id: \.offset) { i, s in
                if i == nowIndex { NowLine() }
                slotRow(s, live: isToday && Course.toMin(s.start) <= now && Course.toMin(s.end) > now)
            }
            if nowIndex == d.slots.count { NowLine() }
        }
    }

    @ViewBuilder private func slotRow(_ s: Slot, live: Bool) -> some View {
        let C = Course.shared
        if s.type == "info" {
            if !compact {
                HStack(spacing: 10) { Text(s.start).font(.caption.monospacedDigit()).foregroundStyle(Theme.dim).frame(width: 44, alignment: .leading); Text(s.label).font(.caption).foregroundStyle(Theme.dim) }
            }
        } else if s.type == "fixed" {
            HStack(spacing: 10) { Text(s.start).font(.caption.monospacedDigit()).foregroundStyle(Theme.dim).frame(width: 44, alignment: .leading); Text("\(s.label) · \(s.start)–\(s.end)").font(.caption).foregroundStyle(Theme.muted) }
        } else {
            let row = HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(s.start).font(.callout.monospacedDigit())
                    Text("\(s.minutes)m").font(.caption2).foregroundStyle(Theme.dim)
                }
                .frame(width: 44, alignment: .leading)
                Circle().fill(trackColor(s.track)).frame(width: 8, height: 8).padding(.top, 6)
                VStack(alignment: .leading, spacing: 2) {
                    Text(C.slotTitle(s)).font(.callout.weight(.semibold)).foregroundStyle(s.status == "done" ? Theme.dim : Theme.text).multilineTextAlignment(.leading)
                    let sub = [s.label, s.reason ?? "", s.ahead ? "ahead" : "", s.urgent ? "teach by \(s.teachBy ?? "")" : ""].filter { !$0.isEmpty }.joined(separator: " · ")
                    Text(sub).font(.caption).foregroundStyle(s.urgent ? Theme.red : Theme.dim).multilineTextAlignment(.leading)
                }
                Spacer(minLength: 4)
                if let st = s.status { StatusPill(status: st) }
            }
            .padding(8)
            .background(live ? Theme.gold.opacity(0.12) : Color.clear, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(live ? Theme.gold.opacity(0.6) : Color.clear))
            if let t = C.target(s, key) {
                NavigationLink { SessionView(target: t) } label: { row.contentShape(Rectangle()) }.buttonStyle(.plain)
            } else {
                row.opacity(0.8)
            }
        }
    }
}

struct NowLine: View {
    var body: some View {
        HStack(spacing: 6) {
            Text("now").font(.caption2.weight(.semibold)).foregroundStyle(Theme.gold)
            Rectangle().fill(Theme.gold.opacity(0.6)).frame(height: 1)
        }
    }
}

struct StatusPill: View {
    let status: String
    var body: some View {
        let c: Color = status == "done" ? Theme.ok : status == "flagged" ? Theme.warn : status == "in progress" ? Theme.gold : Theme.dim
        Text(status == "todo" ? "to do" : status).font(.caption2.weight(.semibold))
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(c.opacity(0.15), in: Capsule()).foregroundStyle(c)
    }
}

/// Mon–Sun: lessons finished each day of the week.
struct WeekStrip: View {
    @EnvironmentObject var store: Store
    let key: String
    var body: some View {
        let C = Course.shared
        let w = C.weekOf(store, key)
        if w >= 1 {
            let ws = C.weekStartKey(store, w)
            let done = store.all("courseProgress").reduce(into: [String: Int]()) { acc, p in
                if let d = Store.parseISO(p.str("completedAt")) { acc[Day.key(d), default: 0] += 1 }
            }
            HStack(spacing: 4) {
                ForEach(0..<7, id: \.self) { i in
                    let k = Day.add(ws, i), n = done[k] ?? 0
                    Text(String(Array("MTWTFSS")[i])).font(.caption2.weight(.semibold))
                        .frame(maxWidth: .infinity).padding(.vertical, 4)
                        .background(n >= 4 ? Theme.gold.opacity(0.8) : n > 0 ? Theme.gold.opacity(0.3) : Theme.plate2, in: RoundedRectangle(cornerRadius: 4))
                        .foregroundStyle(n >= 4 ? Color.black : Theme.text)
                        .overlay(RoundedRectangle(cornerRadius: 4).stroke(k == Day.today ? Theme.gold : Color.clear))
                }
            }
        }
    }
}

struct CourseView: View {
    @EnvironmentObject var store: Store
    @State private var shownWeek: Int?
    @State private var editingTeach = false
    @State private var editingTimes = false
    @State private var editingOptions = false
    @State private var confirmReset = false

    var body: some View {
        let _ = store.revision
        let C = Course.shared
        let cur = max(0, C.weekOf(store))
        let wn = shownWeek ?? cur
        let tracks = C.trackSummaries(store)
        let tests = C.testResults(store)
        let dl = C.deadlines(store, within: 30)
        Screen(title: "Course") {
            if !C.active(store) {
                Card(title: "Yaver Course") {
                    Text("A day-by-day course in Python, C++, algorithms, math, AI and robotics: what to learn in each block, a full lesson for each, review cards, a weekly test and pace per track.").font(.callout).foregroundStyle(Theme.muted)
                    Button("Start the course") { C.activate(store) }.buttonStyle(.borderedProminent)
                }
            }
            Card {
                HStack(alignment: .top) {
                    Stat(value: C.weekOf(store) < 0 ? "–" : "\(C.weekOf(store))", label: "week / 63")
                    Stat(value: "\(C.dueCount(store))", label: "cards due")
                    Stat(value: "\(tracks.reduce(0) { $0 + $1.done })", label: "lessons done")
                }
                HStack {
                    NavigationLink { ReviewView() } label: { Label("Review cards", systemImage: "rectangle.stack") }.buttonStyle(.bordered)
                    NavigationLink { WeeklyTestView() } label: { Label("Weekly test", systemImage: "checklist") }.buttonStyle(.bordered)
                }
            }
            TodayCard()

            tracksGrid(tracks)
            weekCard(wn)
            deadlinesCard(dl)
            testsCard(tests)
            infoCards()
        }
        .sheet(isPresented: $editingTeach) { NavigationStack { TeachDatesForm() }.sheetSize() }
        .sheet(isPresented: $editingTimes) { NavigationStack { SlotTimesForm() }.sheetSize() }
        .sheet(isPresented: $editingOptions) { NavigationStack { CourseOptionsForm() }.sheetSize() }
        .confirmationDialog("Reset course progress?", isPresented: $confirmReset) {
            Button("Reset", role: .destructive) {
                for st in ["courseProgress", "cards", "courseTests"] { for r in store.all(st) { store.remove(st, r.id) } }
            }
        } message: { Text("Lesson progress, review cards and test results are deleted. Study sessions already logged stay.") }
    }

    @ViewBuilder private func tracksGrid(_ tracks: [Course.TrackSummary]) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 160), spacing: 10)], spacing: 10) {
            ForEach(tracks.filter { $0.total > 0 || $0.done > 0 }) { t in
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) { Circle().fill(Color(css: t.color)).frame(width: 8, height: 8); Text(t.name).font(.caption.weight(.semibold)) }
                    HStack {
                        Text("\(t.done)").font(.title3.weight(.semibold).monospacedDigit()) + Text(" / \(t.total)").font(.caption).foregroundColor(Theme.dim)
                        Spacer()
                        Text(t.pace).font(.caption2.weight(.semibold))
                            .foregroundStyle(t.paceColor == "green" ? Theme.ok : t.paceColor == "yellow" ? Theme.gold : Theme.red)
                    }
                    Bar(value: t.total > 0 ? Double(t.done) / Double(t.total) : 0, color: Color(css: t.color))
                    Text((t.mastery.map { "mastery \($0)%" } ?? "no scores yet") + (t.flagged.isEmpty ? "" : " · \(t.flagged.count) flagged"))
                        .font(.caption2.monospaced()).foregroundStyle(Theme.dim)
                }
                .padding(12)
                .background(Theme.plate, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line))
            }
        }
    }

    @ViewBuilder private func weekCard(_ wn: Int) -> some View {
        let C = Course.shared
        if let wk {
            let n = Int(wk["week"]?.double ?? 0)
            Card(title: "Week \(n)\(wk["consolidation"]?.bool == true ? " · consolidation" : "")") {
                HStack {
                    Button { shownWeek = max(0, wn - 1) } label: { Image(systemName: "chevron.left") }
                    Spacer()
                    Text("\(String((wk["start"]?.string ?? "").suffix(5))) → \(String((wk["end"]?.string ?? "").suffix(5)))").font(.caption.monospaced())
                    Spacer()
                    Button { shownWeek = min(63, wn + 1) } label: { Image(systemName: "chevron.right") }
                }
                .buttonStyle(.borderless)
                Text(wk["theme"]?.string ?? "").font(.callout).foregroundStyle(Theme.muted)
                WeekCalendar(week: n, start: wk["start"]?.string ?? "")
                if n >= 16 && wk["consolidation"]?.bool != true && !C.hasWeek(store, n) {
                    NavigationLink { PrepareView(week: n) } label: { Label("Prepare week \(n)", systemImage: "sparkles") }.buttonStyle(.bordered)
                }
            }
        }
    }

    @ViewBuilder private func deadlinesCard(_ dl: [(lesson: Row, teachBy: String, days: Int)]) -> some View {
        Card(title: "Teaching deadlines") {
            if dl.isEmpty {
                Text("No teaching dates set. Add the dates you teach each topic, and lessons close to their date and not prepared turn red.").font(.callout).foregroundStyle(Theme.muted)
            }
            ForEach(dl, id: \.lesson.id) { x in
                HStack {
                    VStack(alignment: .leading) {
                        Text(String(x.teachBy.suffix(5))).font(.callout.monospacedDigit()).foregroundStyle(x.days <= 7 ? Theme.red : Theme.text)
                        Text(x.days < 0 ? "\(-x.days)d ago" : "in \(x.days)d").font(.caption2).foregroundStyle(Theme.dim)
                    }.frame(width: 60, alignment: .leading)
                    VStack(alignment: .leading) {
                        Text(x.lesson.str("title")).font(.callout.weight(.semibold))
                        Text(x.days <= 7 ? "not prepared yet" : "prepare before then").font(.caption).foregroundStyle(Theme.dim)
                    }
                }
            }
            Button("Edit dates") { editingTeach = true }.buttonStyle(.borderless)
        }
    }

    @ViewBuilder private func testsCard(_ tests: [Row]) -> some View {
        let C = Course.shared
        Card(title: "Tests") {
            if tests.isEmpty { Text("The weekly test runs on Sundays at 05:50.").font(.callout).foregroundStyle(Theme.muted) }
            ForEach(tests, id: \.id) { t in
                HStack(alignment: .top) {
                    Text("wk \(Int(t.num("week")))").font(.callout.monospacedDigit()).frame(width: 50, alignment: .leading)
                    Text((t["scores"]?.array ?? []).map { "\(C.trackName($0["track"]?.string)) \(Int(((($0["right"]?.double ?? 0) / max(1, $0["total"]?.double ?? 1)) * 100).rounded()))%" }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(Theme.muted)
                }
            }
            let diag = C.diagnosticHistory(store)
            if !diag.isEmpty {
                Text("diagnostic: " + diag.map { "\(String(($0["date"]?.string ?? "").suffix(5))) \(fmt($0["results"]?["score"]?.double ?? 0, 1))/7" }.joined(separator: " → "))
                    .font(.caption.monospaced()).foregroundStyle(Theme.dim)
            }
        }
    }

    @ViewBuilder private func infoCards() -> some View {
        let C = Course.shared
        Card(title: "How pace works") {
            Text("Behind: the track continues where you are; nothing is skipped, and the Friday buffer goes to the most-behind track. Ahead: next week's lessons come forward; no new subjects are added. Consolidation weeks (\(C.consolidationWeeks.prefix(6).map(String.init).joined(separator: ", ")), …) run at about 60% and don't count toward pace.")
                .font(.callout).foregroundStyle(Theme.muted)
        }

        Card(title: "Course settings") {
            HStack {
                Button("Slot times") { editingTimes = true }.buttonStyle(.bordered)
                Button("Start date & work blocks") { editingOptions = true }.buttonStyle(.bordered)
            }
            Button("Reset progress", role: .destructive) { confirmReset = true }.buttonStyle(.bordered)
        }
    }
}

struct WeekCalendar: View {
    @EnvironmentObject var store: Store
    let week: Int
    let start: String
    var body: some View {
        let C = Course.shared
        if week == 0 {
            Text("Thu: set up your Mac · Fri: diagnostic · Sat: plan the project and teaching · Sun: lock in Week 1.").font(.caption).foregroundStyle(Theme.muted)
        } else if C.phaseOf(week) != nil {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 6) {
                    ForEach(0..<7, id: \.self) { i in
                        let k = Day.add(start, i)
                        let d = C.day(store, k)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(String(Array("MTWTFSS")[i])) \(String(k.suffix(2)))").font(.caption.weight(.semibold)).foregroundStyle(k == Day.today ? Theme.gold : Theme.text)
                            ForEach(Array(d.slots.filter { $0.type == "lesson" || $0.special != nil }.enumerated()), id: \.offset) { _, s in
                                HStack(alignment: .top, spacing: 4) {
                                    Circle().fill(trackColor(s.track)).frame(width: 5, height: 5).padding(.top, 4)
                                    Text((s.lesson != nil && s.status == "done" ? "✓ " : "") + C.slotTitle(s)).font(.caption2).foregroundStyle(Theme.muted).lineLimit(3)
                                }
                            }
                        }
                        .frame(width: 120, alignment: .topLeading)
                        .padding(6)
                        .background(Theme.plate2.opacity(k == Day.today ? 1 : 0.5), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
        }
    }
}

struct TeachDatesForm: View {
    @EnvironmentObject var store: Store
    @State private var dates: [String: Date] = [:]
    @State private var on: Set<String> = []
    var body: some View {
        let C = Course.shared
        let lessons = Array((C.laneLessons(store, "robo-prep") + C.laneLessons(store, "robo-lab")).filter { C.status(store, $0.id) != "done" }.prefix(12))
        Form {
            Text("When you teach each topic to your students. Close and not prepared turns red.").font(.callout).foregroundStyle(Theme.muted)
            ForEach(lessons, id: \.id) { l in
                Toggle("wk \(Int(l.num("week"))) · \(l.str("title"))", isOn: Binding(get: { on.contains(l.id) }, set: { if $0 { on.insert(l.id) } else { on.remove(l.id) } }))
                if on.contains(l.id) {
                    DatePicker("Teach on", selection: Binding(get: { dates[l.id] ?? Date() }, set: { dates[l.id] = $0 }), displayedComponents: .date)
                }
            }
        }
        .navigationTitle("Teaching dates")
        .onAppear {
            for l in lessons { if let d = C.teachBy(store, l), !d.isEmpty { on.insert(l.id); dates[l.id] = Day.date(d) } }
        }
        .sheetButtons {
            for l in lessons { C.setTeachBy(store, l.id, on.contains(l.id) ? Day.key(dates[l.id] ?? Date()) : nil) }
        }
    }
}

struct SlotTimesForm: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    @State private var kind = "weekday"
    @State private var times: [String: (Date, Date)] = [:]
    @State private var problem = ""

    private func hmDate(_ hm: String) -> Date { Day.cal.date(bySettingHour: Course.toMin(hm) / 60, minute: Course.toMin(hm) % 60, second: 0, of: Date()) ?? Date() }

    var body: some View {
        let C = Course.shared
        let list = C.slotsFor(store, kind).filter { $0.type != "info" }
        Form {
            Picker("Days", selection: $kind) {
                Text("Weekdays").tag("weekday"); Text("Saturday").tag("sat"); Text("Sunday").tag("sun")
            }
            Text("Sleep 22:30–05:30 is protected: slots can't go into it.").font(.caption).foregroundStyle(Theme.muted)
            ForEach(list) { s in
                SwiftUI.Section(s.label) {
                    DatePicker("Start", selection: Binding(get: { times[s.id]?.0 ?? hmDate(s.start) }, set: { times[s.id] = ($0, times[s.id]?.1 ?? hmDate(s.end)) }), displayedComponents: .hourAndMinute)
                    DatePicker("End", selection: Binding(get: { times[s.id]?.1 ?? hmDate(s.end) }, set: { times[s.id] = (times[s.id]?.0 ?? hmDate(s.start), $0) }), displayedComponents: .hourAndMinute)
                }
            }
            if !problem.isEmpty { Text(problem).foregroundStyle(Theme.red) }
        }
        .navigationTitle("Slot times")
        .onChange(of: kind) { _ in times = [:]; problem = "" }
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") {
                    var over: [String: (String, String)] = [:]
                    for s in list { over[s.id] = (Day.hm(times[s.id]?.0 ?? hmDate(s.start)), Day.hm(times[s.id]?.1 ?? hmDate(s.end))) }
                    if let p = C.checkSlotTimes(kind, over) { problem = p; return }
                    var slots = C.settings(store)["slots"]?.object ?? [:]
                    slots[kind] = .object(over.mapValues { .object(["start": .string($0.0), "end": .string($0.1)]) })
                    C.saveSettings(store, ["slots": .object(slots)])
                    dismiss()
                }
            }
        }
    }
}

struct CourseOptionsForm: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    @State private var start = Date()
    @State private var showWork = false
    @State private var problem = ""
    var body: some View {
        let C = Course.shared
        Form {
            DatePicker("Week 1 starts (Monday)", selection: $start, displayedComponents: .date)
            Toggle("Show work and student blocks", isOn: $showWork)
            if !problem.isEmpty { Text(problem).foregroundStyle(Theme.red) }
        }
        .navigationTitle("Course options")
        .onAppear { start = Day.date(C.startKey(store)); showWork = C.settings(store)["showWork"]?.bool ?? false }
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") {
                    if Course.dow(Day.key(start)) != 0 { problem = "Week 1 has to start on a Monday."; return }
                    C.saveSettings(store, ["start": .string(Day.key(start)), "showWork": .bool(showWork)])
                    dismiss()
                }
            }
        }
    }
}
