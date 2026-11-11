// Skills (twin of js/views/skills.js): the player card. Overall rating, the hexagon
// (now in gold, four weeks ago in steel), each area's level and XP to the next,
// this week's form, streaks with their best, and the latest wins.
import SwiftUI

struct Radar: Shape {
    let values: [Double] // 0...1 per corner
    func path(in rect: CGRect) -> Path {
        var p = Path()
        let c = CGPoint(x: rect.midX, y: rect.midY), r = min(rect.width, rect.height) / 2
        for (i, v) in values.enumerated() {
            let a = (-90 + 360 / Double(values.count) * Double(i)) * .pi / 180
            let pt = CGPoint(x: c.x + r * v * cos(a), y: c.y + r * v * sin(a))
            if i == 0 { p.move(to: pt) } else { p.addLine(to: pt) }
        }
        p.closeSubpath()
        return p
    }
}

struct SkillHexagon: View {
    let sum: Skills.Summary
    var labels = true
    var body: some View {
        GeometryReader { g in
            let side = min(g.size.width, g.size.height)
            let r = side / 2 * (labels ? 0.72 : 0.95)
            let c = CGPoint(x: g.size.width / 2, y: g.size.height / 2)
            ZStack {
                ForEach([0.25, 0.5, 0.75, 1.0], id: \.self) { f in
                    Radar(values: Array(repeating: f, count: 6)).stroke(Theme.line, lineWidth: 1).frame(width: r * 2, height: r * 2)
                }
                Radar(values: sum.areas.map { max(0.1, Double($0.ratingThen) / 99) }).stroke(Theme.steel, lineWidth: 1.5).frame(width: r * 2, height: r * 2)
                Radar(values: sum.areas.map { max(0.1, Double($0.rating) / 99) }).fill(Theme.gold.opacity(0.25)).frame(width: r * 2, height: r * 2)
                Radar(values: sum.areas.map { max(0.1, Double($0.rating) / 99) }).stroke(Theme.gold, lineWidth: 2).frame(width: r * 2, height: r * 2)
                if labels {
                    ForEach(sum.areas.indices, id: \.self) { i in
                        let a = (-90 + 60 * Double(i)) * .pi / 180
                        VStack(spacing: 0) {
                            Text("\(sum.areas[i].rating)").font(.headline.monospacedDigit()).foregroundStyle(Theme.text)
                            Text(sum.areas[i].area.short).font(.caption2).foregroundStyle(Theme.dim)
                        }
                        .position(x: c.x + (r + 26) * cos(a), y: c.y + (r + 22) * sin(a))
                    }
                }
            }
            .frame(width: g.size.width, height: g.size.height)
        }
    }
}

struct SkillsView: View {
    @EnvironmentObject var store: Store
    var body: some View {
        let _ = store.revision
        let s = Skills.summary(store)
        let gain = s.overall - s.overallThen
        let best = s.areas.max { $0.rating < $1.rating }
        let rising = s.areas.filter { $0.form == "up" }.map(\.area.name)
        Screen(title: "Skills · level \(s.level)") {
            Card {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text("\(s.overall)").font(.system(size: 48, weight: .bold).monospacedDigit()).foregroundStyle(Theme.gold)
                    VStack(alignment: .leading) {
                        Text("overall").foregroundStyle(Theme.muted)
                        Text(gain > 0 ? "+\(gain) in 4 weeks" : "building").font(.caption).foregroundStyle(gain > 0 ? Theme.ok : Theme.dim)
                    }
                    Spacer()
                    Text("\(fmt(s.totalXp)) XP").font(.callout.monospacedDigit()).foregroundStyle(Theme.muted)
                }
                SkillHexagon(sum: s).frame(height: 300)
                HStack(spacing: 14) {
                    Label("now", systemImage: "hexagon.fill").foregroundStyle(Theme.gold)
                    Label("4 weeks ago", systemImage: "hexagon").foregroundStyle(Theme.steel)
                }.font(.caption)
            }
            Text("\(rising.isEmpty ? "Every lesson, test, problem and Çetele count moves these up." : "Rising this week: \(rising.joined(separator: ", ")).") Strongest: \(best?.area.name ?? "").")
                .font(.callout).foregroundStyle(Theme.muted)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 12)], spacing: 12) {
                ForEach(s.areas) { a in
                    Card {
                        HStack { Text(a.area.name).font(.headline); Spacer(); Text("\(a.rating)").font(.title3.monospacedDigit()).foregroundStyle(Theme.gold) }
                        Bar(value: a.frac)
                        HStack {
                            Text("Level \(a.level) · \(fmt(a.toNext)) XP to \(a.level + 1)").font(.caption).foregroundStyle(Theme.dim)
                            Spacer()
                            Text("\(a.form == "up" ? "↑" : a.form == "down" ? "↓" : "→") \(a.week > 0 ? "+\(fmt(a.week))" : "0") this week")
                                .font(.caption).foregroundStyle(a.form == "up" ? Theme.ok : a.form == "down" ? Theme.warn : Theme.dim)
                        }
                    }
                }
            }
            Card(title: "Streaks") {
                HStack {
                    ForEach(s.streaks, id: \.name) { st in
                        Stat(value: "\(st.current)", label: "\(st.name) · days · \(st.current > 0 && st.current >= st.best ? "your best yet" : st.best > 0 ? "best \(st.best)" : "starts today")")
                    }
                }
                Text(s.streaks.contains { $0.current == 0 && $0.best > 0 } ? "A missed day doesn't undo anything here: levels stay. Today is a fresh start." : "Keep the chain going; levels stay even on a day off.")
                    .font(.caption).foregroundStyle(Theme.dim)
            }
            Card(title: "Latest wins") {
                if s.recent.isEmpty { Text("Finish a lesson, solve a problem or log a Çetele count: it shows up here.").font(.callout).foregroundStyle(Theme.dim) }
                ForEach(s.recent.indices, id: \.self) { i in
                    let e = s.recent[i]
                    HStack {
                        Text("+\(e.xp)").font(.callout.monospacedDigit()).foregroundStyle(Theme.gold).frame(width: 48, alignment: .leading)
                        Text(e.what).font(.callout).lineLimit(2)
                        Spacer()
                        Text("\(Skills.areas.first { $0.id == e.area }?.short ?? "") · \(Day.label(e.day))").font(.caption).foregroundStyle(Theme.dim)
                    }
                }
            }
            Card(title: "How XP is earned") {
                ForEach(["Lesson mastered: 60 + 40 × your exit score (one to redo: 30), to its area.", "Weekly test: up to 150 per subject, by score.",
                         "Problem solved: 25 to Algorithms. Card reviewed: 2 to Discipline.",
                         "Study time: 1 per 4 minutes; task done: 10; milestone: 30; a day with every Çetele minimum met: 40 (Discipline).",
                         "Çetele counts: 50 for meeting a daily target (part of it for part of the way), 150 for a weekly one; up to 120 a day.",
                         "Ratings run 1–99 and slow down near the top; levels need 100, 300, 600, 1,000 … XP."], id: \.self) { Text("• " + $0).font(.caption).foregroundStyle(Theme.muted) }
            }
        }
    }
}

/// Home cards: the top insights (only when something stands out) and the skills mini card.
struct InsightsCard: View {
    @EnvironmentObject var store: Store
    var body: some View {
        let list = Array(Insights.all(store).prefix(3))
        if !list.isEmpty {
            Card(title: "Insights") {
                ForEach(list) { i in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(alignment: .top) {
                            Circle().fill(i.level == 3 ? Theme.red : i.level == 2 ? Theme.warn : Theme.steel).frame(width: 8, height: 8).padding(.top, 6)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(i.area.uppercased()).font(.caption2.weight(.semibold)).foregroundStyle(Theme.dim)
                                Text(i.text).font(.callout)
                            }
                        }
                        HStack {
                            if let ask = i.ask {
                                Button { ChatModel.shared.open = true; ChatModel.shared.send(store, ask) } label: { Label("Ask Yaver", systemImage: "sparkles") }
                            }
                            Button("Hide today") { Insights.hide(store, i.id) }
                        }
                        .buttonStyle(.bordered).controlSize(.small)
                    }
                }
            }
        }
    }
}
