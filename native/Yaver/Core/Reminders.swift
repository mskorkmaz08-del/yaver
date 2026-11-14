// Plain reminders (twin of js/reminders.js): facts about today worth acting on,
// no pep talk. Shown on Home. The native app also turns meeting reminders and
// the next course block into real notifications on the device (Notifications).
import Foundation
import UserNotifications

struct Reminder: Identifiable {
    let id = UUID()
    let kind: String
    let text: String
}

enum Reminders {
    static func mins(_ m: Double) -> String { m >= 60 ? "\(Int(m) / 60)h\(Int(m) % 60 > 0 ? " \(Int(m) % 60)m" : "")" : "\(Int(m.rounded()))m" }

    static func list(_ s: Store) -> [Reminder] {
        var out: [Reminder] = []
        let now = Date()
        func add(_ k: String, _ t: String) { out.append(Reminder(kind: k, text: t)) }

        let rows = s.cetele()
        let left = rows.filter { !$0.weekly && !$0.met }
        if !left.isEmpty {
            let streak = s.ceteleStreak()
            let names = left.prefix(4).map { $0.isCheck ? $0.name : "\($0.name) \(fmt($0.target - $0.progress))\($0.unit.isEmpty ? "" : " " + $0.unit)" }.joined(separator: ", ")
            add("cetele", "Çetele: \(names)\(left.count > 4 ? " +\(left.count - 4) more" : "") left\(streak > 0 ? " (\(streak)-day streak)" : "").")
        }
        let wd = Day.cal.component(.weekday, from: now) - 1
        if wd >= 4 || wd == 0 {
            for r in rows where r.weekly && !r.met { add("cetele", "\(r.name): \(fmt(r.progress)) of \(fmt(r.target)) this week.") }
        }

        let need = s.streakNeed, todayMin = s.studyMinutes(Day.today), goal = s.dailyStudyGoal
        let streak = s.studyStreak()
        if todayMin < need && s.studyMinutes(Day.add(Day.today, -1)) < need && s.count("sessions") > 0 {
            add("study", "Yesterday was missed. Don't miss two in a row: \(fmt(need)) min today.")
        } else if todayMin < need {
            add("study", streak > 0 ? "No study logged today. \(fmt(need)) min keeps the \(streak)-day streak." : "No study logged today. Goal: \(mins(goal)).")
        } else if todayMin < goal {
            add("study", "\(mins(goal - todayMin)) left to today's study goal.")
        }

        let C = Course.shared
        if C.ready && C.active(s) {
            if wd == 0 && C.weekOf(s) >= 1 { add("course", "Weekly test and ship today.") }
            if let nb = C.nextBlock(s, at: now) {
                let when = nb.date == Day.today ? "" : nb.date == Day.add(Day.today, 1) ? "Tomorrow " : nb.date + " "
                add("course", "\(when)\(nb.slot.start) · \(C.slotTitle(nb.slot))\(nb.slot.minutes > 0 ? " (\(nb.slot.minutes) min)" : "").")
            }
            let due = C.dueCount(s)
            if due > 0 { add("course", "\(due) review card\(due > 1 ? "s" : "") due.") }
            for t in C.pace(s, at: now).values.filter({ $0.behind > 0 }).sorted(by: { $0.behind > $1.behind }).prefix(2) {
                add(C.paceColor(s, t) == "red" ? "task" : "course", "\(t.name) is \(t.behind) lesson\(t.behind > 1 ? "s" : "") behind.")
            }
            for d in C.deadlines(s, within: 7).prefix(2) {
                let title = d.lesson.str("title")
                add("task", d.days < 0 ? "Robotics: \(title) was due to be taught \(-d.days) day\(d.days < -1 ? "s" : "") ago and isn't prepared."
                    : "Robotics: \(title) is taught \(d.days == 0 ? "today" : "in \(d.days) day\(d.days > 1 ? "s" : "")") and not prepared.")
            }
        }

        if let soon = s.upcomingEvents(3).first(where: { e in Store.parseISO(e.str("start")).map { $0 > now && $0.timeIntervalSince(now) < 3 * 3600 } ?? false }),
           let st = Store.parseISO(soon.str("start")) {
            add("meeting", "\(soon.str("title")) at \(Day.hm(st)).")
        }

        for t in Store.teams {
            let need = s.overduePeople().filter { $0.0.str("team") == t }
            if need.isEmpty { continue }
            let who = need.prefix(3).map { String($0.0.str("name").split(separator: " ").first ?? "") }.joined(separator: ", ")
            add("teams", "\(Store.teamName(t)): no meeting with \(who)\(need.count > 3 ? " +\(need.count - 3) more" : "") lately, and none planned.")
        }

        let overdue = s.openTasks().filter { !$0.str("due").isEmpty && $0.str("due") < Day.today }
        if let first = overdue.first { add("task", "\(overdue.count) overdue task\(overdue.count > 1 ? "s" : ""): \(first.str("title"))\(overdue.count > 1 ? ", …" : "").") }

        let budget = s.monthlyBudget
        if budget > 0 {
            let spent = s.expenses().reduce(0) { $0 + $1.num("amount") }
            let day = Double(Day.cal.component(.day, from: now)), dim = Double(Day.cal.range(of: .day, in: .month, for: now)?.count ?? 30)
            if spent > budget { add("money", "Over budget by \(s.money(spent - budget)) this month.") }
            else if spent / budget > day / dim + 0.1 { add("money", "Spending is ahead of pace: \(Int((spent / budget * 100).rounded()))% of budget used, \(Int((day / dim * 100).rounded()))% of the month gone.") }
        }

        let d = s.diet()
        if Day.cal.component(.hour, from: now) >= 17 && !d.meals.isEmpty && d.protein < s.proteinGoal * 0.6 {
            add("diet", "Protein at \(Int(d.protein.rounded()))g of \(Int(s.proteinGoal))g.")
        }
        return out
    }
}

/// Real notifications on this device: meeting reminders (each meeting's "remind me"
/// minutes, Apple Calendar events 15 minutes before) and the next course block.
@MainActor
enum Notifications {
    static func requestIfNeeded() async {
        let c = UNUserNotificationCenter.current()
        let st = await c.notificationSettings()
        if st.authorizationStatus == .notDetermined { _ = try? await c.requestAuthorization(options: [.alert, .sound, .badge]) }
    }

    static func reschedule(_ s: Store) async {
        let c = UNUserNotificationCenter.current()
        guard await c.notificationSettings().authorizationStatus == .authorized else { return }
        c.removeAllPendingNotificationRequests()
        let now = Date(), horizon = now.addingTimeInterval(7 * 86400)
        var n = 0
        for e in (s.all("events") + s.all("applecal")) where !e.flag("allDay") {
            guard let start = Store.parseISO(e.str("start")), start > now, start < horizon else { continue }
            let before = e.str("source") == "apple" ? 15 : (e["remind"]?.double ?? 15)
            if before <= 0 { continue }
            let at = start.addingTimeInterval(-before * 60)
            if at <= now { continue }
            add(c, id: "ev:\(e.id)", title: e.str("title"), body: "\(Day.hm(start))\(e.str("location").isEmpty ? "" : " · " + e.str("location"))", at: at)
            n += 1
            if n >= 50 { break }
        }
        let C = Course.shared
        if C.ready && C.active(s), let nb = C.nextBlock(s, at: now) {
            let day = Day.date(nb.date)
            if let at = Day.cal.date(bySettingHour: Course.toMin(nb.slot.start) / 60, minute: Course.toMin(nb.slot.start) % 60, second: 0, of: day), at > now {
                add(c, id: "course:next", title: C.slotTitle(nb.slot), body: "Starts now\(nb.slot.minutes > 0 ? " · \(nb.slot.minutes) min" : "").", at: at)
            }
        }
    }

    private static func add(_ c: UNUserNotificationCenter, id: String, title: String, body: String, at: Date) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        let comps = Day.cal.dateComponents([.year, .month, .day, .hour, .minute], from: at)
        c.add(UNNotificationRequest(identifier: id, content: content, trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)))
    }
}
