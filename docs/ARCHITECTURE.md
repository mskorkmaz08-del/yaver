# How Yaver works

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
  files     │    │  HTML/CSS/JS │                  │ (your data, only │   │
  only)     │    └──────┬───────┘                  │  on this phone)  │   │
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

All your expenses, meetings, study sessions, meals, tasks, settings and chat history live in **IndexedDB**, a small database built into Safari, stored on the phone itself.

- It survives closing the app and restarting the phone.
- Yaver asks iOS to keep it "persistent" so it isn't cleared to free space.
- **Deleting the Home Screen icon deletes the data**, so use *Settings → Export backup* now and then. The backup is one JSON file you can save to Files/iCloud and import later.

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
