// The front and back muscle map on the Body screen (twin of map() in
// js/views/body.js). Paths come from Core/AnatomyData.swift (absolute M, L, C, Q, Z),
// drawn in a 724 x 1448 box and scaled to fit. Muscles are shaded by this week's
// hard sets (0, 1-4, 5-9, 10+); today's are outlined in gold; tap one to pick it.
import SwiftUI

enum Anatomy {
    static let parts: Set<String> = ["head", "hair", "hands", "feet", "ankles", "knees"]
    static let size = CGSize(width: 724, height: 1448)
    private static var cache: [String: Path] = [:]

    static func path(_ d: String) -> Path {
        if let p = cache[d] { return p }
        var p = Path()
        var nums: [CGFloat] = []
        var cmd: Character = " "
        func flush() {
            var i = 0
            func pt() -> CGPoint { let q = CGPoint(x: nums[i], y: nums[i + 1]); i += 2; return q }
            switch cmd {
            case "M": while i + 1 < nums.count { if i == 0 { p.move(to: pt()) } else { p.addLine(to: pt()) } }
            case "L": while i + 1 < nums.count { p.addLine(to: pt()) }
            case "C": while i + 5 < nums.count { let c1 = pt(), c2 = pt(), e = pt(); p.addCurve(to: e, control1: c1, control2: c2) }
            case "Q": while i + 3 < nums.count { let c = pt(), e = pt(); p.addQuadCurve(to: e, control: c) }
            case "Z": p.closeSubpath()
            default: break
            }
            nums = []
        }
        var token = ""
        func endNumber() { if let v = Double(token) { nums.append(CGFloat(v)) }; token = "" }
        for ch in d {
            if "MLCQZ".contains(ch) { endNumber(); flush(); cmd = ch }
            else if ch == " " || ch == "," { endNumber() }
            else if ch == "-" { endNumber(); token = "-" }
            else { token.append(ch) }
        }
        endNumber(); flush()
        cache[d] = p
        return p
    }

    static func muscles(_ side: String) -> [(name: String, paths: [String])] {
        (AnatomyData.all[side]?.object ?? [:]).map { ($0.key, $0.value.array?.compactMap { $0.string } ?? []) }.sorted { $0.name < $1.name }
    }
    static func outline(_ side: String) -> String { AnatomyData.all["outline"]?[side]?.string ?? "" }
    static func level(_ n: Double) -> Int { n <= 0 ? 0 : n < 5 ? 1 : n < 10 ? 2 : 3 }
    static func color(_ level: Int) -> Color {
        [Theme.plate2, Theme.gold.opacity(0.35), Theme.gold.opacity(0.65), Theme.gold][level]
    }
}

/// One muscle group (several sub-paths), scaled from the 724 x 1448 box.
struct AnatomyShape: Shape {
    let paths: [String]
    func path(in rect: CGRect) -> Path {
        var all = Path()
        for d in paths { all.addPath(Anatomy.path(d)) }
        let s = min(rect.width / Anatomy.size.width, rect.height / Anatomy.size.height)
        let dx = rect.minX + (rect.width - Anatomy.size.width * s) / 2, dy = rect.minY + (rect.height - Anatomy.size.height * s) / 2
        return all.applying(CGAffineTransform(a: s, b: 0, c: 0, d: s, tx: dx, ty: dy))
    }
}

struct MuscleFigure: View {
    let side: String
    let sets: [String: Double]
    let today: Set<String>
    @Binding var picked: String

    var body: some View {
        VStack(spacing: 4) {
            ZStack {
                ForEach(Anatomy.muscles(side), id: \.name) { m in
                    muscle(m.name, m.paths)
                }
                AnatomyShape(paths: [Anatomy.outline(side)]).stroke(Theme.line, lineWidth: 1).allowsHitTesting(false)
            }
            .aspectRatio(0.5, contentMode: .fit)
            Text(side == "front" ? "Front" : "Back").font(.caption).foregroundStyle(Theme.dim)
        }
    }

    @ViewBuilder private func muscle(_ name: String, _ paths: [String]) -> some View {
        let shape = AnatomyShape(paths: paths)
        if Anatomy.parts.contains(name) {
            shape.fill(Theme.plate).allowsHitTesting(false)
        } else {
            let lv = Anatomy.level(sets[name] ?? 0)
            shape.fill(Anatomy.color(lv))
                .overlay(shape.stroke(picked == name ? Theme.text : today.contains(name) ? Theme.gold : Theme.bg.opacity(0.6), lineWidth: picked == name || today.contains(name) ? 2 : 0.5))
                .contentShape(shape)
                .onTapGesture { picked = picked == name ? "" : name }
                .accessibilityLabel(Training.muscles[name] ?? name)
        }
    }
}
