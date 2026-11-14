// The assistant's tools (twin of js/ai/tools.js). The names, descriptions and schemas
// come from the web app (AssistantDefs.swift, generated); this file runs each tool on
// the device against the same records, and returns the same shapes as the web app.
import Foundation

enum Tools {
    struct Failure: LocalizedError { let message: String; var errorDescription: String? { message } }
    static func fail(_ m: String) -> Failure { Failure(message: m) }

    static func statusFor(_ name: String) -> String {
        if name.contains("meeting") { return "Checking your calendar…" }
        if name.contains("expense") { return "Updating your expenses…" }
        if name.contains("study") { return "Looking at your studies…" }
        if name.contains("meal") || name.contains("diet") { return "Updating your diet log…" }
        if name.contains("task") { return "Updating your tasks…" }
        if name.contains("team") || name.contains("person") { return "Checking your teams…" }
        return "Looking at your day…"
    }

    /// The small receipt the chat shows after a tool changed data.
    static func describe(_ name: String, _ i: [String: JSON]) -> String? {
        func s(_ k: String) -> String { i.str(k) }
        switch name {
        case "log_cetele":
            if let d = i["done"]?.bool { return "Çetele · \(s("item")) \(d ? "done" : "cleared")" }
            if i["set"] != nil { return "Çetele · \(s("item")) = \(s("set"))" }
            return "Çetele · \(s("item")) +\(i["add"] == nil ? "1" : s("add"))"
        case "set_cetele_item": return i.flag("remove") ? "Removed \(s("name")) from çetele" : "Çetele · \(s("name")): \(s("target")) \(s("unit")) per \(s("per").isEmpty ? "day" : s("per"))".replacingOccurrences(of: "  ", with: " ")
        case "log_workout": return "Training done"
        case "log_feeling": return "Feeling \(s("feel"))\(s("note").isEmpty ? "" : " · \(s("note"))")"
        case "log_weight": return "Weight \(s("kg")) kg\(s("waist_cm").isEmpty ? "" : " · waist \(s("waist_cm")) cm")"
        case "add_person": return "\(s("name")) added to \(Store.teamName(s("team")))"
        case "log_team_activity": return "Logged “\(s("title"))”\(s("place").isEmpty ? "" : " at \(s("place"))")"
        case "add_expense": return "Added \(s("amount")) · \(s("category"))\(s("note").isEmpty ? "" : " · \(s("note"))")"
        case "add_meeting": return "Scheduled “\(s("title"))” · \(s("start").replacingOccurrences(of: "T", with: " "))"
        case "update_meeting": return "Updated a meeting"
        case "delete_meeting": return "Removed a meeting"
        case "delete_expense": return "Removed an expense"
        case "log_study": return "Logged \(s("minutes")) min of \(s("subject"))"
        case "log_meal": return "Logged \(s("name")) · \(s("calories")) kcal"
        case "add_task": return "Task: \(s("title"))"
        case "complete_task": return "Completed a task"
        case "add_roadmap_milestones": return "Roadmap: +\(i["milestones"]?.array?.count ?? 0) milestones in \(s("subject"))"
        case "complete_milestone": return i["done"]?.bool == false ? "Milestone reopened" : "Milestone done"
        case "log_practice": return "Practice +\(s("problems").isEmpty ? "0" : s("problems")) problems, +\(s("anki_reviews").isEmpty ? "0" : s("anki_reviews")) card reviews"
        case "set_goal": return "Goal \(s("goal")) = \(s("value"))"
        case "complete_lesson":
            guard let sc = i["score"]?.double else { return "Lesson complete" }
            return "Lesson complete · \(Int(((sc > 1 ? sc / 100 : sc) * 100).rounded()))%"
        case "grade_card": return "Card: \(s("grade"))"
        case "record_test_result": return "Week \(s("week")) test saved"
        case "save_week_lessons": return "Week \(s("week")): \(i["lessons"]?.array?.count ?? 0) lessons saved"
        default: return nil
        }
    }

    @MainActor
    static func run(_ st: Store, _ name: String, _ input: [String: JSON]) async -> JSON {
        do { return try await call(st, name, input) } catch { return .object(["error": .string(error.localizedDescription)]) }
    }

    // MARK: helpers

    static func slim(_ r: Row) -> JSON { var x = r; x["createdAt"] = nil; x["updatedAt"] = nil; x["deviceId"] = nil; return .object(x) }
    static func arr(_ rows: [Row]) -> JSON { .array(rows.map { slim($0) }) }
    static func strs(_ a: [String]) -> JSON { .array(a.map { .string($0) }) }
    static func num(_ n: Double) -> JSON { .number(n) }
    static func opt(_ s: String?) -> JSON { s.map { .string($0) } ?? .null }

    /// Local wall-clock time "2026-10-15T14:00" for an ISO instant (how the user thinks about times).
    static func localInput(_ iso: String) -> String {
        guard let d = Store.parseISO(iso) else { return iso }
        return "\(Day.key(d))T\(Day.hm(d))"
    }
    /// "2026-10-15T14:00" (local) or a full ISO date → Date.
    static func parseLocal(_ s: String) -> Date? {
        if let d = Store.parseISO(s) { return d }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        for fmt in ["yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd HH:mm", "yyyy-MM-dd"] {
            f.dateFormat = fmt
            if let d = f.date(from: s) { return d }
        }
        return nil
    }
    static func slimEvent(_ e: Row) -> JSON {
        var o: [String: JSON] = ["id": .string(e.id), "title": .string(e.str("title")), "start": .string(localInput(e.str("start"))), "end": .string(localInput(e.str("end")))]
        if !e.str("location").isEmpty { o["location"] = .string(e.str("location")) }
        if !e.str("notes").isEmpty { o["notes"] = .string(e.str("notes")) }
        if e.str("source") == "apple" {
            o["from"] = .string("Apple Calendar\(e.str("calendar").isEmpty ? "" : " · " + e.str("calendar")) (read only)")
            if e.flag("allDay") { o["allDay"] = true }
        }
        return .object(o)
    }

    // MARK: data shared with the web app's data.js

    static func allEvents(_ s: Store) -> [Row] { s.all("events") + s.all("applecal") }
    static func eventsOn(_ s: Store, _ key: String) -> [Row] {
        allEvents(s).filter { e in
            guard let start = Store.parseISO(e.str("start")) else { return false }
            if !e.flag("allDay") { return Day.key(start) == key }
            let end = Store.parseISO(e.str("end")).map { $0.addingTimeInterval(-1) } ?? start
            return Day.key(start) <= key && key <= Day.key(end)
        }.sorted { a, b in a.flag("allDay") != b.flag("allDay") ? a.flag("allDay") : a.str("start") < b.str("start") }
    }
    static func freeSlots(_ s: Store, _ key: String, minMinutes: Double = 30) -> [String] {
        let day = Day.date(key)
        var cursor = Day.cal.date(bySettingHour: 8, minute: 0, second: 0, of: day) ?? day
        let endOfDay = Day.cal.date(bySettingHour: 21, minute: 0, second: 0, of: day) ?? day
        if key == Day.today { cursor = max(cursor, Date()) }
        var out: [String] = []
        for ev in eventsOn(s, key) where !ev.flag("allDay") {
            guard let a = Store.parseISO(ev.str("start")), let b = Store.parseISO(ev.str("end")) else { continue }
            if a.timeIntervalSince(cursor) >= minMinutes * 60 { out.append("\(Day.hm(cursor))-\(Day.hm(a))") }
            if b > cursor { cursor = b }
        }
        if endOfDay.timeIntervalSince(cursor) >= minMinutes * 60 { out.append("\(Day.hm(cursor))-\(Day.hm(endOfDay))") }
        return out
    }
    static func byCategory(_ list: [Row]) -> JSON {
        var t: [String: Double] = [:]
        for e in list { t[e.str("category"), default: 0] += e.num("amount") }
        return .array(t.sorted { $0.value > $1.value }.map { .array([.string($0.key), .number($0.value)]) })
    }
    static func studySummary(_ s: Store) -> [String: JSON] {
        let sessions = s.all("sessions")
        let ws = Day.weekStart()
        let subjects: [JSON] = s.all("subjects").map { sub in
            let mine = sessions.filter { $0.str("subjectId") == sub.id }
            return .object(["name": .string(sub.str("name")), "totalMin": .number(mine.reduce(0) { $0 + $1.num("minutes") }),
                            "weekMin": .number(mine.filter { $0.str("date") >= ws }.reduce(0) { $0 + $1.num("minutes") })])
        }.sorted { ($0["totalMin"]?.double ?? 0) > ($1["totalMin"]?.double ?? 0) }
        return ["todayMin": .number(s.studyMinutes(Day.today)), "weekMin": .number(sessions.filter { $0.str("date") >= ws }.reduce(0) { $0 + $1.num("minutes") }),
                "dailyGoalMin": .number(s.dailyStudyGoal), "streakDays": .number(Double(s.studyStreak())), "subjects": .array(subjects)]
    }
    static func ceteleSummary(_ s: Store, _ day: String = Day.today) -> JSON {
        let rows = s.cetele(day)
        let daily = rows.filter { !$0.weekly }
        return .object([
            "day": .string(day), "done": .string("\(daily.filter(\.met).count)/\(daily.count) daily minimums met"), "streakDays": .number(Double(s.ceteleStreak())),
            "items": .array(rows.map { r in .object(["id": .string(r.id), "name": .string(r.name), "target": .string("\(plain(r.target))\(r.unit.isEmpty ? "" : " " + r.unit) per \(r.weekly ? "week" : "day")"),
                                                      "done": .number(r.progress), "met": .bool(r.met)]) }),
        ])
    }
    static let ceteleAliases: [String: [String]] = [
        "namaz": ["prayer", "salah", "salat ", "namaz"], "quran": ["quran", "koran", "kuran", "qur"], "book": ["book", "risale", "reading"],
        "salawat": ["salawat", "salavat", "salat-i", "durood"], "jawshan": ["jawshan", "jevshan", "cevsen", "cevşen"],
        "tahajjud": ["tahajjud", "teheccud", "teheccüd", "night prayer"], "fasting": ["fast", "oruc", "oruç", "sawm"],
    ]
    static func findCetele(_ s: Store, _ q0: String) -> Row? {
        let tr = Locale(identifier: "tr")
        let q = q0.trimmingCharacters(in: .whitespaces).lowercased(with: tr)
        let list = s.ceteleItems()
        func n(_ r: Row) -> String { r.str("name").lowercased(with: tr) }
        return list.first { $0.id == q } ?? list.first { n($0) == q } ?? list.first { n($0).contains(q) || q.contains(n($0)) }
            ?? list.first { r in (ceteleAliases[r.id] ?? []).contains { q.contains($0) } }
    }

    // MARK: the tools

    @MainActor
    private static func call(_ s: Store, _ name: String, _ i: [String: JSON]) async throws -> JSON {
        let C = Course.shared
        let date = i.str("date").isEmpty ? Day.today : String(i.str("date").prefix(10))
        switch name {
        case "get_overview":
            let month = s.expenses(month: Day.month())
            let spent = month.reduce(0) { $0 + $1.num("amount") }
            let d = s.diet()
            let money: JSON = .object(["currency": .string(s.currency), "today": num(s.expenses(from: Day.today, to: Day.today).reduce(0) { $0 + $1.num("amount") }),
                                       "thisWeek": num(s.expenses(from: Day.weekStart(), to: Day.today).reduce(0) { $0 + $1.num("amount") }), "thisMonth": num(spent),
                                       "monthlyBudget": s.monthlyBudget > 0 ? num(s.monthlyBudget) : .null, "budgetLeft": s.monthlyBudget > 0 ? num(s.monthlyBudget - spent) : .null])
            let cal: JSON = .object(["today": .array(eventsOn(s, Day.today).map(slimEvent)), "upcoming": .array(s.upcomingEvents(6).map(slimEvent))])
            let diet: JSON = .object(["calories": num(d.calories), "calorieGoal": num(s.calorieGoal), "protein": num(d.protein), "proteinGoal": num(s.proteinGoal),
                                      "meals": strs(d.meals.map { "\($0.str("meal")): \($0.str("name")) (\($0.str("calories")) kcal)" })])
            let tasks: JSON = .array(s.openTasks().prefix(10).map { .object(["id": .string($0.id), "title": .string($0.str("title")), "due": opt($0["due"]?.string)]) })
            return .object(["now": .string(Date().description), "money": money, "calendar": cal, "study": .object(studySummary(s)), "diet": diet, "tasks": tasks,
                            "practiceToday": .object(["problems": num(s.practiceOn("problems")), "anki": num(s.practiceOn("anki"))]), "cetele": ceteleSummary(s),
                            "course": C.active(s) ? .string("Yaver Course active: use get_course_today") : .null])

        case "get_cetele": return ceteleSummary(s, date)
        case "log_cetele":
            guard let it = findCetele(s, i.str("item")) else {
                return .object(["error": .string("No çetele item like \"\(i.str("item"))\". Items: \(s.ceteleItems().map { $0.str("name") }.joined(separator: ", "))")])
            }
            let target = max(1, it.num("target")), isCheck = target == 1 && it.str("unit").isEmpty
            if let done = i["done"]?.bool { s.setCetele(it.id, done ? (isCheck ? 1 : target) : 0, date) }
            else if let v = i["set"]?.double { s.setCetele(it.id, v, date) }
            else { s.setCetele(it.id, s.ceteleValue(it.id, date) + (i["add"]?.double ?? max(1, it.num("step"))), date) }
            let prog = s.ceteleProgress(it, date)
            return .object(["ok": true, "item": .string(it.str("name")), "value": num(s.ceteleValue(it.id, date)), "progress": num(prog), "target": num(target), "met": .bool(prog >= target)])
        case "set_cetele_item":
            let it = findCetele(s, i.str("name"))
            if i.flag("remove") {
                guard var it else { return .object(["error": "not found"]) }
                it["archived"] = true; s.put("ceteleItems", it)
                return .object(["ok": true, "removed": .string(it.str("name"))])
            }
            var row = it ?? ["order": .number(Double(s.ceteleItems().count)), "archived": false]
            row["name"] = .string(it?.str("name") ?? i.str("name"))
            row["target"] = num(max(1, i["target"]?.double ?? it?.num("target") ?? 1))
            row["unit"] = .string(i["unit"]?.string ?? it?.str("unit") ?? "")
            row["per"] = .string((i.str("per").isEmpty ? (it?.str("per") ?? "day") : i.str("per")) == "week" ? "week" : "day")
            row["step"] = num(max(1, it?.num("step") ?? 1))
            let saved = s.put("ceteleItems", row)
            return .object(["ok": true, "item": .string(saved.str("name")), "target": num(saved.num("target")), "unit": .string(saved.str("unit")), "per": .string(saved.str("per"))])

        case "add_expense":
            guard let amount = i["amount"]?.double, amount != 0 else { throw fail("amount is required") }
            let cat = Money.categories.contains(i.str("category")) ? i.str("category") : "Other"
            return slim(s.put("expenses", ["amount": num(amount), "category": .string(cat), "note": .string(i.str("note")), "date": .string(date)]))
        case "list_expenses":
            var list = s.expenses(from: i.str("from").isEmpty ? Day.add(Day.today, -30) : i.str("from"), to: i.str("to").isEmpty ? Day.today : i.str("to"))
            if !i.str("category").isEmpty { list = list.filter { $0.str("category").lowercased() == i.str("category").lowercased() } }
            return .object(["total": num(list.reduce(0) { $0 + $1.num("amount") }), "byCategory": byCategory(list), "expenses": arr(Array(list.prefix(60)))])
        case "delete_expense":
            let had = s.get("expenses", i.str("id")) != nil
            s.remove("expenses", i.str("id"))
            return .object(["deleted": .bool(had)])

        case "add_meeting":
            guard !i.str("title").isEmpty, let start = parseLocal(i.str("start")) else { throw fail("title and start are required (start like 2026-10-15T14:00)") }
            let end = parseLocal(i.str("end")) ?? start.addingTimeInterval(3600)
            let row = s.put("events", ["title": .string(i.str("title")), "start": .string(Store.isoString(start)), "end": .string(Store.isoString(end)),
                                        "location": .string(i.str("location")), "notes": .string(i.str("notes")), "remind": num(i["remind_minutes_before"]?.double ?? 15)])
            return slimEvent(row)
        case "list_meetings":
            let from = i.str("from").isEmpty ? Day.today : i.str("from")
            let to = i.str("to").isEmpty ? Day.add(from, 6) : i.str("to")
            var days: [JSON] = [], k = from
            while k <= to && days.count < 31 {
                days.append(.object(["day": .string(k), "meetings": .array(eventsOn(s, k).map(slimEvent)), "free": strs(freeSlots(s, k))]))
                k = Day.add(k, 1)
            }
            return .array(days)
        case "update_meeting":
            if s.get("applecal", i.str("id")) != nil { throw fail("That event is from Apple Calendar and is read only in Yaver. Tell the user to change it in the Calendar app.") }
            guard var ev = s.get("events", i.str("id")) else { throw fail("No meeting with that id") }
            let a0 = Store.parseISO(ev.str("start")) ?? Date(), b0 = Store.parseISO(ev.str("end")) ?? a0.addingTimeInterval(3600)
            if let a = parseLocal(i.str("start")) {
                ev["start"] = .string(Store.isoString(a))
                if i.str("end").isEmpty { ev["end"] = .string(Store.isoString(a.addingTimeInterval(b0.timeIntervalSince(a0)))) }
            }
            if let b = parseLocal(i.str("end")) { ev["end"] = .string(Store.isoString(b)) }
            for k in ["title", "location", "notes"] where i[k] != nil { ev[k] = i[k] }
            return slimEvent(s.put("events", ev))
        case "delete_meeting":
            if s.get("applecal", i.str("id")) != nil { throw fail("That event is from Apple Calendar and is read only in Yaver. Tell the user to delete it in the Calendar app.") }
            let had = s.get("events", i.str("id")) != nil
            s.remove("events", i.str("id"))
            return .object(["deleted": .bool(had)])

        case "log_study":
            guard let m = i["minutes"]?.double, m > 0 else { throw fail("minutes must be positive") }
            s.logStudy(subject: i.str("subject"), minutes: m, note: i.str("note"), date: date)
            return .object(["logged": true, "todayMin": num(s.studyMinutes(Day.today)), "streakDays": num(Double(s.studyStreak()))])
        case "get_study_stats":
            var sum = studySummary(s)
            var last14: [String: JSON] = [:]
            for n in 0..<14 { let k = Day.add(Day.today, -n); last14[k] = num(s.studyMinutes(k)) }
            sum["last14"] = .object(last14)
            return .object(sum)
        case "get_roadmap":
            return .array(s.all("subjects").compactMap { sub -> JSON? in
                let ms = s.milestones(sub.id)
                guard !ms.isEmpty else { return nil }
                return .object(["subject": .string(sub.str("name")), "done": num(Double(ms.filter { $0.flag("done") }.count)), "total": num(Double(ms.count)),
                                "milestones": .array(ms.map { .object(["id": .string($0.id), "title": .string($0.str("title")), "done": .bool($0.flag("done"))]) })])
            })
        case "add_roadmap_milestones":
            let titles = (i["milestones"]?.array ?? []).compactMap { $0.string }
            if titles.isEmpty { throw fail("milestones must be a non-empty list") }
            let sub = s.subject(named: i.str("subject"))
            var order = s.milestones(sub.id).count
            for t in titles { s.put("milestones", ["subjectId": .string(sub.id), "title": .string(t.trimmingCharacters(in: .whitespaces)), "done": false, "order": num(Double(order))]); order += 1 }
            return .object(["added": num(Double(titles.count))])
        case "complete_milestone":
            guard var m = s.get("milestones", i.str("id")) else { throw fail("No milestone with that id") }
            let done = i["done"]?.bool ?? true
            m["done"] = .bool(done); m["doneAt"] = done ? .string(Store.isoNow()) : .null
            s.put("milestones", m)
            return .object(["done": .bool(done)])
        case "log_practice":
            if let p = i["problems"]?.double, p != 0 { s.addPractice("problems", p) }
            if let a = i["anki_reviews"]?.double, a != 0 { s.addPractice("anki", a) }
            let total = s.all("kv").filter { $0.id.hasPrefix("practice:problems:") }.reduce(0) { $0 + ($1["value"]?.double ?? 0) }
            return .object(["problemsToday": num(s.practiceOn("problems")), "ankiToday": num(s.practiceOn("anki")), "problemsTotal": num(total)])
        case "get_study_plan":
            if C.ready && C.active(s) {
                return .object(["active": "Yaver Course", "note": "The day-by-day course is the active plan; use get_course_today and get_course_progress. The old 52-week roadmap below is kept for reference.", "oldPlan": opt(s.plan()?.title)])
            }
            guard let p = s.plan() else { return .object(["plan": .null, "hint": "No plan loaded. The user can load the ML Engineer roadmap from the Study tab."]) }
            return .object(["title": .string(p.title), "week": num(Double(p.week)), "phase": .string(p.phase)])

        case "get_course_today":
            let d = C.day(s, date)
            let slots: [JSON] = d.slots.filter { $0.type != "info" }.map { sl in
                var o: [String: JSON] = ["slot": .string(sl.id), "start": .string(sl.start), "end": .string(sl.end), "minutes": num(Double(sl.minutes)), "title": .string(C.slotTitle(sl))]
                if let t = sl.track { o["track"] = .string(t) }
                if let l = sl.lesson { o["lessonId"] = .string(l.id) }
                if let st = sl.status { o["status"] = .string(st) }
                if sl.ahead { o["ahead"] = true }
                if sl.urgent { o["urgent"] = true }
                if let p = sl.prepare { o["prepareWeek"] = num(Double(p)) }
                return .object(o)
            }
            return .object(["date": .string(date), "week": num(Double(d.week)), "phase": .string(d.phaseName), "consolidation": .bool(d.consolidation), "courseActive": .bool(C.active(s)),
                            "slots": .array(slots), "cardsDue": num(Double(C.dueCount(s))),
                            "pace": .array(C.pace(s).values.map { .object(["track": .string($0.name), "status": .string($0.label)]) }),
                            "deadlines": .array(C.deadlines(s, within: 14).map { .object(["lessonId": .string($0.lesson.id), "title": .string($0.lesson.str("title")), "teachBy": .string($0.teachBy), "days": num(Double($0.days))]) })])
        case "get_lesson":
            guard let l = C.lesson(s, i.str("lessonId")) else { throw fail("No lesson with that id") }
            return .object(["lesson": .object(l), "progress": C.progress(s, l.id).map { .object($0) } ?? .null, "teachBy": l.str("track") == "robo" ? opt(C.teachBy(s, l)) : .null])
        case "complete_lesson":
            guard C.lesson(s, i.str("lessonId")) != nil else { throw fail("No lesson with that id") }
            let r = C.completeLesson(s, lessonId: i.str("lessonId"), minutes: i["minutes"]?.double.map { Int($0) }, score: i["score"]?.double, notes: i.str("notes"))
            return .object(["mastered": .bool(r.mastered), "score": r.score.map { num($0) } ?? .null, "minutes": num(Double(r.minutes)),
                            "next": r.next.map { .object(["id": .string($0.id), "title": .string($0.str("title"))]) } ?? .null])
        case "get_review_cards":
            let track = i.str("track").isEmpty ? nil : i.str("track")
            let cards = C.dueCards(s, limit: Int(i["limit"]?.double ?? 10), track: track)
            return .object(["due": num(Double(C.dueCount(s))), "cards": .array(cards.map { .object(["id": .string($0.id), "track": .string($0.str("track")), "front": .string($0.str("front")), "back": .string($0.str("back")), "box": num($0.num("box"))]) })])
        case "grade_card":
            guard s.get("cards", i.str("cardId")) != nil else { throw fail("No card with that id") }
            C.gradeCard(s, i.str("cardId"), i.str("grade"))
            let c = s.get("cards", i.str("cardId")) ?? [:]
            return .object(["cardId": .string(i.str("cardId")), "box": num(c.num("box")), "due": .string(c.str("due"))])
        case "get_course_progress":
            let tracks: [JSON] = C.trackSummaries(s).map { t in
                .object(["track": .string(t.track), "name": .string(t.name), "done": num(Double(t.done)), "total": num(Double(t.total)), "pace": .string(t.pace),
                         "masteryRate": t.mastery.map { num(Double($0)) } ?? .null,
                         "flagged": .array(t.flagged.map { .object(["id": .string($0.str("lessonId")), "title": opt(C.lesson(s, $0.str("lessonId"))?.str("title"))]) })])
            }
            return .object(["week": num(Double(C.weekOf(s))), "tracks": .array(tracks), "cardsDue": num(Double(C.dueCount(s))), "tests": arr(C.testResults(s)),
                            "consolidationWeeks": .array(C.consolidationWeeks.map { num(Double($0)) }), "diagnostic": .array(C.diagnosticHistory(s)),
                            "deadlines": .array(C.deadlines(s, within: 30).map { .object(["lessonId": .string($0.lesson.id), "teachBy": .string($0.teachBy)]) })])
        case "record_test_result":
            let w = Int(i["week"]?.double ?? Double(C.weekOf(s)))
            var scores: [(track: String, right: Int, total: Int)] = []
            for x in i["scores"]?.array ?? [] {
                let track: String = x["track"]?.string ?? ""
                let right: Int = Int(x["right"]?.double ?? 0)
                let total: Int = Int(x["total"]?.double ?? 0)
                scores.append((track: track, right: right, total: total))
            }
            let weak = C.recordTest(s, week: w, scores: scores)
            return .object(["saved": true, "weakTracks": strs(weak)])
        case "save_week_lessons":
            return saveWeek(s, Int(i["week"]?.double ?? 0), (i["lessons"]?.array ?? []).compactMap { $0.object })

        case "find_places":
            return try await Places.forTool(s, category: i.str("category"), query: i.str("query"), radius: i["radius_m"]?.double ?? 2000)
        case "body_status":
            return BodyCalc.forAI(s)
        case "log_weight":
            guard let kg = i["kg"]?.double, kg > 20 else { throw fail("kg is required") }
            BodyCalc.logWeight(s, kg: kg, date: date, waist: i["waist_cm"]?.double, fat: i["body_fat_pct"]?.double)
            return .object(["ok": true])
        case "log_workout":
            return Training.markDoneForTool(s, date: date, session: i.str("session"))

        case "log_meal":
            guard !i.str("name").isEmpty else { throw fail("name is required") }
            var row: Row = ["name": .string(i.str("name")), "meal": .string(Meals.types.contains(i.str("meal")) ? i.str("meal") : "Snack"), "date": .string(date),
                            "calories": num(i["calories"]?.double ?? 0), "protein": num(i["protein"]?.double ?? 0), "carbs": num(i["carbs"]?.double ?? 0), "fat": num(i["fat"]?.double ?? 0)]
            if let f = i["fiber"]?.double { row["fiber"] = num(f) }
            if let f = i["sugar"]?.double { row["sugar"] = num(f) }
            if let f = i["sodium_mg"]?.double { row["sodium"] = num(f) }
            let t = i.str("time")
            if t.range(of: #"^([01]?\d|2[0-3]):[0-5]\d$"#, options: .regularExpression) != nil { row["time"] = .string(t.count == 4 ? "0" + t : t) }
            else if date == Day.today { row["time"] = .string(Day.hm()) }
            s.put("meals", row)
            let d = s.diet(date)
            return .object(["logged": true, "dayCalories": num(d.calories), "calorieGoal": num(s.calorieGoal), "dayProtein": num(d.protein)])
        case "get_insights":
            return Insights.forAI(s)
        case "log_feeling":
            var row = s.feeling(date) ?? ["date": .string(date)]
            row["feel"] = .string(i.str("feel")); row["note"] = .string(i.str("note"))
            s.put("checkins", row)
            return .object(["ok": true, "date": .string(date), "feel": .string(i.str("feel"))])
        case "get_diet_day":
            let d = s.diet(date)
            return .object(["date": .string(date), "meals": arr(d.meals), "calories": num(d.calories), "protein": num(d.protein), "carbs": num(d.carbs), "fat": num(d.fat),
                            "fiber": num(d.fiber), "sugar": num(d.sugar), "sodium": num(d.sodium), "micros": .object(d.micros.mapValues { num($0) }),
                            "goals": .object(["dailyCalories": num(s.calorieGoal), "dailyProtein": num(s.proteinGoal)])])
        case "diet_history":
            let n = max(1, min(180, Int((i["days"]?.double ?? 30).rounded())))
            return dietHistory(s, n)

        case "add_task":
            guard !i.str("title").isEmpty else { throw fail("title is required") }
            return slim(s.put("tasks", ["title": .string(i.str("title")), "due": i["due"]?.string.map { .string($0) } ?? .null, "done": false]))
        case "complete_task":
            guard var t = s.get("tasks", i.str("id")) else { throw fail("No task with that id") }
            t["done"] = true; t["doneAt"] = .string(Store.isoNow())
            s.put("tasks", t)
            return .object(["done": true])

        case "team_status": return teamSummary(s, i.str("team").isEmpty ? nil : i.str("team"))
        case "add_person":
            let r = addPerson(s, name: i.str("name"), team: i.str("team"), role: i.str("role"), notes: i.str("notes"), every: i["meet_every_days"]?.double)
            return slim(r)
        case "log_team_activity":
            guard !i.str("title").isEmpty else { throw fail("title is required") }
            let when = i.str("date").isEmpty ? Date() : (parseLocal(i.str("date")) ?? Date())
            var team = i.str("team"); if !["student", "dev", "both"].contains(team) { team = "student" }
            var ids: [JSON] = [], added: [String] = []
            for raw in (i["people"]?.array ?? []).compactMap({ $0.string }) {
                let n = raw.trimmingCharacters(in: .whitespaces); if n.isEmpty { continue }
                var p = findPerson(s, n)
                if p == nil { p = addPerson(s, name: n, team: team == "dev" ? "dev" : "student", role: "", notes: "", every: nil); added.append(n) }
                if let id = p?.id, !ids.contains(.string(id)) { ids.append(.string(id)) }
            }
            let kind = ["meeting", "activity", "event"].contains(i.str("kind")) ? i.str("kind") : "activity"
            let row = s.put("activities", ["title": .string(i.str("title")), "kind": .string(kind), "team": .string(team), "date": .string(Store.isoString(when)),
                                            "place": .string(i.str("place")), "people": .array(ids), "notes": .string(i.str("notes"))])
            guard case .object(var o) = slim(row) else { return slim(row) }
            o["people"] = i["people"] ?? .array([]); o["added_people"] = strs(added)
            return .object(o)

        case "set_goal":
            let goal = i.str("goal")
            guard ["monthlyBudget", "dailyStudyMin", "dailyCalories", "dailyProtein"].contains(goal), let v = i["value"]?.double else { throw fail("goal and value are required") }
            s.setSetting(goal, num(v))
            return .object([goal: num(v)])
        default:
            return .object(["error": .string("Unknown tool \(name)")])
        }
    }

    // MARK: teams

    private static func fold(_ x: String) -> String { x.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "tr")).replacingOccurrences(of: "ı", with: "i") }
    static func findPerson(_ s: Store, _ name: String) -> Row? {
        let n = fold(name).trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { return nil }
        let all = s.all("people")
        return all.first { fold($0.str("name")) == n } ?? all.first { String(fold($0.str("name")).split(separator: " ").first ?? "") == n } ?? all.first { fold($0.str("name")).hasPrefix(n) }
    }
    @discardableResult
    static func addPerson(_ s: Store, name: String, team t: String, role: String, notes: String, every: Double?) -> Row {
        let team = ["student", "dev"].contains(t) ? t : "student"
        let clean = name.trimmingCharacters(in: .whitespaces)
        if let dup = s.all("people").first(where: { fold($0.str("name")) == fold(clean) }) { return dup }
        return s.put("people", ["name": .string(clean), "team": .string(team), "role": .string(role), "contact": "", "notes": .string(notes),
                                "meetEvery": num(every ?? (team == "student" ? 14 : 0))])
    }
    static func teamSummary(_ s: Store, _ team: String?) -> JSON {
        var teams: [String: JSON] = [:]
        for t in Store.teams where team == nil || team == t {
            teams[t] = .array(s.people(t).map { p in
                let st = s.status(p)
                var o: [String: JSON] = ["id": .string(p.id), "name": .string(p.str("name")), "last_met": st.lastAt.map { .string(localInput($0)) } ?? .null,
                                         "days_since": st.days.map { num(Double($0)) } ?? .null]
                if !p.str("role").isEmpty { o["role"] = .string(p.str("role")) }
                if st.every > 0 { o["meet_every_days"] = num(Double(st.every)) }
                if st.overdue { o["overdue"] = true }
                return .object(o)
            })
        }
        let acts = s.activities().filter { team == nil || $0.str("team") == team || $0.str("team") == "both" }.prefix(15).map { a -> JSON in
            .object(["id": .string(a.id), "title": .string(a.str("title")), "kind": .string(a.str("kind")), "team": .string(a.str("team")), "date": .string(localInput(a.str("date"))),
                     "place": .string(a.str("place")), "people": strs((a["people"]?.array ?? []).compactMap { $0.string.flatMap { s.get("people", $0)?.str("name") } })])
        }
        return .object(["teams": .object(teams), "recent_activities": .array(Array(acts)), "today": .string(Day.today)])
    }

    // MARK: diet history (js/dietlog.js forAI + foodgaps)

    static func dietHistory(_ s: Store, _ n: Int) -> JSON {
        let r = DietLog.report(s, n)
        let nutrients = r.nutrients.map { x in "\(x.label): avg \(plain(x.avg))\(x.unit)" + (x.pct.map { " (\($0)% of \(x.kind == "goal" ? "goal" : x.kind == "max" ? "limit" : "daily value"))" } ?? "") }
        let perDay = DietLog.days(s, n).filter { $0.meals > 0 || $0.feel != nil }.map { d -> String in
            var line = "\(d.date): \(Int(d.d.calories.rounded())) kcal, P\(Int(d.d.protein.rounded())), \(d.meals) meals\(d.detailed > 0 ? "" : " (no vitamin data)")"
            if let t = d.timing { line += ", eaten \(t.first)-\(t.last), \(t.latePct)% of calories from 21:00\(t.late ? " (late day)" : "")" }
            if let f = d.feel { line += ", felt \(f)" }
            if let f = d.nextFeel { line += ", next morning \(f)" }
            return line
        }
        let meals = s.all("meals").filter { $0.str("date") >= r.from }
            .sorted { ($0.str("date") + (s.mealTime($0) ?? "")) < ($1.str("date") + (s.mealTime($1) ?? "")) }
            .map { m in "\(m.str("date")) \(s.mealTime(m) ?? "--:--")\(m.str("time").isEmpty && s.mealTime(m) != nil ? "~" : "") \(m.str("meal")): \(m.str("name")) (\(m.str("calories")) kcal)" }
        let feelings = s.all("checkins").filter { $0.str("date") >= r.from }.sorted { $0.str("date") < $1.str("date") }
            .map { "\($0.str("date")): \($0.str("feel"))\($0.str("note").isEmpty ? "" : " (\($0.str("note")))")" }
        var o: [String: JSON] = [
            "days": num(Double(n)), "from": .string(r.from), "loggedDays": num(Double(r.loggedDays)), "detailedDays": num(Double(r.detailedDays)),
            "nutrients": strs(nutrients), "low": strs(r.low.map { "\($0.label) \($0.pct ?? 0)%" }), "high": strs(r.high.map { "\($0.label) \($0.pct ?? 0)%" }),
            "lowCalorieDays": strs(r.lowCalorieDays), "perDay": strs(perDay), "meals": strs(Array(meals.suffix(120))), "feelings": strs(feelings),
            "note": "Times with ~ are when the meal was logged, not eaten (older entries). Feelings are one check-in a day. Estimates from photos and descriptions. Vitamins and minerals only from photo or typed meals (detailedDays). Not a medical diagnosis.",
            "today_gaps": strs(FoodGaps.gaps(s).lines), "last_suggestions": FoodGaps.cached(s)?["items"] ?? .array([]),
        ]
        if let t = r.timing {
            o["timing"] = .object(["days": num(Double(t.days)), "first": .string(t.first), "last": .string(t.last), "window": num(t.window), "lateDays": strs(t.lateDays),
                                   "afterLate": .object(["days": num(Double(t.afterLate.days)), "bad": num(Double(t.afterLate.bad))]),
                                   "afterOther": .object(["days": num(Double(t.afterOther.days)), "bad": num(Double(t.afterOther.bad))])])
        }
        return .object(o)
    }

    // MARK: AI-written weeks (js/course.js validateLessons / saveWeekLessons)

    static func template(_ kind: String, _ minutes: Int) -> [(String, Int)] {
        switch kind {
        case "deep": return [("warmup", 10), ("example", 5), ("learn", 35), ("practice", 30), ("exit", 10)]
        case "practice": return [("warmup", 5), ("learn", 10), ("practice", 60), ("reflect", 10), ("exit", 5)]
        case "build": return [("plan", 10), ("build", minutes - 25), ("test", 10), ("log", 5)]
        case "prep": return [("learn", 15), ("simulate", 20), ("measure", 15), ("teachnotes", 10)]
        case "lab": return [("build", 60), ("measure", 25), ("handout", 25), ("exit", 10)]
        case "light": return minutes == 90 ? [("read", 65), ("summary", 10), ("cards", 15)] : [("read", 40), ("summary", 10), ("cards", 10)]
        default: return []
        }
    }
    private static var attempts: [Int: Int] = [:]
    static func saveWeek(_ s: Store, _ week: Int, _ lessons: [[String: JSON]]) -> JSON {
        let C = Course.shared
        var errors: [String] = []
        guard let w = C.weekMeta(week) else { return .object(["saved": false, "errors": strs(["week \(week) is not in the course"])]) }
        if week < 16 { errors.append("weeks 0–15 are bundled; only weeks 16 and later can be generated") }
        if w["consolidation"]?.bool == true { errors.append("week \(week) is a consolidation week: it has no lessons") }
        if lessons.isEmpty { errors.append("lessons must be a non-empty list") }
        var ids = Set<String>()
        let ww = String(format: "%02d", week)
        for (n, l) in lessons.enumerated() {
            let at = "lessons[\(n)] (\(l.str("id").isEmpty ? "no id" : l.str("id")))"
            guard let lane = C.lanes[l.str("lane")] else { errors.append("\(at): unknown lane \(l.str("lane"))"); continue }
            let track = lane["track"]?.string ?? "", kind = lane["kind"]?.string ?? "", minutes = Int(lane["minutes"]?.double ?? 0)
            if ids.contains(l.id) { errors.append("\(at): duplicate id") }
            ids.insert(l.id)
            if l.id.range(of: "^\(track)-w\(ww)-[a-z0-9]+$", options: .regularExpression) == nil { errors.append("\(at): id must be \(track)-w\(ww)-<k>") }
            if l.str("track") != track { errors.append("\(at): track must be \(track)") }
            if Int(l.num("minutes")) != minutes { errors.append("\(at): minutes must be \(minutes)") }
            if l.str("kind") != kind { errors.append("\(at): kind must be \(kind)") }
            if l.str("title").isEmpty { errors.append("\(at): title missing") }
            let obj = l["objectives"]?.array?.count ?? 0; if obj < 2 || obj > 4 { errors.append("\(at): 2–4 objectives") }
            let cards = l["cards"]?.array?.count ?? 0; if cards < 3 || cards > 6 { errors.append("\(at): 3–6 cards") }
            let exp = template(kind, minutes).map { "\($0.0):\($0.1)" }.joined(separator: " ")
            let got = (l["steps"]?.array ?? []).map { "\($0["kind"]?.string ?? ""):\(Int($0["minutes"]?.double ?? 0))" }.joined(separator: " ")
            if got != exp { errors.append("\(at): steps must be exactly \"\(exp)\" (got \"\(got)\")") }
        }
        attempts[week, default: 0] += 1
        if !errors.isEmpty {
            var o: [String: JSON] = ["saved": false, "errors": strs(errors)]
            if attempts[week, default: 0] >= 3 { o["stop"] = "Third failed attempt: stop retrying and tell the user plainly which problems remain." }
            return .object(o)
        }
        attempts[week] = 0
        for old in s.all("courseLessons") where Int(old.num("week")) == week { s.remove("courseLessons", old.id) }
        var seq: [String: Int] = [:]
        for l in lessons {
            let lane = l.str("lane")
            if seq[lane] == nil { seq[lane] = C.laneLessons(s, lane).filter { Int($0.num("week")) < week }.count }
            seq[lane, default: 0] += 1
            var row = l
            row["lessonId"] = .string(l.id); row["week"] = num(Double(week)); row["seq"] = num(Double(seq[lane] ?? 1))
            row["teachBy"] = l["teachBy"] ?? .null; row["safety"] = l["safety"] ?? .null; row["generatedAt"] = .string(Store.isoNow())
            s.put("courseLessons", row)
        }
        return .object(["saved": true, "count": num(Double(lessons.count))])
    }
}
