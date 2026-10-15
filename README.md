# Yaver

A personal assistant for iPhone and laptop: expenses and budget, meetings, study progress and streak, a full day-by-day course (Python, C++, algorithms, math, AI, robotics) with lessons, review cards and an AI tutor, diet and water, to-dos, and an AI assistant (free Gemini or Claude) built in to talk to, by voice, text or photo.

It is an installable web app (PWA). It runs entirely on your devices; there is no server. Optional encrypted sync keeps the iPhone and the laptop on the same data. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it works.

## Put it online (GitHub Pages)

1. Push this folder to a GitHub repository.
2. Repository **Settings → Pages → Build and deployment**: Source *Deploy from a branch*, branch `main`, folder `/ (root)`.
3. After a minute it's live at `https://<your-username>.github.io/<repo>/`.

Any static HTTPS host works the same way (Netlify, Cloudflare Pages, Vercel).

## Install on the iPhone

1. Open the site in **Safari**.
2. Tap **Share → Add to Home Screen → Add**.
3. Open Yaver from the Home Screen, enter your name, and paste an AI key: a free Gemini key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey), or a paid Anthropic key from [console.anthropic.com](https://console.anthropic.com/settings/keys).

## Install on a computer

Open the same address in a desktop browser. **Chrome or Edge:** Settings → *Install Yaver on this computer* (or the install icon in the address bar). **Safari on a Mac:** *File → Add to Dock*. The laptop layout (sidebar, two-column lessons, keyboard shortcuts: press `?`) switches on at 1100 px wide.

## Set up sync (iPhone ⇄ laptop)

1. On github.com: **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**. Name it *Yaver sync*, Repository access *Public repositories*, and under **Account permissions** set **Gists: Read and write** (nothing else). Copy the token.
2. Choose a sync passphrase of a few words (at least 10 characters). Write it down: without it the synced copy can't be opened.
3. In Yaver on the first device: **Settings → Sync**, paste the token and the passphrase, *Turn on sync*. Then do the same on the second device.

Everything is encrypted on the device (AES-GCM 256) before it reaches GitHub. API keys, the token, the passphrase and chats never leave the device. Details: [ARCHITECTURE.md §9b](docs/ARCHITECTURE.md#9b-using-yaver-on-a-laptop-and-sync).

## Run it locally

```sh
python3 -m http.server 8765   # then open http://localhost:8765
```

## Updating

Change files, bump `VERSION` in `sw.js`, push. The phone picks up the new version on the next launch.

## Tests

Serve the folder on port 8765, then run with Node and Playwright:

- `tests/smoke.mjs` loads the app in an iPhone-sized Chromium with Playwright, seeds data, visits every screen, and runs a chat turn against simulated Gemini and Claude APIs to check the tool loop.
- `tests/course-smoke.mjs` checks the course with a faked clock on an iPhone and at 1440×900: Week 0, Tuesday's slots, mastery and flagging, the buffer, card grading, consolidation, Sunday, the AI course tools on Claude and Gemini, the sidebar, two-column lesson, keyboard shortcuts and the docked tutor.
- `tests/sync-test.mjs` syncs two browser profiles through a simulated GitHub: union of changes, newest edit wins, deletions travel, counters add up, wrong passphrase changes nothing, no keys or chats in the payload.
- `node tests/validate-course.mjs` checks every lesson file against the course rules; `node tests/run-lesson-code.mjs` runs every Python and C++ code block and task test in the lessons.
