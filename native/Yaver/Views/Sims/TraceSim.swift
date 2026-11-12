// The tracer's screen: the code with a brass bar on the running line, variable
// chips that light up when they change, the call depth, and a paper output tape.
import SwiftUI

struct TraceSim: View {
    let code: String?
    var height: CGFloat = 300
    @State private var src = ""
    @State private var inputs = "5, 3"
    @State private var steps: [TraceStep] = []
    @State private var error: String?
    @State private var status = "idle"
    @State private var message = ""
    @State private var editing = false
    @StateObject private var clock = SimClock()

    private static let sample = "total = 0\nfor n in range(1, 5):\n    total = total + n\n    print(n, total)\nprint(\"done\", total)"
    private let LH = 17.0, TOPC = 16.0
    private var lines: [String] { src.components(separatedBy: "\n") }
    private var h: CGFloat { CGFloat(min(460, max(Double(height), TOPC + Double(min(lines.count, 16)) * LH + 150))) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if status == "ran" {
                SimTimeline(frames: steps, height: h, note: label, draw: { c, s, A, B, t in
                    let w = Double(s.width), hh = Double(s.height)
                    let y = drawCode(&c, w, A, B, t)
                    drawState(&c, w, hh, y, A, B, t)
                }, clock: clock)
            } else {
                Canvas { c, s in
                    Sim.plate(&c, s)
                    let w = Double(s.width)
                    let y = drawCode(&c, w, nil, nil, 0)
                    c.stroke(Sim.line(10, y, w - 10, y), with: .color(SimColor.amber.opacity(0.35)), lineWidth: 1)
                    let msg = status == "loading" ? "Starting Python… (a one-time download)" : status == "error" ? message : "Tap Trace to run it line by line"
                    Sim.text(&c, msg, 14, y + 26, size: 13, color: status == "error" ? SimColor.red : SimColor.dim)
                }
                .frame(height: h)
                .clipShape(RoundedRectangle(cornerRadius: 10))
            }
            HStack {
                Button { Task { await go() } } label: { Label(status == "loading" ? "Starting…" : "Trace", systemImage: "play.fill") }
                    .buttonStyle(.borderedProminent).disabled(status == "loading")
                Button(editing ? "Hide editor" : "Edit code") { editing.toggle() }.buttonStyle(.bordered)
            }.controlSize(.small)
            if editing {
                TextEditor(text: $src)
                    .font(.system(size: 12, design: .monospaced))
                    .frame(minHeight: 140)
                    .scrollContentBackground(.hidden)
                    .background(Theme.plate2)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    #endif
                    .onChange(of: src) { _ in if status == "ran" { status = "idle" } }
            }
            if src.contains("input(") {
                TextField("answers for input(), comma-separated", text: $inputs).textFieldStyle(.roundedBorder).font(.caption.monospaced())
            }
            Text("Your own copy: edit the code and trace again. Python runs on this device; nothing is sent anywhere.").font(.caption).foregroundStyle(Theme.dim)
        }
        .onAppear { if src.isEmpty { src = (code ?? Self.sample).replacingOccurrences(of: "\t", with: "    ") } }
    }

    private func label(_ f: TraceStep) -> String {
        if f.err { return error ?? "error" }
        if f.done { return "finished" }
        return "line \(f.line)" + (f.ret.map { ": returns \($0)" } ?? "")
    }

    private func go() async {
        status = "loading"
        do {
            let answers = inputs.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            let run = try await PyEngine.shared.trace(src.replacingOccurrences(of: "\t", with: "    "), inputs: answers)
            var s = run.steps
            error = run.error
            if let e = run.error {
                var last = s.last ?? TraceStep(line: 1, vars: [:])
                last.out = (last.out ?? "") + e; last.err = true; last.ret = nil
                s.append(last)
            } else if var last = s.last {
                last.out = run.out; last.ret = nil; last.fn = "<module>"; last.done = true
                s.append(last)
            }
            if s.isEmpty { s.append(TraceStep(line: 1, vars: [:], out: run.out)) }
            steps = s
            clock.speed = 1.6
            clock.reset(s.count)
            status = "ran"
        } catch {
            message = error.localizedDescription
            status = "error"
        }
    }

    // MARK: drawing

    private func drawCode(_ c: inout GraphicsContext, _ w: Double, _ A: TraceStep?, _ B: TraceStep?, _ t: Double) -> Double {
        let L = lines, visible = min(L.count, 16), codeH = Double(visible) * LH
        let la = Double(A?.line ?? 0), lb = Double(B?.line ?? A?.line ?? 0)
        let cur = Sim.lerp(la, lb, t)
        let first = max(0, min(L.count - visible, Int(cur.rounded()) - visible / 2))
        if A != nil {
            let y = TOPC + (cur - 1 - Double(first)) * LH
            c.fill(Sim.roundRect(8, y - 1, w - 16, LH, 3), with: .color(SimColor.amber.opacity(0.18)))
            c.fill(Path(CGRect(x: 8, y: y - 1, width: 3, height: LH)), with: .color(SimColor.amber))
        }
        var g = c
        g.clip(to: Path(CGRect(x: 0, y: TOPC - 2, width: w, height: codeH + 4)))
        for i in 0..<visible where first + i < L.count {
            let n = first + i + 1
            Sim.text(&g, "\(n)", 30, TOPC + Double(i) * LH + 12, size: 10.5, color: SimColor.faint, align: .right, mono: true)
            Sim.text(&g, L[first + i], 38, TOPC + Double(i) * LH + 12, size: 11.5, color: Int(cur.rounded()) == n && A != nil ? SimColor.brassHi : SimColor.ink, mono: true)
        }
        return TOPC + codeH + 8
    }

    private func drawState(_ c: inout GraphicsContext, _ w: Double, _ h: Double, _ y0: Double, _ A: TraceStep, _ B: TraceStep, _ t: Double) {
        let S = t < 0.5 ? A : B
        c.stroke(Sim.line(10, y0, w - 10, y0), with: .color(SimColor.amber.opacity(0.35)), lineWidth: 1)
        var x = 12.0, y = y0 + 10
        let prev = t >= 0.5 ? A.vars : nil
        let vars = (S.vars ?? [:]).sorted { $0.key < $1.key }
        if let fn = S.fn, fn != "<module>" {
            let d = S.depth ?? 0
            Sim.text(&c, "in \(fn)()\(d > 2 ? " · depth \(d - 1)" : "")", w - 12, y0 + 14, size: 11, color: SimColor.violet, align: .right)
        }
        if vars.isEmpty { Sim.text(&c, "no variables yet", 12, y + 14, size: 12, color: SimColor.dim) }
        for (k, v) in vars {
            let label = "\(k) = \(v)"
            let wd = min(w - 24, Double(label.count) * 7 + 16)
            if x + wd > w - 12 { x = 12; y += 26 }
            if y > h - 70 { break }
            let changed = prev != nil && prev?[k] != v
            let glow = changed ? 1 - min(1, (t - 0.5) * 2) * 0.6 : 0
            let r = Sim.roundRect(x, y, wd, 21, 4)
            c.fill(r, with: .color(changed ? SimColor.teal.opacity(0.12 + 0.3 * glow) : SimColor.ink.opacity(0.06)))
            c.stroke(r, with: .color(changed ? SimColor.glow : SimColor.amber.opacity(0.4)), lineWidth: 1)
            var g = c; g.clip(to: Path(CGRect(x: x, y: y, width: wd, height: 21)))
            Sim.text(&g, label, x + 8, y + 15, size: 11.5, color: changed ? SimColor.glow : SimColor.ink, mono: true)
            x += wd + 6
        }
        if let ret = S.ret { Sim.text(&c, "returns \(ret)", w - 12, y + 40, size: 11.5, color: SimColor.amber, align: .right, mono: true) }
        var out = (S.out ?? "").components(separatedBy: "\n")
        if out.last == "" { out.removeLast() }
        let ty = h - 58
        c.fill(Sim.roundRect(10, ty, w - 20, 48, 3), with: .color(Color(hex: 0xe9dfc6)))
        var px = 18.0
        while px < w - 16 { c.fill(Sim.circle(px, ty + 4, 1.4), with: .color(.black.opacity(0.12))); px += 14 }
        let last = Array(out.suffix(2))
        if last.isEmpty { Sim.text(&c, "output appears here", 18, ty + 30, size: 12, color: Color(hex: 0x8a7f68)) }
        for (i, l) in last.enumerated() { Sim.text(&c, l, 18, ty + 22 + Double(i) * 16, size: 12, color: Color(hex: 0x1a1f25), mono: true) }
    }
}
