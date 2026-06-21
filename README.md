# ⌨️ Phone Keyboard

[![License: MIT](https://img.shields.io/badge/License-MIT-7c5cff.svg)](LICENSE)

**Type into your laptop's Chrome browser from your phone, over local WiFi.**

Click any text box on your computer, then type it out on your phone — the text
appears live on the laptop. Built to make one-handed laptop use comfortable
(e.g. when an arm is in a cast), but handy any time your phone's keyboard is
faster than reaching for the laptop.

- 📱 Type on your phone → text streams into the selected input on the laptop.
- 🔄 Two-way sync — edits on either device stay in step.
- ⏎ A **Send** button presses Enter (submits search boxes, chats, forms).
- 🕘 Message **history** with collapse, **star**, **resend**, and **reset**.
- 🫧 A floating, draggable **bubble** in the browser for status + config.
- 🖥️ A friendly **desktop app** (macOS + Linux) so non-technical users never
  touch a terminal.

---

## How it works

A Chrome extension can't host a server, so the project is three small parts that
talk over WebSockets:

```
  Phone (web app)  <--WS-->  Local relay server  <--WS-->  Chrome extension
   types text                 (on the laptop)              (bubble + input sync)
```

The **server** is just a relay hub on the laptop; the phone and the extension are
both clients of it. The extension always connects to `127.0.0.1` (localhost is
trusted, so there are no mixed-content issues and no token is needed). The phone
connects over the LAN and must present a **token** baked into its URL/QR code.

## Requirements

- A laptop and phone on the **same WiFi**.
- **Google Chrome** (or Chromium) on the laptop.
- To run from source or build the app: **Node.js 18+**.

## Quick start

### 1. Run the server

**Option A — Desktop app (recommended, non-technical friendly).**
A real app with a window: a big QR code, a Start/Stop button, a status light, and
a menu-bar icon. The server runs *inside* the app. Build/install it once (see
[Building the desktop app](#building-the-desktop-app)), open it, click **Start**.

**Option B — Terminal (for developers).**

```bash
npm install
npm start
```

Either way you get a **QR code** and a phone URL like
`http://192.168.0.13:8787/?token=abc123`. (Terminal: change the port with
`PK_PORT=9000 npm start`; the app has a port field.)

### 2. Load the Chrome extension (once)

1. Go to `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select the `extension/` folder.
3. (Optional) pin it. A floating ⌨️ bubble also appears on pages.

The bubble's status light goes **green** when the extension reaches the server.
It connects to `127.0.0.1:8787` by default — change it in the bubble or popup if
you run the server on a different port.

### 3. Open the phone app

Scan the QR code (same WiFi), or open the printed URL in your phone's browser.
"Add to Home Screen" makes it feel like a native app.

## Using it

1. On the laptop, click any text box. It gets a light highlight and a small **×**
   appears inside it (right side) — that's the active target.
2. On the phone, type. Text streams into that box live.
3. Tap **Send ⏎** to submit (presses Enter) and save the message to history.
4. **Star** messages you reuse; find them under **★ Starred** and resend in a tap.
5. Click the **×** in the field (or on the phone) to release it.

### The bubble

The floating ⌨️ bubble is **draggable** — drop it anywhere; its position is
remembered. Click it to open the panel:

- The **header** has a minimal **on/off** switch (pause typing-from-phone without
  removing the extension) and a **✕** to close the panel.
- The panel shows the **connection status** (and how many phones are attached).
- **more settings** reveals the **server address** (host / port), an optional
  **token** for non-localhost servers, and **Save & reconnect**.

The panel opens **below** the bubble when it sits in the top half of the screen,
and **above** it when it sits in the bottom half. The toolbar **popup** exposes
the same connection settings.

## Building the desktop app

One Electron codebase (`app/`) packages for both macOS and Linux from the same
source.

```bash
npm install

# Linux  → dist/PhoneKeyboard-x.y.z.AppImage  (+ phone-keyboard_x.y.z_amd64.deb)
npm run dist:linux

# macOS  → dist/PhoneKeyboard-x.y.z.dmg   (run this ON a Mac)
npm run dist:mac
```

**No Mac handy?** A `.dmg` (and a *universal* binary) can only be built on macOS —
they need Apple-only tools (`hdiutil`, `lipo`). But you can **cross-build a
runnable `.app` zip on Linux**:

```bash
npm run dist:mac-zip                  # Intel (x64) — also runs on Apple Silicon via Rosetta
npm run dist:mac-zip -- --arm64       # native Apple Silicon (M1/M2/M3)
npm run dist:mac-universal            # universal — MUST be run on macOS
```

| Build | Runs on | Build host |
|-------|---------|------------|
| x64 zip | every Mac (Intel native, Apple Silicon via Rosetta) | any OS |
| arm64 zip | Apple Silicon only | any OS |
| universal / `.dmg` | every Mac | **macOS only** |

You do **not** need an Apple Developer account. The app is unsigned, so the first
launch is **right-click → Open** (and if Gatekeeper still blocks it after copying,
`xattr -cr "/Applications/Phone Keyboard.app"`).

### Installing the built app

- **macOS:** unzip → drag `Phone Keyboard.app` to Applications → right-click → Open.
  (Or open the `.dmg` and drag.)
- **Linux (AppImage):** right-click → Properties → *Allow executing as program*,
  then double-click. (Needs `libfuse2`; or run with `--appimage-extract-and-run`.)
- **Linux (deb):** `sudo apt install ./dist/phone-keyboard_*.deb`, then launch
  **Phone Keyboard** from the apps menu.

### Run it without packaging (dev)

```bash
npm run app        # launches the Electron app against your working tree
```

The app shows a window (Dock) **and** a menu-bar icon. Closing the window keeps it
running in the menu bar; Quit from there to exit. On Ubuntu/GNOME the tray icon
needs the *AppIndicator* extension — without it, just use the window. On some
Linux setups dev launch needs `npx electron . --no-sandbox` (the packaged app
handles this for you).

## Project structure

```
phone-keyboard/
├── app/         Desktop app (Electron): window + menu-bar control for the server
├── server/      Relay core (relay.js) + CLI (index.js): phone app, WS hub, /logs
├── extension/   Chrome MV3: floating bubble, input selection + sync, popup
├── mobile/      Phone web app (Preact, no build step)
├── native/      Native-messaging host (legacy server start/stop; not wired to the current UI)
└── shared/      Wire protocol shared by all parts
```

## Development

```bash
npm start        # run the relay from the terminal (with QR)
npm run app      # run the desktop app from source
npm test         # boot the server and check token auth + relay routing
npm run icons    # regenerate all icons from extension/icons/keyboard.png
```

## Security

- The server is reachable by anything on your WiFi, so LAN clients (the phone)
  must present a **token** — it's embedded in the QR/URL. Keep that URL private.
- The token is stored locally (terminal: `server/.pk-config.json`; app: the OS
  user-data dir). Delete it / use **Reset token** to rotate it.
- The extension connects only to localhost and needs no token.
- No data leaves your network; there is no cloud component.

## License

[MIT](LICENSE) © Wojciech Wlodarczyk
