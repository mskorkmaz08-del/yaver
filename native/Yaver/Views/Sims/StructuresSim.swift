// Data structures (twin of js/sims/structures.js): push and pop a stack or queue,
// insert into and reverse a linked list, hash keys into buckets, sift values
// through a min-heap, and watch recursion fill and empty the call stack. Boxes
// are SwiftUI views, so every move animates.
import SwiftUI

struct SBox: Identifiable { let id: Int; var label: String; var x: Double; var y: Double; var hi = false }

/// A line with an arrow head whose ends animate.
struct ArrowShape: Shape {
    var x1, y1, x2, y2: Double
    var head = 7.0
    var animatableData: AnimatablePair<AnimatablePair<Double, Double>, AnimatablePair<Double, Double>> {
        get { AnimatablePair(AnimatablePair(x1, y1), AnimatablePair(x2, y2)) }
        set { x1 = newValue.first.first; y1 = newValue.first.second; x2 = newValue.second.first; y2 = newValue.second.second }
    }
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: x1, y: y1)); p.addLine(to: CGPoint(x: x2, y: y2))
        let a = atan2(y2 - y1, x2 - x1)
        p.move(to: CGPoint(x: x2, y: y2)); p.addLine(to: CGPoint(x: x2 - head * Foundation.cos(a - 0.4), y: y2 - head * Foundation.sin(a - 0.4)))
        p.move(to: CGPoint(x: x2, y: y2)); p.addLine(to: CGPoint(x: x2 - head * Foundation.cos(a + 0.4), y: y2 - head * Foundation.sin(a + 0.4)))
        return p
    }
}

struct StructuresSim: View {
    let mode: String
    var height: CGFloat = 260
    @State private var kind = "stack"
    @State private var items: [Int: SBox] = [:]
    @State private var order: [Int] = []
    @State private var buckets: [[Int]] = Array(repeating: [], count: 7)
    @State private var msg = "Ready"
    @State private var seq = 0
    @State private var width = 340.0
    @State private var started = false
    private let nb = 7
    private static let words = ["loop", "gear", "node", "hex", "tree", "cog", "byte", "list", "map", "key", "stack", "heap", "core", "path", "zaun", "brass"]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker("Kind", selection: $kind) {
                Text("Stack").tag("stack"); Text("Queue").tag("queue"); Text("Linked list").tag("list"); Text("Hash table").tag("hash"); Text("Min-heap").tag("heap"); Text("Recursion").tag("recursion")
            }.labelsHidden().fixedSize()
            if kind == "recursion" {
                RecursionSim(height: height + 10)
            } else {
                stage
                HStack { ForEach(opsFor, id: \.0) { op in Button(op.0) { run(op.1) }.buttonStyle(.bordered) } }.controlSize(.small)
                Text("Tap the buttons: each operation animates, and the line at the top says what it cost.").font(.caption).foregroundStyle(Theme.dim)
            }
        }
        .onAppear { if !started { started = true; kind = ["stack", "queue", "list", "hash", "heap", "recursion"].contains(mode) ? mode : "stack"; start() } }
        .onChange(of: kind) { _ in start() }
    }

    private var opsFor: [(String, String)] {
        switch kind {
        case "stack": return [("Push", "push"), ("Pop", "pop")]
        case "queue": return [("Enqueue", "push"), ("Dequeue", "pop")]
        case "list": return [("Insert at head", "insertHead"), ("Append", "append"), ("Reverse", "reverse")]
        case "hash": return [("Add a key", "hashAdd")]
        default: return [("Insert", "heapPush"), ("Pop min", "heapPop")]
        }
    }

    private var stage: some View {
        let h = Double(height)
        return GeometryReader { g in
            let w = Double(g.size.width)
            ZStack(alignment: .topLeading) {
                Canvas { c, size in
                    Sim.plate(&c, size)
                    if kind == "stack" {
                        var p = Path(); p.move(to: CGPoint(x: w / 2 - 34, y: 30)); p.addLine(to: CGPoint(x: w / 2 - 34, y: h - 18)); p.addLine(to: CGPoint(x: w / 2 + 34, y: h - 18)); p.addLine(to: CGPoint(x: w / 2 + 34, y: 30))
                        c.stroke(p, with: .color(SimColor.faint), lineWidth: 2)
                    }
                    if kind == "hash" {
                        for r in 0..<nb {
                            let y = 34 + Double(r) * ((h - 40) / Double(nb)) + 10
                            Sim.text(&c, "[\(r)]", 22, y + 5, size: 13, color: SimColor.brassHi, mono: true)
                            c.stroke(Sim.line(48, y, 80, y), with: .color(SimColor.faint), lineWidth: 1)
                        }
                    }
                    Sim.text(&c, msg, 14, 20, size: 13.5, color: SimColor.ink)
                }
                ForEach(links, id: \.0) { l in
                    ArrowShape(x1: l.1, y1: l.2, x2: l.3, y2: l.4, head: kind == "hash" ? 5 : 7)
                        .stroke(kind == "heap" ? SimColor.faint : SimColor.glow, lineWidth: 1.5)
                }
                ForEach(Array(items.values).sorted { $0.id < $1.id }) { b in
                    Text(b.label).font(.system(size: 14, design: .monospaced)).foregroundStyle(SimColor.ink)
                        .frame(width: kind == "hash" ? 54 : 46, height: 28)
                        .background(SimColor.brass.opacity(b.hi ? 0.45 : 0.16), in: RoundedRectangle(cornerRadius: 4))
                        .overlay(RoundedRectangle(cornerRadius: 4).stroke(b.hi ? SimColor.amber : SimColor.brass, lineWidth: 1.5))
                        .position(x: b.x, y: b.y)
                }
                if kind == "stack", !order.isEmpty {
                    Text("← top").font(.system(size: 13)).foregroundStyle(SimColor.amber).position(x: w / 2 + 64, y: h - 40 - Double(order.count - 1) * 34)
                }
                if kind == "queue", !order.isEmpty {
                    Text("front").font(.caption).foregroundStyle(SimColor.amber).position(x: 50, y: h / 2 - 30)
                    Text("back").font(.caption).foregroundStyle(SimColor.amber).position(x: 50 + Double(order.count - 1) * 54, y: h / 2 + 30)
                }
                if kind == "list" {
                    Text("head").font(.caption).foregroundStyle(SimColor.amber).position(x: 44, y: 50)
                    if let last = order.last, let b = items[last] {
                        Text("→ None").font(.system(size: 12.5, design: .monospaced)).foregroundStyle(SimColor.dim).position(x: b.x + 54, y: b.y)
                    }
                }
            }
            .onAppear { width = w; layout(animated: false) }
            .onChange(of: g.size.width) { nw in width = Double(nw); layout(animated: false) }
        }
        .frame(height: height)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    /// (id, x1, y1, x2, y2) for each arrow or heap edge.
    private var links: [(Int, Double, Double, Double, Double)] {
        var out: [(Int, Double, Double, Double, Double)] = []
        if kind == "list" {
            for i in 0..<max(0, order.count - 1) { if let a = items[order[i]], let b = items[order[i + 1]] { out.append((order[i], a.x + 24, a.y, b.x - 26, b.y)) } }
        } else if kind == "heap" {
            for i in 1..<max(1, order.count) { if let a = items[order[(i - 1) / 2]], let b = items[order[i]] { out.append((order[i], a.x, a.y + 15, b.x, b.y - 15)) } }
        } else if kind == "hash" {
            for r in buckets { for j in 1..<max(1, r.count) { if let a = items[r[j - 1]], let b = items[r[j]] { out.append((r[j], a.x + 28, a.y, b.x - 28, b.y)) } } }
        }
        return out
    }

    private func start() {
        items = [:]; order = []; buckets = Array(repeating: [], count: nb); msg = ""
        guard kind != "recursion" else { return }
        switch kind {
        case "stack", "queue": for _ in 0..<3 { run("push", quiet: true) }
        case "list": for _ in 0..<4 { run("append", quiet: true) }
        case "hash": for _ in 0..<5 { run("hashAdd", quiet: true) }
        default:
            for _ in 0..<6 { let v = Int.random(in: 1...99); let id = add("\(v)", width / 2, Double(height)); order.append(id); siftUpNow() }
        }
        for k in items.keys { items[k]?.hi = false }
        msg = "Ready"
        layout(animated: false)
    }

    private func add(_ label: String, _ x: Double, _ y: Double) -> Int {
        seq += 1
        items[seq] = SBox(id: seq, label: label, x: x, y: y, hi: true)
        return seq
    }

    private func layout(animated: Bool = true) {
        let w = width, h = Double(height)
        var new = items
        for k in new.keys { new[k]?.hi = false }
        switch kind {
        case "stack": for (i, id) in order.enumerated() { new[id]?.x = w / 2; new[id]?.y = h - 40 - Double(i) * 34 }
        case "queue": for (i, id) in order.enumerated() { new[id]?.x = 50 + Double(i) * 54; new[id]?.y = h / 2 }
        case "list":
            let per = max(1, Int((w - 40) / 74))
            for (i, id) in order.enumerated() { new[id]?.x = 44 + Double(i % per) * 74; new[id]?.y = 80 + Double(i / per) * 70 }
        case "heap":
            for (i, id) in order.enumerated() {
                let d = Int(log2(Double(i + 1))), k = i + 1 - (1 << d)
                new[id]?.x = w * ((Double(k) + 0.5) / Double(1 << d)); new[id]?.y = 56 + Double(d) * 52
            }
        default:
            for (r, ids) in buckets.enumerated() { for (j, id) in ids.enumerated() { new[id]?.x = 112 + Double(j) * 76; new[id]?.y = 34 + Double(r) * ((h - 40) / Double(nb)) + 10 } }
        }
        for k in items.keys where items[k]?.hi == true { new[k]?.hi = true }
        if animated { withAnimation(.spring(response: 0.45, dampingFraction: 0.8)) { items = new } } else { items = new }
    }

    private func flash(_ ids: [Int]) {
        for id in ids { items[id]?.hi = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { withAnimation { for id in ids { items[id]?.hi = false } } }
    }

    private func remove(_ id: Int, toX: Double, toY: Double? = nil) {
        withAnimation(.easeIn(duration: 0.35)) { items[id]?.x = toX; if let toY { items[id]?.y = toY } }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.36) { items[id] = nil }
    }

    private func siftUpNow() {
        var i = order.count - 1
        while i > 0 { let p = (i - 1) / 2; if Int(items[order[p]]!.label)! <= Int(items[order[i]]!.label)! { break }; order.swapAt(p, i); i = p }
    }

    private func run(_ op: String, quiet: Bool = false) {
        let w = width, h = Double(height)
        switch op {
        case "push":
            if order.count >= 6 { msg = "Full in this demo: pop one first"; return }
            let v = Int.random(in: 1...99)
            let id = add("\(v)", w / 2, 0); order.append(id)
            msg = kind == "stack" ? "push(\(v)) goes on top" : "enqueue(\(v)) joins at the back"
            layout(); flash([id])
        case "pop":
            guard !order.isEmpty else { msg = "Empty"; return }
            let id = kind == "stack" ? order.removeLast() : order.removeFirst()
            let label = items[id]?.label ?? ""
            msg = kind == "stack" ? "pop() → \(label): last in, first out" : "dequeue() → \(label): first in, first out"
            remove(id, toX: kind == "stack" ? w + 40 : -40)
            layout()
        case "insertHead":
            if order.count >= 10 { return }
            let v = Int.random(in: 1...99); let id = add("\(v)", 44, 10); order.insert(id, at: 0)
            msg = "New node \(v) points at the old head: O(1)"; layout(); flash([id])
        case "append":
            if order.count >= 10 { return }
            let v = Int.random(in: 1...99); let id = add("\(v)", w, 80); order.append(id)
            msg = "Walk to the tail, then link \(v): O(n) without a tail pointer"; layout(); flash([id])
        case "reverse":
            order.reverse(); msg = "Reverse: each next pointer flips to the previous node"; layout(); flash(order)
        case "hashAdd":
            let word = Self.words.randomElement()!
            let r = word.unicodeScalars.reduce(7) { ($0 * 31 + Int($1.value)) % 1000003 } % nb
            let id = add(word, 20, -20); buckets[r].append(id)
            msg = "hash(\"\(word)\") % \(nb) = \(r)\(buckets[r].count > 1 ? ": bucket \(r) already has \(buckets[r].count - 1), so it chains" : "")"
            layout(); flash([id])
        case "heapPush":
            if order.count >= 15 { msg = "Full in this demo: pop the minimum"; return }
            let v = Int.random(in: 1...99)
            let id = add("\(v)", w / 2, h); order.append(id)
            msg = "Insert \(v) at the end, then sift it up"
            layout(); flash([id])
            var swaps: [(Int, Int)] = [], sim = order, i = sim.count - 1
            while i > 0 { let p = (i - 1) / 2; if Int(items[sim[p]]!.label)! <= v { break }; swaps.append((p, i)); sim.swapAt(p, i); i = p }
            playSwaps(swaps)
        case "heapPop":
            guard !order.isEmpty else { return }
            let top = order[0]
            msg = "Pop the minimum \(items[top]?.label ?? ""); the last value moves to the top and sifts down"
            remove(top, toX: items[top]?.x ?? w / 2, toY: -30)
            let last = order.removeLast()
            if !order.isEmpty { order[0] = last }
            layout()
            var swaps: [(Int, Int)] = [], sim = order, i = 0
            func v(_ k: Int) -> Int { Int(items[sim[k]]!.label)! }
            while true {
                let l = 2 * i + 1, r = l + 1; var m = i
                if l < sim.count && v(l) < v(m) { m = l }
                if r < sim.count && v(r) < v(m) { m = r }
                if m == i { break }
                swaps.append((i, m)); sim.swapAt(i, m); i = m
            }
            playSwaps(swaps)
        default: break
        }
        if quiet { msg = "" }
    }

    private func playSwaps(_ swaps: [(Int, Int)]) {
        for (n, s) in swaps.enumerated() {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.45 * Double(n + 1)) {
                guard s.1 < order.count else { return }
                order.swapAt(s.0, s.1); layout(); flash([order[s.0], order[s.1]])
            }
        }
    }
}

// MARK: - Recursion: the call stack as a timeline

struct CallFrame { var call: String; var local: String }
struct RecFrame { let stack: [CallFrame]; let note: String; let ret: Int? }

struct RecursionSim: View {
    var height: CGFloat = 270
    @State private var fn = "factorial"
    @State private var n = 4.0
    @State private var frames: [RecFrame] = []
    @StateObject private var clock = SimClock()

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Picker("Function", selection: $fn) { Text("factorial(n)").tag("factorial"); Text("total(list)").tag("sum"); Text("fib(n)").tag("fib") }.labelsHidden().fixedSize()
                Text("n \(Int(n))").font(.caption.monospacedDigit()).foregroundStyle(Theme.dim)
                Slider(value: $n, in: 1...6, step: 1) { e in if !e { rebuild() } }
            }
            SimTimeline(frames: frames, height: height, note: { $0.note }, draw: draw, clock: clock)
        }
        .onAppear { if frames.isEmpty { clock.speed = 1.3; rebuild() } }
        .onChange(of: fn) { _ in rebuild() }
    }
    private func rebuild() { frames = build(); clock.reset(frames.count) }

    private func build() -> [RecFrame] {
        var F: [RecFrame] = [], stack: [CallFrame] = []
        func snap(_ note: String, _ ret: Int? = nil) { F.append(RecFrame(stack: stack, note: note, ret: ret)) }
        func fact(_ k: Int) -> Int {
            stack.append(CallFrame(call: "factorial(\(k))", local: "k = \(k)")); snap("Call factorial(\(k))")
            var r: Int
            if k <= 1 { r = 1; snap("Base case: return 1", r) } else {
                let sub = fact(k - 1); r = k * sub
                stack[stack.count - 1].local = "k = \(k), got \(sub)"; snap("\(k) × \(sub) = \(r)", r)
            }
            stack.removeLast(); snap("Return \(r)", r); return r
        }
        func total(_ xs: [Int]) -> Int {
            stack.append(CallFrame(call: "total([\(xs.map(String.init).joined(separator: ", "))])", local: xs.isEmpty ? "empty" : "first = \(xs[0])")); snap("Call total of \(xs.count) items")
            var r: Int
            if xs.isEmpty { r = 0; snap("Base case: an empty list sums to 0", r) } else {
                let s = total(Array(xs.dropFirst())); r = xs[0] + s
                stack[stack.count - 1].local = "\(xs[0]) + \(s)"; snap("\(xs[0]) + \(s) = \(r)", r)
            }
            stack.removeLast(); snap("Return \(r)", r); return r
        }
        func fib(_ k: Int) -> Int {
            stack.append(CallFrame(call: "fib(\(k))", local: "k = \(k)")); snap("Call fib(\(k))")
            var r: Int
            if k < 2 { r = k; snap("Base case: fib(\(k)) = \(k)", r) } else {
                let a = fib(k - 1); stack[stack.count - 1].local = "fib(\(k - 1)) = \(a)"
                let b = fib(k - 2); r = a + b
                stack[stack.count - 1].local = "\(a) + \(b)"; snap("fib(\(k)) = \(a) + \(b) = \(r)", r)
            }
            stack.removeLast(); snap("Return \(r)", r); return r
        }
        let k = Int(n)
        if fn == "factorial" { _ = fact(k) } else if fn == "sum" { _ = total(Array([3, 1, 4, 1, 5].prefix(k))) } else { _ = fib(min(k, 5)) }
        return F
    }

    private func draw(_ c: inout GraphicsContext, _ size: CGSize, _ A: RecFrame, _ B: RecFrame, _ t: Double) {
        let w = Double(size.width), h = Double(size.height)
        let F = t < 0.5 ? A : B
        let rows = max(A.stack.count, B.stack.count)
        for i in 0..<rows {
            let inA = i < A.stack.count, inB = i < B.stack.count
            let a = inA && inB ? 1 : inB ? t : inA ? 1 - t : 0
            let f = (inB ? B : A).stack[i]
            let y = h - 34 - Double(i) * 36 - (1 - a) * 18
            var cc = c
            cc.opacity = a
            let r = Sim.roundRect(20, y - 15, w - 40, 30, 4)
            cc.fill(r, with: .color(i == rows - 1 ? SimColor.teal.opacity(0.22) : SimColor.brass.opacity(0.12)))
            cc.stroke(r, with: .color(i == rows - 1 ? SimColor.glow : SimColor.brass), lineWidth: 1.4)
            Sim.text(&cc, f.call, 32, y + 5, size: 13.5, color: SimColor.ink, mono: true)
            Sim.text(&cc, f.local, w - 32, y + 5, size: 12.5, color: SimColor.amber, align: .right, mono: true)
        }
        Sim.text(&c, "call stack (newest on top)", 14, 22, size: 14, color: SimColor.brassHi, weight: .semibold)
        if let r = F.ret { Sim.text(&c, "returns \(r)", w - 14, 22, size: 13, color: SimColor.green, align: .right, mono: true) }
    }
}
