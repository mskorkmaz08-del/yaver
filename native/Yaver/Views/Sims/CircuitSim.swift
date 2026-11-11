// Circuit bench (twin of js/sims/circuit.js): live circuits with flowing charge,
// meters, and parts that react (LEDs glow and burn out, resistors heat, capacitors
// charge, a motor spins), plus an Arduino board running Blink, a button and a knob.
import SwiftUI

final class CircuitModel: LiveSim {
    @Published var V = 9.0
    @Published var R = 330.0
    @Published var R2 = 470.0
    @Published var C = 100.0
    @Published var rating = 0.25
    @Published var on = true
    @Published var diode = true
    @Published var burnt = false
    @Published var sub = "blink"
    @Published var delay = 500.0
    @Published var base = 4.7
    var t = 0.0, vc = 0.0, phase = 0.0, flow = 0.0, flow2 = 0.0, angle = 0.0, spark = 0.0, btn = false, pot = 0.5
    var hist: [Double] = []
    var mode = "ohm"
    var btnRect: CGRect?
    var dragPot = false

    struct Sol { var I = 0.0, V1 = 0.0, V2 = 0.0, I1 = 0.0, I2 = 0.0, VR = 0.0, P: Double? = nil, Ib = 0.0 }
    func solve() -> Sol {
        switch mode {
        case "series", "divider": let I = V / (R + R2); return Sol(I: I, V1: I * R, V2: I * R2)
        case "parallel": let I1 = V / R, I2 = V / R2; return Sol(I: I1 + I2, I1: I1, I2: I2)
        case "led": let I = burnt ? 0 : max(0, (V - 2) / R); return Sol(I: I, VR: I * R, P: I * I * R)
        case "transistor":
            let Ib = on ? max(0, (5 - 0.7) / (base * 1000)) : 0
            return Sol(I: min(Ib * 100, V / 60), Ib: Ib)
        case "rc": return Sol(I: on ? max(0, (V - vc) / (R * 1000)) : 0)
        default: let I = V / R; return Sol(I: I, P: V * I)
        }
    }
    func toggleBase() { on.toggle(); if !on && !diode { spark = 0.5 }; kick() }
}

struct CircuitSim: View {
    let mode: String
    var height: CGFloat = 300
    @StateObject private var M = CircuitModel()
    @State private var started = false

    static let titles = ["ohm": "Ohm’s law: I = V ÷ R", "series": "Series: one path, the current is the same everywhere", "parallel": "Parallel: each branch takes its own current",
                         "divider": "Voltage divider: Vout = V × R2 ÷ (R1 + R2)", "led": "LED with a current-limiting resistor", "rc": "RC charging: 63% at one time constant (τ = R·C)",
                         "transistor": "NPN transistor as a switch", "power": "Power: P = V × I, and the resistor’s rating", "arduino": "Arduino pin 13"]
    static let captions = ["ohm": "Slide the voltage and resistance: the dots are the charge moving, faster when more current flows.",
                           "series": "Both resistors share one current; the voltage splits in proportion to their resistance.",
                           "parallel": "Each branch has the full voltage; the smaller resistor takes more current.",
                           "divider": "Make R2 bigger and watch Vout climb towards the supply.",
                           "led": "Turn the resistor down far enough and the LED burns out at about 30 mA.",
                           "rc": "Tap Discharge and Charge: the curve is exponential, 63% of the way at τ = R·C.",
                           "transistor": "Tap the stage or Toggle base. Turn the flyback diode off and switch the motor off to see the spike.",
                           "power": "Raise the voltage until the resistor runs over its rating and starts to glow.",
                           "arduino": "The highlighted line is the one running. Try the button and the potentiometer (drag the knob)."]
    private var md: String { Self.titles[mode] != nil ? mode : "ohm" }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TimelineView(.animation(paused: !M.live)) { tl in
                Canvas { c, size in
                    let dt = M.frame(tl.date)
                    Sim.plate(&c, size)
                    frame(&c, Double(size.width), Double(size.height), dt)
                }
            }
            .frame(height: height)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .gesture(DragGesture(minimumDistance: 0)
                .onChanged { v in pointer(v) }
                .onEnded { _ in M.btn = false; M.dragPot = false })
            controls
            Text(Self.captions[md] ?? "").font(.caption).foregroundStyle(Theme.dim)
        }
        .onAppear {
            if !started {
                started = true; M.mode = md
                if md == "rc" { M.R = 10 }
                M.kick()
            }
        }
    }

    private func pointer(_ v: DragGesture.Value) {
        let p = v.location
        if v.translation == .zero {
            if md == "arduino", let r = M.btnRect, r.contains(p) { if M.sub == "button" { M.btn = true }; M.dragPot = M.sub == "analog" }
            if md == "transistor" { M.toggleBase() }
        }
        if M.dragPot, let r = M.btnRect {
            let a = atan2(Double(p.y - r.midY), Double(p.x - r.midX))
            let t = (a / .pi - 0.75 + 4).truncatingRemainder(dividingBy: 2) / 1.5
            M.pot = Sim.clamp(t > 1.17 ? 0 : t, 0, 1)
        }
    }

    private func slider(_ label: String, _ b: Binding<Double>, _ r: ClosedRange<Double>, step: Double, _ shown: String) -> some View {
        HStack { Text(label).font(.caption).frame(width: 44, alignment: .leading); Slider(value: b, in: r, step: step); Text(shown).font(.caption.monospacedDigit()).frame(width: 64, alignment: .trailing) }
    }

    @ViewBuilder private var controls: some View {
        if md == "arduino" {
            Picker("Program", selection: Binding(get: { M.sub }, set: { M.sub = $0; M.phase = 0 })) { Text("Blink").tag("blink"); Text("Button + pull-up").tag("button"); Text("Potentiometer + PWM").tag("analog") }.labelsHidden().fixedSize()
            slider("delay", $M.delay, 100...1500, step: 50, "\(Int(M.delay)) ms")
        } else {
            slider("V", $M.V, (md == "transistor" ? 3 : 0)...12, step: 0.5, "\(Sim.fmt(M.V)) V")
            if md == "rc" {
                slider("R", $M.R, 1...100, step: 1, "\(Int(M.R)) kΩ")
                slider("C", $M.C, 10...470, step: 10, "\(Int(M.C)) µF")
                Button(M.on ? "Discharge" : "Charge") { M.on.toggle() }.buttonStyle(.bordered).controlSize(.small)
            } else if md == "transistor" {
                slider("Rb", $M.base, 1...47, step: 0.1, "\(Sim.fmt(M.base)) kΩ")
                HStack {
                    Button("Toggle base") { M.toggleBase() }.buttonStyle(.borderedProminent)
                    Button("Flyback diode: \(M.diode ? "on" : "off")") { M.diode.toggle() }.buttonStyle(.bordered)
                }.controlSize(.small)
            } else {
                slider(["ohm", "led", "power"].contains(md) ? "R" : "R1", $M.R, 10...1000, step: 10, "\(Int(M.R)) Ω")
                if ["series", "parallel", "divider"].contains(md) { slider("R2", $M.R2, 10...1000, step: 10, "\(Int(M.R2)) Ω") }
                if md == "power" {
                    Picker("Rating", selection: $M.rating) { Text("⅛ W resistor").tag(0.125); Text("¼ W resistor").tag(0.25); Text("½ W resistor").tag(0.5); Text("1 W resistor").tag(1.0) }.labelsHidden().fixedSize()
                }
                if md == "led" && M.burnt { Button("Fit a new LED") { M.burnt = false }.buttonStyle(.bordered).controlSize(.small) }
            }
        }
    }

    // MARK: parts

    private func polyLen(_ pts: [CGPoint]) -> Double { zip(pts, pts.dropFirst()).reduce(0) { $0 + hypot(Double($1.1.x - $1.0.x), Double($1.1.y - $1.0.y)) } }
    private func along(_ pts: [CGPoint], _ d0: Double) -> CGPoint {
        var d = d0
        for (a, b) in zip(pts, pts.dropFirst()) {
            let L = hypot(Double(b.x - a.x), Double(b.y - a.y))
            if d <= L && L > 0 { return CGPoint(x: Double(a.x) + Double(b.x - a.x) * d / L, y: Double(a.y) + Double(b.y - a.y) * d / L) }
            d -= L
        }
        return pts.last ?? .zero
    }
    private func wire(_ c: inout GraphicsContext, _ pts: [CGPoint]) {
        var p = Path(); p.addLines(pts)
        c.stroke(p, with: .color(SimColor.brass), style: StrokeStyle(lineWidth: 2.2, lineJoin: .round))
    }
    private func charges(_ c: inout GraphicsContext, _ pts: [CGPoint], _ offset: Double, _ amount: Double) {
        guard amount > 0 else { return }
        let L = polyLen(pts), gap = 16.0
        var d = offset.truncatingRemainder(dividingBy: gap)
        let a = Sim.clamp(0.35 + amount, 0.35, 1)
        while d < L {
            let q = along(pts, d)
            c.fill(Sim.circle(q.x, q.y, 4), with: .color(SimColor.glow.opacity(a * 0.25)))
            c.fill(Sim.circle(q.x, q.y, 2.3), with: .color(SimColor.glow.opacity(a)))
            d += gap
        }
    }
    private func battery(_ c: inout GraphicsContext, _ x: Double, _ y: Double, _ h: Double, _ label: String) {
        c.fill(Path(CGRect(x: x - 14, y: y - h / 2, width: 28, height: h)), with: .color(SimColor.bg))
        for i in 0..<2 {
            let yy = y - 10 + Double(i) * 14
            c.stroke(Sim.line(x - 13, yy, x + 13, yy), with: .color(SimColor.ink), lineWidth: 2.5)
            c.stroke(Sim.line(x - 7, yy + 6, x + 7, yy + 6), with: .color(SimColor.ink), lineWidth: 4)
        }
        Sim.text(&c, "+", x + 16, y - 12, size: 13, color: SimColor.red)
        Sim.text(&c, label, x - 20, y + 4, size: 13, color: SimColor.brassHi, align: .right, mono: true)
    }
    private func resistor(_ c: inout GraphicsContext, _ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double, _ label: String, _ w: Double, heat: Double = 0) {
        let L = hypot(x2 - x1, y2 - y1), a = atan2(y2 - y1, x2 - x1)
        var g = c
        g.translateBy(x: x1, y: y1); g.rotate(by: .radians(a))
        let bw = min(54, L * 0.6), bx = (L - bw) / 2
        g.fill(Path(CGRect(x: bx - 2, y: -9, width: bw + 4, height: 18)), with: .color(SimColor.bg))
        var z = Path(); z.move(to: CGPoint(x: bx, y: 0))
        for i in 0...6 { z.addLine(to: CGPoint(x: bx + bw / 6 * Double(i), y: i == 0 || i == 6 ? 0 : i % 2 == 1 ? -7 : 7)) }
        let col = heat > 0.05 ? Color(red: 236 / 255, green: (200 - heat * 140) / 255, blue: (150 - heat * 120) / 255) : SimColor.ink
        if heat > 0.05 { g.stroke(z, with: .color(SimColor.red.opacity(0.5 * heat)), lineWidth: 8) }
        g.stroke(z, with: .color(col), lineWidth: 2)
        let mx = (x1 + x2) / 2, my = (y1 + y2) / 2, vertical = abs(y2 - y1) > abs(x2 - x1), onRight = mx > w * 0.6
        Sim.text(&c, label, mx + (vertical ? (onRight ? -14 : 14) : 0), my + (vertical ? 4 : -14), size: 12.5, color: SimColor.brassHi, align: vertical ? (onRight ? .right : .left) : .center, mono: true)
    }
    private func led(_ c: inout GraphicsContext, _ x: Double, _ y: Double, _ bright: Double, _ burnt: Bool) {
        if bright > 0.02 && !burnt {
            let r = 18 + 30 * bright
            c.fill(Sim.circle(x, y, r), with: .radialGradient(Gradient(colors: [Color(red: 1, green: 120 / 255, blue: 90 / 255).opacity(0.9 * min(1, bright)), Color(red: 1, green: 90 / 255, blue: 60 / 255).opacity(0)]), center: CGPoint(x: x, y: y), startRadius: 2, endRadius: r))
        }
        let b = min(1, bright)
        var tri = Path(); tri.move(to: CGPoint(x: x - 9, y: y - 9)); tri.addLine(to: CGPoint(x: x - 9, y: y + 9)); tri.addLine(to: CGPoint(x: x + 7, y: y)); tri.closeSubpath()
        c.fill(tri, with: .color(burnt ? Color(hex: 0x3a3a3a) : Color(red: (120 + 135 * b) / 255, green: (50 + 60 * b) / 255, blue: (40 + 40 * b) / 255)))
        c.stroke(Sim.line(x + 8, y - 9, x + 8, y + 9), with: .color(SimColor.ink), lineWidth: 2)
        if burnt { Sim.text(&c, "burnt out", x, y + 26, size: 13, color: SimColor.red, align: .center) }
    }
    private func gauge(_ c: inout GraphicsContext, _ x: Double, _ y: Double, _ r: Double, _ value: Double, _ mx: Double, _ label: String, _ unit: String, _ color: Color) {
        var g = c
        g.translateBy(x: x, y: y)
        let face = Sim.circle(0, 0, r)
        g.fill(face, with: .radialGradient(Gradient(colors: [Color(hex: 0xeef1f4), Color(hex: 0xc4ccd4)]), center: CGPoint(x: -r * 0.3, y: -r * 0.3), startRadius: 1, endRadius: r))
        g.stroke(face, with: .color(SimColor.brass), lineWidth: 3)
        var ticks = Path()
        for i in 0...10 {
            let a = Double.pi * (0.75 + 1.5 * Double(i) / 10), r1 = i % 5 == 0 ? r * 0.68 : r * 0.78
            ticks.move(to: CGPoint(x: r1 * Foundation.cos(a), y: r1 * Foundation.sin(a))); ticks.addLine(to: CGPoint(x: r * 0.88 * Foundation.cos(a), y: r * 0.88 * Foundation.sin(a)))
        }
        g.stroke(ticks, with: .color(Color(hex: 0x3b3f4a)), lineWidth: 1)
        let a = Double.pi * (0.75 + 1.5 * Sim.clamp(value / mx, 0, 1.04))
        g.stroke(Sim.line(-r * 0.12 * Foundation.cos(a), -r * 0.12 * Foundation.sin(a), r * 0.8 * Foundation.cos(a), r * 0.8 * Foundation.sin(a)), with: .color(Color(hex: 0x1a1f25)), style: StrokeStyle(lineWidth: 2, lineCap: .round))
        g.fill(Sim.circle(0, 0, 2.5), with: .color(Color(hex: 0x1a1f25)))
        Sim.text(&g, label, 0, r * 0.42, size: max(8, r * 0.26), color: Color(hex: 0x4c5262), align: .center, weight: .semibold)
        Sim.text(&c, "\(Sim.fmt(value)) \(unit)", x, y + r + 15, size: 13, color: color, align: .center, mono: true)
    }
    private func meters(_ c: inout GraphicsContext, _ w: Double, _ h: Double, _ items: [(Double, Double, String, String, Color)]) {
        let n = Double(items.count), r = Sim.clamp(w / (n * 4.2), 18, 28), y = h - r - 26
        for (i, it) in items.enumerated() { gauge(&c, w / n * (Double(i) + 0.5), y, r, it.0, it.1, it.2, it.3, it.4) }
    }

    // MARK: frame

    private func frame(_ c: inout GraphicsContext, _ w: Double, _ h: Double, _ dt: Double) {
        let r = M.solve()
        M.t += dt
        func speed(_ I: Double) -> Double { Sim.clamp(I * 900, 0, 260) }
        M.flow += speed(r.I) * dt
        let top = 50.0, bot = h - 104, left = 46.0, right = w - 30
        Sim.text(&c, Self.titles[md] ?? "", 14, 20, size: 13, color: SimColor.dim)
        func P(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: x, y: y) }
        if md == "arduino" { arduino(&c, w, h, dt); return }
        if md == "parallel" {
            let mid = (left + right) / 2
            wire(&c, [P(left, (top + bot) / 2 + 22), P(left, bot), P(right, bot), P(right, top), P(left, top), P(left, (top + bot) / 2 - 22)])
            wire(&c, [P(mid, top), P(mid, bot)])
            M.flow2 += speed(r.I2) * dt
            charges(&c, [P(left, top), P(mid, top), P(mid, bot), P(left, bot)], M.flow * (r.I > 0 ? r.I1 / r.I : 0), r.I1 * 30)
            charges(&c, [P(mid, top), P(right, top), P(right, bot), P(mid, bot)], M.flow2, r.I2 * 30)
            battery(&c, left, (top + bot) / 2, 46, "\(Sim.fmt(M.V)) V")
            resistor(&c, mid, top + 8, mid, bot - 8, "R1 \(Int(M.R))Ω", w)
            resistor(&c, right, top + 8, right, bot - 8, "R2 \(Int(M.R2))Ω", w)
            meters(&c, w, h, [(r.I * 1000, 120, "I total", "mA", SimColor.glow), (r.I1 * 1000, 120, "I1", "mA", SimColor.glow), (r.I2 * 1000, 120, "I2", "mA", SimColor.glow)])
            return
        }
        let loop = [P(left, (top + bot) / 2 - 22), P(left, top), P(right, top), P(right, bot), P(left, bot), P(left, (top + bot) / 2 + 22)]
        wire(&c, loop)
        charges(&c, loop, M.flow, r.I * 40)
        battery(&c, left, (top + bot) / 2, 46, "\(Sim.fmt(M.V)) V")
        let third = (right - left) / 3
        switch md {
        case "series", "divider":
            resistor(&c, left + 14, top, left + third * 1.5, top, "R1 \(Int(M.R))Ω", w)
            resistor(&c, right, top + 10, right, bot - 10, "R2 \(Int(M.R2))Ω", w)
            if md == "divider" {
                var d = Path(); d.move(to: P(right, top + 4)); d.addLine(to: P(right - 30, top + 4)); d.move(to: P(right, bot - 4)); d.addLine(to: P(right - 30, bot - 4))
                c.stroke(d, with: .color(SimColor.glow), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
                Sim.text(&c, "Vout", right - 34, (top + bot) / 2, size: 13, color: SimColor.glow, align: .right)
            }
            meters(&c, w, h, [(r.I * 1000, 50, "I", "mA", SimColor.glow), (r.V1, 12, "V1", "V", SimColor.amber), (r.V2, 12, md == "divider" ? "Vout" : "V2", "V", SimColor.amber)])
        case "led":
            resistor(&c, left + 14, top, left + third * 1.6, top, "\(Int(M.R))Ω", w)
            led(&c, right, (top + bot) / 2, Sim.clamp(r.I / 0.02, 0, 1.2), M.burnt)
            if !M.burnt && r.I > 0.03 { DispatchQueue.main.async { M.burnt = true } }
            meters(&c, w, h, [(r.I * 1000, 40, "I", "mA", r.I > 0.025 ? SimColor.red : SimColor.glow), (r.VR, 12, "V across R", "V", SimColor.amber), (2, 5, "V LED", "V", SimColor.amber)])
        case "rc":
            let tau = M.R * 1000 * M.C * 1e-6
            M.vc += ((M.on ? M.V : 0) - M.vc) * (1 - Foundation.exp(-dt / Sim.clamp(tau, 0.4, 4)))
            resistor(&c, left + 14, top, left + third * 1.5, top, "\(Int(M.R))kΩ", w)
            let cx = right, cy = (top + bot) / 2
            c.fill(Path(CGRect(x: cx - 18, y: cy - 8, width: 36, height: 16)), with: .color(SimColor.bg))
            var plates = Path(); plates.move(to: P(cx - 16, cy - 5)); plates.addLine(to: P(cx + 16, cy - 5)); plates.move(to: P(cx - 16, cy + 5)); plates.addLine(to: P(cx + 16, cy + 5))
            c.stroke(plates, with: .color(SimColor.ink), lineWidth: 3)
            let q = M.vc / max(1, M.V)
            for i in 0..<Int((q * 6).rounded()) {
                Sim.text(&c, "+", cx - 14 + Double(i) * 5.5, cy - 9, size: 10, color: SimColor.red)
                Sim.text(&c, "−", cx - 14 + Double(i) * 5.5, cy + 16, size: 10, color: SimColor.glow)
            }
            Sim.text(&c, "\(Int(M.C))µF", cx + 22, cy + 4, size: 12.5, color: SimColor.brassHi, mono: true)
            M.hist.append(M.vc); if M.hist.count > 240 { M.hist.removeFirst() }
            let gx = left + 20, gy = top + 34, gw = third * 1.9 - 24, gh = bot - top - 54
            c.stroke(Path(CGRect(x: gx, y: gy, width: gw, height: gh)), with: .color(SimColor.faint), lineWidth: 1)
            var curve = Path()
            for (i, v) in M.hist.enumerated() { let pt = P(gx + Double(i) / 240 * gw, gy + gh - v / 12 * gh); if i == 0 { curve.move(to: pt) } else { curve.addLine(to: pt) } }
            c.stroke(curve, with: .color(SimColor.glow), lineWidth: 2)
            let y63 = gy + gh - 0.632 * M.V / 12 * gh
            c.stroke(Sim.line(gx, y63, gx + gw, y63), with: .color(SimColor.amber), style: StrokeStyle(lineWidth: 1, dash: [3, 4]))
            Sim.text(&c, "63%", gx + gw - 2, y63 - 4, size: 11, color: SimColor.amber, align: .right)
            meters(&c, w, h, [(M.vc, 12, "Vc", "V", SimColor.glow), (r.I * 1000, max(1, M.V / M.R), "I", "mA", SimColor.glow), (tau, 2, "τ = RC", "s", SimColor.amber)])
        case "transistor":
            transistor(&c, w, h, r, dt, left, right, top, bot, third)
        default:
            let Pw = r.P ?? M.V * r.I
            let heat = md == "power" ? Sim.clamp((Pw - M.rating) / M.rating, 0, 1) : 0
            resistor(&c, right, top + 10, right, bot - 10, "\(Int(M.R))Ω", w, heat: heat)
            if md == "power" && Pw > M.rating { Sim.text(&c, "over its \(Sim.fmt(M.rating)) W rating", right - 12, top + 22, size: 13, color: SimColor.red, align: .right) }
            meters(&c, w, h, md == "power"
                   ? [(M.V, 12, "V", "V", SimColor.amber), (r.I * 1000, 120, "I", "mA", SimColor.glow), (Pw, 1, "P", "W", Pw > M.rating ? SimColor.red : SimColor.glow)]
                   : [(M.V, 12, "V", "V", SimColor.amber), (r.I * 1000, 120, "I", "mA", SimColor.glow), (M.R, 1000, "R", "Ω", SimColor.brassHi)])
        }
    }

    private func transistor(_ c: inout GraphicsContext, _ w: Double, _ h: Double, _ r: CircuitModel.Sol, _ dt: Double, _ left: Double, _ right: Double, _ top: Double, _ bot: Double, _ third: Double) {
        resistor(&c, left + 14, top, left + third * 1.4, top, "load", w)
        let mx = right, my = (top + bot) / 2
        M.angle += r.I * 3000 * dt
        var g = c
        g.translateBy(x: mx, y: my); g.rotate(by: .radians(M.angle))
        g.stroke(Sim.circle(0, 0, 18), with: .color(SimColor.brass), lineWidth: 2)
        for _ in 0..<3 {
            g.rotate(by: .radians(2 * .pi / 3))
            g.fill(Path(ellipseIn: CGRect(x: -4, y: -18, width: 8, height: 18)), with: .color(SimColor.amber.opacity(0.6)))
        }
        Sim.text(&c, "M", mx + 24, my + 5, size: 14, color: SimColor.brassHi)
        let tx = left + third * 1.8, ty = bot
        c.fill(Sim.circle(tx, ty, 16), with: .color(SimColor.bg))
        let col = M.on ? SimColor.glow : SimColor.ink
        c.stroke(Sim.circle(tx, ty, 16), with: .color(col), lineWidth: 2)
        var sym = Path()
        sym.move(to: CGPoint(x: tx - 5, y: ty - 9)); sym.addLine(to: CGPoint(x: tx - 5, y: ty + 9))
        sym.move(to: CGPoint(x: tx - 5, y: ty - 3)); sym.addLine(to: CGPoint(x: tx + 10, y: ty - 12))
        sym.move(to: CGPoint(x: tx - 5, y: ty + 3)); sym.addLine(to: CGPoint(x: tx + 10, y: ty + 12))
        sym.move(to: CGPoint(x: tx - 5, y: ty)); sym.addLine(to: CGPoint(x: tx - 22, y: ty + 26))
        c.stroke(sym, with: .color(col), lineWidth: 2)
        Sim.text(&c, M.on ? "base on" : "base off", tx - 24, ty + 40, size: 12.5, color: M.on ? SimColor.glow : SimColor.dim, align: .center)
        if M.spark > 0 {
            M.spark -= dt
            var sp = Path()
            for _ in 0..<6 { let a = Double.random(in: 0..<6.28); sp.move(to: CGPoint(x: mx, y: my)); sp.addLine(to: CGPoint(x: mx + Foundation.cos(a) * 34, y: my + Foundation.sin(a) * 34)) }
            c.stroke(sp, with: .color(Color(red: 1, green: 240 / 255, blue: 180 / 255).opacity(max(0, min(1, M.spark * 3)))), lineWidth: 2)
            Sim.text(&c, "voltage spike: add a flyback diode", mx - 10, my - 32, size: 12.5, color: SimColor.red, align: .right)
        }
        meters(&c, w, h, [(r.Ib * 1000, 2, "Ib", "mA", SimColor.amber), (r.I * 1000, 200, "Ic", "mA", SimColor.glow), (r.Ib > 0 ? r.I / r.Ib : 0, 120, "gain", "×", SimColor.amber)])
    }

    private func program() -> [String] {
        let d = Int(M.delay)
        switch M.sub {
        case "button": return ["pinMode(2, INPUT_PULLUP);", "void loop() {", "  int pressed = digitalRead(2) == LOW;", "  digitalWrite(13, pressed);", "}"]
        case "analog": return ["void loop() {", "  int v = analogRead(A0);    // 0–1023", "  analogWrite(9, v / 4);     // 0–255", "}"]
        default: return ["void loop() {", "  digitalWrite(13, HIGH);", "  delay(\(d));", "  digitalWrite(13, LOW);", "  delay(\(d));", "}"]
        }
    }

    private func arduino(_ c: inout GraphicsContext, _ w: Double, _ h: Double, _ dt: Double) {
        var ledOn = 0.0, line = 0
        if M.sub == "blink" {
            M.phase += dt * 1000
            let p = M.phase.truncatingRemainder(dividingBy: M.delay * 2)
            ledOn = p < M.delay ? 1 : 0
            line = p < 30 ? 1 : p < M.delay ? 2 : p < M.delay + 30 ? 3 : 4
        } else if M.sub == "button" { ledOn = M.btn ? 1 : 0; line = 2 + Int((M.t * 4).truncatingRemainder(dividingBy: 2)) }
        else { ledOn = M.pot; line = 1 + Int((M.t * 4).truncatingRemainder(dividingBy: 2)) }
        let bx = 14.0, by = 34.0, bw = min(170, w * 0.46), bh = h - 70
        let board = Sim.roundRect(bx, by, bw, bh, 8)
        c.fill(board, with: .color(Color(hex: 0x1b4e6b))); c.stroke(board, with: .color(SimColor.brass), lineWidth: 1.5)
        for i in 0..<14 { c.fill(Path(CGRect(x: bx + 10 + Double(i) * ((bw - 20) / 14), y: by + 6, width: 6, height: 8)), with: .color(Color(hex: 0x0b1a22))) }
        Sim.text(&c, "pin 13", bx + bw - 12, by + 30, size: 11, color: SimColor.ink, align: .right, mono: true)
        c.fill(Sim.roundRect(bx + bw * 0.28, by + bh * 0.42, bw * 0.44, bh * 0.22, 3), with: .color(Color(hex: 0x0b1a22)))
        Sim.text(&c, "ATmega", bx + bw / 2, by + bh * 0.55, size: 11, color: SimColor.dim, align: .center, mono: true)
        let lx = bx + bw + 46, ly = by + 40
        wire(&c, [CGPoint(x: bx + bw - 14, y: by + 10), CGPoint(x: bx + bw - 14, y: by - 8), CGPoint(x: lx, y: by - 8), CGPoint(x: lx, y: ly - 12)])
        led(&c, lx, ly, ledOn, false)
        if M.sub == "button" {
            let by2 = ly + 70
            let b = Sim.roundRect(lx - 18, by2 - 18, 36, 36, 6)
            c.fill(b, with: .color(M.btn ? SimColor.brass : Color(hex: 0x2a2f36))); c.stroke(b, with: .color(SimColor.brass), lineWidth: 1)
            Sim.text(&c, M.btn ? "pressed" : "tap", lx, by2 + 34, size: 12.5, color: SimColor.dim, align: .center)
            M.btnRect = CGRect(x: lx - 18, y: by2 - 18, width: 36, height: 36)
        } else if M.sub == "analog" {
            let py = ly + 76
            var arc = Path(); arc.addArc(center: CGPoint(x: lx, y: py), radius: 20, startAngle: .radians(.pi * 0.75), endAngle: .radians(.pi * 2.25), clockwise: false)
            c.stroke(arc, with: .color(SimColor.brass), lineWidth: 3)
            let a = Double.pi * (0.75 + 1.5 * M.pot)
            c.stroke(Sim.line(lx, py, lx + Foundation.cos(a) * 18, py + Foundation.sin(a) * 18), with: .color(SimColor.glow), lineWidth: 3)
            Sim.text(&c, "A0 = \(Int((M.pot * 1023).rounded()))", lx, py + 38, size: 12.5, color: SimColor.glow, align: .center, mono: true)
            M.btnRect = CGRect(x: lx - 26, y: py - 26, width: 52, height: 52)
        } else { M.btnRect = nil }
        let code = program()
        let cx = min(w - 10, lx + 70), cy = by + 4
        if cx <= w - 60 {
            for (i, ln) in code.enumerated() {
                if i == line { c.fill(Path(CGRect(x: cx - 6, y: cy + Double(i) * 19 - 13, width: w - cx - 4, height: 18)), with: .color(SimColor.teal.opacity(0.14))) }
                Sim.text(&c, ln, cx, cy + Double(i) * 19, size: 11.5, color: i == line ? SimColor.glow : SimColor.dim, mono: true)
            }
        } else if line < code.count {
            Sim.text(&c, code[line].trimmingCharacters(in: .whitespaces), w - 12, h - 14, size: 11.5, color: SimColor.glow, align: .right, mono: true)
        }
    }
}
