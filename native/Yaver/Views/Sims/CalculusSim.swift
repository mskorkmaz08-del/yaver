// Slope machine (twin of js/sims/calculus.js): shrink a secant into a tangent, sweep
// a tangent along a curve while the derivative draws itself underneath, and roll
// gradient descent down a loss curve, a bowl, or a line being fitted to points.
import SwiftUI

/// A live animation driven by the display clock: tick() returns whether it still moves.
class LiveSim: ObservableObject {
    @Published var live = true
    var lastTick: Date?
    func kick() { lastTick = nil; if !live { live = true } }
    func frame(_ now: Date) -> Double {
        let dt = lastTick.map { min(0.05, now.timeIntervalSince($0)) } ?? 0.016
        lastTick = now
        return dt
    }
    func stop() { DispatchQueue.main.async { if self.live { self.live = false } } }
}

struct CalcFn { let f: (Double) -> Double; let d: (Double) -> Double; let label: String; let xr: (Double, Double) }

final class CalcModel: LiveSim {
    static let fns: [(String, CalcFn)] = [
        ("sq", CalcFn(f: { $0 * $0 }, d: { 2 * $0 }, label: "f(x) = x²", xr: (-3, 3))),
        ("cubic", CalcFn(f: { $0 * $0 * $0 - 3 * $0 }, d: { 3 * $0 * $0 - 3 }, label: "f(x) = x³ − 3x", xr: (-2.6, 2.6))),
        ("sin", CalcFn(f: { Foundation.sin($0) }, d: { Foundation.cos($0) }, label: "f(x) = sin x", xr: (-6.3, 6.3))),
        ("exp", CalcFn(f: { Foundation.exp($0) }, d: { Foundation.exp($0) }, label: "f(x) = eˣ  (its own slope)", xr: (-3, 2))),
        ("chain", CalcFn(f: { Foundation.sin($0 * $0) }, d: { 2 * $0 * Foundation.cos($0 * $0) }, label: "f(x) = sin(x²): chain rule 2x·cos(x²)", xr: (-2.5, 2.5))),
    ]
    static func loss1(_ x: Double) -> Double { 0.25 * (x - 1.2) * (x - 1.2) * (1 + 0.4 * Foundation.sin(2.4 * x)) + 0.4 }
    static let lossFn = CalcFn(f: loss1, d: { (loss1($0 + 1e-4) - loss1($0 - 1e-4)) / 2e-4 }, label: "loss", xr: (-3, 3))
    static let pts: [(Double, Double)] = (0..<12).map { i in
        let x = Double(i) / 11 * 4 - 2
        let r = (Foundation.sin(Double(i) * 12.9898) * 43758.5453).truncatingRemainder(dividingBy: 1)
        return (x, 0.8 * x + 0.5 + r * 0.6)
    }

    @Published var kind = "tangent"
    @Published var fk = "cubic"
    @Published var sub = "curve"
    @Published var th = 1.5
    @Published var lr = 0.1
    var x = 0.8, h = 1.5, sweep = false, trail: [Double] = [], running = false, gdT = 0.0
    var gx = -2.4, gpath: [Double] = [], bp = (-2.2, 1.8), bpath: [(Double, Double)] = [], m = -0.5, b = 2.0, losses: [Double] = []

    var fn: CalcFn { Self.fns.first { $0.0 == fk }?.1 ?? Self.fns[1].1 }

    func startGD() {
        gx = -2.4; gpath = [gx]; bp = (-2.2, 1.8); bpath = [bp]; m = -0.5; b = 2; losses = []; gdT = 0
    }
    func stepGD() {
        switch sub {
        case "curve": gx = Sim.clamp(gx - lr * 10 * Self.lossFn.d(gx), -3, 3); gpath.append(gx)
        case "bowl": bp = (bp.0 - lr * 2 * bp.0, bp.1 - lr * 4 * bp.1); bpath.append(bp)
        default:
            var dm = 0.0, db = 0.0, L = 0.0
            for (px, py) in Self.pts { let e = m * px + b - py; dm += 2 * e * px; db += 2 * e; L += e * e }
            let n = Double(Self.pts.count)
            m -= lr * dm / n; b -= lr * db / n; losses.append(L / n)
        }
    }
    func refresh() {
        trail = []
        if kind == "descent" { startGD(); running = true }
        kick()
    }

    /// Advances by dt; returns whether anything still moves.
    func tick(_ dt: Double) -> Bool {
        switch kind {
        case "descent":
            if running {
                gdT += dt
                if gdT > 0.28 { gdT = 0; stepGD(); if (sub == "fit" ? losses.count : sub == "bowl" ? bpath.count : gpath.count) > 60 { running = false } }
            }
            return running
        case "secant":
            h += (th - h) * (1 - Foundation.exp(-dt * 3))
            return abs(th - h) > 1e-4
        default:
            if sweep {
                let r = fn.xr
                x += dt * 0.8 * (r.1 - r.0) / 6
                if x > r.1 { x = r.1; sweep = false }
                trail.append(x)
            }
            return sweep
        }
    }
}

struct CalculusSim: View {
    let mode: String
    var height: CGFloat = 300
    @StateObject private var M = CalcModel()
    @State private var started = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TimelineView(.animation(paused: !M.live)) { tl in
                Canvas { c, size in
                    let dt = M.frame(tl.date)
                    if !M.tick(dt) { M.stop() }
                    Sim.plate(&c, size)
                    draw(&c, Double(size.width), Double(size.height))
                }
            }
            .frame(height: height)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(GeometryReader { g in
                Color.clear.contentShape(Rectangle()).gesture(DragGesture(minimumDistance: 0).onChanged { v in
                    guard M.kind != "descent" else { return }
                    let r = M.fn.xr, w = Double(g.size.width)
                    M.x = Sim.clamp(r.0 + (Double(v.location.x) - 20) / (w - 36) * (r.1 - r.0), r.0, r.1)
                    M.sweep = false; M.trail.append(M.x); M.kick()
                })
            })
            controls
            Text(caption).font(.caption).foregroundStyle(Theme.dim)
        }
        .onAppear {
            if !started {
                started = true
                M.kind = ["secant", "tangent", "descent"].contains(mode) ? mode : "tangent"
                M.fk = mode == "tangent" ? "chain" : "cubic"
                M.refresh()
            }
        }
    }

    private var caption: String {
        switch M.kind {
        case "secant": return "Drag the point, then tap Shrink h: the secant swings into the tangent and its slope becomes the derivative."
        case "descent": return "Each step moves against the slope, by learning rate × slope. Try a big learning rate in the bowl."
        default: return "Drag along the curve or tap Sweep: the green line below is the slope at every point, the derivative."
        }
    }

    @ViewBuilder private var controls: some View {
        let kindB = Binding(get: { M.kind }, set: { M.kind = $0; M.refresh() })
        let fnB = Binding(get: { M.fk }, set: { M.fk = $0; M.x = 0.8; M.trail = []; M.kick() })
        HStack {
            Picker("Kind", selection: kindB) { Text("Secant → tangent").tag("secant"); Text("Tangent and derivative").tag("tangent"); Text("Gradient descent").tag("descent") }.labelsHidden().fixedSize()
            if M.kind != "descent" {
                Picker("Function", selection: fnB) { ForEach(CalcModel.fns, id: \.0) { f in Text(f.1.label.components(separatedBy: ":")[0]).tag(f.0) } }.labelsHidden().fixedSize()
            }
        }
        if M.kind == "secant" {
            HStack {
                Text("h").font(.caption.monospaced())
                Slider(value: Binding(get: { M.th }, set: { M.th = $0; M.kick() }), in: 0.01...2)
                Button("Shrink h") { M.th = 0.001; M.kick() }.buttonStyle(.borderedProminent)
            }.controlSize(.small)
        }
        if M.kind == "tangent" {
            Button("Sweep") { M.x = M.fn.xr.0; M.trail = []; M.sweep = true; M.kick() }.buttonStyle(.borderedProminent).controlSize(.small)
        }
        if M.kind == "descent" {
            HStack {
                Picker("Problem", selection: Binding(get: { M.sub }, set: { M.sub = $0; M.startGD(); M.running = true; M.kick() })) {
                    Text("Down a loss curve").tag("curve"); Text("Down a bowl (2D)").tag("bowl"); Text("Fit a line").tag("fit")
                }.labelsHidden().fixedSize()
                Button("Run") { M.startGD(); M.running = true; M.kick() }.buttonStyle(.borderedProminent)
                Button("One step") { M.running = false; M.stepGD(); M.kick() }.buttonStyle(.bordered)
            }.controlSize(.small)
            HStack {
                Text("learning rate \(Sim.fmt(M.lr))").font(.caption.monospacedDigit())
                Slider(value: $M.lr, in: 0.01...0.9)
            }
        }
    }

    // MARK: drawing

    private struct Box { var l, r, t, b: Double }
    private func box(_ w: Double, _ h: Double) -> Box { Box(l: 20, r: w - 16, t: 34, b: h - (M.kind == "tangent" ? 96 : 24)) }
    private func yRange(_ fn: CalcFn) -> (Double, Double) {
        var lo = Double.infinity, hi = -Double.infinity
        for i in 0...80 { let y = fn.f(fn.xr.0 + (fn.xr.1 - fn.xr.0) * Double(i) / 80); lo = min(lo, y); hi = max(hi, y) }
        let p = (hi - lo) * 0.12
        return (lo - (p > 0 ? p : 1), hi + (p > 0 ? p : 1))
    }

    private func draw(_ c: inout GraphicsContext, _ w: Double, _ h: Double) {
        if M.kind == "descent" { drawDescent(&c, w, h); return }
        let fn = M.fn, bx = box(w, h), yr = yRange(fn)
        func X(_ x: Double) -> Double { bx.l + (x - fn.xr.0) / (fn.xr.1 - fn.xr.0) * (bx.r - bx.l) }
        func Y(_ y: Double) -> Double { bx.b - (y - yr.0) / (yr.1 - yr.0) * (bx.b - bx.t) }
        plot(&c, fn, bx, X, Y)
        if M.kind == "secant" {
            let h2 = max(1e-3, M.h), x1 = M.x + h2, m = (fn.f(x1) - fn.f(M.x)) / h2
            tline(&c, fn, M.x, fn.f(M.x), m, X, Y, SimColor.amber, 2)
            dot(&c, X(M.x), Y(fn.f(M.x)), SimColor.glow); dot(&c, X(x1), Y(fn.f(x1)), SimColor.amber, 5)
            Sim.text(&c, "h = \(Sim.fmt(h2))   secant slope = \(Sim.fmt(m))", 14, 22, size: 12.5, color: SimColor.ink, mono: true)
            Sim.text(&c, "true slope f′(x) = \(Sim.fmt(fn.d(M.x)))", 14, 40, size: 12.5, color: SimColor.green, mono: true)
            return
        }
        let m = fn.d(M.x)
        tline(&c, fn, M.x, fn.f(M.x), m, X, Y, SimColor.glow, 2)
        dot(&c, X(M.x), Y(fn.f(M.x)), SimColor.glow)
        let top = bx.b + 18, bot = h - 16
        var lo = Double.infinity, hi = -Double.infinity
        for i in 0...80 { let v = fn.d(fn.xr.0 + (fn.xr.1 - fn.xr.0) * Double(i) / 80); lo = min(lo, v); hi = max(hi, v) }
        let span = hi - lo == 0 ? 1 : hi - lo
        func DY(_ v: Double) -> Double { bot - (v - lo) / span * (bot - top) }
        c.stroke(Path(CGRect(x: bx.l, y: top, width: bx.r - bx.l, height: bot - top)), with: .color(SimColor.ink.opacity(0.15)), lineWidth: 1)
        if lo < 0 && hi > 0 { c.stroke(Sim.line(bx.l, DY(0), bx.r, DY(0)), with: .color(SimColor.ink.opacity(0.15)), lineWidth: 1) }
        var p = Path()
        for (i, x) in M.trail.enumerated() { let pt = CGPoint(x: X(x), y: DY(fn.d(x))); if i == 0 { p.move(to: pt) } else { p.addLine(to: pt) } }
        c.stroke(p, with: .color(SimColor.green), lineWidth: 2)
        dot(&c, X(M.x), DY(m), SimColor.green, 4)
        Sim.text(&c, "f′(x)", bx.l + 4, top + 14, size: 12.5, color: SimColor.green)
        Sim.text(&c, fn.label, 14, 22, size: 12.5, color: SimColor.ink, mono: true)
        Sim.text(&c, "x = \(Sim.fmt(M.x))   slope = \(Sim.fmt(m))", 14, 40, size: 12.5, color: SimColor.amber, mono: true)
    }

    private func plot(_ c: inout GraphicsContext, _ fn: CalcFn, _ bx: Box, _ X: (Double) -> Double, _ Y: (Double) -> Double) {
        var ax = Path()
        let y0 = Y(0), x0 = X(0)
        if y0 > bx.t && y0 < bx.b { ax.move(to: CGPoint(x: bx.l, y: y0)); ax.addLine(to: CGPoint(x: bx.r, y: y0)) }
        if x0 > bx.l && x0 < bx.r { ax.move(to: CGPoint(x: x0, y: bx.t)); ax.addLine(to: CGPoint(x: x0, y: bx.b)) }
        c.stroke(ax, with: .color(SimColor.ink.opacity(0.3)), lineWidth: 1)
        var p = Path()
        for i in 0...160 {
            let x = fn.xr.0 + (fn.xr.1 - fn.xr.0) * Double(i) / 160
            let pt = CGPoint(x: X(x), y: Y(fn.f(x)))
            if i == 0 { p.move(to: pt) } else { p.addLine(to: pt) }
        }
        c.stroke(p, with: .color(SimColor.brass), lineWidth: 2.4)
    }
    private func tline(_ c: inout GraphicsContext, _ fn: CalcFn, _ x0: Double, _ y0: Double, _ m: Double, _ X: (Double) -> Double, _ Y: (Double) -> Double, _ col: Color, _ w: Double) {
        let a = fn.xr.0, b = fn.xr.1
        c.stroke(Sim.line(X(a), Y(y0 + m * (a - x0)), X(b), Y(y0 + m * (b - x0))), with: .color(col), lineWidth: w)
    }
    private func dot(_ c: inout GraphicsContext, _ x: Double, _ y: Double, _ col: Color, _ r: Double = 6) {
        c.fill(Sim.circle(x, y, r + 3), with: .color(col.opacity(0.25)))
        c.fill(Sim.circle(x, y, r), with: .color(col))
    }

    private func drawDescent(_ c: inout GraphicsContext, _ w: Double, _ h: Double) {
        if M.sub == "curve" {
            let fn = CalcModel.lossFn, bx = box(w, h), yr = yRange(fn)
            func X(_ x: Double) -> Double { bx.l + (x - fn.xr.0) / (fn.xr.1 - fn.xr.0) * (bx.r - bx.l) }
            func Y(_ y: Double) -> Double { bx.b - (y - yr.0) / (yr.1 - yr.0) * (bx.b - bx.t) }
            plot(&c, fn, bx, X, Y)
            for i in M.gpath.indices.dropFirst() {
                let a = M.gpath[i - 1], b = M.gpath[i]
                Sim.arrow(&c, X(a), Y(fn.f(a)), X(b), Y(fn.f(b)), color: SimColor.teal.opacity(0.5), width: 1.2, head: 5)
            }
            let d = fn.d(M.gx)
            dot(&c, X(M.gx), Y(fn.f(M.gx)), SimColor.glow, 8)
            tline(&c, fn, M.gx, fn.f(M.gx), d, X, Y, SimColor.amber.opacity(0.6), 1.4)
            Sim.text(&c, "step \(max(0, M.gpath.count - 1))   x = \(Sim.fmt(M.gx))", 14, 22, size: 12.5, color: SimColor.ink, mono: true)
            Sim.text(&c, "slope = \(Sim.fmt(d))   loss = \(Sim.fmt(fn.f(M.gx)))", 14, 40, size: 12.5, color: SimColor.amber, mono: true)
        } else if M.sub == "bowl" {
            let cx = w / 2, cy = h / 2 + 6, k = min(w, h) / 6.4
            for r in stride(from: 8, through: 1, by: -1) {
                let rr = Double(r)
                let rx = rr.squareRoot() * k * 0.9, ry = (rr / 2).squareRoot() * k * 0.9
                c.stroke(Path(ellipseIn: CGRect(x: cx - rx, y: cy - ry, width: 2 * rx, height: 2 * ry)), with: .color(SimColor.amber.opacity(0.08 + (8 - rr) * 0.04)), lineWidth: 1.2)
            }
            var p = Path()
            for (i, q) in M.bpath.enumerated() { let pt = CGPoint(x: cx + q.0 * k, y: cy - q.1 * k); if i == 0 { p.move(to: pt) } else { p.addLine(to: pt) } }
            c.stroke(p, with: .color(SimColor.glow), lineWidth: 2)
            dot(&c, cx + M.bp.0 * k, cy - M.bp.1 * k, SimColor.glow, 7)
            Sim.text(&c, "loss = x² + 2y²   step \(max(0, M.bpath.count - 1))", 14, 22, size: 12.5, color: SimColor.ink, mono: true)
            Sim.text(&c, "at (\(Sim.fmt(M.bp.0)), \(Sim.fmt(M.bp.1)))", 14, 40, size: 12.5, color: SimColor.amber, mono: true)
            if M.lr > 0.5 { Sim.text(&c, "Learning rate too big: it overshoots and zig-zags", 14, h - 12, size: 13, color: SimColor.red) }
        } else {
            let L = 30.0, R = w - 140, T = 40.0, B = h - 24
            func sx(_ x: Double) -> Double { L + (x + 2.4) / 4.8 * (R - L) }
            func sy(_ y: Double) -> Double { B - (y + 1.6) / 5 * (B - T) }
            c.stroke(Path(CGRect(x: L, y: T, width: R - L, height: B - T)), with: .color(SimColor.ink.opacity(0.2)), lineWidth: 1)
            for (px, py) in CalcModel.pts {
                let e = M.m * px + M.b - py
                c.stroke(Sim.line(sx(px), sy(py), sx(px), sy(py + e)), with: .color(SimColor.red.opacity(0.5)), lineWidth: 1)
                dot(&c, sx(px), sy(py), SimColor.amber, 4)
            }
            c.stroke(Sim.line(sx(-2.4), sy(M.m * -2.4 + M.b), sx(2.4), sy(M.m * 2.4 + M.b)), with: .color(SimColor.glow), lineWidth: 2.4)
            let lx = R + 16, lw = w - lx - 12, lh = 70.0, ly = T + 20
            c.stroke(Path(CGRect(x: lx, y: ly, width: lw, height: lh)), with: .color(SimColor.ink.opacity(0.2)), lineWidth: 1)
            let ls = M.losses, mx = max(ls.max() ?? 0, 1e-9)
            var p = Path()
            for (i, v) in ls.enumerated() {
                let pt = CGPoint(x: lx + Double(i) / Double(max(1, ls.count - 1)) * lw, y: ly + lh - v / mx * lh)
                if i == 0 { p.move(to: pt) } else { p.addLine(to: pt) }
            }
            c.stroke(p, with: .color(SimColor.green), lineWidth: 1.6)
            Sim.text(&c, "loss", lx, ly - 6, size: 12, color: SimColor.green)
            Sim.text(&c, "y = \(Sim.fmt(M.m))x + \(Sim.fmt(M.b))", 14, 22, size: 13, color: SimColor.ink, mono: true)
            if let v = ls.last { Sim.text(&c, Sim.fmt(v), lx, ly + lh + 16, size: 12, color: SimColor.green, mono: true) }
        }
    }
}
