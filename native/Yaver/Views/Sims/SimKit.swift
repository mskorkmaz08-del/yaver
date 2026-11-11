// The workshop (native twin of js/sims.js): an interactive simulator under each
// lesson. SimPick chooses one from the lesson's track and title; each simulator
// builds a list of frames and draws them on a Canvas, and SimTimeline plays,
// steps and scrubs smoothly between frames (position is a function of time, so
// SwiftUI only redraws while something moves).
import SwiftUI

enum SimColor {
    static let bg = Color(hex: 0x111519), bg2 = Color(hex: 0x181d23)
    static let grid = Color(red: 159 / 255, green: 180 / 255, blue: 200 / 255).opacity(0.07)
    static let ink = Color(hex: 0xe9edf1), dim = Color(hex: 0xe9edf1).opacity(0.55), faint = Color(hex: 0xe9edf1).opacity(0.18)
    static let brass = Color(hex: 0xffb547), brassHi = Color(hex: 0xffd89a), teal = Color(hex: 0x7fb2d9), glow = Color(hex: 0xcfe3f3)
    static let red = Color(hex: 0xef7a6d), green = Color(hex: 0x7dd3a8), amber = Color(hex: 0xffb547), violet = Color(hex: 0xb4a6f2)
}

enum Sim {
    static func ease(_ t: Double) -> Double { t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2 }
    static func lerp(_ a: Double, _ b: Double, _ t: Double) -> Double { a + (b - a) * t }
    static func clamp(_ v: Double, _ a: Double, _ b: Double) -> Double { max(a, min(b, v)) }
    static func fmt(_ v: Double) -> String {
        let d = abs(v) >= 100 ? 0 : abs(v) >= 10 ? 1 : 2
        var s = String(format: "%.\(d)f", v)
        if s.contains(".") { while s.hasSuffix("0") { s.removeLast() }; if s.hasSuffix(".") { s.removeLast() } }
        return s
    }

    /// Instrument plate: graphite, a fine grid, amber corner marks.
    static func plate(_ c: inout GraphicsContext, _ size: CGSize) {
        let r = CGRect(origin: .zero, size: size)
        c.fill(Path(r), with: .linearGradient(Gradient(colors: [SimColor.bg2, SimColor.bg]), startPoint: .zero, endPoint: CGPoint(x: size.width, y: size.height)))
        var g = Path()
        var x = 0.5; while x < size.width { g.move(to: CGPoint(x: x, y: 0)); g.addLine(to: CGPoint(x: x, y: size.height)); x += 20 }
        var y = 0.5; while y < size.height { g.move(to: CGPoint(x: 0, y: y)); g.addLine(to: CGPoint(x: size.width, y: y)); y += 20 }
        c.stroke(g, with: .color(SimColor.grid), lineWidth: 1)
        var m = Path()
        let w = size.width, h = size.height
        for (px, py, sx, sy) in [(6.0, 6.0, 1.0, 1.0), (w - 6, 6, -1, 1), (6, h - 6, 1, -1), (w - 6, h - 6, -1, -1)] {
            m.move(to: CGPoint(x: px, y: py + 14 * sy)); m.addLine(to: CGPoint(x: px, y: py)); m.addLine(to: CGPoint(x: px + 14 * sx, y: py))
        }
        c.stroke(m, with: .color(SimColor.brass.opacity(0.5)), lineWidth: 1.5)
    }

    enum Align { case left, center, right }
    static func text(_ c: inout GraphicsContext, _ s: String, _ x: Double, _ y: Double, size: Double = 14, color: Color = SimColor.ink,
                     align: Align = .left, mono: Bool = false, weight: Font.Weight = .medium) {
        let f: Font = mono ? .system(size: size, weight: weight, design: .monospaced) : .system(size: size, weight: weight)
        let t = c.resolve(Text(s).font(f).foregroundColor(color))
        let anchor: UnitPoint = align == .left ? UnitPoint(x: 0, y: 0.78) : align == .center ? UnitPoint(x: 0.5, y: 0.78) : UnitPoint(x: 1, y: 0.78)
        c.draw(t, at: CGPoint(x: x, y: y), anchor: anchor)
    }

    static func roundRect(_ x: Double, _ y: Double, _ w: Double, _ h: Double, _ r: Double = 4) -> Path {
        Path(roundedRect: CGRect(x: x, y: y, width: max(0, w), height: max(0, h)), cornerRadius: min(r, abs(w) / 2, abs(h) / 2))
    }

    static func arrow(_ c: inout GraphicsContext, _ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double, color: Color = SimColor.brass, width: Double = 1.6, head: Double = 7, dash: [CGFloat] = []) {
        var p = Path(); p.move(to: CGPoint(x: x1, y: y1)); p.addLine(to: CGPoint(x: x2, y: y2))
        c.stroke(p, with: .color(color), style: StrokeStyle(lineWidth: width, dash: dash))
        let a = atan2(y2 - y1, x2 - x1)
        var h = Path()
        h.move(to: CGPoint(x: x2, y: y2))
        h.addLine(to: CGPoint(x: x2 - head * Foundation.cos(a - 0.4), y: y2 - head * Foundation.sin(a - 0.4)))
        h.addLine(to: CGPoint(x: x2 - head * Foundation.cos(a + 0.4), y: y2 - head * Foundation.sin(a + 0.4)))
        h.closeSubpath()
        c.fill(h, with: .color(color))
    }

    static func circle(_ x: Double, _ y: Double, _ r: Double) -> Path { Path(ellipseIn: CGRect(x: x - r, y: y - r, width: 2 * r, height: 2 * r)) }
    static func line(_ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double) -> Path { var p = Path(); p.move(to: CGPoint(x: x1, y: y1)); p.addLine(to: CGPoint(x: x2, y: y2)); return p }
}

/// Position over the frames as a function of time.
final class SimClock: ObservableObject {
    @Published var count = 1
    @Published private(set) var playing = false
    var speed = 1.4
    private var base = 0.0, baseAt = Date(), target: Double?

    func pos(_ now: Date = Date()) -> Double {
        let dt = now.timeIntervalSince(baseAt)
        let last = Double(max(0, count - 1))
        if playing { return min(last, base + dt * speed) }
        if let target {
            let v = max(3, speed * 3)
            let d = target - base
            return abs(d) <= dt * v ? target : base + (d > 0 ? 1 : -1) * dt * v
        }
        return min(last, base)
    }
    var moving: Bool { playing || target != nil }
    private func freeze() { base = pos(); baseAt = Date() }
    /// Called each frame: stops at the end and settles a step.
    func settle(_ now: Date) {
        let p = pos(now), last = Double(max(0, count - 1))
        if playing && p >= last { base = last; baseAt = now; DispatchQueue.main.async { self.playing = false } }
        if let t = target, abs(p - t) < 1e-6 { base = t; baseAt = now; target = nil; DispatchQueue.main.async { self.objectWillChange.send() } }
    }
    func reset(_ n: Int, play: Bool = true) { count = max(1, n); base = 0; baseAt = Date(); target = nil; playing = play && n > 1 }
    func toggle() { freeze(); if !playing && base >= Double(count - 1) { base = 0 }; target = nil; playing.toggle() }
    func step(_ d: Int) {
        freeze(); playing = false
        let t = d > 0 ? floor(base) + 1 : ceil(base) - 1
        target = Sim.clamp(t, 0, Double(count - 1))
        objectWillChange.send()
    }
    func rewind() { base = 0; baseAt = Date(); target = nil; playing = false; objectWillChange.send() }
    func scrub(_ v: Double) { base = v; baseAt = Date(); target = nil; playing = false; objectWillChange.send() }
}

/// A canvas over precomputed frames with Play, step and a scrubber.
struct SimTimeline<F>: View {
    let frames: [F]
    var height: CGFloat = 250
    let note: (F) -> String
    let draw: (inout GraphicsContext, CGSize, F, F, Double) -> Void
    @ObservedObject var clock: SimClock

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TimelineView(.animation(paused: !clock.moving)) { tl in
                Canvas { c, size in
                    let p = clock.pos(tl.date)
                    clock.settle(tl.date)
                    guard !frames.isEmpty else { return }
                    let i = min(frames.count - 1, Int(floor(p))), j = min(frames.count - 1, i + 1)
                    Sim.plate(&c, size)
                    draw(&c, size, frames[i], frames[j], Sim.ease(p - Double(i)))
                }
            }
            .frame(height: height)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            TimelineView(.animation(paused: !clock.moving)) { tl in
                let p = clock.pos(tl.date)
                let i = frames.isEmpty ? 0 : min(frames.count - 1, Int(p.rounded()))
                VStack(alignment: .leading, spacing: 6) {
                    (Text("\(i + 1)/\(frames.count) ").bold() + Text(frames.isEmpty ? "" : note(frames[i]))).font(.caption).foregroundStyle(Theme.muted)
                    Slider(value: Binding(get: { p }, set: { clock.scrub($0) }), in: 0...Double(max(1, frames.count - 1)))
                }
            }
            HStack(spacing: 8) {
                Button { clock.rewind() } label: { Image(systemName: "backward.end") }
                Button { clock.step(-1) } label: { Image(systemName: "backward.frame") }
                Button { clock.toggle() } label: { Text(clock.playing ? "Pause" : "Play").frame(minWidth: 54) }.buttonStyle(.borderedProminent)
                Button { clock.step(1) } label: { Image(systemName: "forward.frame") }
                Spacer()
                Menu("\(Sim.fmt(clock.speed))×") { ForEach([0.5, 1, 1.5, 2, 3, 4], id: \.self) { v in Button("\(Sim.fmt(v))×") { clock.speed = v; clock.objectWillChange.send() } } }
                    .fixedSize()
            }
            .buttonStyle(.bordered).controlSize(.small)
        }
    }
}

// MARK: - Which simulator for which lesson (pickSim in js/sims.js)

struct SimPick { let sim: String; let mode: String; let code: String? }

enum SimPicker {
    static let names = ["circuit": "Circuit bench", "sort": "Sorting engine", "search": "Search rig", "graph": "Graph explorer", "structures": "Data structures",
                        "vectors": "Vector loom", "calculus": "Slope machine", "probability": "Probability mill", "data": "Table press", "trace": "Code tracer",
                        "memory": "Memory map", "git": "Branch loom", "shell": "Shell workshop"]
    static let rules: [(String, String, String, String)] = [
        ("robo", "arduino|blink|digital|button|debounc|analog|potentiom|serial|pwm|servo|sensor|library", "circuit", "arduino"),
        ("robo", "parallel", "circuit", "parallel"), ("robo", "series", "circuit", "series"), ("robo", "divider", "circuit", "divider"),
        ("robo", "kirchhoff", "circuit", "divider"), ("robo", "diode|led|colour code|datasheet", "circuit", "led"),
        ("robo", "capacit|rc time|decoupl", "circuit", "rc"), ("robo", "transistor|load|flyback|relay|motor", "circuit", "transistor"),
        ("robo", "power|battery|wattage", "circuit", "power"), ("robo", ".", "circuit", "ohm"),
        ("algo|python|build|cpp", "dijkstra", "graph", "dijkstra"), ("algo|python|build|cpp", "breadth|bfs|graph", "graph", "bfs"),
        ("algo|python|build|cpp", "depth-first|dfs|flood", "graph", "dfs"), ("algo|python|build|cpp", "tree|bst", "graph", "bst"),
        ("algo|python|build|cpp", "heap", "structures", "heap"), ("algo|python|build|cpp", "hash|anagram|two-sum|frequenc|seen-before", "structures", "hash"),
        ("algo|python|build|cpp", "linked list|pointer move", "structures", "list"), ("algo|python|build|cpp", "stack|queue", "structures", "stack"),
        ("algo|python|build|cpp", "recurs|backtrack|subsets|permutation|call stack", "structures", "recursion"),
        ("algo", "merge sort", "sort", "merge"), ("algo", "quick|divide and conquer", "sort", "quick"), ("algo", "sort", "sort", "selection"),
        ("algo", "binary search|big-o", "search", "binary"), ("algo", "two pointers|3sum|rain water", "search", "twopointers"),
        ("algo", "sliding window", "search", "window"), ("algo", "diagnostic|arrays", "search", "binary"),
        ("math", "3d|cross product", "vectors", "3d"), ("math", "eigen|power iteration", "vectors", "eigen"),
        ("math", "determinant|inverse|rank|null space|solve", "vectors", "det"), ("math", "dot product|cosine|projection|duality", "vectors", "dot"),
        ("math", "basis|frame", "vectors", "basis"), ("math", "transform|matri|rotation|composition|nonsquare|linear algebra", "vectors", "transform"),
        ("math", "vector|span", "vectors", "span"), ("math", "gradient|descent|fit a line", "calculus", "descent"),
        ("math", "chain rule|product rule|implicit|number e|derivative formulas", "calculus", "tangent"),
        ("math", "derivative|finite difference|gradient check|partial", "calculus", "secant"),
        ("math|ai", "central limit|standard error|sampling distribution", "probability", "clt"), ("math|ai", "bootstrap|confidence", "probability", "bootstrap"),
        ("math|ai", "conditional|bayes", "probability", "conditional"), ("math|ai", "probab|random|simulat|distribution", "probability", "dice"),
        ("ai|build|python", "join|merge|reshap", "data", "join"),
        ("ai|build|python", "group|aggregat|pivot|metrics|per-student|per-topic|statistic", "data", "group"),
        ("ai|build|python", "clean|missing|duplicat|messy|anonymiz|categorical|string", "data", "clean"),
        ("ai|build", "sql|select|where|sorting|insert|schema", "data", "filter"), ("ai|build", "chart|plot|visuali|honest", "data", "chart"),
        ("cpp", "vector|array", "memory", "vector"), ("cpp", "smart pointer|unique_ptr|raii|dynamic|heap", "memory", "heap"),
        ("cpp", "pointer|memory|reference|const", "memory", "pointers"),
        ("tools|build", "branch|merg|git|github|remote|pull request", "git", "branch"), ("tools", "pipe|redirect|grep|find", "shell", "pipes"),
        ("tools", ".", "shell", "tree"),
    ]
    static func has(_ s: String, _ re: String, ci: Bool = true) -> Bool { s.range(of: re, options: ci ? [.regularExpression, .caseInsensitive] : .regularExpression) != nil }

    static func firstCode(_ l: Row, lang: String = "python") -> String? {
        var steps = (l["steps"]?.array ?? []).compactMap { $0.object }
        steps.sort { ($0["kind"]?.string == "example" ? 0 : 1) < ($1["kind"]?.string == "example" ? 0 : 1) }
        for s in steps {
            let body = s["body"]?.string ?? ""
            guard let r = body.range(of: "```\(lang)\n") else { continue }
            guard let e = body.range(of: "```", range: r.upperBound..<body.endIndex) else { continue }
            let code = String(body[r.upperBound..<e.lowerBound])
            if code.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: "\n").count >= 2 {
                var c = code; while c.last?.isWhitespace == true { c.removeLast() }
                return c
            }
        }
        return nil
    }

    static func pick(_ l: Row) -> SimPick? {
        let track = l.str("track")
        if track.isEmpty { return nil }
        let title = "\(l.str("title")) \(l.str("lane"))"
        let code = firstCode(l)
        func trackOK(_ t: String) -> Bool { has(track, "^(\(t))$", ci: false) || has(track, t, ci: false) }
        if has(track, "python|build", ci: false), code != nil, !has(track, "^(ai|math)$", ci: false) {
            let r = rules.first { trackOK($0.0) && has(title, $0.1) && ["graph", "structures", "data"].contains($0.2) }
            if r == nil { return SimPick(sim: "trace", mode: "python", code: code) }
        }
        if let r = rules.first(where: { trackOK($0.0) && has(title, $0.1) }) { return SimPick(sim: r.2, mode: r.3, code: code) }
        if let code { return SimPick(sim: "trace", mode: "python", code: code) }
        let fb: [String: (String, String)] = ["python": ("structures", "stack"), "build": ("data", "group"), "algo": ("sort", "selection"), "math": ("vectors", "transform"),
                                              "ai": ("data", "filter"), "cpp": ("memory", "pointers"), "tools": ("shell", "tree"), "robo": ("circuit", "ohm"), "mixed": ("sort", "quick")]
        let f = fb[track] ?? ("sort", "selection")
        return SimPick(sim: f.0, mode: f.1, code: nil)
    }
}

/// The workshop card in a lesson.
struct SimCard: View {
    let lesson: Row
    @State private var full = false
    var body: some View {
        if let p = SimPicker.pick(lesson) {
            Card(title: "Workshop · \(SimPicker.names[p.sim] ?? p.sim)") {
                SimHost(pick: p, height: 250)
                Button { full = true } label: { Label("Bigger", systemImage: "arrow.up.left.and.arrow.down.right") }.buttonStyle(.bordered).controlSize(.small)
            }
            .sheet(isPresented: $full) {
                NavigationStack {
                    ScrollView { SimHost(pick: p, height: 460).padding(16) }
                        .background(Theme.bg.ignoresSafeArea())
                        .navigationTitle(SimPicker.names[p.sim] ?? "Workshop")
                        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { full = false } } }
                }
                .frame(minWidth: 700, minHeight: 640)
            }
        }
    }
}

struct SimHost: View {
    let pick: SimPick
    let height: CGFloat
    var body: some View {
        switch pick.sim {
        case "sort": SortSim(mode: pick.mode, height: height)
        case "search": SearchSim(mode: pick.mode, height: height)
        case "graph": GraphSim(mode: pick.mode, height: max(height, 290))
        default: SimLater(name: SimPicker.names[pick.sim] ?? pick.sim)
        }
    }
}

struct SimLater: View {
    let name: String
    var body: some View {
        Text("The \(name) is being rebuilt for the native app. It is in the web app's lesson in the meantime.")
            .font(.callout).foregroundStyle(Theme.dim)
    }
}
