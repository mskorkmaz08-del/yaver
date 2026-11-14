// Çetele: the daily minimums. Any day can be filled in; items can be added and removed
// (removed items are archived, so their history stays, same as the web app).
import SwiftUI

struct CeteleView: View {
    @EnvironmentObject var store: Store
    @State private var day = Day.today
    @State private var adding = false

    var body: some View {
        let _ = store.revision
        let rows = store.cetele(day)
        Screen(title: "Çetele") {
            DayPicker(day: $day)
            Card(title: "Daily", trailing: "\(store.ceteleStreak()) day streak") {
                ForEach(rows.filter { !$0.weekly }) { row in
                    CeteleLine(row: row, day: day).contextMenu { removeButton(row) }
                }
            }
            let weekly = rows.filter(\.weekly)
            if !weekly.isEmpty {
                Card(title: "This week") {
                    ForEach(weekly) { row in CeteleLine(row: row, day: day).contextMenu { removeButton(row) } }
                }
            }
            let removed = store.all("ceteleItems").filter { $0.flag("archived") }
            if !removed.isEmpty {
                Card(title: "Removed") {
                    ForEach(removed, id: \.id) { item in
                        HStack {
                            Text(item.str("name")).foregroundStyle(Theme.muted)
                            Spacer()
                            Button("Bring back") {
                                var r = item
                                r["archived"] = false
                                r["order"] = .number(Double(store.ceteleItems().count))
                                store.put("ceteleItems", r)
                            }
                            .buttonStyle(.bordered).controlSize(.small)
                        }
                    }
                }
            }
            Text("Long-press (or right-click) an item to remove it. Its history is kept.").font(.caption).foregroundStyle(Theme.dim)
        }
        .toolbar { Button { adding = true } label: { Label("Add item", systemImage: "plus") } }
        .sheet(isPresented: $adding) { NavigationStack { CeteleItemForm() }.sheetSize() }
    }

    private func removeButton(_ row: CeteleRow) -> some View {
        Button(role: .destructive) {
            var r = row.item
            r["archived"] = true
            store.put("ceteleItems", r)
        } label: { Label("Remove \(row.name)", systemImage: "trash") }
    }
}

struct CeteleItemForm: View {
    @EnvironmentObject var store: Store
    @State private var name = ""
    @State private var unit = ""
    @State private var target = "1"
    @State private var step = "1"
    @State private var weekly = false

    var body: some View {
        Form {
            TextField("Name (e.g. Kitap)", text: $name)
            TextField("Unit (pages, times; empty for a tick)", text: $unit)
            TextField("Target", text: $target).numberKeyboard()
            TextField("Step for the + button", text: $step).numberKeyboard()
            Toggle("Weekly target (not daily)", isOn: $weekly)
        }
        .navigationTitle("New Çetele item")
        .sheetButtons(canSave: !name.trimmingCharacters(in: .whitespaces).isEmpty) {
            put()
        }
    }

    private func put() {
        let clean = name.trimmingCharacters(in: .whitespaces)
        // Adding a removed name brings it back with its history.
        var row: Row = store.all("ceteleItems").first { $0.flag("archived") && $0.str("name").lowercased() == clean.lowercased() } ?? [:]
        row["name"] = .string(clean)
        row["unit"] = .string(unit.trimmingCharacters(in: .whitespaces))
        row["target"] = .number(max(1, number(target) ?? 1))
        row["step"] = .number(max(1, number(step) ?? 1))
        row["per"] = .string(weekly ? "week" : "day")
        row["archived"] = false
        row["order"] = .number(Double(store.ceteleItems().count))
        store.put("ceteleItems", row)
    }
}
