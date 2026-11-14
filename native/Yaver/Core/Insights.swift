// Insights (twin of js/insights.js): rule-based findings across everything logged
// (meals and their times, feelings, body and weigh-ins, training, study, çetele,
// money). Each check returns a plain finding only when the data is strong enough.
// No AI call: instant and offline. Home shows the top few; the assistant gets all.
import Foundation

struct Insight: Identifiable {
    let id: String
    let area: String
    let level: Int // 3 act on it, 2 worth knowing, 1 a note
    let go: String
    let text: String
    let ask: String?
}

enum Insights {
    private static func pct(_ a: Double, _ b: Double) -> Int { b != 0 ? Int((a / b * 100).rounded()) : 0 }
    private static func plural(_ n: Int, _ w: String) -> String { "\(n) \(w)\(n == 1 ? "" : "s")" }
    private static func signed(_ x: Double) -> String { (x > 0 ? "+" : "") + String(format: "%.1f", x) }

    private static func feelings(_ s: Store) -> Insight? {
        let list = s.all("checkins").filter { $0.str("date") > Day.add(Day.today, -7) }
        let bad = list.filter { $0.str("feel") == "bad" }
        if list.count < 3 || bad.count < 2 || Double(bad.count) / Double(list.count) < 0.4 { return nil }
        return Insight(id: "feel-bad", area: "You", level: 3, go: "diet",
                       text: "You felt bad on \(bad.count) of the last \(list.count) days you checked in.",
                       ask: "I have felt bad on several days this week (diet_history has my check-ins). Look at what I ate, when I ate, my training and sleep-related clues on the days before, and tell me plainly what could be behind it and what to try. Say when I should see a doctor.")
    }

    private static func lateEating(_ s: Store) -> Insight? {
        guard let t = DietLog.report(s, 14).timing else { return nil }
        let a = t.afterLate, o = t.afterOther
        if a.days >= 2 && o.days >= 2 {
            let ra = Double(a.bad) / Double(a.days), ro = Double(o.bad) / Double(o.days)
            if ra >= 0.5 && ra > ro + 0.25 {
                return Insight(id: "late-mornings", area: "Food timing", level: 3, go: "diet",
                               text: "After late eating you felt bad on \(a.bad) of \(a.days) mornings; after other days, \(o.bad) of \(o.days).",
                               ask: "My diary shows I feel worse the morning after eating late. Look at diet_history (times, what I ate late, how I felt) and suggest a simple evening eating plan that fits my day.")
            }
        }
        let recent = t.lateDays.filter { $0 > Day.add(Day.today, -7) }
        if recent.count >= 3 {
            return Insight(id: "late-often", area: "Food timing", level: 2, go: "diet",
                           text: "A third or more of your food came after 21:00 on \(recent.count) of the last 7 days.",
                           ask: "I have been eating late on most days this week (diet_history). What does late eating do for sleep, digestion and my goal, and how can I move food earlier?")
        }
        return nil
    }

    private static func againstPlan(_ s: Store) -> Insight? {
        guard let st = BodyCalc.status(s), let p = st.projection else { return nil }
        let balance = Int(p.balance.rounded())
        if st.target.mode == "cut" && balance > 150 {
            return Insight(id: "plan-surplus", area: "Body", level: 3, go: "body",
                           text: "The plan is to lose fat, but you have eaten about \(balance) kcal a day over your burn. At this rate: \(p.month.fat > 0 ? "+" : "")\(BodyCalc.r1(p.month.fat)) kg of fat in a month.",
                           ask: "I am eating over my burn while my plan is to lose fat (body_status, diet_history). Where are the extra calories coming from, and what are 3 easy swaps?")
        }
        if st.target.mode == "gain" && balance < -250 {
            return Insight(id: "plan-deficit", area: "Body", level: 2, go: "body",
                           text: "You are trying to build muscle but eating about \(-balance) kcal a day under your burn.",
                           ask: "I want to build muscle but my food logs show a deficit (body_status, diet_history). How do I add the calories easily?")
        }
        return nil
    }

    private static func protein(_ s: Store) -> Insight? {
        let r = DietLog.report(s, 7, end: Day.add(Day.today, -1))
        guard r.loggedDays >= 4, let p = r.nutrients.first(where: { $0.key == "protein" }), let pc = p.pct, pc < 80 else { return nil }
        return Insight(id: "protein-low", area: "Food", level: 2, go: "diet",
                       text: "Protein has averaged \(Int(p.avg.rounded())) g a day this week, \(pc)% of your \(Int(p.ref)) g goal.",
                       ask: "My protein is below my goal this week (diet_history). Suggest simple high-protein foods I can add here in Kazakhstan, by meal.")
    }

    private static func lowNutrients(_ s: Store) -> Insight? {
        let r = DietLog.report(s, 7, end: Day.add(Day.today, -1))
        if r.detailedDays < 3 { return nil }
        let low = Array(r.low.filter { $0.kind != "goal" && ($0.pct ?? 100) < 50 }.prefix(3))
        if low.isEmpty { return nil }
        let names = low.map(\.label).joined(separator: ", ")
        return Insight(id: "low-" + low.map(\.key).joined(separator: "-"), area: "Food", level: 2, go: "diet",
                       text: "Low all week: \(low.map { "\($0.label) \($0.pct ?? 0)%" }.joined(separator: ", ")) of the daily value.",
                       ask: "My food diary shows \(names) well under the daily value this week (diet_history). Which everyday foods fix that, and is any of it worth checking with a blood test?")
    }

    private static func overLimits(_ s: Store) -> Insight? {
        let r = DietLog.report(s, 7, end: Day.add(Day.today, -1))
        guard r.detailedDays >= 3, let h = r.high.first, (h.pct ?? 0) >= 120 else { return nil }
        return Insight(id: "high-\(h.key)", area: "Food", level: 1, go: "diet",
                       text: "\(h.label) has averaged \(h.pct ?? 0)% of the daily limit this week.",
                       ask: "My \(h.label.lowercased()) is over the daily limit this week (diet_history). Which of my foods bring it in, and what can I swap?")
    }

    private static func training(_ s: Store) -> Insight? {
        guard BodyCalc.profile(s) != nil else { return nil }
        let past = Training.week(s).filter { $0.session != nil && $0.day < Day.today }
        let missed = past.filter { $0.done == nil }
        let all = Training.workouts(s)
        let any = all.contains { $0.str("date") > Day.add(Day.today, -14) }
        if !any && !all.isEmpty {
            return Insight(id: "train-stopped", area: "Training", level: 2, go: "body", text: "No training logged in the last two weeks.",
                           ask: "I have not trained for two weeks. Give me a short, easy plan to restart this week without getting hurt.")
        }
        if missed.count >= 2 && !all.isEmpty {
            let f = DateFormatter(); f.locale = Locale(identifier: "en_GB"); f.dateFormat = "EEE"
            return Insight(id: "train-missed", area: "Training", level: 2, go: "body",
                           text: "\(plural(missed.count, "planned session")) missed this week (\(missed.map { f.string(from: Day.date($0.day)) }.joined(separator: ", "))).",
                           ask: "I missed some planned training this week (body_status). How do I fit the important parts into the days left?")
        }
        return nil
    }

    private static func weightVsLogs(_ s: Store) -> Insight? {
        let w = s.weighins()
        guard w.count >= 2, let last = w.last else { return nil }
        let first = w.first { $0.str("date") >= Day.add(Day.today, -28) } ?? w[w.count - 2]
        let days = Day.days(between: first.str("date"), last.str("date"))
        if days < 10 || first.id == last.id { return nil }
        guard let p = BodyCalc.profile(s) else { return nil }
        let logged = BodyCalc.days(s, days, end: last.str("date"), p).filter { $0.counted }
        if Double(logged.count) < Double(days) * 0.6 { return nil }
        let predicted = logged.reduce(0) { $0 + $1.e.fat + $1.e.muscle } / 1000
        let actual = last.num("kg") - first.num("kg")
        if abs(actual - predicted) < 1.2 { return nil }
        return Insight(id: "weight-vs-logs", area: "Body", level: 1, go: "body",
                       text: "Your weight changed \(signed(actual)) kg since \(first.str("date")), but your food logs predict \(signed(predicted)) kg. \(actual > predicted ? "Some food may be missing from the logs." : "You may burn more than estimated.")",
                       ask: "My weigh-ins and my food logs disagree (body_status, diet_history). What is the likely reason and how do I make the numbers more accurate?")
    }

    private static func loggingGaps(_ s: Store) -> Insight? {
        let r = DietLog.report(s, 7, end: Day.add(Day.today, -1))
        if s.count("meals") == 0 || r.loggedDays >= 5 { return nil }
        return Insight(id: "log-gaps", area: "Data", level: 1, go: "diet",
                       text: "Food was logged on \(r.loggedDays) of the last 7 days, so food insights are rough. A photo per meal is enough.", ask: nil)
    }

    private static func study(_ s: Store) -> Insight? {
        let g = s.dailyStudyGoal
        if g <= 0 || s.count("sessions") == 0 { return nil }
        var min = 0.0
        for i in 1...7 { min += s.studyMinutes(Day.add(Day.today, -i)) }
        if min < g * 7 * 0.5 {
            return Insight(id: "study-behind", area: "Study", level: 2, go: "study",
                           text: "\((min / 60 * 10).rounded() / 10) h of study in the last 7 days, \(pct(min, g * 7))% of your goal.",
                           ask: "My study time is well under my goal this week (get_course_progress and my sessions). What is the smallest plan that gets me back on track?")
        }
        return nil
    }

    private static func money(_ s: Store) -> Insight? {
        let budget = s.monthlyBudget
        let list = s.expenses()
        let month = list.reduce(0) { $0 + $1.num("amount") }
        if budget <= 0 || month <= 0 { return nil }
        let day = Day.cal.component(.day, from: Date())
        let dim = Day.cal.range(of: .day, in: .month, for: Date())?.count ?? 30
        if day < 5 { return nil }
        let pace = month / Double(day) * Double(dim)
        if pace <= budget * 1.1 { return nil }
        var cats: [String: Double] = [:]
        for e in list { cats[e.str("category"), default: 0] += e.num("amount") }
        let top = cats.max { $0.value < $1.value }?.key
        return Insight(id: "money-pace-\(Day.month())", area: "Money", level: 2, go: "money",
                       text: "At this pace you will spend about \(fmt(pace.rounded(), 0)) this month, \(pct(pace, budget) - 100)% over the budget\(top.map { "; most goes to \($0)" } ?? "").",
                       ask: "I am on pace to go over my monthly budget. Look at my spending by category and suggest where to cut for the rest of the month.")
    }

    private static func cetele(_ s: Store) -> Insight? {
        let logged = Set(s.all("ceteleLog").map { $0.str("item") })
        for i in s.ceteleItems() where i.str("per") != "week" && logged.contains(i.id) {
            let target = max(1, i.num("target"))
            let missed = (1...7).filter { s.ceteleValue(i.id, Day.add(Day.today, -$0)) < target }.count
            if missed >= 5 {
                return Insight(id: "cetele-\(i.id)", area: "Çetele", level: 1, go: "cetele", text: "\(i.str("name")) was missed on \(missed) of the last 7 days.", ask: nil)
            }
        }
        return nil
    }

    private static let checks: [(Store) -> Insight?] = [feelings, lateEating, againstPlan, protein, lowNutrients, overLimits, training, weightVsLogs, loggingGaps, study, money, cetele]

    /// Every finding, most important first. Findings hidden today are left out unless hidden is false.
    static func all(_ s: Store, hidden: Bool = true) -> [Insight] {
        let hide = s.setting("insightsHidden")?.object ?? [:]
        return checks.compactMap { $0(s) }
            .filter { !hidden || hide[$0.id]?.string != Day.today }
            .sorted { $0.level > $1.level }
    }

    static func hide(_ s: Store, _ id: String) {
        var h = (s.setting("insightsHidden")?.object ?? [:]).filter { $0.value.string == Day.today }
        h[id] = .string(Day.today)
        s.setSetting("insightsHidden", .object(h))
    }

    static func forAI(_ s: Store) -> JSON {
        let names = ["", "note", "worth knowing", "act on it"]
        return .object([
            "insights": .array(all(s, hidden: false).map { .object(["area": .string($0.area), "importance": .string(names[$0.level]), "text": .string($0.text)]) }),
            "note": "Rule-based findings from the logged data, shown only when the data is strong enough. Explain them plainly and suggest one next step.",
        ])
    }
}
