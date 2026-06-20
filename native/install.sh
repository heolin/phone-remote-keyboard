#!/usr/bin/env bash
# Register the Phone Keyboard native messaging host with Chrome/Chromium (Linux).
#
# Usage:  ./native/install.sh <EXTENSION_ID>
#
# Find <EXTENSION_ID> at chrome://extensions (enable Developer mode, load the
# `extension/` folder unpacked, then copy the ID shown on its card).
set -euo pipefail

HOST_NAME="com.phonekeyboard.host"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_JS="$DIR/host.js"
TEMPLATE="$DIR/${HOST_NAME}.template.json"

EXT_ID="${1:-}"
if [[ -z "$EXT_ID" ]]; then
  echo "error: missing extension id"
  echo "usage: $0 <EXTENSION_ID>   (copy it from chrome://extensions)"
  exit 1
fi

chmod +x "$HOST_JS"

# Build the manifest from the template.
MANIFEST_JSON="$(sed -e "s#__HOST_PATH__#${HOST_JS}#" -e "s#__EXTENSION_ID__#${EXT_ID}#" "$TEMPLATE")"

# Candidate native-messaging-host directories for Chrome/Chromium on Linux.
TARGETS=(
  "$HOME/.config/google-chrome/NativeMessagingHosts"
  "$HOME/.config/chromium/NativeMessagingHosts"
  "$HOME/.config/google-chrome-beta/NativeMessagingHosts"
)

installed=0
for d in "${TARGETS[@]}"; do
  base="$(dirname "$d")"
  if [[ -d "$base" ]]; then
    mkdir -p "$d"
    printf '%s\n' "$MANIFEST_JSON" > "$d/${HOST_NAME}.json"
    echo "installed: $d/${HOST_NAME}.json"
    installed=1
  fi
done

if [[ "$installed" -eq 0 ]]; then
  # No browser profile found yet — install to the Chrome path anyway.
  d="${TARGETS[0]}"
  mkdir -p "$d"
  printf '%s\n' "$MANIFEST_JSON" > "$d/${HOST_NAME}.json"
  echo "installed: $d/${HOST_NAME}.json (no existing profile detected)"
fi

echo
echo "Done. Fully quit and reopen Chrome, then use Start/Stop server from the bubble."
