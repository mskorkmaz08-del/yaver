// Map (twin of js/views/map.js): search a place or address, or tap a kind of place
// (cafe, pharmacy, cowork…) to list what is near you, nearest first, with pins on
// an Apple map and directions in Apple Maps. Search runs on Apple Maps (MapKit).
import SwiftUI
import MapKit

struct MapView: View {
    @EnvironmentObject var store: Store
    @Environment(\.openURL) private var openURL
    @State private var query = ""
    @State private var active = ""
    @State private var results: [Place] = []
    @State private var here: CLLocationCoordinate2D?
    @State private var region = MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 43.238, longitude: 76.945), span: MKCoordinateSpan(latitudeDelta: 0.08, longitudeDelta: 0.08))
    @State private var message = ""
    @State private var busy = false

    var body: some View {
        Screen(title: "Map") {
            HStack {
                TextField("Search a place or address", text: $query).textFieldStyle(.roundedBorder).onSubmit { search() }
                Button { search() } label: { Image(systemName: "magnifyingglass") }.buttonStyle(.borderedProminent).disabled(query.trimmingCharacters(in: .whitespaces).isEmpty)
                Button { ChatModel.shared.open = true; ChatModel.shared.send(store, query.isEmpty ? "Find a quiet cafe near me where I can study." : "Find \(query) near me.") } label: { Image(systemName: "sparkles") }.buttonStyle(.bordered)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(Places.categories, id: \.key) { c in
                        Button(c.label) { nearby(c.key) }
                            .buttonStyle(.bordered).tint(active == c.key ? Theme.gold : Theme.muted).font(.callout)
                    }
                }
            }
            ZStack(alignment: .topTrailing) {
                Map(coordinateRegion: $region, showsUserLocation: true, annotationItems: results) { p in
                    MapMarker(coordinate: CLLocationCoordinate2D(latitude: p.lat, longitude: p.lon), tint: Color(red: 0.89, green: 0.71, blue: 0.38))
                }
                .frame(height: 320)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                Button { Task { await locate() } } label: { Image(systemName: "location.fill").padding(8) }
                    .buttonStyle(.borderedProminent).padding(8)
            }
            if busy { ProgressView() }
            if !message.isEmpty { Text(message).font(.callout).foregroundStyle(Theme.warn) }
            if !results.isEmpty {
                Text("\(results.count) results · nearest first").font(.caption.weight(.semibold)).foregroundStyle(Theme.dim)
                ForEach(results) { p in
                    Button { openURL(p.directions) } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(p.name).font(.headline)
                                if !p.address.isEmpty { Text(p.address).font(.caption).foregroundStyle(Theme.muted) }
                                if let ph = p.phone { Text(ph).font(.caption).foregroundStyle(Theme.dim) }
                            }
                            Spacer()
                            if let km = p.km { Text(Places.fmtDist(km)).font(.callout.monospacedDigit()).foregroundStyle(Theme.gold) }
                            Image(systemName: "arrow.triangle.turn.up.right.diamond").foregroundStyle(Theme.dim)
                        }
                        .padding(12)
                        .background(Theme.plate, in: RoundedRectangle(cornerRadius: 12))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .task {
            if let l = store.setting("lastLoc"), let lat = l["lat"]?.double, let lon = l["lon"]?.double {
                region.center = CLLocationCoordinate2D(latitude: lat, longitude: lon)
            }
        }
    }

    private func locate() async {
        do {
            let c = try await Places.here(store)
            here = c
            region = MKCoordinateRegion(center: c, span: MKCoordinateSpan(latitudeDelta: 0.03, longitudeDelta: 0.03))
            message = ""
        } catch { message = error.localizedDescription }
    }

    private func search() {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return }
        active = ""
        run { try await Places.search(q, near: here ?? region.center, radius: 20000) }
    }

    private func nearby(_ key: String) {
        active = key
        run {
            if here == nil { await locate() }
            guard let near = here else { throw PlacesError(message: message.isEmpty ? "I need your location first. Tap the location button." : message) }
            return try await Places.nearby(key, near: near)
        }
    }

    private func run(_ f: @escaping () async throws -> [Place]) {
        busy = true; message = ""
        Task {
            do {
                results = try await f()
                if results.isEmpty { message = "Nothing found nearby." }
                fit()
            } catch { message = error.localizedDescription; results = [] }
            busy = false
        }
    }

    private func fit() {
        guard !results.isEmpty else { return }
        let lats = results.map(\.lat) + (here.map { [$0.latitude] } ?? []), lons = results.map(\.lon) + (here.map { [$0.longitude] } ?? [])
        let center = CLLocationCoordinate2D(latitude: (lats.min()! + lats.max()!) / 2, longitude: (lons.min()! + lons.max()!) / 2)
        region = MKCoordinateRegion(center: center, span: MKCoordinateSpan(latitudeDelta: max(0.01, (lats.max()! - lats.min()!) * 1.4), longitudeDelta: max(0.01, (lons.max()! - lons.min()!) * 1.4)))
    }
}
