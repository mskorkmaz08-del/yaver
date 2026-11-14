// Finding places (native twin of js/places.js). The web app uses OpenStreetMap;
// the native app uses Apple Maps search (MapKit), which needs no key and knows
// opening places, addresses and phone numbers. Location comes from CoreLocation.
import Foundation
import CoreLocation
import MapKit

struct Place: Identifiable, Hashable {
    let id = UUID()
    let name: String
    let address: String
    let lat: Double
    let lon: Double
    var km: Double?
    var phone: String?
    var url: URL?
    var directions: URL {
        var c = URLComponents(string: "https://maps.apple.com/")!
        c.queryItems = [URLQueryItem(name: "daddr", value: "\(lat),\(lon)"), URLQueryItem(name: "q", value: name)]
        return c.url!
    }
}

struct PlacesError: LocalizedError { let message: String; var errorDescription: String? { message } }

@MainActor
final class Locator: NSObject, CLLocationManagerDelegate {
    static let shared = Locator()
    private let manager = CLLocationManager()
    private var waiting: [CheckedContinuation<CLLocation, Error>] = []

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func locate() async throws -> CLLocation {
        if let l = manager.location, Date().timeIntervalSince(l.timestamp) < 60 { return l }
        return try await withCheckedThrowingContinuation { c in
            waiting.append(c)
            switch manager.authorizationStatus {
            case .notDetermined: manager.requestWhenInUseAuthorization()
            case .denied, .restricted: finish(.failure(PlacesError(message: "Location permission is off. Allow Yaver in Settings → Privacy → Location Services.")))
            default: manager.requestLocation()
            }
        }
    }

    private func finish(_ r: Result<CLLocation, Error>) {
        let list = waiting; waiting = []
        for c in list { c.resume(with: r) }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        Task { @MainActor in
            guard !self.waiting.isEmpty else { return }
            switch m.authorizationStatus {
            case .notDetermined: break
            case .denied, .restricted: self.finish(.failure(PlacesError(message: "Location permission is off. Allow Yaver in Settings → Privacy → Location Services.")))
            default: m.requestLocation()
            }
        }
    }
    nonisolated func locationManager(_ m: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let l = locations.last else { return }
        Task { @MainActor in self.finish(.success(l)) }
    }
    nonisolated func locationManager(_ m: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in self.finish(.failure(PlacesError(message: "Could not get your location."))) }
    }
}

enum Places {
    /// key: (button label, words Apple Maps understands)
    static let categories: [(key: String, label: String, query: String)] = [
        ("cafe", "Cafe", "cafe"), ("restaurant", "Food", "restaurant"), ("supermarket", "Groceries", "supermarket"),
        ("pharmacy", "Pharmacy", "pharmacy"), ("atm", "ATM", "ATM"), ("library", "Library", "library"),
        ("coworking", "Cowork", "coworking space"), ("books", "Books", "bookstore"), ("electronics", "Tech shop", "electronics store"),
        ("copyshop", "Print", "copy shop printing"), ("gym", "Gym", "gym"), ("hospital", "Clinic", "clinic hospital"), ("fuel", "Fuel", "gas station"),
    ]

    static func distanceKm(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Double {
        CLLocation(latitude: a.latitude, longitude: a.longitude).distance(from: CLLocation(latitude: b.latitude, longitude: b.longitude)) / 1000
    }
    static func fmtDist(_ km: Double) -> String { km < 1 ? "\(Int((km * 1000).rounded())) m" : String(format: "%.1f km", km) }

    @MainActor
    static func here(_ s: Store? = nil) async throws -> CLLocationCoordinate2D {
        let l = try await Locator.shared.locate()
        s?.setSetting("lastLoc", .object(["lat": .number(l.coordinate.latitude), "lon": .number(l.coordinate.longitude), "at": .number(Date().timeIntervalSince1970 * 1000)]))
        return l.coordinate
    }

    /// Search by name, address or kind of place, nearest first.
    @MainActor
    static func search(_ query: String, near: CLLocationCoordinate2D?, radius: Double = 5000) async throws -> [Place] {
        let req = MKLocalSearch.Request()
        req.naturalLanguageQuery = query
        if let near { req.region = MKCoordinateRegion(center: near, latitudinalMeters: radius * 2, longitudinalMeters: radius * 2) }
        let res: MKLocalSearch.Response
        do { res = try await MKLocalSearch(request: req).start() } catch {
            throw PlacesError(message: (error as NSError).code == MKError.placemarkNotFound.rawValue ? "Nothing found." : "Place search is unavailable right now.")
        }
        var list = res.mapItems.map { m -> Place in
            let p = m.placemark
            let addr = [p.thoroughfare, p.subThoroughfare, p.locality].compactMap { $0 }.joined(separator: " ")
            var place = Place(name: m.name ?? query, address: addr, lat: p.coordinate.latitude, lon: p.coordinate.longitude, phone: m.phoneNumber, url: m.url)
            if let near { place.km = distanceKm(near, p.coordinate) }
            return place
        }
        list.sort { ($0.km ?? 0) < ($1.km ?? 0) }
        return list
    }

    @MainActor
    static func nearby(_ category: String, near: CLLocationCoordinate2D, radius: Double = 2000) async throws -> [Place] {
        guard let c = categories.first(where: { $0.key == category }) else {
            throw PlacesError(message: "Unknown category. Try one of: \(categories.map(\.key).joined(separator: ", "))")
        }
        return Array(try await search(c.query, near: near, radius: radius).filter { ($0.km ?? 0) <= radius / 1000 * 1.5 }.prefix(25))
    }

    /// The assistant's find_places tool.
    @MainActor
    static func forTool(_ s: Store, category: String, query: String, radius: Double) async throws -> JSON {
        let near = try await here(s)
        let list = category.isEmpty ? try await search(query, near: near) : try await nearby(category, near: near, radius: min(radius, 10000))
        return .array(list.prefix(8).map { p in
            var o: [String: JSON] = ["name": .string(p.name), "directions": .string(p.directions.absoluteString)]
            if let km = p.km { o["distance"] = .string(fmtDist(km)) }
            if !p.address.isEmpty { o["address"] = .string(p.address) }
            if let ph = p.phone { o["phone"] = .string(ph) }
            return .object(o)
        })
    }
}
