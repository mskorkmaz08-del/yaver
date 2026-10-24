// Hand-written parts of the handbook. Everything that can be read from the code
// (tools, stores, settings, offline files, course numbers, file sizes, changelog)
// is read live by handbook.js; this file holds what code can't say: what each
// file is for and how the pieces fit. tests/docs-coverage.mjs fails if a file in
// the repo has no entry in FILES, so the handbook can't silently fall behind.

export const FILES = {
  'index.html': 'App shell: the empty screen area, the tab bar and the Yaver button (a knurled watch crown). Loads js/app.js.',
  'manifest.webmanifest': 'Makes the site installable: name, icons, colours, full-screen portrait.',
  'sw.js': 'Service worker: caches every app file on first launch, then network-first with a 3 s timeout and cache fallback. VERSION names the cache.',
  'css/app.css': 'All app styling. Hextech look (v25, refined in v26, inspired by the mood of Piltover workshops in the show Arcane): warm graphite and brass, Cormorant Garamond text with Cinzel small capitals, one teal gemstone glow, the gear Yaver button, a hextech engine of real meshing gears on Home, small gear pairs under each screen title, the course and lessons on clean plain paper (soft light and a faint grain, Caveat handwriting for labels), the lesson timer as a brass stopwatch, the workshop simulator frame and its brass controls, the chat that irises open from the gear and follows your finger when swiped down, and mechanical motion (screens rise with a latch overshoot, cards below the fold rise as they scroll in; all off under Reduce Motion). Also cards, sheets, chat, course screens, laptop layout.',
  'js/app.js': 'Entry point: opens the database, sorts AI keys, starts the assistant, routes between screens, redraws on data change (keeping running engines in place), adds the gear pairs under screen titles, turns the mechanisms when you enter a screen or data changes, reveals cards as they scroll in, fills the laptop sidebar gauge, first-run sheet.',
  'js/db.js': 'IndexedDB wrapper. Loads every store into memory at start; writes go to memory and disk together, stamped with updatedAt and deviceId; deletes leave tombstones for sync.',
  'js/cetele.js': 'Çetele logic: default items, daily and weekly progress, streak (a day counts when every daily minimum is met), item matching for the AI tools.',
  'js/data.js': 'Business logic for money, meetings, study, roadmap, diet and tasks (plus the çetele summary in the overview). Screens and AI tools both call these functions, so numbers always match.',
  'js/util.js': 'Dates, money formatting, HTML escaping, bottom-sheet forms, toasts, haptics, photo shrinking, Markdown.',
  'js/ui.js': 'Small SVG drawing helpers: progress rings, bar lists, columns, empty states, roman numerals, the lesson step strip, the enamel study subdial and the brass lesson stopwatch (steps as segments round the dial, elapsed time in teal, a sweeping hand).',
  'js/sound.js': 'Sounds, synthesized with Web Audio (no audio files): a soft click for buttons, a latch on entering a screen, a ratchet and hum when the engine is tapped, a breath and rising tone when the chat opens (falling when it closes), a small chime on saving and a three-note one on finishing a lesson, a faint tick when scrubbing a simulator. Quiet, low-passed, slightly varied each time, and softer when they come quickly. Ambient audio session on iPhone, so the silent switch mutes it and music keeps playing. Off switch in Settings.',
  'js/mech.js': 'Mechanisms: draws real meshing gears as SVG (correct tooth counts and phase so teeth interlock), the hextech engine (planetary gear train, pistons on crank-sliders, gimbal rings, energy arcs and a hextech crystal: a tall faceted blue gem in brass claws with a breathing light inside), the gear Yaver button and small gear pairs. One drive shaft angle turns them all: it idles slowly, scrolling, taps and saves add speed, and it pauses offscreen.',
  'js/sims.js': 'The workshop: picks a simulator and setting for each lesson from its track and title (every lesson gets one), loads it on demand, and gives it a kit: a blueprint canvas at the screen\'s pixel ratio, brass controls, an animation loop that pauses offscreen, and a timeline with play, step and a scrubber that eases between precomputed states.',
  'js/sims/circuit.js': 'Circuit bench: Ohm\'s law, series, parallel, divider, LED (burns out over its current), RC charging, transistor switching a motor with a flyback diode, power ratings, and an Arduino board running blink, button or potentiometer code. Charge dots flow at the current\'s speed past brass meters.',
  'js/sims/sort.js': 'Sorting engine: selection, insertion, quick and merge sort with bars that glide to their new places, comparison and swap counters.',
  'js/sims/search.js': 'Search rig: binary search, two pointers and a sliding window with pointers that glide over the array.',
  'js/sims/graph.js': 'Graph explorer: breadth-first and depth-first search on a graph you can drag, Dijkstra settling distances, and a binary search tree growing and walked in order.',
  'js/sims/structures.js': 'Data structures you operate by hand: stack, queue, linked list, hash table with chaining, min-heap with sift up and down, and the call stack of recursive functions.',
  'js/sims/vectors.js': 'Vector loom: span, matrices as transformations (drag î and ĵ), determinant as area, eigenvectors that stay on their line, dot product and projection, change of basis, and 3D rotation with the cross product.',
  'js/sims/calculus.js': 'Slope machine: a secant shrinking into the tangent, the derivative drawn as you sweep along a curve (including the chain rule), and gradient descent on a curve, a bowl and a line fit, with a learning rate slider.',
  'js/sims/probability.js': 'Probability mill: dice sums settling onto the expected shape, sample means forming a bell curve (central limit theorem), bootstrap resampling with a 95% interval, and a Bayes grid for a positive test.',
  'js/sims/data.js': 'Table press: rows of a small study table slide, fade, regroup and fold through WHERE / ORDER BY / LIMIT, group-by, a join, cleaning messy data, and turning a table into an honest chart. Shows the SQL or pandas line for each move.',
  'js/sims/trace.js': 'Code tracer: runs the lesson\'s Python example on the phone with Pyodide (downloaded on the first tap) and records every line with its variables and printed output, then steps through the run. The code can be edited and traced again.',
  'js/sims/memory.js': 'Memory map for C++: stack and heap boxes with pointer arrows, references, delete and dangling pointers, unique_ptr freeing itself, and a vector doubling its capacity.',
  'js/sims/git.js': 'Branch loom: commit, branch, switch and merge with buttons and watch the commit graph grow, including fast-forwards and merge commits.',
  'js/sims/shell.js': 'Shell workshop: a folder tree with a you-are-here marker that moves as cd, ls, mkdir and touch run, and lines flowing through cat | grep | sort | uniq -c.',
  'js/forms.js': 'Add/edit sheets for expenses, meetings, study sessions, meals and tasks.',
  'js/ics.js': 'Builds .ics calendar files (with alarms) and hands them to iOS Calendar.',
  'js/icons.js': 'Line icon set as inline SVG.',
  'js/reminders.js': 'Plain, computed reminders for Home and the AI: study left today, streak risk, pace, next topic, meetings soon, overdue tasks, budget pace.',
  'js/places.js': 'OpenStreetMap search (Nominatim) and nearby places (Overpass), distances, Apple Maps directions links.',
  'js/course.js': 'Course engine: loads course data, calendar maths (weeks, slots), lesson progress, pace, teaching deadlines, spaced-repetition cards, mixed practice, weekly tests.',
  'js/keys.js': 'Keyboard shortcuts for laptop use (g t, g c, /, ?), plus the shortcuts sheet.',
  'js/sync.js': 'Laptop ⇄ iPhone sync through one secret GitHub Gist: pull, merge record by record (newest updatedAt wins), push. Encrypted before upload.',
  'js/crypto.js': 'AES-GCM 256 encryption with a PBKDF2-SHA-256 key from the sync passphrase; gzip before encrypting; fresh IV per upload.',
  'js/ai/assistant.js': 'Chat sheet: on the phone it irises open from the gear button and closes with a swipe down (it follows your finger). Messages, photos, voice in/out and hands-free voice chat (listen → answer read aloud → listen again). Picks the route per message (Mac first when reachable, else Gemini or Claude) and keeps one history per route.',
  'js/ai/tools.js': 'Every tool the AI can call: name, description, JSON schema and the function that runs it on the phone.',
  'js/ai/claude.js': 'Anthropic API client (official SDK): system prompt, agent loop with streaming, web search, prompt caching, fallbacks, error messages.',
  'js/ai/gemini.js': 'Google Gemini client over REST: same agent loop, tools translated to function declarations, auto-picks a stable free Flash model.',
  'js/ai/live.js': 'Live voice chat (mic, model choice and connection start together; speech before the session is ready is buffered; quick end-of-turn detection; ends after 90 s of quiet; resumable sessions with context compression; if no answer starts 7 s after you stop talking, or the connection drops, it reconnects with the resumption handle and asks again; ask_claude tool sends hard questions to Claude on the Mac): streams the mic (16 kHz PCM from an AudioWorklet) to the Gemini Live API over a WebSocket and plays its 24 kHz voice back, with barge-in, transcripts into the chat, and Yaver\'s tools.',
  'js/ai/wake.js': 'Wake word: while the app is on screen, phone speech recognition listens in short rounds for "Yaver" and starts voice chat; pauses in the background and during voice chat.',
  'js/ai/voice.js': 'Reply voice. Default: the iPhone\'s own voice (instant, offline), preferring a British male Premium/Enhanced voice for the Jarvis feel. Optional: Gemini text-to-speech (free tier, same key), voiced sentence by sentence while the reply streams, with leading silence and the static burst after the last word cut out; picks a TTS model the key can use, plays the 24 kHz PCM through Web Audio (optional Jarvis style: British delivery prompt plus a light filter and short echo), and falls back to the iPhone voice for 10 minutes when it fails.',
  'js/ai/mac.js': 'Client for the bridge on the Mac: connection code, health check (cached 30 s), finding the new link after a restart via ntfy, and an agent loop where the Mac thinks and the phone runs the tools.',
  'js/ai/provider.js': 'Chooses Gemini or Claude, sorts keys into the right slot by prefix, saves and tests keys.',
  'js/views/home.js': 'Home: YAVER line with the date, the next course block as a printed lecture card with its steps, the hextech engine (tap it to spin it up) with Çetele and study readouts, cards due / next meeting / spent today, AI setup card, Ask bar, reminders, quick actions, study week, tiles, next meetings, to-dos, water.',
  'js/views/study.js': 'Study: streak and week stats, roadmap plan, practice counters, focus timer, heatmap, subjects, sessions; the course Today card.',
  'js/views/course.js': 'Course overview: phases, tracks, progress per lane, deadlines, tests, settings.',
  'js/views/lesson.js': 'Lesson runner: step-by-step lesson on one notebook page with a roman-numeral step strip that jumps to each step, the lesson\'s workshop simulator (kept running across redraws), a stopwatch timer, hints, solutions, tutor, review cards and grading. Recall shows only questions from finished lessons; every question has "don\'t know yet"; optional LeetCode problems with solved/stuck and a tutor walk-through.',
  'js/views/calendar.js': 'Meetings: week strip, day agenda, free slots, send to iPhone Calendar.',
  'js/views/money.js': 'Money: month total, budget pace, categories, recent expenses.',
  'js/views/cetele.js': 'Çetele: daily spiritual minimums with +/− counters and done checks, day switcher, streak, and the edit-list sheet.',
  'js/views/diet.js': 'Diet: calories and macro rings, meals by type, water.',
  'js/views/map.js': 'Map: Leaflet map, search, category chips, results with distance, locate button.',
  'js/views/settings.js': 'Settings: AI (Gemini, Claude, Mac bridge), voice, sounds on/off, you, goals, sync, data export/import/erase, install help.',
  'bridge/yaver-bridge.mjs': 'Runs on the Mac. Small HTTP server (token-protected) that runs `claude -p` with no built-in tools and structured JSON output, under the Claude subscription. Starts a Cloudflare quick tunnel, prints the connection code and posts each new link to ntfy.',
  'bridge/README.md': 'Setup guide for the Mac bridge: one install, one command, one pasted code.',
  'data/ml-roadmap.json': 'Bundled copy of the 52-week ML engineer roadmap (phases, topics, projects, checkpoints).',
  'data/course/course.json': 'Course metadata: start date, sleep window, thresholds, card intervals, tracks, lanes, phases, weeks.',
  'data/course/urls.json': 'Verified resource links used by lessons.',
  'docs/ARCHITECTURE.md': 'Plain-language architecture guide (the text version of this handbook).',
  'docs/architecture-audio-script.md': 'Script of the audio architecture walkthrough.',
  'docs/course-guide.md': 'How to use the course feature and set up sync.',
  'prompts/COURSE_PROMPT.md': 'The specification the course feature was built from.',
  'README.md': 'Repo front page: what Yaver is, install, test.',
  'tests/smoke.mjs': 'Playwright end-to-end test: onboarding, every screen, map, timer, Gemini and Claude agent loops (mocked), key sorting.',
  'tests/mac-bridge.mjs': 'Mac-first routing and Gemini fallback against the real bridge with a fake Claude Code.',
  'tests/voice-chat.mjs': 'Voice chat loop with fake speech recognition and synthesis: hears the request, reads the reply aloud without markdown, listens again; natural Gemini voice with mocked audio.',
  'tests/live-voice.mjs': 'Live voice with a fake microphone and a fake Live WebSocket: setup, audio streaming, a tool call, playback and transcripts.',
  'tests/live-recovery.mjs': 'Live voice recovery: a silent session reconnects with its resumption handle and repeats the question; ask_claude reaches a fake Mac bridge.',
  'tests/cetele.mjs': 'Çetele screen, streak, weekly fasting, Home card, reminder and the log_cetele AI tool.',
  'tests/mac-connect.mjs': 'Connection code paste and auto-reconnect after the bridge link changes, with fake cloudflared and ntfy.',
  'tests/course-smoke.mjs': 'Course screens on phone and 1440×900 laptop with a faked clock.',
  'tests/no-guess.mjs': 'Lessons never ask for a guess: recall only from finished lessons, first example shows its result, "don\'t know yet" everywhere, optional LeetCode problems.',
  'tests/sync-test.mjs': 'Sync between three simulated devices against a mocked GitHub.',
  'tests/validate-course.mjs': 'Validates every course week file (schema, sequence, links).',
  'tests/run-lesson-code.mjs': 'Runs the code blocks inside lessons to prove they work.',
  'tests/docs-coverage.mjs': 'Fails if any repo file lacks a handbook description, or the handbook is missing a required section.',
  'handbook/index.html': 'This handbook page.',
  'handbook/handbook.css': 'Handbook styling (keeps the earlier dark developer look).',
  'handbook/handbook.js': 'Handbook logic: live reads from the code and GitHub, the 3D system map, animated diagrams.',
  'handbook/content.js': 'Hand-written handbook text and the file descriptions (this file).',
  'CLAUDE.md': 'Working rules for anyone (human or AI) changing the repo, including keeping this handbook current.',
  '.gitignore': 'Files git ignores.',
  '.nojekyll': 'Tells GitHub Pages to serve files as they are (no Jekyll processing).',
};

// Folders described as a whole instead of file by file.
export const FOLDERS = {
  'data/course/weeks/': 'One JSON file per course week: lessons with objectives, resources, steps (recall questions name the earlier lesson that taught them), questions, review cards and optional LeetCode problems.',
  'vendor/': 'Third-party code shipped with the app: the Anthropic SDK bundled with esbuild, and Leaflet for the map.',
  'icons/': 'Home Screen and app icons: the brass Yaver gear with its teal gemstone (v25).',
  'fonts/': 'Self-hosted fonts (Cormorant Garamond, Cinzel, and Caveat for the notebook handwriting; SIL Open Font License), cached by the service worker so they work offline.',
};

// Layers of the 3D system map, bottom to top. `mods` are file paths.
export const LAYERS = [
  { id: 'store', name: 'Storage', tag: 'IndexedDB · in-memory copy', color: '#4fd1c5',
    text: 'Every record lives in IndexedDB on the device. At start it is loaded into memory so screens read instantly; each write updates memory and disk together and fires a change event.',
    mods: ['js/db.js', 'sw.js'] },
  { id: 'logic', name: 'Logic', tag: 'single source of truth', color: '#5aa9ff',
    text: 'Pure functions over the data: budgets, streaks, free slots, course pace, spaced repetition, reminders. Screens and AI tools both call these, so a number means the same thing everywhere.',
    mods: ['js/data.js', 'js/cetele.js', 'js/course.js', 'js/reminders.js', 'js/places.js', 'js/sync.js', 'js/crypto.js'] },
  { id: 'ai', name: 'AI agent', tag: 'tools · routing · providers', color: '#b8f34a',
    text: 'The chat runs an agent loop: send the conversation and tool list to a model, run the tool calls it asks for on the phone, send results back, repeat until it answers in text.',
    mods: ['js/ai/assistant.js', 'js/ai/tools.js', 'js/ai/mac.js', 'js/ai/voice.js', 'js/ai/live.js', 'js/ai/wake.js', 'js/ai/gemini.js', 'js/ai/claude.js', 'js/ai/provider.js'] },
  { id: 'ui', name: 'Screens', tag: 'views · router', color: '#ffb547',
    text: 'One file per screen, each with a render function that draws from memory. app.js routes between them and redraws the current one whenever data changes.',
    mods: ['js/app.js', 'js/mech.js', 'js/sims.js', 'js/views/home.js', 'js/views/cetele.js', 'js/views/study.js', 'js/views/course.js', 'js/views/lesson.js', 'js/views/money.js', 'js/views/calendar.js', 'js/views/diet.js', 'js/views/map.js', 'js/views/settings.js'] },
];

// Services outside the device, placed around the 3D map.
export const SERVICES = [
  { id: 'pages', name: 'GitHub Pages', role: 'Serves the app files. Never sees your data.', proto: 'HTTPS GET, static files', layer: 'store' },
  { id: 'gemini', name: 'Google Gemini', role: 'Free AI, the live voice chat (Live API over a WebSocket) and an optional reply voice. Called with your key from the phone.', proto: 'REST streamGenerateContent (SSE)', layer: 'ai' },
  { id: 'anthropic', name: 'Anthropic API', role: 'Paid Claude with web search and caching.', proto: 'Messages API via official SDK (SSE)', layer: 'ai' },
  { id: 'mac', name: 'Mac bridge', role: 'Claude Code on your Mac, under your subscription.', proto: 'HTTPS JSON /health, /chat', layer: 'ai' },
  { id: 'cloudflare', name: 'Cloudflare Tunnel', role: 'Free quick tunnel the bridge opens, giving the Mac a public HTTPS link (changes on each restart).', proto: 'cloudflared, https://*.trycloudflare.com', layer: 'ai' },
  { id: 'ntfy', name: 'ntfy.sh', role: 'Mailbox where the bridge posts its current link so the phone finds it after a restart.', proto: 'HTTPS POST/GET on a topic named by a hash of the token', layer: 'ai' },
  { id: 'gist', name: 'GitHub Gist', role: 'Encrypted sync blob shared by your devices.', proto: 'GitHub REST, AES-GCM ciphertext', layer: 'logic' },
  { id: 'pyodide', name: 'Pyodide (jsDelivr)', role: 'Python compiled to WebAssembly for the code tracer, downloaded on the first Trace tap and cached by the browser. Code runs on the phone; nothing is sent back.', proto: 'HTTPS GET, static files', layer: 'ui' },
  { id: 'osm', name: 'OpenStreetMap', role: 'Map tiles, Nominatim search, Overpass nearby.', proto: 'HTTPS GET, no key', layer: 'ui' },
];

// Record shapes per store (fields beyond id, createdAt, updatedAt, deviceId).
export const STORE_FIELDS = {
  expenses: 'amount, category, note, date',
  events: 'title, start, end (ISO), location, notes, remind (minutes)',
  subjects: 'name, color, …',
  sessions: 'subjectId, minutes, date, note',
  meals: 'name, meal, calories, protein, carbs, fat, date',
  tasks: 'title, due, done, doneAt',
  milestones: 'subjectId, title, done, order',
  chats: 'api (Claude history), gapi (Gemini), mapi (Mac), view (bubbles)',
  kv: 'settings: one row per key (name, currency, goals, keys, course, plan, leetcode solved/stuck…)',
  courseProgress: 'lessonId, status, startedAt, minutes, score, mastered, attempts, hints',
  cards: 'lessonId, track, front, back, box, due, lapses, history',
  courseLessons: 'AI-generated lessons for weeks without a bundled file',
  courseTests: 'week, date, scores',
  ceteleItems: 'name, unit, target, per (day | week), step (what + adds), order, archived',
  ceteleLog: 'id "<item>:<day>", item, day, value',
  tombstones: 'store, key, deletedAt: tells other devices a record was deleted',
};

// Steps of "follow a message". Lanes are columns of the sequence diagram.
export const LANES = ['You', 'Chat', 'Router', 'Model', 'Tools', 'Logic', 'Storage', 'Screens'];
export const FLOWS = {
  mac: { label: 'Claude on your Mac', steps: [
    [0, 1, 'You type "spent 120 on lunch"', 'assistant.js adds your message to the Mac history (chat.mapi) and shows a typing bubble.'],
    [1, 2, 'Is the Mac reachable?', 'mac.js calls GET /health with the bridge token (2.5 s timeout, remembered for 30 s).'],
    [2, 3, 'POST /chat to the bridge', 'System prompt + today\'s context + transcript + tool list go to the Mac, where the bridge runs `claude -p` with structured JSON output.'],
    [3, 4, 'tool_calls: add_expense', 'Claude answers {reply, tool_calls}. The phone, not the Mac, runs each tool.'],
    [4, 5, 'D.addExpense(120, Food)', 'tools.js validates and calls the same function the Money screen uses.'],
    [5, 6, 'db.put("expenses")', 'Written to memory and IndexedDB, stamped with updatedAt and deviceId.'],
    [6, 7, 'change event → redraw', 'The Money tab behind the chat is already updated.'],
    [4, 3, 'TOOL RESULTS', 'Results go back to the Mac in the next /chat call.'],
    [3, 1, '"Logged 120 for lunch."', 'No more tool calls, so the loop ends. Reply is labelled "claude · your mac".'],
  ] },
  gemini: { label: 'Gemini (free)', steps: [
    [0, 1, 'You type "spent 120 on lunch"', 'assistant.js adds a {role:user, parts} message to chat.gapi.'],
    [1, 2, 'Mac unreachable → Gemini', 'No bridge set up, or /health failed, so the router picks the chosen provider.'],
    [2, 3, 'streamGenerateContent (SSE)', 'Key in the x-goog-api-key header. Tools are sent as functionDeclarations.'],
    [3, 4, 'functionCall: add_expense', 'Parts are kept unchanged, including thought signatures, as Gemini requires.'],
    [4, 5, 'D.addExpense(120, Food)', 'Same function as the Money screen.'],
    [5, 6, 'db.put("expenses")', 'Memory + IndexedDB, change event fired.'],
    [6, 7, 'change event → redraw', 'Screens update immediately.'],
    [4, 3, 'functionResponse', 'Results go back as functionResponse parts.'],
    [3, 1, 'Streamed text reply', 'Words appear as they arrive. Loop capped at 10 rounds.'],
  ] },
  claude: { label: 'Claude (API key)', steps: [
    [0, 1, 'You type "spent 120 on lunch"', 'assistant.js appends {role:user, content} to chat.api (append-only).'],
    [1, 2, 'Provider = Claude', 'An sk-ant- key is saved, so the router uses the Anthropic API.'],
    [2, 3, 'messages.stream()', 'Cached system prompt + tools, adaptive thinking, web search, server-side fallback.'],
    [3, 4, 'tool_use: add_expense', 'The whole reply, thinking blocks included, is stored exactly as returned.'],
    [4, 5, 'D.addExpense(120, Food)', 'Same function as the Money screen.'],
    [5, 6, 'db.put("expenses")', 'Memory + IndexedDB, change event fired.'],
    [6, 7, 'change event → redraw', 'Screens update immediately.'],
    [4, 3, 'tool_result', 'All results go back in one user message.'],
    [3, 1, 'Streamed text reply', 'On an error the turn is rolled back so history stays valid.'],
  ] },
};

export const STACK = [
  ['App type', 'Progressive Web App (installable website), no App Store'],
  ['Language', 'Plain JavaScript ES modules, no framework, no build step'],
  ['Hosting', 'GitHub Pages (static), deploys on every push to main'],
  ['Storage', 'IndexedDB, fully mirrored in memory'],
  ['Offline', 'Service worker, network-first with cache fallback'],
  ['AI', 'Gemini REST, Anthropic SDK (bundled with esbuild), Claude Code via the Mac bridge'],
  ['Look', 'Hextech (v25): CSS tokens in css/app.css, live SVG gear mechanisms in js/mech.js, notebook-paper course, self-hosted fonts in fonts/ (Cormorant Garamond, Cinzel, Caveat)'],
  ['Simulators', '13 canvas simulators in js/sims/, loaded per lesson; Pyodide 0.27 for the Python tracer'],
  ['Map', 'Leaflet 1.9.4 + OpenStreetMap, Nominatim, Overpass'],
  ['Sync', 'GitHub Gist, AES-GCM 256 + PBKDF2-SHA-256 (WebCrypto)'],
  ['Remote access to Mac', 'Cloudflare quick tunnel (cloudflared), link rediscovered via ntfy.sh'],
  ['Tests', 'Playwright on Chromium (iPhone 13 and 1440×900), mocked network'],
];

export const BROWSER_APIS = [
  ['IndexedDB', 'all data'], ['Service Worker + Cache Storage', 'offline'], ['Fetch + ReadableStream', 'streaming AI replies (SSE)'],
  ['Web Crypto (subtle)', 'sync encryption'], ['CompressionStream', 'gzip before encryption'], ['Geolocation', 'nearby places'],
  ['Web Speech (recognition, synthesis)', 'voice in, read aloud, voice chat loop'], ['Web Audio', 'live voice (AudioWorklet mic capture, scheduled playback), Gemini reply voice'], ['getUserMedia', 'microphone for live voice'], ['WebSocket', 'Gemini Live session'], ['Web Share', 'backups and .ics files'], ['Vibration', 'haptics'], ['Canvas 2D', 'lesson simulators'], ['Web Audio', 'synthesized interface sounds'], ['Audio Session API', 'ambient sounds that respect the silent switch'], ['IntersectionObserver', 'pausing mechanisms and simulators offscreen, revealing cards'], ['WebAssembly', 'Python in the code tracer'],
  ['StorageManager.persist()', 'ask iOS not to evict data'],
];

export const SECURITY = [
  'No Yaver server: the phone talks directly to each AI with your own key.',
  'API keys, the bridge token and sync secrets are device-only settings: never synced, never exported in backups.',
  'Sync data is encrypted on the device (AES-GCM 256, PBKDF2-SHA-256 with 310,000 iterations); GitHub only stores ciphertext.',
  'The Mac bridge listens only on 127.0.0.1; the Cloudflare tunnel forwards to it. Every request needs the random 144-bit token, CORS allows only the Yaver origin, and Claude Code runs with all built-in tools disabled, so a caller can only get text and tool suggestions back.',
  'The tunnel link is public while the bridge runs; the token is what guards it. The connection code holds the token, so treat it like a password. The phone sends the token only to trycloudflare.com links (or the address you typed).',
  'The ntfy topic name is a hash of the token, and the message is only the link, never the token.',
  'The code tracer runs lesson code inside Pyodide in the page (WebAssembly), with input() and print() replaced; it has no access to your files and the run stops after 400 steps.',
  'Risk to know: anyone with your unlocked phone can read stored keys, like any saved password. Use spend limits for paid APIs.',
];

export const RECIPES = [
  ['Add an AI tool', 'Add an entry to TOOLS in js/ai/tools.js (name, description, input_schema, run). If it writes data, add it to WRITE_TOOLS and describeAction. It appears in this handbook automatically.'],
  ['Add a store', 'Add it to STORES in js/db.js and bump DB_VERSION. Describe its fields in STORE_FIELDS in handbook/content.js.'],
  ['Add a screen', 'Create js/views/name.js with render(root, go), register it in VIEWS in js/app.js, add it to FILES in sw.js, and describe it in handbook/content.js.'],
  ['Change Yaver\'s tone', 'Edit STATIC_SYSTEM in js/ai/claude.js (Gemini and the Mac use the same prompt).'],
  ['Add a simulator', 'Create js/sims/name.js exporting default (host, { mode, code, lesson, kit }); use kit.stage, kit.controls and kit.timeline. Add rules to RULES in js/sims.js, a name to SIM_NAMES, the file to FILES in sw.js, and a line here.'],
  ['Publish a change', 'Bump VERSION in sw.js, update the handbook, run the tests, push to main. GitHub Pages deploys in about a minute.'],
];

export const TESTS = [
  ['tests/smoke.mjs', 'Whole app on an iPhone-size browser with mocked AI'],
  ['tests/course-smoke.mjs', 'Course screens, phone and laptop'],
  ['tests/no-guess.mjs', 'One path, no guessing: recall, examples, LeetCode'],
  ['tests/sync-test.mjs', 'Three-device sync with mocked GitHub'],
  ['tests/mac-bridge.mjs', 'Mac-first routing and fallback'],
  ['tests/mac-connect.mjs', 'Connection code and auto-reconnect'],
  ['tests/cetele.mjs', 'Çetele page, streak and AI tool'],
  ['tests/live-voice.mjs', 'Live voice session'],
  ['tests/live-recovery.mjs', 'Live voice: stall reconnect, ask_claude'],
  ['tests/voice-chat.mjs', 'Voice chat loop'],
  ['tests/validate-course.mjs', 'Course data validation'],
  ['tests/run-lesson-code.mjs', 'Runs lesson code blocks'],
  ['tests/docs-coverage.mjs', 'Handbook covers every file'],
];

// Sections the coverage test requires to exist in index.html.
export const REQUIRED_SECTIONS = ['map', 'flow', 'modules', 'data', 'ai', 'course', 'offline', 'sync', 'specs', 'ship', 'changes'];
