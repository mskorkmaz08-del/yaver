# Yaver

A personal assistant for iPhone: expenses and budget, meetings, study progress and streak, diet and water, to-dos, and Claude built in to talk to, by voice, text or photo.

It is an installable web app (PWA). It runs entirely on the phone; there is no server. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it works.

## Put it online (GitHub Pages)

1. Push this folder to a GitHub repository.
2. Repository **Settings → Pages → Build and deployment**: Source *Deploy from a branch*, branch `main`, folder `/ (root)`.
3. After a minute it's live at `https://<your-username>.github.io/<repo>/`.

Any static HTTPS host works the same way (Netlify, Cloudflare Pages, Vercel).

## Install on the iPhone

1. Open the site in **Safari**.
2. Tap **Share → Add to Home Screen → Add**.
3. Open Yaver from the Home Screen, enter your name, and paste an Anthropic API key from [console.anthropic.com](https://console.anthropic.com/settings/keys) (set a monthly spend limit there).

## Run it locally

```sh
python3 -m http.server 8765   # then open http://localhost:8765
```

## Updating

Change files, bump `VERSION` in `sw.js`, push. The phone picks up the new version on the next launch.

## Tests

`tests/smoke.mjs` loads the app in an iPhone-sized Chromium with Playwright, seeds data, visits every screen, and runs a chat turn against a simulated Claude API to check the tool loop.
