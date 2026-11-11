// Shell workshop and branch loom (twins of js/sims/shell.js and js/sims/git.js):
// a folder tree with a "you are here" marker that glides as commands run, lines of
// a log flowing through grep, sort and uniq, and a commit graph driven by buttons.
import SwiftUI

struct ShellNode { var p: String; var d: Int; var dir = false }
struct ShellLine { var id: Int; var t: String }
struct ShellFrame {
    var tree: [ShellNode] = [], cwd = "~", cmd = "", out = "", hl: [String] = []
    var left: [ShellLine] = [], right: [ShellLine] = [], note = ""
}

struct ShellSim: View {
    let mode: String
    var height: CGFloat = 300
    @State private var kind = "tree"
    @State private var frames: [ShellFrame] = []
    @StateObject private var clock = SimClock()

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker("Kind", selection: $kind) { Text("Moving around folders").tag("tree"); Text("Pipes: | grep | sort | uniq").tag("pipes") }.labelsHidden().fixedSize()
            SimTimeline(frames: frames, height: height, note: { $0.note.isEmpty ? $0.cmd : $0.note }, draw: draw, clock: clock)
        }
        .onAppear { if frames.isEmpty { kind = mode == "pipes" ? "pipes" : "tree"; clock.speed = 0.7; rebuild() } }
        .onChange(of: kind) { _ in rebuild() }
    }
    private func rebuild() { frames = kind == "tree" ? Self.treeSteps() : Self.pipeSteps(); clock.reset(frames.count) }

    static func treeSteps() -> [ShellFrame] {
        var F: [ShellFrame] = []
        var tree = [ShellNode(p: "~", d: 0, dir: true), ShellNode(p: "~/Desktop", d: 1, dir: true), ShellNode(p: "~/Documents", d: 1, dir: true), ShellNode(p: "~/Documents/cv.pdf", d: 2),
                    ShellNode(p: "~/projects", d: 1, dir: true), ShellNode(p: "~/projects/learning-log", d: 2, dir: true), ShellNode(p: "~/projects/learning-log/README.md", d: 3)]
        func snap(_ cwd: String, _ cmd: String, _ out: String, _ hl: [String] = []) { F.append(ShellFrame(tree: tree, cwd: cwd, cmd: cmd, out: out, hl: hl)) }
        func add(_ n: ShellNode, after: String) { if let i = tree.firstIndex(where: { $0.p == after }) { tree.insert(n, at: i + 1) } }
        snap("~", "pwd", "/Users/mustafa")
        snap("~", "ls", "Desktop  Documents  projects", ["~/Desktop", "~/Documents", "~/projects"])
        snap("~/projects", "cd projects", "")
        add(ShellNode(p: "~/projects/yaver-notes", d: 2, dir: true), after: "~/projects/learning-log/README.md")
        snap("~/projects", "mkdir yaver-notes", "", ["~/projects/yaver-notes"])
        snap("~/projects/yaver-notes", "cd yaver-notes", "")
        add(ShellNode(p: "~/projects/yaver-notes/day1.md", d: 3), after: "~/projects/yaver-notes")
        snap("~/projects/yaver-notes", "touch day1.md", "", ["~/projects/yaver-notes/day1.md"])
        snap("~/projects", "cd ..", "")
        snap("~/projects/learning-log", "cd learning-log", "")
        snap("~/projects/learning-log", "ls -a", ".  ..  .git  README.md", ["~/projects/learning-log/README.md"])
        snap("~", "cd ~", "")
        return F
    }

    static func pipeSteps() -> [ShellFrame] {
        let log = ["INFO start", "ERROR disk", "INFO save", "ERROR net", "WARN slow", "ERROR disk", "INFO stop", "ERROR disk", "ERROR net"].enumerated().map { ShellLine(id: $0.offset, t: $0.element) }
        let grep = log.filter { $0.t.hasPrefix("ERROR") }
        let sorted = grep.sorted { $0.t != $1.t ? $0.t < $1.t : $0.id < $1.id }
        var groups: [(id: Int, t: String, n: Int)] = []
        for l in sorted { if let g = groups.firstIndex(where: { $0.t == l.t }) { groups[g].n += 1 } else { groups.append((l.id, l.t, 1)) } }
        let counted = groups.map { ShellLine(id: $0.id, t: String(repeating: " ", count: max(0, 3 - String($0.n).count)) + "\($0.n) \($0.t)") }
        let top = counted.sorted { Int($0.t.trimmingCharacters(in: .whitespaces).split(separator: " ").first ?? "0") ?? 0 > Int($1.t.trimmingCharacters(in: .whitespaces).split(separator: " ").first ?? "0") ?? 0 }
        return [
            ShellFrame(cmd: "cat app.log", left: [], right: log, note: "cat prints the file: nine lines"),
            ShellFrame(cmd: "cat app.log | grep ERROR", left: log, right: grep, note: "grep keeps only the lines containing ERROR"),
            ShellFrame(cmd: "… | grep ERROR | sort", left: grep, right: sorted, note: "sort puts equal lines next to each other"),
            ShellFrame(cmd: "… | sort | uniq -c", left: sorted, right: counted, note: "uniq -c folds neighbouring repeats into one line with a count"),
            ShellFrame(cmd: "… | uniq -c | sort -rn", left: counted, right: top, note: "sort -rn: most frequent first. Disk errors are the problem"),
        ]
    }

    private func draw(_ c: inout GraphicsContext, _ size: CGSize, _ A: ShellFrame, _ B: ShellFrame, _ t: Double) {
        let w = Double(size.width), h = Double(size.height)
        if kind == "tree" { drawTree(&c, w, h, A, B, t) } else { drawPipes(&c, w, h, A, B, t) }
    }

    private func drawTree(_ c: inout GraphicsContext, _ w: Double, _ h: Double, _ A: ShellFrame, _ B: ShellFrame, _ t: Double) {
        let S = t < 0.5 ? A : B, rowH = 22.0, top = 22.0
        func yOf(_ F: ShellFrame, _ p: String) -> Double? { F.tree.firstIndex { $0.p == p }.map { top + Double($0) * rowH } }
        let my = Sim.lerp(yOf(A, A.cwd) ?? top, yOf(B, B.cwd) ?? top, t)
        let da = Double(A.tree.first { $0.p == A.cwd }?.d ?? 0), db = Double(B.tree.first { $0.p == B.cwd }?.d ?? 0)
        let mx = 14 + Sim.lerp(da, db, t) * 18
        let marker = Sim.roundRect(mx - 6, my - 15, w - mx - 4, rowH - 2)
        c.fill(marker, with: .color(SimColor.teal.opacity(0.12))); c.stroke(marker, with: .color(SimColor.glow), lineWidth: 1)
        for (i, n) in S.tree.enumerated() {
            let yA = yOf(A, n.p), target = top + Double(i) * rowH
            let y = yA.map { Sim.lerp($0, target, t) } ?? target
            let x = 14 + Double(n.d) * 18
            var g = c; g.opacity = yA == nil ? t : 1
            if n.d > 0 {
                var p = Path(); p.move(to: CGPoint(x: x - 11, y: y - 14)); p.addLine(to: CGPoint(x: x - 11, y: y - 4)); p.addLine(to: CGPoint(x: x - 3, y: y - 4))
                g.stroke(p, with: .color(SimColor.faint), lineWidth: 1)
            }
            let name = n.p == "~" ? "~  (home)" : (n.p.split(separator: "/").last.map(String.init) ?? n.p) + (n.dir ? "/" : "")
            let hl = S.hl.contains(n.p)
            if n.dir {
                g.fill(Sim.roundRect(x, y - 12, 13, 10, 2), with: .color(hl ? SimColor.amber : SimColor.brass))
                g.fill(Path(CGRect(x: x, y: y - 14, width: 6, height: 3)), with: .color(hl ? SimColor.amber : SimColor.brass))
            } else {
                g.stroke(Sim.roundRect(x + 2, y - 14, 9, 12, 1), with: .color(hl ? SimColor.amber : SimColor.dim), lineWidth: 1.2)
            }
            Sim.text(&g, name, x + 19, y - 3, size: 12.5, color: hl ? SimColor.amber : n.dir ? SimColor.ink : SimColor.dim, mono: true, weight: hl ? .bold : .medium)
        }
        Sim.text(&c, "you are here", w - 14, my - 3, size: 11, color: SimColor.glow, align: .right)
        terminal(&c, w, h, S.cwd, S.cmd, S.out)
    }

    private func drawPipes(_ c: inout GraphicsContext, _ w: Double, _ h: Double, _ A: ShellFrame, _ B: ShellFrame, _ t: Double) {
        let S = t < 0.5 ? A : B, rowH = 21.0, top = 40.0, colW = (w - 44) / 2, lx = 12.0, rx = 32 + colW
        Sim.text(&c, "input", lx, 22, size: 11.5, color: SimColor.dim)
        Sim.text(&c, "output", rx, 22, size: 11.5, color: SimColor.dim)
        c.stroke(Sim.line(lx + colW + 4, top + 60, rx - 4, top + 60), with: .color(SimColor.brass), lineWidth: 2)
        Sim.text(&c, "|", (lx + colW + rx) / 2, top + 52, size: 16, color: SimColor.brassHi, align: .center, mono: true, weight: .bold)
        func line(_ c: inout GraphicsContext, _ x: Double, _ y: Double, _ s: String, _ a: Double, _ col: Color) {
            var g = c; g.opacity = max(0, min(1, a))
            g.fill(Sim.roundRect(x, y - 14, colW, rowH - 3, 3), with: .color(SimColor.ink.opacity(0.06)))
            g.clip(to: Path(CGRect(x: x, y: y - 14, width: colW, height: rowH)))
            Sim.text(&g, s, x + 5, y, size: 11.5, color: col, mono: true)
        }
        func yAt(_ i: Int) -> Double { top + Double(i) * rowH }
        func col(_ s: String) -> Color { s.contains("ERROR") ? SimColor.amber : SimColor.ink }
        let same = A.cmd == B.cmd
        if same || t >= 0.5 {
            let k = same ? 1 : (t - 0.5) * 2
            for (i, l) in B.left.enumerated() { line(&c, lx, yAt(i), l.t, B.right.contains { $0.id == l.id } || k < 0.3 ? 1 : 0.35, SimColor.ink) }
            for (i, r) in B.right.enumerated() {
                let j = B.left.firstIndex { $0.id == r.id }
                let sy = j.map { yAt($0) } ?? yAt(i)
                line(&c, Sim.lerp(lx, rx, k), Sim.lerp(sy, yAt(i), k), r.t, min(1, k * 1.5 + (j != nil ? 0.3 : 0)), col(r.t))
            }
        } else {
            let k = t * 2
            for (i, l) in A.left.enumerated() { line(&c, lx, yAt(i), l.t, (A.right.contains { $0.id == l.id } ? 1 : 0.35) * (1 - k), SimColor.ink) }
            for (i, r) in A.right.enumerated() { line(&c, Sim.lerp(rx, lx, k), yAt(i), r.t, 1, col(r.t)) }
        }
        terminal(&c, w, h, "~/logs", S.cmd, "\(S.right.count) line\(S.right.count == 1 ? "" : "s") out")
    }

    private func terminal(_ c: inout GraphicsContext, _ w: Double, _ h: Double, _ cwd: String, _ cmd: String, _ out: String) {
        let ty = h - 54
        c.fill(Sim.roundRect(8, ty, w - 16, 46), with: .color(.black.opacity(0.4)))
        let short = cwd.hasPrefix("~/projects/") ? "…/" + cwd.dropFirst(11) : cwd
        Sim.text(&c, "\(short) $ \(cmd)", 16, ty + 18, size: 11.5, color: SimColor.green, mono: true)
        if !out.isEmpty { Sim.text(&c, out, 16, ty + 36, size: 11.5, color: SimColor.ink, mono: true) }
    }
}

// MARK: - Branch loom

struct GitCommit { var id: String; var parents: [String]; var lane: Int; var msg: String; var born: Date; var merge = false }

struct GitSim: View {
    var height: CGFloat = 270
    @State private var commits: [GitCommit] = []
    @State private var branches: [(name: String, id: String)] = []
    @State private var lanes: [String: Int] = [:]
    @State private var head = "main"
    @State private var log: [String] = []
    @State private var counter = 0
    @State private var changed = Date.distantPast
    @State private var live = false
    @State private var oldLabels: [String: CGPoint] = [:]
    @State private var oldScroll = 0.0
    @State private var size = CGSize(width: 340, height: 270)
    private static let colors: [Color] = [SimColor.amber, SimColor.glow, SimColor.violet, SimColor.green, SimColor.red]
    private static let msgs = ["fix typo", "add quiz", "new lesson", "refactor", "add test", "update readme", "try idea"]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TimelineView(.animation(paused: !live)) { tl in
                Canvas { c, sz in
                    Sim.plate(&c, sz)
                    draw(&c, Double(sz.width), Double(sz.height), tl.date)
                }
            }
            .frame(height: height)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .background(GeometryReader { g in Color.clear.onAppear { size = g.size }.onChange(of: g.size) { size = $0 } })
            HStack {
                Button("Commit") { act(commit) }.buttonStyle(.borderedProminent)
                Button("New branch") { act(branch) }
                Button("Switch") { act(switchTo) }
                Button("Merge") { act(merge) }
                Button("Reset") { act(reset) }
            }
            .buttonStyle(.bordered).controlSize(.small)
            Text("Try: New branch, Commit twice, Switch back to main, Commit, then Merge. Labels are just sticky notes on commits; HEAD is where you are.")
                .font(.caption).foregroundStyle(Theme.dim)
        }
        .onAppear { if commits.isEmpty { reset() } }
    }

    private func tip(_ b: String) -> String? { branches.first { $0.name == b }?.id }
    private func setTip(_ b: String, _ id: String) { if let i = branches.firstIndex(where: { $0.name == b }) { branches[i].id = id } else { branches.append((b, id)) } }
    private func hash() -> String { String(format: "%03x", Int.random(in: 0..<4096)) }
    private func say(_ s: String) { log.append(s) }

    /// Remember where labels and the view were, so the change glides.
    private func act(_ f: () -> Void) {
        let now = Date()
        var pts: [String: CGPoint] = [:]
        for b in branches { pts[b.name] = labelPos(b.name, Double(size.width), now) }
        oldLabels = pts; oldScroll = scrollNow(Double(size.width), now)
        f()
        changed = Date(); live = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { if Date().timeIntervalSince(changed) > 0.85 { live = false } }
    }

    private func reset() {
        let old = Date.distantPast
        commits = [GitCommit(id: "a1f", parents: [], lane: 0, msg: "first notes", born: old), GitCommit(id: "b72", parents: ["a1f"], lane: 0, msg: "add week 1", born: old)]
        branches = [("main", "b72")]; lanes = ["main": 0]; head = "main"; counter = 0; oldLabels = [:]
        log = ["git init", "git commit -m \"first notes\"", "git commit -m \"add week 1\""]
    }
    private func commit() {
        guard let parent = tip(head) else { return }
        let id = hash(), m = Self.msgs[counter % Self.msgs.count]; counter += 1
        commits.append(GitCommit(id: id, parents: [parent], lane: lanes[head] ?? 0, msg: m, born: Date()))
        setTip(head, id)
        say("git commit -m \"\(m)\"")
    }
    private func branch() {
        guard let name = ["feature", "experiment", "fix", "idea"].first(where: { tip($0) == nil }), let at = tip(head) else { return say("# enough branches for now") }
        lanes[name] = lanes.count
        setTip(name, at); head = name
        say("git switch -c \(name)")
    }
    private func switchTo() {
        let names = branches.map(\.name)
        head = names[((names.firstIndex(of: head) ?? 0) + 1) % names.count]
        say("git switch \(head)")
    }
    private func ancestors(_ id: String) -> Set<String> {
        var out = Set<String>(), stack = [id]
        while let c = stack.popLast() { if out.contains(c) { continue }; out.insert(c); stack += commits.first { $0.id == c }?.parents ?? [] }
        return out
    }
    private func merge() {
        guard let mine = tip(head) else { return }
        let others = branches.filter { $0.name != head && $0.id != mine }
        if others.isEmpty { return say("# nothing to merge: switch to a branch with new commits") }
        let mineAnc = ancestors(mine)
        let other = others.first { !mineAnc.contains($0.id) } ?? others[0]
        let theirs = other.id
        if mineAnc.contains(theirs) { return say("git merge \(other.name)   # already up to date") }
        if ancestors(theirs).contains(mine) { setTip(head, theirs); return say("git merge \(other.name)   # fast-forward: \(head) just slides up") }
        let id = hash()
        commits.append(GitCommit(id: id, parents: [mine, theirs], lane: lanes[head] ?? 0, msg: "merge \(other.name)", born: Date(), merge: true))
        setTip(head, id)
        say("git merge \(other.name)   # a merge commit ties both lines")
    }

    // Geometry
    private let sp = 44.0, left = 26.0, top = 68.0, laneH = 44.0
    private func k(_ now: Date) -> Double { Sim.ease(Sim.clamp(now.timeIntervalSince(changed) / 0.35, 0, 1)) }
    private func scrollTarget(_ w: Double) -> Double { max(0, Double(commits.count - 1) * sp + left + 70 - w) }
    private func scrollNow(_ w: Double, _ now: Date) -> Double { Sim.lerp(oldScroll, scrollTarget(w), k(now)) }
    private func labelTarget(_ name: String, _ w: Double, _ now: Date) -> CGPoint {
        guard let id = tip(name), let i = commits.firstIndex(where: { $0.id == id }) else { return .zero }
        let stacked = branches.filter { $0.id == id && $0.name < name }.count
        return CGPoint(x: left + Double(i) * sp - scrollNow(w, now), y: top + Double(commits[i].lane) * laneH - 22 - Double(stacked) * 18)
    }
    private func labelPos(_ name: String, _ w: Double, _ now: Date) -> CGPoint {
        let t = labelTarget(name, w, now)
        guard let o = oldLabels[name] else { return t }
        let kk = k(now)
        return CGPoint(x: Sim.lerp(o.x, t.x, kk), y: Sim.lerp(o.y, t.y, kk))
    }

    private func draw(_ c: inout GraphicsContext, _ w: Double, _ h: Double, _ now: Date) {
        let scroll = scrollNow(w, now)
        func X(_ i: Int) -> Double { left + Double(i) * sp - scroll }
        func Y(_ lane: Int) -> Double { top + Double(lane) * laneH }
        func col(_ lane: Int) -> Color { Self.colors[lane % Self.colors.count] }
        for (_, lane) in lanes { c.stroke(Sim.line(0, Y(lane), w, Y(lane)), with: .color(col(lane).opacity(0.12)), lineWidth: 8) }
        for (i, cm) in commits.enumerated() {
            let bk = Sim.ease(Sim.clamp(now.timeIntervalSince(cm.born) * 2.2, 0, 1))
            for pid in cm.parents {
                guard let j = commits.firstIndex(where: { $0.id == pid }) else { continue }
                let p = commits[j]
                let x2 = Sim.lerp(X(j), X(i), bk), y2 = Sim.lerp(Y(p.lane), Y(cm.lane), bk)
                var path = Path(); path.move(to: CGPoint(x: X(j), y: Y(p.lane)))
                if p.lane == cm.lane { path.addLine(to: CGPoint(x: x2, y: y2)) }
                else { path.addCurve(to: CGPoint(x: x2, y: y2), control1: CGPoint(x: X(j) + sp * 0.6, y: Y(p.lane)), control2: CGPoint(x: x2 - sp * 0.6, y: y2)) }
                c.stroke(path, with: .color(col(cm.lane)), lineWidth: 2.5)
            }
        }
        let headTip = tip(head)
        for (i, cm) in commits.enumerated() {
            let kb = Sim.clamp(now.timeIntervalSince(cm.born) * 2.2, 0, 1)
            let r = 9 * (kb < 1 ? 1 + 0.4 * Foundation.sin(kb * .pi) : 1) * min(1, kb * 2)
            let x = X(i), y = Y(cm.lane)
            c.fill(Sim.circle(x, y, r), with: .color(SimColor.bg))
            c.stroke(Sim.circle(x, y, r), with: .color(col(cm.lane)), lineWidth: cm.merge ? 4 : 2.5)
            if headTip == cm.id { c.fill(Sim.circle(x, y, 4), with: .color(col(cm.lane))) }
            Sim.text(&c, cm.id, x, y + 24, size: 9.5, color: SimColor.dim, align: .center, mono: true)
        }
        for b in branches {
            let L = labelPos(b.name, w, now)
            let label = b.name == head ? "HEAD → \(b.name)" : b.name
            let wd = Double(label.count) * 6.7 + 12
            let cl = col(lanes[b.name] ?? 0)
            let pill = Sim.roundRect(L.x - wd / 2, L.y - 12, wd, 17, 8)
            c.fill(pill, with: .color(b.name == head ? cl : Color(red: 12 / 255, green: 24 / 255, blue: 32 / 255).opacity(0.9)))
            c.stroke(pill, with: .color(cl), lineWidth: 1.2)
            Sim.text(&c, label, L.x, L.y + 1, size: 11, color: b.name == head ? Color(hex: 0x14120e) : cl, align: .center, mono: true, weight: .semibold)
        }
        let ty = h - 64
        c.fill(Sim.roundRect(8, ty, w - 16, 56), with: .color(.black.opacity(0.35)))
        let last = Array(log.suffix(3))
        for (i, l) in last.enumerated() { Sim.text(&c, "$ \(l)", 16, ty + 16 + Double(i) * 16, size: 11.5, color: i == last.count - 1 ? SimColor.green : SimColor.dim, mono: true) }
        Sim.text(&c, "on branch \(head)", w - 14, 22, size: 12, color: SimColor.brassHi, align: .right)
        Sim.text(&c, "git log --graph", 14, 22, size: 12, color: SimColor.dim, mono: true)
    }
}
