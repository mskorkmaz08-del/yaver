// Diet: the food diary. Meals keep every field the web app stores (items, vitamins,
// sources…); this screen shows the totals and lets you add, edit and delete meals.
// Photo and typed estimates with Gemini stay in the web app for now; they sync here.
import SwiftUI

struct DietView: View {
    @EnvironmentObject var store: Store
    @State private var day = Day.today
    @State private var editing: Row?
    @State private var adding = false

    var body: some View {
        let _ = store.revision
        let d = store.diet(day)
        Screen(title: "Diet") {
            DayPicker(day: $day)
            Card(title: "Totals") {
                HStack(alignment: .top) {
                    Stat(value: fmt(d.calories), label: "of \(fmt(store.calorieGoal)) kcal")
                    Stat(value: "\(fmt(d.protein)) g", label: "of \(fmt(store.proteinGoal)) g protein")
                }
                Bar(value: d.calories / max(1, store.calorieGoal))
                HStack(alignment: .top) {
                    Stat(value: "\(fmt(d.carbs)) g", label: "carbs")
                    Stat(value: "\(fmt(d.fat)) g", label: "fat")
                    Stat(value: "\(fmt(d.fiber)) g", label: "fiber")
                }
            }

            Card(title: "Meals", trailing: "\(d.meals.count)") {
                if d.meals.isEmpty { Text("Nothing logged on this day.").foregroundStyle(Theme.dim) }
                ForEach(d.meals, id: \.id) { m in
                    Button { editing = m } label: {
                        HStack(alignment: .firstTextBaseline) {
                            Text(store.mealTime(m) ?? "--:--").font(.callout.monospacedDigit()).foregroundStyle(Theme.dim)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(m.str("name")).foregroundStyle(Theme.text).multilineTextAlignment(.leading)
                                Text("\(m.str("meal")) · \(fmt(m.num("protein"))) g protein").font(.caption).foregroundStyle(Theme.dim)
                            }
                            Spacer()
                            Text("\(fmt(m.num("calories"))) kcal").font(.callout.monospacedDigit()).foregroundStyle(Theme.muted)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }

            let micros = d.micros
            if !micros.isEmpty {
                Card(title: "Vitamins and minerals", trailing: "from detailed meals") {
                    ForEach(micros.keys.sorted(), id: \.self) { k in
                        HStack {
                            Text(k).foregroundStyle(Theme.muted)
                            Spacer()
                            Text(fmt(micros[k] ?? 0, 1)).font(.callout.monospacedDigit())
                        }
                    }
                }
            }

            Card(title: "How did you feel?") {
                let feel = store.feeling(day)?.str("feel") ?? ""
                HStack {
                    ForEach(["good", "ok", "bad"], id: \.self) { k in
                        let label = k == "ok" ? "OK" : k.capitalized
                        if feel == k {
                            Button(label) { store.setFeeling(day, k) }.buttonStyle(.borderedProminent)
                        } else {
                            Button(label) { store.setFeeling(day, k) }.buttonStyle(.bordered)
                        }
                    }
                }
            }

            Card(title: "Last 7 days") {
                let days = (0..<7).map { Day.add(day, -$0) }
                let logged = days.map { store.diet($0) }.filter { !$0.meals.isEmpty }
                if logged.isEmpty {
                    Text("No meals in the last 7 days.").foregroundStyle(Theme.dim)
                } else {
                    HStack(alignment: .top) {
                        Stat(value: fmt(logged.reduce(0) { $0 + $1.calories } / Double(logged.count)), label: "kcal a day")
                        Stat(value: "\(fmt(logged.reduce(0) { $0 + $1.protein } / Double(logged.count))) g", label: "protein a day")
                        Stat(value: "\(logged.count)/7", label: "days logged")
                    }
                }
            }
        }
        .toolbar { Button { adding = true } label: { Label("Add meal", systemImage: "plus") } }
        .sheet(isPresented: $adding) { NavigationStack { MealForm(day: day, meal: nil) }.sheetSize() }
        .sheet(item: Binding(get: { editing.map(RowBox.init) }, set: { editing = $0?.row })) { box in
            NavigationStack { MealForm(day: day, meal: box.row) }.sheetSize()
        }
    }
}

/// Lets a record drive .sheet(item:).
struct RowBox: Identifiable {
    let row: Row
    var id: String { row.id }
}

struct MealForm: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    let day: String
    let meal: Row?
    @State private var name = ""
    @State private var type = Meals.guess()
    @State private var time = Day.hm()
    @State private var kcal = ""
    @State private var protein = ""
    @State private var carbs = ""
    @State private var fat = ""

    var body: some View {
        Form {
            TextField("What did you eat?", text: $name)
            Picker("Meal", selection: $type) { ForEach(Meals.types, id: \.self) { Text($0) } }
            TextField("Time (HH:MM)", text: $time)
            TextField("Calories (kcal)", text: $kcal).numberKeyboard()
            TextField("Protein (g)", text: $protein).numberKeyboard()
            TextField("Carbs (g)", text: $carbs).numberKeyboard()
            TextField("Fat (g)", text: $fat).numberKeyboard()
            if meal != nil {
                Button("Delete meal", role: .destructive) {
                    if let m = meal { store.remove("meals", m.id) }
                    dismiss()
                }
            }
        }
        .navigationTitle(meal == nil ? "Add meal" : "Edit meal")
        .onAppear {
            guard let m = meal else { return }
            name = m.str("name"); type = m.str("meal").isEmpty ? "Snack" : m.str("meal"); time = store.mealTime(m) ?? ""
            kcal = plain(m.num("calories")); protein = plain(m.num("protein")); carbs = plain(m.num("carbs")); fat = plain(m.num("fat"))
        }
        .sheetButtons(canSave: !name.trimmingCharacters(in: .whitespaces).isEmpty) { save() }
    }

    private func save() {
        var row = meal ?? ["date": .string(day)]
        row["name"] = .string(name.trimmingCharacters(in: .whitespaces))
        row["meal"] = .string(type)
        let t = time.trimmingCharacters(in: .whitespaces)
        if t.range(of: #"^([01]\d|2[0-3]):[0-5]\d$"#, options: .regularExpression) != nil { row["time"] = .string(t) }
        let n = { (s: String) in number(s) ?? 0 }
        row["calories"] = .number(n(kcal)); row["protein"] = .number(n(protein)); row["carbs"] = .number(n(carbs)); row["fat"] = .number(n(fat))
        store.put("meals", row)
    }
}
