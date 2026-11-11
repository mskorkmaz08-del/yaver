// Table press (twin of js/sims/data.js): a small study table goes through the same
// moves as SQL and pandas. Rows are strips that slide, fade, regroup and fold, so
// WHERE, ORDER BY, GROUP BY, joins, cleaning and charting show what happens to rows.
import SwiftUI

struct TItem {
    var id: String, x: Double, y: Double, w: Double, h: Double
    var cells: [String]? = nil, cw: Double? = nil, head = false, a = 1.0
    var fill: Color? = nil, ring: Color? = nil, bad: Int? = nil, good: Int? = nil
    var bar: String? = nil, val = 0
}
struct TFrame { var items: [TItem]; var query: String; var note: String; var link: (String, String)? = nil; var axis: Int? = nil; var warn = false }

struct DataSim: View {
    let mode: String
    var height: CGFloat = 310
    @State private var kind = "filter"
    @State private var frames: [TFrame] = []
    @StateObject private var clock = SimClock()

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker("Kind", selection: $kind) {
                Text("WHERE, ORDER BY, LIMIT").tag("filter"); Text("Group by and aggregate").tag("group"); Text("Join two tables").tag("join"); Text("Clean messy data").tag("clean"); Text("From table to chart").tag("chart")
            }.labelsHidden().fixedSize()
            SimTimeline(frames: frames, height: height, note: { $0.note }, draw: draw, clock: clock)
        }
        .onAppear { if frames.isEmpty { kind = ["filter", "group", "join", "clean", "chart"].contains(mode) ? mode : "filter"; clock.speed = 0.8; rebuild() } }
        .onChange(of: kind) { _ in rebuild() }
    }
    private func rebuild() { frames = Self.framesFor(kind); clock.reset(frames.count) }

    struct Rec { var id: Int; var name: String; var track: String; var min: Int?; var score: Int? }
    static let VW = 320.0, VH = 310.0, RH = 24.0, TOP = 66.0, CW = 72.0, X0 = 16.0
    static let cols = ["name", "track", "min", "score"]
    static let data = [Rec(id: 1, name: "Aru", track: "python", min: 45, score: 82), Rec(id: 2, name: "Ben", track: "math", min: 30, score: 64),
                       Rec(id: 3, name: "Dana", track: "python", min: 60, score: 91), Rec(id: 4, name: "Erlan", track: "ai", min: 20, score: 70),
                       Rec(id: 5, name: "Mira", track: "math", min: 50, score: 77), Rec(id: 6, name: "Timur", track: "ai", min: 40, score: 88),
                       Rec(id: 7, name: "Zhan", track: "python", min: 25, score: 58)]
    static func tint(_ t: String) -> Color { t == "python" ? SimColor.amber : t == "math" ? SimColor.violet : SimColor.teal }

    static func row(_ r: Rec, _ i: Double, _ f: (inout TItem) -> Void = { _ in }) -> TItem {
        var it = TItem(id: "r\(r.id)", x: X0, y: TOP + i * RH, w: CW * 4, h: RH - 3, cells: [r.name, r.track, r.min.map(String.init) ?? "NaN", r.score.map(String.init) ?? "NaN"])
        f(&it); return it
    }
    static func header(_ cols: [String] = cols, x: Double = X0, y: Double = TOP - RH, cw: Double = CW, id: String = "h") -> TItem {
        TItem(id: id, x: x, y: y, w: cw * Double(cols.count), h: RH - 3, cells: cols, cw: cw, head: true)
    }

    static func framesFor(_ kind: String) -> [TFrame] {
        switch kind {
        case "group": return groupFrames()
        case "join": return joinFrames()
        case "clean": return cleanFrames()
        case "chart": return chartFrames()
        default: return filterFrames()
        }
    }

    static func filterFrames() -> [TFrame] {
        var F: [TFrame] = [], q = ["SELECT * FROM study"]
        let D = data
        F.append(TFrame(items: [header()] + D.enumerated().map { row($1, Double($0)) }, query: q.joined(separator: "\n"), note: "The whole table: one strip per row"))
        q.append("WHERE min >= 30")
        F.append(TFrame(items: [header()] + D.enumerated().map { i, r in row(r, Double(i)) { (r.min ?? 0) < 30 ? ($0.ring = SimColor.red, $0.fill = SimColor.red.opacity(0.18)) : ($0.ring = SimColor.green, ()) } }, query: q.joined(separator: "\n"), note: "WHERE checks each row: Erlan and Zhan studied under 30 minutes"))
        let kept = D.filter { ($0.min ?? 0) >= 30 }
        var items = [header()] + kept.enumerated().map { row($1, Double($0)) }
        for (i, r) in D.enumerated() where (r.min ?? 0) < 30 { items.append(row(r, Double(i)) { $0.x = VW + 20; $0.a = 0 }) }
        F.append(TFrame(items: items, query: q.joined(separator: "\n"), note: "Rows that fail the test leave; the rest close up"))
        q.append("ORDER BY score DESC")
        let sorted = kept.sorted { ($0.score ?? 0) > ($1.score ?? 0) }
        F.append(TFrame(items: [header()] + sorted.enumerated().map { i, r in row(r, Double(i)) { if i == 0 { $0.ring = SimColor.amber } } }, query: q.joined(separator: "\n"), note: "ORDER BY slides them into score order, highest first"))
        q.append("LIMIT 3")
        F.append(TFrame(items: [header()] + sorted.enumerated().map { i, r in row(r, Double(i)) { if i >= 3 { $0.a = 0.12 } } }, query: q.joined(separator: "\n"), note: "LIMIT keeps the first three"))
        F.append(TFrame(items: [header()] + sorted.prefix(3).enumerated().map { row($1, Double($0)) }, query: q.joined(separator: "\n"), note: "pandas: df[df[\"min\"] >= 30].sort_values(\"score\", ascending=False).head(3)"))
        return F
    }

    static func groupFrames() -> [TFrame] {
        var F: [TFrame] = []
        let q = "df.groupby('track').agg(minutes=('min','sum'), avg=('score','mean'))"
        let D = data
        func tinted(_ r: Rec, _ i: Double, _ a: Double = 1) -> TItem { row(r, i) { $0.ring = tint(r.track); $0.fill = tint(r.track).opacity(0.13); $0.a = a } }
        F.append(TFrame(items: [header()] + D.enumerated().map { row($1, Double($0)) }, query: q, note: "Each row belongs to one track"))
        F.append(TFrame(items: [header()] + D.enumerated().map { tinted($1, Double($0)) }, query: q, note: "Colour the rows by their group key: track"))
        let order = ["ai", "math", "python"]
        var y = 0.0, pos: [Int: Double] = [:], gy: [String: Double] = [:]
        for g in order { gy[g] = y; for r in D where r.track == g { pos[r.id] = y; y += 1 }; y += 0.4 }
        F.append(TFrame(items: [header()] + D.map { tinted($0, pos[$0.id] ?? 0) }, query: q, note: "Split: rows with the same key gather together"))
        F.append(TFrame(items: [header()] + D.map { tinted($0, gy[$0.track] ?? 0, 0.5) }, query: q, note: "Apply: fold each group into one row"))
        var items = [header(["track", "minutes", "avg"], cw: 96)]
        var firsts = Set<Int>()
        for (i, g) in order.enumerated() {
            let rs = D.filter { $0.track == g }
            let m = rs.reduce(0) { $0 + ($1.min ?? 0) }, s = Double(rs.reduce(0) { $0 + ($1.score ?? 0) }) / Double(rs.count)
            firsts.insert(rs[0].id)
            items.append(TItem(id: "r\(rs[0].id)", x: X0, y: TOP + Double(i) * RH, w: 288, h: RH - 3, cells: [g, "\(m)", Sim.fmt((s * 10).rounded() / 10)], cw: 96, fill: tint(g).opacity(0.13), ring: tint(g)))
        }
        for r in D where !firsts.contains(r.id) { items.append(row(r, gy[r.track] ?? 0) { $0.a = 0 }) }
        F.append(TFrame(items: items, query: q, note: "Combine: one row per track with total minutes and average score"))
        return F
    }

    static func joinFrames() -> [TFrame] {
        var F: [TFrame] = []
        let L = data.prefix(5).map { (id: $0.id, name: $0.name, track: $0.track == "ai" ? "cpp" : $0.track) }
        let R = [(id: "m", track: "python", mentor: "Mustafa"), (id: "n", track: "math", mentor: "Aigerim"), (id: "o", track: "robo", mentor: "Sanzhar")]
        let cw = 68.0, lx = 10.0, rx = 166.0
        let heads = [header(["name", "track"], x: lx, cw: cw, id: "hl"), header(["track", "mentor"], x: rx, cw: cw, id: "hr")]
        let q = "pd.merge(students, mentors, on='track')"
        func base(_ rings: [String: Color] = [:]) -> [TItem] {
            var out = heads
            for (i, r) in L.enumerated() { out.append(TItem(id: "l\(r.id)", x: lx, y: TOP + Double(i) * RH, w: cw * 2, h: RH - 3, cells: [r.name, r.track], cw: cw, ring: rings["l\(r.id)"])) }
            for (i, r) in R.enumerated() { out.append(TItem(id: "t\(r.id)", x: rx, y: TOP + Double(i) * RH, w: cw * 2, h: RH - 3, cells: [r.track, r.mentor], cw: cw, ring: rings["t\(r.id)"])) }
            return out
        }
        F.append(TFrame(items: base(), query: q, note: "Two tables share a column: track"))
        var out: [TItem] = []
        let resY = TOP + 5 * RH + 30
        let rhead = header(["name", "track", "mentor"], x: X0, y: resY - RH, cw: 96, id: "hres")
        for r in L {
            if let j = R.firstIndex(where: { $0.track == r.track }) {
                out.append(TItem(id: "j\(r.id)", x: X0, y: resY + Double(out.count) * RH, w: 288, h: RH - 3, cells: [r.name, r.track, R[j].mentor], cw: 96, ring: SimColor.green))
                F.append(TFrame(items: base(["l\(r.id)": SimColor.glow, "t\(R[j].id)": SimColor.glow]) + [rhead] + out, query: q, note: "\(r.name): track \(r.track) matches, so a joined row is made", link: ("l\(r.id)", "t\(R[j].id)")))
            } else {
                F.append(TFrame(items: base(["l\(r.id)": SimColor.red]) + [rhead] + out, query: q, note: "\(r.name): no mentor for \(r.track), so an inner join drops this row"))
            }
        }
        F.append(TFrame(items: base(["to": SimColor.dim]) + [rhead] + out, query: q, note: "Done. how='left' would keep Erlan with mentor NaN; robo has no student"))
        return F
    }

    static func cleanFrames() -> [TFrame] {
        var F: [TFrame] = []
        let raw = [Rec(id: 1, name: "Aru", track: "python", min: 45, score: 82), Rec(id: 2, name: "Ben", track: " Math", min: 30, score: nil),
                   Rec(id: 3, name: "Dana", track: "python", min: 60, score: 91), Rec(id: 8, name: "Dana", track: "python", min: 60, score: 91),
                   Rec(id: 4, name: "Erlan", track: "AI ", min: 20, score: 70), Rec(id: 5, name: "Mira", track: "math", min: nil, score: 77)]
        func all(_ list: [Rec], _ f: @escaping (Rec, inout TItem) -> Void = { _, _ in }) -> [TItem] { [header()] + list.enumerated().map { i, r in row(r, Double(i)) { f(r, &$0) } } }
        F.append(TFrame(items: all(raw), query: "df = pd.read_csv(\"study.csv\")", note: "Real data arrives messy"))
        F.append(TFrame(items: all(raw) { r, it in if r.score == nil || r.min == nil { it.ring = SimColor.red; it.bad = r.score == nil ? 3 : 2 } }, query: "df.isna().sum()", note: "Missing values: Ben has no score, Mira has no minutes"))
        F.append(TFrame(items: all(raw) { r, it in if r.id == 8 || r.id == 3 { it.ring = SimColor.amber } }, query: "df.duplicated()", note: "Dana appears twice, an exact duplicate"))
        let nodup = raw.filter { $0.id != 8 }
        F.append(TFrame(items: all(nodup) + [row(raw[3], 3) { $0.x = VW + 20; $0.a = 0 }], query: "df = df.drop_duplicates()", note: "The copy slides out"))
        F.append(TFrame(items: all(nodup) { r, it in if r.track != r.track.trimmingCharacters(in: .whitespaces).lowercased() { it.ring = SimColor.amber; it.bad = 1 } }, query: "df[\"track\"].unique()", note: "' Math' and 'AI ' are the same tracks written differently"))
        let fixed = nodup.map { r -> Rec in var x = r; x.track = r.track.trimmingCharacters(in: .whitespaces).lowercased(); return x }
        F.append(TFrame(items: all(fixed) { r, it in if r.id == 2 || r.id == 4 { it.ring = SimColor.green } }, query: "df[\"track\"] = df[\"track\"].str.strip().str.lower()", note: "Strip spaces and lower-case: now they group correctly"))
        let mins = fixed.compactMap(\.min)
        let meanMin = Int((Double(mins.reduce(0, +)) / Double(mins.count)).rounded())
        let filled = fixed.map { r -> Rec in var x = r; if r.id == 5 { x.min = meanMin }; return x }
        F.append(TFrame(items: all(filled) { r, it in if r.id == 5 { it.ring = SimColor.green; it.good = 2 } else if r.id == 2 { it.ring = SimColor.red; it.x = VW + 20; it.a = 0 } },
                        query: "df[\"min\"] = df[\"min\"].fillna(df[\"min\"].mean())\ndf = df.dropna(subset=[\"score\"])", note: "Fill Mira's minutes with the mean (\(meanMin)); drop Ben, whose score we can't guess"))
        F.append(TFrame(items: all(filled.filter { $0.id != 2 }), query: "df.info()", note: "Clean: no duplicates, no gaps, one spelling per track"))
        return F
    }

    static func chartFrames() -> [TFrame] {
        let base = 250.0, top = 70.0, bw = 34.0, gap = (288 - 7 * bw) / 6
        func bar(_ r: Rec, _ i: Int, _ lo: Double = 0) -> TItem {
            let hgt = (Double(r.score ?? 0) - lo) / (100 - lo) * (base - top)
            return TItem(id: "r\(r.id)", x: X0 + Double(i) * (bw + gap), y: base - hgt, w: bw, h: hgt, fill: tint(r.track), bar: r.name, val: r.score ?? 0)
        }
        let D = data, sorted = D.sorted { ($0.score ?? 0) > ($1.score ?? 0) }
        return [
            TFrame(items: [header()] + D.enumerated().map { row($1, Double($0)) }, query: "plt.bar(df[\"name\"], df[\"score\"])", note: "Start from the table"),
            TFrame(items: D.enumerated().map { bar($1, $0) }, query: "plt.bar(df[\"name\"], df[\"score\"])", note: "Each score becomes a bar; height is the value", axis: 0),
            TFrame(items: sorted.enumerated().map { bar($1, $0) }, query: "df.sort_values(\"score\", ascending=False)", note: "Sorted bars are easier to read", axis: 0),
            TFrame(items: sorted.enumerated().map { bar($1, $0, 50) }, query: "plt.ylim(50, 100)", note: "Cut the axis at 50 and Zhan suddenly looks hopeless: a misleading chart", axis: 50, warn: true),
            TFrame(items: sorted.enumerated().map { bar($1, $0) }, query: "plt.ylim(0, 100)", note: "Bars must start at zero to compare honestly", axis: 0),
        ]
    }

    private func draw(_ c: inout GraphicsContext, _ size: CGSize, _ A: TFrame, _ B: TFrame, _ t: Double) {
        let w = Double(size.width), h = Double(size.height)
        let sx = w / Self.VW, sy = h / Self.VH, S = t < 0.5 ? A : B
        let ql = S.query.components(separatedBy: "\n")
        let lines = ql.count > 1 ? [ql.dropLast().joined(separator: " "), ql.last ?? ""] : ql
        for (k, line) in lines.enumerated() { Sim.text(&c, line, 12, 20 + Double(k) * 15, size: 11.5, color: k == lines.count - 1 ? SimColor.amber : SimColor.dim, mono: true) }
        var ids: [String] = [], pairs: [String: (TItem?, TItem?)] = [:]
        for it in A.items { pairs[it.id] = (it, nil); ids.append(it.id) }
        for it in B.items { if let p = pairs[it.id] { pairs[it.id] = (p.0, it) } else { pairs[it.id] = (nil, it); ids.append(it.id) } }
        if let ax = S.axis {
            var p = Path()
            p.move(to: CGPoint(x: Self.X0 * sx - 2, y: 70 * sy)); p.addLine(to: CGPoint(x: Self.X0 * sx - 2, y: 250 * sy)); p.addLine(to: CGPoint(x: (Self.X0 + 288) * sx, y: 250 * sy))
            c.stroke(p, with: .color(S.warn ? SimColor.red : SimColor.faint), lineWidth: 1)
            Sim.text(&c, "\(ax)", Self.X0 * sx - 4, 250 * sy + 4, size: 10, color: S.warn ? SimColor.red : SimColor.dim, align: .right, mono: true)
        }
        for id in ids {
            guard let pr = pairs[id] else { continue }
            var a: TItem, b: TItem
            if let pa = pr.0, let pb = pr.1 { a = pa; b = pb }
            else if let pb = pr.1 { b = pb; a = pb; a.a = 0; a.x = pb.x + 30 }
            else if let pa = pr.0 { a = pa; b = pa; b.a = 0 } else { continue }
            drawItem(&c, a, b, t, sx, sy)
        }
        if let link = S.link, let p = S.items.first(where: { $0.id == link.0 }), let q = S.items.first(where: { $0.id == link.1 }) {
            var path = Path()
            path.move(to: CGPoint(x: (p.x + p.w) * sx, y: (p.y + 10) * sy))
            path.addCurve(to: CGPoint(x: q.x * sx, y: (q.y + 10) * sy), control1: CGPoint(x: (p.x + p.w + 14) * sx, y: (p.y + 10) * sy), control2: CGPoint(x: (q.x - 14) * sx, y: (q.y + 10) * sy))
            c.stroke(path, with: .color(SimColor.glow.opacity(0.35)), lineWidth: 6)
            c.stroke(path, with: .color(SimColor.glow), lineWidth: 2)
        }
    }

    private func drawItem(_ c: inout GraphicsContext, _ a: TItem, _ b: TItem, _ t: Double, _ sx: Double, _ sy: Double) {
        let isBar = a.bar != nil || b.bar != nil
        let x = Sim.lerp(a.x, b.x, t) * sx, y = Sim.lerp(a.y, b.y, t) * sy, wd = Sim.lerp(a.w, b.w, t) * sx, ht = Sim.lerp(a.h, b.h, t) * (isBar ? sy : 1)
        let alpha = Sim.lerp(a.a, b.a, t)
        if alpha < 0.02 { return }
        let S = t < 0.5 ? a : b
        let barness: Double = a.bar != nil && b.bar != nil ? 1 : b.bar != nil ? t : a.bar != nil ? 1 - t : 0
        var g = c
        g.opacity = barness > 0 ? alpha * (0.35 + 0.5 * barness) : alpha
        let fill: Color = S.head ? SimColor.amber.opacity(0.16) : barness > 0 ? (b.fill ?? a.fill ?? SimColor.brass) : (S.fill ?? SimColor.ink.opacity(0.05))
        let r = Sim.roundRect(x, y, max(2, wd), max(2, ht), 3)
        g.fill(r, with: .color(fill))
        g.opacity = alpha
        if let ring = S.ring { g.stroke(r, with: .color(ring), lineWidth: 1.5) }
        if barness < 0.5, let cells = S.cells {
            g.opacity = alpha * (1 - barness * 2)
            let cw = (S.cw ?? Self.CW) * sx
            for (k, cell) in cells.enumerated() {
                let col: Color = S.head ? SimColor.brassHi : (S.bad == k || cell == "NaN") ? SimColor.red : S.good == k ? SimColor.green : SimColor.ink
                Sim.text(&g, cell, x + Double(k) * cw + 6, y + ht / 2 + 4, size: 11.5, color: col, mono: true, weight: S.head ? .bold : .medium)
            }
        }
        if barness > 0.5, let name = S.bar {
            g.opacity = alpha * (barness - 0.5) * 2
            Sim.text(&g, name, x + wd / 2, 250 * sy + 16, size: 10.5, color: SimColor.dim, align: .center)
            Sim.text(&g, "\(S.val)", x + wd / 2, y - 5, size: 10.5, color: SimColor.ink, align: .center, mono: true)
        }
    }
}
