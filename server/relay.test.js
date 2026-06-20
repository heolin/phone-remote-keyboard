'use strict';
/* Lightweight integration test for the relay. Run: node server/relay.test.js
 * Boots the server on a test port, then exercises token auth + phone<->ext routing. */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const PORT = 8911;
let serverProc;
let TOKEN;
let failures = 0;

function assert(cond, label) {
  console.log(`${cond ? '  ✓' : '  ✗ FAIL'} ${label}`);
  if (!cond) failures++;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function getHealth() {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}/health`, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}

function open(role, { token, host } = {}) {
  const params = new URLSearchParams({ role });
  if (token) params.set('token', token);
  const url = `ws://${host || '127.0.0.1'}:${PORT}/ws?${params}`;
  const ws = new WebSocket(url);
  ws.inbox = [];
  ws.on('message', (m) => ws.inbox.push(JSON.parse(m.toString())));
  return ws;
}
const opened = (ws) => new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
const closed = (ws) => new Promise((res) => ws.once('close', (code) => res(code)));

async function main() {
  serverProc = spawn('node', [path.join(__dirname, 'index.js')], {
    env: {
      ...process.env,
      PK_PORT: String(PORT),
      // isolate the test's token file so it never touches the real config
      PK_CONFIG: path.join(require('os').tmpdir(), 'pk-test-config.json'),
    },
    stdio: 'ignore',
  });
  await wait(900);

  const health = await getHealth();
  TOKEN = new URL(health.phoneURL).searchParams.get('token');
  assert(health.ok === true, 'GET /health returns ok');
  assert(typeof TOKEN === 'string' && TOKEN.length > 4, 'health exposes a token via phoneURL');

  // A non-loopback address is needed to exercise token auth (localhost is trusted).
  const lanIP = (health.lanIPs || [])[0];

  // ext from localhost: no token required
  const ext = open('ext');
  await opened(ext);
  assert(true, 'localhost ext connects without a token');

  if (lanIP) {
    // phone with WRONG token over the LAN must be rejected
    const badPhone = open('phone', { token: 'nope', host: lanIP });
    const code = await closed(badPhone);
    assert(code === 4001, `LAN phone with bad token is rejected (4001) [via ${lanIP}]`);
  } else {
    console.log('  · (skipped token-rejection test: no LAN IP available)');
  }

  // phone with correct token connects (over LAN if possible, else loopback)
  const phone = open('phone', { token: TOKEN, host: lanIP || '127.0.0.1' });
  await opened(phone);
  await wait(150);
  assert(true, 'phone connects with the correct token');

  // presence: ext should learn a phone is present
  const extStatus = ext.inbox.filter((m) => m.type === 'status').pop();
  assert(extStatus && extStatus.phones === 1 && extStatus.exts === 1, 'ext receives presence (1 phone, 1 ext)');

  // routing: phone -> ext
  phone.send(JSON.stringify({ type: 'text:update', value: 'hello laptop', origin: 'phone' }));
  await wait(120);
  const got = ext.inbox.filter((m) => m.type === 'text:update').pop();
  assert(got && got.value === 'hello laptop' && got.origin === 'phone', 'phone text relays to ext');

  // routing: ext -> phone, and NOT echoed back to ext
  ext.inbox.length = 0;
  phone.inbox.length = 0;
  ext.send(JSON.stringify({ type: 'text:update', value: 'from computer', origin: 'ext' }));
  await wait(120);
  const onPhone = phone.inbox.filter((m) => m.type === 'text:update').pop();
  assert(onPhone && onPhone.value === 'from computer', 'ext text relays to phone');
  assert(!ext.inbox.some((m) => m.type === 'text:update'), 'ext does NOT receive its own message (no echo)');

  // enter key relays
  phone.inbox.length = 0;
  ext.inbox.length = 0;
  phone.send(JSON.stringify({ type: 'key:enter' }));
  await wait(120);
  assert(ext.inbox.some((m) => m.type === 'key:enter'), 'Enter key relays phone -> ext');

  // ping/pong
  phone.inbox.length = 0;
  phone.send(JSON.stringify({ type: 'ping' }));
  await wait(100);
  assert(phone.inbox.some((m) => m.type === 'pong'), 'server answers ping with pong');

  ext.close();
  phone.close();
  await wait(100);

  console.log(failures === 0 ? '\nAll relay tests passed.' : `\n${failures} test(s) failed.`);
}

main()
  .catch((e) => { console.error(e); failures++; })
  .finally(() => {
    if (serverProc) serverProc.kill('SIGTERM');
    process.exit(failures ? 1 : 0);
  });
