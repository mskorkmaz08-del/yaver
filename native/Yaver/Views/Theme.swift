// The look: the web app's Mark II palette (navy plates, ivory text, one gold
// accent), with the system font so it reads like a native app.
import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

extension Color {
    init(hex: UInt32) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255, opacity: 1)
    }
}

enum Theme {
    static let bg = Color(hex: 0x10151f)
    static let plate = Color(hex: 0x151d2c)
    static let plate2 = Color(hex: 0x1b2539)
    static let line = Color(hex: 0x2a3550)
    static let text = Color(hex: 0xf1e9d8)
    static let muted = Color(hex: 0xb4ab98)
    static let dim = Color(hex: 0x8a8374)
    static let gold = Color(hex: 0xe2b660)
    static let ok = Color(hex: 0x7dcfa0)
    static let warn = Color(hex: 0xe8975a)
    static let red = Color(hex: 0xe57a6a)
    static let steel = Color(hex: 0x74b7b0)
}

/// A plate: the one card style every screen uses.
struct Card<Content: View>: View {
    var title: String?
    var trailing: String?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let title {
                HStack {
                    Text(title.uppercased()).font(.caption.weight(.semibold)).tracking(1.2).foregroundStyle(Theme.dim)
                    Spacer()
                    if let trailing { Text(trailing).font(.caption.monospacedDigit()).foregroundStyle(Theme.muted) }
                }
            }
            content
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.plate, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Theme.line, lineWidth: 1))
    }
}

/// A big number with a small label under it.
struct Stat: View {
    let value: String
    let label: String
    var color: Color = Theme.text
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.title3.weight(.semibold).monospacedDigit()).foregroundStyle(color)
            Text(label).font(.caption).foregroundStyle(Theme.dim)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A thin progress bar.
struct Bar: View {
    let value: Double
    var color: Color = Theme.gold
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.plate2)
                Capsule().fill(color).frame(width: g.size.width * min(1, max(0, value)))
            }
        }
        .frame(height: 5)
    }
}

/// Screen scaffold: scrolling column of cards on the navy background.
struct Screen<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) { content }
                .padding(16)
                .frame(maxWidth: 760)
                .frame(maxWidth: .infinity)
        }
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle(title)
    }
}

/// Day switcher: ‹ Today ›
struct DayPicker: View {
    @Binding var day: String
    var body: some View {
        HStack {
            Button { day = Day.add(day, -1) } label: { Image(systemName: "chevron.left") }
            Spacer()
            Text(Day.label(day)).font(.headline)
            Spacer()
            Button { day = Day.add(day, 1) } label: { Image(systemName: "chevron.right") }.disabled(day >= Day.today)
        }
        .buttonStyle(.borderless)
        .padding(.horizontal, 4)
    }
}

func number(_ s: String) -> Double? { Double(s.replacingOccurrences(of: ",", with: ".").trimmingCharacters(in: .whitespaces)) }

extension View {
    /// Number keyboard on the iPhone; nothing on the Mac.
    func numberKeyboard() -> some View {
        #if os(iOS)
        return self.keyboardType(.decimalPad)
        #else
        return self
        #endif
    }
    /// Sheets on the Mac need a size.
    func sheetSize() -> some View {
        #if os(macOS)
        return self.frame(minWidth: 460, minHeight: 480)
        #else
        return self
        #endif
    }
}

enum Clipboard {
    static func copy(_ s: String) {
        #if os(iOS)
        UIPasteboard.general.string = s
        #else
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(s, forType: .string)
        #endif
    }
    static func read() -> String {
        #if os(iOS)
        return UIPasteboard.general.string ?? ""
        #else
        return NSPasteboard.general.string(forType: .string) ?? ""
        #endif
    }
}

/// Save and Cancel for the form sheets.
struct SheetButtons: ViewModifier {
    let canSave: Bool
    let save: () -> Void
    @Environment(\.dismiss) private var dismiss
    func body(content: Content) -> some View {
        content.toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) { Button("Save") { save(); dismiss() }.disabled(!canSave) }
        }
    }
}
extension View {
    func sheetButtons(canSave: Bool = true, save: @escaping () -> Void) -> some View { modifier(SheetButtons(canSave: canSave, save: save)) }
}
