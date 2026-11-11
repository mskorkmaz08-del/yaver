// Home: Çetele first, then today in numbers, meetings, tasks, people to see.
import SwiftUI

struct HomeView: View {
    @EnvironmentObject var store: Store
    @EnvironmentObject var sync: Sync

    var body: some View {
        let _ = store.revision
        let cetele = store.cetele()
        let daily = cetele.filter { !$0.weekly }
        let diet = store.diet()
        let studied = store.studyMinutes(Day.today)
        let spentToday = store.expenses(from: Day.today, to: Day.today).reduce(0) { $0 + $1.num("amount") }
        let spentMonth = store.expenses().reduce(0) { $0 + $1.num("amount") }

        Screen(title: "Yaver") {
            Text(Date().formatted(date: .complete, time: .omitted)).font(.subheadline).foregroundStyle(Theme.muted)

            Card(title: "Çetele", trailing: "\(daily.filter(\.met).count)/\(daily.count) · \(store.ceteleStreak()) day streak") {
                if cetele.isEmpty { Text("No Çetele items yet. Add them in Çetele.").foregroundStyle(Theme.dim) }
                ForEach(cetele) { row in CeteleLine(row: row, day: Day.today) }
            }

            InsightsCard()

            Card(title: "Today") {
                HStack(alignment: .top) {
                    Stat(value: "\(fmt(diet.calories))", label: "of \(fmt(store.calorieGoal)) kcal")
                    Stat(value: "\(fmt(diet.protein)) g", label: "of \(fmt(store.proteinGoal)) g protein")
                }
                HStack(alignment: .top) {
                    Stat(value: mins(studied), label: "studied · \(store.studyStreak()) day streak", color: studied >= store.dailyStudyGoal ? Theme.ok : Theme.text)
                    Stat(value: store.money(spentToday), label: "spent · \(store.money(spentMonth)) this month")
                }
            }

            let events = store.upcomingEvents()
            if !events.isEmpty {
                Card(title: "Coming up") {
                    ForEach(events, id: \.id) { e in
                        HStack {
                            Text(e.str("title"))
                            Spacer()
                            if let d = Store.parseISO(e.str("start")) {
                                Text("\(Day.label(Day.key(d))) \(Day.hm(d))").font(.callout.monospacedDigit()).foregroundStyle(Theme.muted)
                            }
                        }
                    }
                }
            }

            let tasks = store.openTasks()
            if !tasks.isEmpty {
                Card(title: "Tasks") {
                    ForEach(tasks.prefix(8), id: \.id) { t in
                        Button {
                            var r = t
                            r["done"] = true
                            r["doneAt"] = .string(Store.isoNow())
                            store.put("tasks", r)
                        } label: {
                            HStack {
                                Image(systemName: "circle").foregroundStyle(Theme.dim)
                                Text(t.str("title")).foregroundStyle(Theme.text)
                                Spacer()
                                if !t.str("due").isEmpty { Text(String(t.str("due").prefix(10))).font(.caption).foregroundStyle(Theme.dim) }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            let overdue = store.overduePeople()
            if !overdue.isEmpty {
                Card(title: "Time to meet") {
                    ForEach(overdue.prefix(6).map { $0.0 }, id: \.id) { p in
                        let s = store.status(p)
                        HStack {
                            Text(p.str("name"))
                            Spacer()
                            Text(s.days.map { "\($0) days ago" } ?? "never met").foregroundStyle(Theme.warn).font(.callout)
                        }
                    }
                }
            }

            let sk = Skills.summary(store)
            NavigationLink { SkillsView() } label: {
                Card(title: "Skills", trailing: "level \(sk.level)") {
                    HStack(spacing: 14) {
                        SkillHexagon(sum: sk, labels: false).frame(width: 90, height: 90)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(sk.overall) overall").font(.title3.weight(.semibold).monospacedDigit()).foregroundStyle(Theme.gold)
                            Text(sk.areas.map { "\($0.area.short) \($0.rating)" }.joined(separator: " · ")).font(.caption.monospacedDigit()).foregroundStyle(Theme.muted)
                        }
                    }
                }
            }
            .buttonStyle(.plain)

            Text(sync.summary).font(.caption).foregroundStyle(Theme.dim)
        }
        .refreshable { await sync.run(allowEmptyPush: false) }
    }
}

/// One Çetele item: name, progress and a + button (a tap toggles check items).
struct CeteleLine: View {
    @EnvironmentObject var store: Store
    let row: CeteleRow
    let day: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: row.met ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(row.met ? Theme.ok : Theme.dim)
            VStack(alignment: .leading, spacing: 3) {
                Text(row.name)
                if !row.isCheck {
                    Bar(value: row.progress / row.target, color: row.met ? Theme.ok : Theme.gold)
                }
            }
            Spacer()
            if !row.isCheck {
                Text("\(fmt(row.progress))/\(fmt(row.target))\(row.unit.isEmpty ? "" : " \(row.unit)")\(row.weekly ? " wk" : "")")
                    .font(.callout.monospacedDigit()).foregroundStyle(Theme.muted)
                Button { store.setCetele(row.id, row.value - row.step, day) } label: { Image(systemName: "minus") }
                    .disabled(row.value <= 0)
            }
            Button {
                store.setCetele(row.id, row.isCheck ? (row.value > 0 ? 0 : 1) : row.value + row.step, day)
            } label: { Image(systemName: row.isCheck ? (row.value > 0 ? "arrow.uturn.left" : "checkmark") : "plus") }
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
    }
}
