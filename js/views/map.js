// Map: your location, quick "near me" categories and free-text search, on
// OpenStreetMap. Leaflet is loaded only when this tab is first opened.
import { html, raw, toast } from '../util.js';
import { icon } from '../icons.js';
import * as Places from '../places.js';
import { openAssistant } from '../ai/assistant.js';

let L, map, layer, meMarker;
let results = [];
let active = null;
let lastQuery = '';

async function loadLeaflet() {
  if (L) return L;
  if (!document.querySelector('link[data-leaflet]')) {
    const css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: 'vendor/leaflet/leaflet.css' });
    css.dataset.leaflet = '1';
    document.head.append(css);
  }
  await new Promise((res, rej) => {
    const s = Object.assign(document.createElement('script'), { src: 'vendor/leaflet/leaflet.js', onload: res, onerror: rej });
    document.head.append(s);
  });
  L = window.L;
  return L;
}

const pinIcon = (cls = '') => L.divIcon({ className: '', html: `<div class="pin ${cls}"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] });

export function render(root) {
  root.innerHTML = html`
    <header class="page-head">
      <div><p class="path">~/yaver <b>›</b> map</p><h1>Nearby</h1></div>
      <button class="icon-btn" data-ask aria-label="Ask Yaver">${raw(icon('sparkle'))}</button>
    </header>
    <form class="map-search" data-search>
      <input type="search" placeholder="Search a place or address" value="${lastQuery}" enterkeyhint="search" aria-label="Search places">
      <button class="btn primary" aria-label="Search">${raw(icon('search'))}</button>
    </form>
    <div class="chips">${raw(Object.entries(Places.CATEGORIES).map(([k, [label]]) => html`<button class="chip ${raw(active === k ? 'on' : '')}" data-cat="${k}">${label}</button>`).join(''))}</div>
    <div class="map-wrap"><div id="map"></div><button class="icon-btn map-locate" data-locate aria-label="My location">${raw(icon('locate'))}</button></div>
    <section class="list" data-results></section>
  `;

  const listEl = root.querySelector('[data-results]');
  const drawList = () => {
    listEl.innerHTML = results.length ? html`<h4 class="list-day">${results.length} results <span>nearest first</span></h4>${raw(results.map((p, i) => html`
      <button class="row place-row" data-i="${i}">
        <span class="row-main"><b>${p.name}</b><small>${[p.address, p.hours].filter(Boolean).join(' · ') || ' '}</small></span>
        <span class="row-amt">${p.km != null ? Places.fmtDist(p.km) : ''}</span>
      </button>`).join(''))}` : '';
    listEl.querySelectorAll('[data-i]').forEach(b => (b.onclick = () => focus(results[b.dataset.i])));
  };

  const drawPins = () => {
    if (!map) return;
    layer.clearLayers();
    for (const p of results) {
      L.marker([p.lat, p.lon], { icon: pinIcon() }).addTo(layer)
        .bindPopup(html`<b>${p.name}</b><br>${p.address || ''}${raw(p.hours ? html`<br><span class="mono">${p.hours}</span>` : '')}<br><a href="${Places.directionsUrl(p)}" target="_blank" rel="noopener">Directions →</a>`);
    }
    if (results.length) map.fitBounds(L.latLngBounds(results.map(p => [p.lat, p.lon])).pad(0.2), { maxZoom: 16 });
  };

  const focus = p => {
    if (!map) return;
    map.setView([p.lat, p.lon], 17);
    layer.eachLayer(m => { const ll = m.getLatLng(); if (ll.lat === p.lat && ll.lng === p.lon) m.openPopup(); });
    root.querySelector('.map-wrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const showMe = loc => {
    if (!map || !loc) return;
    if (meMarker) meMarker.setLatLng([loc.lat, loc.lon]);
    else meMarker = L.marker([loc.lat, loc.lon], { icon: pinIcon('me'), zIndexOffset: 1000 }).addTo(map);
  };

  const run = async (fn, label) => {
    toast(label, 1500);
    try {
      results = await fn();
      if (!results.length) toast('Nothing found here. Try a wider search.');
    } catch (e) {
      toast(e.message, 4000);
      results = [];
    }
    drawList();
    drawPins();
  };

  root.querySelector('[data-search]').onsubmit = e => {
    e.preventDefault();
    lastQuery = e.target.querySelector('input').value.trim();
    if (!lastQuery) return;
    active = null;
    root.querySelectorAll('[data-cat]').forEach(c => c.classList.remove('on'));
    run(() => Places.search(lastQuery, Places.lastLocation()), 'Searching…');
  };
  root.querySelectorAll('[data-cat]').forEach(b => (b.onclick = async () => {
    active = b.dataset.cat;
    root.querySelectorAll('[data-cat]').forEach(c => c.classList.toggle('on', c === b));
    let loc = Places.lastLocation();
    if (!loc || Date.now() - loc.at > 10 * 60e3) { try { loc = await Places.locate(); showMe(loc); } catch (e) { if (!loc) return toast(e.message, 4000); } }
    run(() => Places.nearby(active, loc, 2500), `Finding ${Places.CATEGORIES[active][0].toLowerCase()} nearby…`);
  }));
  root.querySelector('[data-locate]').onclick = async () => {
    try { const loc = await Places.locate(); showMe(loc); map?.setView([loc.lat, loc.lon], 15); } catch (e) { toast(e.message, 4000); }
  };
  root.querySelector('[data-ask]').onclick = () => openAssistant();

  drawList();
  loadLeaflet().then(() => {
    if (!document.getElementById('map')) return; // user left the tab
    if (map) { map.remove(); meMarker = null; }
    const loc = Places.lastLocation();
    map = L.map('map', { zoomControl: false, attributionControl: true }).setView(loc ? [loc.lat, loc.lon] : [43.238, 76.946], loc ? 15 : 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    layer = L.layerGroup().addTo(map);
    showMe(loc);
    drawPins();
    if (!loc) Places.locate().then(l => { showMe(l); map.setView([l.lat, l.lon], 15); }).catch(() => {});
  }).catch(() => toast('Map could not load. Check your connection.'));
}
