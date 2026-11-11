// Money: this month's spending by category, the budget, and every expense.
import SwiftUI

struct MoneyView: View {
    @EnvironmentObject var store: Store
    @State private var month = Day.month()
    @State private var editing: Row?
    @State private var adding = false

    var body: some View {
        let _ = store.revision
        let list = store.expenses(month: month).sorted { ($0.str("date") + $0.str("createdAt")) > ($1.str("date") + $1.str("createdAt")) }
        let total = list.reduce(0) { $0 + $1.num("amount") }
        let budget = store.monthlyBudget
        let cats = list.reduce(into: [String: Double]()) { $0[$1.str("category"), default: 0] += $1.num("amount") }

        Screen(title: "Money") {
            HStack {
                Button { month = shift(-1) } label: { Image(systemName: "chevron.left") }
                Spacer()
                Text(monthLabel).font(.headline)
                Spacer()
                Button { month = shift(1) } label: { Image(systemName: "chevron.right") }.disabled(month >= Day.month())
            }
            .buttonStyle(.borderless)

            Card(title: "This month") {
                HStack(alignment: .top) {
                    Stat(value: store.money(total), label: "spent")
                    if budget > 0 { Stat(value: store.money(budget - total), label: "left of \(store.money(budget))", color: total > budget ? Theme.red : Theme.text) }
                }
                if budget > 0 { Bar(value: total / budget, color: total > budget ? Theme.red : Theme.gold) }
                ForEach(cats.sorted { $0.value > $1.value }, id: \.key) { c in
                    HStack {
                        Text(c.key.isEmpty ? "Other" : c.key).foregroundStyle(Theme.muted)
                        Spacer()
                        Text(store.money(c.value)).font(.callout.monospacedDigit())
                    }
                }
            }

            Card(title: "Expenses", trailing: "\(list.count)") {
                if list.isEmpty { Text("No expenses this month.").foregroundStyle(Theme.dim) }
                ForEach(list, id: \.id) { e in
                    Button { editing = e } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(e.str("note").isEmpty ? e.str("category") : e.str("note")).foregroundStyle(Theme.text)
                                Text("\(Day.label(e.str("date"))) · \(e.str("category"))").font(.caption).foregroundStyle(Theme.dim)
                            }
                            Spacer()
                            Text(store.money(e.num("amount"))).font(.callout.monospacedDigit()).foregroundStyle(Theme.muted)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .toolbar { Button { adding = true } label: { Label("Add expense", systemImage: "plus") } }
        .sheet(isPresented: $adding) { NavigationStack { ExpenseForm(expense: nil) }.sheetSize() }
        .sheet(item: Binding(get: { editing.map(RowBox.init) }, set: { editing = $0?.row })) { box in
            NavigationStack { ExpenseForm(expense: box.row) }.sheetSize()
        }
    }

    private func shift(_ n: Int) -> String { Day.month(Day.key(Day.cal.date(byAdding: .month, value: n, to: Day.date(month + "-01")) ?? Date())) }
    private var monthLabel: String {
        let f = DateFormatter()
        f.dateFormat = "LLLL yyyy"
        return f.string(from: Day.date(month + "-01"))
    }
}

struct ExpenseForm: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    let expense: Row?
    @State private var amount = ""
    @State private var category = "Food"
    @State private var note = ""
    @State private var date = Date()

    var body: some View {
        Form {
            TextField("Amount (\(store.currency))", text: $amount).numberKeyboard()
            Picker("Category", selection: $category) { ForEach(Money.categories, id: \.self) { Text($0) } }
            TextField("Note", text: $note)
            DatePicker("Date", selection: $date, displayedComponents: .date)
            if expense != nil {
                Button("Delete expense", role: .destructive) {
                    if let e = expense { store.remove("expenses", e.id) }
                    dismiss()
                }
            }
        }
        .navigationTitle(expense == nil ? "Add expense" : "Edit expense")
        .onAppear {
            guard let e = expense else { return }
            amount = plain(e.num("amount")); category = e.str("category"); note = e.str("note"); date = Day.date(e.str("date"))
        }
        .sheetButtons(canSave: (number(amount) ?? 0) != 0) {
            var row = expense ?? [:]
            row["amount"] = .number(number(amount) ?? 0)
            row["category"] = .string(Money.categories.contains(category) ? category : "Other")
            row["note"] = .string(note)
            row["date"] = .string(Day.key(date))
            store.put("expenses", row)
        }
    }
}
