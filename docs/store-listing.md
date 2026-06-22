# Chrome Web Store listing — Phone Keyboard

Copy for the Web Store developer dashboard. Paste each block into the matching
field. Keep this in sync with `extension/manifest.json` (name, version,
description).

---

## Summary (short description — max 132 chars)

Shows in search results. The manifest `description` is used by default; tuned
options:

- `Type into any text box on your laptop's Chrome from your phone, over local WiFi. Two-way sync, send-on-Enter, history.` (118)
- `Use your phone as a keyboard for your laptop's Chrome — type into any field over local WiFi. Nothing leaves your network.` (120)

---

## Detailed description (main listing body)

```
Type into your laptop's Chrome from your phone — over your local WiFi, with
nothing leaving your network.

Click any text box on your computer, then type it out on your phone. The text
appears live in the selected input on the laptop. Built to make one-handed
laptop use comfortable (for example, when an arm is in a cast), but handy any
time your phone's keyboard is faster than reaching for the laptop.

FEATURES
• Type on your phone → text streams into the selected input on the laptop, live.
• Two-way sync — edits on either device stay in step.
• A Send button presses Enter, so you can submit search boxes, chats, and forms.
• Message history with collapse, star, resend, and reset.
• A floating, draggable bubble in the browser for connection status and settings.
• An optional desktop app (macOS + Linux) so non-technical users never touch a
  terminal.

HOW IT WORKS
A Chrome extension can't host a server, so there are three small parts that talk
over WebSockets:

   Phone (web app)  ⇄  Local relay server (on the laptop)  ⇄  Chrome extension

The relay server runs on your own laptop. The extension always connects to
127.0.0.1 (localhost), so there are no mixed-content issues and it needs no
token. Your phone connects over the LAN and must present a token that's baked
into its URL/QR code.

WHAT YOU NEED
• A laptop and phone on the same WiFi.
• Google Chrome (or Chromium) on the laptop.
• The relay server running on the laptop — either the desktop app (one click to
  start) or via Node.js from the terminal.

PRIVACY
• No data leaves your network. There is no cloud component and no analytics.
• LAN clients (your phone) must present a token, embedded in the QR/URL — keep
  that link private.
• The extension connects only to localhost and needs no token.

Open source (MIT). Setup instructions and the relay server / desktop app are
linked from the homepage:
https://github.com/heolin/phone-remote-keyboard
```

---

## Single purpose

```
Phone Keyboard lets the user type into text fields in Chrome from their phone, relayed over their own local network.
```

---

## Permission justifications (Privacy practices tab)

The dashboard asks for a justification per **manifest-declared** permission.

- **`storage`** — Stores the server address/port, optional token, message
  history, and the bubble's position locally so they persist between sessions.
- **`tabs`** — Keeps the typed text and the active-input state in sync across the
  user's open tabs.
- **`alarms`** — Periodically checks the WebSocket connection to the local relay
  server and reconnects if it drops.
- **Host access (`ws://localhost/*`, `ws://127.0.0.1/*`, `http://localhost/*`,
  `http://127.0.0.1/*`)** — Connects to the relay server running on the user's
  own machine.
- **Host access on all sites (`<all_urls>` content script)** — The bubble and
  input-sync must work in any text box, on any site the user chooses to type
  into.

## Remote code

Answer: **No.** All JS is bundled in the package — no external `<script>` URLs,
no remote modules, no `eval()`. The WebSocket connection carries data (typed
text and status), not code.

---

## Data disclosures (data-usage checkboxes)

- The extension does **not** collect or transmit data to the developer (no
  analytics, no backend of ours).
- Typed text travels only over the user's **own local network** (phone → local
  relay → extension). It does not reach the developer or any third-party server.
- Nothing is sold or transferred to third parties.

---

## Other listing fields

- **Category:** Accessibility (recommended — fits the use case) or Productivity.
- **Language:** English.
- **Store icon:** `extension/icons/icon128.png` (128×128).
- **Screenshots (1280×800 or 640×400, need ≥1):** source art in `docs/` —
  `bubble.png`, `bubble-settings.png`, `phone-app.png`, `app-running.png` (may
  need padding to the required aspect ratio).
- **Privacy policy URL:** required once any data handling is declared. The
  `PRIVACY.md` in the repo root satisfies this; link its raw GitHub URL:
  https://github.com/heolin/phone-remote-keyboard/blob/main/PRIVACY.md
