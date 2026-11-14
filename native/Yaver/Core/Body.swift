// Body and training (twins of js/body.js and js/training.js): profile from height and
// weigh-ins, body fat (measured, waist RFM or BMI), the athletic FFMI target and plan,
// what each day's eating does to fat and muscle, the projection, and the training split.
import Foundation

enum Training {
    struct Session { let key: String; let name: String; let items: [(ex: String, sets: Double, reps: String)] }
    static var ex: [String: JSON] { TrainingData.all["ex"]?.object ?? [:] }
    static var muscles: [String: String] { (TrainingData.all["muscles"]?.object ?? [:]).compactMapValues { $0.string } }
    static var mobility: String { TrainingData.all["mobility"]?.string ?? "" }
    static func session(_ key: String) -> Session? {
        guard let s = TrainingData.all["sessions"]?[key] else { return nil }
        let items = (s["items"]?.array ?? []).compactMap { it -> (String, Double, String)? in
            guard let a = it.array, a.count >= 3, let e = a[0].string else { return nil }
            return (e, a[1].double ?? 0, a[2].string ?? a[2].double.map { plain($0) } ?? "")
        }
        return Session(key: key, name: s["name"]?.string ?? key, items: items.map { (ex: $0.0, sets: $0.1, reps: $0.2) })
    }
    static var sessionKeys: [String] { Array((TrainingData.all["sessions"]?.object ?? [:]).keys).sorted() }
    static func exName(_ k: String) -> String { ex[k]?.array?.first?.string ?? k }
    static func exMuscles(_ k: String) -> (main: [String], side: [String]) {
        let a = ex[k]?.array ?? []
        return ((a.count > 1 ? a[1].array : nil)?.compactMap { $0.string } ?? [], (a.count > 2 ? a[2].array : nil)?.compactMap { $0.string } ?? [])
    }

    static let plan: [Int: [Int: String]] = [
        3: [1: "fullA", 3: "fullB", 5: "fullC"],
        4: [1: "lowerPower", 2: "upperStrength", 4: "lowerStrength", 5: "upperPower"],
        5: [1: "lowerPower", 2: "upperStrength", 4: "lowerStrength", 5: "upperPower", 6: "speed"],
    ]
    static func daysAWeek(_ s: Store) -> Int { let d = Int(s.setting("trainDays")?.double ?? 4); return [3, 4, 5].contains(d) ? d : 4 }
    /// JS getDay(): Sunday 0 … Saturday 6.
    static func jsDay(_ key: String) -> Int { Day.cal.component(.weekday, from: Day.date(key)) - 1 }
    static func sessionOn(_ s: Store, _ date: String = Day.today) -> Session? { plan[daysAWeek(s)]?[jsDay(date)].flatMap { session($0) } }
    static func week(_ s: Store, _ date: String = Day.today) -> [(day: String, session: Session?, done: Row?)] {
        let monday = Day.add(date, -((jsDay(date) + 6) % 7))
        return (0..<7).map { i in let d = Day.add(monday, i); return (d, sessionOn(s, d), doneOn(s, d)) }
    }
    static func workouts(_ s: Store) -> [Row] { s.all("workouts").sorted { $0.str("date") < $1.str("date") } }
    static func doneOn(_ s: Store, _ date: String) -> Row? { s.all("workouts").first { $0.str("date") == date } }
    @discardableResult
    static func markDone(_ s: Store, _ date: String = Day.today, _ key: String? = nil) -> Row? {
        if let have = doneOn(s, date) { s.remove("workouts", have.id); return nil }
        let k = key ?? sessionOn(s, date)?.key ?? "other"
        return s.put("workouts", ["date": .string(date), "session": .string(k), "name": .string(session(k)?.name ?? "Training")])
    }
    static func markDoneForTool(_ s: Store, date: String, session k: String) -> JSON {
        let r = markDone(s, date, k.isEmpty ? (sessionOn(s, date)?.key ?? "fullA") : k)
        return r.map { .object(["ok": true, "done": .string($0.str("name"))]) } ?? .object(["ok": true, "undone": true])
    }
    static func recentPerWeek(_ s: Store, _ end: String = Day.today) -> Double? {
        let from = Day.add(end, -13)
        let n = s.all("workouts").filter { $0.str("date") >= from && $0.str("date") <= end }.count
        return n > 0 ? Double(n) / 2 : nil
    }
    static func setsThisWeek(_ s: Store, _ end: String = Day.today) -> [String: Double] {
        let from = Day.add(end, -6)
        var sets: [String: Double] = [:]
        for w in s.all("workouts") where w.str("date") >= from && w.str("date") <= end {
            for it in session(w.str("session"))?.items ?? [] {
                let m = exMuscles(it.ex)
                for x in m.main { sets[x, default: 0] += it.sets }
                for x in m.side { sets[x, default: 0] += it.sets / 2 }
            }
        }
        return sets
    }
}

enum BodyCalc {
    static let activity: [(key: String, label: String, factor: Double)] = [("low", "Mostly sitting", 1.2), ("light", "On my feet a bit, walk daily", 1.375), ("moderate", "Active job or sport 3-5 days", 1.55), ("high", "Hard training most days", 1.725)]
    static let experience: [(key: String, label: String, factor: Double)] = [("new", "New to lifting (under 1 year)", 1), ("some", "1 to 3 years", 0.5), ("long", "More than 3 years", 0.25)]
    static let fatKcal = 7700.0, muscleKcal = 2800.0, leanLossKcal = 1800.0
    static func r1(_ x: Double) -> Double { (x * 10).rounded() / 10 }

    struct Profile {
        let kg, height: Double; let male: Bool; let age: Double; let bmi, bodyFat: Double; let fatFrom: String; let waist, lean, fatKg, ffmi, bmr, tdee: Double
        let activity: String; let training: Double; let trainingFrom: String; let experience: String; let muscleCap: Double; let weighedOn: String
    }
    struct Target { let kg, low, high, bodyFat, ffmi, lean, muscle, fatToLose: Double; let mode: String; let calories, protein, fat, carbs: Double; let months: Int }
    struct Effect { let balance: Double; let fat: Double; let muscle: Double }
    struct DayEffect { let date: String; let logged: Bool; let counted: Bool; let calories: Double; let protein: Double; let e: Effect }
    struct Sum { let days: Int; let balance: Double; let fat: Double; let muscle: Double }
    struct Projection { let from: Int; let kcal, protein, balance: Double; let month: (fat: Double, muscle: Double, kg: Double); let quarter: (fat: Double, muscle: Double, kg: Double) }
    struct Status { let profile: Profile; let target: Target; let today: DayEffect?; let week: Sum; let weekList: [DayEffect]; let month: Sum; let projection: Projection? }

    static func weighins(_ s: Store) -> [Row] { s.weighins() }
    static func logWeight(_ s: Store, kg: Double, date: String = Day.today, waist: Double? = nil, fat: Double? = nil) {
        var row = s.all("weighins").first { $0.str("date") == date } ?? [:]
        row["date"] = .string(date); row["kg"] = .number(r1(kg))
        if let waist, waist > 0 { row["waist"] = .number(r1(waist)) }
        if let fat, fat > 0 { row["fat"] = .number(r1(fat)) }
        s.put("weighins", row)
    }

    static func profile(_ s: Store) -> Profile? {
        let w = s.weighins()
        let height = s.setting("bodyHeight")?.double ?? 0
        guard let last = w.last, height > 0 else { return nil }
        let male = (s.setting("bodySex")?.string ?? "m") != "f"
        let year = Double(Day.cal.component(.year, from: Date()))
        let birth = s.setting("bodyBirth")?.double ?? 0
        let age = max(16, year - (birth > 0 ? birth : year - 30))
        let kg = last.num("kg"), m = height / 100
        let bmi = kg / (m * m)
        let waist = w.last { $0.num("waist") > 0 }?.num("waist") ?? 0
        let measured = w.last { $0.num("fat") > 0 }?.num("fat") ?? 0
        var bf: Double, from: String
        if measured > 0 { bf = measured; from = "measured" }
        else if waist > 0 { bf = (male ? 64 : 76) - 20 * (height / waist); from = "waist" }
        else { bf = 1.2 * bmi + 0.23 * age - 10.8 * (male ? 1 : 0) - 5.4; from = "BMI" }
        bf = min(50, max(male ? 5 : 10, bf))
        let lean = kg * (1 - bf / 100)
        let act = activity.first { $0.key == (s.setting("bodyActivity")?.string ?? "moderate") } ?? activity[2]
        let bmr = 10 * kg + 6.25 * height - 5 * age + (male ? 5 : -161)
        let logged = Training.recentPerWeek(s)
        let training = logged ?? Double(Training.daysAWeek(s))
        let exp = experience.first { $0.key == (s.setting("bodyExperience")?.string ?? "new") } ?? experience[0]
        let cap = (male ? 0.9 : 0.45) * exp.factor * min(1, training / 3)
        return Profile(kg: kg, height: height, male: male, age: age, bmi: r1(bmi), bodyFat: r1(bf), fatFrom: from, waist: waist, lean: r1(lean), fatKg: r1(kg - lean),
                       ffmi: r1(lean / (m * m)), bmr: bmr.rounded(), tdee: (bmr * act.factor).rounded(), activity: act.key, training: training,
                       trainingFrom: logged == nil ? "plan" : "logged", experience: exp.key, muscleCap: cap, weighedOn: last.str("date"))
    }

    static func target(_ s: Store, _ p: Profile) -> Target {
        let h2 = (p.height / 100) * (p.height / 100)
        let ffmi = p.male ? 22.0 : 18.5, bf = p.male ? 12.0 : 20.0
        func at(_ f: Double) -> Double { r1(f * h2 / (1 - bf / 100)) }
        let lean = max(p.lean, ffmi * h2)
        let kg = r1(lean / (1 - bf / 100))
        let muscle = r1(max(0, lean - p.lean))
        let fatToLose = r1(max(0, p.fatKg - kg * bf / 100))
        let cut = p.bodyFat > bf + 4
        let calories = ((p.tdee + (cut ? -450 : min(300, p.tdee * 0.1))) / 10).rounded() * 10
        let protein = (p.kg * (cut ? 2.2 : 1.8) / 5).rounded() * 5
        let fat = (calories * 0.25 / 9 / 5).rounded() * 5
        let carbs = max(0, ((calories - protein * 4 - fat * 9) / 4 / 5).rounded() * 5)
        let monthlyFat = cut ? 450 * 30 / fatKcal : 0
        let exp = experience.first { $0.key == p.experience } ?? experience[0]
        let monthlyMuscle = max(0.05, (p.male ? 0.9 : 0.45) * exp.factor * min(1, Double(Training.daysAWeek(s)) / 3))
        let cutMonths = cut ? fatToLose / max(0.1, monthlyFat) : 0
        let months = Int((cutMonths + max(0, muscle - cutMonths * monthlyMuscle * 0.4) / monthlyMuscle).rounded(.up))
        return Target(kg: kg, low: at(ffmi - 1), high: at(ffmi + 1), bodyFat: bf, ffmi: ffmi, lean: r1(lean), muscle: muscle, fatToLose: fatToLose,
                      mode: cut ? "cut" : "gain", calories: calories, protein: protein, fat: fat, carbs: carbs, months: min(months, 60))
    }

    static func effect(_ kcal: Double, _ protein: Double, _ p: Profile) -> Effect {
        let balance = kcal - p.tdee
        let proteinOK = min(1, protein / (1.6 * p.kg))
        let capped = p.muscleCap / 30 * proteinOK
        var muscle: Double, fat: Double
        if balance >= 0 {
            muscle = min(capped, balance / muscleKcal); fat = (balance - muscle * muscleKcal) / fatKcal
        } else if proteinOK >= 0.9 && p.training >= 2 {
            muscle = capped * 0.4; fat = (balance - muscle * muscleKcal) / fatKcal
        } else {
            let loss = -balance / (0.75 * fatKcal + 0.25 * leanLossKcal)
            fat = -0.75 * loss; muscle = -0.25 * loss * (1 - proteinOK * 0.6)
        }
        return Effect(balance: balance.rounded(), fat: fat * 1000, muscle: muscle * 1000)
    }

    static func days(_ s: Store, _ n: Int = 30, end: String = Day.today, _ p: Profile) -> [DayEffect] {
        (0..<n).reversed().map { i in
            let date = Day.add(end, -i)
            let d = s.diet(date)
            let logged = !d.meals.isEmpty, counted = logged && d.calories >= p.tdee * 0.4
            return DayEffect(date: date, logged: logged, counted: counted, calories: d.calories.rounded(), protein: d.protein.rounded(),
                             e: counted ? effect(d.calories, d.protein, p) : Effect(balance: 0, fat: 0, muscle: 0))
        }
    }
    static func sum(_ l: [DayEffect]) -> Sum {
        let c = l.filter(\.counted)
        return Sum(days: c.count, balance: c.reduce(0) { $0 + $1.e.balance }, fat: c.reduce(0) { $0 + $1.e.fat }, muscle: c.reduce(0) { $0 + $1.e.muscle })
    }

    static func status(_ s: Store) -> Status? {
        guard let p = profile(s) else { return nil }
        let month = days(s, 30, p)
        let week = Array(month.suffix(7))
        let basis = month.suffix(14).filter(\.counted)
        var proj: Projection?
        if basis.count >= 3 {
            let kcal = basis.reduce(0) { $0 + $1.calories } / Double(basis.count)
            let protein = basis.reduce(0) { $0 + $1.protein } / Double(basis.count)
            let e = effect(kcal, protein, p)
            func ahead(_ n: Double) -> (fat: Double, muscle: Double, kg: Double) { (r1(e.fat * n / 1000), r1(e.muscle * n / 1000), r1(p.kg + (e.fat + e.muscle) * n / 1000)) }
            proj = Projection(from: basis.count, kcal: kcal.rounded(), protein: protein.rounded(), balance: e.balance, month: ahead(30), quarter: ahead(90))
        }
        return Status(profile: p, target: target(s, p), today: month.last, week: sum(week), weekList: week, month: sum(month), projection: proj)
    }

    static func forAI(_ s: Store) -> JSON {
        guard let st = status(s) else { return .object(["missing": "No body profile yet. Ask for height (cm) and weight (kg), or point to the Body screen (Diet → Body)."]) }
        let p = st.profile, t = st.target
        func g(_ x: Double) -> String { "\(Int(x.rounded())) g" }
        func n(_ x: Double) -> JSON { .number(x) }
        let profile: JSON = .object(["kg": n(p.kg), "height": n(p.height), "sex": .string(p.male ? "m" : "f"), "age": n(p.age), "bmi": n(p.bmi), "bodyFat": n(p.bodyFat), "fatFrom": .string(p.fatFrom),
                                     "lean": n(p.lean), "fatKg": n(p.fatKg), "ffmi": n(p.ffmi), "bmr": n(p.bmr), "tdee": n(p.tdee), "activity": .string(p.activity), "training": n(p.training),
                                     "muscleCap": .string("\(r1(p.muscleCap)) kg muscle a month at best"), "weighedOn": .string(p.weighedOn)])
        let target: JSON = .object(["kg": n(t.kg), "low": n(t.low), "high": n(t.high), "bodyFat": n(t.bodyFat), "ffmi": n(t.ffmi), "muscle": n(t.muscle), "fatToLose": n(t.fatToLose),
                                    "mode": .string(t.mode), "calories": n(t.calories), "protein": n(t.protein), "fat": n(t.fat), "carbs": n(t.carbs), "months": n(Double(t.months))])
        let today: String = st.today.map { d in d.counted ? "\(d.e.balance > 0 ? "+" : "")\(Int(d.e.balance)) kcal vs burn: fat \(g(d.e.fat)), muscle \(g(d.e.muscle))" : "not enough logged today" } ?? "not enough logged today"
        var o: [String: JSON] = [
            "profile": profile, "target": target, "today": .string(today),
            "week": .string("\(st.week.days) counted days: balance \(Int(st.week.balance)) kcal, fat \(g(st.week.fat)), muscle \(g(st.week.muscle))"),
            "month": .string("\(st.month.days) counted days: balance \(Int(st.month.balance)) kcal, fat \(g(st.month.fat)), muscle \(g(st.month.muscle))"),
            "goal": "Athletic: muscular, strong, fast and flexible",
            "training": .object(["daysAWeek": n(Double(Training.daysAWeek(s))), "today": .string(Training.sessionOn(s)?.name ?? "rest and mobility"),
                                 "doneLast14Days": n(Double(Training.workouts(s).filter { $0.str("date") >= Day.add(Day.today, -13) }.count)),
                                 "setsThisWeek": .object(Training.setsThisWeek(s).mapValues { n($0) })]),
            "weighins": .array(s.weighins().suffix(10).map { w in .string("\(w.str("date")): \(w.str("kg")) kg\(w.num("waist") > 0 ? ", waist \(w.str("waist")) cm" : "")\(w.num("fat") > 0 ? ", \(w.str("fat"))% fat" : "")") }),
            "note": "Estimates from standard formulas (Mifflin-St Jeor, RFM or Deurenberg body fat, FFMI target). Real weigh-ins over weeks are the check. Not medical advice.",
        ]
        if let pr = st.projection {
            o["projection"] = .object(["from": n(Double(pr.from)), "kcal": n(pr.kcal), "protein": n(pr.protein), "balance": n(pr.balance),
                                       "month": .object(["days": 30, "fat": n(pr.month.fat), "muscle": n(pr.month.muscle), "kg": n(pr.month.kg)]),
                                       "quarter": .object(["days": 90, "fat": n(pr.quarter.fat), "muscle": n(pr.quarter.muscle), "kg": n(pr.quarter.kg)])])
        }
        return .object(o)
    }
}
