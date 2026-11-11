// End-to-end encryption for sync, byte-compatible with js/crypto.js:
// AES-GCM 256 with a key from PBKDF2-SHA-256 (310,000 rounds, random salt),
// a fresh 12-byte IV on every upload, the JSON gzipped first. The envelope is
// {"yaver":"sync","v":1,"alg":…,"iter":…,"gz":true,"salt":b64,"iv":b64,"data":b64}
// where data is the ciphertext followed by the 16-byte tag (WebCrypto's layout).
import Foundation
import CryptoKit
import CommonCrypto

struct WrongPassphrase: LocalizedError {
    var errorDescription: String? { "Wrong sync passphrase: this device could not decrypt the synced data. Nothing was changed." }
}

struct SyncFormatError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

enum SyncCrypto {
    static let iterations = 310_000
    private static var cache: (id: String, key: SymmetricKey)?
    private static var lastSalt: Data?

    static func deriveKey(pass: String, salt: Data, iterations: Int) -> SymmetricKey {
        let id = "\(salt.base64EncodedString()):\(iterations):\(pass)"
        if let c = cache, c.id == id { return c.key }
        let pw = Array(pass.utf8).map { CChar(bitPattern: $0) }
        let saltBytes = [UInt8](salt)
        var out = [UInt8](repeating: 0, count: 32)
        _ = CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), pw, pw.count, saltBytes, saltBytes.count,
                                 CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), UInt32(iterations), &out, out.count)
        let key = SymmetricKey(data: Data(out))
        cache = (id, key)
        return key
    }

    static func random(_ n: Int) -> Data {
        var b = [UInt8](repeating: 0, count: n)
        _ = SecRandomCopyBytes(kSecRandomDefault, n, &b)
        return Data(b)
    }

    static func encrypt(_ obj: JSON, pass: String) throws -> String {
        guard !pass.isEmpty else { throw SyncFormatError(message: "No sync passphrase set.") }
        let salt = lastSalt ?? random(16)
        lastSalt = salt
        let iv = random(12)
        let key = deriveKey(pass: pass, salt: salt, iterations: iterations)
        let plain = try Gzip.compress(obj.encoded())
        let box = try AES.GCM.seal(plain, using: key, nonce: AES.GCM.Nonce(data: iv))
        let env: JSON = .object([
            "yaver": "sync", "v": 1, "alg": "AES-GCM-256/PBKDF2-SHA256", "iter": .number(Double(iterations)), "gz": true,
            "salt": .string(salt.base64EncodedString()), "iv": .string(iv.base64EncodedString()),
            "data": .string((box.ciphertext + box.tag).base64EncodedString()),
        ])
        return String(decoding: try env.encoded(), as: UTF8.self)
    }

    static func decrypt(_ text: String, pass: String) throws -> JSON {
        guard let env = try? JSON.decode(Data(text.utf8)) else { throw SyncFormatError(message: "The sync file is damaged (not Yaver sync data).") }
        guard env["yaver"]?.string == "sync", let d = env["data"]?.string, let data = Data(base64Encoded: d),
              let salt = Data(base64Encoded: env["salt"]?.string ?? ""), let iv = Data(base64Encoded: env["iv"]?.string ?? ""),
              data.count >= 16 else { throw SyncFormatError(message: "The sync file is not Yaver sync data.") }
        let iter = Int(env["iter"]?.double ?? Double(iterations))
        let key = deriveKey(pass: pass, salt: salt, iterations: iter)
        let plain: Data
        do {
            let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: iv), ciphertext: data.prefix(data.count - 16), tag: data.suffix(16))
            plain = try AES.GCM.open(box, using: key)
        } catch { throw WrongPassphrase() }
        lastSalt = salt
        let bytes = env["gz"]?.bool == true ? try Gzip.decompress(plain) : plain
        return try JSON.decode(bytes)
    }
}

/// gzip (RFC 1952) around the raw DEFLATE that Apple's Compression framework makes,
/// matching the browser's CompressionStream("gzip").
enum Gzip {
    private static let table: [UInt32] = (0..<256).map { i -> UInt32 in
        var c = UInt32(i)
        for _ in 0..<8 { c = (c & 1) != 0 ? 0xEDB88320 ^ (c >> 1) : c >> 1 }
        return c
    }
    static func crc32(_ data: Data) -> UInt32 {
        var c: UInt32 = 0xFFFFFFFF
        for b in data { c = table[Int((c ^ UInt32(b)) & 0xFF)] ^ (c >> 8) }
        return c ^ 0xFFFFFFFF
    }
    private static func le32(_ v: UInt32) -> [UInt8] { [UInt8(v & 0xFF), UInt8((v >> 8) & 0xFF), UInt8((v >> 16) & 0xFF), UInt8((v >> 24) & 0xFF)] }

    static func compress(_ data: Data) throws -> Data {
        let deflated = try (data as NSData).compressed(using: .zlib) as Data
        var out = Data([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 0xff])
        out.append(deflated)
        out.append(contentsOf: le32(crc32(data)))
        out.append(contentsOf: le32(UInt32(truncatingIfNeeded: data.count)))
        return out
    }

    static func decompress(_ gz: Data) throws -> Data {
        let b = [UInt8](gz)
        guard b.count >= 18, b[0] == 0x1f, b[1] == 0x8b, b[2] == 8 else { throw SyncFormatError(message: "The sync data is not gzip.") }
        let flags = b[3]
        var i = 10
        if flags & 4 != 0 { i += 2 + Int(b[i]) + Int(b[i + 1]) << 8 }
        if flags & 8 != 0 { while i < b.count && b[i] != 0 { i += 1 }; i += 1 }
        if flags & 16 != 0 { while i < b.count && b[i] != 0 { i += 1 }; i += 1 }
        if flags & 2 != 0 { i += 2 }
        guard i < b.count - 8 else { throw SyncFormatError(message: "The sync data is cut short.") }
        let body = Data(b[i..<(b.count - 8)])
        return try (body as NSData).decompressed(using: .zlib) as Data
    }
}
