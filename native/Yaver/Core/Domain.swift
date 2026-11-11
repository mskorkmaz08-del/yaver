// What the screens mean by "today's Çetele", "this month's spending" and so on:
// the same rules as js/data.js, js/cetele.js, js/dietlog.js, js/teams.js and
// js/body.js, and the same record shapes, so the web app reads what this app writes.
import Foundation

// MARK: - Day keys ("2026-11-11", local time)

enum Day {
    static var cal: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = .current
        return c
    }()
    static func key(_ d: Date = Date()) -> String {
        let c = cal.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
    static var today: String { key() }
    static func date(_ key: String) -> Date {
        let p = key.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return Date() }
        return cal.date(from: DateComponents(year: p[0], month: p[1], day: p[2])) ?? Date()
    }
    static func add(_ key: String, _ n: Int) -> String { Day.key(cal.date(byAdding: .day, value: n, to: date(key)) ?? Date()) }
    static func weekStart(_ key: String = today) -> String {
        let d = date(key)
        let dow = (cal.component(.weekday, from: d) + 5) % 7 // Monday = 0
        return add(key, -dow)
    }
    static func month(_ key: String = today) -> String { String(key.prefix(7)) }
    static func hm(_ d: Date = Date()) -> String {
        let c = cal.dateComponents([.hour, .minute], from: d)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }
    static func label(_ key: String) -> String {
        if key == today { return "Today" }
        if key == add(today, -1) { return "Yesterday" }
        if key == add(today, 1) { return "Tomorrow" }
        let f = DateFormatter()
        f.dateFormat = "EEE d MMM"
        return f.string(from: date(key))
    }
    static func days(between a: String, _ b: String) -> Int {
        cal.dateComponents([.day], from: date(a), to: date(b)).day ?? 0
    }
}

func fmt(_ n: Double, _ digits: Int = 0) -> String {
    let f = NumberFormatter()
    f.numberStyle = .decimal
    f.maximumFractionDigits = digits
    f.minimumFractionDigits = 0
    return f.string(from: NSNumber(value: n)) ?? String(n)
}
/// For text fields: no grouping, a dot for decimals, so number() reads it back.
func plain(_ n: Double) -> String { n.rounded() == n ? String(Int64(n)) : String(format: "%.1f", n) }
func mins(_ m: Double) -> String { m >= 60 ? "\(Int(m) / 60)h \(Int(m.rounded()) % 60)m" : "\(Int(m.rounded()))m" }

// MARK: - Çetele

struct CeteleRow: Identifiable {
    let item: Row
    var id: String { item.id }
    var name: String { item.str("name") }
    var unit: String { item.str("unit") }
    var target: Double { max(1, item.num("target")) }
    var weekly: Bool { item.str("per") == "week" }
    var step: Double { max(1, item.num("step")) }
    var isCheck: Bool { target == 1 && unit.isEmpty }
    let value: Double
    let progress: Double
    var met: Bool { progress >= target }
}

extension Store {
    func ceteleItems() -> [Row] {
        all("ceteleItems").filter { !$0.flag("archived") }.sorted { ($0["order"]?.double ?? 99) < ($1["order"]?.double ?? 99) }
    }
    func ceteleValue(_ item: String, _ day: String = Day.today) -> Double { get("ceteleLog", "\(item):\(day)")?.num("value") ?? 0 }
    func ceteleProgress(_ item: Row, _ day: String = Day.today) -> Double {
        guard item.str("per") == "week" else { return ceteleValue(item.id, day) }
        var total = 0.0, k = Day.weekStart(day)
        while k <= day { total += ceteleValue(item.id, k); k = Day.add(k, 1) }
        return total
    }
    func cetele(_ day: String = Day.today) -> [CeteleRow] {
        ceteleItems().map { CeteleRow(item: $0, value: ceteleValue($0.id, day), progress: ceteleProgress($0, day)) }
    }
    func setCetele(_ item: String, _ value: Double, _ day: String = Day.today) {
        var row = get("ceteleLog", "\(item):\(day)") ?? ["id": .string("\(item):\(day)"), "item": .string(item), "day": .string(day)]
        row["value"] = .number(max(0, value.rounded()))
        put("ceteleLog", row)
    }
    /// Days in a row with every daily minimum met (today counts once complete).
    func ceteleStreak() -> Int {
        let list = ceteleItems().filter { $0.str("per") != "week" }
        guard !list.isEmpty else { return 0 }
        let full = { (k: String) in list.allSatisfy { self.ceteleValue($0.id, k) >= max(1, $0.num("target")) } }
        var n = 0, k = full(Day.today) ? Day.today : Day.add(Day.today, -1)
        while n < 3650 && full(k) { n += 1; k = Day.add(k, -1) }
        return n
    }
}

// MARK: - Diet

enum Meals {
    static let types = ["Breakfast", "Lunch", "Dinner", "Snack"]
    static func guess() -> String {
        let h = Day.cal.component(.hour, from: Date())
        return h < 11 ? "Breakfast" : h < 16 ? "Lunch" : h < 21 ? "Dinner" : "Snack"
    }
}

struct DietDay {
    let meals: [Row]
    var calories: Double { meals.reduce(0) { $0 + $1.num("calories") } }
    var protein: Double { meals.reduce(0) { $0 + $1.num("protein") } }
    var carbs: Double { meals.reduce(0) { $0 + $1.num("carbs") } }
    var fat: Double { meals.reduce(0) { $0 + $1.num("fat") } }
    var fiber: Double { meals.reduce(0) { $0 + $1.num("fiber") } }
    var micros: [String: Double] {
        var t: [String: Double] = [:]
        for m in meals { for (k, v) in m["micros"]?.object ?? [:] { t[k, default: 0] += v.double ?? 0 } }
        return t
    }
}

extension Store {
    /// When a meal was eaten: its time, else (older meals) when it was logged that day.
    func mealTime(_ m: Row) -> String? {
        let t = m.str("time")
        if !t.isEmpty { return t }
        if let at = Store.parseISO(m.str("createdAt")), Day.key(at) == m.str("date") { return Day.hm(at) }
        return nil
    }
    func diet(_ day: String = Day.today) -> DietDay {
        let meals = all("meals").filter { $0.str("date") == day }.sorted {
            let a = Meals.types.firstIndex(of: $0.str("meal")) ?? 9, b = Meals.types.firstIndex(of: $1.str("meal")) ?? 9
            return a != b ? a < b : (mealTime($0) ?? "") < (mealTime($1) ?? "")
        }
        return DietDay(meals: meals)
    }
    var calorieGoal: Double { setting("dailyCalories")?.double ?? 2200 }
    var proteinGoal: Double { setting("dailyProtein")?.double ?? 120 }
    func feeling(_ day: String) -> Row? { all("checkins").first { $0.str("date") == day } }
    func setFeeling(_ day: String, _ feel: String) {
        if let have = feeling(day) {
            if have.str("feel") == feel { remove("checkins", have.id); return }
            var r = have; r["feel"] = .string(feel); put("checkins", r)
        } else {
            put("checkins", ["date": .string(day), "feel": .string(feel)])
        }
    }
}

// MARK: - Money

enum Money {
    static let categories = ["Food", "Groceries", "Transport", "Shopping", "Bills", "Health", "Education", "Entertainment", "Coffee", "Other"]
    static let currencies = ["TRY", "KZT", "USD", "EUR", "GBP", "RUB", "AED", "UZS", "KGS", "AZN", "GEL", "CNY"]
}

extension Store {
    var currency: String { setting("currency")?.string ?? "TRY" }
    var monthlyBudget: Double { setting("monthlyBudget")?.double ?? 0 }
    func expenses(from: String, to: String) -> [Row] {
        all("expenses").filter { $0.str("date") >= from && $0.str("date") <= to }
            .sorted { ($0.str("date") + $0.str("createdAt")) > ($1.str("date") + $1.str("createdAt")) }
    }
    func expenses(month: String = Day.month()) -> [Row] { all("expenses").filter { $0.str("date").hasPrefix(month) } }
    func money(_ n: Double) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = currency
        f.maximumFractionDigits = abs(n) >= 1000 ? 0 : 2
        return f.string(from: NSNumber(value: n)) ?? "\(fmt(n, 2)) \(currency)"
    }
}

// MARK: - Study

extension Store {
    func studyMinutes(_ day: String) -> Double { all("sessions").filter { $0.str("date") == day }.reduce(0) { $0 + $1.num("minutes") } }
    var dailyStudyGoal: Double { setting("dailyStudyMin")?.double ?? 60 }
    var streakNeed: Double { setting("streakMin")?.double ?? min(15, dailyStudyGoal) }
    func studyStreak() -> Int {
        var per: [String: Double] = [:]
        for s in all("sessions") { per[s.str("date"), default: 0] += s.num("minutes") }
        var n = 0, k = Day.today
        if (per[k] ?? 0) < streakNeed { k = Day.add(k, -1) }
        while (per[k] ?? 0) >= streakNeed { n += 1; k = Day.add(k, -1) }
        return n
    }
    func subject(named name: String) -> Row {
        let clean = name.trimmingCharacters(in: .whitespaces).isEmpty ? "General" : name.trimmingCharacters(in: .whitespaces)
        if let s = all("subjects").first(where: { $0.str("name").lowercased() == clean.lowercased() }) { return s }
        let colors = ["#7c9cff", "#5ad1b0", "#ffb547", "#ff6b8b", "#b58cff", "#4fc3f7", "#9ccc65", "#ff8a65"]
        return put("subjects", ["name": .string(clean), "color": .string(colors[count("subjects") % colors.count]), "goalHours": 0])
    }
    /// The ML plan (kv "plan"): week number and current phase.
    func plan() -> (title: String, week: Int, phase: String, subjectId: String?)? {
        guard let p = setting("plan"), let start = p["start"]?.string else { return nil }
        let week = Day.days(between: start, Day.today) / 7 + 1
        let phases = p["phases"]?.array ?? []
        let t = Day.today
        let cur = phases.first { ($0["start"]?.string ?? "") <= t && t <= ($0["end"]?.string ?? "") } ?? (t < start ? phases.first : phases.last)
        let subj = cur?["subject"]?.string ?? ""
        let sid = all("subjects").first { $0.str("name") == subj }?.id
        return (p["title"]?.string ?? "Plan", week, cur?["name"]?.string ?? "", sid)
    }
    func milestones(_ subjectId: String) -> [Row] {
        all("milestones").filter { $0.str("subjectId") == subjectId }.sorted { $0.num("order") < $1.num("order") }
    }
    func courseCounts() -> (done: Int, flagged: Int, cardsDue: Int) {
        let p = all("courseProgress")
        let due = all("cards").filter { $0.str("due") <= Day.today }.count
        return (p.filter { $0.str("status") == "done" }.count, p.filter { $0.str("status") == "flagged" }.count, due)
    }
    func openTasks() -> [Row] {
        all("tasks").filter { !$0.flag("done") }.sorted { ($0.str("due").isEmpty ? "9999" : $0.str("due")) < ($1.str("due").isEmpty ? "9999" : $1.str("due")) }
    }
    func upcomingEvents(_ n: Int = 5) -> [Row] {
        let now = Store.isoNow()
        return all("events").filter { $0.str("end") >= now }.sorted { $0.str("start") < $1.str("start") }.prefix(n).map { $0 }
    }
}

// MARK: - Teams

struct PersonStatus {
    let lastAt: String?
    let days: Int?
    let every: Int
    let overdue: Bool
}

extension Store {
    static let teams = ["student", "dev"]
    static func teamName(_ t: String) -> String { t == "dev" ? "Dev team" : "Students" }
    func people(_ team: String? = nil) -> [Row] {
        all("people").filter { team == nil || $0.str("team") == team }.sorted { $0.str("name").localizedCompare($1.str("name")) == .orderedAscending }
    }
    func activities() -> [Row] { all("activities").sorted { $0.str("date") > $1.str("date") } }
    private static func fold(_ s: String) -> String { s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "tr")).replacingOccurrences(of: "ı", with: "i") }
    private func mentions(_ text: String, _ p: Row) -> Bool {
        let full = Store.fold(p.str("name")).trimmingCharacters(in: .whitespaces)
        let first = String(full.split(separator: " ").first ?? "")
        let hay = Store.fold(text)
        return Set([full, first]).filter { $0.count >= 3 }.contains { n in
            hay.range(of: "(^|[^\\p{L}\\p{N}])\(NSRegularExpression.escapedPattern(for: n))($|[^\\p{L}\\p{N}])", options: .regularExpression) != nil
        }
    }
    func status(_ p: Row) -> PersonStatus {
        let now = Store.isoNow()
        var times = all("activities").filter { ($0["people"]?.array ?? []).contains(.string(p.id)) }.map { $0.str("date") }
        times += all("events").filter { !$0.flag("allDay") && mentions($0.str("title"), p) }.map { $0.str("start") }
        times += all("applecal").filter { !$0.flag("allDay") && mentions($0.str("title"), p) }.map { $0.str("start") }
        let last = times.filter { $0 <= now }.max()
        let hasNext = times.contains { $0 > now }
        let days = last.flatMap { Store.parseISO($0) }.map { Day.days(between: Day.key($0), Day.today) }
        let every = Int(p.num("meetEvery"))
        return PersonStatus(lastAt: last, days: days, every: every, overdue: every > 0 && !hasNext && (days == nil || days! > every))
    }
    func overduePeople() -> [(Row, PersonStatus)] {
        people().map { ($0, status($0)) }.filter { $0.1.overdue }.sorted { ($0.1.days ?? 100000) > ($1.1.days ?? 100000) }
    }
}

// MARK: - Body

extension Store {
    func weighins() -> [Row] { all("weighins").sorted { $0.str("date") < $1.str("date") } }
    func logWeight(_ kg: Double, _ day: String = Day.today) {
        var row = all("weighins").first { $0.str("date") == day } ?? [:]
        row["date"] = .string(day)
        row["kg"] = .number((kg * 10).rounded() / 10)
        put("weighins", row)
    }
}
