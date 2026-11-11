// Food photos and typed meals (twin of js/foodscan.js), the food diary (js/dietlog.js)
// and Fill the gaps (js/foodgaps.js). Same prompts, same JSON schema, same meal rows,
// so a meal logged here looks exactly like one logged in the web app.
import Foundation

enum Food {
    static let macros: [(String, String)] = [("calories", "kcal"), ("protein", "g"), ("carbs", "g"), ("fat", "g"), ("fiber", "g"), ("sugar", "g"), ("sodium", "mg")]
    struct Nut { let key: String; let label: String; let unit: String; let ref: Double; init(_ k: String, _ l: String, _ u: String, _ r: Double) { key = k; label = l; unit = u; ref = r } }
    static let fats: [Nut] = [Nut("satFat", "Saturated fat", "g", 20), Nut("monoFat", "Monounsaturated fat", "g", 0), Nut("polyFat", "Polyunsaturated fat", "g", 0), Nut("omega3", "Omega-3", "g", 1.6)]
    static let micros: [Nut] = [
        Nut("potassium", "Potassium", "mg", 4700), Nut("calcium", "Calcium", "mg", 1300), Nut("iron", "Iron", "mg", 18), Nut("magnesium", "Magnesium", "mg", 420),
        Nut("zinc", "Zinc", "mg", 11), Nut("vitaminA", "Vitamin A", "µg", 900), Nut("vitaminC", "Vitamin C", "mg", 90), Nut("vitaminD", "Vitamin D", "µg", 20),
        Nut("vitaminB12", "Vitamin B12", "µg", 2.4), Nut("caffeine", "Caffeine", "mg", 400),
    ]
    static let daily: [String: Double] = {
        var d: [String: Double] = ["fiber": 28, "sugar": 50, "sodium": 2300, "satFat": 20, "omega3": 1.6]
        for m in micros { d[m.key] = m.ref }
        return d
    }()
    static let nums: [String] = macros.map { $0.0 } + fats.map(\.key) + micros.map(\.key)
    static func label(_ k: String) -> String {
        if let f = fats.first(where: { $0.key == k }) { return f.label }
        if let m = micros.first(where: { $0.key == k }) { return m.label }
        return k.prefix(1).uppercased() + k.dropFirst()
    }
    static func unit(_ k: String) -> String {
        if let f = fats.first(where: { $0.key == k }) { return f.unit }
        if let m = micros.first(where: { $0.key == k }) { return m.unit }
        return k == "sodium" ? "mg" : "g"
    }
    static let limits: Set<String> = ["sugar", "sodium", "satFat", "caffeine"]

    struct Item: Identifiable {
        let id = UUID()
        var name: String
        var grams: Double
        var basis = ""
        var source = ""
        var n: [String: Double] = [:]
        func scaled(_ g: Double) -> Item {
            let f = grams > 0 ? g / grams : 0
            var x = self; x.grams = g
            for k in Food.nums { x.n[k] = (n[k] ?? 0) * f }
            return x
        }
    }
    struct Estimate {
        var dish: String
        var meal: String?
        var confidence: String
        var note: String
        var items: [Item]
        var model: String
        var sources: [[String: String]] = []
        var researched = false
    }

    static func totals(_ items: [Item]) -> [String: Double] {
        var t: [String: Double] = [:]
        for k in nums { t[k] = items.reduce(0) { $0 + ($1.n[k] ?? 0) } }
        return t
    }

    private static let nutrientList = "calories (kcal), protein, carbs, fat, of which saturated, monounsaturated, polyunsaturated and omega-3 fat, fiber, sugar (g), sodium, potassium, calcium, iron, magnesium, zinc (mg), vitamin A (µg RAE), vitamin C (mg), vitamin D (µg), vitamin B12 (µg), caffeine (mg)"
    private static let whereLine = "The user lives in Kazakhstan and eats Kazakh, Turkish, Russian and international food; local products and portions are what matter."
    private static var timeNow: String { Day.hm(Date()) }

    private static func research(_ note: String, photo: Bool) -> String {
        """
        You are a meticulous dietitian. \(photo ? "Look at this photo of food or drink." : "The user wrote what they ate or drank: \"\(note)\"")
        \(whereLine)
        For EACH separate item (include oil, butter, sauce, dressing, sugar or honey in drinks):
        1. Identify it exactly. \(photo ? "Read any brand, logo, label or packaging text you can see (e.g. a chocolate wrapper, a bottle, a cup print)." : "Use the brand or place if they named one.")
        2. Amount: \(photo ? "measure it from what is in the photo, never from a \"standard serving\". Find reference objects (dinner plate about 26 cm, side plate 20 cm, fork about 19 cm, teaspoon 5 ml, tablespoon 15 ml, mug 250-350 ml, Turkish tea glass about 100 ml, can 330 ml, hand about 18 cm long, bread loaf slice size) and use them to judge size, then volume, then weight with the food's density. Count pieces (slices, dumplings, pieces of meat). Judge how full a cup or glass is." : "use the amounts they gave and convert pieces, slices, spoons, cups and bowls to grams or ml. If no amount is given, use one typical portion here and say so.")
        3. Use Google Search to look up what you can instead of assuming: the nutrition label of a branded product; how a local dish is usually made (e.g. the meat, bread and sauce share of a doner or shawarma in Kazakhstan, how much oil goes into plov or baursak); the weight of a measure (e.g. grams in a tablespoon of honey); the size of a named cup or bottle.
        4. Write short notes per item: name, amount in grams or ml and how you judged it, nutrition per 100 g with where it came from, then the totals for this portion of: \(nutrientList).
        \(photo && !note.isEmpty ? "The user adds: \"\(note)\". Trust this over the photo where they differ." : "")
        Time now: \(timeNow).
        """
    }

    private static func structure(_ note: String, photo: Bool, notes: String) -> String {
        let src = notes.isEmpty
            ? "\(photo ? "From the photo: measure each item against reference objects (plate, cutlery, cup, hand), count pieces, never assume a standard serving." : "What they wrote: \"\(note)\". Convert their amounts to grams; with none, use one typical portion and say so in note.") \(whereLine)\(photo && !note.isEmpty ? " The user adds: \"\(note)\"." : "")"
            : "Use these research notes; keep their amounts and looked-up values, and fill any missing nutrient from standard food composition tables (USDA, national tables):\n---\n\(notes)\n---"
        return """
        Turn this into the JSON answer: one item per food or drink with its grams (ml for drinks), how the amount was judged (basis), where the values came from (source), and the portion's \(nutrientList). Use 0 when there is none.
        \(src)
        If there is no food or drink, return no items. Guess the meal from the time now: \(timeNow).
        """
    }

    static var schema: JSON {
        var itemProps: [String: JSON] = [
            "name": .object(["type": "string"]),
            "grams": .object(["type": "number", "description": "Weight of the portion in grams (ml for drinks)"]),
            "basis": .object(["type": "string", "description": "How the amount was judged, a few words: \"26 cm plate, about a third covered\", \"2 slices\", \"250 ml mug, 3/4 full\", \"label: 45 g bar\""]),
            "source": .object(["type": "string", "description": "Where the nutrition values came from, a few words: brand label, a site found, or standard food tables"]),
        ]
        for k in nums { itemProps[k] = .object(["type": "number"]) }
        return .object([
            "type": "object",
            "properties": .object([
                "dish": .object(["type": "string", "description": "Short name for the whole meal or drink"]),
                "meal": .object(["type": "string", "enum": .array(Meals.types.map { .string($0) })]),
                "confidence": .object(["type": "string", "enum": ["low", "medium", "high"]]),
                "note": .object(["type": "string", "description": "One short line on what was hard to judge (hidden oil, sauce, portion), or empty"]),
                "items": .object(["type": "array", "items": .object(["type": "object", "properties": .object(itemProps),
                                                                     "required": ["name", "grams", "calories", "protein", "carbs", "fat"]])]),
            ]),
            "required": ["dish", "items", "confidence"],
        ])
    }

    /// image is JPEG data, or nil for a typed meal (then note is what they ate).
    @MainActor
    static func scan(_ s: Store, image: Data?, note rawNote: String, onStatus: ((String) -> Void)? = nil) async throws -> Estimate {
        let note = rawNote.trimmingCharacters(in: .whitespacesAndNewlines)
        if image == nil && note.isEmpty { throw GeminiError(message: "Write what you ate or drank first.") }
        let pic: [JSON] = image.map { [.object(["inlineData": .object(["mimeType": "image/jpeg", "data": .string($0.base64EncodedString())])])] } ?? []
        var notes = "", sources: [[String: String]] = []
        onStatus?("Looking things up…")
        do {
            let r = try await Gemini.ask(s, parts: pic + [.object(["text": .string(research(note, photo: image != nil))])], tools: [.object(["google_search": .object([:])])], timeout: 45, onStatus: onStatus)
            notes = Gemini.text(r.out).trimmingCharacters(in: .whitespacesAndNewlines)
            sources = Gemini.sources(r.out)
        } catch let e as GeminiError where e.code == "nokey" {
            throw e
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            onStatus?("Search is busy, estimating directly…")
        }
        onStatus?(!notes.isEmpty ? "Adding it up…" : image != nil ? "Looking at your photo…" : "Working it out…")
        let r = try await Gemini.ask(s, parts: pic + [.object(["text": .string(structure(note, photo: image != nil, notes: notes))])],
                                     config: ["responseMimeType": "application/json", "responseSchema": schema], onStatus: onStatus)
        guard let j = Gemini.json(r.out) else { throw GeminiError(message: "Gemini gave an answer Yaver could not read. Try again.") }
        var e = normalize(j, model: r.model)
        e.sources = sources
        e.researched = !notes.isEmpty
        return e
    }

    static func normalize(_ r: JSON, model: String = "") -> Estimate {
        let items: [Item] = (r["items"]?.array ?? []).compactMap { i in
            guard let name = i["name"]?.string, !name.isEmpty else { return nil }
            var it = Item(name: name, grams: max(0, (i["grams"]?.double ?? 0).rounded()), basis: i["basis"]?.string ?? "", source: i["source"]?.string ?? "")
            for k in nums { it.n[k] = max(0, i[k]?.double ?? 0) }
            return it
        }
        let dish = r["dish"]?.string ?? ""
        return Estimate(dish: dish.isEmpty ? (items.isEmpty ? "Meal" : items.map(\.name).joined(separator: ", ")) : dish,
                        meal: r["meal"]?.string, confidence: r["confidence"]?.string ?? "medium", note: r["note"]?.string ?? "", items: items, model: model)
    }

    private static func r1(_ x: Double) -> Double { (x * 10).rounded() / 10 }

    /// The stored meal row: whole-number macros, plus fiber, sugar, sodium, micros and items.
    static func mealRow(dish: String, items: [Item], meal: String, date: String, time: String, confidence: String, source: String, sources: [[String: String]]) -> Row {
        let t = totals(items)
        var micro: [String: JSON] = [:]
        for k in fats.map(\.key) + micros.map(\.key) { micro[k] = .number(r1(t[k] ?? 0)) }
        var row: Row = [
            "name": .string(dish), "meal": .string(meal), "date": .string(date),
            "calories": .number((t["calories"] ?? 0).rounded()), "protein": .number((t["protein"] ?? 0).rounded()),
            "carbs": .number((t["carbs"] ?? 0).rounded()), "fat": .number((t["fat"] ?? 0).rounded()),
            "fiber": .number(r1(t["fiber"] ?? 0)), "sugar": .number(r1(t["sugar"] ?? 0)), "sodium": .number((t["sodium"] ?? 0).rounded()),
            "micros": .object(micro),
            "items": .array(items.map { i in
                var o: [String: JSON] = ["name": .string(i.name), "grams": .number(i.grams.rounded()), "calories": .number((i.n["calories"] ?? 0).rounded()), "protein": .number(r1(i.n["protein"] ?? 0))]
                if !i.basis.isEmpty { o["basis"] = .string(i.basis) }
                if !i.source.isEmpty { o["from"] = .string(i.source) }
                return .object(o)
            }),
            "source": .string(source), "confidence": .string(confidence),
        ]
        if !sources.isEmpty { row["sources"] = .array(sources.prefix(6).map { .object($0.mapValues { .string($0) }) }) }
        if !time.isEmpty { row["time"] = .string(time) }
        return row
    }
}

// MARK: - Day totals with the extras

extension DietDay {
    var sugar: Double { meals.reduce(0) { $0 + $1.num("sugar") } }
    var sodium: Double { meals.reduce(0) { $0 + $1.num("sodium") } }
    var detailed: Int { meals.filter { $0["micros"]?.object != nil }.count }
}

// MARK: - Food diary (twin of js/dietlog.js)

enum DietLog {
    static let late = "21:00"
    static let feels = [("good", "Good"), ("ok", "OK"), ("bad", "Bad")]

    struct Timing { let first: String; let last: String; let window: Double; let latePct: Int; let late: Bool }
    struct DayLine { let date: String; let timing: Timing?; let feel: String?; let nextFeel: String?; let meals: Int; let detailed: Int; let fatDetailed: Int; let d: DietDay }
    struct Nutrient: Identifiable { var id: String { key }; let key: String; let label: String; let unit: String; let avg: Double; let ref: Double; let kind: String; let pct: Int? }
    struct After { let days: Int; let bad: Int; let good: Int }
    struct TimingReport { let days: Int; let first: String; let last: String; let window: Double; let lateDays: [String]; let afterLate: After; let afterOther: After }
    struct Report { let days: Int; let from: String; let loggedDays: Int; let detailedDays: Int; let nutrients: [Nutrient]; let low: [Nutrient]; let high: [Nutrient]; let lowCalorieDays: [String]; let timing: TimingReport? }

    private static func m(_ t: String) -> Double { Double(Course.toMin(t)) }
    private static func hm(_ n: Double) -> String { String(format: "%02d:%02d", Int(n / 60) % 24, Int(n.truncatingRemainder(dividingBy: 60).rounded())) }
    private static func r1(_ x: Double) -> Double { (x * 10).rounded() / 10 }

    static func timing(_ s: Store, _ meals: [Row]) -> Timing? {
        let timed = meals.compactMap { x in s.mealTime(x).map { (x, $0) } }.sorted { $0.1 < $1.1 }
        guard let first = timed.first?.1, let last = timed.last?.1 else { return nil }
        let kcal = meals.reduce(0) { $0 + $1.num("calories") }
        let lateK = timed.filter { $0.1 >= late }.reduce(0) { $0 + $1.0.num("calories") }
        let after22 = timed.filter { $0.1 >= "22:00" }.reduce(0) { $0 + $1.0.num("calories") }
        return Timing(first: first, last: last, window: r1((m(last) - m(first)) / 60), latePct: kcal > 0 ? Int((lateK / kcal * 100).rounded()) : 0,
                      late: (kcal > 0 && lateK / kcal >= 0.33) || after22 >= 400)
    }

    static func days(_ s: Store, _ n: Int = 30, end: String = Day.today) -> [DayLine] {
        (0..<n).reversed().map { i in
            let k = Day.add(end, -i)
            let d = s.diet(k)
            return DayLine(date: k, timing: timing(s, d.meals), feel: s.feeling(k)?.str("feel"), nextFeel: s.feeling(Day.add(k, 1))?.str("feel"),
                           meals: d.meals.count, detailed: d.detailed, fatDetailed: d.meals.filter { $0["micros"]?["satFat"] != nil }.count, d: d)
        }
    }

    static func report(_ s: Store, _ n: Int = 30, end: String = Day.today) -> Report {
        let all = days(s, n, end: end)
        let logged = all.filter { $0.meals > 0 }
        let detailed = logged.filter { $0.detailed > 0 }
        let fatDays = logged.filter { $0.fatDetailed > 0 }
        func avg(_ list: [DayLine], _ f: (DayLine) -> Double) -> Double { list.isEmpty ? 0 : list.reduce(0) { $0 + f($1) } / Double(list.count) }
        func make(_ key: String, _ label: String, _ unit: String, _ a: Double, _ ref: Double, _ kind: String) -> Nutrient {
            let v = r1(a)
            return Nutrient(key: key, label: label, unit: unit, avg: v, ref: ref, kind: kind, pct: ref > 0 ? Int((v / ref * 100).rounded()) : nil)
        }
        var list: [(Nutrient, Int)] = [
            (make("calories", "Calories", "kcal", avg(logged) { $0.d.calories }, s.calorieGoal, "goal"), logged.count),
            (make("protein", "Protein", "g", avg(logged) { $0.d.protein }, s.proteinGoal, "goal"), logged.count),
            (make("fiber", "Fiber", "g", avg(detailed) { $0.d.fiber }, 28, "min"), detailed.count),
            (make("sugar", "Sugar", "g", avg(detailed) { $0.d.sugar }, 50, "max"), detailed.count),
            (make("sodium", "Sodium", "mg", avg(detailed) { $0.d.sodium }, 2300, "max"), detailed.count),
        ]
        for f in Food.fats where f.ref > 0 {
            list.append((make(f.key, f.label, f.unit, avg(fatDays) { $0.d.micros[f.key] ?? 0 }, f.ref, f.key == "satFat" ? "max" : "min"), fatDays.count))
        }
        for x in Food.micros {
            list.append((make(x.key, x.label, x.unit, avg(detailed) { $0.d.micros[x.key] ?? 0 }, x.ref, x.key == "caffeine" ? "max" : "min"), detailed.count))
        }
        let usable = list.filter { $0.1 > 0 }.map(\.0)
        let low = usable.filter { $0.kind != "max" && ($0.pct ?? 100) < 70 }.sorted { ($0.pct ?? 0) < ($1.pct ?? 0) }
        let high = usable.filter { $0.kind == "max" && ($0.pct ?? 0) > 100 }.sorted { ($0.pct ?? 0) > ($1.pct ?? 0) }
        let goal = s.calorieGoal
        return Report(days: n, from: all.first?.date ?? end, loggedDays: logged.count, detailedDays: detailed.count, nutrients: usable, low: low, high: high,
                      lowCalorieDays: logged.filter { goal > 0 && $0.d.calories < goal * 0.7 }.map(\.date), timing: timingReport(logged))
    }

    private static func timingReport(_ logged: [DayLine]) -> TimingReport? {
        let t = logged.filter { $0.timing != nil }
        guard !t.isEmpty else { return nil }
        func avg(_ f: (Timing) -> Double) -> Double { t.reduce(0) { $0 + f($1.timing!) } / Double(t.count) }
        let lateL = t.filter { $0.timing!.late }, other = t.filter { !$0.timing!.late }
        func after(_ l: [DayLine]) -> After { let f = l.filter { $0.nextFeel != nil }; return After(days: f.count, bad: f.filter { $0.nextFeel == "bad" }.count, good: f.filter { $0.nextFeel == "good" }.count) }
        return TimingReport(days: t.count, first: hm(avg { m($0.first) }), last: hm(avg { m($0.last) }), window: r1(avg { $0.window }),
                            lateDays: lateL.map(\.date), afterLate: after(lateL), afterOther: after(other))
    }

    /// The whole diary as a spreadsheet, one row per meal (same columns as the web app).
    static func csv(_ s: Store) -> String {
        let cols = ["date", "time", "meal", "name", "calories", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugar_g", "sodium_mg"]
            + Food.fats.map { "\($0.key)_g" } + Food.micros.map { "\($0.key)_\($0.unit == "µg" ? "ug" : $0.unit)" } + ["items", "source"]
        func q(_ v: String) -> String { v.rangeOfCharacter(from: CharacterSet(charactersIn: "\",\n")) != nil ? "\"\(v.replacingOccurrences(of: "\"", with: "\"\""))\"" : v }
        func n(_ m: Row, _ k: String) -> String { m[k] == nil || m[k]!.isNull ? "" : m.str(k) }
        let rows = s.all("meals").sorted { ($0.str("date") + "\(Meals.types.firstIndex(of: $0.str("meal")) ?? -1)") < ($1.str("date") + "\(Meals.types.firstIndex(of: $1.str("meal")) ?? -1)") }.map { m -> String in
            let mic = (Food.fats.map(\.key) + Food.micros.map(\.key)).map { k in m["micros"]?[k]?.double.map { plain($0) } ?? "" }
            let items = (m["items"]?.array ?? []).map { "\($0["name"]?.string ?? "") \(plain($0["grams"]?.double ?? 0))g" }.joined(separator: "; ")
            let cells = [m.str("date"), m.str("time"), m.str("meal"), m.str("name"), n(m, "calories"), n(m, "protein"), n(m, "carbs"), n(m, "fat"), n(m, "fiber"), n(m, "sugar"), n(m, "sodium")]
                + mic + [items, m.str("source").isEmpty ? "manual" : m.str("source")]
            return cells.map(q).joined(separator: ",")
        }
        return ([cols.joined(separator: ",")] + rows).joined(separator: "\n")
    }
}

// MARK: - Fill the gaps (twin of js/foodgaps.js)

enum FoodGaps {
    struct Gaps { let day: String; let forWhen: String; let lines: [String]; let recent: [String]; let key: String }

    static func pct(_ v: Double, _ ref: Double) -> Int { ref > 0 ? Int((v / ref * 100).rounded()) : 0 }

    static func gaps(_ s: Store, now: Date = Date()) -> Gaps {
        let day = Day.today
        let d = s.diet(day)
        let late = Day.cal.component(.hour, from: now) >= 20 || (s.calorieGoal > 0 && d.calories >= s.calorieGoal * 0.9)
        var lines: [String] = []
        if !d.meals.isEmpty {
            lines.append("Today so far: \(Int(d.calories.rounded())) of \(plain(s.calorieGoal)) kcal, protein \(Int(d.protein.rounded())) of \(plain(s.proteinGoal)) g, carbs \(Int(d.carbs.rounded())) g, fat \(Int(d.fat.rounded())) g.")
            if d.detailed > 0 {
                let mi = d.micros
                var low: [(String, Int)] = []
                let fp = pct(d.fiber, 28); if fp < 70 { low.append(("Fiber", fp)) }
                for x in Food.micros where x.key != "caffeine" { let p = pct(mi[x.key] ?? 0, x.ref); if p < 70 { low.append((x.label, p)) } }
                if !low.isEmpty { lines.append("Under 70% of the daily value today: \(low.map { "\($0.0) \($0.1)%" }.joined(separator: ", ")).") }
                if d.sodium > 2300 { lines.append("Sodium is already \(pct(d.sodium, 2300))% of the limit.") }
                if d.sugar > 50 { lines.append("Sugar is already \(pct(d.sugar, 50))% of the limit.") }
            }
            let m = d.micros
            let kinds = (m["satFat"] ?? 0) + (m["monoFat"] ?? 0) + (m["polyFat"] ?? 0)
            if kinds >= 5 {
                func share(_ k: String) -> Int { Int(((m[k] ?? 0) / kinds * 100).rounded()) }
                lines.append("Fat today: saturated \(share("satFat"))%, monounsaturated \(share("monoFat"))%, polyunsaturated \(share("polyFat"))% (seed and plant oils are mostly poly); omega-3 \(plain(((m["omega3"] ?? 0) * 10).rounded() / 10)) g of 1.6 g; saturated \(Int((m["satFat"] ?? 0).rounded())) g of a 20 g limit.")
            }
        } else { lines.append("Nothing logged today yet.") }
        let week = DietLog.report(s, 7, end: Day.add(day, -1))
        if week.loggedDays > 0 {
            if !week.low.isEmpty { lines.append("Running low over the last week (average): \(week.low.prefix(8).map { "\($0.label) \($0.pct ?? 0)%" }.joined(separator: ", ")).") }
            if !week.high.isEmpty { lines.append("Above the limit over the last week: \(week.high.map { "\($0.label) \($0.pct ?? 0)%" }.joined(separator: ", ")).") }
        }
        let recent = s.all("meals").filter { $0.str("date") >= Day.add(day, -6) }.sorted { $0.str("date") > $1.str("date") }.prefix(25).map { $0.str("name") }
        return Gaps(day: day, forWhen: late ? "tomorrow" : "today", lines: lines, recent: Array(recent), key: "\(day)|\(late ? "t" : "d")|\(d.meals.count)|\(Int(d.calories.rounded()))")
    }

    private static var schema: JSON {
        .object([
            "type": "object",
            "properties": .object([
                "summary": .object(["type": "string", "description": "One or two plain sentences: the main gaps and the idea of the plan"]),
                "items": .object(["type": "array", "items": .object(["type": "object", "properties": .object([
                    "food": .object(["type": "string", "description": "A real food or drink, e.g. \"Baked mackerel\""]),
                    "amount": .object(["type": "string", "description": "How much, e.g. \"150 g fillet\", \"1 glass (250 ml)\""]),
                    "when": .object(["type": "string", "description": "Which meal, e.g. \"Dinner\", \"Tomorrow breakfast\", \"Snack\""]),
                    "why": .object(["type": "string", "description": "What it covers, in a few words with rough numbers, e.g. \"omega-3 2 g, protein 30 g, vitamin D\""]),
                ]), "required": ["food", "amount", "why"]])]),
                "ease_off": .object(["type": "string", "description": "What to have less of, one short line, or empty"]),
            ]),
            "required": ["summary", "items"],
        ])
    }

    private static func prompt(_ s: Store, _ g: Gaps) -> String {
        """
        You are a practical sports dietitian. Suggest 3 to 6 foods or drinks for \(g.forWhen == "tomorrow" ? "TOMORROW (today is nearly done)" : "the REST OF TODAY") that fill the gaps below.
        The user lives in Kazakhstan: suggest foods easy to buy or order there (bazaar, supermarket, canteen, Turkish, Kazakh, Russian food). Real food, no supplements unless a gap cannot be met with food (then say so).
        Balance fat quality: if seed or plant oils (polyunsaturated) dominate, favour fish, eggs, olive oil, nuts, butter or meat fat in moderation; if omega-3 is low, oily fish (mackerel, herring, salmon) or walnuts; keep saturated fat under the limit.
        Respect the calories left; if the day is already over the calories, suggest light options. Give an amount for each item and what it covers. Vary from what they ate recently. Plain words, no motivational talk.
        Gaps:
        \(g.lines.map { "- \($0)" }.joined(separator: "\n"))
        Goals: \(plain(s.calorieGoal)) kcal, \(plain(s.proteinGoal)) g protein a day.
        Eaten in the last week: \(g.recent.isEmpty ? "nothing logged" : g.recent.joined(separator: "; ")).
        """
    }

    /// Today's saved suggestion, or nil.
    static func cached(_ s: Store) -> [String: JSON]? {
        guard let c = s.setting("foodTips")?.object, c["day"]?.string == Day.today else { return nil }
        return c
    }

    @MainActor
    static func suggest(_ s: Store, onStatus: ((String) -> Void)? = nil) async throws {
        let g = gaps(s)
        let r = try await Gemini.ask(s, parts: [.object(["text": .string(prompt(s, g))])], config: ["responseMimeType": "application/json", "responseSchema": schema, "temperature": 0.5], onStatus: onStatus)
        guard let j = Gemini.json(r.out), let items = j["items"]?.array else { throw GeminiError(message: "Gemini gave an answer Yaver could not read. Try again.") }
        let list: [JSON] = items.filter { ($0["food"]?.string ?? "").isEmpty == false }.prefix(6).map { i in
            .object(["food": .string(i["food"]?.string ?? ""), "amount": .string(i["amount"]?.string ?? ""), "when": .string(i["when"]?.string ?? ""), "why": .string(i["why"]?.string ?? "")])
        }
        s.setSetting("foodTips", .object(["day": .string(g.day), "for": .string(g.forWhen), "key": .string(g.key), "at": .number(Date().timeIntervalSince1970 * 1000),
                                          "summary": .string(j["summary"]?.string ?? ""), "ease": .string(j["ease_off"]?.string ?? ""), "items": .array(list)]))
    }
}
