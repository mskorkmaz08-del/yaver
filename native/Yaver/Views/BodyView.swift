// Body (twin of js/views/body.js): the athletic goal, today's food and training,
// the muscle map lit by this week's sets, the week and where eating like this
// leads, the plan (food numbers and the weekly split) and weigh-ins. Every number
// is an estimate (formulas in Core/Body.swift).
import SwiftUI

struct BodyView: View {
    @EnvironmentObject var store: Store
    @State private var picked = ""
    @State private var editProfile = false
    @State private var weigh: WeighEdit?
    @State private var toast = ""

    static let days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    static func sign(_ n: Double) -> String { (n > 0 ? "+" : n < 0 ? "−" : "") + fmt(abs(n), 0) }
    static func kgs(_ k: Double) -> String { (k > 0 ? "+" : k < 0 ? "−" : "") + fmt(abs(BodyCalc.r1(k)), 1) + " kg" }

    var body: some View {
        let _ = store.revision
        Group {
            if let s = BodyCalc.status(store) { main(s) } else { setup }
        }
        .sheet(isPresented: $editProfile) { ProfileForm().environmentObject(store) }
        .sheet(item: $weigh) { w in WeighForm(existing: w.row).environmentObject(store) }
    }

    private var setup: some View {
        Screen(title: "Body") {
            Card(title: "Your body") {
                Text("Your height and weight are all it needs. From them Yaver sets your athletic target weight, the food and training plan to reach it, and shows what each day of eating does to fat and muscle.")
                    .foregroundStyle(Theme.muted)
                Button("Start") { editProfile = true }.buttonStyle(.borderedProminent)
            }
        }
    }

    @ViewBuilder private func main(_ s: BodyCalc.Status) -> some View {
        Screen(title: "Body") {
            HStack {
                Text("\(fmt(s.profile.kg, 1)) kg").font(.largeTitle.weight(.semibold).monospacedDigit())
                Spacer()
                Button { editProfile = true } label: { Image(systemName: "pencil") }.buttonStyle(.bordered)
                Button { weigh = WeighEdit(row: nil) } label: { Label("Log weight", systemImage: "plus") }.buttonStyle(.borderedProminent)
            }
            goalCard(s)
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 12) { eatCard(s); trainCard() }
                VStack(spacing: 12) { eatCard(s); trainCard() }
            }
            musclesCard()
            weekCard(s)
            planCard(s)
            weighCard()
            Text("Estimates from standard formulas and studies, not a medical measurement. Weigh in once a week at the same time of day; the numbers improve as real weigh-ins come in.")
                .font(.caption).foregroundStyle(Theme.dim)
            if !toast.isEmpty { Text(toast).font(.callout).foregroundStyle(Theme.gold) }
        }
    }

    private func goalCard(_ s: BodyCalc.Status) -> some View {
        let p = s.profile, t = s.target
        let max = Swift.max(p.kg, t.kg)
        var line: [String] = []
        if t.fatToLose > 0 { line.append("Lose about \(fmt(t.fatToLose, 1)) kg of fat") }
        if t.muscle > 0 { line.append("\(t.fatToLose > 0 ? "gain" : "Gain") about \(fmt(t.muscle, 1)) kg of muscle") }
        let months = t.months > 0 ? ". Roughly \(t.months) month\(t.months == 1 ? "" : "s")." : ""
        let fatFrom = p.fatFrom == "measured" ? "as measured" : p.fatFrom == "waist" ? "from your waist" : "estimated from height and weight; add your waist at the next weigh-in for a better number"
        return Card(title: "Athletic goal", trailing: t.mode == "cut" ? "Phase 1: lose fat" : "Lean gain") {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(fmt(p.kg, 1)).font(.title.monospacedDigit())
                Image(systemName: "arrow.right").foregroundStyle(Theme.dim)
                Text(fmt(t.kg, 1)).font(.title.monospacedDigit()).foregroundStyle(Theme.gold)
                Text("kg").foregroundStyle(Theme.dim)
            }
            Text(line.joined(separator: ", then ") + months).font(.callout)
            comp("Now", p.kg - p.fatKg, p.fatKg, max)
            comp("Target", t.lean, t.kg - t.lean, max)
            Text("Muscular, strong, fast and flexible: \(fmt(t.bodyFat, 0))% body fat with the lean mass of a trained athlete your height (FFMI \(fmt(t.ffmi, 1))). Body fat now \(fatFrom).")
                .font(.caption).foregroundStyle(Theme.dim)
        }
    }

    private func comp(_ label: String, _ lean: Double, _ fat: Double, _ max: Double) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack { Text(label).font(.caption); Spacer(); Text("\(fmt(lean, 0)) lean · \(fmt(fat, 0)) fat").font(.caption.monospacedDigit()).foregroundStyle(Theme.muted) }
            GeometryReader { g in
                HStack(spacing: 0) {
                    Rectangle().fill(Theme.steel).frame(width: g.size.width * lean / Swift.max(1, max))
                    Rectangle().fill(Theme.warn.opacity(0.7)).frame(width: g.size.width * fat / Swift.max(1, max))
                    Spacer(minLength: 0)
                }
            }
            .frame(height: 8).clipShape(Capsule()).background(Theme.plate2, in: Capsule())
        }
    }

    private func meter(_ label: String, _ v: Double, _ goal: Double, _ unit: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack { Text(label).font(.callout); Spacer(); Text("\(fmt(v, 0)) / \(fmt(goal, 0)) \(unit)").font(.caption.monospacedDigit()).foregroundStyle(Theme.muted) }
            Bar(value: goal > 0 ? min(1, v / goal) : 0, color: v > goal * 1.05 ? Theme.warn : Theme.gold)
        }
    }

    private func eatCard(_ s: BodyCalc.Status) -> some View {
        let d = store.diet(Day.today), t = s.target
        return Card(title: "Eat today") {
            meter("Calories", d.calories, t.calories, "kcal")
            meter("Protein", d.protein, t.protein, "g")
            meter("Carbs", d.carbs, t.carbs, "g")
            meter("Fat", d.fat, t.fat, "g")
            if let td = s.today, td.counted {
                Text("So far today: fat \(Self.sign(td.e.fat)) g, muscle \(Self.sign(td.e.muscle)) g").font(.caption.monospacedDigit())
            } else {
                Text(s.today?.logged == true ? "Log the rest of today to see its effect on fat and muscle." : "Log what you eat to see its effect on fat and muscle.")
                    .font(.caption).foregroundStyle(Theme.dim)
            }
        }
    }

    private func trainCard() -> some View {
        let session = Training.sessionOn(store)
        let done = Training.doneOn(store, Day.today) != nil
        return Card(title: "Train today", trailing: Self.days[Training.jsDay(Day.today)]) {
            if let session {
                Text(session.name).font(.headline)
                ForEach(session.items.indices, id: \.self) { i in
                    let it = session.items[i]
                    HStack { Text(Training.exName(it.ex)).font(.callout); Spacer(); Text("\(fmt(it.sets, 0)) × \(it.reps)").font(.callout.monospacedDigit()).foregroundStyle(Theme.muted) }
                }
            } else {
                Text("Rest day").font(.headline)
                Text("Walk, and do the mobility block.").font(.callout).foregroundStyle(Theme.muted)
            }
            Text(Training.mobility).font(.caption).foregroundStyle(Theme.dim)
            if session != nil {
                Button { Training.markDone(store); toast = done ? "" : "Session done" } label: {
                    Label(done ? "Done today (undo)" : "Mark session done", systemImage: "checkmark").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent).tint(done ? Theme.plate2 : Theme.gold)
            }
        }
    }

    private func musclesCard() -> some View {
        let sets = Training.setsThisWeek(store)
        let session = Training.sessionOn(store)
        let today = Set((session?.items ?? []).flatMap { Training.exMuscles($0.ex).main })
        return Card(title: "Muscles this week", trailing: "hard sets, aim 10+") {
            HStack(alignment: .top, spacing: 12) {
                MuscleFigure(side: "front", sets: sets, today: today, picked: $picked)
                MuscleFigure(side: "back", sets: sets, today: today, picked: $picked)
            }
            .frame(maxHeight: 420)
            HStack(spacing: 12) {
                ForEach(0..<4, id: \.self) { l in
                    HStack(spacing: 4) { RoundedRectangle(cornerRadius: 2).fill(Anatomy.color(l)).frame(width: 12, height: 12); Text(["0", "1-4", "5-9", "10+"][l]).font(.caption) }
                }
                if session != nil { HStack(spacing: 4) { RoundedRectangle(cornerRadius: 2).stroke(Theme.gold, lineWidth: 2).frame(width: 12, height: 12); Text("today").font(.caption) } }
            }
            .foregroundStyle(Theme.muted)
            if picked.isEmpty {
                Text("Tap a muscle to see its sets and today's exercises for it.").font(.callout).foregroundStyle(Theme.dim)
            } else {
                let n = BodyCalc.r1(sets[picked] ?? 0)
                let ex = (session?.items ?? []).filter { let m = Training.exMuscles($0.ex); return m.main.contains(picked) || m.side.contains(picked) }.map { Training.exName($0.ex) }
                Text("**\(Training.muscles[picked] ?? picked)**: \(fmt(n, 1)) hard set\(n == 1 ? "" : "s") this week\(n < 10 ? " (aim 10+)" : "").\(ex.isEmpty ? "" : " Today: \(ex.joined(separator: ", ")).")")
                    .font(.callout)
            }
        }
    }

    private func weekCard(_ s: BodyCalc.Status) -> some View {
        let wk = Training.week(store)
        let bal = Dictionary(s.weekList.map { ($0.date, $0) }, uniquingKeysWith: { a, _ in a })
        return Card(title: "This week", trailing: "burn ≈ \(fmt(s.profile.tdee, 0)) kcal a day") {
            HStack(alignment: .bottom) {
                ForEach(wk.indices, id: \.self) { i in
                    let x = wk[i]
                    let b = bal[x.day]
                    let mark: Color = x.done != nil ? Theme.ok : x.session != nil ? (x.day < Day.today ? Theme.red : Theme.gold) : Theme.plate2
                    VStack(spacing: 4) {
                        if let b, b.counted {
                            Rectangle().fill(b.e.balance >= 0 ? Theme.warn : Theme.ok).frame(width: 6, height: min(22, abs(b.e.balance) / 30))
                        }
                        Circle().fill(mark).frame(width: 9, height: 9)
                        Text(String(Self.days[Training.jsDay(x.day)].prefix(1))).font(.caption).foregroundStyle(x.day == Day.today ? Theme.gold : Theme.dim)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .frame(height: 50, alignment: .bottom)
            Text("Dots: green trained, gold planned, red missed. Bars: orange over, green under your burn.").font(.caption).foregroundStyle(Theme.dim)
            if let pr = s.projection {
                Text("If you keep eating like your last \(pr.from) full days (\(fmt(pr.kcal, 0)) kcal, \(fmt(pr.protein, 0)) g protein, \(Self.sign(pr.balance)) kcal a day):").font(.callout)
                HStack {
                    Stat(value: "\(fmt(pr.month.kg, 1)) kg", label: "In a month · fat \(Self.kgs(pr.month.fat)) · muscle \(Self.kgs(pr.month.muscle))")
                    Stat(value: "\(fmt(pr.quarter.kg, 1)) kg", label: "In 3 months · fat \(Self.kgs(pr.quarter.fat)) · muscle \(Self.kgs(pr.quarter.muscle))")
                }
            } else {
                Text("After three fully logged days, this shows where eating like that leads in a month and in three.").font(.callout).foregroundStyle(Theme.dim)
            }
        }
    }

    private func planCard(_ s: BodyCalc.Status) -> some View {
        let t = s.target
        let wk = Training.week(store)
        return Card(title: "Your plan") {
            Text("Food a day").font(.headline)
            HStack {
                Stat(value: fmt(t.calories, 0), label: "Calories")
                Stat(value: "\(fmt(t.protein, 0)) g", label: "Protein")
                Stat(value: "\(fmt(t.carbs, 0)) g", label: "Carbs")
                Stat(value: "\(fmt(t.fat, 0)) g", label: "Fat")
            }
            Text("\(t.mode == "cut" ? "About 450 kcal under your burn: fat comes off while the lifting and high protein keep the muscle." : "About 10% over your burn: enough to build muscle without much fat.") Protein spread over 3-4 meals; carbs around training; fish twice a week for omega-3.")
                .font(.caption).foregroundStyle(Theme.dim)
            Button { store.setSetting("dailyCalories", .number(t.calories)); store.setSetting("dailyProtein", .number(t.protein)); toast = "Diet goals: \(fmt(t.calories, 0)) kcal, \(fmt(t.protein, 0)) g protein" } label: {
                Label("Use as my diet goals", systemImage: "target")
            }.buttonStyle(.bordered)
            Text("Training").font(.headline)
            Picker("Days a week", selection: Binding(get: { Training.daysAWeek(store) }, set: { store.setSetting("trainDays", .number(Double($0))) })) {
                ForEach([3, 4, 5], id: \.self) { Text("\($0) days").tag($0) }
            }.pickerStyle(.segmented)
            ForEach(wk.indices, id: \.self) { i in
                let x = wk[i]
                HStack {
                    Text(Self.days[Training.jsDay(x.day)]).frame(width: 40, alignment: .leading).foregroundStyle(x.day == Day.today ? Theme.gold : Theme.muted)
                    Text(x.session?.name ?? "Rest and mobility").font(.callout)
                }
            }
            Text("Every muscle twice a week and 10+ hard sets; jumps, throws and sprints first while fresh; 10 minutes of mobility every day; sleep 7-9 hours. Add weight or a rep when the last set feels easy.")
                .font(.caption).foregroundStyle(Theme.dim)
            Button {
                ChatModel.shared.open = true
                ChatModel.shared.send(store, "Look at my body, goal, training plan and recent eating (body_status, diet_history). My goal is an athletic body: muscular, strong, fast and flexible. Check the plan against what I actually did this week and suggest plain adjustments for the next week: food (with foods easy to get in Kazakhstan) and training. Say what is an estimate.")
            } label: { Label("Adjust with Yaver", systemImage: "sparkles") }.buttonStyle(.bordered)
        }
    }

    private func weighCard() -> some View {
        let list = Array(store.weighins().suffix(6).reversed())
        return Card(title: "Weigh-ins", trailing: "\(store.count("weighins"))") {
            ForEach(list.indices, id: \.self) { i in
                let w = list[i]
                Button { weigh = WeighEdit(row: w) } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(Day.label(w.str("date")))
                            let extra = [w.num("waist") > 0 ? "waist \(fmt(w.num("waist"), 1)) cm" : "", w.num("fat") > 0 ? "\(fmt(w.num("fat"), 1))% fat" : ""].filter { !$0.isEmpty }
                            if !extra.isEmpty { Text(extra.joined(separator: " · ")).font(.caption).foregroundStyle(Theme.dim) }
                        }
                        Spacer()
                        Text("\(fmt(w.num("kg"), 1)) kg").monospacedDigit()
                        if i + 1 < list.count { Text(Self.kgs(w.num("kg") - list[i + 1].num("kg"))).font(.caption.monospacedDigit()).foregroundStyle(Theme.dim) }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }
}

struct WeighEdit: Identifiable { let id = UUID(); let row: Row? }

struct WeighForm: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    let existing: Row?
    @State private var kg = ""
    @State private var date = Date()
    @State private var waist = ""
    @State private var fat = ""

    var body: some View {
        NavigationStack {
            Form {
                TextField("Weight (kg)", text: $kg).numberKeyboard()
                DatePicker("Date", selection: $date, displayedComponents: .date)
                TextField("Waist at the navel, cm (optional, better body fat)", text: $waist).numberKeyboard()
                TextField("Body fat % if measured (optional)", text: $fat).numberKeyboard()
                if let existing {
                    Button("Delete", role: .destructive) { store.remove("weighins", existing.id); dismiss() }
                }
            }
            .navigationTitle(existing == nil ? "Log weight" : "Weigh-in")
            .sheetButtons(canSave: (number(kg) ?? 0) > 20) {
                let d = Day.key(date)
                if let existing, existing.str("date") != d { store.remove("weighins", existing.id) }
                BodyCalc.logWeight(store, kg: number(kg) ?? 0, date: d, waist: number(waist), fat: number(fat))
            }
        }
        .sheetSize()
        .onAppear {
            let src = existing ?? store.weighins().last
            if let src { kg = fmt(src.num("kg"), 1) }
            if let existing {
                date = Day.date(existing.str("date"))
                if existing.num("waist") > 0 { waist = fmt(existing.num("waist"), 1) }
                if existing.num("fat") > 0 { fat = fmt(existing.num("fat"), 1) }
            }
        }
    }
}

struct ProfileForm: View {
    @EnvironmentObject var store: Store
    @State private var height = ""
    @State private var kg = ""
    @State private var birth = ""
    @State private var sex = "m"
    @State private var activity = "moderate"
    @State private var days = 4
    @State private var experience = "new"

    var body: some View {
        NavigationStack {
            Form {
                Text("Only height and weight are needed; the rest makes the estimates closer.").font(.callout).foregroundStyle(Theme.dim)
                TextField("Height (cm)", text: $height).numberKeyboard()
                if store.weighins().isEmpty { TextField("Weight (kg)", text: $kg).numberKeyboard() }
                TextField("Year of birth (age 30 is assumed)", text: $birth).numberKeyboard()
                Picker("Sex (for the formulas)", selection: $sex) { Text("Male").tag("m"); Text("Female").tag("f") }
                Picker("Day to day, training included", selection: $activity) { ForEach(BodyCalc.activity, id: \.key) { Text($0.label).tag($0.key) } }
                Picker("Training days a week", selection: $days) { Text("3 (full body)").tag(3); Text("4 (upper / lower)").tag(4); Text("5 (upper / lower + speed)").tag(5) }
                Picker("Lifting experience", selection: $experience) { ForEach(BodyCalc.experience, id: \.key) { Text($0.label).tag($0.key) } }
            }
            .navigationTitle("Your body")
            .sheetButtons(canSave: (120...230).contains(number(height) ?? 0) && (!store.weighins().isEmpty || (number(kg) ?? 0) > 20)) {
                store.setSetting("bodyHeight", .number(number(height) ?? 0))
                if let b = number(birth), b > 1900 { store.setSetting("bodyBirth", .number(b)) }
                store.setSetting("bodySex", .string(sex))
                store.setSetting("bodyActivity", .string(activity))
                store.setSetting("trainDays", .number(Double(days)))
                store.setSetting("bodyExperience", .string(experience))
                if let k = number(kg), k > 20 { BodyCalc.logWeight(store, kg: k) }
            }
        }
        .sheetSize()
        .onAppear {
            if let h = store.setting("bodyHeight")?.double, h > 0 { height = fmt(h, 1) }
            if let b = store.setting("bodyBirth")?.double, b > 0 { birth = String(Int(b)) }
            sex = store.setting("bodySex")?.string ?? "m"
            activity = store.setting("bodyActivity")?.string ?? "moderate"
            days = Training.daysAWeek(store)
            experience = store.setting("bodyExperience")?.string ?? "new"
        }
    }
}
