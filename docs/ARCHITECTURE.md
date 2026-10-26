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

`bridge/yaver-bridge.mjs` is a tiny web server you run on your MacBook. It receives Yaver's conversation and tool list, runs Claude Code in print mode (`claude -p`, no built-in tools, structured JSON output) under your Claude subscription, and returns the reply and any tool calls. To reach it from the iPhone, the bridge starts a free Cloudflare quick tunnel (`cloudflared`), which gives it a public HTTPS link, and prints a **connection code** (the link plus the token) that you paste into Yaver once. The link changes on every restart, so the bridge also posts it to a private ntfy.sh topic named after a hash of the token; when the old link stops answering, Yaver looks there and switches to the new one by itself. (Tailscale was tried first, but iPhones block an https page from talking to a plain http address, and Tailscale's https setup kept failing.) `js/ai/mac.js` is the phone side: before each text message it checks `/health` (remembered for 30 seconds), uses the Mac when it answers, and otherwise falls back to the chosen AI, usually Gemini. A token protects the bridge. Setup steps: `bridge/README.md`.

**On the MacBook itself (v27)** nothing needs pasting. Yaver open in a browser on the Mac asks `http://127.0.0.1:8787/pair`; the bridge answers only requests made on that Mac from Yaver's own page, and hands over its address and token. To have the bridge always ready, paste one line into Terminal once (Settings → Claude on your Mac shows it with a Copy button): it downloads the latest bridge and runs `node ~/yaver-bridge/yaver-bridge.mjs --install`, which makes it a login item (a LaunchAgent) that starts with the Mac and restarts itself. `--uninstall` removes it. The iPhone keeps using Gemini unless you also paste the connection code there.

**Laptop setup card (v33).** On a computer where no bridge answers, Home shows the same Terminal line with Copy, Check again and Not now (hidden for a week). Run it once in Terminal: it needs Claude Code installed and signed in to the subscription, and no ANTHROPIC_API_KEY set (the installer warns about both). Chrome may ask to allow access to the local network once; allow it. Yaver tries 127.0.0.1 and then localhost. After that the bridge starts at every login.

## 3d. Çetele (added in v13)

Çetele is the daily list of spiritual minimums (namaz, Quran and book pages, salawat, Jawshan, tahajjud, weekly fasting), and it comes first in the app: it has its own tab, the top card on Home, and the first reminder of the day. `js/cetele.js` holds the logic. Items live in the `ceteleItems` store, and each day's count is one `ceteleLog` row named `<item>:<day>`. A day counts toward the streak when every daily minimum is met; weekly items (fasting) add up from Monday. The AI can read it (`get_cetele`), log to it (`log_cetele`, e.g. "read 4 pages of Quran") and change the list (`set_cetele_item`). It syncs between devices like every other record.

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
├── index.html              The shell: tab bar, the Yaver gear button, loads js/app.js
├── manifest.webmanifest    Name, icons, colours: what makes it installable
├── sw.js                   Service worker: offline copy + updates
├── css/app.css             All styling: the Piltover look (navy, gold trim, ivory marble, the yellow notebook) and its motion, cards, sheets, chat
├── fonts/                  Archivo (variable width) and IBM Plex Mono, stored in the app so they work offline
├── icons/                  Home Screen icons: the Yaver gear with its hextech crystal
├── sounds/                 The Academy music (see CREDITS.md)
├── tools/                  Scripts that made the sounds and the music (run on a computer)
├── data/ml-roadmap.json    Copy of the 52-week study roadmap
├── vendor/                 Anthropic SDK (one file) and Leaflet (map)
└── js/
    ├── app.js              Starts everything; switches screens; redraws on data change
    ├── sound.js            Background music (sounds/academy.mp3), switch in Settings
    ├── focus.js            Full-screen focus mode with a small timer
    ├── sims.js             The workshop: picks a simulator for each lesson and gives it canvas, controls, timeline
    ├── sims/               13 simulators: circuit, sort, search, graph, structures, vectors, calculus,
    │                       probability, data (tables), trace (Python), memory (C++), git, shell
    ├── db.js               IndexedDB storage, settings, backup/restore
    ├── data.js             The "business logic": budgets, streaks, free slots, totals
    ├── util.js             Dates, money formatting, bottom sheets, toasts with Undo, haptics, timers, Markdown
    ├── skills.js           Skill levels: XP from everything, ratings, levels, form, the hexagon
    ├── command.js          The command bar (hold the gear, or ⌘K): do, find or ask
    ├── ui.js               Progress rings, bar charts, the lesson step strip, the study subdial
    ├── forms.js            Add/edit sheets for expenses, meetings, study, meals, tasks
    ├── ics.js              Builds .ics calendar files
    ├── reminders.js        Plain "what needs attention today" facts
    ├── places.js           OpenStreetMap search and nearby lookup
    ├── icons.js            Line icons
    ├── views/              One file per screen: home, çetele, study, calendar, money, diet, map, skills, settings
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
- **Web Speech API** for the mic button (falls back to the keyboard's dictation key), and speech synthesis to read replies aloud. **Voice chat** (the wave button at the top of the chat) chains them: Yaver listens, sends what you said with a note asking for short spoken answers, reads the reply aloud with the best voice installed on the phone, then listens again until you stay silent or tap the wave button. It works with Gemini, the Mac or the Claude API. **Live voice (since v18, the default engine).** The wave button opens a live conversation with Gemini's Live API: `js/ai/live.js` streams your microphone over a WebSocket and plays the model's own voice as it arrives, so there is no listen → write → read-aloud chain and replies start in about a second. You can talk over it to interrupt. The model still uses Yaver's tools ("log two pages of Quran" really logs them), and both sides of the conversation are written into the chat. If Live can't start (for example the free tier doesn't allow it for your key), Yaver says so and uses the standard engine below. Settings → AI → Voice chat engine switches between them.

**Reliable live voice and Claude as a helper (v21).** Live sessions ask Gemini for a resumption handle and compress old context, so a long conversation doesn't run out. If no answer has started 7 seconds after you stop talking, or the connection drops, Yaver reconnects with that handle and asks your question again, at most twice in a row, before telling you Gemini isn't answering. When the Mac bridge is set up, the live model also has an `ask_claude` tool: for a hard question it says "let me ask Claude", sends the question to Claude on your Mac (your subscription, no extra cost), and reads Claude's answer aloud. The orb shows "reconnecting…" or "asking Claude on your Mac…" while that happens. Most of the slowness and silences on Gemini's free tier come from its rate limits; a paid Gemini key (billing on in Google AI Studio) removes them without any change in Yaver.

**No wake word (v27).** Yaver used to listen for "Yaver" whenever it was open (v19 to v26). It was removed in v27: the microphone turns on only when you tap the mic or start voice chat.

**Standard engine.** Replies are read with the **iPhone's own voice** by default (since v16): instant, offline and clean, and Yaver picks a British male voice, best of all a downloaded Premium one such as Arthur, for a Jarvis feel. Optionally, `js/ai/voice.js` can send the text to Gemini's text-to-speech with your free key and plays the audio it returns. If that fails (no key, free limit used up, offline), the iPhone's own voice reads it instead. Settings → AI has the voice picker and a Hear this voice button. To keep voice chat quick, the reply is voiced a sentence at a time while it is still being written (the first sentence on its own), Gemini answers without its thinking step, and the Mac is skipped unless you turn it on for voice chat. Each clip has its leading silence cut, and a short burst of static that Gemini sometimes adds after the last word is detected (noisy sound after a pause) and removed.

## 8. Changing things yourself

- Add an expense category: edit `EXPENSE_CATEGORIES` in `js/data.js`.
- Change Yaver's personality: edit `STATIC_SYSTEM` in `js/ai/claude.js`.
- Give Claude a new ability: add an entry to `TOOLS` in `js/ai/tools.js` (schema + `run` function).
- After any change: bump `VERSION` in `sw.js`, publish, and reopen the app twice.

## 9. The course (added in v5)

The Study tab can run a full day-by-day course: Python, C++, algorithms, math, AI and robotics, plus a weekly project. Tap **Study → Start the course**.

**What's bundled.** `data/course/course.json` is the map: the 8 tracks, the daily time slots (weekday, Saturday, Sunday), the phases A–F with which track goes in which slot on which day, the 64 weeks with their themes, the consolidation weeks, and short outlines for weeks 16–63. `data/course/weeks/week-00.json` … `week-15.json` hold the full lessons for the first 16 weeks. `data/course/urls.json` is the list of checked links; lessons only link to these.

**A day.** Each slot in the day has a *lane* (for example "Python, deep" or "Robotics, teaching prep"). The slot shows the **next unfinished lesson in that lane**. Nothing is ever skipped: if you miss Monday, Monday's lesson simply moves to the next time that lane comes up, and everything after it shifts. Friday's **buffer** slot goes to, in order: a flagged lesson, the track that is most behind, or the nearest teaching deadline.

**A lesson** is at least an hour, in steps: a recall warm-up, a first worked example, learning, practice tasks (with a hint ladder and a hidden solution), and an exit ticket. The rule is one path with no guessing: recall only asks about lessons you have finished (each question names its source lesson, and questions from lessons you haven't done are skipped, with exit questions from recently finished lessons filling in), the first example shows its result instead of asking you to predict, and every question has a "don't know yet" button that shows the answer and offers a tutor explanation (on a scored question it counts as wrong). Algorithm lessons in weeks 1–7 also list a few optional LeetCode problems that only use what has been taught; solved or stuck is saved in the `leetcode` setting, and "go through it with Yaver" starts a walk-through. Score 80% or more on the exit ticket and the lesson is *mastered*; below that it is *flagged* and comes back. Completing a lesson logs the minutes as study time and adds 3–6 **review cards**.

**Review cards** use spaced repetition: every card sits in a box, and each box has an interval (1, 3, 7, 14, 30, 60 days). *Good* moves the card up a box, *Easy* two boxes, *Hard* keeps the box but halves the wait, and *Again* sends it back to tomorrow.

**Pace** per track compares the lessons the schedule expected by now with the lessons done: green on pace, yellow one or two behind, red more. **Sunday** has the weekly test (mixed questions from the week; under 70% in a track flags it for Monday) and the ship checklist. **Consolidation weeks** (6, 11, 17, …) have no new material: retake tests, redo flagged tasks, finish projects. Week 6 includes a retake of the Week 0 diagnostic.

**Weeks 16+** ship as outlines. When one comes close, the course screen shows **Prepare week N**: Yaver's AI writes the full lessons from the outline and saves them with the `save_week_lessons` tool, which checks them first (right number per lane, the step template, minutes). They are stored in the `courseLessons` table and sync like everything else.

**Sleep is fixed.** 22:30–05:30 is protected: slot times can't be moved into it, and the AI is told never to suggest cutting it.

**The AI tutor.** Eight tools give both brains (Claude and Gemini) the course: `get_course_today`, `get_lesson`, `complete_lesson`, `get_review_cards`, `grade_card`, `get_course_progress`, `record_test_result`, `save_week_lessons`. **Tutor me** in a lesson starts a chat that teaches step by step (recall from finished lessons only, teach before asking, never ask for a guess, hints before solutions, then the exit ticket) and records the result. The screens and the tools call the same functions in `js/course.js`, so both always agree.

**Calendar.** "Add this week to Calendar" makes an `.ics` file with every block of the week and a 5-minute alert, so the iPhone (or the Mac's Calendar app) reminds you even when Yaver is closed.

New files: `js/course.js` (all course logic), `js/views/course.js` (overview, today card, block alerts), `js/views/lesson.js` (lesson runner, review, test, ship, prepare), `js/keys.js` (keyboard shortcuts). New database tables: `courseProgress`, `cards`, `courseLessons`, `courseTests`, and `tombstones`.

## 9c. The look, sounds and the workshop (v25 to v32)

**Mark II craft and daily flow (v32).** Researched against current platform guidance (Apple's 2025 design language, Google's Material 3 Expressive research, the dark-first craft of apps like Linear) and applied as habits, not decoration:
- *Hierarchy from size and space.* Titles are big, bold and left aligned; labels are calm sentence case; numbers line up (tabular figures).
- *Surfaces step up in tone* and catch light on their top edge (a thin gradient border) instead of relying on heavy shadows; corners are precise and nested (16px plates, 10px controls, pill chips). The one main action on a screen is a lit gold button.
- *Controls float above content and get out of the way.* The tab bar is floating glass with a gold mark that glides to the open tab; scrolling down tucks it into a smaller pill and scrolling up brings it back. Once a screen's title scrolls away, a slim bar keeps it at the top (tap it to jump back up).
- *Thumb reach.* Messages rise from the bottom above the tab bar; the command bar's search field sits at the bottom on the phone.
- *One place to do anything* (`js/command.js`): hold the Yaver gear (or flick it up) on the phone, or press ⌘K / Ctrl+K on the laptop (also "Do or find" in the sidebar). It lists quick actions, a +1 for each open Çetele minimum and every screen; typing filters, and anything unmatched becomes a question to Yaver.
- *Undo instead of "are you sure?".* Deleting an expense, meal or meeting, finishing a to-do, logging a Çetele count or resetting a timer happens at once, with Undo in the message.
- *Feel.* A light haptic on the moments that matter (a count logged, a minimum met, a deletion); on the iPhone this uses the haptic Safari plays when a switch flips.
- *Home answers "what now?"* A greeting with one line of what is open today; the Çetele dial comes first in the morning and the next lesson first the rest of the day; one-tap +1 chips under the dial; four gauges (study, cards, spent with budget left, diet); a quick-add row.
- *Motion with meaning.* Springy easing; screens slide in from the side of the tab they come from, deeper screens rise.
- *Timers pause.* The lesson timer and the Study focus timer have Pause (keeps the time), Resume and a separate Reset.
- *Focus mode is truly full screen.* On a laptop the open notebook fills the whole screen; on the phone the paper runs edge to edge. A workshop opened with ⤢ now covers everything and ✕ or Esc reliably puts it back.


**Yaver Mark II, modern Piltover (v31).** Mustafa named this generation Yaver Mark II (shown in Settings next to the version); version numbers keep counting, and a fundamental redesign would become Mark III. v31 keeps the navy and gold but drops the 2000s-style trim: plates are rounded with a faint white hairline and a soft shadow, buttons are flat gold, chips are pills, switches look like iOS switches, the tab bar is frosted glass, headings are sentence-case Archivo (Cinzel only in the wordmark). Gears are flat colour with no painted lighting, so they look right at every angle while they turn. The hextech core is a round, slightly irregular glowing orb with a slow swirl and cracks of light, held in a brass ring. Lesson paper is plain yellow with no lines. The Çetele dial is redrawn after the clock on the show's poster (gold bezel, ivory face, tall gold numerals, a green subdial holding the count, a bronze subdial turning), and the lesson timer after the show's hextech gauge (steel case, hex windows that light teal for the current step, teal glass, a brass gear, a white needle with an orange tip). Because the repo and site are public, the show's art is redrawn as SVG in its design rather than copied in.


**The look: Piltover (v30).** Built from Arcane reference stills Mustafa sent (the mood only: no names, logos or images from the show). The ground is a navy night sky with a faint art-deco diamond lattice. Plates are navy with a hairline of gold and chamfered corners, a gold line across each cut. The main button on a screen is brass; the next-lesson plate on Home is ivory marble with gold inlay and a navy button. Progress bars are glass tubes with teal or gold light, switches are brass levers in a slot. The Çetele dial is an ivory clock face in a gold bezel with Roman numerals at the quarters and a hextech jewel on its hand; the lesson stopwatch and study subdial are brass and ivory too. Cinzel (inscription capitals) sets the wordmark, page titles and labels; Archivo the interface; IBM Plex Mono the numbers. The gears and crystals of v29 stay.

**White page edge (v43).** The dark strip between sheets looked like a black border, and a bit of it stayed visible at the edge just as the turn ended. It is now a white page edge with a soft shadow, like the back of the sheet being turned, and it fades in and out so nothing pops at the start or end.

**Whole sheets slide (v42).** Mustafa saw the text slide across page margins that stayed still. Now each spread moves as a whole sheet of paper, margins and edges included, with a strip of the dark desk between the outgoing and incoming sheet, like Apple Books. It is still one cheap sideways move of the real pages: the book is exactly one spread wide, so only the gap strip had to be added. Focus mode uses the same side margins so its sheets line up too.

**No middle line (v41).** Mustafa asked to remove the middle line as well, so the two pages are one plain sheet; only the thin edge between the old and new sheet shows while a page slides.

**No sounds, a thin middle line (v40).** Mustafa found the interface sounds bad even after softening, so they are gone: no clicks, latches or chimes, only the optional background music (Settings → Music). The shadow where the two pages meet is gone too; a thin line marks the middle instead, and while a page turns the middle lines and the edge between the sheets slide along with the paper.

**Smooth page slide, quiet sounds (v39).** The v38 slide sometimes froze: every turn copied the whole lesson twice and slid the big copies, so the browser had to lay out and paint far more than a screen. Now the real row of pages slides on the graphics chip (a transform), clipped to the book, with a soft seam between the sheets, so every frame takes the normal 1/60 s. The interface sounds were also made quieter and smoother on Mustafa's request: each starts with a slow fade instead of a sharp click, is gently compressed and has its treble rolled off, and plays at about half the old volume.

**Plain two-page view (v38).** Mustafa found the fold animation still distracting, so turning a page now works like Apple Books on a laptop (his reference screenshots): the whole open book slides away as one sheet and the next spread slides in, like moving to a fresh sheet of paper, with no curling or page drawing. The paper is lighter, close to white but still warm, and the workshop's controls are quieter: small squared buttons with flat fills and a plain slider knob instead of rounded, glossy ones.

**A calm notebook and an Apple Books page turn (v37).** Mustafa asked for the study pages to be calmer and easier on the eyes, with the page turn of Apple Books' full-screen view. The page is now one flat warm sepia sheet with soft brown ink, no brass rings (a soft fold where the pages meet), quiet hairline dividers, and code on a light panel instead of a dark chalkboard (the board's outer frame was also what got cut off during a turn). Step titles use a neater school handwriting, Edu AU VIC WA NT Hand (self-hosted, OFL). The turn folds the page back along a line that travels from the outer edge to the spine; the folded part shows the next page as it will land, with a sheen along the fold and light shadows, all as flat moves, so the copies match the real pages to the pixel. The page turn makes no sound, and the other sounds are softened (treble rounded off, a little room).

**A real page turn (v34).** The turning leaf is six hinged strips of paper (`js/notebook.js`), so the page curls as it lifts from the rings and flattens as it lands. Each strip darkens as it turns away from the light, the leaf throws a moving shadow on the page underneath, and its motion eases in and out like a hand turning a page. A page can also be dragged by its outer edge: it follows the pointer and lands, or falls back if let go early. The book scrolls into view before it turns, never both at once. Since v36 every strip is a whole number of pixels wide and carries an exact slice of the page's paper and gutter shadow, so the leaf lines up with the real pages to the pixel when it lifts and when it lands (no jump at either end), and a flatter perspective keeps the turning page inside the book.

**Lessons are a notebook (v30).** A lesson is written on yellow ruled paper with a red margin line: Spectral for reading, step titles handwritten in blue ink (Caveat), code chalked on a framed board, the workshop simulator set on the page as a navy instrument. On a laptop (1100px and wider) the lesson opens as a notebook with two pages side by side and brass rings down the spine (`js/notebook.js`): the text flows from page to page, and the arrows under the book, the ← → keys, PageUp/PageDown or a sideways trackpad swipe turn a page, with a paper leaf swinging over the spine. Jumping to a step, "n" and focus mode open the page holding that step, and the notebook remembers its page when the lesson redraws. The timer bar (with Tutor and Complete) sits above the book and the timer, steps and notes cards sit below it. Focus mode keeps only the step rail and the notebook, full width. On the phone the lesson is one long sheet of the same paper.

**Recorded interface sounds (v35).** The synthesized sounds are replaced by recordings: crisp switch and detent clicks, a latch and a metronome tick for the mechanism, glass pings when sheets open and close, a glass clink when something is saved, small chimes when something is done, and a card flip for the notebook's page turn. The sound libraries Yaver would normally use (Kenney, Freesound) are blocked from the build environment, so these come from open-source projects on GitHub: the osu! game's interface samples (CC BY-NC 4.0, fine for a personal, non-commercial app) and a glass clink from Minetest Game (CC BY-SA 3.0); `sounds/CREDITS.md` lists each one. They are on by default under a new setting, so having turned the old set off doesn't silence them.

**Interface sounds are off for now (v30).** Mustafa found the synthesized sounds poor, so they are off by default (Settings → Sound and music turns them back on) until recorded sounds replace them. The music stays.

**Before v30: Chronograph (v28).** Rebuilt from scratch in v28; nothing of the older look is left. Yaver looks like a machined instrument panel: graphite plates with a fine brushed grain, hairline steel lines, amber lume for what matters now (minimums met, the running timer, the main button on each screen) and steel blue for progress still underway. Type is Archivo, a variable-width grotesque set wide for the YAVER wordmark and labels and narrow for headings, with IBM Plex Mono for every number. Home is the panel: the Çetele dial (one segment per minimum around the bezel, minute ticks and a second hand that sweeps once a minute), the next lesson with its steps and Begin / Focus, four small arc gauges (study this week, cards due, next meeting, spent today) and the Ask bar. The dials and gauges are SVG drawn by `js/ui.js`; motion is quick and precise (screens rise in, gauges and bars draw themselves) and turns off under Reduce Motion.

**Hextech touches (v29).** Inside the Chronograph look, working mechanisms in the spirit of a hextech workshop (`js/mech.js`): a pair of meshing brass gears on every page title's rule and beside the Home wordmark, a brass and steel gear train turning behind the Çetele dial (and, on the laptop, in the next-lesson plate), a floating hextech crystal on the Ask bar, and a hextech engine (planetary gears, pistons, a crystal in a gimbal with energy arcs) in an empty chat. One drive shaft turns them all: it idles slowly, scrolling winds it, taps and saves kick it, and offscreen gears pause. Hextech blue marks Yaver's AI: the Ask bar, chat replies and the live voice core. Gears and crystals are drawn in code; nothing is taken from the show.

**The Yaver gear.** On the phone the tab bar floats above the bottom edge with a brass gear in the middle, a hextech crystal glowing in its hub; it turns with the drive shaft. Tapping it opens the chat, which irises open from the gear. You close the chat by swiping it down; it follows your finger and closes past a third of the way or on a quick flick. On the laptop a sidebar holds the sections with their key numbers (1 to 7, comma for Settings), a study subdial, today's Çetele marks and Ask Yaver; the chat opens as a panel on the right.

**Lessons.** The course and lessons use the same plates. A lesson is one dark reading plate set for long reading (larger text, generous line height, amber-ruled notes, dark code blocks); the lesson timer is a chronograph stopwatch: the lesson's steps are segments around the dial, elapsed time fills them with amber, and a hand sweeps the seconds.

**Sounds and music (v28).** Every interface sound is a small mechanism made for Yaver by modal synthesis (`tools/mech_sfx.py`): each sound is a few physical events, such as a spring-steel detent snapping into its notch or a pawl striking ratchet teeth, that excite banks of resonators tuned like spring steel, brass, a bakelite switch body and the instrument case, then a small room. Buttons click a detent, entering a screen turns a rotary selector one position, switches throw a toggle lever, saving presses a stamp, the chat opens and closes a latch, mastering a lesson indexes a counter wheel and strikes a small clock bell, and focus time ends with two bell strikes. `js/sound.js` plays them at a slightly different pitch each time and softer when they come quickly. The music (`sounds/academy.mp3`, `tools/academy.py`, v29) is "Academy", a hopeful A-minor piece for a clockwork academy of inventors: a piano ostinato that runs like a mechanism, an escapement tick and soft heartbeat pulse, cello and double bass, French horn swells, a solo violin melody, flute and harp answers and a high hextech shimmer, rendered from recorded instrument samples (the MIT-licensed tonejs-instruments packages) in a hall; it lasts about 90 seconds and loops seamlessly, gets quieter while the chat or focus mode is open, and stops during voice chat and while Yaver is in the background. On the iPhone the audio session is "ambient", so the silent switch mutes Yaver and music from other apps keeps playing. Settings → Sound and music has a switch for each.

**Focus mode (v27).** `js/focus.js` turns the screen into a quiet study space. Starting a block on the Study tab opens it: a dark, empty screen with only the subject and a small stopwatch chip. In a lesson, the Focus button (also on Home's next-lesson plate) keeps only the lesson itself. Tap the chip to fade it to a faint dot. The tab bar and the Yaver button hide, the screen stays awake, the laptop goes full screen, the music steps back, and a soft bell rings when the planned time is up. Press Esc or × to leave.

**Review fixes (v27).** Larger, brighter small text and labels; buttons never break mid-word; a real cog for Settings; Home shows each thing once (the Today list skips what the cards above already show and folds after three items); Study drops the second week strip and the empty roadmap card while the course runs; the course week shows light, readable day cards; lessons on the phone have a slim timer bar at the top; meals typed in lowercase land under the right meal; the chat closes when you change screens on the phone. Settings is a list of groups (Assistant, Claude on your Mac, Voice, Sound and music, You and goals, Sync, Your data, Install, Handbook) that save each change as you make it.

**A workshop in every lesson.** `js/sims.js` reads each lesson's track and title and chooses one of 13 simulators and a setting (for example a robotics lesson on transistors gets the circuit bench with a motor and flyback diode; a lesson on Dijkstra gets the graph explorer). Python lessons with an example get the code tracer, which runs the example on the phone with Pyodide (Python compiled to WebAssembly, downloaded on the first tap) and steps through it line by line with the variables and output. Simulators are loaded only when a lesson opens, draw on a canvas, and pause when scrolled offscreen. Most have a timeline: play, step back and forward, scrub, and change speed; the in-between moments are eased so movement stays smooth.

## 9d. Skill levels: the player card (v33)

A footballer-style attribute card for Mustafa's progress (Skills tab, key 8, and a card on Home). `js/skills.js` turns everything already recorded into experience points (XP) in six areas, placed so related ones sit side by side around a hexagon: Python; Algorithms & math; C++ & tools; Robotics & AI; Discipline; Çetele & reading.

- **Where XP comes from.** A mastered lesson 60 + 40 × exit score (one to redo 30), to its track's area; a weekly test up to 150 per subject; a solved problem 25 (Algorithms); a reviewed card 2, study time 1 per 4 minutes, a task 10, a milestone 30 and a day with every Çetele minimum met 40 (Discipline); Çetele counts 50 per daily target met (150 weekly), capped at 120 a day so a long list of counts can't outgrow the lessons.
- **Rating and level.** Each area rates 1–99 on a square-root curve (`1 + 98·√(xp/(xp+k))`), so the first lessons show clearly and the top takes about a year. Levels need 100, 300, 600, 1,000 … XP. The overall rating is the average; the page title is the level of the average area.
- **Built to motivate (the research applied).** Radar charts read best with 5–8 axes on one scale and a baseline to compare against, so the shape from four weeks ago is drawn underneath as a dashed outline. XP only grows, so levels never drop (loss of earned progress hurts more than gains help); a quiet week shows only as form, an arrow comparing this week with last. Bars show the distance to the next level (people speed up as a goal gets close). Streaks show the current run and the best; after a missed day the copy says levels stay and today is a fresh start.

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
- **What syncs:** all your records (çetele, money, meetings, study, diet, tasks, course progress, cards, tests, prepared weeks) and shared settings. **What never syncs:** API keys, the sync token and passphrase, which AI you use, voice settings, and the chat history. They also never go into backups or to the AI.
- **Counters** (water glasses, problems solved, card reviews) are kept per device and added up, so two devices tapping "+1" at the same time both count.
- **When it runs:** 10 seconds after a change, when you come back to the app, when you come back online, and from *Sync now*. A small dot shows the state (green synced, blue syncing, grey offline, red problem).
- **Safety nets:** before the first sync on a device that already has data, Yaver keeps a local backup (the last 3). A device with no data never uploads over a synced copy that has data without asking. If the other device pushed in the same moment, Yaver pulls again and retries.
- Code: `js/crypto.js` (encryption), `js/sync.js` (GitHub calls and the pull → merge → push loop), `db.merge()` in `js/db.js`.

**Setting it up** (steps also in Settings → Sync): create a GitHub **fine-grained personal access token** with only *Account permissions → Gists: Read and write*; choose a passphrase of a few words; paste both on the first device, then on the second. The first creates the gist; the second finds it by its description and pulls.

## 9e. Yaver Studio: a 3D editor you shape with your hands

`studio/` is a separate page (open `/studio/` on the site) where you build 3D objects with hand gestures in front of the laptop camera. The camera image is never shown: only the 3D scene and a faint outline of your hands. Pinch an object to grab and move it. Depth works like reaching into the scene: push your hand toward the camera and the object moves away, pull back and it comes toward you. Pinch an object with both hands to scale and rotate it, pinch empty space to orbit the view (both hands to zoom), hold a peace sign to add a shape, and delete by dragging an object into the bin in the bottom-left corner (or holding a fist over it). Each hand shows only as a pointer inside the scene, at the depth you are reaching to, so it passes in front of and behind objects, with a ring on the floor under it (`studio/src/hand3d.js`); the help panel shows each gesture as a hand icon and can be collapsed with H, and the middle of the camera frame is stretched to the whole screen so the corners are easy to reach. Mouse and keyboard work too.

Hand tracking is Google's MediaPipe hand landmarker, which finds 21 points per hand in each camera frame; `studio/src/gestures.js` turns those points into a gesture, and `studio/src/editor.js` holds the editor commands that gestures, the mouse and (later) Yaver's voice call. Three.js draws the scene. Both libraries load from the jsDelivr CDN, so the Studio needs a connection and is not part of the app's offline cache. After changing the Studio, bump the `?v=` number in `studio/index.html` and on the imports at the top of `studio/src/main.js`: browsers then fetch the new files right away instead of a copy kept for up to 10 minutes, and the new number shows next to the title.
