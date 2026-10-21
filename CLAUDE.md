# Working on Yaver

Yaver is a no-build PWA: plain ES modules served as-is by GitHub Pages from `main`. Read `docs/ARCHITECTURE.md` or open `/handbook/` for how it fits together.

## Every change

1. **Keep the handbook current.** The handbook (`handbook/`) reads tools, stores, settings, course numbers, file sizes and the changelog live from the code and GitHub. What it can't read lives in `handbook/content.js`:
   - a new or renamed file: add or update its line in `FILES`;
   - a new store: add its fields to `STORE_FIELDS`;
   - a new screen, AI route, service or flow: update `LAYERS`, `SERVICES`, `FLOWS`, `SECURITY`, `STACK` or `RECIPES` as it applies, and the prose in `handbook/index.html` if a section's explanation changed;
   - mirror plain-language changes in `docs/ARCHITECTURE.md`.
2. **Bump `VERSION` in `sw.js`** whenever app files change, and add new app files to its `FILES` list.
3. **Run the checks** from the repo root with the site served on port 8765 (`python3 -m http.server 8765`):
   - `node tests/docs-coverage.mjs` (fails if the handbook misses a file, store or section);
   - the Playwright tests in `tests/` (`smoke.mjs`, `course-smoke.mjs`, `sync-test.mjs`, `mac-bridge.mjs`); launch Chromium with `executablePath: '/opt/pw-browsers/chromium'` in the cloud container.
4. Never commit API keys or tokens: the repo and site are public. Keys are typed into the app on each device.
