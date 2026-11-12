// Command-line checks for the native core (store, merge, encryption, sync code),
// built with swiftc on the Mac build server together with native/Yaver/Core.
// Usage: coretests <fixture-from-web.json> <out-for-web.json>
import Foundation

var failures = 0
func check(_ ok: Bool, _ what: String) {
    print(ok ? "ok   \(what)" : "FAIL \(what)")
    if !ok { failures += 1 }
}

let args = CommandLine.arguments
let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("yaver-coretests-\(UUID().uuidString)")
let store = Store(directory: tmp)

// 1. Store basics: stamps, tombstones, merge rules.
let a = store.put("meals", ["name": "Test", "calories": 100, "date": "2026-11-10"])
check(!a.id.isEmpty && a.str("updatedAt").hasSuffix("Z") && a.str("updatedAt").count == 24, "put stamps id and ISO updatedAt with milliseconds")
store.remove("meals", a.id)
check(store.get("meals", a.id) == nil && store.get("tombstones", "meals/\(a.id)") != nil, "remove leaves a tombstone")
let older: Row = ["id": .string(a.id), "name": "Old", "updatedAt": "2000-01-01T00:00:00.000Z"]
check(store.merge(["meals": [older]]) == 0, "tombstone beats an older record")
store.put("meals", ["id": "keep", "name": "Mine", "date": "2026-11-10"])
check(store.merge(["meals": [["id": "keep", "name": "Older", "updatedAt": "2001-01-01T00:00:00.000Z"]]]) == 0 && store.get("meals", "keep")?.str("name") == "Mine", "newer local record wins")
check(store.merge(["meals": [["id": "keep", "name": "Newer", "updatedAt": "2999-01-01T00:00:00.000Z"]]]) == 1 && store.get("meals", "keep")?.str("name") == "Newer", "newer remote record wins")
store.remove("meals", "keep")
check(!store.syncPayload()["kv"]!.contains { $0.id == "deviceId" }, "deviceId stays on the device")

// 2. Dates: Monday week start.
check(Day.weekStart("2026-11-11") == "2026-11-09" && Day.weekStart("2026-11-09") == "2026-11-09" && Day.weekStart("2026-11-15") == "2026-11-09", "weeks start on Monday")
check(Day.add("2026-12-31", 1) == "2027-01-01", "day keys roll over years")

// 3. gzip and the sync code.
let sample = Data(String(repeating: "Çetele yaver ", count: 500).utf8)
check((try? Gzip.decompress(Gzip.compress(sample))) == sample, "gzip round trip")
check(Gzip.crc32(Data("123456789".utf8)) == 0xCBF43926, "crc32 check value")
let codeJSON = try! JSON.object(["t": "ghp_abcdefghijklmnop", "p": "pass-pass-pass", "g": "abc123"]).encoded()
let code = "yaversync1." + codeJSON.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
let parsed = Sync.parseCode("here: \(code) ")
check(parsed?.token == "ghp_abcdefghijklmnop" && parsed?.pass == "pass-pass-pass" && parsed?.gistId == "abc123", "sync code parses")

// 4. Interop with the web app's encryption (js/crypto.js via tests/native-interop.mjs).
if args.count >= 3 {
    let fixture = try! JSON.decode(Data(contentsOf: URL(fileURLWithPath: args[1])))
    let pass = fixture["pass"]!.string!
    let remote = try! SyncCrypto.decrypt(fixture["text"]!.string!, pass: pass)
    check(remote["deviceName"]?.string == "iPhone", "decrypts the web app's sync file")
    check((try? SyncCrypto.decrypt(fixture["text"]!.string!, pass: "wrong-pass-123")) == nil, "wrong passphrase is refused")
    let fresh = Store(directory: tmp.appendingPathComponent("fresh"))
    let n = fresh.merge(Store.rows(from: remote["data"]))
    check(n >= 4, "merges the web app's records (\(n))")
    check(fresh.get("meals", "m1")?["micros"]?["iron"]?.double == 3.1, "keeps fields the native screens don't show")
    check(fresh.currency == "KZT" && fresh.plan()?.title == "ML", "reads settings")
    check(fresh.ceteleValue("quran", "2026-11-10") == 6, "reads Çetele")
    fresh.setCetele("quran", 7, "2026-11-10")
    fresh.put("meals", ["id": "swift-meal", "name": "Ayran", "calories": 60, "date": "2026-11-10"])
    let payload: JSON = .object(["app": "yaver", "deviceId": .string(fresh.deviceId), "deviceName": "MacBook (app)", "at": .string(Store.isoNow()),
                                 "data": .object(fresh.syncPayload().mapValues { .array($0.map { .object($0) }) })])
    let text = try! SyncCrypto.encrypt(payload, pass: pass)
    check((try? SyncCrypto.decrypt(text, pass: pass))?["deviceName"]?.string == "MacBook (app)", "Swift round trip")
    try! JSON.object(["text": .string(text)]).encoded().write(to: URL(fileURLWithPath: args[2]))

    // A web-app backup file imports the same way.
    let backup: JSON = .object(["app": "yaver", "version": 9, "data": .object(["expenses": .array([.object(["id": "e1", "amount": 1500, "category": "Food", "date": "2026-11-10", "createdAt": "2026-11-10T10:00:00.000Z"])]),
                                                                              "kv": .array([.object(["id": "syncToken", "value": "secret"])])])])
    check((try? fresh.importBackup(backup)) == 1 && fresh.get("kv", "syncToken") == nil, "imports a backup, skipping sync secrets")
}

// Course: content loads from data/course, completing a lesson stores progress and cards.
let course = Course(directory: URL(fileURLWithPath: "data/course"))
check(course.ready && course.lesson(store, "python-w01-1") != nil, "course content loads (week files)")
check(course.allLessons(store).count > 100, "course has all bundled lessons")
let cday = course.day(store, "2026-10-20")
check(cday.week == 1 && cday.slots.contains { $0.lesson != nil }, "a week 1 Tuesday has lesson slots")
let done = course.completeLesson(store, lessonId: "python-w01-1", minutes: 50, score: 1)
check(done.mastered && course.status(store, "python-w01-1") == "done" && store.all("cards").contains { $0.str("lessonId") == "python-w01-1" }, "completing a lesson marks it done and adds cards")
let flagged = course.completeLesson(store, lessonId: "python-w01-2", minutes: 40, score: 0.5)
check(!flagged.mastered && course.status(store, "python-w01-2") == "flagged", "under 80% flags the lesson")
if let c = store.all("cards").first {
    course.gradeCard(store, c.id, "good")
    check(store.get("cards", c.id)!.str("due") > Day.today, "grading a card moves its due date")
}
check(course.testQuestions(store, week: course.weekOf(store, Day.today)).count >= 0 && course.mixedLesson(store, "2026-10-25").str("id") == "mixed-2026-10-25", "mixed practice and weekly test build")

store.flush()
check(Store(directory: tmp).count("tombstones") >= 1, "data survives a restart")
try? FileManager.default.removeItem(at: tmp)
print(failures == 0 ? "All core checks passed." : "\(failures) core check(s) failed.")
exit(failures == 0 ? 0 : 1)
