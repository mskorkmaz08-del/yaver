// Vector loom (twin of js/sims/vectors.js): drag vectors and basis arrows and watch
// the plane respond: linear combinations and span, matrices bending the grid,
// determinant as area, eigenvectors, dot product as projection, change of basis,
// and a 3D rotation you can orbit.
import SwiftUI

typealias V2 = (Double, Double)

final class VecModel: LiveSim {
    @Published var kind = "transform"
    @Published var ca = 1.0, cb = 1.0, rx = -0.5, ry = 0.6, cross = false
    @Published var preset = "custom"
    var a: V2 = (2, 1), b: V2 = (-1, 2), i: V2 = (1, 0.5), j: V2 = (-0.5, 1), x: V2 = (1.5, 1), p: V2 = (2, 1.5)
    var t = 1.0, tt = 1.0, yaw = 0.6, pitch = -0.4, spin = 0.0, dragging3 = false
    var drag: String?, lastPt: CGPoint?

    static let handles: [String: [String]] = ["span": ["a", "b"], "transform": ["i", "j", "x"], "det": ["i", "j"], "eigen": ["i", "j"], "dot": ["a", "b"], "basis": ["i", "j", "p"], "3d": []]
    static let presets: [String: (V2, V2)] = ["rotate": ((0, 1), (-1, 0)), "shear": ((1, 0), (1, 1)), "scale": ((2, 0), (0, 0.5)), "reflect": ((1, 0), (0, -1)), "squash": ((1, 0.5), (2, 1))]
    var matrixKind: Bool { kind == "transform" || kind == "det" || kind == "eigen" }

    /// [a b c d]: î = (a, b), ĵ = (c, d), eased from the identity.
    func M() -> [Double] { let e = Sim.ease(Sim.clamp(t, 0, 1)); return [Sim.lerp(1, i.0, e), Sim.lerp(0, i.1, e), Sim.lerp(0, j.0, e), Sim.lerp(1, j.1, e)] }
    static func apply(_ m: [Double], _ v: V2) -> V2 { (m[0] * v.0 + m[2] * v.1, m[1] * v.0 + m[3] * v.1) }
    func get(_ k: String) -> V2 { switch k { case "a": return a; case "b": return b; case "i": return i; case "j": return j; case "x": return x; default: return p } }
    func set(_ k: String, _ v: V2) { switch k { case "a": a = v; case "b": b = v; case "i": i = v; case "j": j = v; case "x": x = v; default: p = v } }
    func handlePos(_ k: String) -> V2 { matrixKind ? (k == "x" ? Self.apply(M(), x) : Self.apply(M(), k == "i" ? (1, 0) : (0, 1))) : get(k) }

    func refresh() {
        spin = kind == "3d" ? 1 : 0
        if kind == "eigen" { i = (1.5, 0.5); j = (0.5, 1) }
        preset = "custom"
        t = 0; tt = 1; kick()
    }
    func tick(_ dt: Double) -> Bool {
        t += (tt - t) * (1 - Foundation.exp(-dt * 4))
        let moving = abs(tt - t) > 0.002
        if kind == "3d" { if !dragging3 { yaw += dt * 0.25 * spin }; return moving || spin > 0 || dragging3 }
        return moving
    }
}

struct VectorsSim: View {
    let mode: String
    var height: CGFloat = 300
    @StateObject private var M = VecModel()
    @State private var started = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker("Kind", selection: Binding(get: { M.kind }, set: { M.kind = $0; M.refresh() })) {
                Text("Span: a·a + b·b").tag("span"); Text("Matrix as a transformation").tag("transform"); Text("Determinant as area").tag("det")
                Text("Eigenvectors").tag("eigen"); Text("Dot product and projection").tag("dot"); Text("Change of basis").tag("basis"); Text("3D rotation and cross product").tag("3d")
            }.labelsHidden().fixedSize()
            GeometryReader { g in
                TimelineView(.animation(paused: !M.live)) { tl in
                    Canvas { c, size in
                        let dt = M.frame(tl.date)
                        if !M.tick(dt) { M.stop() }
                        Sim.plate(&c, size)
                        draw(&c, Double(size.width), Double(size.height))
                    }
                }
                .contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 0)
                    .onChanged { v in dragMoved(v, Double(g.size.width), Double(g.size.height)) }
                    .onEnded { _ in M.drag = nil; M.dragging3 = false; M.lastPt = nil; M.spin = M.kind == "3d" ? 1 : 0; M.kick() })
            }
            .frame(height: height)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            extra
            Text(caption).font(.caption).foregroundStyle(Theme.dim)
        }
        .onAppear {
            if !started { started = true; M.kind = ["span", "transform", "det", "eigen", "dot", "basis", "3d"].contains(mode) ? mode : "transform"; M.refresh() }
        }
    }

    private var caption: String {
        switch M.kind {
        case "span": return "Drag the tips of a and b, then slide the amounts. Line them up and the span collapses to a line."
        case "det": return "The shaded square is the unit square after the matrix: its area is the determinant. Flip ĵ past î and it turns red."
        case "eigen": return "Green lines are eigenvectors: directions the matrix only stretches, by λ."
        case "dot": return "Drag a and b. The green arrow is b projected onto a; a·b is its length times |a|."
        case "basis": return "Drag the new basis b₁, b₂ and the point: the same point gets different coordinates."
        case "3d": return "Drag to orbit. The sliders build a rotation matrix whose columns are where x, y and z land."
        default: return "Drag î and ĵ: they are the matrix’s columns, and the whole grid follows. x moves with them."
        }
    }

    @ViewBuilder private var extra: some View {
        if M.kind == "span" {
            slider("a", Binding(get: { M.ca }, set: { M.ca = ($0 * 4).rounded() / 4; M.kick() }), -3...3, Sim.fmt(M.ca))
            slider("b", Binding(get: { M.cb }, set: { M.cb = ($0 * 4).rounded() / 4; M.kick() }), -3...3, Sim.fmt(M.cb))
        }
        if M.matrixKind {
            HStack {
                Picker("Matrix", selection: Binding(get: { M.preset }, set: { k in
                    M.preset = k
                    if let p = VecModel.presets[k] { M.i = p.0; M.j = p.1 }
                    M.t = 0; M.tt = 1; M.kick()
                })) {
                    Text("Your own (drag î and ĵ)").tag("custom"); Text("Rotate 90°").tag("rotate"); Text("Shear").tag("shear"); Text("Stretch").tag("scale"); Text("Reflect").tag("reflect"); Text("Squash flat").tag("squash")
                }.labelsHidden().fixedSize()
                Button("Replay") { M.t = 0; M.tt = 1; M.kick() }.buttonStyle(.borderedProminent)
            }.controlSize(.small)
        }
        if M.kind == "3d" {
            slider("turn x", Binding(get: { M.rx }, set: { M.rx = $0; M.kick() }), -3.14...3.14, "\(Int((M.rx * 180 / .pi).rounded()))°")
            slider("turn y", Binding(get: { M.ry }, set: { M.ry = $0; M.kick() }), -3.14...3.14, "\(Int((M.ry * 180 / .pi).rounded()))°")
            Button(M.cross ? "Show the cube" : "Show a × b") { M.cross.toggle(); M.kick() }.buttonStyle(.bordered).controlSize(.small)
        }
    }
    private func slider(_ label: String, _ b: Binding<Double>, _ r: ClosedRange<Double>, _ shown: String) -> some View {
        HStack { Text(label).font(.caption).frame(width: 48, alignment: .leading); Slider(value: b, in: r); Text(shown).font(.caption.monospacedDigit()).frame(width: 44, alignment: .trailing) }
    }

    // MARK: geometry

    private func S(_ w: Double, _ h: Double) -> Double { Sim.clamp(min(w, h) / 9, 24, 48) }
    private func toPx(_ v: V2, _ w: Double, _ h: Double) -> CGPoint { let k = S(w, h); return CGPoint(x: w / 2 + v.0 * k, y: h / 2 + 8 - v.1 * k) }
    private func toU(_ p: CGPoint, _ w: Double, _ h: Double) -> V2 {
        let k = S(w, h)
        return (((Double(p.x) - w / 2) / k * 4).rounded() / 4, ((h / 2 + 8 - Double(p.y)) / k * 4).rounded() / 4)
    }

    private func dragMoved(_ v: DragGesture.Value, _ w: Double, _ h: Double) {
        let p = v.location
        if M.kind == "3d" {
            if let last = M.lastPt {
                M.yaw += Double(p.x - last.x) * 0.01
                M.pitch = Sim.clamp(M.pitch + Double(p.y - last.y) * 0.01, -1.4, 1.4)
            }
            M.dragging3 = true; M.spin = 0; M.lastPt = p; M.kick(); return
        }
        if M.drag == nil && M.lastPt == nil {
            M.lastPt = p
            for k in VecModel.handles[M.kind] ?? [] {
                let q = toPx(M.handlePos(k), w, h)
                if hypot(Double(q.x - v.startLocation.x), Double(q.y - v.startLocation.y)) < 24 { M.drag = k }
            }
            if M.drag != nil && M.matrixKind { M.t = 1; M.tt = 1 }
        }
        guard let k = M.drag else { return }
        var u = toU(p, w, h)
        if k == "x" && M.kind == "transform" {
            let m = M.M(), det = m[0] * m[3] - m[1] * m[2]
            if abs(det) > 1e-6 { u = ((u.0 * m[3] - u.1 * m[2]) / det, (m[0] * u.1 - m[1] * u.0) / det) }
        }
        M.set(k, u); M.preset = "custom"; M.kick()
    }

    // MARK: drawing

    private func vec(_ c: inout GraphicsContext, _ from: V2, _ to: V2, _ col: Color, _ label: String, _ width: Double, _ w: Double, _ h: Double) {
        let p1 = toPx(from, w, h), p2 = toPx(to, w, h)
        Sim.arrow(&c, p1.x, p1.y, p2.x, p2.y, color: col, width: width, head: 9)
        if !label.isEmpty { Sim.text(&c, label, p2.x + 6, p2.y - 6, size: 15, color: col, weight: .semibold) }
    }
    private func grid(_ c: inout GraphicsContext, _ m: [Double], _ col: Color, _ w: Double, _ h: Double) {
        var p = Path()
        let R = 8.0
        for k in -8...8 {
            let kk = Double(k)
            p.move(to: toPx(VecModel.apply(m, (kk, -R)), w, h)); p.addLine(to: toPx(VecModel.apply(m, (kk, R)), w, h))
            p.move(to: toPx(VecModel.apply(m, (-R, kk)), w, h)); p.addLine(to: toPx(VecModel.apply(m, (R, kk)), w, h))
        }
        c.stroke(p, with: .color(col), lineWidth: 1)
    }
    private func axes(_ c: inout GraphicsContext, _ w: Double, _ h: Double) {
        var p = Path()
        p.move(to: CGPoint(x: 0, y: h / 2 + 8)); p.addLine(to: CGPoint(x: w, y: h / 2 + 8))
        p.move(to: CGPoint(x: w / 2, y: 0)); p.addLine(to: CGPoint(x: w / 2, y: h))
        c.stroke(p, with: .color(SimColor.ink.opacity(0.35)), lineWidth: 1.2)
    }
    private func band(_ c: inout GraphicsContext, _ d: V2, _ col: Color, _ width: Double, _ w: Double, _ h: Double) {
        c.stroke(Path { p in p.move(to: toPx((-d.0 * 9, -d.1 * 9), w, h)); p.addLine(to: toPx((d.0 * 9, d.1 * 9), w, h)) }, with: .color(col.opacity(0.3)), lineWidth: width)
    }

    private func draw(_ c: inout GraphicsContext, _ w: Double, _ h: Double) {
        let id = [1.0, 0, 0, 1]
        switch M.kind {
        case "3d": draw3d(&c, w, h); return
        case "span":
            grid(&c, id, SimColor.teal.opacity(0.1), w, h); axes(&c, w, h)
            let ra: V2 = (M.a.0 * M.ca, M.a.1 * M.ca), r: V2 = (ra.0 + M.b.0 * M.cb, ra.1 + M.b.1 * M.cb)
            let det = M.a.0 * M.b.1 - M.a.1 * M.b.0
            if abs(det) < 1e-6 { band(&c, M.a, SimColor.amber, 6, w, h) }
            vec(&c, (0, 0), ra, SimColor.amber.opacity(0.7), "", 2, w, h); vec(&c, ra, r, SimColor.violet.opacity(0.8), "", 2, w, h)
            vec(&c, (0, 0), M.a, SimColor.amber, "a", 2.4, w, h); vec(&c, (0, 0), M.b, SimColor.violet, "b", 2.4, w, h); vec(&c, (0, 0), r, SimColor.glow, "", 3, w, h)
            Sim.text(&c, "\(Sim.fmt(M.ca))·a + \(Sim.fmt(M.cb))·b = (\(Sim.fmt(r.0)), \(Sim.fmt(r.1)))", 14, 22, size: 14, color: SimColor.ink, mono: true)
            Sim.text(&c, abs(det) < 1e-6 ? "a and b line up: their span is only a line" : "a and b point different ways: they span the whole plane", 14, h - 12, size: 13, color: abs(det) < 1e-6 ? SimColor.amber : SimColor.dim)
        case "dot":
            grid(&c, id, SimColor.teal.opacity(0.1), w, h); axes(&c, w, h)
            let d = M.a.0 * M.b.0 + M.a.1 * M.b.1
            let la = hypot(M.a.0, M.a.1) == 0 ? 1 : hypot(M.a.0, M.a.1), lb = hypot(M.b.0, M.b.1) == 0 ? 1 : hypot(M.b.0, M.b.1)
            let proj: V2 = (d / (la * la) * M.a.0, d / (la * la) * M.a.1)
            c.stroke(Path { p in p.move(to: toPx(M.b, w, h)); p.addLine(to: toPx(proj, w, h)) }, with: .color(SimColor.dim), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
            vec(&c, (0, 0), proj, d >= 0 ? SimColor.green : SimColor.red, "", 5, w, h)
            vec(&c, (0, 0), M.a, SimColor.amber, "a", 2.4, w, h); vec(&c, (0, 0), M.b, SimColor.violet, "b", 2.4, w, h)
            let cosv = d / (la * lb)
            Sim.text(&c, "a·b = \(Sim.fmt(d))   cos θ = \(Sim.fmt(cosv))   θ = \(Int((Foundation.acos(Sim.clamp(cosv, -1, 1)) * 180 / .pi).rounded()))°", 14, 22, size: 13.5, color: SimColor.ink, mono: true)
            Sim.text(&c, d > 0 ? "Positive: they point the same general way" : d < 0 ? "Negative: they point apart" : "Zero: perpendicular", 14, h - 12, size: 13, color: SimColor.dim)
        case "basis":
            grid(&c, id, SimColor.ink.opacity(0.08), w, h); grid(&c, [M.i.0, M.i.1, M.j.0, M.j.1], SimColor.amber.opacity(0.3), w, h); axes(&c, w, h)
            let det = M.i.0 * M.j.1 - M.i.1 * M.j.0
            let ok = abs(det) > 1e-6
            let co: V2 = ok ? ((M.p.0 * M.j.1 - M.p.1 * M.j.0) / det, (M.i.0 * M.p.1 - M.i.1 * M.p.0) / det) : (0, 0)
            vec(&c, (0, 0), M.i, SimColor.amber, "b₁", 2.4, w, h); vec(&c, (0, 0), M.j, SimColor.violet, "b₂", 2.4, w, h)
            let pp = toPx(M.p, w, h)
            c.fill(Sim.circle(pp.x, pp.y, 6), with: .color(SimColor.glow))
            Sim.text(&c, "standard (\(Sim.fmt(M.p.0)), \(Sim.fmt(M.p.1)))", 14, 22, size: 13.5, color: SimColor.ink, mono: true)
            Sim.text(&c, "in b₁,b₂: (\(ok ? Sim.fmt(co.0) : "—"), \(ok ? Sim.fmt(co.1) : "—"))", 14, 42, size: 13.5, color: SimColor.amber, mono: true)
        default:
            drawMatrix(&c, w, h)
        }
        for k in VecModel.handles[M.kind] ?? [] {
            let q = toPx(M.handlePos(k), w, h)
            c.stroke(Sim.circle(q.x, q.y, 9), with: .color(SimColor.brassHi), lineWidth: 1.5)
        }
    }

    private func drawMatrix(_ c: inout GraphicsContext, _ w: Double, _ h: Double) {
        let m = M.M()
        grid(&c, [1, 0, 0, 1], SimColor.ink.opacity(0.06), w, h)
        grid(&c, m, SimColor.teal.opacity(0.22), w, h)
        axes(&c, w, h)
        let det = m[0] * m[3] - m[1] * m[2]
        if M.kind != "eigen" {
            var sq = Path()
            for (k, q) in [(0.0, 0.0), (1, 0), (1, 1), (0, 1)].enumerated() { let pt = toPx(VecModel.apply(m, q), w, h); if k == 0 { sq.move(to: pt) } else { sq.addLine(to: pt) } }
            sq.closeSubpath()
            c.fill(sq, with: .color(det >= 0 ? SimColor.green.opacity(0.22) : SimColor.red.opacity(0.25)))
        } else {
            let a = M.i.0, b = M.i.1, cc = M.j.0, d = M.j.1
            let tr = a + d, dt2 = a * d - b * cc, disc = tr * tr / 4 - dt2
            if disc >= 0 {
                for lam in [tr / 2 + disc.squareRoot(), tr / 2 - disc.squareRoot()] {
                    var e: V2 = abs(cc) > 1e-9 ? (cc, lam - a) : abs(b) > 1e-9 ? (lam - d, b) : abs(lam - a) < 1e-9 ? (1, 0) : (0, 1)
                    let L = hypot(e.0, e.1) == 0 ? 1 : hypot(e.0, e.1)
                    e = (e.0 / L, e.1 / L)
                    band(&c, e, SimColor.green, 5, w, h)
                    vec(&c, (0, 0), VecModel.apply(m, e), SimColor.green, "λ=\(Sim.fmt(lam))", 3, w, h)
                }
            } else {
                Sim.text(&c, "No real eigenvectors: this matrix rotates every direction", 14, h - 12, size: 13, color: SimColor.amber)
            }
            for k in 0..<16 {
                let a0 = Double(k) / 16 * 2 * .pi
                vec(&c, (0, 0), VecModel.apply(m, (Foundation.cos(a0), Foundation.sin(a0))), SimColor.ink.opacity(0.35), "", 1.2, w, h)
            }
        }
        vec(&c, (0, 0), VecModel.apply(m, (1, 0)), SimColor.amber, "î", 2.4, w, h)
        vec(&c, (0, 0), VecModel.apply(m, (0, 1)), SimColor.violet, "ĵ", 2.4, w, h)
        if M.kind == "transform" { vec(&c, (0, 0), VecModel.apply(m, M.x), SimColor.glow, "x", 2.6, w, h) }
        Sim.text(&c, "[ \(Sim.fmt(M.i.0))  \(Sim.fmt(M.j.0)) ]", 14, 22, size: 14, color: SimColor.ink, mono: true)
        Sim.text(&c, "[ \(Sim.fmt(M.i.1))  \(Sim.fmt(M.j.1)) ]", 14, 40, size: 14, color: SimColor.ink, mono: true)
        if M.kind != "eigen" {
            Sim.text(&c, "det = \(Sim.fmt(det))\(det < 0 ? " (flipped)" : abs(det) < 1e-6 ? " (squashed flat)" : "")", w - 14, 22, size: 13.5, color: det < 0 ? SimColor.red : SimColor.green, align: .right, mono: true)
        }
    }

    // MARK: 3D

    private typealias V3 = (Double, Double, Double)
    private func rot(_ v: V3) -> V3 {
        let rx = M.rx, ry = M.ry
        var a = v.0, b = v.1 * Foundation.cos(rx) - v.2 * Foundation.sin(rx), c = v.1 * Foundation.sin(rx) + v.2 * Foundation.cos(rx)
        let a2 = a * Foundation.cos(ry) + c * Foundation.sin(ry), c2 = -a * Foundation.sin(ry) + c * Foundation.cos(ry)
        a = a2; c = c2
        return (a, b, c)
    }
    private func proj(_ v: V3, _ w: Double, _ h: Double) -> (Double, Double, Double) {
        let yaw = M.yaw, pitch = M.pitch
        let x = v.0 * Foundation.cos(yaw) + v.2 * Foundation.sin(yaw)
        var z = -v.0 * Foundation.sin(yaw) + v.2 * Foundation.cos(yaw)
        let y = v.1 * Foundation.cos(pitch) - z * Foundation.sin(pitch)
        z = v.1 * Foundation.sin(pitch) + z * Foundation.cos(pitch)
        let f = 5 / (5 + z), k = S(w, h) * 1.1
        return (w / 2 + x * k * f, h / 2 + 10 - y * k * f, z)
    }

    private func draw3d(_ c: inout GraphicsContext, _ w: Double, _ h: Double) {
        let o = proj((0, 0, 0), w, h)
        let axesList: [(V3, Color, String)] = [((2.4, 0, 0), SimColor.red, "x"), ((0, 2.4, 0), SimColor.green, "y"), ((0, 0, 2.4), SimColor.glow, "z")]
        for (p, col, l) in axesList {
            let q = proj(p, w, h)
            Sim.arrow(&c, o.0, o.1, q.0, q.1, color: col, width: 1.5, head: 7)
            Sim.text(&c, l, q.0 + 4, q.1 - 4, size: 13, color: col)
        }
        if M.cross {
            let ra = rot((1.6, 0.3, 0)), rb = rot((0.4, 1.4, 0.2))
            let cr: V3 = (ra.1 * rb.2 - ra.2 * rb.1, ra.2 * rb.0 - ra.0 * rb.2, ra.0 * rb.1 - ra.1 * rb.0)
            var par = Path()
            for (k, q) in [(0.0, 0.0, 0.0), ra, (ra.0 + rb.0, ra.1 + rb.1, ra.2 + rb.2), rb].enumerated() {
                let pp = proj(q, w, h); let pt = CGPoint(x: pp.0, y: pp.1)
                if k == 0 { par.move(to: pt) } else { par.addLine(to: pt) }
            }
            par.closeSubpath()
            c.fill(par, with: .color(SimColor.amber.opacity(0.18)))
            let vs: [(V3, Color, String)] = [(ra, SimColor.amber, "a"), (rb, SimColor.violet, "b"), (cr, SimColor.glow, "a×b")]
            for (p, col, l) in vs {
                let q = proj(p, w, h)
                Sim.arrow(&c, o.0, o.1, q.0, q.1, color: col, width: 2.6, head: 9)
                Sim.text(&c, l, q.0 + 5, q.1 - 5, size: 14, color: col, weight: .semibold)
            }
            Sim.text(&c, "|a×b| = \(Sim.fmt((cr.0 * cr.0 + cr.1 * cr.1 + cr.2 * cr.2).squareRoot())) = the shaded area", 14, 22, size: 13.5, color: SimColor.ink, mono: true)
        } else {
            let cube: [V3] = [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]
            let edges = [(0, 1), (1, 2), (2, 3), (3, 0), (4, 5), (5, 6), (6, 7), (7, 4), (0, 4), (1, 5), (2, 6), (3, 7)]
            let P = cube.map { proj(rot(($0.0 * 0.9, $0.1 * 0.9, $0.2 * 0.9)), w, h) }
            for (a, b) in edges {
                let z = (P[a].2 + P[b].2) / 2
                c.stroke(Sim.line(P[a].0, P[a].1, P[b].0, P[b].1), with: .color(z > 0 ? SimColor.amber.opacity(0.45) : SimColor.brassHi), lineWidth: z > 0 ? 1.2 : 2.2)
            }
            for q in P { c.fill(Sim.circle(q.0, q.1, 2.6), with: .color(SimColor.glow)) }
            let r = rot((1, 0, 0)), u = rot((0, 1, 0)), f = rot((0, 0, 1))
            let rows: [[Double]] = [[r.0, u.0, f.0], [r.1, u.1, f.1], [r.2, u.2, f.2]]
            for (k, row) in rows.enumerated() {
                let cells = row.map { v -> String in let s = Sim.fmt(v); return String(repeating: " ", count: max(0, 5 - s.count)) + s }
                Sim.text(&c, "[ \(cells.joined(separator: " ")) ]", 14, 22 + Double(k) * 17, size: 12.5, color: SimColor.ink, mono: true)
            }
        }
        Sim.text(&c, "drag to orbit", w - 14, h - 12, size: 12, color: SimColor.faint, align: .right)
    }
}
