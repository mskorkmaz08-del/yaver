// Hand-written parts of the handbook. Everything that can be read from the code
// (tools, stores, settings, offline files, course numbers, file sizes, changelog)
// is read live by handbook.js; this file holds what code can't say: what each
// file is for and how the pieces fit. tests/docs-coverage.mjs fails if a file in
// the repo has no entry in FILES, so the handbook can't silently fall behind.

export const FILES = {
  'index.html': 'App shell: the empty screen area, the tab bar and the Y button. Loads js/app.js.',
  'manifest.webmanifest': 'Makes the site installable: name, icons, colours, full-screen portrait.',
  'sw.js': 'Service worker: caches every app file on first launch, then network-first with a 3 s timeout and cache fallback. VERSION names the cache.',
  'css/app.css': 'All app styling: tokens (near-black, one lime accent, mono numbers), cards, sheets, chat, course screens, laptop layout.',
  'js/app.js': 'Entry point: opens the database, sorts AI keys, starts the assistant, routes between screens, redraws on data change, first-run sheet.',
  'js/db.js': 'IndexedDB wrapper. Loads every store into memory at start; writes go to memory and disk together, stamped with updatedAt and deviceId; deletes leave tombstones for sync.',
  'js/data.js': 'Business logic for money, meetings, study, roadmap, diet and tasks. Screens and AI tools both call these functions, so numbers always match.',
  'js/util.js': 'Dates, money formatting, HTML escaping, bottom-sheet forms, toasts, haptics, photo shrinking, Markdown.',
  'js/ui.js': 'Small SVG drawing helpers: progress rings, bar lists, columns, empty states.',
  'js/forms.js': 'Add/edit sheets for expenses, meetings, study sessions, meals and tasks.',
  'js/ics.js': 'Builds .ics calendar files (with alarms) and hands them to iOS Calendar.',
  'js/icons.js': 'Line icon set as inline SVG.',
  'js/reminders.js': 'Plain, computed reminders for Home and the AI: study left today, streak risk, pace, next topic, meetings soon, overdue tasks, budget pace.',
  'js/places.js': 'OpenStreetMap search (Nominatim) and nearby places (Overpass), distances, Apple Maps directions links.',
  'js/course.js': 'Course engine: loads course data, calendar maths (weeks, slots), lesson progress, pace, teaching deadlines, spaced-repetition cards, mixed practice, weekly tests.',
  'js/keys.js': 'Keyboard shortcuts for laptop use (g t, g c, /, ?), plus the shortcuts sheet.',
  'js/sync.js': 'Laptop ⇄ iPhone sync through one secret GitHub Gist: pull, merge record by record (newest updatedAt wins), push. Encrypted before upload.',
  'js/crypto.js': 'AES-GCM 256 encryption with a PBKDF2-SHA-256 key from the sync passphrase; gzip before encrypting; fresh IV per upload.',
  'js/ai/assistant.js': 'Chat sheet: messages, photos, voice in/out. Picks the route per message (Mac first when reachable, else Gemini or Claude) and keeps one history per route.',
  'js/ai/tools.js': 'Every tool the AI can call: name, description, JSON schema and the function that runs it on the phone.',
  'js/ai/claude.js': 'Anthropic API client (official SDK): system prompt, agent loop with streaming, web search, prompt caching, fallbacks, error messages.',
  'js/ai/gemini.js': 'Google Gemini client over REST: same agent loop, tools translated to function declarations, auto-picks a stable free Flash model.',
  'js/ai/mac.js': 'Client for the bridge on the Mac: health check (cached 30 s) and an agent loop where the Mac thinks and the phone runs the tools.',
  'js/ai/provider.js': 'Chooses Gemini or Claude, sorts keys into the right slot by prefix, saves and tests keys.',
  'js/views/home.js': 'Home: AI setup card, Ask bar, reminders, quick actions, study week, tiles, next meetings, to-dos, water.',
  'js/views/study.js': 'Study: streak and week stats, roadmap plan, practice counters, focus timer, heatmap, subjects, sessions; the course Today card.',
  'js/views/course.js': 'Course overview: phases, tracks, progress per lane, deadlines, tests, settings.',
  'js/views/lesson.js': 'Lesson runner: step-by-step lesson with timer, hints, solutions, tutor, review cards and grading.',
  'js/views/calendar.js': 'Meetings: week strip, day agenda, free slots, send to iPhone Calendar.',
  'js/views/money.js': 'Money: month total, budget pace, categories, recent expenses.',
  'js/views/diet.js': 'Diet: calories and macro rings, meals by type, water.',
  'js/views/map.js': 'Map: Leaflet map, search, category chips, results with distance, locate button.',
  'js/views/settings.js': 'Settings: AI (Gemini, Claude, Mac bridge), you, goals, sync, data export/import/erase, install help.',
  'bridge/yaver-bridge.mjs': 'Runs on the Mac. Small HTTP server (token-protected) that runs `claude -p` with no built-in tools and structured JSON output, under the Claude subscription.',
  'bridge/README.md': 'Setup guide for the Mac bridge and Tailscale.',
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
  'tests/course-smoke.mjs': 'Course screens on phone and 1440×900 laptop with a faked clock.',
  'tests/sync-test.mjs': 'Sync between three simulated devices against a mocked GitHub.',
  'tests/validate-course.mjs': 'Validates every course week file (schema, sequence, links).',
  'tests/run-lesson-code.mjs': 'Runs the code blocks inside lessons to prove they work.',
  'tests/docs-coverage.mjs': 'Fails if any repo file lacks a handbook description, or the handbook is missing a required section.',
  'handbook/index.html': 'This handbook page.',
  'handbook/handbook.css': 'Handbook styling, same design language as the app.',
  'handbook/handbook.js': 'Handbook logic: live reads from the code and GitHub, the 3D system map, animated diagrams.',
  'handbook/content.js': 'Hand-written handbook text and the file descriptions (this file).',
  'CLAUDE.md': 'Working rules for anyone (human or AI) changing the repo, including keeping this handbook current.',
  '.gitignore': 'Files git ignores.',
  '.nojekyll': 'Tells GitHub Pages to serve files as they are (no Jekyll processing).',
};

// Folders described as a whole instead of file by file.
export const FOLDERS = {
  'data/course/weeks/': 'One JSON file per course week: lessons with objectives, resources, steps, questions and review cards.',
  'vendor/': 'Third-party code shipped with the app: the Anthropic SDK bundled with esbuild, and Leaflet for the map.',
  'icons/': 'Home Screen and app icons.',
};

// Layers of the 3D system map, bottom to top. `mods` are file paths.
export const LAYERS = [
  { id: 'store', name: 'Storage', tag: 'IndexedDB · in-memory copy', color: '#4fd1c5',
    text: 'Every record lives in IndexedDB on the device. At start it is loaded into memory so screens read instantly; each write updates memory and disk together and fires a change event.',
    mods: ['js/db.js', 'sw.js'] },
  { id: 'logic', name: 'Logic', tag: 'single source of truth', color: '#5aa9ff',
    text: 'Pure functions over the data: budgets, streaks, free slots, course pace, spaced repetition, reminders. Screens and AI tools both call these, so a number means the same thing everywhere.',
    mods: ['js/data.js', 'js/course.js', 'js/reminders.js', 'js/places.js', 'js/sync.js', 'js/crypto.js'] },
  { id: 'ai', name: 'AI agent', tag: 'tools · routing · providers', color: '#b8f34a',
    text: 'The chat runs an agent loop: send the conversation and tool list to a model, run the tool calls it asks for on the phone, send results back, repeat until it answers in text.',
    mods: ['js/ai/assistant.js', 'js/ai/tools.js', 'js/ai/mac.js', 'js/ai/gemini.js', 'js/ai/claude.js', 'js/ai/provider.js'] },
  { id: 'ui', name: 'Screens', tag: 'views · router', color: '#ffb547',
    text: 'One file per screen, each with a render function that draws from memory. app.js routes between them and redraws the current one whenever data changes.',
    mods: ['js/app.js', 'js/views/home.js', 'js/views/study.js', 'js/views/course.js', 'js/views/lesson.js', 'js/views/money.js', 'js/views/calendar.js', 'js/views/diet.js', 'js/views/map.js', 'js/views/settings.js'] },
];

// Services outside the device, placed around the 3D map.
export const SERVICES = [
  { id: 'pages', name: 'GitHub Pages', role: 'Serves the app files. Never sees your data.', proto: 'HTTPS GET, static files', layer: 'store' },
  { id: 'gemini', name: 'Google Gemini', role: 'Free AI. Called with your key from the phone.', proto: 'REST streamGenerateContent (SSE)', layer: 'ai' },
  { id: 'anthropic', name: 'Anthropic API', role: 'Paid Claude with web search and caching.', proto: 'Messages API via official SDK (SSE)', layer: 'ai' },
  { id: 'mac', name: 'Mac bridge', role: 'Claude Code on your Mac, under your subscription, over Tailscale.', proto: 'HTTPS JSON /health, /chat', layer: 'ai' },
  { id: 'gist', name: 'GitHub Gist', role: 'Encrypted sync blob shared by your devices.', proto: 'GitHub REST, AES-GCM ciphertext', layer: 'logic' },
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
  kv: 'settings: one row per key (name, currency, goals, keys, course, plan…)',
  courseProgress: 'lessonId, status, startedAt, minutes, score, mastered, attempts, hints',
  cards: 'lessonId, track, front, back, box, due, lapses, history',
  courseLessons: 'AI-generated lessons for weeks without a bundled file',
  courseTests: 'week, date, scores',
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
  ['Map', 'Leaflet 1.9.4 + OpenStreetMap, Nominatim, Overpass'],
  ['Sync', 'GitHub Gist, AES-GCM 256 + PBKDF2-SHA-256 (WebCrypto)'],
  ['Remote access to Mac', 'Tailscale (WireGuard) with tailscale serve HTTPS'],
  ['Tests', 'Playwright on Chromium (iPhone 13 and 1440×900), mocked network'],
];

export const BROWSER_APIS = [
  ['IndexedDB', 'all data'], ['Service Worker + Cache Storage', 'offline'], ['Fetch + ReadableStream', 'streaming AI replies (SSE)'],
  ['Web Crypto (subtle)', 'sync encryption'], ['CompressionStream', 'gzip before encryption'], ['Geolocation', 'nearby places'],
  ['Web Speech (recognition, synthesis)', 'voice in, read aloud'], ['Web Share', 'backups and .ics files'], ['Vibration', 'haptics'],
  ['StorageManager.persist()', 'ask iOS not to evict data'],
];

export const SECURITY = [
  'No Yaver server: the phone talks directly to each AI with your own key.',
  'API keys, the bridge token and sync secrets are device-only settings: never synced, never exported in backups.',
  'Sync data is encrypted on the device (AES-GCM 256, PBKDF2-SHA-256 with 310,000 iterations); GitHub only stores ciphertext.',
  'The Mac bridge listens on 127.0.0.1 (or only the Mac\'s private Tailscale address when the App Store Tailscale needs it), requires a random token, allows CORS only from the Yaver origin, and runs Claude Code with all built-in tools disabled.',
  'Tailscale gives the phone an encrypted, private route to the Mac; nothing is exposed to the public internet.',
  'Risk to know: anyone with your unlocked phone can read stored keys, like any saved password. Use spend limits for paid APIs.',
];

export const RECIPES = [
  ['Add an AI tool', 'Add an entry to TOOLS in js/ai/tools.js (name, description, input_schema, run). If it writes data, add it to WRITE_TOOLS and describeAction. It appears in this handbook automatically.'],
  ['Add a store', 'Add it to STORES in js/db.js and bump DB_VERSION. Describe its fields in STORE_FIELDS in handbook/content.js.'],
  ['Add a screen', 'Create js/views/name.js with render(root, go), register it in VIEWS in js/app.js, add it to FILES in sw.js, and describe it in handbook/content.js.'],
  ['Change Yaver\'s tone', 'Edit STATIC_SYSTEM in js/ai/claude.js (Gemini and the Mac use the same prompt).'],
  ['Publish a change', 'Bump VERSION in sw.js, update the handbook, run the tests, push to main. GitHub Pages deploys in about a minute.'],
];

export const TESTS = [
  ['tests/smoke.mjs', 'Whole app on an iPhone-size browser with mocked AI'],
  ['tests/course-smoke.mjs', 'Course screens, phone and laptop'],
  ['tests/sync-test.mjs', 'Three-device sync with mocked GitHub'],
  ['tests/mac-bridge.mjs', 'Mac-first routing and fallback'],
  ['tests/validate-course.mjs', 'Course data validation'],
  ['tests/run-lesson-code.mjs', 'Runs lesson code blocks'],
  ['tests/docs-coverage.mjs', 'Handbook covers every file'],
];

// Sections the coverage test requires to exist in index.html.
export const REQUIRED_SECTIONS = ['map', 'flow', 'modules', 'data', 'ai', 'course', 'offline', 'sync', 'specs', 'ship', 'changes'];
