// Body: weigh-ins over time. The muscle map, plan and projections stay in the web app for now.
import SwiftUI

struct BodyView: View {
    @EnvironmentObject var store: Store
    @State private var kg = ""

    var body: some View {
        let _ = store.revision
        let list = store.weighins()
        let height = store.setting("bodyHeight")?.double ?? 0
        Screen(title: "Body") {
            Card(title: "Weight") {
                if let last = list.last {
                    HStack(alignment: .top) {
                        Stat(value: "\(fmt(last.num("kg"), 1)) kg", label: Day.label(last.str("date")))
                        if height > 0 {
                            let bmi = last.num("kg") / pow(height / 100, 2)
                            Stat(value: fmt(bmi, 1), label: "BMI")
                        }
                        if list.count > 1, let first = list.first(where: { $0.str("date") >= Day.add(Day.today, -30) }) ?? list.first {
                            let d = last.num("kg") - first.num("kg")
                            Stat(value: "\(d >= 0 ? "+" : "")\(fmt(d, 1)) kg", label: "since \(Day.label(first.str("date")))")
                        }
                    }
                } else {
                    Text("No weigh-ins yet.").foregroundStyle(Theme.dim)
                }
                HStack {
                    TextField("Today's weight (kg)", text: $kg).numberKeyboard().textFieldStyle(.roundedBorder)
                    Button("Log") {
                        if let v = number(kg), v > 25, v < 350 { store.logWeight(v); kg = "" }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!((number(kg) ?? 0) > 25 && (number(kg) ?? 0) < 350))
                }
            }
            Card(title: "History", trailing: "\(list.count)") {
                ForEach(list.reversed(), id: \.id) { w in
                    HStack {
                        Text(Day.label(w.str("date"))).foregroundStyle(Theme.muted)
                        Spacer()
                        Text("\(fmt(w.num("kg"), 1)) kg").font(.callout.monospacedDigit())
                    }
                    .contextMenu {
                        Button(role: .destructive) { store.remove("weighins", w.id) } label: { Label("Delete", systemImage: "trash") }
                    }
                }
            }
        }
    }
}
