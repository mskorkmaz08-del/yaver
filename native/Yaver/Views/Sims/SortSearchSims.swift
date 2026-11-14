// Sorting engine and Search rig (twins of js/sims/sort.js and js/sims/search.js).
import SwiftUI

struct SortFrame {
    let order: [Int]
    let vals: [Int: Int]
    let marks: [Int: String]
    let note: String
    let cmp: Int
    let sw: Int
    let sorted: Set<Int>
}

struct SortSim: View {
    let mode: String
    var height: CGFloat = 250
    @State private var algo = "selection"
    @State private var n = 14.0
    @State private var frames: [SortFrame] = []
    @StateObject private var clock = SimClock()

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Picker("Algorithm", selection: $algo) {
                    Text("Selection sort").tag("selection"); Text("Insertion sort").tag("insertion"); Text("Quicksort").tag("quick"); Text("Merge sort").tag("merge")
                }.labelsHidden().fixedSize()
                Text("items \(Int(n))").font(.caption.monospacedDigit()).foregroundStyle(Theme.dim)
                Slider(value: $n, in: 6...32, step: 1) { e in if !e { reset() } }
                Button("Shuffle") { reset() }.buttonStyle(.bordered).controlSize(.small)
            }
            SimTimeline(frames: frames, height: height, note: { $0.note }, draw: draw, clock: clock)
        }
        .onAppear { if frames.isEmpty { algo = ["selection", "insertion", "quick", "merge"].contains(mode) ? mode : "selection"; clock.speed = 3; reset() } }
        .onChange(of: algo) { _ in reset() }
    }

    private func reset() {
        let count = Int(n)
        var a = (0..<count).map { (id: $0, v: 1 + Int((Double($0 + 1) / Double(count) * 98).rounded())) }
        a.shuffle()
        frames = run(a)
        clock.reset(frames.count)
    }

    private func run(_ start: [(id: Int, v: Int)]) -> [SortFrame] {
        var a = start, out: [SortFrame] = [], cmp = 0, sw = 0
        var done = Set<Int>()
        func snap(_ marks: [Int: String], _ note: String) {
            out.append(SortFrame(order: a.map(\.id), vals: Dictionary(uniqueKeysWithValues: a.map { ($0.id, $0.v) }), marks: marks, note: note, cmp: cmp, sw: sw, sorted: done))
        }
        snap([:], "Unsorted")
        switch algo {
        case "selection":
            for i in 0..<a.count {
                var m = i
                for j in (i + 1)..<max(i + 1, a.count) {
                    cmp += 1; snap([a[j].id: "cmp", a[m].id: "min"], "Looking for the smallest from position \(i)")
                    if a[j].v < a[m].v { m = j }
                }
                if m != i { a.swapAt(i, m); sw += 1 }
                done.insert(a[i].id)
                snap([a[i].id: "swap"], "Smallest goes to position \(i)")
            }
        case "insertion":
            for i in 1..<a.count {
                var j = i
                while j > 0 {
                    cmp += 1; snap([a[j].id: "key", a[j - 1].id: "cmp"], "Sliding \(a[j].v) left into the sorted part")
                    if a[j - 1].v <= a[j].v { break }
                    a.swapAt(j, j - 1); sw += 1; j -= 1
                }
            }
        case "quick":
            func qs(_ lo: Int, _ hi: Int) {
                if lo > hi { return }
                if lo == hi { done.insert(a[lo].id); return }
                let p = a[hi]
                var i = lo
                for j in lo..<hi {
                    cmp += 1
                    var marks: [Int: String] = [p.id: "pivot", a[j].id: "cmp"]
                    if i < hi && a[i].id != a[j].id { marks[a[i].id] = "wall" }
                    snap(marks, "Pivot \(p.v): smaller values go left of the wall")
                    if a[j].v < p.v { a.swapAt(i, j); sw += 1; i += 1 }
                }
                a.swapAt(i, hi); sw += 1
                done.insert(a[i].id)
                snap([a[i].id: "pivot"], "Pivot \(p.v) is in its final place")
                qs(lo, i - 1); qs(i + 1, hi)
            }
            qs(0, a.count - 1)
        default:
            func ms(_ lo: Int, _ hi: Int) {
                if hi - lo < 1 { return }
                let mid = (lo + hi) / 2
                ms(lo, mid); ms(mid + 1, hi)
                var i = lo, j = mid + 1
                while i <= j - 1 && j <= hi {
                    cmp += 1; snap([a[i].id: "cmp", a[j].id: "cmp"], "Merging \(lo)–\(mid) with \(mid + 1)–\(hi)")
                    if a[i].v <= a[j].v { i += 1 } else { let x = a.remove(at: j); a.insert(x, at: i); sw += 1; i += 1; j += 1 }
                }
            }
            ms(0, a.count - 1)
        }
        for x in a { done.insert(x.id) }
        snap([:], "Sorted: \(cmp) comparisons, \(sw) \(algo == "merge" ? "moves" : "swaps")")
        return out
    }

    private func draw(_ c: inout GraphicsContext, _ size: CGSize, _ A: SortFrame, _ B: SortFrame, _ t: Double) {
        let w = Double(size.width), h = Double(size.height), count = Double(A.order.count)
        let pad = 16.0, top = 40.0, base = h - 26, bw = (w - pad * 2) / max(1, count)
        var posA: [Int: Int] = [:], posB: [Int: Int] = [:]
        for (i, id) in A.order.enumerated() { posA[id] = i }
        for (i, id) in B.order.enumerated() { posB[id] = i }
        let colors: [String: Color] = ["cmp": SimColor.glow, "min": SimColor.amber, "swap": SimColor.green, "key": SimColor.amber, "pivot": SimColor.red, "wall": SimColor.violet]
        let F = t < 0.5 ? A : B
        for id in A.order {
            let i = Sim.lerp(Double(posA[id] ?? 0), Double(posB[id] ?? 0), t)
            let v = Double(A.vals[id] ?? 0)
            let x = pad + i * bw + 2, bh = (base - top) * v / 100
            let mark = F.marks[id]
            let sorted = F.sorted.contains(id)
            let col: Color = mark.flatMap { colors[$0] } ?? (sorted ? Color(hex: 0x5fbf9a) : SimColor.brass)
            let bottom: Color = mark != nil ? col : sorted ? Color(hex: 0x2f6e5a) : Color(hex: 0x7a5622)
            c.fill(Sim.roundRect(x, base - bh, bw - 4, bh, 2), with: .linearGradient(Gradient(colors: [col, bottom]), startPoint: CGPoint(x: x, y: base - bh), endPoint: CGPoint(x: x, y: base)))
            if bw > 16 { Sim.text(&c, "\(Int(v))", x + (bw - 4) / 2, base + 14, size: 11, color: SimColor.dim, align: .center, mono: true) }
        }
        Sim.text(&c, "\(algo) sort", 14, 22, size: 15, color: SimColor.brassHi, weight: .semibold)
        Sim.text(&c, "comparisons \(B.cmp)   \(algo == "merge" ? "moves" : "swaps") \(B.sw)", w - 14, 22, size: 12, color: SimColor.dim, align: .right, mono: true)
    }
}

struct SearchFrame {
    var p: [String: Int] = [:]
    var range: (Int, Int) = (0, -1)
    var found: [Int] = []
    var foundAll = false
    var note = ""
    var win: Int?
    var best = 0
}

struct SearchSim: View {
    let mode: String
    var height: CGFloat = 230
    @State private var kind = "binary"
    @State private var target = 30.0
    @State private var arr: [Int] = []
    @State private var frames: [SearchFrame] = []
    @StateObject private var clock = SimClock()
    private let k = 3

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Picker("Kind", selection: $kind) { Text("Binary search").tag("binary"); Text("Two pointers").tag("twopointers"); Text("Sliding window").tag("window") }
                    .labelsHidden().fixedSize()
                if kind != "window" {
                    Text("target \(Int(target))").font(.caption.monospacedDigit()).foregroundStyle(Theme.dim)
                    Slider(value: $target, in: 2...(kind == "binary" ? 62 : 120), step: 1) { e in if !e { rebuild() } }
                }
                Button("New numbers") { reset() }.buttonStyle(.bordered).controlSize(.small)
            }
            SimTimeline(frames: frames, height: height, note: { $0.note }, draw: draw, clock: clock)
        }
        .onAppear { if frames.isEmpty { kind = ["binary", "twopointers", "window"].contains(mode) ? mode : "binary"; clock.speed = 1.2; reset() } }
        .onChange(of: kind) { _ in reset() }
    }

    private func reset() {
        if kind == "window" { arr = (0..<14).map { _ in Int.random(in: 1...9) } }
        else { var s = Set<Int>(); while s.count < 15 { s.insert(Int.random(in: 2...61)) }; arr = s.sorted() }
        target = Double(kind == "binary" ? arr.randomElement()! : kind == "twopointers" ? arr[2] + arr[arr.count - 4] : 0)
        rebuild()
    }
    private func rebuild() { frames = framesFor(); clock.reset(frames.count) }

    private func framesFor() -> [SearchFrame] {
        var F: [SearchFrame] = []
        let tg = Int(target)
        if kind == "binary" {
            var lo = 0, hi = arr.count - 1, steps = 0
            F.append(SearchFrame(p: ["lo": lo, "hi": hi], range: (lo, hi), note: "Looking for \(tg) in \(arr.count) sorted numbers"))
            while lo <= hi {
                let mid = (lo + hi) / 2; steps += 1
                F.append(SearchFrame(p: ["lo": lo, "hi": hi, "mid": mid], range: (lo, hi), note: "Step \(steps): check the middle, \(arr[mid])"))
                if arr[mid] == tg { F.append(SearchFrame(p: ["mid": mid], range: (mid, mid), found: [mid], note: "Found \(tg) in \(steps) steps (a linear scan needs up to \(arr.count))")); return F }
                let less = arr[mid] < tg
                if less { lo = mid + 1 } else { hi = mid - 1 }
                F.append(SearchFrame(p: ["lo": lo, "hi": hi, "mid": mid], range: (lo, hi), note: less ? "\(arr[mid]) < \(tg): drop the left half" : "\(arr[mid]) > \(tg): drop the right half"))
            }
            F.append(SearchFrame(p: ["lo": lo, "hi": hi], range: (lo, lo - 1), note: "\(tg) isn't there: \(steps) steps, about log₂(\(arr.count)) ≈ \(Int(ceil(log2(Double(arr.count)))))"))
        } else if kind == "twopointers" {
            var L = 0, R = arr.count - 1
            while L < R {
                let s = arr[L] + arr[R]
                F.append(SearchFrame(p: ["L": L, "R": R], range: (L, R), note: "\(arr[L]) + \(arr[R]) = \(s)\(s == tg ? " ✓" : s < tg ? " too small: move L right" : " too big: move R left")"))
                if s == tg { F.append(SearchFrame(p: ["L": L, "R": R], range: (L, R), found: [L, R], note: "Pair found: \(arr[L]) + \(arr[R]) = \(tg)")); return F }
                if s < tg { L += 1 } else { R -= 1 }
            }
            F.append(SearchFrame(p: ["L": L, "R": R], range: (L, R), note: "No pair adds up to \(tg)"))
        } else {
            var sum = 0, best = -1, bestAt = 0
            for i in 0..<arr.count {
                sum += arr[i]
                if i >= k { sum -= arr[i - k] }
                if i >= k - 1 {
                    let at = i - k + 1
                    if sum > best { best = sum; bestAt = at }
                    F.append(SearchFrame(range: (at, i), note: "Window \(at)–\(i): add \(arr[i])\(i >= k ? ", drop \(arr[i - k])" : "") → sum \(sum)", win: at, best: best))
                }
            }
            F.append(SearchFrame(range: (bestAt, bestAt + k - 1), foundAll: true, note: "Best window of \(k): sum \(best), found in one pass", win: bestAt, best: best))
        }
        return F
    }

    private func draw(_ c: inout GraphicsContext, _ size: CGSize, _ A: SearchFrame, _ B: SearchFrame, _ t: Double) {
        let w = Double(size.width), h = Double(size.height), n = Double(arr.count)
        guard n > 0 else { return }
        let pad = 12.0, cw = min(46, (w - pad * 2) / n), x0 = (w - cw * n) / 2, y = 92.0, ch = cw * 0.95
        let F = t < 0.5 ? A : B
        for i in 0..<arr.count {
            let inRange = i >= F.range.0 && i <= F.range.1
            let hit = F.found.contains(i) || (F.foundAll && inRange)
            let r = Sim.roundRect(x0 + Double(i) * cw + 2, y, cw - 4, ch, 3)
            c.fill(r, with: .color(hit ? SimColor.green.opacity(0.35) : inRange ? SimColor.brass.opacity(0.22) : SimColor.ink.opacity(0.04)))
            c.stroke(r, with: .color(hit ? SimColor.green : inRange ? SimColor.brass : SimColor.faint), lineWidth: 1.2)
            Sim.text(&c, "\(arr[i])", x0 + Double(i) * cw + cw / 2, y + ch / 2 + 5, size: min(16, cw * 0.42), color: inRange ? SimColor.ink : SimColor.dim, align: .center, mono: true)
            if cw > 24 { Sim.text(&c, "\(i)", x0 + Double(i) * cw + cw / 2, y - 6, size: 10, color: SimColor.faint, align: .center, mono: true) }
        }
        func ptr(_ name: String, _ row: Double, _ color: Color) {
            let a = A.p[name], b = B.p[name]
            guard let av = a ?? b, let bv = b ?? a else { return }
            let i = Sim.lerp(Double(av), Double(bv), t)
            let x = x0 + i * cw + cw / 2, yy = y + ch + 12 + row * 26
            var tri = Path(); tri.move(to: CGPoint(x: x, y: yy - 10)); tri.addLine(to: CGPoint(x: x - 6, y: yy)); tri.addLine(to: CGPoint(x: x + 6, y: yy)); tri.closeSubpath()
            c.fill(tri, with: .color(color))
            Sim.text(&c, name, x, yy + 14, size: 13, color: color, align: .center, weight: .semibold)
        }
        if kind == "binary" { ptr("lo", 0, SimColor.teal); ptr("hi", 0, SimColor.violet); ptr("mid", 1, SimColor.amber) }
        if kind == "twopointers" { ptr("L", 0, SimColor.teal); ptr("R", 0, SimColor.violet) }
        if kind == "window", let aw = A.win {
            let at = Sim.lerp(Double(aw), Double(B.win ?? aw), t)
            c.stroke(Sim.roundRect(x0 + at * cw - 1, y - 5, cw * Double(k) + 2, ch + 10, 6), with: .color(SimColor.glow), lineWidth: 2.5)
            Sim.text(&c, "best so far \(F.best)", w - 14, h - 18, size: 13, color: SimColor.amber, align: .right, mono: true)
        }
        let title = kind == "binary" ? "binary search for \(Int(target))" : kind == "twopointers" ? "two numbers that add to \(Int(target))" : "largest sum of \(k) in a row"
        Sim.text(&c, title, 14, 24, size: 15, color: SimColor.brassHi, weight: .semibold)
    }
}
