#!/usr/bin/env node
// Yaver bridge: lets the Yaver app on your iPhone use Claude Code on this Mac,
// signed in to your Claude subscription. Yaver sends the conversation and its
// tool list; this runs `claude -p` with no built-in tools and returns Claude's
// reply plus any tool calls, which the phone then runs on its own data.
//
// Run:   caffeinate -i node yaver-bridge.mjs
// With cloudflared installed (brew install cloudflared), the bridge opens its
// own free HTTPS link and prints a connection code to paste into Yaver once.
// Each new link is also posted to a private ntfy.sh topic named after the
// token, so the phone finds the bridge again after a restart by itself.
//
// Yaver open in a browser on this same Mac connects by itself: it asks
// http://127.0.0.1:8787/pair, which answers only local requests from Yaver.
//
// Apple Calendar: GET /calendar hands Yaver the events from the Mac's Calendar
// (iCloud, Google and any other account added there). A tiny helper app,
// "Yaver Calendar", is built on this Mac the first time (Apple's free command
// line tools provide the compiler) and macOS asks once to allow calendar access.
// It only reads: nothing is ever changed in your calendars.
//
// Install:   node yaver-bridge.mjs --install    (starts at login and keeps running)
// Remove:    node yaver-bridge.mjs --uninstall
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, unlinkSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.YAVER_PORT || 8787);
// 127.0.0.1 by default; the secure link forwards to it. YAVER_HOST binds
// elsewhere (for example a Tailscale address) and turns the link off.
const HOST = process.env.YAVER_HOST || '127.0.0.1';
const CLAUDE = process.env.CLAUDE_BIN || 'claude';
// A cloudflared file next to this script wins (the Intel Mac download), then the PATH.
const LOCAL_CF = join(dirname(fileURLToPath(import.meta.url)), 'cloudflared');
const CLOUDFLARED = process.env.CLOUDFLARED_BIN || (existsSync(LOCAL_CF) ? LOCAL_CF : 'cloudflared');
const TUNNEL = process.env.YAVER_TUNNEL !== '0' && !process.env.YAVER_HOST;
const NTFY = process.env.YAVER_NTFY || 'https://ntfy.sh';
const ORIGINS = ['https://mskorkmaz08-del.github.io', 'http://localhost:8765'];
const TOKEN_FILE = join(homedir(), '.yaver-bridge-token');
const TOKEN = existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, 'utf8').trim() : (() => {
  const t = randomBytes(18).toString('base64url');
  writeFileSync(TOKEN_FILE, t, { mode: 0o600 });
  return t;
})();
// An empty folder, so Claude Code doesn't pick up any project files or CLAUDE.md.
const WORKDIR = mkdtempSync(join(tmpdir(), 'yaver-bridge-'));

const SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'Text to show the user. Empty if you only call tools this round.' },
    tool_calls: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, args_json: { type: 'string', description: 'Arguments as a JSON object string' } },
        required: ['name', 'args_json'],
      },
    },
  },
  required: ['reply', 'tool_calls'],
};

function buildPrompt({ transcript, tools }) {
  const toolText = tools.map(t => `- ${t.name}: ${t.description}\n  input schema: ${JSON.stringify(t.input_schema)}`).join('\n');
  const convo = transcript.map(m => {
    if (m.role === 'user') return `USER: ${m.text}`;
    if (m.role === 'tool') return `TOOL RESULTS: ${m.text}`;
    const calls = m.calls?.length ? `\n(called: ${m.calls.map(c => `${c.name} ${JSON.stringify(c.args)}`).join('; ')})` : '';
    return `YAVER: ${m.text || ''}${calls}`;
  }).join('\n\n');
  return `You are answering inside the Yaver app. The app can run these tools on the user's phone data:
${toolText}

To use tools, put them in tool_calls (args_json is a JSON object string) and leave reply empty or short; the app runs them and sends back TOOL RESULTS. When you have what you need, answer in reply with tool_calls empty.

Conversation so far:
${convo}

Respond to the latest message.`;
}

function runClaude(body) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--no-session-persistence',
      '--json-schema', JSON.stringify(SCHEMA), '--system-prompt', body.system || 'You are Yaver, a personal assistant.',
      '--model', body.model || 'sonnet', '--effort', body.effort || 'low'];
    const p = spawn(CLAUDE, args, { cwd: WORKDIR, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill(); reject(new Error('Claude on the Mac took too long.')); }, 150000);
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (err += d));
    p.on('error', e => { clearTimeout(timer); reject(new Error(`Could not start Claude Code (${e.message}). Is it installed?`)); });
    p.on('close', code => {
      clearTimeout(timer);
      let r;
      try { r = JSON.parse(out); } catch { return reject(new Error((err || out || `claude exited ${code}`).trim().slice(0, 400))); }
      if (r.is_error) return reject(new Error(String(r.result || r.subtype || 'Claude returned an error').slice(0, 400)));
      let s = r.structured_output;
      if (!s && typeof r.result === 'string') { try { s = JSON.parse(r.result.replace(/^```(json)?|```$/g, '').trim()); } catch { s = { reply: r.result, tool_calls: [] }; } }
      const calls = (s.tool_calls || []).map(c => { let a = {}; try { a = JSON.parse(c.args_json || '{}'); } catch {} return { name: c.name, args: a }; });
      resolve({ reply: s.reply || '', tool_calls: calls });
    });
    p.stdin.end(buildPrompt(body));
  });
}


// ---------- Apple Calendar (read only) ----------
// The helper is a small background app bundle so macOS shows its own clear
// permission prompt ("Yaver Calendar would like to access your calendars") and
// remembers the answer, whether the bridge runs in Terminal or as a login item.
const HERE = dirname(fileURLToPath(import.meta.url));
const CAL_APP = join(HERE, 'YaverCalendar.app');
const CAL_EXE = join(CAL_APP, 'Contents', 'MacOS', 'YaverCalendar');
const CAL_SWIFT = `import AppKit
import EventKit
let args = CommandLine.arguments
let out = URL(fileURLWithPath: args.count > 1 ? args[1] : "/tmp/yaver-calendar.json")
let from = Date(timeIntervalSince1970: (Double(args.count > 2 ? args[2] : "") ?? Date().timeIntervalSince1970 * 1000) / 1000)
let to = Date(timeIntervalSince1970: (Double(args.count > 3 ? args[3] : "") ?? (from.timeIntervalSince1970 + 2592000) * 1000) / 1000)
let store = EKEventStore()
let iso = ISO8601DateFormatter()
func finish(_ o: [String: Any]) {
  if let d = try? JSONSerialization.data(withJSONObject: o) { try? d.write(to: out) }
  exit(0)
}
func hex(_ c: CGColor?) -> String {
  guard let c = c, let rgb = c.converted(to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil), let p = rgb.components, p.count >= 3 else { return "" }
  return String(format: "#%02x%02x%02x", Int(p[0] * 255), Int(p[1] * 255), Int(p[2] * 255))
}
func read() {
  let found = store.events(matching: store.predicateForEvents(withStart: from, end: to, calendars: nil))
  let events: [[String: Any]] = found.map { e in
    let start = e.startDate ?? from
    return [
      "uid": (e.calendarItemExternalIdentifier ?? e.eventIdentifier ?? UUID().uuidString) + "@" + String(Int(start.timeIntervalSince1970)),
      "title": e.title ?? "",
      "start": iso.string(from: start),
      "end": iso.string(from: e.endDate ?? start),
      "allDay": e.isAllDay,
      "location": e.location ?? "",
      "notes": String((e.notes ?? "").prefix(400)),
      "calendar": e.calendar?.title ?? "",
      "color": hex(e.calendar?.cgColor),
    ]
  }
  finish(["ok": true, "events": events, "calendars": store.calendars(for: .event).map { $0.title }])
}
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let answer: (Bool, Error?) -> Void = { ok, _ in
  if ok { read() } else { finish(["ok": false, "error": "denied"]) }
}
if #available(macOS 14.0, *) { store.requestFullAccessToEvents(completion: answer) } else { store.requestAccess(to: .event, completion: answer) }
app.run()
`;
const CAL_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.yaver.calendar</string>
  <key>CFBundleName</key><string>Yaver Calendar</string>
  <key>CFBundleDisplayName</key><string>Yaver Calendar</string>
  <key>CFBundleExecutable</key><string>YaverCalendar</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSBackgroundOnly</key><true/>
  <key>NSCalendarsUsageDescription</key><string>Yaver shows your calendar events next to your study plan. It only reads them.</string>
  <key>NSCalendarsFullAccessUsageDescription</key><string>Yaver shows your calendar events next to your study plan. It only reads them.</string>
</dict></plist>
`;
const calHash = createHash('sha256').update(CAL_SWIFT + CAL_PLIST).digest('hex').slice(0, 16);
const CAL_STAMP = join(CAL_APP, 'Contents', 'yaver-build');

// Builds the helper once (again only if this file's helper code changes).
let building = null;
function buildCalendar() { return (building ||= build().finally(() => { building = null; })); }
async function build() {
  if (process.env.YAVER_CAL_BIN) return null;
  if (process.platform !== 'darwin') return 'Apple Calendar works when the bridge runs on a Mac.';
  if (existsSync(CAL_EXE) && existsSync(CAL_STAMP) && readFileSync(CAL_STAMP, 'utf8') === calHash) return null;
  rmSync(CAL_APP, { recursive: true, force: true });
  mkdirSync(dirname(CAL_EXE), { recursive: true });
  const src = join(WORKDIR, 'calendar.swift');
  writeFileSync(src, CAL_SWIFT);
  writeFileSync(join(CAL_APP, 'Contents', 'Info.plist'), CAL_PLIST);
  console.log('Building the Yaver Calendar helper (once)…');
  const r = await new Promise(resolve => {
    const p = spawn('swiftc', ['-O', '-o', CAL_EXE, src], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => p.kill(), 300000);
    p.stderr.on('data', d => (stderr += d));
    p.on('error', error => { clearTimeout(timer); resolve({ status: 1, error, stderr }); });
    p.on('close', status => { clearTimeout(timer); resolve({ status, stderr }); });
  });
  if (r.status !== 0) {
    rmSync(CAL_APP, { recursive: true, force: true });
    if (r.error || /xcrun|developer tools|xcode-select/i.test(r.stderr || '')) return 'Apple Calendar needs Apple\'s free command line tools on the Mac. Run: xcode-select --install, then restart the bridge.';
    return `Could not build the calendar helper: ${(r.stderr || '').trim().slice(0, 300)}`;
  }
  spawnSync('codesign', ['--force', '--sign', '-', CAL_APP], { stdio: 'ignore' });
  writeFileSync(CAL_STAMP, calHash);
  return null;
}

let calCache = { key: '', at: 0, data: null }, calBusy = null;
async function readCalendar(from, to) {
  const key = `${from}-${to}`;
  if (calCache.key === key && Date.now() - calCache.at < 60000) return calCache.data;
  if (calBusy) return calBusy;
  calBusy = (async () => {
    const problem = await buildCalendar();
    if (problem) throw new Error(problem);
    const out = join(WORKDIR, `cal-${Date.now()}.json`);
    // `open` starts it as its own app, so the permission belongs to Yaver Calendar.
    const [cmd, args] = process.env.YAVER_CAL_BIN
      ? [process.env.YAVER_CAL_BIN, [out, String(from), String(to)]]
      : ['open', ['-g', '-n', '-W', CAL_APP, '--args', out, String(from), String(to)]];
    await new Promise((resolve, reject) => {
      const p = spawn(cmd, args, { stdio: 'ignore' });
      // Long enough to answer the permission prompt the first time.
      const timer = setTimeout(() => { p.kill(); reject(new Error('The Mac did not answer. If a calendar permission prompt is showing on the Mac, click Allow.')); }, 90000);
      p.on('error', e => { clearTimeout(timer); reject(e); });
      p.on('close', () => { clearTimeout(timer); resolve(); });
    });
    let r;
    try { r = JSON.parse(readFileSync(out, 'utf8')); unlinkSync(out); }
    catch { throw new Error('The calendar helper gave no answer. Try again.'); }
    if (!r.ok) throw new Error('The Mac has not allowed calendar access. On the Mac: System Settings → Privacy & Security → Calendars → turn on Yaver Calendar.');
    calCache = { key, at: Date.now(), data: r };
    return r;
  })();
  try { return await calBusy; } finally { calBusy = null; }
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const cors = {
    'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Private-Network': 'true',
    Vary: 'Origin',
  };
  const send = (status, obj) => { res.writeHead(status, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  // Yaver in a browser on this Mac picks up the token here. Only a request made on this
  // Mac (not through the secure link, which adds cf-connecting-ip and its own host name)
  // from Yaver's own page gets it; other web pages can't read the answer.
  if (req.method === 'GET' && req.url === '/pair') {
    const local = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '') && !req.headers['cf-connecting-ip']
      && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    if (!local || !ORIGINS.includes(origin)) return send(403, { error: 'Pairing works only from Yaver on this Mac.' });
    return send(200, { url: `http://127.0.0.1:${PORT}`, token: TOKEN });
  }
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: 'Wrong bridge token. Copy it again from the Mac.' });
  if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, name: 'yaver-bridge', calendar: true });
  if (req.method === 'GET' && req.url.startsWith('/calendar')) {
    const q = new URL(req.url, 'http://x').searchParams;
    const now = Date.now();
    const from = Number(q.get('from')) || now - 7 * 86400e3;
    const to = Math.min(Number(q.get('to')) || now + 60 * 86400e3, from + 400 * 86400e3);
    try {
      const r = await readCalendar(from, to);
      return send(200, { events: r.events, calendars: r.calendars });
    } catch (e) {
      console.error('calendar:', e.message);
      return send(502, { error: e.message });
    }
  }
  if (req.method === 'POST' && req.url === '/chat') {
    let raw = '';
    for await (const c of req) { raw += c; if (raw.length > 2e6) return send(413, { error: 'Message too large' }); }
    try {
      const body = JSON.parse(raw);
      const t0 = Date.now();
      const out = await runClaude(body);
      console.log(`${new Date().toLocaleTimeString()}  replied in ${((Date.now() - t0) / 1000).toFixed(1)}s${out.tool_calls.length ? `, tools: ${out.tool_calls.map(c => c.name).join(', ')}` : ''}`);
      return send(200, out);
    } catch (e) {
      console.error('error:', e.message);
      return send(502, { error: e.message });
    }
  }
  send(404, { error: 'Not found' });
});

// Same format as parseCode in js/ai/mac.js: "yaver1." + base64url({u, t}).
const codeFor = url => 'yaver1.' + Buffer.from(JSON.stringify({ u: url, t: TOKEN })).toString('base64url');
// Same topic as topicFor in js/ai/mac.js.
const TOPIC = 'yaver-' + createHash('sha256').update('yaver-bridge:' + TOKEN).digest('hex').slice(0, 32);

async function announce(url) {
  try { await fetch(`${NTFY}/${TOPIC}`, { method: 'POST', body: url }); }
  catch (e) { console.log(`(could not post the new link for auto-reconnect: ${e.message})`); }
}

function showCode(url) {
  const code = codeFor(url);
  console.log(`\nBridge link: ${url}`);
  console.log(`\nConnection code (Yaver → Settings → Claude on your Mac → Paste connection code):\n\n  ${code}\n`);
  if (process.platform === 'darwin' && !SERVICE) {
    const p = spawn('pbcopy');
    p.on('error', () => {});
    p.stdin.end(code);
    console.log('The code is on your clipboard. With the same Apple ID on both, tap "Paste connection code" on the iPhone.');
  }
  console.log('After a restart the link changes, but Yaver finds the new one by itself. You only paste once.\n');
}

let refresh;
function startTunnel() {
  const p = spawn(CLOUDFLARED, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let seen = false, missing = false;
  const read = d => {
    const m = !seen && String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (!m) return;
    seen = true;
    showCode(m[0]);
    announce(m[0]);
    clearInterval(refresh);
    refresh = setInterval(() => announce(m[0]), 6 * 3600e3); // ntfy keeps messages about 12 hours
  };
  p.stdout.on('data', read);
  p.stderr.on('data', read);
  p.on('error', () => {
    missing = true;
    console.log('\ncloudflared is not installed, so your iPhone cannot reach this Mac yet. Install it once with:\n\n  brew install cloudflared\n\nor, on an Intel Mac (much faster):\n\n  curl -fL -o /tmp/cf.tgz https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz && tar -xzf /tmp/cf.tgz -C ~/yaver-bridge && chmod +x ~/yaver-bridge/cloudflared\n\nthen start the bridge again.');
  });
  p.on('close', () => {
    if (missing || stopping) return;
    console.log('The secure link closed; opening a new one in 5 seconds…');
    setTimeout(startTunnel, 5000);
  });
  tunnel = p;
}
let tunnel, stopping = false;
const stop = () => { stopping = true; tunnel?.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// --install: a login item (LaunchAgent) that starts the bridge with the Mac and restarts it if it stops.
const SERVICE = process.env.YAVER_SERVICE === '1';
const LABEL = 'com.yaver.bridge';
const PLIST = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
// The login item gets this shell's PATH plus the usual install places, so it finds node,
// claude and cloudflared however they were installed.
function servicePath() {
  const h = homedir();
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', join(h, '.local', 'bin'), join(h, '.claude', 'local'), join(h, '.npm-global', 'bin'), dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  return [...new Set([...(process.env.PATH || '').split(':').filter(Boolean), ...extra])].join(':');
}
function service(install) {
  if (process.platform !== 'darwin') { console.log('--install works on a Mac only.'); process.exit(1); }
  const domain = `gui/${process.getuid()}`;
  spawnSync('launchctl', ['bootout', domain, PLIST], { stdio: 'ignore' });
  if (!install) {
    if (existsSync(PLIST)) unlinkSync(PLIST);
    console.log('Removed. The bridge no longer starts by itself.');
    process.exit(0);
  }
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const log = join(dirname(fileURLToPath(import.meta.url)), 'bridge.log');
  mkdirSync(dirname(PLIST), { recursive: true });
  writeFileSync(PLIST, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${esc(process.execPath)}</string><string>${esc(fileURLToPath(import.meta.url))}</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${esc(servicePath())}</string><key>YAVER_SERVICE</key><string>1</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${esc(log)}</string>
  <key>StandardErrorPath</key><string>${esc(log)}</string>
</dict></plist>
`);
  // Claude Code must be installed and signed in; say so now rather than failing quietly later.
  const v = spawnSync(CLAUDE, ['--version'], { encoding: 'utf8', env: { ...process.env, PATH: servicePath() } });
  if (v.status !== 0) console.log('Note: Claude Code was not found. Install it from claude.com/claude-code, run `claude`, type /login, then run this line again.');
  if (process.env.ANTHROPIC_API_KEY) console.log('Note: ANTHROPIC_API_KEY is set in this shell, so Claude Code would bill the API instead of your subscription. Remove it from ~/.zshrc.');
  const r = spawnSync('launchctl', ['bootstrap', domain, PLIST], { encoding: 'utf8' });
  if (r.status !== 0) { console.log(`launchctl could not start it: ${(r.stderr || '').trim()}`); process.exit(1); }
  console.log(`Done. The bridge now runs in the background and starts with your Mac.
Open Yaver on this Mac: it connects to Claude by itself. (If an older bridge window is open, close it.)
Log: ${log}`);
  spawnSync('open', ['https://mskorkmaz08-del.github.io/yaver/']);
  process.exit(0);
}
if (process.argv.includes('--install')) service(true);
if (process.argv.includes('--uninstall')) service(false);

server.listen(PORT, HOST, () => {
  console.log(`Yaver bridge running on http://${HOST}:${PORT}`);
  // Build the calendar helper now, so Yaver's first calendar request is quick.
  setTimeout(() => buildCalendar().then(p => p && console.log(p)), 2000);
  if (TUNNEL) { console.log('Opening a secure link for your iPhone…'); startTunnel(); }
  else console.log(`Bridge token: ${TOKEN}\nConnection code for this address: ${codeFor(`http://${HOST}:${PORT}`)}`);
});
