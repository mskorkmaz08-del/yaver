// Meet (twin of js/views/calendar.js): two weeks of days, the selected day's
// meetings with Apple Calendar events beside them (read only), free slots,
// add or edit a meeting, and "Plan my week" with Yaver.
import SwiftUI

struct EventEdit: Identifiable { let id = UUID(); let row: Row?; var start: Date? = nil }

struct MeetView: View {
    @EnvironmentObject var store: Store
    @State private var selected = Day.today
    @State private var start = Day.weekStart()
    @State private var edit: EventEdit?
    @State private var appleEvent: Row?
    @State private var syncing = false

    var body: some View {
        let _ = store.revision
        let days = (0..<14).map { Day.add(start, $0) }
        let events = Tools.eventsOn(store, selected)
        let free = Tools.freeSlots(store, selected)
        Screen(title: "Meet") {
            HStack {
                Text(Day.date(selected).formatted(.dateTime.month(.wide).year())).font(.title2.weight(.semibold))
                Spacer()
                NavigationLink { TeamsView() } label: { Image(systemName: "person.2") }.buttonStyle(.bordered)
                Button { edit = EventEdit(row: nil) } label: { Label("Meeting", systemImage: "plus") }.buttonStyle(.borderedProminent)
            }
            HStack(spacing: 4) {
                Button { start = Day.add(start, -7); selected = Day.add(selected, -7) } label: { Image(systemName: "chevron.left") }.buttonStyle(.plain)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(days, id: \.self) { k in dayButton(k) }
                    }
                }
                Button { start = Day.add(start, 7); selected = Day.add(selected, 7) } label: { Image(systemName: "chevron.right") }.buttonStyle(.plain)
            }
            Text(Day.date(selected).formatted(.dateTime.weekday(.wide).day().month(.wide))).font(.caption.weight(.semibold)).foregroundStyle(Theme.dim)
            if events.isEmpty {
                Card { Text("Nothing scheduled. Try asking Yaver: “meeting with Ali tomorrow at 15:00”.").foregroundStyle(Theme.dim) }
            }
            ForEach(events, id: \.id) { e in eventRow(e) }
            if !free.isEmpty {
                Card(title: "Free slots") {
                    FlowChips(items: free) { f in
                        let hm = String(f.prefix(5))
                        let d = Day.cal.date(bySettingHour: Course.toMin(hm) / 60, minute: Course.toMin(hm) % 60, second: 0, of: Day.date(selected))
                        edit = EventEdit(row: nil, start: d)
                    }
                }
            }
            appleCard
            HStack {
                Button { ChatModel.shared.open = true; ChatModel.shared.send(store, "Look at my meetings for the next 7 days and my study goal. Flag clashes and busy days, and propose concrete study blocks in my free slots.") } label: {
                    Label("Plan my week", systemImage: "sparkles")
                }.buttonStyle(.bordered)
            }
        }
        .sheet(item: $edit) { e in MeetingForm(existing: e.row, day: selected, presetStart: e.start).environmentObject(store) }
        .alert(appleEvent?.str("title") ?? "", isPresented: Binding(get: { appleEvent != nil }, set: { if !$0 { appleEvent = nil } })) {
            Button("OK") { appleEvent = nil }
        } message: {
            Text(appleDetail(appleEvent))
        }
        .task { if AppleCalendar.enabled(store) { await AppleCalendar.sync(store) } }
    }

    private func dayButton(_ k: String) -> some View {
        let d = Day.date(k)
        let n = Tools.eventsOn(store, k).count
        return Button { selected = k } label: {
            VStack(spacing: 2) {
                Text(d.formatted(.dateTime.weekday(.abbreviated))).font(.caption2)
                Text(d.formatted(.dateTime.day())).font(.headline.monospacedDigit())
                Circle().fill(n > 0 ? Theme.gold : .clear).frame(width: 5, height: 5)
            }
            .frame(width: 42, height: 58)
            .foregroundStyle(k == selected ? Theme.bg : k == Day.today ? Theme.gold : Theme.text)
            .background(k == selected ? Theme.gold : Theme.plate, in: RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
    }

    private func eventRow(_ e: Row) -> some View {
        let apple = e.str("source") == "apple"
        let s = Store.parseISO(e.str("start")), en = Store.parseISO(e.str("end"))
        return Button { if apple { appleEvent = e } else { edit = EventEdit(row: e) } } label: {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading) {
                    if e.flag("allDay") { Text("all day").font(.callout) } else {
                        Text(s.map { Day.hm($0) } ?? "").font(.callout.monospacedDigit())
                        Text(en.map { Day.hm($0) } ?? "").font(.caption.monospacedDigit()).foregroundStyle(Theme.dim)
                    }
                }
                .frame(width: 52, alignment: .leading)
                Rectangle().fill(apple ? Theme.steel : Theme.gold).frame(width: 3)
                VStack(alignment: .leading, spacing: 2) {
                    Text(e.str("title")).font(.headline)
                    if !e.str("location").isEmpty { Text(e.str("location")).font(.caption).foregroundStyle(Theme.muted) }
                    if !apple && !e.str("notes").isEmpty { Text(e.str("notes")).font(.caption).foregroundStyle(Theme.dim).lineLimit(2) }
                    if apple { Text("Apple Calendar\(e.str("calendar").isEmpty ? "" : " · " + e.str("calendar"))").font(.caption2).foregroundStyle(Theme.steel) }
                }
                Spacer()
            }
            .padding(12)
            .background(Theme.plate, in: RoundedRectangle(cornerRadius: 12))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func appleDetail(_ e: Row?) -> String {
        guard let e, let s = Store.parseISO(e.str("start")) else { return "" }
        let en = Store.parseISO(e.str("end")) ?? s
        var t = e.flag("allDay") ? "All day · \(Day.label(Day.key(s)))" : "\(Day.label(Day.key(s))) · \(Day.hm(s))–\(Day.hm(en))"
        if !e.str("location").isEmpty { t += "\n\(e.str("location"))" }
        if !e.str("notes").isEmpty { t += "\n\(e.str("notes"))" }
        return t + "\n\nFrom Apple Calendar\(e.str("calendar").isEmpty ? "" : " · " + e.str("calendar")). Read only here: change it in the Calendar app."
    }

    private var appleCard: some View {
        let st = store.setting("appleCalStatus")
        let on = AppleCalendar.enabled(store)
        let line: String = !on ? "Show your Apple Calendar events here (read only). Yaver asks once."
            : st?["ok"]?.bool == true ? "Apple Calendar · \(Int(st?["count"]?.double ?? 0)) events · synced \(Store.parseISO(st?["at"]?.string ?? "").map { Day.hm($0) } ?? "")"
            : st?["error"]?.string ?? "Apple Calendar · not synced yet"
        return HStack {
            Text(line).font(.caption).foregroundStyle(Theme.dim)
            Spacer()
            Button(syncing ? "Syncing…" : on ? "Sync" : "Show Apple Calendar") {
                syncing = true
                Task { await AppleCalendar.sync(store, ask: true); syncing = false }
            }
            .buttonStyle(.bordered).controlSize(.small).disabled(syncing)
        }
    }
}

/// Wrapping row of tappable chips.
struct FlowChips: View {
    let items: [String]
    let tap: (String) -> Void
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: 8)], alignment: .leading, spacing: 8) {
            ForEach(items, id: \.self) { i in
                Button(i) { tap(i) }.buttonStyle(.bordered).font(.caption.monospacedDigit())
            }
        }
    }
}

struct MeetingForm: View {
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    let existing: Row?
    let day: String
    var presetStart: Date?
    @State private var title = ""
    @State private var start = Date()
    @State private var end = Date()
    @State private var location = ""
    @State private var remind = 15.0
    @State private var notes = ""

    var body: some View {
        NavigationStack {
            Form {
                TextField("Title (Meeting with…)", text: $title)
                DatePicker("Starts", selection: $start)
                DatePicker("Ends", selection: $end, in: start...)
                TextField("Location / link", text: $location)
                Picker("Remind me", selection: $remind) {
                    Text("No reminder").tag(0.0); Text("5 min before").tag(5.0); Text("15 min before").tag(15.0)
                    Text("30 min before").tag(30.0); Text("1 hour before").tag(60.0); Text("1 day before").tag(1440.0)
                }
                TextField("Notes", text: $notes, axis: .vertical).lineLimit(2...6)
                if let existing {
                    Button("Delete", role: .destructive) { store.remove("events", existing.id); dismiss() }
                }
            }
            .navigationTitle(existing == nil ? "New meeting" : "Meeting")
            .sheetButtons(canSave: !title.trimmingCharacters(in: .whitespaces).isEmpty) {
                var row = existing ?? [:]
                row["title"] = .string(title.trimmingCharacters(in: .whitespaces))
                row["start"] = .string(Store.isoString(start))
                row["end"] = .string(Store.isoString(max(end, start)))
                row["location"] = .string(location); row["notes"] = .string(notes); row["remind"] = .number(remind)
                store.put("events", row)
                Task { await Notifications.requestIfNeeded(); await Notifications.reschedule(store) }
            }
        }
        .sheetSize()
        .onAppear {
            if let e = existing {
                title = e.str("title"); location = e.str("location"); notes = e.str("notes"); remind = e["remind"]?.double ?? 15
                start = Store.parseISO(e.str("start")) ?? Date(); end = Store.parseISO(e.str("end")) ?? start.addingTimeInterval(3600)
            } else {
                if let presetStart { start = presetStart }
                else if day == Day.today {
                    let next = Date().addingTimeInterval(3600)
                    start = Day.cal.date(bySetting: .minute, value: 0, of: next) ?? next
                } else { start = Day.cal.date(bySettingHour: 9, minute: 0, second: 0, of: Day.date(day)) ?? Date() }
                end = start.addingTimeInterval(3600)
            }
        }
    }
}
