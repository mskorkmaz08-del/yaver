// The Yaver Course, the native twin of js/course.js: schedule (slots, lanes,
// rotation, consolidation weeks), the lesson each slot holds, pace per track,
// teaching deadlines, review cards (spaced repetition), completing lessons,
// mixed practice, the weekly test and the diagnostic. Content ships inside the
// app (data/course, the same files the web app serves); progress lives in the
// synced stores courseProgress, cards, courseTests and courseLessons.
import Foundation

struct Slot: Identifiable {
    var id: String
    var start: String
    var end: String
    var label: String
    var type: String
    var minutes: Int
    var lane: String?
    var track: String?
    var lesson: Row?
    var status: String?
    var special: String?
    var reason: String?
    var ahead = false
    var urgent = false
    var teachBy: String?
    var prepare: Int?
    var free = false
    var task: String?
    var diagnostic = false
}

struct CourseDay {
    var date: String
    var week: Int
    var kind: String
    var phase: String?
    var phaseName: String
    var consolidation: Bool
    var beforeStart = false
    var slots: [Slot] = []
}

struct TrackPace {
    var track: String
    var name: String
    var expected = 0
    var done = 0
    var lanes: [String: (expected: Int, done: Int)] = [:]
    var behind: Int { max(0, expected - done) }
    var ahead: Int { max(0, done - expected) }
    var label: String { behind > 0 ? "\(behind) behind" : ahead > 0 ? "\(ahead) ahead" : "on plan" }
}

final class Course {
    static let shared = Course()
    private(set) var meta: JSON = .null
    private var bundled: [Int: [Row]] = [:]
    private var byId: [String: Row] = [:]
    private var byLane: [String: [Row]] = [:]
    private var indexedAt = -1

    init(directory: URL? = nil) {
        let dir = directory ?? Bundle.main.resourceURL?.appendingPathComponent("course")
        guard let dir, let d = try? Data(contentsOf: dir.appendingPathComponent("course.json")), let m = try? JSON.decode(d) else { return }
        meta = m
        for w in m["weeks"]?.array ?? [] {
            guard let file = w["file"]?.string, let n = w["week"]?.double,
                  let wd = try? Data(contentsOf: dir.appendingPathComponent(file)), let wj = try? JSON.decode(wd) else { continue }
            bundled[Int(n)] = (wj["lessons"]?.array ?? []).compactMap { $0.object }
        }
    }

    var ready: Bool { !meta.isNull }
    var masteryThreshold: Double { meta["masteryThreshold"]?.double ?? 0.8 }
    var testThreshold: Double { meta["testThreshold"]?.double ?? 0.7 }
    var intervals: [Int] { (meta["cardIntervals"]?.array ?? []).compactMap { $0.double.map(Int.init) }.nilIfEmpty ?? [1, 3, 7, 14, 30, 60] }
    var tracks: [JSON] { meta["tracks"]?.array ?? [] }
    var lanes: [String: JSON] { meta["lanes"]?.object ?? [:] }
    var weeks: [JSON] { meta["weeks"]?.array ?? [] }
    var consolidationWeeks: [Int] { (meta["consolidation"]?.array ?? []).compactMap { $0.double.map(Int.init) } }

    func trackName(_ id: String?) -> String {
        guard let id else { return "" }
        if id == "mixed" { return "Mixed" }
        return tracks.first { $0["id"]?.string == id }?["name"]?.string ?? id
    }
    func trackColor(_ id: String?) -> String { tracks.first { $0["id"]?.string == id }?["color"]?.string ?? "#8a8374" }
    func weekMeta(_ n: Int) -> JSON? { weeks.first { Int($0["week"]?.double ?? -99) == n } }
    func laneTrack(_ lane: String) -> String? { lanes[lane]?["track"]?.string }

    // MARK: Index

    private func rebuild(_ s: Store) {
        byId = [:]; byLane = [:]
        var all: [Row] = bundled.values.flatMap { $0 }
        let bundledWeeks = Set(bundled.keys)
        for row in s.all("courseLessons") where !bundledWeeks.contains(Int(row.num("week"))) {
            var r = row
            r["id"] = .string(row.str("lessonId").isEmpty ? row.id : row.str("lessonId"))
            r["generated"] = true
            all.append(r)
        }
        all.sort { $0.num("week") != $1.num("week") ? $0.num("week") < $1.num("week") : $0.num("seq") < $1.num("seq") }
        for l in all {
            byId[l.id] = l
            byLane[l.str("lane"), default: []].append(l)
        }
        indexedAt = s.count("courseLessons")
    }
    private func idx(_ s: Store) { if indexedAt != s.count("courseLessons") { rebuild(s) } }

    func lesson(_ s: Store, _ id: String) -> Row? {
        idx(s)
        if let l = byId[id] { return l }
        if id.hasPrefix("mixed-") { return mixedLesson(s, String(id.dropFirst(6))) }
        return nil
    }
    func laneLessons(_ s: Store, _ lane: String) -> [Row] { idx(s); return byLane[lane] ?? [] }
    func allLessons(_ s: Store) -> [Row] { idx(s); return Array(byId.values) }

    // MARK: Settings (kv "course")

    func settings(_ s: Store) -> [String: JSON] {
        var d: [String: JSON] = ["active": false, "start": "2026-10-19", "slots": .object([:]), "showWork": false, "teachBy": .object([:])]
        for (k, v) in s.setting("course")?.object ?? [:] { d[k] = v }
        return d
    }
    func saveSettings(_ s: Store, _ patch: [String: JSON]) {
        var d = settings(s)
        for (k, v) in patch { d[k] = v }
        s.setSetting("course", .object(d))
    }
    func active(_ s: Store) -> Bool { settings(s)["active"]?.bool ?? false }
    func activate(_ s: Store) {
        saveSettings(s, ["active": true])
        let mins = slotsFor(s, "weekday").filter { $0.type == "lesson" || $0.type == "review" }.reduce(0) { $0 + $1.minutes }
        s.setSetting("dailyStudyMin", .number(Double(mins - 20)))
        s.setSetting("streakMin", 60)
    }

    // MARK: Calendar maths

    static func toMin(_ hm: String) -> Int { let p = hm.split(separator: ":").compactMap { Int($0) }; return p.count == 2 ? p[0] * 60 + p[1] : 0 }
    static func fromMin(_ m: Int) -> String { String(format: "%02d:%02d", m / 60, m % 60) }
    static func nowMin(_ d: Date = Date()) -> Int { let c = Day.cal.dateComponents([.hour, .minute], from: d); return (c.hour ?? 0) * 60 + (c.minute ?? 0) }
    static func dow(_ key: String) -> Int { (Day.cal.component(.weekday, from: Day.date(key)) + 5) % 7 }
    static func dayKind(_ key: String) -> String { let d = dow(key); return d < 5 ? "weekday" : d == 5 ? "sat" : "sun" }

    func startKey(_ s: Store) -> String { settings(s)["start"]?.string ?? meta["start"]?.string ?? "2026-10-19" }
    func weekOf(_ s: Store, _ key: String = Day.today) -> Int {
        let start = startKey(s)
        if key >= start { return Day.days(between: start, key) / 7 + 1 }
        if key >= Day.add(start, -4) { return 0 }
        return -1
    }
    func weekStartKey(_ s: Store, _ n: Int) -> String { Day.add(startKey(s), 7 * (n - 1)) }
    func phaseOf(_ n: Int) -> JSON? {
        (meta["phases"]?.array ?? []).first { p in
            let w = (p["weeks"]?.array ?? []).compactMap { $0.double.map(Int.init) }
            return w.count == 2 && n >= w[0] && n <= w[1]
        }
    }
    func isConsolidation(_ n: Int) -> Bool { consolidationWeeks.contains(n) }
    func rotation(_ phase: JSON?, _ slot: String, _ d: Int) -> String? {
        guard let row = phase?["rotation"]?[slot]?.array, d < row.count else { return nil }
        return row[d].string
    }

    func slotsFor(_ s: Store, _ kind: String) -> [Slot] {
        let over = settings(s)["slots"]?[kind]?.object ?? [:]
        return (meta["slots"]?[kind]?.array ?? []).map { j -> Slot in
            let id = j["id"]?.string ?? ""
            let start = over[id]?["start"]?.string ?? j["start"]?.string ?? "00:00"
            let end = over[id]?["end"]?.string ?? j["end"]?.string ?? "00:00"
            return Slot(id: id, start: start, end: end, label: j["label"]?.string ?? "", type: j["type"]?.string ?? "",
                        minutes: Course.toMin(end) - Course.toMin(start))
        }.sorted { Course.toMin($0.start) < Course.toMin($1.start) }
    }

    /// Refuses templates that cut into the protected sleep window or overlap.
    func checkSlotTimes(_ kind: String, _ overrides: [String: (String, String)]) -> String? {
        let sleepEnd = Course.toMin(meta["sleep"]?["end"]?.string ?? "05:30"), sleepStart = Course.toMin(meta["sleep"]?["start"]?.string ?? "22:30")
        var list: [(id: String, label: String, type: String, a: Int, b: Int)] = []
        for j in meta["slots"]?[kind]?.array ?? [] {
            let id = j["id"]?.string ?? ""
            let o = overrides[id]
            list.append((id, j["label"]?.string ?? id, j["type"]?.string ?? "", Course.toMin(o?.0 ?? j["start"]?.string ?? ""), Course.toMin(o?.1 ?? j["end"]?.string ?? "")))
        }
        for x in list {
            if !(x.a < x.b) { return "\(x.label): end must be after start." }
            if x.a < sleepEnd || x.b > sleepStart { return "\(x.label) would cut into sleep (sleep stays protected, 7 hours)." }
        }
        let sorted = list.filter { $0.type != "info" }.sorted { $0.a < $1.a }
        for i in sorted.indices.dropFirst() where sorted[i].a < sorted[i - 1].b { return "\(sorted[i].label) overlaps \(sorted[i - 1].label)." }
        return nil
    }

    // MARK: Progress

    func progress(_ s: Store, _ id: String) -> Row? { s.get("courseProgress", id) }
    func completed(_ s: Store, _ id: String) -> Bool { ["done", "flagged"].contains(progress(s, id)?.str("status") ?? "") }
    func status(_ s: Store, _ id: String) -> String {
        guard let p = progress(s, id) else { return "todo" }
        let st = p.str("status")
        return st == "flagged" || st == "done" ? st : "in progress"
    }
    func nextInLane(_ s: Store, _ lane: String, skip: Int = 0) -> Row? {
        let open = laneLessons(s, lane).filter { !completed(s, $0.id) }
        return skip < open.count ? open[skip] : nil
    }
    func doneInLane(_ s: Store, _ lane: String) -> Int { laneLessons(s, lane).filter { completed(s, $0.id) }.count }

    /// Recall questions from lessons you finished (one exit question each, newest first).
    func recallFromFinished(_ s: Store, track: String?, _ n: Int, skip: Set<String>) -> [[String: JSON]] {
        var out: [[String: JSON]] = []
        var skip = skip
        let rows = s.all("courseProgress").filter { completed(s, $0.str("lessonId")) && !$0.str("completedAt").isEmpty }.sorted { $0.str("completedAt") > $1.str("completedAt") }
        for p in rows {
            guard let l = lesson(s, p.str("lessonId")), !l.flag("virtual") else { continue }
            if let t = track, t != "mixed", l.str("track") != t { continue }
            let exit = (l["steps"]?.array ?? []).first { $0["kind"]?.string == "exit" }
            if var q = (exit?["questions"]?.array ?? []).compactMap({ $0.object }).first(where: { !skip.contains($0.str("q")) }) {
                q["from"] = .string(l.id)
                out.append(q); skip.insert(q.str("q"))
            }
            if out.count >= n { break }
        }
        return out
    }

    private func sessionsBefore(_ s: Store, _ lane: String, _ key: String, _ startHM: String, at: Date = Date()) -> Int {
        let t = Day.key(at), nm = Course.nowMin(at)
        if key < t { return 0 }
        var n = 0, k = t
        while k <= key {
            defer { k = Day.add(k, 1) }
            let w = weekOf(s, k)
            if w == 0 { if lane == "setup" && k < key { n += 1 }; continue }
            guard let ph = phaseOf(w), !isConsolidation(w) else { continue }
            let d = Course.dow(k)
            if d > 5 { continue }
            for sl in slotsFor(s, d < 5 ? "weekday" : "sat") {
                if rotation(ph, sl.id, d) != lane { continue }
                if k == t && Course.toMin(sl.end) <= nm { continue }
                if k == key && Course.toMin(sl.start) >= Course.toMin(startHM) { continue }
                n += 1
            }
        }
        return n
    }

    func weekToPrepare(_ s: Store) -> Int? {
        idx(s)
        let have = Set(byId.values.map { Int($0.num("week")) })
        for w in weeks {
            let n = Int(w["week"]?.double ?? 0)
            if n >= 16 && w["consolidation"]?.bool != true && !have.contains(n) { return n }
        }
        return nil
    }
    func hasWeek(_ s: Store, _ n: Int) -> Bool { idx(s); return byId.values.contains { Int($0.num("week")) == n } }

    // MARK: Pace

    func expected(_ s: Store, _ lane: String, at: Date = Date()) -> Int {
        let key = Day.key(at), w = weekOf(s, key)
        var n = 0
        if w < 1 { return 0 }
        for wk in 1...min(w, 63) {
            if isConsolidation(wk) { continue }
            guard let ph = phaseOf(wk) else { continue }
            for d in 0..<6 {
                let k = Day.add(weekStartKey(s, wk), d)
                if k > key { break }
                for sl in slotsFor(s, d < 5 ? "weekday" : "sat") where rotation(ph, sl.id, d) == lane {
                    if k < key || Course.toMin(sl.end) <= Course.nowMin(at) { n += 1 }
                }
            }
        }
        return n
    }
    func weeklySessions(_ s: Store, _ track: String) -> Int {
        let ph = phaseOf(max(1, weekOf(s))) ?? meta["phases"]?.array?.first
        return (ph?["rotation"]?.object ?? [:]).values.flatMap { $0.array ?? [] }.compactMap { $0.string }.filter { laneTrack($0) == track }.count
    }
    func pace(_ s: Store, at: Date = Date()) -> [String: TrackPace] {
        var out: [String: TrackPace] = [:]
        for (lane, def) in lanes where lane != "setup" {
            let e = expected(s, lane, at: at), d = doneInLane(s, lane)
            if e == 0 && d == 0 { continue }
            let tr = def["track"]?.string ?? ""
            var t = out[tr] ?? TrackPace(track: tr, name: trackName(tr))
            t.expected += e; t.done += d; t.lanes[lane] = (e, d)
            out[tr] = t
        }
        return out
    }
    /// green on plan, yellow less than a week behind, red more.
    func paceColor(_ s: Store, _ t: TrackPace) -> String { t.behind == 0 ? "green" : t.behind < weeklySessions(s, t.track) ? "yellow" : "red" }

    // MARK: Teaching deadlines

    func teachBy(_ s: Store, _ l: Row) -> String? {
        if let v = settings(s)["teachBy"]?[l.id] { return v.string }
        return l["teachBy"]?.string
    }
    func setTeachBy(_ s: Store, _ id: String, _ date: String?) {
        var tb = settings(s)["teachBy"]?.object ?? [:]
        tb[id] = JSON.from(date)
        saveSettings(s, ["teachBy": .object(tb)])
    }
    func deadlines(_ s: Store, within: Int = 7, key: String = Day.today) -> [(lesson: Row, teachBy: String, days: Int)] {
        var out: [(Row, String, Int)] = []
        for l in laneLessons(s, "robo-prep") + laneLessons(s, "robo-lab") {
            guard let d = teachBy(s, l), !d.isEmpty, !completed(s, l.id) else { continue }
            let days = Day.days(between: key, d)
            if days <= within { out.append((l, d, days)) }
        }
        return out.sorted { $0.1 < $1.1 }.map { (lesson: $0.0, teachBy: $0.1, days: $0.2) }
    }

    // MARK: A day of slots

    func day(_ s: Store, _ key: String = Day.today) -> CourseDay {
        let w = weekOf(s, key)
        let kind = Course.dayKind(key)
        let ph = phaseOf(w)
        let cons = isConsolidation(w)
        var base = CourseDay(date: key, week: w, kind: kind, phase: ph?["id"]?.string, phaseName: ph?["name"]?.string ?? "", consolidation: cons)
        if w < 0 { base.beforeStart = true; return base }
        let showWork = settings(s)["showWork"]?.bool ?? false
        let all = slotsFor(s, kind).filter { $0.type != "fixed" || showWork }
        if w == 0 {
            let l = nextInLane(s, "setup", skip: sessionsBefore(s, "setup", key, "00:00"))
            base.slots = all.filter { $0.type == "info" || $0.id == "deep1" || $0.type == "review" }.map { sl in
                guard sl.id == "deep1" else { return sl }
                var x = sl
                let m = Int(l?.num("minutes") ?? 90)
                x.end = Course.fromMin(Course.toMin(sl.start) + (m > 0 ? m : 90)); x.minutes = m > 0 ? m : 90; x.label = "Week 0 · setup"
                return withLesson(s, x, l, w)
            }
            return base
        }
        let d = Course.dow(key)
        for sl in all {
            if ["info", "fixed", "review", "plan"].contains(sl.type) { base.slots.append(sl); continue }
            if sl.type == "test" || sl.type == "ship" { var x = sl; x.special = sl.type; base.slots.append(x); continue }
            if cons { if let c = consolidationSlot(s, sl, kind, w, key) { base.slots.append(c) }; continue }
            guard let lane = rotation(ph, sl.id, d) else { continue }
            if lane == "mixed" { var x = sl; x.special = "mixed"; x.lane = lane; x.track = "mixed"; x.lesson = mixedLesson(s, key); base.slots.append(x); continue }
            if lane == "buffer" { base.slots.append(bufferSlot(s, sl, w, key)); continue }
            var x = sl; x.lane = lane; x.track = laneTrack(lane)
            base.slots.append(withLesson(s, x, nextInLane(s, lane, skip: sessionsBefore(s, lane, key, sl.start)), w))
        }
        return base
    }

    private func withLesson(_ s: Store, _ sl: Slot, _ l: Row?, _ w: Int) -> Slot {
        var x = sl
        guard let l else {
            x.track = x.track ?? x.lane.flatMap(laneTrack)
            x.prepare = weekToPrepare(s); x.status = "prepare"
            return x
        }
        let tb = l.str("track") == "robo" ? teachBy(s, l) : nil
        x.lane = l.str("lane"); x.track = l.str("track"); x.lesson = l; x.status = status(s, l.id)
        x.ahead = Int(l.num("week")) > w; x.teachBy = tb
        if let tb, !completed(s, l.id) { x.urgent = Day.days(between: Day.today, tb) <= 7 }
        return x
    }

    private func bufferSlot(_ s: Store, _ sl: Slot, _ w: Int, _ key: String) -> Slot {
        var x = sl; x.special = "buffer"
        if let f = s.all("courseProgress").filter({ $0.str("status") == "flagged" }).sorted(by: { $0.str("completedAt") < $1.str("completedAt") }).first,
           let l = lesson(s, f.str("lessonId")) {
            x.reason = "redo a flagged lesson"
            var r = withLesson(s, x, l, w); r.status = "flagged"; return r
        }
        var worst: (lane: String, behind: Int)?
        for t in pace(s, at: Day.date(key).addingTimeInterval(Double(Course.toMin(sl.start)) * 60)).values {
            for (lane, v) in t.lanes where v.expected - v.done > 0 && (worst == nil || v.expected - v.done > worst!.behind) { worst = (lane, v.expected - v.done) }
        }
        if let wl = worst, let next = nextInLane(s, wl.lane) {
            x.reason = "\(trackName(laneTrack(wl.lane))) is \(wl.behind) behind"
            return withLesson(s, x, next, w)
        }
        if let dl = deadlines(s, within: 60, key: key).first {
            x.reason = "teaching deadline \(dl.teachBy)"
            return withLesson(s, x, nextInLane(s, dl.lesson.str("lane")) ?? dl.lesson, w)
        }
        x.free = true; x.track = nil; x.label = "Buffer · free, or read ahead"
        return x
    }

    private func consolidationSlot(_ s: Store, _ sl: Slot, _ kind: String, _ w: Int, _ key: String) -> Slot? {
        var x = sl
        if kind == "sat" {
            guard sl.id == "build" else { return nil }
            x.special = "consolidate"; x.track = "build"; x.task = "Finish and document the projects: READMEs, tests, a clean commit history."
            return x
        }
        let tasks = ["deep1": w == 6 ? "Retake the Week 0 diagnostic, then compare with your first score." : "Retake an earlier weekly test: the one with your lowest score.",
                     "deep2": "Redo flagged practice tasks without notes.", "build": "Finish and document projects."]
        if let t = tasks[sl.id] {
            x.special = "consolidate"; x.track = sl.id == "build" ? "build" : nil; x.task = t; x.diagnostic = w == 6 && sl.id == "deep1"
            return x
        }
        if sl.id == "prep", !deadlines(s, within: 21, key: key).isEmpty {
            x.lane = "robo-prep"; x.track = "robo"
            return withLesson(s, x, nextInLane(s, "robo-prep"), w)
        }
        return nil
    }

    /// The block that is on now or next (Home).
    func nextBlock(_ s: Store, at: Date = Date()) -> (slot: Slot, date: String)? {
        for i in 0..<3 {
            let k = Day.add(Day.key(at), i)
            for sl in day(s, k).slots where sl.type != "info" && sl.type != "fixed" {
                if i == 0 && Course.toMin(sl.end) <= Course.nowMin(at) { continue }
                return (sl, k)
            }
        }
        return nil
    }

    func slotTitle(_ sl: Slot) -> String {
        switch sl.special {
        case "test": return "Weekly test"
        case "ship": return "Ship & weekly review"
        case "mixed": return "Mixed practice"
        case "consolidate": return sl.task ?? sl.label
        default: break
        }
        if sl.type == "review" { return "Review cards · log · plan tomorrow" }
        if sl.type == "plan" { return "Confirm Monday's first block" }
        if let p = sl.prepare { return "Prepare week \(p)" }
        if sl.free { return sl.label }
        if let l = sl.lesson { return "\(trackName(l.str("track"))): \(l.str("title"))" }
        return sl.label
    }

    /// Where a slot leads: a lesson id or one of the sessions (review, test, ship, flagged, diagnostic, prepare-N).
    func target(_ sl: Slot, _ key: String) -> String? {
        if sl.special == "test" { return "test" }
        if sl.special == "ship" { return "ship" }
        if sl.special == "mixed" { return "mixed-\(key)" }
        if sl.type == "review" || sl.type == "plan" { return "review" }
        if sl.special == "consolidate" { return sl.diagnostic ? "diagnostic" : sl.id == "deep2" ? "flagged" : nil }
        if let p = sl.prepare { return "prepare-\(p)" }
        return sl.lesson?.id
    }

    // MARK: Cards

    func dueCards(_ s: Store, limit: Int = 100, track: String? = nil, at: String = Day.today) -> [Row] {
        let due = s.all("cards").filter { $0.str("due") <= at && (track == nil || $0.str("track") == track) }
            .sorted { $0.str("due") != $1.str("due") ? $0.str("due") < $1.str("due") : $0.id < $1.id }
        return Array(Course.interleave(due) { $0.str("track") }.prefix(limit))
    }
    func dueCount(_ s: Store) -> Int { s.all("cards").filter { $0.str("due") <= Day.today }.count }

    func addCards(_ s: Store, _ l: Row, due: String = Day.add(Day.today, 1)) {
        for (i, c) in (l["cards"]?.array ?? []).enumerated() {
            let id = "\(l.id)#\(i)"
            if var old = s.get("cards", id) {
                if old.str("due") > due { old["due"] = .string(due); s.put("cards", old) }
                continue
            }
            s.put("cards", ["id": .string(id), "lessonId": .string(l.id), "track": .string(l.str("track")), "front": c["front"] ?? "", "back": c["back"] ?? "",
                            "box": 0, "due": .string(due), "lapses": 0, "history": .array([])])
        }
    }

    func gradeCard(_ s: Store, _ id: String, _ grade: String) {
        guard var c = s.get("cards", id) else { return }
        let iv = intervals
        var box = Int(c.num("box")), lapses = Int(c.num("lapses")), days = 1
        switch grade {
        case "again": box = 0; days = 1; lapses += 1
        case "hard": days = max(1, Int((Double(iv[min(box, iv.count - 1)]) * 0.5).rounded()))
        case "good": box = min(iv.count - 1, box + 1); days = iv[box]
        case "easy": box = min(iv.count - 1, box + 2); days = iv[box]
        default: return
        }
        var hist = c["history"]?.array ?? []
        hist.append(.object(["at": .string(Store.isoNow()), "grade": .string(grade)]))
        c["box"] = .number(Double(box)); c["lapses"] = .number(Double(lapses)); c["due"] = .string(Day.add(Day.today, days))
        c["history"] = .array(Array(hist.suffix(30)))
        s.put("cards", c)
        s.addPractice("anki", 1)
    }

    // MARK: Lessons: timer and completing

    struct LessonTimer { var lessonId: String; var start: Double; var pausedAt: Double?; var planned: Double }
    func timer(_ s: Store, for id: String? = nil) -> LessonTimer? {
        guard let t = s.setting("lessonTimer"), let lid = t["lessonId"]?.string, id == nil || lid == id else { return nil }
        return LessonTimer(lessonId: lid, start: t["start"]?.double ?? 0, pausedAt: t["pausedAt"]?.double, planned: t["plannedMin"]?.double ?? 0)
    }
    func elapsed(_ t: LessonTimer) -> Double { max(0, ((t.pausedAt ?? Date().timeIntervalSince1970 * 1000) - t.start) / 1000) }
    private func saveTimer(_ s: Store, _ t: LessonTimer?) {
        guard let t else { s.setSetting("lessonTimer", .null); return }
        s.setSetting("lessonTimer", .object(["lessonId": .string(t.lessonId), "start": .number(t.start), "pausedAt": t.pausedAt.map { .number($0) } ?? .null, "plannedMin": .number(t.planned)]))
    }
    func startLesson(_ s: Store, _ id: String) {
        guard let l = lesson(s, id) else { return }
        let p = progress(s, id)
        if p == nil || p?.str("status") == "flagged" {
            var r = p ?? [:]
            r["id"] = .string(id); r["lessonId"] = .string(id)
            r["status"] = .string(p?.str("status") == "flagged" ? "flagged" : "in progress")
            r["startedAt"] = .string(Store.isoNow()); r["attempts"] = .number((p?.num("attempts") ?? 0) + 1)
            s.put("courseProgress", r)
        }
        let now = Date().timeIntervalSince1970 * 1000
        if var t = timer(s, for: id) {
            if let pa = t.pausedAt { t.start += now - pa; t.pausedAt = nil }
            saveTimer(s, t)
        } else {
            saveTimer(s, LessonTimer(lessonId: id, start: now, pausedAt: nil, planned: l.num("minutes")))
        }
    }
    func pauseLesson(_ s: Store) {
        guard var t = timer(s), t.pausedAt == nil else { return }
        t.pausedAt = Date().timeIntervalSince1970 * 1000
        saveTimer(s, t)
    }
    func resetTimer(_ s: Store) { saveTimer(s, nil) }

    @discardableResult
    func completeLesson(_ s: Store, lessonId: String, minutes inMin: Int?, score inScore: Double?, notes: String = "", hintsUsed: Int = 0, solutionsRevealed: Int = 0) -> (mastered: Bool, score: Double?, minutes: Int, next: Row?) {
        guard let l = lesson(s, lessonId) else { return (false, nil, 0, nil) }
        let t = timer(s, for: lessonId)
        let p = progress(s, lessonId) ?? [:]
        var minutes = inMin ?? (t.map { max(1, Int((elapsed($0) / 60).rounded())) } ?? Int(l.num("minutes")))
        minutes = max(1, minutes)
        let score = inScore.map { max(0, min(1, $0 > 1 ? $0 / 100 : $0)) }
        let mastered = score == nil || score! >= masteryThreshold
        var row = p
        row["id"] = .string(lessonId); row["lessonId"] = .string(lessonId); row["track"] = .string(l.str("track")); row["lane"] = .string(l.str("lane"))
        row["week"] = l["week"] ?? .null
        row["status"] = .string(mastered ? "done" : "flagged")
        if p["startedAt"]?.string == nil {
            let started = t.map { Date(timeIntervalSince1970: $0.start / 1000) } ?? Date().addingTimeInterval(Double(-minutes * 60))
            row["startedAt"] = .string(Store.isoString(started))
        }
        row["completedAt"] = .string(Store.isoNow())
        row["minutes"] = .number(Double((p.str("status") == "flagged" ? Int(p.num("minutes")) : 0) + minutes))
        row["score"] = score.map { .number($0) } ?? .null
        row["mastered"] = .bool(mastered)
        row["hintsUsed"] = .number(p.num("hintsUsed") + Double(hintsUsed))
        row["solutionsRevealed"] = .number(p.num("solutionsRevealed") + Double(solutionsRevealed))
        row["notes"] = .string(notes.isEmpty ? p.str("notes") : notes)
        s.put("courseProgress", row)
        s.logStudy(subject: l.flag("virtual") ? (l.str("subject").isEmpty ? "Course" : l.str("subject")) : trackName(l.str("track")), minutes: Double(minutes), note: l.str("title"))
        addCards(s, l)
        if t != nil { resetTimer(s) }
        return (mastered, score, minutes, l.flag("virtual") ? nil : nextInLane(s, l.str("lane")))
    }

    func setStepDone(_ s: Store, _ id: String, _ i: Int, _ on: Bool) {
        var cur = progress(s, id) ?? ["id": .string(id), "lessonId": .string(id), "status": "in progress"]
        var set = Set((cur["stepsDone"]?.array ?? []).compactMap { $0.double.map(Int.init) })
        if on { set.insert(i) } else { set.remove(i) }
        cur["stepsDone"] = .array(set.sorted().map { .number(Double($0)) })
        s.put("courseProgress", cur)
    }
    func setNotes(_ s: Store, _ id: String, _ notes: String) {
        var cur = progress(s, id) ?? ["id": .string(id), "lessonId": .string(id), "status": "in progress"]
        cur["notes"] = .string(notes)
        s.put("courseProgress", cur)
    }

    // MARK: Mixed practice and the weekly test (same seeded shuffle as the web app)

    private static func rng(_ seed: String) -> () -> Double {
        var h: UInt32 = 2166136261
        for ch in seed.utf16 { h = (h ^ UInt32(ch)) &* 16777619 }
        return {
            h = (h ^ (h >> 15)) &* 2246822507
            h = (h ^ (h >> 13)) &* 3266489909
            h ^= h >> 16
            return Double(h) / 4294967296
        }
    }
    private static func shuffle<T>(_ a: [T], _ r: () -> Double) -> [T] {
        var a = a
        var i = a.count - 1
        while i > 0 { let j = Int(r() * Double(i + 1)); a.swapAt(i, j); i -= 1 }
        return a
    }
    static func interleave<T>(_ items: [T], _ key: (T) -> String) -> [T] {
        var order: [String] = []
        var groups: [String: [T]] = [:]
        for x in items { let k = key(x); if groups[k] == nil { order.append(k) }; groups[k, default: []].append(x) }
        var out: [T] = []
        while out.count < items.count { for k in order where !(groups[k]?.isEmpty ?? true) { out.append(groups[k]!.removeFirst()) } }
        return out
    }

    private func recentDone(_ s: Store, _ from: String, _ to: String) -> [Row] {
        s.all("courseProgress").filter { p in
            guard let at = Store.parseISO(p.str("completedAt")) else { return false }
            let k = Day.key(at)
            return k >= from && k <= to && (lesson(s, p.str("lessonId")).map { !$0.flag("virtual") } ?? false)
        }
    }

    func mixedLesson(_ s: Store, _ key: String) -> Row {
        let r = Course.rng("mixed" + key)
        var order: [String] = []
        var byTrack: [String: [JSON]] = [:]
        for p in recentDone(s, Day.add(key, -14), key) {
            guard let l = lesson(s, p.str("lessonId")) else { continue }
            for st in l["steps"]?.array ?? [] where st["kind"]?.string == "practice" {
                for (i, t) in (st["tasks"]?.array ?? []).enumerated() {
                    guard var o = t.object else { continue }
                    o["from"] = .string(l.id); o["fromTitle"] = .string(l.str("title")); o["track"] = .string(l.str("track")); o["ref"] = .string("\(l.id):\(i)")
                    if byTrack[l.str("track")] == nil { order.append(l.str("track")) }
                    byTrack[l.str("track"), default: []].append(.object(o))
                }
            }
        }
        var tasks: [JSON] = []
        for k in order { tasks += Course.shuffle(byTrack[k] ?? [], r).prefix(2) }
        tasks = Array(Course.interleave(Course.shuffle(tasks, r)) { $0["track"]?.string ?? "" }.prefix(10))
        let cards = Course.shuffle(dueCards(s, at: key), r).prefix(5)
        let fallback: JSON = .object(["prompt": "No practice from the last 14 days yet. Pick two exercises from this week's lessons in different tracks and solve them without notes.",
                                      "hints": .array(["Start with the one you feel least sure about."]), "check": "You can explain why your solution works.", "solution": ""])
        return ["id": .string("mixed-\(key)"), "virtual": true, "kind": "mixed", "track": "mixed", "subject": "Mixed practice", "lane": "mixed",
                "week": .number(Double(weekOf(s, key))), "minutes": 90, "title": "Mixed practice",
                "objectives": .array(["Recognise which method a problem needs without being told the topic", "Solve problems from different tracks back to back"]),
                "resources": .array([]),
                "steps": .array([
                    .object(["kind": "warmup", "minutes": 15, "title": "Review cards", "cardIds": .array(cards.map { .string($0.id) }),
                             "body": .string(cards.isEmpty ? "No cards due. Recall one idea from each track this week and write it down." : "Five due cards, mixed across tracks.")]),
                    .object(["kind": "practice", "minutes": 75, "title": .string(tasks.isEmpty ? "Mixed problems" : "\(tasks.count) mixed problems"),
                             "tasks": .array(tasks.isEmpty ? [fallback] : tasks),
                             "body": "Topics alternate on purpose: before each problem, name the method first, then solve it. Time-box each one."]),
                ]),
                "cards": .array([]), "deliverable": .string("Solutions in learning-log/mixed/\(key).md")]
    }

    func testQuestions(_ s: Store, week w: Int) -> [[String: String]] {
        let from = weekStartKey(s, w), to = Day.add(from, 6)
        let r = Course.rng("test\(w)")
        var qs: [[String: String]] = []
        for p in recentDone(s, from, to) {
            guard let l = lesson(s, p.str("lessonId")) else { continue }
            for st in l["steps"]?.array ?? [] where st["kind"]?.string == "exit" {
                for q in st["questions"]?.array ?? [] { qs.append(["track": l.str("track"), "lessonId": l.id, "q": q["q"]?.string ?? "", "a": q["a"]?.string ?? ""]) }
            }
        }
        let earlierCards = s.all("cards").filter { c in lesson(s, c.str("lessonId")).map { Int($0.num("week")) < w } ?? false }
        let earlier = Course.shuffle(earlierCards, r).prefix(max(3, Int((Double(qs.count) / 3).rounded())))
            .map { ["track": $0.str("track"), "lessonId": $0.str("lessonId"), "q": $0.str("front"), "a": $0.str("back"), "card": $0.id] }
        let all = Array((Array(Course.shuffle(qs, r).prefix(24)) + earlier).prefix(30))
        return Course.interleave(Course.shuffle(all, r)) { $0["track"] ?? "" }
    }

    @discardableResult
    func recordTest(_ s: Store, week: Int, scores: [(track: String, right: Int, total: Int)]) -> [String] {
        let clean = scores.filter { $0.total > 0 }
        s.put("courseTests", ["id": .string(String(format: "w%02d", week)), "week": .number(Double(week)), "date": .string(Day.today),
                              "scores": .array(clean.map { .object(["track": .string($0.track), "right": .number(Double($0.right)), "total": .number(Double($0.total))]) })])
        let weak = clean.filter { Double($0.right) / Double($0.total) < testThreshold }.map(\.track)
        let monday = Day.add(weekStartKey(s, week), 7)
        for p in s.all("courseProgress") {
            guard let l = lesson(s, p.str("lessonId")), Int(l.num("week")) == week, weak.contains(l.str("track")) else { continue }
            var r = p; r["status"] = "flagged"; r["mastered"] = false; r["flaggedBy"] = "test"
            s.put("courseProgress", r)
            for c in s.all("cards") where c.str("lessonId") == l.id { var x = c; x["due"] = .string(monday); s.put("cards", x) }
        }
        return weak
    }
    func testResults(_ s: Store) -> [Row] { s.all("courseTests").sorted { $0.num("week") < $1.num("week") } }

    func recordDiagnostic(_ s: Store, score: Double, total: Int, marks: [String]) {
        var prev = s.setting("courseDiagnostic")?.array ?? []
        prev.append(.object(["date": .string(Day.today), "week": .number(Double(weekOf(s))),
                             "results": .object(["score": .number(score), "total": .number(Double(total)), "marks": .array(marks.map { .string($0) })])]))
        s.setSetting("courseDiagnostic", .array(prev))
    }
    func diagnosticHistory(_ s: Store) -> [JSON] { s.setting("courseDiagnostic")?.array ?? [] }

    // MARK: Summary per track

    struct TrackSummary: Identifiable {
        var id: String { track }
        let track: String, name: String, color: String
        let done: Int, total: Int
        let pace: String, paceColor: String
        let mastery: Int?
        let flagged: [Row]
    }
    func trackSummaries(_ s: Store) -> [TrackSummary] {
        let p = pace(s)
        let lessons = allLessons(s)
        return tracks.compactMap { t in
            guard let id = t["id"]?.string else { return nil }
            let mine = lessons.filter { $0.str("track") == id && $0.str("lane") != "setup" }
            let rows = mine.compactMap { progress(s, $0.id) }.filter { ["done", "flagged"].contains($0.str("status")) }
            let scored = rows.filter { $0["score"]?.double != nil }
            let tp = p[id]
            return TrackSummary(track: id, name: t["name"]?.string ?? id, color: t["color"]?.string ?? "#888888", done: rows.count, total: mine.count,
                                pace: tp?.label ?? "not started", paceColor: tp.map { paceColor(s, $0) } ?? "green",
                                mastery: scored.isEmpty ? nil : Int((Double(scored.filter { $0.num("score") >= masteryThreshold }.count) / Double(scored.count) * 100).rounded()),
                                flagged: rows.filter { $0.str("status") == "flagged" })
        }
    }

    // MARK: Evening review

    func dayLog(_ s: Store, _ key: String = Day.today) -> [String: JSON] { s.setting("courseLog:\(key)")?.object ?? [:] }
    func saveDayLog(_ s: Store, _ key: String, well: String, change: String, plan: [String]) {
        s.setSetting("courseLog:\(key)", .object(["well": .string(well), "change": .string(change), "confirmedAt": .string(Store.isoNow()),
                                                   "plan": .array(plan.map { .string($0) }), "at": .string(Store.isoNow())]))
    }
    func planFor(_ s: Store, _ key: String) -> [String] {
        day(s, key).slots.filter { $0.type != "info" && $0.type != "fixed" }.map { "at \($0.start): \(slotTitle($0))" }
    }

    /// A .py or .cpp starter file with the task as a comment and its tests.
    func starterFile(_ l: Row, _ t: [String: JSON], _ i: Int, _ j: Int) -> (name: String, text: String) {
        let base = "\(l.id)-task\(j + 1)"
        let prompt = t.str("prompt").replacingOccurrences(of: "*", with: "").replacingOccurrences(of: "`", with: "")
        let check = t.str("check").replacingOccurrences(of: "\n", with: " ")
        if t.str("lang") == "cpp" {
            let comment = prompt.split(separator: "\n", omittingEmptySubsequences: false).map { "// \($0)" }.joined(separator: "\n")
            let tests = t.str("tests").split(separator: "\n", omittingEmptySubsequences: false).map { "    \($0)" }.joined(separator: "\n")
            return ("\(base).cpp", "\(comment)\n// Check: \(check)\n// Build and run: g++ -std=c++20 \(base).cpp -o \(base) && ./\(base)\n\n#include <cassert>\n#include <iostream>\n#include <string>\n#include <vector>\n\n// Your code here.\n\nint main() {\n\(tests)\n    std::cout << \"all tests passed\\n\";\n    return 0;\n}\n")
        }
        let py = base.replacingOccurrences(of: "-", with: "_") + ".py"
        let comment = prompt.split(separator: "\n", omittingEmptySubsequences: false).map { "# \($0)" }.joined(separator: "\n")
        return (py, "\(comment)\n# Check: \(check)\n# Run the tests: python3 -m pytest \(py)   (or just: python3 \(py))\n\n\n# Your code here.\n\n\n# ---- tests ----\n\(t.str("tests"))\n\n\nif __name__ == \"__main__\":\n    for _name, _fn in list(globals().items()):\n        if _name.startswith(\"test_\") and callable(_fn):\n            _fn()\n    print(\"all tests passed\")\n")
    }
}

extension Array {
    var nilIfEmpty: [Element]? { isEmpty ? nil : self }
}

extension Store {
    func logStudy(subject: String, minutes: Double, note: String = "", date: String = Day.today) {
        guard minutes > 0 else { return }
        let s = self.subject(named: subject)
        put("sessions", ["subjectId": .string(s.id), "minutes": .number(minutes), "date": .string(date), "note": .string(note)])
    }
    /// Practice counters are one key per device per day, so synced devices add up (same as the web app).
    func addPractice(_ kind: String, _ n: Double, _ day: String = Day.today) {
        let k = "practice:\(kind):\(day):\(deviceId)"
        setSetting(k, .number((setting(k)?.double ?? 0) + n))
    }
    func practiceOn(_ kind: String, _ day: String = Day.today) -> Double {
        let p = "practice:\(kind):\(day):"
        return all("kv").filter { $0.id.hasPrefix(p) }.reduce(0) { $0 + ($1["value"]?.double ?? 0) }
    }
}
