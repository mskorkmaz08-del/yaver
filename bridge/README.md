# Yaver bridge: Claude on your Mac

The bridge lets Yaver on your iPhone use Claude through **Claude Code on your Mac**, signed in to your Claude subscription, so there is no API bill. Before each message Yaver checks whether the Mac is reachable. If it is, Claude answers; if not (Mac asleep, off, or offline), Yaver uses free Gemini instead. Photos always go to Gemini, because the bridge is text only.

Your data stays on the phone. The Mac only receives the conversation and the list of Yaver's tools, and sends back Claude's reply and any tool calls, which the phone runs itself.

Note: the subscription is meant for Anthropic's own apps, including Claude Code. Heavy use through the bridge counts against your normal Claude usage limits.

## One-time setup on the Mac

1. **Claude Code, signed in with your subscription.** Run `claude`. If it's missing, install it from claude.com/claude-code. Inside it, type `/login`, choose your Claude account (Pro or Max), then `/exit`. Make sure `echo $ANTHROPIC_API_KEY` prints nothing; if a key is set, Claude Code bills the API instead of your subscription.
2. **Everything else, in one paste** (Node, cloudflared and the bridge):
   ```
   brew install node cloudflared; mkdir -p ~/yaver-bridge && curl -fsSL -o ~/yaver-bridge/yaver-bridge.mjs https://raw.githubusercontent.com/mskorkmaz08-del/yaver/main/bridge/yaver-bridge.mjs
   ```

On an **Intel Mac**, Homebrew builds from source and can take very long. Download cloudflared straight into the bridge folder instead (the bridge finds it there):
   ```
   mkdir -p ~/yaver-bridge && curl -fL -o /tmp/cf.tgz https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz && tar -xzf /tmp/cf.tgz -C ~/yaver-bridge && chmod +x ~/yaver-bridge/cloudflared
   ```

No Tailscale needed. If you set it up earlier, you can turn it off (`tailscale funnel reset` and `tailscale serve reset`).

## Start it

```
caffeinate -i node ~/yaver-bridge/yaver-bridge.mjs
```

It opens a free secure link (Cloudflare) and prints a **connection code** starting with `yaver1.`. On a Mac the code is also copied to your clipboard. `caffeinate -i` keeps the Mac awake while the bridge runs.

## Connect Yaver (once)

On the iPhone: Yaver → Settings → **Claude on your Mac** → **Paste connection code**. With the same Apple ID on the Mac and iPhone, the clipboard carries over by itself; otherwise AirDrop or message the code to yourself and paste it into the box under the button, then tap Save.

Yaver tests the connection straight away. Chat replies from the Mac say "claude · your mac" under the message; Gemini replies say "gemini".

## Everyday use

Run `caffeinate -i node ~/yaver-bridge/yaver-bridge.mjs` when you want Claude. Close the window (or Ctrl+C) to stop; Yaver switches to Gemini on its own.

The secure link changes every time the bridge starts. You don't need a new code: the bridge posts its new link to a private ntfy.sh mailbox named after a scramble of your token, and Yaver looks there when the old link stops answering.

## Security

- While the bridge runs, its link is on the public internet. Every request needs your token, and Claude Code runs with all its tools switched off, so the most anyone could do with a stolen token is chat on your subscription.
- The connection code contains the token: don't post it anywhere. To make a new token, delete `~/.yaver-bridge-token`, restart the bridge, and paste the new code.

## Troubleshooting

- **"cloudflared is not installed"**: run `brew install cloudflared` and start the bridge again.
- **"Could not reach your Mac"**: the bridge window was closed or the Mac is asleep. Start it again and give it about 10 seconds.
- **"The Mac refused the token"**: paste the connection code again.
- **Errors mentioning login**: run `claude` and `/login` again.
- **Using Tailscale instead**: start with `YAVER_HOST=<address> node yaver-bridge.mjs` to skip the Cloudflare link; the address you enter in Yaver must start with https://.
- The bridge window logs each reply and how long it took.
