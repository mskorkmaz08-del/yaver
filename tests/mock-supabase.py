# Minimal stand-in for a Supabase project (auth by email code 123456, storage, REST
# tables) used by tests/calisthenics.mjs. Run: python3 tests/mock-supabase.py (port 8766).
import json, os, re, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
STORE = {"files": {}, "captures": {}, "sessions": {}, "otp": []}
TOKEN = "tok-abc"; UID = "11111111-2222-3333-4444-555555555555"
class H(BaseHTTPRequestHandler):
    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "apikey, authorization, content-type, prefer, x-upsert, cache-control")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    def reply(self, code, obj=None):
        body = b"" if obj is None else json.dumps(obj).encode()
        self.send_response(code); self.cors(); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_OPTIONS(self): self.send_response(204); self.cors(); self.end_headers()
    def body(self): n = int(self.headers.get("Content-Length") or 0); return self.rfile.read(n)
    def authed(self): return self.headers.get("Authorization") == f"Bearer {TOKEN}" and self.headers.get("apikey") == "anon-key"
    def do_GET(self):
        if self.path == "/auth/v1/user":
            return self.reply(200, {"id": UID, "email": "me@test.dev"}) if self.authed() else self.reply(401, {"msg": "bad jwt"})
        if self.path == "/__dump":
            return self.reply(200, {"files": {k: len(v) for k, v in STORE["files"].items()}, "captures": STORE["captures"], "sessions": list(STORE["sessions"]), "otp": STORE["otp"]})
        if self.path.startswith("/rest/v1/sessions"):
            if not self.authed(): return self.reply(401, {"msg": "JWT expired"})
            rows = [{"id": k, "started_at": v.get("started_at"), "ended_at": v.get("ended_at"), "source": v.get("source"), "data": v.get("data")} for k, v in STORE["sessions"].items()]
            rows.sort(key=lambda r: r["started_at"] or "", reverse=True)
            return self.reply(200, rows)
        if self.path.startswith("/__file/"):
            b = STORE["files"][self.path[len("/__file/"):]]
            self.send_response(200); self.end_headers(); self.wfile.write(b); return
        self.reply(404, {"msg": "nf"})
    def do_POST(self):
        p, b = self.path, self.body()
        if False: pass
        if p == "/__reset" or p == "/__seed":
            if p == "/__seed":
                for row in json.loads(b): STORE["sessions"][row["id"]] = row
                return self.reply(200, {})
            STORE.update({"files": {}, "captures": {}, "sessions": {}, "otp": []}); return self.reply(200, {})
        if self.headers.get("apikey") != "anon-key": return self.reply(401, {"msg": "No API key"})
        if p.startswith("/auth/v1/otp"):
            STORE["otp"].append(json.loads(b)); return self.reply(200, {})
        if p == "/auth/v1/verify":
            d = json.loads(b)
            if d.get("token") != "123456": return self.reply(403, {"msg": "Token has expired or is invalid"})
            return self.reply(200, {"access_token": TOKEN, "refresh_token": "ref-1", "expires_in": 3600, "user": {"id": UID, "email": d["email"]}})
        if not self.authed(): return self.reply(401, {"msg": "bad jwt"})
        m = re.match(r"/storage/v1/object/captures/(.+)", p)
        if m:
            path = m.group(1)
            if not path.startswith(UID + "/"): return self.reply(403, {"error": "rls"})
            STORE["files"][path] = b; return self.reply(200, {"Key": "captures/" + path})
        m = re.match(r"/rest/v1/(captures|sessions)\?on_conflict=id", p)
        if m:
            d = json.loads(b); STORE[m.group(1)][d["id"]] = d; return self.reply(201)
        self.reply(404, {"msg": "nf " + p})
    def log_message(self, *a): pass
ThreadingHTTPServer(("127.0.0.1", 8766), H).serve_forever()
