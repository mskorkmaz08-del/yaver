// Lesson text: the same small Markdown the web app's mdDoc() understands
// (code fences with a copy button, headings, tables, lists, quotes, paragraphs;
// inline code, bold, italics and https links).
import SwiftUI

enum MDBlock: Hashable {
    case code(lang: String, text: String)
    case heading(level: Int, text: String)
    case table(rows: [[String]])
    case list(ordered: Bool, items: [String])
    case quote(String)
    case para(String)
}

enum MD {
    static func parse(_ text: String) -> [MDBlock] {
        let lines = text.components(separatedBy: "\n")
        var out: [MDBlock] = []
        var i = 0
        func match(_ s: String, _ re: String) -> Bool { s.range(of: re, options: .regularExpression) != nil }
        let listRe = #"^\s*([-*•]|\d+\.)\s+"#
        while i < lines.count {
            let l = lines[i]
            if let r = l.range(of: #"^```([\w-]*)\s*$"#, options: .regularExpression) {
                let lang = String(l[r]).trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "```", with: "").replacingOccurrences(of: "-snippet", with: "")
                var buf: [String] = []
                i += 1
                while i < lines.count && !match(lines[i], #"^```\s*$"#) { buf.append(lines[i]); i += 1 }
                i += 1
                out.append(.code(lang: lang, text: buf.joined(separator: "\n")))
                continue
            }
            if match(l, #"^\s*$"#) { i += 1; continue }
            if let r = l.range(of: #"^#{1,4}\s+"#, options: .regularExpression) {
                let level = l[r].filter { $0 == "#" }.count
                out.append(.heading(level: level, text: String(l[r.upperBound...])))
                i += 1; continue
            }
            if match(l, #"^\|.*\|\s*$"#) {
                var rows: [[String]] = []
                while i < lines.count && match(lines[i], #"^\|.*\|\s*$"#) {
                    if !match(lines[i], #"^\|[\s:|-]+\|\s*$"#) {
                        var t = lines[i].trimmingCharacters(in: .whitespaces)
                        t.removeFirst(); if t.hasSuffix("|") { t.removeLast() }
                        rows.append(t.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) })
                    }
                    i += 1
                }
                out.append(.table(rows: rows)); continue
            }
            if match(l, listRe) {
                let ordered = match(l, #"^\s*\d+\."#)
                var items: [String] = []
                while i < lines.count && match(lines[i], listRe) {
                    var item = lines[i].replacingOccurrences(of: listRe, with: "", options: .regularExpression)
                    while i + 1 < lines.count && match(lines[i + 1], #"^\s{2,}\S"#) && !match(lines[i + 1], listRe) {
                        i += 1; item += " " + lines[i].trimmingCharacters(in: .whitespaces)
                    }
                    items.append(item); i += 1
                }
                out.append(.list(ordered: ordered, items: items)); continue
            }
            if match(l, #"^>\s?"#) {
                var buf: [String] = []
                while i < lines.count && match(lines[i], #"^>\s?"#) { buf.append(lines[i].replacingOccurrences(of: #"^>\s?"#, with: "", options: .regularExpression)); i += 1 }
                out.append(.quote(buf.joined(separator: " "))); continue
            }
            var buf: [String] = []
            while i < lines.count && !match(lines[i], #"^\s*$"#) && !match(lines[i], #"^(```|#{1,4}\s|\||\s*([-*•]|\d+\.)\s|>)"#) { buf.append(lines[i]); i += 1 }
            if buf.isEmpty { out.append(.para(l)); i += 1; continue }
            out.append(.para(buf.joined(separator: " ")))
        }
        return out
    }

    static func inline(_ s: String) -> AttributedString {
        let opts = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        return (try? AttributedString(markdown: s, options: opts)) ?? AttributedString(s)
    }
}

struct MarkdownView: View {
    let text: String
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(MD.parse(text).enumerated()), id: \.offset) { _, b in block(b) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private func block(_ b: MDBlock) -> some View {
        switch b {
        case .code(let lang, let text): CodeBlock(lang: lang, text: text)
        case .heading(let level, let text):
            Text(MD.inline(text)).font(level <= 2 ? .title3.weight(.semibold) : .headline).padding(.top, 4)
        case .table(let rows): TableBlock(rows: rows)
        case .list(let ordered, let items):
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(items.enumerated()), id: \.offset) { n, item in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(ordered ? "\(n + 1)." : "•").foregroundStyle(Theme.gold).monospacedDigit()
                        Text(MD.inline(item)).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        case .quote(let t):
            Text(MD.inline(t)).italic().foregroundStyle(Theme.muted)
                .padding(.leading, 10).overlay(alignment: .leading) { Rectangle().fill(Theme.gold.opacity(0.5)).frame(width: 2) }
        case .para(let t):
            Text(MD.inline(t)).fixedSize(horizontal: false, vertical: true).lineSpacing(3)
        }
    }
}

struct CodeBlock: View {
    let lang: String
    let text: String
    @State private var copied = false
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(lang.isEmpty ? "code" : lang).font(.caption.monospaced()).foregroundStyle(Theme.dim)
                Spacer()
                Button(copied ? "copied" : "copy") { Clipboard.copy(text); copied = true }
                    .font(.caption).buttonStyle(.borderless)
            }
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(Theme.plate2)
            ScrollView(.horizontal, showsIndicators: false) {
                Text(text).font(.system(.callout, design: .monospaced)).textSelection(.enabled)
                    .padding(10).fixedSize(horizontal: true, vertical: false)
            }
        }
        .background(Color(hex: 0x0c111a))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.line))
    }
}

struct TableBlock: View {
    let rows: [[String]]
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 6) {
                ForEach(Array(rows.enumerated()), id: \.offset) { r, row in
                    GridRow {
                        ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                            Text(MD.inline(cell)).font(r == 0 ? .callout.weight(.semibold) : .callout)
                        }
                    }
                    if r == 0 { Divider() }
                }
            }
            .padding(10)
        }
        .background(Theme.plate2.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
    }
}
