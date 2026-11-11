// Teams: the dev team and the students, when each was last met, who is overdue,
// and a log of activities (what, where, when, who).
import SwiftUI

struct TeamsView: View {
    @EnvironmentObject var store: Store
    @State private var addingPerson = false
    @State private var logging = false

    var body: some View {
        let _ = store.revision
        Screen(title: "Teams") {
            ForEach(Store.teams, id: \.self) { team in
                let people = store.people(team)
                Card(title: Store.teamName(team), trailing: "\(people.count)") {
                    if people.isEmpty { Text("Nobody yet.").foregroundStyle(Theme.dim) }
                    ForEach(people, id: \.id) { p in
                        let s = store.status(p)
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(p.str("name"))
                                if !p.str("role").isEmpty { Text(p.str("role")).font(.caption).foregroundStyle(Theme.dim) }
                            }
                            Spacer()
                            Text(s.days.map { $0 == 0 ? "met today" : $0 == 1 ? "met yesterday" : "met \($0) days ago" } ?? "never met")
                                .font(.callout).foregroundStyle(s.overdue ? Theme.warn : Theme.muted)
                        }
                    }
                }
            }

            let acts = store.activities().prefix(20)
            Card(title: "Recent activities") {
                if acts.isEmpty { Text("No activities yet.").foregroundStyle(Theme.dim) }
                ForEach(Array(acts), id: \.id) { a in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(a.str("title"))
                        let who = (a["people"]?.array ?? []).compactMap { $0.string }.compactMap { store.get("people", $0)?.str("name") }.joined(separator: ", ")
                        let when = Store.parseISO(a.str("date")).map { Day.label(Day.key($0)) } ?? ""
                        Text([when, a.str("place"), who].filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption).foregroundStyle(Theme.dim)
                    }
                }
            }
        }
        .toolbar {
            Button { addingPerson = true } label: { Label("Add person", systemImage: "person.badge.plus") }
            Button { logging = true } label: { Label("Log activity", systemImage: "plus") }
        }
        .sheet(isPresented: $addingPerson) { NavigationStack { PersonForm() }.sheetSize() }
        .sheet(isPresented: $logging) { NavigationStack { ActivityForm() }.sheetSize() }
    }
}

struct PersonForm: View {
    @EnvironmentObject var store: Store
    @State private var name = ""
    @State private var team = "student"
    @State private var role = ""
    @State private var every = 14

    var body: some View {
        Form {
            TextField("Name", text: $name)
            Picker("Team", selection: $team) { ForEach(Store.teams, id: \.self) { Text(Store.teamName($0)).tag($0) } }
            TextField("Role (optional)", text: $role)
            Picker("Meet", selection: $every) {
                Text("No target").tag(0)
                Text("Every week").tag(7)
                Text("Every 2 weeks").tag(14)
                Text("Every month").tag(30)
            }
        }
        .navigationTitle("Add person")
        .sheetButtons(canSave: !name.trimmingCharacters(in: .whitespaces).isEmpty) {
            store.put("people", ["name": .string(name.trimmingCharacters(in: .whitespaces)), "team": .string(team), "role": .string(role),
                                 "contact": "", "notes": "", "meetEvery": .number(Double(every))])
        }
    }
}

struct ActivityForm: View {
    @EnvironmentObject var store: Store
    @State private var title = ""
    @State private var kind = "meeting"
    @State private var team = "student"
    @State private var date = Date()
    @State private var place = ""
    @State private var who: Set<String> = []

    var body: some View {
        Form {
            TextField("What", text: $title)
            Picker("Kind", selection: $kind) {
                Text("Meeting").tag("meeting")
                Text("Activity").tag("activity")
                Text("Event").tag("event")
            }
            Picker("Team", selection: $team) {
                Text("Students").tag("student")
                Text("Dev team").tag("dev")
                Text("Both").tag("both")
            }
            DatePicker("When", selection: $date)
            TextField("Where", text: $place)
            SwiftUI.Section("Who") {
                ForEach(store.people(), id: \.id) { p in
                    Toggle(p.str("name"), isOn: Binding(get: { who.contains(p.id) }, set: { on in if on { who.insert(p.id) } else { who.remove(p.id) } }))
                }
            }
        }
        .navigationTitle("Log activity")
        .sheetButtons(canSave: !title.trimmingCharacters(in: .whitespaces).isEmpty) {
            store.put("activities", ["title": .string(title.trimmingCharacters(in: .whitespaces)), "kind": .string(kind), "team": .string(team),
                                     "date": .string(Store.isoString(date)), "place": .string(place), "people": .array(who.sorted().map { .string($0) }), "notes": ""])
        }
    }
}
