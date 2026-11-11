// Probability mill (twin of js/sims/probability.js): dice sums piling into a histogram
// that settles on the true shape, sample means turning into a bell curve (the central
// limit theorem), bootstrap resampling, and a Bayes grid of 400 people.
import SwiftUI

struct Hist {
    var lo: Double, hi: Double, n: Int
    var c: [Double], shown: [Double], total = 0
    init(_ lo: Double, _ hi: Double, _ n: Int) { self.lo = lo; self.hi = hi; self.n = n; c = Array(repeating: 0, count: n); shown = c }
    func bin(_ v: Double) -> Int { Int(Sim.clamp(floor((v - lo) / (hi - lo) * Double(n)), 0, Double(n - 1))) }
    mutating func add(_ v: Double) { c[bin(v)] += 1; total += 1 }
    mutating func settle(_ dt: Double) -> Bool {
        var moving = false
        for i in c.indices { let d = c[i] - shown[i]; if abs(d) > 0.01 { shown[i] += d * min(1, dt * 10); moving = true } else { shown[i] = c[i] } }
        return moving
    }
}

struct Ball { var x, y, vy, tx, ty: Double; var delay: Double; var color: Color; var land: () -> Void }

final class ProbModel: LiveSim {
    struct Pop { let name: String; let draw: () -> Double; let lo, hi, mean, sd: Double }
    static let pops: [(String, Pop)] = [
        ("skewed", Pop(name: "Waiting times (skewed)", draw: { -Foundation.log(1 - Double.random(in: 0..<1)) * 2 }, lo: 0, hi: 10, mean: 2, sd: 2)),
        ("uniform", Pop(name: "Uniform 0–10", draw: { Double.random(in: 0..<10) }, lo: 0, hi: 10, mean: 5, sd: 10 / 12.0.squareRoot())),
        ("humps", Pop(name: "Two humps", draw: { (Bool.random() ? 2.5 : 7.5) + (Double.random(in: 0..<1) - 0.5) * 2.4 }, lo: 0, hi: 10, mean: 5, sd: (2.5 * 2.5 + 2.4 * 2.4 / 12).squareRoot())),
    ]
    static let sample = [3.1, 4.7, 2.2, 5.9, 4.1, 3.8, 6.4, 2.9, 5.2, 4.4, 7.1, 3.5]

    @Published var kind = "dice"
    @Published var dice = 2.0
    @Published var pop = "skewed"
    @Published var n = 5.0
    @Published var prev = 0.05
    @Published var sens = 0.9
    @Published var fpr = 0.08
    var H = Hist(1.5, 12.5, 11), P = Hist(0, 10, 30), Mh = Hist(0, 10, 40)
    var last: [(f: Int, spin: Double)] = [], picks: [(x: Double, i: Int, life: Double)] = [], means: [Double] = []
    var balls: [Ball] = [], tested = 0.0, testing = false
    var people: [(r: Double, q: Double)] = []
    var size = CGSize(width: 340, height: 300)

    var popDef: Pop { Self.pops.first { $0.0 == pop }?.1 ?? Self.pops[0].1 }
    var nd: Int { Int(dice) }
    var nn: Int { Int(n) }

    func reset() {
        balls = []; picks = []; last = []; means = []; tested = 0; testing = false
        switch kind {
        case "dice": H = Hist(Double(nd) - 0.5, Double(6 * nd) + 0.5, 5 * nd + 1)
        case "clt":
            let p = popDef
            P = Hist(p.lo, p.hi, 30)
            for _ in 0..<3000 { P.add(p.draw()) }
            P.shown = P.c
            Mh = Hist(p.lo, p.hi, 40)
        case "bootstrap": Mh = Hist(2, 7, 25)
        default: people = (0..<400).map { _ in (Double.random(in: 0..<1), Double.random(in: 0..<1)) }
        }
        kick()
    }

    // layout
    var w: Double { Double(size.width) }
    var h: Double { Double(size.height) }
    var box: (l: Double, r: Double, t: Double, b: Double) { (20, w - 20, 120, h - 30) }
    var upper: (l: Double, r: Double, t: Double, b: Double) { (20, w - 20, 40, h * 0.42) }
    var lower: (l: Double, r: Double, t: Double, b: Double) { (20, w - 20, h * 0.55, h - 28) }
    func xOn(_ v: Double) -> Double { let b = lower; return b.l + (v - Mh.lo) / (Mh.hi - Mh.lo) * (b.r - b.l) }

    func roll(_ times: Int) {
        for k in 0..<times {
            let faces = (0..<nd).map { _ in Int.random(in: 1...6) }
            let sum = Double(faces.reduce(0, +))
            if k == times - 1 { last = faces.map { ($0, 1.0) } }
            if times <= 20 {
                let b = box, bw = (b.r - b.l) / Double(H.n), i = H.bin(sum)
                balls.append(Ball(x: w / 2, y: 70, vy: -60, tx: b.l + (Double(i) + 0.5) * bw, ty: b.b - 6, delay: Double(k) * 0.09, color: SimColor.amber) { [weak self] in self?.H.add(sum) })
            } else { H.add(sum) }
        }
        kick()
    }
    func expect() -> [Double] {
        var dist = [1.0]
        for _ in 0..<nd {
            var nx = Array(repeating: 0.0, count: dist.count + 6)
            for (i, p) in dist.enumerated() { for f in 1...6 { nx[i + f] += p / 6 } }
            dist = nx
        }
        return (0..<H.n).map { i in i + nd < dist.count ? dist[i + nd] : 0 }
    }
    func draw(_ times: Int) {
        let p = popDef
        for _ in 0..<times {
            let xs = (0..<nn).map { _ in p.draw() }
            let m = xs.reduce(0, +) / Double(nn)
            if times == 1 {
                picks = xs.map { ($0, 0, 1.0) }
                balls.append(Ball(x: xOn(m), y: upper.b + 4, vy: -60, tx: xOn(m), ty: lower.b - 4, delay: 0.38, color: SimColor.glow) { [weak self] in self?.Mh.add(m) })
            } else { Mh.add(m) }
        }
        kick()
    }
    func resample(_ times: Int) {
        for _ in 0..<times {
            let idx = (0..<Self.sample.count).map { _ in Int.random(in: 0..<Self.sample.count) }
            let m = idx.reduce(0.0) { $0 + Self.sample[$1] } / Double(idx.count)
            means.append(m)
            if times == 1 {
                picks = idx.map { (0, $0, 1.0) }
                balls.append(Ball(x: xOn(m), y: upper.b + 4, vy: -60, tx: xOn(m), ty: lower.b - 4, delay: 0.42, color: SimColor.glow) { [weak self] in self?.Mh.add(m) })
            } else { Mh.add(m) }
        }
        kick()
    }

    func tick(_ dt: Double) -> Bool {
        var busy = false
        var landed: [() -> Void] = []
        balls = balls.compactMap { (b0: Ball) -> Ball? in
            var b = b0
            busy = true
            if b.delay > 0 { b.delay -= dt; return b }
            b.vy += 900 * dt; b.x = Sim.lerp(b.x, b.tx, min(1, dt * 6)); b.y += b.vy * dt
            if b.y >= b.ty { landed.append(b.land); return nil }
            return b
        }
        landed.forEach { $0() }
        switch kind {
        case "dice":
            for i in last.indices where last[i].spin > 0 { last[i].spin = max(0, last[i].spin - dt * 1.8); busy = true }
            busy = H.settle(dt) || busy
        case "clt", "bootstrap":
            for i in picks.indices where picks[i].life > 0 { picks[i].life = max(0, picks[i].life - dt * 1.2); busy = true }
            busy = Mh.settle(dt) || busy
        default:
            if testing { tested += dt * 260; if tested >= 400 { tested = 400; testing = false }; busy = true }
        }
        return busy
    }
}

struct ProbabilitySim: View {
    let mode: String
    var height: CGFloat = 300
    @StateObject private var M = ProbModel()
    @State private var started = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker("Kind", selection: Binding(get: { M.kind }, set: { M.kind = $0; M.reset() })) {
                Text("Dice and the law of large numbers").tag("dice"); Text("Central limit theorem").tag("clt"); Text("Bootstrap").tag("bootstrap"); Text("Conditional probability (Bayes)").tag("conditional")
            }.labelsHidden().fixedSize()
            TimelineView(.animation(paused: !M.live)) { tl in
                Canvas { c, size in
                    M.size = size
                    let dt = M.frame(tl.date)
                    if !M.tick(dt) { M.stop() }
                    Sim.plate(&c, size)
                    draw(&c, Double(size.width), Double(size.height))
                }
            }
            .frame(height: height)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            controls
            Text(note).font(.caption).foregroundStyle(Theme.dim)
        }
        .onAppear { if !started { started = true; M.kind = ["dice", "clt", "bootstrap", "conditional"].contains(mode) ? mode : "dice"; M.reset() } }
    }

    private var note: String {
        switch M.kind {
        case "clt": return "Draw n values, average them, drop the average below. Whatever the population looks like, the averages pile into a bell, narrower as n grows."
        case "bootstrap": return "You only have one sample. Resampling it with replacement shows how much its mean could wobble: the middle 95% is the interval."
        case "conditional": return "A good test on a rare illness: most positives are still healthy people. Move the rarity and watch the answer change."
        default: return "Each roll drops into its bar. Few rolls look random; many rolls settle onto the dashed expected shape. That is the law of large numbers."
        }
    }

    private func slider(_ label: String, _ b: Binding<Double>, _ r: ClosedRange<Double>, step: Double, _ shown: String) -> some View {
        HStack { Text(label).font(.caption).frame(width: 84, alignment: .leading); Slider(value: b, in: r, step: step); Text(shown).font(.caption.monospacedDigit()).frame(width: 40, alignment: .trailing) }
    }
    private func pct(_ v: Double) -> String { "\(Int((v * 100).rounded()))%" }

    @ViewBuilder private var controls: some View {
        switch M.kind {
        case "dice":
            slider("dice", Binding(get: { M.dice }, set: { M.dice = $0; M.reset() }), 1...4, step: 1, "\(M.nd)")
            HStack { Button("Roll") { M.roll(1) }.buttonStyle(.borderedProminent); Button("×10") { M.roll(10) }; Button("×500") { M.roll(500) } }.buttonStyle(.bordered).controlSize(.small)
        case "clt":
            Picker("Population", selection: Binding(get: { M.pop }, set: { M.pop = $0; M.reset() })) { ForEach(ProbModel.pops, id: \.0) { Text($0.1.name).tag($0.0) } }.labelsHidden().fixedSize()
            slider("n", Binding(get: { M.n }, set: { M.n = $0; M.Mh = Hist(M.popDef.lo, M.popDef.hi, 40); M.picks = []; M.kick() }), 1...30, step: 1, "\(M.nn)")
            HStack { Button("Draw") { M.draw(1) }.buttonStyle(.borderedProminent); Button("×200") { M.draw(200) } }.buttonStyle(.bordered).controlSize(.small)
        case "bootstrap":
            HStack { Button("Resample") { M.resample(1) }.buttonStyle(.borderedProminent); Button("×500") { M.resample(500) }; Button("Clear") { M.reset() } }.buttonStyle(.bordered).controlSize(.small)
        default:
            slider("sick", Binding(get: { M.prev }, set: { M.prev = $0; M.kick() }), 0.01...0.5, step: 0.01, pct(M.prev))
            slider("test catches", Binding(get: { M.sens }, set: { M.sens = $0; M.kick() }), 0.5...1, step: 0.01, pct(M.sens))
            slider("false alarms", Binding(get: { M.fpr }, set: { M.fpr = $0; M.kick() }), 0...0.3, step: 0.01, pct(M.fpr))
            Button("Test everyone") { M.tested = 0; M.testing = true; M.kick() }.buttonStyle(.borderedProminent).controlSize(.small)
        }
    }

    // MARK: drawing

    private typealias B4 = (l: Double, r: Double, t: Double, b: Double)
    private func hist(_ c: inout GraphicsContext, _ H: Hist, _ bx: B4, color: Color = SimColor.brass, expect: [Double]? = nil, curve: ((Double) -> Double)? = nil, shade: (Double, Double)? = nil) {
        let tot = Double(H.total)
        let maxE = expect.map { $0.map { $0 * tot }.max() ?? 0 } ?? 0
        let mx = max(1, H.c.max() ?? 0, maxE)
        let bw = (bx.r - bx.l) / Double(H.n)
        if let s = shade {
            c.fill(Path(CGRect(x: bx.l + (s.0 - H.lo) / (H.hi - H.lo) * (bx.r - bx.l), y: bx.t, width: (s.1 - s.0) / (H.hi - H.lo) * (bx.r - bx.l), height: bx.b - bx.t)), with: .color(SimColor.teal.opacity(0.08)))
        }
        for i in 0..<H.n {
            let y = bx.b - H.shown[i] / mx * (bx.b - bx.t)
            c.fill(Sim.roundRect(bx.l + Double(i) * bw + 1, y, bw - 2, bx.b - y, 2), with: .color(color.opacity(0.85)))
        }
        if let e = expect, H.total > 0 {
            var p = Path()
            for (i, v) in e.enumerated() { let y = bx.b - v * tot / mx * (bx.b - bx.t); p.move(to: CGPoint(x: bx.l + Double(i) * bw + 3, y: y)); p.addLine(to: CGPoint(x: bx.l + Double(i + 1) * bw - 3, y: y)) }
            c.stroke(p, with: .color(SimColor.glow), style: StrokeStyle(lineWidth: 2, dash: [4, 3]))
        }
        if let f = curve, H.total > 0 {
            var p = Path()
            for k in 0...80 {
                let x = H.lo + (H.hi - H.lo) * Double(k) / 80
                let pt = CGPoint(x: bx.l + Double(k) / 80 * (bx.r - bx.l), y: bx.b - f(x) * tot * ((H.hi - H.lo) / Double(H.n)) / mx * (bx.b - bx.t))
                if k == 0 { p.move(to: pt) } else { p.addLine(to: pt) }
            }
            c.stroke(p, with: .color(SimColor.glow), lineWidth: 2)
        }
        c.stroke(Sim.line(bx.l, bx.b + 0.5, bx.r, bx.b + 0.5), with: .color(SimColor.faint), lineWidth: 1)
    }

    private static let pips: [Int: [(Double, Double)]] = [1: [(0, 0)], 2: [(-1, -1), (1, 1)], 3: [(-1, -1), (0, 0), (1, 1)], 4: [(-1, -1), (1, -1), (-1, 1), (1, 1)],
                                                         5: [(-1, -1), (1, -1), (0, 0), (-1, 1), (1, 1)], 6: [(-1, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (1, 1)]]
    private func die(_ c: inout GraphicsContext, _ x: Double, _ y: Double, _ size: Double, _ f: Int, _ spin: Double) {
        var g = c
        g.translateBy(x: x, y: y); g.rotate(by: .radians(spin * 6))
        let r = Sim.roundRect(-size / 2, -size / 2, size, size, size * 0.18)
        g.fill(r, with: .linearGradient(Gradient(colors: [Color(hex: 0xeef1f4), Color(hex: 0xc4ccd4)]), startPoint: CGPoint(x: -size / 2, y: -size / 2), endPoint: CGPoint(x: size / 2, y: size / 2)))
        g.stroke(r, with: .color(SimColor.brass), lineWidth: 2)
        let face = spin > 0.15 ? Int.random(in: 1...6) : f
        for (a, b) in Self.pips[face] ?? [] { g.fill(Sim.circle(a * size * 0.26, b * size * 0.26, size * 0.08), with: .color(Color(hex: 0x2c2a26))) }
    }

    private func draw(_ c: inout GraphicsContext, _ w: Double, _ h: Double) {
        switch M.kind {
        case "dice":
            let b = M.box
            Sim.text(&c, "Sum of \(M.nd) \(M.nd > 1 ? "dice" : "die")   rolls: \(M.H.total)", 14, 22, size: 13, color: SimColor.ink, mono: true)
            let n = Double(M.last.count)
            for (i, d) in M.last.enumerated() { die(&c, w / 2 + (Double(i) - (n - 1) / 2) * 46, 70, 34, d.f, d.spin) }
            if !M.last.isEmpty && M.last.allSatisfy({ $0.spin <= 0 }) {
                Sim.text(&c, "= \(M.last.reduce(0) { $0 + $1.f })", w / 2 + n / 2 * 46 + 4, 76, size: 18, color: SimColor.amber, mono: true)
            }
            hist(&c, M.H, b, expect: M.expect())
            let bw = (b.r - b.l) / Double(M.H.n), step = M.H.n > 12 ? 2 : 1
            for i in stride(from: 0, to: M.H.n, by: step) { Sim.text(&c, "\(i + M.nd)", b.l + (Double(i) + 0.5) * bw, b.b + 15, size: 11, color: SimColor.dim, align: .center, mono: true) }
            Sim.text(&c, "- - - expected share", w - 14, 42, size: 11.5, color: SimColor.glow, align: .right, mono: true)
        case "clt", "bootstrap":
            drawMeans(&c, w, h)
        default:
            drawBayes(&c, w, h)
        }
        for b in M.balls where b.delay <= 0 {
            c.fill(Sim.circle(b.x, b.y, 8), with: .color(b.color.opacity(0.25)))
            c.fill(Sim.circle(b.x, b.y, 5), with: .color(b.color))
        }
    }

    private func drawMeans(_ c: inout GraphicsContext, _ w: Double, _ h: Double) {
        let u = M.upper, lb = M.lower
        if M.kind == "clt" {
            let P = M.popDef
            Sim.text(&c, "population", 14, 22, size: 13, color: SimColor.dim)
            hist(&c, M.P, u, color: SimColor.amber.opacity(0.55))
            for p in M.picks {
                let x = u.l + (p.x - P.lo) / (P.hi - P.lo) * (u.r - u.l)
                c.fill(Sim.circle(x, u.b - 6 - (1 - p.life) * 30, 5), with: .color(SimColor.amber.opacity(p.life)))
            }
            Sim.text(&c, "means of \(M.nn) draws: \(M.Mh.total)", 14, lb.t - 10, size: 13, color: SimColor.ink, mono: true)
            let sd = P.sd / Double(M.nn).squareRoot(), mean = P.mean
            let bell: (Double) -> Double = { x in Foundation.exp(-0.5 * pow((x - mean) / sd, 2)) / (sd * (2 * Double.pi).squareRoot()) }
            hist(&c, M.Mh, lb, color: SimColor.teal, curve: M.Mh.total > 30 ? bell : nil)
            if M.Mh.total > 30 { Sim.text(&c, "bell: spread \(Sim.fmt(P.sd))/√\(M.nn) = \(Sim.fmt(sd))", w - 14, lb.t + 8, size: 11, color: SimColor.glow, align: .right, mono: true) }
        } else {
            Sim.text(&c, "your one sample of 12", 14, 22, size: 13, color: SimColor.dim)
            let cw = (u.r - u.l) / 6
            for (i, v) in ProbModel.sample.enumerated() {
                let row = Double(i / 6), col = Double(i % 6), top = u.t + 4 + row * 40
                let hits = M.picks.filter { $0.i == i }
                let lit = hits.first?.life ?? 0
                let r = Sim.roundRect(u.l + col * cw + 3, top, cw - 6, 30, 4)
                c.fill(r, with: .color(SimColor.amber.opacity(lit > 0 ? 0.25 + 0.6 * lit : 0.12)))
                c.stroke(r, with: .color(SimColor.brass), lineWidth: 1)
                Sim.text(&c, Sim.fmt(v), u.l + (col + 0.5) * cw, top + 20, size: 12, color: SimColor.ink, align: .center, mono: true)
                if hits.count > 1 { Sim.text(&c, "×\(hits.count)", u.l + (col + 1) * cw - 8, top + 10, size: 10.5, color: SimColor.amber, align: .right, mono: true, weight: .bold) }
            }
            Sim.text(&c, "pick 12 with replacement, take the mean, repeat", 14, u.b + 2, size: 12, color: SimColor.dim)
            var shade: (Double, Double)? = nil
            if M.means.count >= 40 {
                let m = M.means.sorted()
                shade = (m[Int(Double(m.count) * 0.025)], m[Int((Double(m.count) * 0.975).rounded(.up)) - 1])
            }
            Sim.text(&c, "resampled means: \(M.Mh.total)", 14, lb.t - 10, size: 13, color: SimColor.ink, mono: true)
            hist(&c, M.Mh, lb, color: SimColor.teal, shade: shade)
            if let s = shade { Sim.text(&c, "95%: \(Sim.fmt(s.0)) – \(Sim.fmt(s.1))", w - 14, lb.t + 8, size: 11.5, color: SimColor.glow, align: .right, mono: true) }
        }
        for v in [M.Mh.lo, (M.Mh.lo + M.Mh.hi) / 2, M.Mh.hi] { Sim.text(&c, Sim.fmt(v), M.xOn(v), lb.b + 15, size: 11, color: SimColor.dim, align: .center, mono: true) }
    }

    private func drawBayes(_ c: inout GraphicsContext, _ w: Double, _ h: Double) {
        let n = 20.0, top = 34.0, side = min((w - 40) / n, (h - top - 70) / n), ox = (w - side * n) / 2
        var tp = 0, fp = 0
        for (i, p) in M.people.enumerated() {
            let sick = p.r < M.prev, pos = sick ? p.q < M.sens : p.q < M.fpr
            let shown = M.tested > Double(i)
            if shown && pos { if sick { tp += 1 } else { fp += 1 } }
            let x = ox + Double(i % 20) * side + side / 2, y = top + Double(i / 20) * side + side / 2
            let dot = Sim.circle(x, y, side * 0.34)
            c.fill(dot, with: .color(sick ? SimColor.red : SimColor.ink.opacity(0.22)))
            if shown && pos { c.stroke(dot, with: .color(SimColor.glow), lineWidth: 2) }
        }
        Sim.text(&c, "● sick   ○ ringed = tested positive", 14, 22, size: 12, color: SimColor.dim, mono: true)
        let yb = top + side * n + 22
        if M.tested >= 400 {
            let pr = Double(tp) / Double(max(1, tp + fp))
            Sim.text(&c, "positives: \(tp) sick + \(fp) healthy", 14, yb, size: 13, color: SimColor.ink, mono: true)
            Sim.text(&c, "P(sick | positive) = \(tp)/\(tp + fp) = \(Int((pr * 100).rounded()))%", 14, yb + 20, size: 14, color: SimColor.amber, mono: true, weight: .semibold)
        } else {
            Sim.text(&c, "Tap Test everyone", 14, yb, size: 13, color: SimColor.dim)
        }
    }
}
