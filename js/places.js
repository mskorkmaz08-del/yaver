// Finding places with free OpenStreetMap services (no account, no key):
//  - Nominatim: search by name or address ("Mega Silk Way", "Abay 10").
//  - Overpass:  everything of a kind near you ("pharmacy", "coworking").
import * as db from './db.js';

export const CATEGORIES = {
  cafe: ['Cafe', '["amenity"="cafe"]'],
  restaurant: ['Food', '["amenity"~"restaurant|fast_food"]'],
  supermarket: ['Groceries', '["shop"~"supermarket|convenience"]'],
  pharmacy: ['Pharmacy', '["amenity"="pharmacy"]'],
  atm: ['ATM', '["amenity"~"atm|bank"]'],
  library: ['Library', '["amenity"="library"]'],
  coworking: ['Cowork', '["amenity"="coworking_space"]'],
  books: ['Books', '["shop"="books"]'],
  electronics: ['Tech shop', '["shop"~"electronics|computer|mobile_phone"]'],
  copyshop: ['Print', '["shop"="copyshop"]'],
  gym: ['Gym', '["leisure"="fitness_centre"]'],
  hospital: ['Clinic', '["amenity"~"hospital|clinic|doctors"]'],
  fuel: ['Fuel', '["amenity"="fuel"]'],
};

export function lastLocation() {
  return db.setting('lastLoc', null); // {lat, lon, at}
}

export function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location is not available on this device.'));
    navigator.geolocation.getCurrentPosition(
      p => {
        const loc = { lat: p.coords.latitude, lon: p.coords.longitude, at: Date.now() };
        db.setSetting('lastLoc', loc);
        resolve(loc);
      },
      e => reject(new Error(e.code === 1 ? 'Location permission is off. Allow it in Settings → Privacy → Location Services → Safari Websites.' : 'Could not get your location.')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  });
}

export function distanceKm(a, b) {
  const R = 6371, rad = x => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const fmtDist = km => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);

// Search by name/address, preferring results near `near`.
export async function search(query, near = lastLocation()) {
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.search = new URLSearchParams({ q: query, format: 'jsonv2', limit: '10', addressdetails: '0' });
  if (near) {
    const d = 0.3;
    u.searchParams.set('viewbox', `${near.lon - d},${near.lat + d},${near.lon + d},${near.lat - d}`);
  }
  const res = await fetch(u, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Place search is unavailable right now.');
  const rows = await res.json();
  return rows.map(r => {
    const p = { name: r.name || r.display_name.split(',')[0], address: r.display_name, lat: +r.lat, lon: +r.lon, type: r.type };
    if (near) p.km = distanceKm(near, p);
    return p;
  }).sort((a, b) => (a.km ?? 0) - (b.km ?? 0));
}

// Everything of a category within `radius` metres, nearest first.
export async function nearby(category, near = lastLocation(), radius = 2000) {
  if (!near) throw new Error('I need your location first. Open the Map tab and tap the locate button.');
  const def = CATEGORIES[category];
  if (!def) throw new Error(`Unknown category. Try one of: ${Object.keys(CATEGORIES).join(', ')}`);
  const q = `[out:json][timeout:20];nwr${def[1]}(around:${radius},${near.lat},${near.lon});out center 40;`;
  const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  if (!res.ok) throw new Error('Nearby search is busy. Try again in a moment.');
  const data = await res.json();
  return data.elements.map(e => {
    const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
    const t = e.tags || {};
    const address = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
    return { name: t.name || t.brand || def[0], address, hours: t.opening_hours, lat, lon, km: distanceKm(near, { lat, lon }) };
  }).filter(p => p.lat).sort((a, b) => a.km - b.km).slice(0, 25);
}

export const directionsUrl = p => `https://maps.apple.com/?daddr=${p.lat},${p.lon}&q=${encodeURIComponent(p.name)}`;
