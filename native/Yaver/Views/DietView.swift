// Diet (twin of js/views/diet.js): calories left, macros, meals by type, photo and
// typed meals estimated by Gemini, Fill the gaps, nutrients with Why / Foods, and the
// food diary (7 or 30 days, what runs low, eating times, feelings, CSV download).
import SwiftUI
import PhotosUI
import ImageIO
import UniformTypeIdentifiers

struct DietView: View {
    @EnvironmentObject var store: Store
    @State private var day = Day.today
    @State private var editing: Row?
    @State private var adding: String?
    @State private var span = 7
    @State private var scan: ScanStart?
    @State private var photo: PhotosPickerItem?
    @State private var shot: Data?
    @State private var camera = false
    @State private var nutrient: NutrientPick?
    @State private var tipsBusy = false
    @State private var tipsStatus = ""
    @State private var tipsError = ""
    @State private var csvDoc: TextFileDoc?
    @State private var exportingCSV = false

    var body: some View {
        let _ = store.revision
        let d = store.diet(day)
        let goal = store.calorieGoal
        Screen(title: "Diet") {
            HStack(alignment: .firstTextBaseline) {
                Text("\(Int(max(0, goal - d.calories.rounded())))").font(.system(size: 34, weight: .semibold).monospacedDigit())
                Text("kcal left").foregroundStyle(Theme.muted)
                Spacer()
                NavigationLink { BodyView() } label: { Image(systemName: "figure.strengthtraining.traditional") }.buttonStyle(.bordered)
            }
            DayPicker(day: $day)

            Card {
                HStack(spacing: 16) {
                    Ring(value: d.calories, goal: goal, label: fmt(d.calories), sub: "/ \(fmt(goal))")
                    VStack(spacing: 10) {
                        macro("Protein", d.protein, store.proteinGoal, Theme.gold)
                        macro("Carbs", d.carbs, (goal * 0.45 / 4).rounded(), Theme.steel)
                        macro("Fat", d.fat, (goal * 0.3 / 9).rounded(), Theme.warn)
                    }
                }
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    PhotosPicker(selection: $photo, matching: .images) { Label("Photo a meal", systemImage: "photo") }.buttonStyle(.bordered)
                    #if os(iOS)
                    if UIImagePickerController.isSourceTypeAvailable(.camera) {
                        Button { camera = true } label: { Label("Camera", systemImage: "camera") }.buttonStyle(.bordered)
                    }
                    #endif
                    Button { scan = ScanStart(image: nil) } label: { Label("Type a meal", systemImage: "square.and.pencil") }.buttonStyle(.bordered)
                    Button { adding = Meals.guess() } label: { Label("By hand", systemImage: "plus") }.buttonStyle(.bordered)
                }
            }

            ForEach(Meals.types, id: \.self) { type in
                let items = d.meals.filter { kind($0) == type }
                Card(title: type, trailing: "\(Int(items.reduce(0) { $0 + $1.num("calories") })) kcal") {
                    if items.isEmpty {
                        Button("+ \(type.lowercased())") { adding = type }.buttonStyle(.borderless).foregroundStyle(Theme.dim)
                    }
                    ForEach(items, id: \.id) { m in mealRow(m) }
                }
            }

            if day == Day.today { tipsCard() }
            nutrientsCard(d)
            if store.count("meals") > 0 { diaryCard() }
        }
        .toolbar { Button { adding = Meals.guess() } label: { Label("Add meal", systemImage: "plus") } }
        .sheet(item: Binding(get: { adding.map { TypeBox(type: $0) } }, set: { adding = $0?.type })) { b in
            NavigationStack { MealForm(day: day, meal: nil, initialType: b.type) }.sheetSize()
        }
        .sheet(item: Binding(get: { editing.map(RowBox.init) }, set: { editing = $0?.row })) { box in
            NavigationStack { MealForm(day: day, meal: box.row) }.sheetSize()
        }
        .sheet(item: $scan) { s in NavigationStack { FoodScanSheet(image: s.image, day: day) }.sheetSize() }
        .sheet(item: $nutrient) { n in NavigationStack { NutrientSheet(key: n.key, tab: n.tab) }.sheetSize() }
        #if os(iOS)
        .fullScreenCover(isPresented: $camera, onDismiss: openShot) { CameraPicker { data in shot = data.flatMap { shrinkJPEG($0) }; camera = false }.ignoresSafeArea() }
        #endif
        .onChange(of: photo) { item in
            guard let item else { return }
            Task {
                let data = try? await item.loadTransferable(type: Data.self)
                photo = nil
                guard let data else { return }
                // Wait for the photo library to finish closing: a sheet asked for while
                // it closes is dropped, which made the first photo do nothing.
                try? await Task.sleep(nanoseconds: 600_000_000)
                scan = ScanStart(image: shrinkJPEG(data))
            }
        }
        .fileExporter(isPresented: $exportingCSV, document: csvDoc, contentType: .commaSeparatedText, defaultFilename: "yaver-food-diary-\(Day.today).csv") { _ in }
    }

    /// The camera has fully closed: now the check sheet can open.
    private func openShot() {
        guard let d = shot else { return }
        shot = nil
        scan = ScanStart(image: d)
    }

    private func kind(_ m: Row) -> String {
        Meals.types.first { $0.lowercased() == m.str("meal").trimmingCharacters(in: .whitespaces).lowercased() } ?? "Snack"
    }

    private func macro(_ label: String, _ v: Double, _ goal: Double, _ c: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label).font(.caption).foregroundStyle(Theme.muted)
                Spacer()
                Text("\(Int(v.rounded()))g").font(.callout.weight(.semibold).monospacedDigit()) + Text(" / \(Int(goal))g").font(.caption2).foregroundColor(Theme.dim)
            }
            Bar(value: goal > 0 ? v / goal : 0, color: c)
        }
    }

    private func mealRow(_ m: Row) -> some View {
        Button { editing = m } label: {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(m.str("name")).foregroundStyle(Theme.text).multilineTextAlignment(.leading)
                    let t = store.mealTime(m).map { (m.str("time").isEmpty ? "~" : "") + $0 + " · " } ?? ""
                    let src = m.str("source") == "photo" ? " · photo" : m.str("source") == "typed" ? " · typed" : ""
                    Text("\(t)P\(fmt(m.num("protein"))) C\(fmt(m.num("carbs"))) F\(fmt(m.num("fat")))\(src)").font(.caption.monospaced()).foregroundStyle(Theme.dim)
                }
                Spacer()
                Text(fmt(m.num("calories"))).font(.callout.monospacedDigit()).foregroundStyle(Theme.muted)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Fill the gaps

    @ViewBuilder private func tipsCard() -> some View {
        let c = FoodGaps.cached(store)
        let stale = c != nil && c?["key"]?.string != FoodGaps.gaps(store).key
        Card(title: "Fill the gaps" + (c == nil ? "" : c?["for"]?.string == "tomorrow" ? " · for tomorrow" : " · rest of today")) {
            if tipsBusy { Text(tipsStatus.isEmpty ? "Looking at today and the last week…" : tipsStatus).font(.caption).foregroundStyle(Theme.muted) }
            if !tipsError.isEmpty { Text(tipsError).font(.caption).foregroundStyle(Theme.warn) }
            if let c {
                Text(c["summary"]?.string ?? "").font(.callout)
                ForEach(Array((c["items"]?.array ?? []).enumerated()), id: \.offset) { _, i in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(i["food"]?.string ?? "").font(.callout.weight(.semibold))
                        Text([i["amount"]?.string ?? "", i["when"]?.string ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption.monospaced()).foregroundStyle(Theme.gold)
                        Text(i["why"]?.string ?? "").font(.caption).foregroundStyle(Theme.muted)
                    }
                }
                if let e = c["ease"]?.string, !e.isEmpty { (Text("Less of: ").foregroundColor(Theme.muted) + Text(e)).font(.callout) }
                if stale { Text("You have logged more since this; tap Update.").font(.caption).foregroundStyle(Theme.muted) }
            } else if !tipsBusy {
                Text("Foods and drinks that cover what today and the last week are missing: protein, vitamins, minerals and the right kind of fat.").font(.callout).foregroundStyle(Theme.muted)
            }
            Button(tipsBusy ? "Thinking…" : c == nil ? "Suggest foods" : stale ? "Update" : "Again") {
                tipsBusy = true; tipsError = ""; tipsStatus = ""
                Task {
                    do { try await FoodGaps.suggest(store) { tipsStatus = $0 } } catch { tipsError = error.localizedDescription }
                    tipsBusy = false
                }
            }
            .buttonStyle(.bordered).disabled(tipsBusy)
        }
    }

    // MARK: Nutrients

    @ViewBuilder private func nutrientsCard(_ d: DietDay) -> some View {
        if d.fiber > 0 || d.sugar > 0 || d.sodium > 0 || d.detailed > 0 {
            let m = d.micros
            Card(title: "Nutrients", trailing: "% of daily value") {
                nutBar("fiber", "Fiber", d.fiber, 28, "g")
                nutBar("sugar", "Sugar", d.sugar, 50, "g", limit: true)
                nutBar("sodium", "Sodium", d.sodium, 2300, "mg", limit: true)
                let kinds = (m["satFat"] ?? 0) + (m["monoFat"] ?? 0) + (m["polyFat"] ?? 0)
                if kinds >= 1 {
                    let share = { (k: String) in (m[k] ?? 0) / kinds }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Fat").font(.callout)
                        GeometryReader { g in
                            HStack(spacing: 0) {
                                Rectangle().fill(Theme.warn).frame(width: g.size.width * share("satFat"))
                                Rectangle().fill(Theme.gold).frame(width: g.size.width * share("monoFat"))
                                Rectangle().fill(Theme.steel).frame(width: g.size.width * share("polyFat"))
                            }
                        }
                        .frame(height: 6).clipShape(Capsule())
                        Text("saturated \(Int((share("satFat") * 100).rounded()))% · mono \(Int((share("monoFat") * 100).rounded()))% · poly \(Int((share("polyFat") * 100).rounded()))%")
                            .font(.caption2).foregroundStyle(Theme.dim)
                    }
                    nutBar("satFat", "Saturated fat", m["satFat"] ?? 0, 20, "g", limit: true)
                    nutBar("omega3", "Omega-3", m["omega3"] ?? 0, 1.6, "g")
                }
                ForEach(Food.micros.filter { (m[$0.key] ?? 0) > 0 }, id: \.key) { x in
                    nutBar(x.key, x.label, m[x.key] ?? 0, x.ref, x.unit, limit: x.key == "caffeine")
                }
                if d.detailed > 0 {
                    Text("Vitamins and minerals from \(d.detailed) photo-logged meal\(d.detailed > 1 ? "s" : ""). All estimates.").font(.caption).foregroundStyle(Theme.dim)
                }
            }
        }
    }

    private func nutBar(_ key: String, _ label: String, _ v: Double, _ ref: Double, _ unit: String, limit: Bool = false) -> some View {
        let pct = ref > 0 ? v / ref * 100 : 0
        return VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label).font(.callout)
                Spacer()
                Text("\(fmt(v, v >= 100 ? 0 : 1))\(unit)").font(.callout.monospacedDigit()) + Text(" \(Int(pct.rounded()))%").font(.caption2).foregroundColor(Theme.dim)
                if NutrientInfo.all[key] != nil {
                    Button("Why") { nutrient = NutrientPick(key: key, tab: "why") }.font(.caption).buttonStyle(.bordered).controlSize(.mini)
                    Button("Foods") { nutrient = NutrientPick(key: key, tab: "foods") }.font(.caption).buttonStyle(.bordered).controlSize(.mini)
                }
            }
            Bar(value: pct / 100, color: limit && pct > 100 ? Theme.red : Theme.gold)
        }
    }

    // MARK: Food diary

    @ViewBuilder private func diaryCard() -> some View {
        let r = DietLog.report(store, span)
        let kc = r.nutrients.first { $0.key == "calories" }, pr = r.nutrients.first { $0.key == "protein" }
        Card(title: "Food diary") {
            Picker("Span", selection: $span) { Text("7 days").tag(7); Text("30 days").tag(30) }.pickerStyle(.segmented)
            if r.loggedDays > 0, let kc, let pr {
                Text("\(r.loggedDays) of \(r.days) days logged · average \(Int(kc.avg.rounded())) kcal (\(kc.pct ?? 0)%) and \(Int(pr.avg.rounded()))g protein (\(pr.pct ?? 0)%).").font(.callout)
            } else {
                Text("\(r.loggedDays) of \(r.days) days logged.").font(.callout)
            }
            if !r.low.isEmpty {
                Text("Running low").font(.caption).foregroundStyle(Theme.muted)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack {
                        ForEach(r.low.prefix(6)) { x in
                            if NutrientInfo.all[x.key] != nil {
                                Button("\(x.label) \(x.pct ?? 0)%") { nutrient = NutrientPick(key: x.key, tab: "foods") }.buttonStyle(.bordered).controlSize(.small)
                            } else {
                                Text("\(x.label) \(x.pct ?? 0)%").font(.caption)
                            }
                        }
                    }
                }
            } else if r.detailedDays > 0 {
                Text("Nothing running low on the days with vitamin data.").font(.caption).foregroundStyle(Theme.muted)
            }
            if !r.high.isEmpty {
                (Text("Above the limit: ").foregroundColor(Theme.muted) + Text(r.high.map { "\($0.label) \($0.pct ?? 0)%" }.joined(separator: " · "))).font(.callout)
            }
            if !r.lowCalorieDays.isEmpty {
                Text("Thin days (under 70% of your calories): \(r.lowCalorieDays.count)").font(.caption).foregroundStyle(Theme.muted)
            }
            if let t = r.timing {
                (Text("When you eat: ").foregroundColor(Theme.muted) + Text("first meal around \(t.first), last around \(t.last) (\(plain(t.window)) h). Late eating (a third of the day's food from 21:00): \(t.lateDays.count) of \(t.days) days.")).font(.callout)
                if t.afterLate.days > 0 || t.afterOther.days > 0 {
                    (Text("Next mornings: ").foregroundColor(Theme.muted) + Text("after late eating you felt bad \(t.afterLate.bad) of \(t.afterLate.days); after other days \(t.afterOther.bad) of \(t.afterOther.days).")).font(.callout)
                }
            }
            HStack {
                Text("How do you feel today?").font(.caption).foregroundStyle(Theme.muted)
                Spacer()
                let feel = store.feeling(Day.today)?.str("feel")
                ForEach(DietLog.feels.indices, id: \.self) { n in chip(DietLog.feels[n].1, on: feel == DietLog.feels[n].0) { store.setFeeling(Day.today, DietLog.feels[n].0) } }
            }
            Text("Vitamins and minerals come from photo and typed meals (\(r.detailedDays) of the logged days). Every meal is kept.").font(.caption).foregroundStyle(Theme.dim)
            Button { csvDoc = TextFileDoc(text: DietLog.csv(store)); exportingCSV = true } label: { Label("Download diary", systemImage: "square.and.arrow.up") }.buttonStyle(.bordered)
        }
    }
}

struct ScanStart: Identifiable { let id = UUID(); let image: Data? }
struct NutrientPick: Identifiable { var id: String { key + tab }; let key: String; let tab: String }
struct TypeBox: Identifiable { var id: String { type }; let type: String }

/// Calories ring.
struct Ring: View {
    let value: Double
    let goal: Double
    let label: String
    let sub: String
    var body: some View {
        ZStack {
            Circle().stroke(Theme.plate2, lineWidth: 7)
            Circle().trim(from: 0, to: goal > 0 ? min(1, value / goal) : 0)
                .stroke(value > goal ? Theme.red : Theme.gold, style: StrokeStyle(lineWidth: 7, lineCap: .round))
                .rotationEffect(.degrees(-90))
            VStack(spacing: 0) {
                Text(label).font(.title3.weight(.semibold).monospacedDigit())
                Text(sub).font(.caption2).foregroundStyle(Theme.dim)
            }
        }
        .frame(width: 104, height: 104)
    }
}

/// A photo shrunk to at most 1024 px on its long side, as JPEG (what the web app sends).
func shrinkJPEG(_ data: Data, max: Int = 1024) -> Data? {
    guard let src = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
    let opts: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: max, kCGImageSourceCreateThumbnailWithTransform: true]
    guard let img = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) else { return nil }
    let out = NSMutableData()
    guard let dst = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(dst, img, [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
    return CGImageDestinationFinalize(dst) ? out as Data : nil
}

func imageView(_ data: Data) -> Image? {
    #if os(macOS)
    return NSImage(data: data).map { Image(nsImage: $0) }
    #else
    return UIImage(data: data).map { Image(uiImage: $0) }
    #endif
}

#if os(iOS)
struct CameraPicker: UIViewControllerRepresentable {
    let done: (Data?) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(done: done) }
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let p = UIImagePickerController()
        p.sourceType = .camera
        p.delegate = context.coordinator
        return p
    }
    func updateUIViewController(_ vc: UIImagePickerController, context: Context) {}
    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let done: (Data?) -> Void
        init(done: @escaping (Data?) -> Void) { self.done = done }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            done((info[.originalImage] as? UIImage)?.jpegData(compressionQuality: 0.9))
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { done(nil) }
    }
}
#endif

/// Photo or typed meal → Gemini estimate → check every item → log.
struct FoodScanSheet: View {
    let image: Data?
    let day: String
    @EnvironmentObject var store: Store
    @Environment(\.dismiss) private var dismiss
    @State private var note = ""
    @State private var busy = false
    @State private var status = ""
    @State private var error = ""
    @State private var result: Food.Estimate?
    @State private var items: [Food.Item] = []
    @State private var dish = ""
    @State private var meal = Meals.guess()
    @State private var mealSet = false
    @State private var eaten = Date()
    @State private var hasTime = true
    @State private var task: Task<Void, Never>?

    var body: some View {
        Form {
            if let image, let img = imageView(image) {
                img.resizable().scaledToFit().frame(maxHeight: 220).clipShape(RoundedRectangle(cornerRadius: 10))
            }
            if result == nil {
                SwiftUI.Section(image != nil ? "Anything the photo doesn't show? (optional)" : "Write it the way you'd say it, with amounts if you know them") {
                    TextField(image != nil ? "fried in butter, 2 sugars, ate half…" : "2 eggs, a slice of bread with butter, black tea with 1 sugar", text: $note, axis: .vertical).lineLimit(2...6)
                }
                Text(busy ? (status.isEmpty ? "Looking things up…" : status) : image != nil
                     ? "Gemini reads labels, measures each item against the plate, cup or cutlery, and looks up brands and local recipes before adding up the nutrients."
                     : "Gemini looks up each item (brand, local recipe, spoon and cup sizes), then works out its amount and nutrients; you check them before logging.")
                    .font(.caption).foregroundStyle(Theme.muted)
                if !error.isEmpty { Text(error).foregroundStyle(Theme.warn) }
                Button(busy ? "Estimating…" : "Estimate") { run() }.disabled(busy || (image == nil && note.trimmingCharacters(in: .whitespaces).isEmpty))
            } else if let r = result {
                TextField("Name", text: $dish)
                SwiftUI.Section("Items") {
                    if items.isEmpty { Text("No food found in this photo.").foregroundStyle(Theme.dim) }
                    ForEach(Array(items.enumerated()), id: \.element.id) { i, it in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(it.name)
                                Text("\(Int((it.n["calories"] ?? 0).rounded())) kcal · P\(Int((it.n["protein"] ?? 0).rounded()))").font(.caption.monospaced()).foregroundStyle(Theme.dim)
                                let basis = [it.basis, it.source].filter { !$0.isEmpty }.joined(separator: " · ")
                                if !basis.isEmpty { Text(basis).font(.caption2).foregroundStyle(Theme.dim) }
                            }
                            Spacer()
                            TextField("g", text: Binding(get: { plain(it.grams.rounded()) }, set: { v in
                                if let g = number(v), i < items.count, let orig = r.items.first(where: { $0.id == it.id }) { items[i] = orig.scaled(max(0, g)) }
                            }))
                            .numberKeyboard().multilineTextAlignment(.trailing).frame(width: 60)
                            Text("g").foregroundStyle(Theme.dim)
                        }
                    }
                    .onDelete { items.remove(atOffsets: $0) }
                }
                let t = Food.totals(items)
                SwiftUI.Section("Total") {
                    Text("\(Int((t["calories"] ?? 0).rounded())) kcal").font(.title3.weight(.semibold).monospacedDigit())
                    Text("P \(Int((t["protein"] ?? 0).rounded()))g · C \(Int((t["carbs"] ?? 0).rounded()))g · F \(Int((t["fat"] ?? 0).rounded()))g").font(.callout.monospaced())
                    Text("Fiber \(fmt(t["fiber"] ?? 0, 1))g · Sugar \(fmt(t["sugar"] ?? 0, 1))g · Sodium \(Int((t["sodium"] ?? 0).rounded()))mg").font(.caption.monospaced()).foregroundStyle(Theme.muted)
                    if (t["fat"] ?? 0) >= 1 {
                        Text("Fat: saturated \(fmt(t["satFat"] ?? 0, 1))g · mono \(fmt(t["monoFat"] ?? 0, 1))g · poly \(fmt(t["polyFat"] ?? 0, 1))g · omega-3 \(fmt(t["omega3"] ?? 0, 1))g").font(.caption.monospaced()).foregroundStyle(Theme.muted)
                    }
                    let mic = Food.micros.filter { (t[$0.key] ?? 0) >= 0.05 }.map { "\($0.label) \(Int(((t[$0.key] ?? 0) / $0.ref * 100).rounded()))%" }
                    if !mic.isEmpty { Text(mic.joined(separator: " · ")).font(.caption).foregroundStyle(Theme.muted) }
                    Text((r.confidence == "low" ? "Low confidence. " : "") + (r.note.isEmpty ? "Change a weight if it looks off; everything else follows." : r.note)).font(.caption).foregroundStyle(Theme.muted)
                    if !r.sources.isEmpty {
                        HStack { Text("Looked up:").font(.caption).foregroundStyle(Theme.dim); ForEach(r.sources, id: \.self) { s in if let u = URL(string: s["uri"] ?? "") { Link(s["title"] ?? "source", destination: u).font(.caption) } } }
                    } else if !r.researched {
                        Text("Search was busy, so this is a direct estimate without looking things up.").font(.caption).foregroundStyle(Theme.dim)
                    }
                }
                SwiftUI.Section("When") {
                    DatePicker("Eaten", selection: $eaten).onChange(of: eaten) { d in if !mealSet { meal = guessMeal(Day.hm(d)) } }
                    Picker("Meal", selection: Binding(get: { meal }, set: { meal = $0; mealSet = true })) { ForEach(Meals.types, id: \.self) { Text($0) } }
                }
                Button("Try again") { result = nil; items = [] }
            }
        }
        .navigationTitle(result != nil ? "Check and log" : image != nil ? "Food photo" : "What did you eat or drink?")
        .onAppear { if day != Day.today { eaten = Day.cal.date(bySettingHour: 12, minute: 0, second: 0, of: Day.date(day)) ?? Date() } }
        .onDisappear { task?.cancel() }
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { task?.cancel(); dismiss() } }
            if result != nil {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Log \(Int((Food.totals(items)["calories"] ?? 0).rounded())) kcal") { log() }.disabled(items.isEmpty)
                }
            }
        }
    }

    private func guessMeal(_ t: String) -> String {
        let h = Int(t.prefix(2)) ?? 12
        return h < 11 ? "Breakfast" : h < 16 ? "Lunch" : h < 21 ? "Dinner" : "Snack"
    }

    private func run() {
        busy = true; error = ""; status = ""
        task = Task {
            do {
                let r = try await Food.scan(store, image: image, note: note) { status = $0 }
                result = r; items = r.items; dish = r.dish
                if let m = r.meal, Meals.types.contains(m), !mealSet, day != Day.today { meal = m }
            } catch is CancellationError {
            } catch { self.error = error.localizedDescription }
            busy = false
        }
    }

    private func log() {
        guard let r = result else { return }
        let row = Food.mealRow(dish: dish.trimmingCharacters(in: .whitespaces).isEmpty ? r.dish : dish.trimmingCharacters(in: .whitespaces), items: items, meal: meal,
                               date: Day.key(eaten), time: Day.hm(eaten), confidence: r.confidence, source: image != nil ? "photo" : "typed", sources: r.sources)
        store.put("meals", row)
        dismiss()
    }
}

/// The guide for one nutrient: why it matters, and where to get it.
struct NutrientSheet: View {
    let key: String
    @State var tab: String
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        let info = NutrientInfo.all[key]
        let ref = Food.daily[key]
        let limit = Food.limits.contains(key)
        Form {
            if let ref { Text("\(limit ? "Daily limit" : "Daily value"): \(fmt(ref, ref < 10 ? 1 : 0)) \(Food.unit(key))").font(.caption).foregroundStyle(Theme.muted) }
            Picker("", selection: $tab) { Text("Why it matters").tag("why"); Text("Where to get it").tag("foods") }.pickerStyle(.segmented)
            if let info {
                if tab == "why" {
                    Text(info.why)
                    SwiftUI.Section("Benefits") { ForEach(info.benefits, id: \.self) { Text($0) } }
                    SwiftUI.Section(limit ? "Too much" : "Too little") { Text(info.low) }
                } else {
                    SwiftUI.Section {
                        ForEach(Array(info.foods.enumerated()), id: \.offset) { _, f in
                            HStack(alignment: .firstTextBaseline) {
                                VStack(alignment: .leading) {
                                    Text(f.first ?? "")
                                    if f.count > 1, !f[1].isEmpty { Text(f[1]).font(.caption).foregroundStyle(Theme.dim) }
                                }
                                Spacer()
                                if f.count > 2, !f[2].isEmpty { Text(f[2]).font(.callout.monospaced()).foregroundStyle(Theme.gold).multilineTextAlignment(.trailing) }
                            }
                        }
                    } footer: { Text("Amounts are typical values (USDA). Real food first; take supplements only after a blood test or a doctor's advice.") }
                }
            }
        }
        .navigationTitle(key == "fiber" ? "Fiber" : key == "sugar" ? "Sugar" : key == "sodium" ? "Sodium" : Food.label(key))
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
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
    var initialType: String? = nil
    @State private var name = ""
    @State private var type = Meals.guess()
    @State private var time = Day.hm()
    @State private var kcal = ""
    @State private var protein = ""
    @State private var carbs = ""
    @State private var fat = ""
    @State private var ate = 1.0

    var body: some View {
        Form {
            TextField("What did you eat?", text: $name)
            Picker("Meal", selection: $type) { ForEach(Meals.types, id: \.self) { Text($0) } }
            TextField("Time (HH:MM)", text: $time)
            TextField("Calories (kcal)", text: $kcal).numberKeyboard()
            TextField("Protein (g)", text: $protein).numberKeyboard()
            TextField("Carbs (g)", text: $carbs).numberKeyboard()
            TextField("Fat (g)", text: $fat).numberKeyboard()
            if let m = meal {
                SwiftUI.Section {
                    Picker("How much did you eat?", selection: $ate) { ForEach(Food.eaten.indices, id: \.self) { i in Text(Food.eaten[i].0).tag(Food.eaten[i].1) } }
                } header: { Text("Didn't finish it?") } footer: {
                    Text(ate < 1 ? "Saving keeps \(Int((ate * 100).rounded()))% of every amount: \(Int((number(kcal) ?? m.num("calories")) * ate)) kcal." : "Pick the part you ate and every amount scales down.")
                }
                Button("Delete meal", role: .destructive) {
                    if let m = meal { store.remove("meals", m.id) }
                    dismiss()
                }
            }
        }
        .navigationTitle(meal == nil ? "Add meal" : "Edit meal")
        .onAppear {
            if let initialType { type = initialType }
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
        if let before = meal, ate < 1 {
            store.put("meals", Food.scaleMeal(row, ate))
            Nav.shared.show("Kept \(Int((ate * 100).rounded()))% of \(row.str("name"))") { store.put("meals", before) }
            return
        }
        store.put("meals", row)
    }
}
