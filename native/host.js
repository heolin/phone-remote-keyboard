#!/usr/bin/env node
'use strict';

/**
 * Phone Keyboard — native messaging host.
 *
 * Chrome can't start a server process, so the extension talks to this tiny
 * native host over stdio (Chrome's length-prefixed JSON protocol) to:
 *   { cmd: 'start', port } -> spawn the relay server detached, record its PID
 *   { cmd: 'stop' }        -> kill the recorded server PID
 *   { cmd: 'status' }      -> report whether the server is running
 *
 * The host process itself is short-lived: the extension connects, sends one
 * command, reads the reply, and disconnects. The server keeps running because
 * it is spawned detached + unref'd, with its PID persisted to disk.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SERVER_ENTRY = path.join(__dirname, '..', 'server', 'index.js');
const PID_FILE = path.join(__dirname, '..', 'server', '.pk-server.pid');
const OUT_LOG = path.join(__dirname, '..', 'server', 'server.out.log');

// ---- Chrome native messaging framing ---------------------------------------
function send(obj) {
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  process.stdout.write(Buffer.concat([header, json]));
}

function readMessages(onMessage) {
  let buf = Buffer.alloc(0);
  process.stdin.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const len = buf.readUInt32LE(0);
      if (buf.length < 4 + len) break;
      const body = buf.subarray(4, 4 + len);
      buf = buf.subarray(4 + len);
      let msg;
      try {
        msg = JSON.parse(body.toString('utf8'));
      } catch {
        continue;
      }
      onMessage(msg);
    }
  });
  process.stdin.on('end', () => process.exit(0));
}

// ---- pid helpers -----------------------------------------------------------
function readPid() {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}
function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ---- commands --------------------------------------------------------------
function start(port) {
  const existing = readPid();
  if (isAlive(existing)) {
    return { ok: true, running: true, pid: existing, message: 'Server already running' };
  }
  const out = fs.openSync(OUT_LOG, 'a');
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, PK_PORT: String(port || process.env.PK_PORT || 8787) },
  });
  child.unref();
  try {
    fs.writeFileSync(PID_FILE, String(child.pid));
  } catch {
    /* best effort */
  }
  return { ok: true, running: true, pid: child.pid, message: 'Server started' };
}

function stop() {
  const pid = readPid();
  if (!isAlive(pid)) {
    try { fs.unlinkSync(PID_FILE); } catch {}
    return { ok: true, running: false, message: 'Server was not running' };
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch (e) {
    return { ok: false, error: `could not stop pid ${pid}: ${e.message}` };
  }
  try { fs.unlinkSync(PID_FILE); } catch {}
  return { ok: true, running: false, message: 'Server stopped' };
}

function status() {
  const pid = readPid();
  const running = isAlive(pid);
  return { ok: true, running, pid: running ? pid : null, message: running ? 'Server running' : 'Server stopped' };
}

// ---- main ------------------------------------------------------------------
readMessages((msg) => {
  let reply;
  switch (msg && msg.cmd) {
    case 'start': reply = start(msg.port); break;
    case 'stop': reply = stop(); break;
    case 'status': reply = status(); break;
    default: reply = { ok: false, error: `unknown cmd: ${msg && msg.cmd}` };
  }
  send(reply);
});
