// A JSON value. Yaver keeps every record as plain JSON, exactly as the web app
// stores it, so nothing is lost on the way in or out: fields the native screens
// don't know about yet are kept and synced untouched.
import Foundation

enum JSON: Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSON])
    case object([String: JSON])
}

typealias Row = [String: JSON]

extension JSON: Codable {
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSON].self) { self = .array(a) }
        else if let o = try? c.decode([String: JSON].self) { self = .object(o) }
        else { throw DecodingError.dataCorruptedError(in: c, debugDescription: "Not JSON") }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let n):
            // Whole numbers go out as integers, like JavaScript writes them.
            if n.rounded() == n, abs(n) < 9.0e15 { try c.encode(Int64(n)) } else { try c.encode(n) }
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }
}

extension JSON: ExpressibleByStringLiteral, ExpressibleByIntegerLiteral, ExpressibleByFloatLiteral, ExpressibleByBooleanLiteral, ExpressibleByNilLiteral {
    init(stringLiteral v: String) { self = .string(v) }
    init(integerLiteral v: Int) { self = .number(Double(v)) }
    init(floatLiteral v: Double) { self = .number(v) }
    init(booleanLiteral v: Bool) { self = .bool(v) }
    init(nilLiteral: ()) { self = .null }
}

extension JSON {
    var string: String? { if case .string(let s) = self { return s }; return nil }
    var double: Double? {
        switch self {
        case .number(let n): return n
        case .string(let s): return Double(s)
        case .bool(let b): return b ? 1 : 0
        default: return nil
        }
    }
    var bool: Bool? { if case .bool(let b) = self { return b }; return nil }
    var array: [JSON]? { if case .array(let a) = self { return a }; return nil }
    var object: [String: JSON]? { if case .object(let o) = self { return o }; return nil }
    var isNull: Bool { if case .null = self { return true }; return false }

    subscript(key: String) -> JSON? {
        if case .object(let o) = self { return o[key] }
        return nil
    }

    static func from(_ s: String?) -> JSON { s.map { .string($0) } ?? .null }

    static func decode(_ data: Data) throws -> JSON { try JSONDecoder().decode(JSON.self, from: data) }
    func encoded() throws -> Data { try JSONEncoder().encode(self) }
}

// Reading fields from a record without ceremony.
extension Dictionary where Key == String, Value == JSON {
    func str(_ k: String) -> String { self[k]?.string ?? self[k]?.double.map { n in n.rounded() == n ? String(Int64(n)) : String(n) } ?? "" }
    func num(_ k: String) -> Double { self[k]?.double ?? 0 }
    func flag(_ k: String) -> Bool { self[k]?.bool ?? false }
    var id: String { str("id") }
}
