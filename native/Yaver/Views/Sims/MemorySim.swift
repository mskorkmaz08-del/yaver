// Memory map for C++ (twin of js/sims/memory.js): variables as labelled boxes on the
// stack and the heap, pointers as arrows, references as second names on the same box,
// and a std::vector that doubles its capacity by moving every element.
import SwiftUI

struct MBox { var id: String; var heap = false; var slot: Int; var name: String; var val: String; var addr: String? = nil; var hot = false; var dead = false }
struct MStep { var line: Int; var boxes: [MBox]; var arrows: [(String, String, Int)] = []; var note: String }

struct MemorySim: View {
    let mode: String
    var height: CGFloat = 330
    @State private var kind = "pointers"
    @StateObject private var clock = SimClock()
    @StateObject private var V = VecGrowth()

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker("Kind", selection: $kind) { Text("Pointers and references").tag("pointers"); Text("Heap, delete and smart pointers").tag("heap"); Text("Vector growth").tag("vector") }.labelsHidden().fixedSize()
            if kind == "vector" {
                TimelineView(.animation(paused: !V.live)) { tl in
                    Canvas { c, size in
                        let dt = V.frame(tl.date)
                        if !V.tick(dt) { V.stop() }
                        Sim.plate(&c, size)
                        drawVector(&c, Double(size.width), Double(size.height))
                    }
                }
                .frame(height: height).clipShape(RoundedRectangle(cornerRadius: 10))
                HStack {
                    Button("push_back") { V.push() }.buttonStyle(.borderedProminent)
                    Button("pop_back") { V.pop() }
                    Button("Clear") { V.clear() }
                }.buttonStyle(.bordered).controlSize(.small)
                Text("Tap push_back again and again: most pushes are instant, a few move everything. That is why push_back is fast on average.").font(.caption).foregroundStyle(Theme.dim)
            } else {
                SimTimeline(frames: steps, height: height, note: { $0.note }, draw: { c, s, A, B, t in drawProgram(&c, Double(s.width), Double(s.height), A, B, t) }, clock: clock)
                Text(kind == "pointers" ? "Boxes are variables, arrows are pointers. Step through and watch which box each line changes." : "new puts a box on the heap that lives until delete. Smart pointers delete for you.")
                    .font(.caption).foregroundStyle(Theme.dim)
            }
        }
        .onAppear { if clock.count <= 1 { kind = ["pointers", "heap", "vector"].contains(mode) ? mode : "pointers"; clock.speed = 0.9; clock.reset(steps.count) } }
        .onChange(of: kind) { _ in clock.reset(steps.count) }
    }

    private var code: [String] { kind == "heap" ? Self.heapCode : Self.ptrCode }
    private var steps: [MStep] { kind == "heap" ? Self.heapSteps : Self.ptrSteps }

    static let ptrCode = ["int a = 5;", "int* p = &a;", "*p = 9;", "int& r = a;", "r = 12;", "int b = *p + 1;", "p = &b;"]
    static let ptrSteps: [MStep] = {
        func a(_ v: String, _ name: String = "a", hot: Bool = false) -> MBox { MBox(id: "a", slot: 0, name: name, val: v, addr: "0x7ffc10", hot: hot) }
        func p(_ v: String = "0x7ffc10", hot: Bool = false) -> MBox { MBox(id: "p", slot: 1, name: "p", val: v, addr: "0x7ffc18", hot: hot) }
        let ar = "a  (also r)"
        return [
            MStep(line: 0, boxes: [], note: "main() starts with an empty stack frame"),
            MStep(line: 1, boxes: [a("5")], note: "a gets a box on the stack, holding 5"),
            MStep(line: 2, boxes: [a("5"), p()], arrows: [("p", "a", 0)], note: "p stores the address of a: it points at a"),
            MStep(line: 3, boxes: [a("9", hot: true), p()], arrows: [("p", "a", 1)], note: "*p follows the arrow: writing through p changes a"),
            MStep(line: 4, boxes: [a("9", ar), p()], arrows: [("p", "a", 0)], note: "A reference is a second name for the same box: no new memory"),
            MStep(line: 5, boxes: [a("12", ar, hot: true), p()], arrows: [("p", "a", 0)], note: "r = 12 writes straight into a"),
            MStep(line: 6, boxes: [a("12", ar), p(), MBox(id: "b", slot: 2, name: "b", val: "13", addr: "0x7ffc20", hot: true)], arrows: [("p", "a", 1)], note: "*p reads a (12), so b = 13"),
            MStep(line: 7, boxes: [a("12", ar), p("0x7ffc20", hot: true), MBox(id: "b", slot: 2, name: "b", val: "13", addr: "0x7ffc20")], arrows: [("p", "b", 1)], note: "A pointer can be re-aimed; a reference never can"),
        ]
    }()
    static let heapCode = ["int* p = new int(7);", "int* q = p;", "*q = 8;", "delete p;", "p = nullptr;", "{ auto u = std::make_unique<int>(3);", "} // u goes out of scope"]
    static let heapSteps: [MStep] = {
        func h1(_ v: String, hot: Bool = false, dead: Bool = false) -> MBox { MBox(id: "h1", heap: true, slot: 0, name: dead ? "freed" : "int", val: v, addr: "0x55a0", hot: hot, dead: dead) }
        func p(_ v: String = "0x55a0", hot: Bool = false) -> MBox { MBox(id: "p", slot: 0, name: "p", val: v, hot: hot) }
        let q = MBox(id: "q", slot: 1, name: "q", val: "0x55a0")
        return [
            MStep(line: 0, boxes: [], note: "Stack on the left, heap on the right"),
            MStep(line: 1, boxes: [h1("7"), p()], arrows: [("p", "h1", 0)], note: "new makes a box on the heap; p on the stack points at it"),
            MStep(line: 2, boxes: [h1("7"), p(), q], arrows: [("p", "h1", 0), ("q", "h1", 0)], note: "Copying a pointer copies the address: two arrows, one box"),
            MStep(line: 3, boxes: [h1("8", hot: true), p(), q], arrows: [("p", "h1", 0), ("q", "h1", 1)], note: "Writing through q changes what p sees too"),
            MStep(line: 4, boxes: [h1("?", dead: true), p(), q], arrows: [("p", "h1", 2), ("q", "h1", 2)], note: "delete frees the box, but both pointers still hold its address: dangling"),
            MStep(line: 5, boxes: [h1("?", dead: true), p("nullptr", hot: true), q], arrows: [("q", "h1", 2)], note: "p is safe now; q still dangles. Using *q is undefined behaviour"),
            MStep(line: 6, boxes: [p("nullptr"), q, MBox(id: "u", slot: 2, name: "u (unique_ptr)", val: "0x55c8"), MBox(id: "h2", heap: true, slot: 1, name: "int", val: "3", addr: "0x55c8")], arrows: [("u", "h2", 0)], note: "A unique_ptr owns its heap box"),
            MStep(line: 7, boxes: [p("nullptr"), q], note: "When u leaves its scope it deletes the box itself: RAII, no leak, no delete to forget"),
        ]
    }()

    // MARK: program drawing

    private func drawProgram(_ c: inout GraphicsContext, _ w: Double, _ h: Double, _ A: MStep, _ B: MStep, _ t: Double) {
        let LH = 15.0, code = self.code
        let top = 16 + Double(code.count) * LH + 22, colW = (w - 36) / 2, sx = 12.0, hx = 24 + (w - 36) / 2, bh = 40.0
        func pos(_ b: MBox) -> CGPoint { CGPoint(x: b.heap ? hx : sx, y: top + 20 + Double(b.slot) * (bh + 10)) }
        let ln = Sim.lerp(Double(A.line), Double(B.line), t)
        if ln > 0 {
            let y = 16 + (ln - 1) * LH - 2
            c.fill(Sim.roundRect(8, y, w - 16, LH, 3), with: .color(SimColor.amber.opacity(0.18)))
            c.fill(Path(CGRect(x: 8, y: y, width: 3, height: LH)), with: .color(SimColor.amber))
        }
        for (i, line) in code.enumerated() { Sim.text(&c, line, 18, 16 + Double(i) * LH + 9, size: 11.5, color: Int(ln.rounded()) == i + 1 ? SimColor.brassHi : SimColor.ink, mono: true) }
        for (x, label) in [(sx, "stack"), (hx, "heap")] {
            c.stroke(Sim.roundRect(x - 4, top, colW + 8, h - top - 10, 6), with: .color(SimColor.amber.opacity(0.3)), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
            Sim.text(&c, label, x + 2, top + 14, size: 12, color: SimColor.brass)
        }
        var ids: [String] = []
        for b in A.boxes + B.boxes where !ids.contains(b.id) { ids.append(b.id) }
        var at: [String: (x: Double, y: Double, alpha: Double, heap: Bool)] = [:]
        for id in ids {
            let a = A.boxes.first { $0.id == id }, b = B.boxes.first { $0.id == id }
            guard let any = b ?? a else { continue }
            let pa = a.map(pos), pb = b.map(pos)
            let x: Double, y: Double
            if let pa, let pb { x = Sim.lerp(Double(pa.x), Double(pb.x), t); y = Sim.lerp(Double(pa.y), Double(pb.y), t) }
            else { let p = (pa ?? pb)!; x = Double(p.x); y = Double(p.y) + (a == nil ? (1 - t) * 14 : 0) }
            let alpha = a != nil && b != nil ? 1 : a != nil ? 1 - t : t
            let box = t < 0.5 ? (a ?? any) : any
            drawBox(&c, box, x, y, colW, bh, alpha)
            at[id] = (x, y, alpha, box.heap)
        }
        let S = t < 0.5 ? A : B
        for (from, to, style) in S.arrows {
            guard let p = at[from], let q = at[to] else { continue }
            let x1 = p.x + (p.heap ? 0 : colW) - 8, y1 = p.y + bh / 2
            let x2 = q.x > p.x ? q.x - 2 : q.x + colW + 2, y2 = q.y + bh / 2
            let col = style == 2 ? SimColor.red : style == 1 ? SimColor.glow : SimColor.brass
            let had = A.arrows.contains { $0.0 == from && $0.1 == to }
            var g = c
            g.opacity = min(p.alpha, q.alpha) * (t < 0.5 && !had ? 1 - (0.5 - t) * 2 : 1)
            if q.x == p.x {
                let ox = p.x + colW + 14
                var path = Path(); path.move(to: CGPoint(x: x1, y: y1))
                path.addCurve(to: CGPoint(x: p.x + colW + 2, y: y2), control1: CGPoint(x: ox, y: y1), control2: CGPoint(x: ox, y: y2))
                g.stroke(path, with: .color(col), lineWidth: 1.6)
                Sim.arrow(&g, p.x + colW + 8, y2, p.x + colW + 1, y2, color: col)
            } else {
                Sim.arrow(&g, x1, y1, x2, y2, color: col, width: 1.8, dash: style == 2 ? [4, 3] : [])
            }
        }
    }

    private func drawBox(_ c: inout GraphicsContext, _ b: MBox, _ x: Double, _ y: Double, _ w: Double, _ h: Double, _ a: Double) {
        var g = c; g.opacity = a
        let r = Sim.roundRect(x, y, w, h, 4)
        g.fill(r, with: .color(b.dead ? SimColor.red.opacity(0.12) : b.hot ? SimColor.teal.opacity(0.2) : SimColor.ink.opacity(0.07)))
        g.stroke(r, with: .color(b.dead ? SimColor.red : b.hot ? SimColor.glow : SimColor.brass), style: StrokeStyle(lineWidth: 1.4, dash: b.dead ? [3, 3] : []))
        Sim.text(&g, b.name, x + 6, y + 14, size: 11, color: SimColor.dim)
        Sim.text(&g, b.val, x + 6, y + 32, size: 13, color: b.dead ? SimColor.red : SimColor.ink, mono: true, weight: .semibold)
        if let addr = b.addr { Sim.text(&g, addr, x + w - 6, y + 14, size: 9.5, color: SimColor.faint, align: .right, mono: true) }
    }

    // MARK: vector growth

    private func drawVector(_ c: inout GraphicsContext, _ w: Double, _ h: Double) {
        let cell = min(34, (w - 30) / Double(max(8, V.moving?.to ?? V.cap)))
        func row(_ c: inout GraphicsContext, _ cap: Int, _ y: Double, _ alpha: Double, _ label: String) {
            var g = c; g.opacity = max(0, min(1, alpha))
            Sim.text(&g, label, 14, y - 8, size: 11.5, color: SimColor.dim)
            for i in 0..<cap { g.stroke(Sim.roundRect(14 + Double(i) * cell, y, cell - 4, cell - 4, 3), with: .color(SimColor.brass), lineWidth: 1.2) }
        }
        func cellAt(_ c: inout GraphicsContext, _ x: Double, _ y: Double, _ v: Int, _ hot: Bool) {
            c.fill(Sim.roundRect(x, y, cell - 4, cell - 4, 3), with: .color(hot ? SimColor.teal.opacity(0.35) : SimColor.amber.opacity(0.3)))
            Sim.text(&c, "\(v)", x + (cell - 4) / 2, y + cell / 2 + 2, size: min(12, cell * 0.36), color: SimColor.ink, align: .center, mono: true)
        }
        Sim.text(&c, "std::vector<int> v;   size \(V.items.count)   capacity \(V.cap)", 14, 22, size: 12.5, color: SimColor.ink, mono: true)
        Sim.text(&c, "heap block", 14, 46, size: 11.5, color: SimColor.brass)
        let y0 = 70.0, y1 = 160.0
        if let m = V.moving {
            let k = Sim.ease(min(1, m.t))
            row(&c, m.from, y0, 1 - max(0, m.t - 1), "old block (\(m.from))")
            row(&c, m.to, y1, min(1, m.t * 3), "new block (\(m.to)): every element is copied over")
            for (i, it) in V.items.enumerated() {
                let sk = max(0, min(1, k * 1.6 - Double(i) * 0.12))
                cellAt(&c, 14 + Double(i) * cell, Sim.lerp(y0, y1, Sim.ease(sk)), it.v, sk > 0 && sk < 1)
            }
        } else {
            row(&c, V.cap, y0, 1, "")
            for (i, it) in V.items.enumerated() { cellAt(&c, 14 + Double(i) * cell, y0 - (1 - Sim.ease(min(1, it.born))) * 30, it.v, it.born < 1) }
        }
        Sim.text(&c, "full? it moves to a block twice as big", 14, h - 40, size: 12, color: SimColor.dim)
        Sim.text(&c, "copies so far: \(V.copies)  (≈ 1 per element on average)", 14, h - 20, size: 12, color: SimColor.amber, mono: true)
    }
}

final class VecGrowth: LiveSim {
    var items: [(v: Int, born: Double)] = [], cap = 1, copies = 0, nextVal = 10
    var moving: (from: Int, to: Int, t: Double, pending: Int)?
    func push() {
        if moving != nil { return }
        if items.count == cap { moving = (cap, cap * 2, 0, nextVal) } else { items.append((nextVal, 0)) }
        nextVal += 10; kick()
    }
    func pop() { if moving == nil && !items.isEmpty { items.removeLast(); kick() } }
    func clear() { items = []; cap = 1; copies = 0; nextVal = 10; moving = nil; kick() }
    func tick(_ dt: Double) -> Bool {
        var busy = false
        if var m = moving {
            m.t += dt * 0.8; busy = true
            if m.t >= 1.3 { copies += items.count; cap = m.to; items.append((m.pending, 0)); moving = nil } else { moving = m }
        }
        for i in items.indices where items[i].born < 1 { items[i].born = min(1, items[i].born + dt * 3); busy = true }
        return busy
    }
}
