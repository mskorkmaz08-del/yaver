# Yaver bridge: Claude on your Mac

The bridge lets Yaver on your iPhone use Claude through **Claude Code on your Mac**, signed in to your Claude subscription, so there is no API bill. Before each message Yaver checks whether the Mac is reachable. If it is, Claude answers; if not (Mac asleep, off, or offline), Yaver uses free Gemini instead. Photos always go to Gemini, because the bridge is text only.

Your data stays on the phone. The Mac only receives the conversation and the list of Yaver's tools, and sends back Claude's reply and any tool calls, which the phone runs itself.

Note: the subscription is meant for Anthropic's own apps, including Claude Code. Heavy use through the bridge counts against your normal Claude usage limits.

## One-time setup on the Mac

1. **Node.js.** In Terminal run `node -v`. If it says "command not found", install it with `brew install node` (or from nodejs.org).
2. **Claude Code, signed in with your subscription.** Run `claude`. If it's missing, install it from claude.com/claude-code. Inside it, type `/login` and choose your Claude account (Pro or Max), then exit with `/exit`. Make sure `echo $ANTHROPIC_API_KEY` prints nothing; if a key is set, Claude Code bills the API instead of your subscription.
3. **Get the bridge.**
   ```
   mkdir -p ~/yaver-bridge && cd ~/yaver-bridge
   curl -O https://raw.githubusercontent.com/mskorkmaz08-del/yaver/main/bridge/yaver-bridge.mjs
   ```
4. **Tailscale on both devices** (free; it gives your phone a private, encrypted route to your Mac from anywhere).
   - Mac: install Tailscale from the Mac App Store and sign in.
   - iPhone: install Tailscale from the App Store and sign in with the same account. Turn it on.

## Start it

```
cd ~/yaver-bridge
caffeinate -i node yaver-bridge.mjs
```

`caffeinate -i` stops the Mac from sleeping while the bridge runs. The first start prints a **bridge token**; it's saved in `~/.yaver-bridge-token` and stays the same.

In a second Terminal window, publish it to your Tailscale network:

```
tailscale serve --bg 8787
```

If `tailscale` isn't found, use `/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg 8787`. If it asks you to enable HTTPS, open the link it shows and turn it on. It prints an address like `https://your-mac.tail1234.ts.net`. You only run `tailscale serve` once; it remembers.

## Connect Yaver

Yaver → Settings → **Claude on your Mac**:

- Bridge address: the `https://…ts.net` address.
- Bridge token: the token from the bridge window.
- Model: Sonnet is the default. Opus is smarter but uses more of your limit.

Tap **Test Mac connection**. Chat replies that came from the Mac are labelled "claude · your mac" under the message; Gemini replies say "gemini".

## Everyday use

Start the bridge (`caffeinate -i node yaver-bridge.mjs`) when you want Claude. Close the window to stop it; Yaver switches to Gemini on its own.

## Troubleshooting

- **`curl https://…ts.net/health` shows `HTTP/2 502`**: the Mac App Store version of Tailscale can't forward to `127.0.0.1`. Run the bridge on the Mac's Tailscale address instead:
  ```
  tailscale serve reset
  cd ~/yaver-bridge && YAVER_HOST=$(tailscale ip -4) caffeinate -i node yaver-bridge.mjs
  ```
  and in a second window: `tailscale serve --bg http://$(tailscale ip -4):8787`. The address and token stay the same. (Or install the standalone Tailscale from tailscale.com/download/mac instead of the App Store one.)

- **"Could not reach your Mac"**: Tailscale is off on the phone or Mac, the Mac is asleep, or the bridge window was closed.
- **"The Mac refused the token"**: copy the token again from the bridge window or `cat ~/.yaver-bridge-token`.
- **Errors mentioning login**: run `claude` and `/login` again.
- The bridge window logs each reply and how long it took.
