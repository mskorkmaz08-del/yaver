// Graph explorer (twin of js/sims/graph.js): breadth-first and depth-first search
// spreading through a small map, Dijkstra settling shortest distances, and a
// binary search tree growing then walked in order.
import SwiftUI

struct TreeNode { var v: Int; var x: Double; var d: Int; var parent: Int; var l: Int?; var r: Int? }

struct GraphFrame {
    var seen = Set<Int>(), order: [Int] = [], edges: [(Int, Int)] = [], box: [Int]? = nil, cur: Int? = nil
    var dist: [Double] = [], done = Set<Int>(), prev: [Int: Int] = [:], relax: (Int, Int)? = nil
    var tree: [TreeNode] = [], path: [Int] = [], ins: Int? = nil
    var note = ""
}

struct GraphSim: View {
    let mode: String
    var height: CGFloat = 290
    @State private var kind = "bfs"
    @State private var frames: [GraphFrame] = []
    @StateObject private var clock = SimClock()

    static let nodes: [(Double, Double)] = [(0.1, 0.5), (0.28, 0.2), (0.3, 0.78), (0.5, 0.45), (0.55, 0.12), (0.62, 0.82), (0.75, 0.38), (0.9, 0.18), (0.9, 0.7)]
    static let edgeList: [(Int, Int, Double)] = [(0, 1, 4), (0, 2, 2), (1, 3, 5), (2, 3, 1), (1, 4, 6), (3, 4, 3), (2, 5, 7), (3, 6, 2), (4, 7, 4), (6, 7, 1), (5, 8, 3), (6, 8, 5), (3, 5, 4)]
    static let adj: [[(to: Int, w: Double)]] = nodes.indices.map { i in
        edgeList.filter { $0.0 == i || $0.1 == i }.map { (to: $0.0 == i ? $0.1 : $0.0, w: $0.2) }.sorted { $0.to < $1.to }
    }
    static func label(_ i: Int) -> String { String(UnicodeScalar(65 + i)!) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker("Kind", selection: $kind) {
                Text("Breadth-first search").tag("bfs"); Text("Depth-first search").tag("dfs"); Text("Dijkstra").tag("dijkstra"); Text("Binary search tree").tag("bst")
            }.labelsHidden().fixedSize()
            SimTimeline(frames: frames, height: height, note: { $0.note }, draw: draw, clock: clock)
        }
        .onAppear { if frames.isEmpty { kind = ["bfs", "dfs", "dijkstra", "bst"].contains(mode) ? mode : "bfs"; clock.speed = 1.3; rebuild() } }
        .onChange(of: kind) { _ in rebuild() }
    }
    private func rebuild() { frames = framesFor(); clock.reset(frames.count) }

    private func framesFor() -> [GraphFrame] {
        var F: [GraphFrame] = []
        let L = Self.label
        if kind == "bfs" || kind == "dfs" {
            let bfs = kind == "bfs"
            var seen: Set<Int> = [0], order: [Int] = [], edges: [(Int, Int)] = [], box = [0]
            F.append(GraphFrame(seen: seen, box: box, note: bfs ? "Start at A; the queue holds what to visit next" : "Start at A; the stack holds what to visit next"))
            while !box.isEmpty {
                let u = bfs ? box.removeFirst() : box.removeLast()
                if !bfs && order.contains(u) { continue }
                order.append(u)
                F.append(GraphFrame(seen: seen, order: order, edges: edges, box: box, cur: u, note: "Visit \(L(u))"))
                let next = bfs ? Self.adj[u] : Self.adj[u].reversed()
                for e in next {
                    if bfs ? seen.contains(e.to) : order.contains(e.to) { continue }
                    if bfs { seen.insert(e.to) }
                    box.append(e.to); edges.append((u, e.to))
                    F.append(GraphFrame(seen: bfs ? seen : Set(order + box), order: order, edges: edges, box: box, cur: u, note: "\(bfs ? "Queue" : "Push") \(L(e.to))"))
                }
            }
            F.append(GraphFrame(seen: Set(order), order: order, edges: edges, box: [], note: "Order: \(order.map(L).joined(separator: " → "))"))
        } else if kind == "dijkstra" {
            var dist = Array(repeating: Double.infinity, count: Self.nodes.count), done = Set<Int>(), prev: [Int: Int] = [:]
            dist[0] = 0
            F.append(GraphFrame(dist: dist, note: "Distances start at ∞, except A = 0"))
            while done.count < Self.nodes.count {
                var u = -1
                for i in dist.indices where !done.contains(i) && (u < 0 || dist[i] < dist[u]) { u = i }
                if u < 0 || dist[u] == .infinity { break }
                done.insert(u)
                F.append(GraphFrame(cur: u, dist: dist, done: done, prev: prev, note: "Settle \(L(u)) at \(Int(dist[u])): nothing can reach it cheaper"))
                for e in Self.adj[u] where !done.contains(e.to) && dist[u] + e.w < dist[e.to] {
                    dist[e.to] = dist[u] + e.w; prev[e.to] = u
                    F.append(GraphFrame(cur: u, dist: dist, done: done, prev: prev, relax: (u, e.to), note: "\(L(e.to)): \(Int(dist[u])) + \(Int(e.w)) = \(Int(dist[e.to])), better than before"))
                }
            }
            F.append(GraphFrame(dist: dist, done: done, prev: prev, note: "Every shortest distance from A is final"))
        } else {
            var tree: [TreeNode] = []
            func place(_ v: Int) -> [Int] {
                if tree.isEmpty { tree.append(TreeNode(v: v, x: 0.5, d: 0, parent: -1)); return [0] }
                var i = 0, path = [0]
                while true {
                    let left = v < tree[i].v
                    if let nx = left ? tree[i].l : tree[i].r { i = nx; path.append(i); continue }
                    let d = tree[i].d + 1
                    tree.append(TreeNode(v: v, x: tree[i].x + (left ? -1 : 1) * 0.5 / pow(2, Double(d)), d: d, parent: i))
                    if left { tree[i].l = tree.count - 1 } else { tree[i].r = tree.count - 1 }
                    path.append(tree.count - 1)
                    return path
                }
            }
            F.append(GraphFrame(note: "Insert numbers: smaller go left, larger go right"))
            for v in [50, 30, 70, 20, 40, 60, 80, 35, 65, 45] {
                let snapshot = tree
                let path = place(v)
                for k in 0..<(path.count - 1) {
                    let p = snapshot[path[k]]
                    F.append(GraphFrame(tree: snapshot, path: Array(path[0...k]), ins: v, note: "Insert \(v): \(v) \(v < p.v ? "<" : ">") \(p.v), go \(v < p.v ? "left" : "right")"))
                }
                F.append(GraphFrame(tree: tree, path: path, ins: v, note: "\(v) placed at depth \(tree[path.last!].d)"))
            }
            var inorder: [Int] = []
            func walk(_ i: Int?) { guard let i else { return }; walk(tree[i].l); inorder.append(i); walk(tree[i].r) }
            walk(0)
            for k in inorder.indices {
                F.append(GraphFrame(tree: tree, path: Array(inorder[0...k]), note: "In-order walk: \(inorder[0...k].map { String(tree[$0].v) }.joined(separator: ", "))"))
            }
        }
        return F
    }

    private func node(_ c: inout GraphicsContext, _ x: Double, _ y: Double, _ r: Double, _ fill: Color, _ ring: Color, _ txt: String, _ sub: String? = nil) {
        let p = Sim.circle(x, y, r)
        c.fill(p, with: .color(fill)); c.stroke(p, with: .color(ring), lineWidth: 2)
        Sim.text(&c, txt, x, y + 5, size: 14, color: SimColor.ink, align: .center, weight: .semibold)
        if let sub { Sim.text(&c, sub, x, y - r - 6, size: 12, color: SimColor.amber, align: .center, mono: true) }
    }

    private func draw(_ c: inout GraphicsContext, _ size: CGSize, _ A: GraphFrame, _ B: GraphFrame, _ t: Double) {
        let w = size.width, h = size.height
        let F = t < 0.5 ? A : B
        if kind == "bst" { drawTree(&c, w, h, A, B, t); return }
        func P(_ i: Int) -> CGPoint { CGPoint(x: 26 + Self.nodes[i].0 * (w - 52), y: 46 + Self.nodes[i].1 * (h - 92)) }
        for (a, b, wt) in Self.edgeList {
            let p = P(a), q = P(b)
            let tree = F.prev[b] == a || F.prev[a] == b
            let hot = F.edges.contains { ($0.0 == a && $0.1 == b) || ($0.0 == b && $0.1 == a) } || (tree && F.done.contains(a) && F.done.contains(b))
            let relax = F.relax.map { ($0.0 == a && $0.1 == b) || ($0.0 == b && $0.1 == a) } ?? false
            c.stroke(Sim.line(p.x, p.y, q.x, q.y), with: .color(relax ? SimColor.amber : hot ? SimColor.glow : SimColor.faint), lineWidth: hot || relax ? 3 : 1.5)
            if kind == "dijkstra" { Sim.text(&c, "\(Int(wt))", (p.x + q.x) / 2 + 6, (p.y + q.y) / 2 - 4, size: 11.5, color: SimColor.brassHi, mono: true) }
        }
        for i in Self.nodes.indices {
            let p = P(i)
            let visited = F.order.contains(i) || F.done.contains(i)
            let queued = F.box?.contains(i) ?? false
            let cur = F.cur == i
            let pulse = cur ? 1 + 0.12 * Foundation.sin(t * .pi) : 1
            let sub: String? = kind == "dijkstra" && i < F.dist.count ? (F.dist[i] == .infinity ? "∞" : "\(Int(F.dist[i]))") : nil
            node(&c, p.x, p.y, 15 * pulse, visited ? SimColor.teal.opacity(0.45) : queued ? SimColor.brass.opacity(0.3) : SimColor.bg, cur ? SimColor.amber : visited ? SimColor.glow : SimColor.brass, Self.label(i), sub)
        }
        if let box = F.box { Sim.text(&c, "\(kind == "bfs" ? "queue" : "stack"): [ \(box.map(Self.label).joined(separator: ", ")) ]", 14, h - 14, size: 13, color: SimColor.amber, mono: true) }
        Sim.text(&c, kind == "bfs" ? "Breadth-first search" : kind == "dfs" ? "Depth-first search" : "Dijkstra from A", 14, 22, size: 15, color: SimColor.brassHi, weight: .semibold)
    }

    private func drawTree(_ c: inout GraphicsContext, _ w: Double, _ h: Double, _ A: GraphFrame, _ B: GraphFrame, _ t: Double) {
        let F = t < 0.5 ? A : B, T = F.tree
        func xy(_ n: TreeNode) -> CGPoint { CGPoint(x: 20 + n.x * (w - 40), y: 50 + Double(n.d) * ((h - 80) / 4)) }
        for n in T where n.parent >= 0 { let a = xy(T[n.parent]), b = xy(n); c.stroke(Sim.line(a.x, a.y, b.x, b.y), with: .color(SimColor.brass), lineWidth: 1.5) }
        for (i, n) in T.enumerated() {
            let p = xy(n), on = F.path.contains(i)
            node(&c, p.x, p.y, 15, on ? SimColor.teal.opacity(0.45) : SimColor.bg, on ? SimColor.glow : SimColor.brass, "\(n.v)")
        }
        if let ins = F.ins, let lastI = F.path.last {
            let last = lastI < T.count ? xy(T[lastI]) : CGPoint(x: w / 2, y: 50)
            let prevP = A.path.last.flatMap { $0 < A.tree.count ? xy(A.tree[$0]) : nil } ?? last
            let x = Sim.lerp(prevP.x, last.x, t) + 22, y = Sim.lerp(prevP.y, last.y, t) - 18
            c.fill(Sim.circle(x, y, 11), with: .color(SimColor.amber.opacity(0.9)))
            Sim.text(&c, "\(ins)", x, y + 4, size: 11, color: Color(hex: 0x14120e), align: .center, weight: .bold)
        }
        Sim.text(&c, "Binary search tree", 14, 22, size: 15, color: SimColor.brassHi, weight: .semibold)
    }
}
