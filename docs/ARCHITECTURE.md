# How Yaver works

There is also an interactive version of this guide, with a 3D system map, animated diagrams and live reference tables, at `/handbook/` (Settings → System handbook). It reads tools, stores, settings and the changelog straight from the code, and `tests/docs-coverage.mjs` fails if a file is left undocumented.

This guide explains Yaver from the outside in: what kind of app it is, where your data lives, how the AI part works, and what each file does. You don't need to be a programmer to follow the first half.

## 1. The big picture

Yaver is a **Progressive Web App (PWA)**: a website that behaves like an installed app. You open it once in Safari, tap **Share → Add to Home Screen**, and from then on it has its own icon, opens full screen, and works offline.

Why this instead of a "real" App Store app?

| | PWA (what Yaver is) | Native iPhone app |
|---|---|---|
| Needs a Mac + Xcode | No | Yes |
| Needs Apple Developer account ($99/year) | No | Yes (or the app expires every 7 days) |
| Updates | Instant: change the files, the phone picks them up | Rebuild and reinstall |
| Works offline | Yes | Yes |
| Access to iPhone Calendar / background alerts | Indirect (via `.ics` files and the Calendar app) | Direct |

For a personal assistant that one person uses, the PWA wins: it's free, runs without your laptop, and you can change it any time.

```
            ┌──────────────────────── Your iPhone ────────────────────────┐
            │                                                             │
 GitHub     │   Safari / Home Screen app                                  │
 Pages ───────►  ┌──────────────┐   reads/writes   ┌──────────────────┐   │
 (hosting,  │    │  Yaver app   │ ───────────────► │ IndexedDB        │   │
  files     │    │  HTML/CSS/JS │                  │ (your data, on   │   │
  only)     │    └──────┬───────┘                  │  this device)    │   │
            │           │  Service worker keeps    └──────────────────┘   │
            │           │  a copy for offline use                         │
            └───────────┼─────────────────────────────────────────────────┘
                        │ HTTPS, with your API key
                        ▼
              ┌───────────────────┐
              │ Anthropic API     │  Claude thinks, and asks the app
              │ (Claude)          │  to run tools ("add_expense"...)
              └───────────────────┘
```

There are only three moving parts:

1. **Hosting** (GitHub Pages) just hands the app's files to Safari the first time. It never sees your data.
2. **The app on your phone** does everything else: screens, storage, timers, charts.
3. **Claude** (through the Anthropic API) is the brain, called only when you talk to Yaver.

There is **no Yaver server**. Nothing runs on your laptop.

## 2. Where your data lives

All your expenses, meetings, study sessions, meals, tasks, course progress, settings and chat history live in **IndexedDB**, a small database built into the browser, stored on the device itself. Each device (iPhone, MacBook) has its own copy; turn on **Sync** (section 9b) to keep them the same.

- It survives closing the app and restarting the phone.
- Yaver asks iOS to keep it "persistent" so it isn't cleared to free space.
- **Deleting the Home Screen icon deletes the data on that device**, so use *Settings → Export backup* now and then, or keep Sync on. The backup is one JSON file you can save to Files/iCloud and import later. Importing *merges*: for each record the newer version wins.
- Every saved record carries `updatedAt` and the device that wrote it, and every delete leaves a small "tombstone" (kept 90 days). That is what lets two devices merge record by record.

When the app starts, `db.js` loads every table into memory (your data is small, a few thousand rows at most), so screens draw instantly. Every save writes to memory and to IndexedDB at the same time.

## 3. How the AI part works

When you ask Yaver something, the app runs an **agent loop**:

```
 You: "spent 120 on lunch and set a meeting with Ayşe tomorrow at 3"
   │
   ▼
 App sends to Claude: your message + the conversation so far
                      + the list of 21 tools Yaver offers (plus web search)
   │
   ▼
 Claude replies: "call add_expense {amount:120, category:Food}"
                 "call list_meetings {from: tomorrow}"   ← checks for clashes
   │
   ▼
 App runs those functions on the phone, sends the results back
   │
   ▼
 Claude replies: "call add_meeting {title:'Meeting with Ayşe', start:'…T15:00'}"
   │
   ▼
 App runs it, sends the result back
   │
   ▼
 Claude replies with text: "Done: logged 120 for lunch, Ayşe is booked for 15:00."
```

Key ideas:

- **Tools** are how Claude touches your data. Each tool is a name, a description, and a JSON schema (in `js/ai/tools.js`), plus a JavaScript function the app runs. Claude never touches the database directly; it *asks*, the app *does*.
- **Context**: every request includes the current date/time, your name, currency and "About you" text, so "tomorrow at 3" resolves correctly.
- **Streaming**: replies arrive word by word, so you see Yaver typing.
- **Photos**: the camera button shrinks the photo and sends it with your message. Claude can read a receipt (→ `add_expense`) or estimate a meal (→ `log_meal`).
- **Web search**: Claude can search the web itself (a server-side tool Anthropic runs) for fresh information like news or prices.
- **Prompt caching**: the fixed instructions and tool list are marked cacheable, so follow-up requests are cheaper and faster.
- **Fallbacks**: if a safety check declines a request, the API can retry on a fallback model automatically.

**Model and cost.** The default is Claude Opus 5.5 with "low" thinking effort for quick replies. You can switch to Sonnet 5.5 (cheaper) or Haiku 5.5 (cheapest, fastest) in Settings. You pay Anthropic per use from your own account; set a monthly spend limit at console.anthropic.com.

**Your API key** is stored in the phone's database and sent only to `api.anthropic.com`. Because the app calls the API straight from the phone, anyone holding your unlocked phone could read the key, the same as any saved password. The spend limit is your safety net.

## 3b. Free mode: Gemini (added in v3)

Yaver can use either brain. **Gemini** (Google) has a free tier: get a key at aistudio.google.com/apikey, paste it on Home or in Settings → AI. **Claude** is paid and smarter. Yaver tells the keys apart by their start (`AIza…` is Gemini, `sk-ant-…` is Claude) and switches to whichever you pasted; Settings → AI → Assistant switches back and forth.

- `js/ai/gemini.js` runs the same agent loop as `claude.js`, over Gemini's REST API (`streamGenerateContent`). The 21 tools are translated into Gemini "function declarations", so both brains do exactly the same things to your data.
- On first use it asks Google which models your key can use and picks the best stable free "flash" model.
- Each brain keeps its own conversation history, because their message formats differ.
- Limits: the free tier caps requests per minute and per day, Google may use free-tier chats to improve its models, and web search is Claude-only.
- `js/ai/provider.js` holds the switch: which brain is active, saving a pasted key, and testing it.

## 3c. Claude on your Mac (added in v5)

`bridge/yaver-bridge.mjs` is a tiny web server you run on your MacBook. It receives Yaver's conversation and tool list, runs Claude Code in print mode (`claude -p`, no built-in tools, structured JSON output) under your Claude subscription, and returns the reply and any tool calls. Tailscale gives the phone a private HTTPS address for it. `js/ai/mac.js` is the phone side: before each text message it checks `/health` (remembered for 30 seconds), uses the Mac when it answers, and otherwise falls back to the chosen AI, usually Gemini. A token protects the bridge. Setup steps: `bridge/README.md`.

## 4. Offline and updates

`sw.js` is a **service worker**: a small script Safari runs in the background for the app. On first launch it saves a copy of every app file. After that:

- Yaver opens instantly, even with no internet. All trackers work offline; only the AI needs a connection.
- Each launch it quietly checks for newer files. When you publish an update (and bump `VERSION` in `sw.js`), the next launch after that picks it up.

## 5. Calendar and reminders

A web app can't write directly into the iPhone Calendar or schedule alerts while closed. Yaver bridges that with the standard **`.ics` calendar file**: when you save a meeting with "Also add to iPhone Calendar" on, Yaver hands iOS an `.ics` file containing the meeting and a reminder. You add it to Calendar, and from then on the iPhone itself alerts you, even if Yaver is closed. "Send upcoming to iPhone Calendar" does this for all future meetings at once.

The study focus timer stores *when it started*, not a running counter, so it stays correct even if you close the app mid-session.

## 5b. Study plan, reminders, map (added in v2)

- **Study plan.** The 52-week ML Engineer roadmap is bundled as `data/ml-roadmap.json`. "Load the ML Engineer roadmap" on the Study tab turns each phase into a subject whose milestones are its topics, project and checkpoint. Yaver then shows the current week and phase, the weekly hours target, and the next topics to tick off. Claude can read it (`get_study_plan`, `get_roadmap`) and tick milestones for you.
- **Practice counters.** Problems solved and Anki reviews per day (`log_practice`).
- **Reminders** (`js/reminders.js`) are plain facts computed from your data: study goal left, "don't miss two days in a row", behind weekly pace, next topic, meeting soon, overdue tasks, budget pace. Home shows them, and Claude gets the same list, so briefings match the screen.
- **Map** (`js/views/map.js`, `js/places.js`) uses free OpenStreetMap services: Nominatim for search by name or address, Overpass for "pharmacy / cafe / coworking near me". No account or key. Results open in Apple Maps for directions. Claude uses the same code through `find_places`.

## 6. The files

```
yaver/
├── index.html              The shell: tab bar, the glowing button, loads js/app.js
├── manifest.webmanifest    Name, icons, colours: what makes it installable
├── sw.js                   Service worker: offline copy + updates
├── css/app.css             All styling (dark theme, cards, sheets, chat)
├── icons/                  Home Screen icons
├── data/ml-roadmap.json    Copy of the 52-week study roadmap
├── vendor/                 Anthropic SDK (one file) and Leaflet (map)
└── js/
    ├── app.js              Starts everything; switches screens; redraws on data change
    ├── db.js               IndexedDB storage, settings, backup/restore
    ├── data.js             The "business logic": budgets, streaks, free slots, totals
    ├── util.js             Dates, money formatting, bottom sheets, toasts, Markdown
    ├── ui.js               Progress rings, bar charts
    ├── forms.js            Add/edit sheets for expenses, meetings, study, meals, tasks
    ├── ics.js              Builds .ics calendar files
    ├── reminders.js        Plain "what needs attention today" facts
    ├── places.js           OpenStreetMap search and nearby lookup
    ├── icons.js            Line icons
    ├── views/              One file per screen: home, study, calendar, money, diet, map, settings
    └── ai/
        ├── provider.js     Picks Gemini (free) or Claude; saves and tests keys
        ├── gemini.js       Talks to Google's Gemini API; same agent loop
        ├── mac.js          Talks to the bridge on your Mac (Claude via your subscription)
        ├── claude.js       Talks to the Anthropic API; the agent loop
        ├── tools.js        The 21 tools Claude can call, and the code behind each
        └── assistant.js    The chat screen: messages, photos, voice in/out
```

**One rule ties it together:** both the screens and Claude's tools call the same functions in `data.js`. So "how much did I spend this week" means exactly the same thing whether you look at the Money tab or ask Yaver.

**How a screen redraws:** every write to the database fires a change event. `app.js` listens and redraws the current screen. That's why, when Claude logs a meal in the chat, the Diet ring behind it is already updated when you close the chat.

## 7. Technology choices, briefly

- **Plain JavaScript modules, no framework and no build step.** Safari runs the files exactly as written. Fewer moving parts, tiny download, nothing to compile, and easy to read and change.
- **IndexedDB** over `localStorage`: more storage, structured data, and more durable on iOS.
- **The official Anthropic SDK** for the API: streaming, retries and typed errors handled for us.
- **Web Speech API** for the mic button (falls back to the keyboard's dictation key), and speech synthesis to read replies aloud.

## 8. Changing things yourself

- Add an expense category: edit `EXPENSE_CATEGORIES` in `js/data.js`.
- Change Yaver's personality: edit `STATIC_SYSTEM` in `js/ai/claude.js`.
- Give Claude a new ability: add an entry to `TOOLS` in `js/ai/tools.js` (schema + `run` function).
- After any change: bump `VERSION` in `sw.js`, publish, and reopen the app twice.

## 9. The course (added in v5)

The Study tab can run a full day-by-day course: Python, C++, algorithms, math, AI and robotics, plus a weekly project. Tap **Study → Start the course**.

**What's bundled.** `data/course/course.json` is the map: the 8 tracks, the daily time slots (weekday, Saturday, Sunday), the phases A–F with which track goes in which slot on which day, the 64 weeks with their themes, the consolidation weeks, and short outlines for weeks 16–63. `data/course/weeks/week-00.json` … `week-15.json` hold the full lessons for the first 16 weeks. `data/course/urls.json` is the list of checked links; lessons only link to these.

**A day.** Each slot in the day has a *lane* (for example "Python, deep" or "Robotics, teaching prep"). The slot shows the **next unfinished lesson in that lane**. Nothing is ever skipped: if you miss Monday, Monday's lesson simply moves to the next time that lane comes up, and everything after it shifts. Friday's **buffer** slot goes to, in order: a flagged lesson, the track that is most behind, or the nearest teaching deadline.

**A lesson** is at least an hour, in steps: a recall warm-up, learning, worked examples, practice tasks (with a hint ladder and a hidden solution), and an exit ticket. Score 80% or more on the exit ticket and the lesson is *mastered*; below that it is *flagged* and comes back. Completing a lesson logs the minutes as study time and adds 3–6 **review cards**.

**Review cards** use spaced repetition: every card sits in a box, and each box has an interval (1, 3, 7, 14, 30, 60 days). *Good* moves the card up a box, *Easy* two boxes, *Hard* keeps the box but halves the wait, and *Again* sends it back to tomorrow.

**Pace** per track compares the lessons the schedule expected by now with the lessons done: green on pace, yellow one or two behind, red more. **Sunday** has the weekly test (mixed questions from the week; under 70% in a track flags it for Monday) and the ship checklist. **Consolidation weeks** (6, 11, 17, …) have no new material: retake tests, redo flagged tasks, finish projects. Week 6 includes a retake of the Week 0 diagnostic.

**Weeks 16+** ship as outlines. When one comes close, the course screen shows **Prepare week N**: Yaver's AI writes the full lessons from the outline and saves them with the `save_week_lessons` tool, which checks them first (right number per lane, the step template, minutes). They are stored in the `courseLessons` table and sync like everything else.

**Sleep is fixed.** 22:30–05:30 is protected: slot times can't be moved into it, and the AI is told never to suggest cutting it.

**The AI tutor.** Eight tools give both brains (Claude and Gemini) the course: `get_course_today`, `get_lesson`, `complete_lesson`, `get_review_cards`, `grade_card`, `get_course_progress`, `record_test_result`, `save_week_lessons`. **Tutor me** in a lesson starts a chat that teaches step by step (warm-up first, ask before explaining, hints before solutions, then the exit ticket) and records the result. The screens and the tools call the same functions in `js/course.js`, so both always agree.

**Calendar.** "Add this week to Calendar" makes an `.ics` file with every block of the week and a 5-minute alert, so the iPhone (or the Mac's Calendar app) reminds you even when Yaver is closed.

New files: `js/course.js` (all course logic), `js/views/course.js` (overview, today card, block alerts), `js/views/lesson.js` (lesson runner, review, test, ship, prepare), `js/keys.js` (keyboard shortcuts). New database tables: `courseProgress`, `cards`, `courseLessons`, `courseTests`, and `tombstones`.

## 9b. Using Yaver on a laptop, and sync

**On the laptop** open the same address (https://mskorkmaz08-del.github.io/yaver/) in Chrome, Edge or Safari. From 1100 px wide, a sidebar replaces the bottom tabs, the lesson runner has two columns (the lesson on the left, a sticky panel with timer, steps and notes on the right), and from 1400 px **Tutor me** docks the chat as a third column. Press `?` for keyboard shortcuts. Practice tasks have a **starter file** button that downloads a `.py` or `.cpp` file with tests, ready for VS Code. **Install it as an app:** in Chrome or Edge use *Settings → Install Yaver on this computer*; in Safari on the Mac use *File → Add to Dock*.

**Sync, without a server.** Each device keeps its own database. To keep them the same, Yaver stores one **encrypted** file in a *secret GitHub Gist* on your own GitHub account:

```
 iPhone ──┐                                         ┌── MacBook
          │  1. pull the gist, decrypt              │
          │  2. merge record by record              │
          │     (newest updatedAt wins,             │
          │      tombstones carry deletes)          │
          │  3. encrypt, push                       │
          └────────────►  api.github.com  ◄─────────┘
                    gist "Yaver sync, encrypted"
                    file  yaver-sync.enc  (ciphertext only)
```

- **Encryption.** Before anything leaves the device it is gzipped and encrypted with AES-GCM 256. The key comes from your sync passphrase (PBKDF2-SHA-256, 310,000 rounds, random salt), with a fresh random IV on every upload. GitHub only ever stores ciphertext. A wrong passphrase stops with a clear message and changes nothing.
- **What syncs:** all your records (money, meetings, study, diet, tasks, course progress, cards, tests, prepared weeks) and shared settings. **What never syncs:** API keys, the sync token and passphrase, which AI you use, voice settings, and the chat history. They also never go into backups or to the AI.
- **Counters** (water glasses, problems solved, card reviews) are kept per device and added up, so two devices tapping "+1" at the same time both count.
- **When it runs:** 10 seconds after a change, when you come back to the app, when you come back online, and from *Sync now*. A small dot shows the state (green synced, blue syncing, grey offline, red problem).
- **Safety nets:** before the first sync on a device that already has data, Yaver keeps a local backup (the last 3). A device with no data never uploads over a synced copy that has data without asking. If the other device pushed in the same moment, Yaver pulls again and retries.
- Code: `js/crypto.js` (encryption), `js/sync.js` (GitHub calls and the pull → merge → push loop), `db.merge()` in `js/db.js`.

**Setting it up** (steps also in Settings → Sync): create a GitHub **fine-grained personal access token** with only *Account permissions → Gists: Read and write*; choose a passphrase of a few words; paste both on the first device, then on the second. The first creates the gist; the second finds it by its description and pulls.
