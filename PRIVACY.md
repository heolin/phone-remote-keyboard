# Privacy Policy — Phone Keyboard

_Last updated: 2026-06-22_

Phone Keyboard is a Chrome extension that lets you type into text fields in your
laptop's browser from your phone, relayed over your own local WiFi network. This
policy explains exactly what it does and does not do with your data.

## The short version

Phone Keyboard has **no accounts, no analytics, no tracking, and no servers of
the developer's own**. It does not collect, sell, or share your personal
information. Your typed text travels only over **your own local network**, and
the only settings it stores are kept **locally in your browser**.

## What is stored locally

The extension saves the following to your browser's local storage
(`chrome.storage.local`) so your preferences persist between sessions:

- the **server address** (host and port) of the local relay;
- an optional **token** (only needed for non-localhost servers);
- your **message history**, including starred messages;
- whether typing-from-phone is **on or off**;
- the **position** of the floating bubble.

This data never leaves your device and is removed if you uninstall the extension.

## How your typed text travels

Phone Keyboard works with a small **relay server that runs on your own laptop**
(via the optional desktop app or from the terminal). The three parts talk over
WebSockets on your local network:

    Phone (web app)  ⇄  Local relay server (your laptop)  ⇄  Chrome extension

- The extension connects only to **127.0.0.1 (localhost)** — the relay on the
  same machine.
- Your phone connects to the relay over your **LAN** and must present a token
  embedded in its URL/QR code.
- Typed text is delivered to the focused input field and is **not** recorded,
  stored, or transmitted to the developer or any third party.
- **No data leaves your network.** There is no cloud component.

## Permissions, and why they are needed

- **Storage** — to save the local settings and message history listed above.
- **Tabs** — to keep the typed text and the active-input state in sync across
  your open tabs.
- **Alarms** — to periodically check the connection to the local relay and
  reconnect if it drops.
- **Host access to localhost / 127.0.0.1** — to connect to the relay server
  running on your own machine.
- **Access to all websites** — so the bubble and input-sync can work in text
  fields on any site you choose to type into.

## Children

Phone Keyboard is a general-purpose utility and is not directed at children.

## Changes

If this policy changes, the updated version will be published in this repository
with a new "Last updated" date.

## Contact

Questions? Contact the developer at **wlodarczyk.woj@gmail.com** or open an issue
at https://github.com/heolin/phone-remote-keyboard/issues
