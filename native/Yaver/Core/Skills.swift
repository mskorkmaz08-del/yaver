// Skill levels (twin of js/skills.js): six areas drawn as a hexagon, like a
// footballer's attribute card. Lessons, tests, problems, tasks, study and Çetele
// add XP to an area. XP only grows, so levels never drop; a quiet week shows as form.
import Foundation

enum Skills {
    struct Area { let id, name, short: String; let k: Double; let tracks: [String] }
    struct Event { let day: String; let area: String; let xp: Int; let what: String }
    struct AreaSum: Identifiable {
        let area: Area; let xp: Double; let level: Int; let rating: Int; let ratingThen: Int
        let toNext: Double; let frac: Double; let week: Double; let prev: Double; let form: String
        var id: String { area.id }
    }
    struct Streak { let name: String; let current: Int; let best: Int }
    struct Summary { let areas: [AreaSum]; let overall: Int; let overallThen: Int; let totalXp: Double; let level: Int; let recent: [Event]; let streaks: [Streak] }

    static let areas: [Area] = [
        Area(id: "python", name: "Python", short: "PY", k: 3000, tracks: ["python"]),
        Area(id: "algo", name: "Algorithms & math", short: "ALG", k: 3000, tracks: ["algo", "math"]),
        Area(id: "systems", name: "C++ & tools", short: "SYS", k: 2500, tracks: ["cpp", "tools"]),
        Area(id: "robo", name: "Robotics & AI", short: "ROB", k: 3000, tracks: ["robo", "ai", "build"]),
        Area(id: "discipline", name: "Discipline", short: "DIS", k: 11000, tracks: []),
        Area(id: "spirit", name: "Çetele & reading", short: "ÇET", k: 18000, tracks: []),
    ]
    static let areaOfTrack: [String: String] = Dictionary(areas.flatMap { a in a.tracks.map { ($0, a.id) } }, uniquingKeysWith: { a, _ in a })

    static func events(_ s: Store) -> [Event] {
        var out: [Event] = []
        func push(_ day: String, _ area: String, _ xp: Double, _ what: String) {
            if !day.isEmpty && xp > 0 { out.append(Event(day: String(day.prefix(10)), area: area, xp: Int(xp.rounded()), what: what)) }
        }
        let C = Course.shared
        for p in s.all("courseProgress") {
            let at = p.str("completedAt")
            if at.isEmpty { continue }
            let l = C.ready ? C.lesson(s, p.str("lessonId")) : nil
            let track = p.str("track").isEmpty ? (l?.str("track") ?? "") : p.str("track")
            guard let area = areaOfTrack[track] ?? (track == "mixed" ? "algo" : nil) else { continue }
            let sc = p["score"]?.double ?? 0.75
            push(at, area, p.str("status") == "done" ? 60 + 40 * sc : 30, "Lesson: \(l?.str("title") ?? p.str("lessonId"))")
        }
        for t in s.all("courseTests") {
            for x in t["scores"]?.array ?? [] {
                if let area = areaOfTrack[x["track"]?.string ?? ""], let total = x["total"]?.double, total > 0 {
                    push(t.str("date"), area, 150 * ((x["right"]?.double ?? 0) / total), "Week \(t.str("week")) test")
                }
            }
        }
        for r in s.all("kv") {
            let id = r.id
            guard id.hasPrefix("practice:"), let v = r["value"]?.double, v > 0 else { continue }
            let parts = id.split(separator: ":").map(String.init)
            guard parts.count >= 3, parts[2].count >= 10 else { continue }
            let day = String(parts[2].prefix(10)), n = Int(v)
            if parts[1] == "problems" { push(day, "algo", 25 * v, "\(n) problem\(n > 1 ? "s" : "") solved") }
            else if parts[1] == "anki" { push(day, "discipline", 2 * v, "\(n) cards reviewed") }
        }
        for x in s.all("sessions") { push(x.str("date"), "discipline", x.num("minutes") / 4, "\(x.str("minutes")) min study") }
        for t in s.all("tasks") where t.flag("done") { push(t.str("doneAt"), "discipline", 10, "Done: \(t.str("title"))") }
        for m in s.all("milestones") where m.flag("done") { push(m.str("doneAt"), "discipline", 30, "Milestone: \(m.str("title"))") }
        let items = Dictionary(s.ceteleItems().map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var days = Set<String>(), spiritDay: [String: Double] = [:]
        for r in s.all("ceteleLog").sorted(by: { $0.id < $1.id }) {
            guard let it = items[r.str("item")], r.num("value") > 0 else { continue }
            let day = r.str("day")
            days.insert(day)
            let per = it.str("per") == "week" ? 150.0 : 50.0
            let xp = min(per * 1.5, per * r.num("value") / max(1, it.num("target")), 120 - (spiritDay[day] ?? 0))
            spiritDay[day, default: 0] += max(0, xp)
            let unit = it.str("unit")
            push(day, "spirit", xp, "\(it.str("name")) \(fmt(r.num("value")))\(unit.isEmpty ? "" : " " + unit)")
        }
        let daily = s.ceteleItems().filter { $0.str("per") != "week" }
        for d in days where !daily.isEmpty && daily.allSatisfy({ s.ceteleValue($0.id, d) >= max(1, $0.num("target")) }) {
            push(d, "discipline", 40, "Every Çetele minimum met")
        }
        return out.sorted { $0.day < $1.day }
    }

    static func rating(_ xp: Double, _ k: Double) -> Int { max(1, min(99, Int((1 + 98 * (xp / (xp + k)).squareRoot()).rounded()))) }
    static func levelOf(_ xp: Double) -> Int { Int(((1 + 8 * xp / 100).squareRoot() - 1) / 2) }
    static func xpFor(_ n: Int) -> Double { 50 * Double(n) * Double(n + 1) }

    static func summary(_ s: Store, at: String = Day.today) -> Summary {
        let ev = events(s)
        func sum(_ area: String, _ from: String, _ to: String) -> Double { ev.filter { $0.area == area && $0.day > from && $0.day <= to }.reduce(0) { $0 + Double($1.xp) } }
        let past = Day.add(at, -28), w1 = Day.add(at, -7), w2 = Day.add(at, -14)
        let list = areas.map { a -> AreaSum in
            let xp = sum(a.id, "", at), then = sum(a.id, "", past)
            let level = levelOf(xp)
            let week = sum(a.id, w1, at), prev = sum(a.id, w2, w1)
            return AreaSum(area: a, xp: xp, level: level, rating: rating(xp, a.k), ratingThen: rating(then, a.k), toNext: xpFor(level + 1) - xp,
                           frac: (xp - xpFor(level)) / (xpFor(level + 1) - xpFor(level)), week: week, prev: prev,
                           form: week > prev * 1.1 ? "up" : week < prev * 0.9 ? "down" : "same")
        }
        let overall = Int((Double(list.reduce(0) { $0 + $1.rating }) / Double(list.count)).rounded())
        let overallThen = Int((Double(list.reduce(0) { $0 + $1.ratingThen }) / Double(list.count)).rounded())
        let total = list.reduce(0) { $0 + $1.xp }
        let recent = Array(ev.filter { $0.day > Day.add(at, -14) }.suffix(8).reversed())
        return Summary(areas: list, overall: overall, overallThen: overallThen, totalXp: total, level: levelOf(total / Double(areas.count)), recent: recent, streaks: streaks(s))
    }

    /// Longest run of consecutive days in a set of day keys.
    static func best(_ days: Set<String>) -> Int {
        var best = 0
        for d in days where !days.contains(Day.add(d, -1)) {
            var n = 0, k = d
            while days.contains(k) { n += 1; k = Day.add(k, 1) }
            best = max(best, n)
        }
        return best
    }

    static func streaks(_ s: Store) -> [Streak] {
        var per: [String: Double] = [:]
        for x in s.all("sessions") { per[x.str("date"), default: 0] += x.num("minutes") }
        let studyDays = Set(per.filter { $0.value >= s.streakNeed }.keys)
        let daily = s.ceteleItems().filter { $0.str("per") != "week" }
        let logged = Set(s.all("ceteleLog").map { $0.str("day") })
        let ceteleDays = daily.isEmpty ? Set<String>() : Set(logged.filter { d in daily.allSatisfy { s.ceteleValue($0.id, d) >= max(1, $0.num("target")) } })
        let st = s.studyStreak(), ct = s.ceteleStreak()
        return [Streak(name: "Study", current: st, best: max(st, best(studyDays))), Streak(name: "Çetele", current: ct, best: max(ct, best(ceteleDays)))]
    }
}
