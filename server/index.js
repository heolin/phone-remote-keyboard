#!/usr/bin/env node
'use strict';

/**
 * Phone Keyboard — command-line entry point.
 *
 * Thin wrapper around server/relay.js: starts the relay, prints a banner + QR
 * code, and streams logs to the console. The desktop app (app/main.js) drives
 * the same relay module with a GUI instead.
 */

const { createRelay } = require('./relay');

const relay = createRelay();
const port = Number(process.env.PK_PORT) || 8787;

relay.on('log', (e) => {
  const line = `[${new Date(e.t).toISOString()}] ${e.level.toUpperCase()} ${e.msg}`;
  if (e.level === 'error') console.error(line);
  else if (e.level === 'warn') console.warn(line);
  else console.log(line);
});

relay
  .start(port)
  .then((info) => {
    const phoneURL = info.phoneURL;
    console.log('\n  📱  Phone Keyboard server is running\n');
    console.log(`  Phone URL : ${phoneURL}`);
    if (info.lanIPs.length > 1) {
      console.log(`  Other IPs : ${info.lanIPs.slice(1).map((ip) => `http://${ip}:${info.port}`).join(', ')}`);
    }
    console.log(`  Logs      : http://localhost:${info.port}/logs`);
    console.log(`  Token     : ${info.token}  (extension on this laptop needs no token)\n`);

    try {
      const qrcode = require('qrcode-terminal');
      qrcode.generate(phoneURL, { small: true }, (qr) => {
        console.log(qr);
        console.log('  Scan with your phone (same WiFi) to open the keyboard.\n');
      });
    } catch {
      console.log('  (install qrcode-terminal to show a scannable QR code)\n');
    }
  })
  .catch((e) => {
    console.error(`\n  ✗ ${e.message}\n`);
    process.exit(1);
  });

process.on('SIGTERM', async () => {
  await relay.stop();
  process.exit(0);
});
process.on('SIGINT', async () => {
  await relay.stop();
  process.exit(0);
});
