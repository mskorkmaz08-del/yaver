#!/usr/bin/env node
// Yaver bridge: lets the Yaver app on your iPhone use Claude Code on this Mac,
// signed in to your Claude subscription. Yaver sends the conversation and its
// tool list; this runs `claude -p` with no built-in tools and returns Claude's
// reply plus any tool calls, which the phone then runs on its own data.
//
// Run:   node yaver-bridge.mjs          (keep the Mac awake while you want it)
// Reach: tailscale serve --bg 8787      (gives https://<mac>.<tailnet>.ts.net)
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.YAVER_PORT || 8787);
// 127.0.0.1 by default. The Mac App Store Tailscale can't proxy to localhost
// (tailscale serve answers 502), so then bind to the Mac's Tailscale address.
const HOST = process.env.YAVER_HOST || '127.0.0.1';
const CLAUDE = process.env.CLAUDE_BIN || 'claude';
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
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: 'Wrong bridge token. Copy it again from the Mac.' });
  if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, name: 'yaver-bridge' });
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

server.listen(PORT, HOST, () => {
  console.log(`Yaver bridge running on http://${HOST}:${PORT}`);
  console.log(`Bridge token (paste into Yaver → Settings → Claude on your Mac):\n\n  ${TOKEN}\n`);
  console.log(HOST === '127.0.0.1' ? 'To reach it from your iPhone: tailscale serve --bg 8787' : `To reach it from your iPhone: tailscale serve --bg http://${HOST}:${PORT}`);
});
