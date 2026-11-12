// Apple Calendar, read only (native twin of js/applecal.js). The web app gets these
// through the Mac bridge; the native app reads them straight from EventKit on each
// device (the iPhone's and the Mac's calendars) into the device-only 'applecal'
// store, in the same shape, so Meet, free slots, Home and the assistant see them.
import Foundation
import EventKit

@MainActor
enum AppleCalendar {
    static let past = 14.0, ahead = 90.0
    private static let ek = EKEventStore()

    static var authorized: Bool {
        let st = EKEventStore.authorizationStatus(for: .event)
        if #available(iOS 17.0, macOS 14.0, *) { return st == .fullAccess || st == .authorized }
        return st == .authorized
    }
    static func enabled(_ s: Store) -> Bool { s.setting("appleCal")?.bool ?? false }

    /// Asks once, then copies events from 14 days back to 90 ahead. Returns how many.
    @discardableResult
    static func sync(_ s: Store, ask: Bool = false) async -> Int? {
        if !authorized {
            guard ask else { return nil }
            var ok = false
            if #available(iOS 17.0, macOS 14.0, *) { ok = (try? await ek.requestFullAccessToEvents()) ?? false }
            else { ok = await withCheckedContinuation { c in ek.requestAccess(to: .event) { g, _ in c.resume(returning: g) } } }
            if !ok {
                s.setSetting("appleCalStatus", .object(["ok": false, "error": "Calendar access is off. Allow Yaver in Settings → Privacy → Calendars.", "at": .string(Store.isoNow())]))
                return nil
            }
            s.setSetting("appleCal", true)
        }
        let from = Date().addingTimeInterval(-past * 86400), to = Date().addingTimeInterval(ahead * 86400)
        let pred = ek.predicateForEvents(withStart: from, end: to, calendars: nil)
        let rows: [Row] = ek.events(matching: pred).map { e in
            let uid = e.calendarItemExternalIdentifier ?? e.eventIdentifier ?? "\(e.title ?? "")@\(e.startDate.timeIntervalSince1970)"
            let occ = e.hasRecurrenceRules ? "#\(Int(e.startDate.timeIntervalSince1970))" : ""
            return ["id": .string("apple:\(uid)\(occ)"), "source": "apple", "title": .string(e.title ?? "(No title)"),
                    "start": .string(Store.isoString(e.startDate)), "end": .string(Store.isoString(e.endDate ?? e.startDate)),
                    "allDay": .bool(e.isAllDay), "location": .string(e.location ?? ""), "notes": .string(e.notes ?? ""),
                    "calendar": .string(e.calendar?.title ?? ""), "color": ""]
        }
        s.replaceLocal("applecal", rows)
        s.setSetting("appleCalStatus", .object(["ok": true, "count": .number(Double(rows.count)), "at": .string(Store.isoNow())]))
        return rows.count
    }
}
