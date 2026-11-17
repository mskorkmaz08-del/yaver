// Yaver M III has no turning gears: the Piltover mechanisms of M1 are gone. This module keeps
// the same calls (scan, kick, initDrive) so every screen works unchanged, and fills the places
// that held a gear with the M III mark: a soft gradient orb with the Y line drawing.
// Each copy gets its own gradient id: a url(#id) pointing into an svg that is display:none
// (the floating button on a computer) paints nothing, so a shared id blanks the other marks.
let n = 0;
const mark = () => { const id = `m3g${++n}`; return `<svg viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--accent-2)"/><stop offset="1" stop-color="var(--accent)"/></linearGradient></defs><rect x="2" y="2" width="44" height="44" rx="14" fill="url(#${id})"/><path d="M15 14.5 24 26l9-11.5M24 26v8.5" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`; };
const ORB = '<span class="m3-orb" aria-hidden="true"><i></i></span>';

export const markSVG = () => mark();
export function scan(root = document) {
  root.querySelectorAll('[data-gear="button"]:not([data-m3])').forEach(el => { el.dataset.m3 = '1'; el.innerHTML = mark(); });
  root.querySelectorAll('[data-gem]:not([data-m3])').forEach(el => { el.dataset.m3 = '1'; el.innerHTML = ORB; });
}
export function kick() {}
export function initDrive() {}
export const onEngineTap = () => {};
