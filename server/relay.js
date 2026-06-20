'use strict';

/**
 * Phone Keyboard — relay core, as a reusable module.
 *
 * `createRelay()` returns a controllable relay (start/stop/getInfo/getLogs plus
 * 'log' and 'presence' events) with no console output of its own. Both the CLI
 * (server/index.js) and the desktop app (app/main.js) drive it.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { WebSocketServer } = require('ws');

const PK_PROTOCOL = require('../shared/protocol.js');
const { ROLE, MSG } = PK_PROTOCOL;

const MOBILE_DIR = path.join(__dirname, '..', 'mobile');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

function lanIPs() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

function isLocalhost(remoteAddr) {
  if (!remoteAddr) return false;
  return remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1';
}

function createRelay(opts = {}) {
  const emitter = new EventEmitter();
  const CONFIG_PATH = opts.configPath || process.env.PK_CONFIG || path.join(__dirname, '.pk-config.json');

  const LOG_LIMIT = 500;
  const logs = [];

  let httpServer = null;
  let wss = null;
  let running = false;
  let port = null;
  let token = loadToken();

  const phones = new Set();
  const exts = new Set();

  // --- config (token only; the port is chosen per start) --------------------
  function loadToken() {
    let saved = {};
    try {
      saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch {
      /* first run */
    }
    const t = saved.token || crypto.randomBytes(9).toString('base64url');
    if (saved.token !== t) {
      try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify({ token: t }, null, 2));
      } catch (e) {
        log('warn', `could not persist config: ${e.message}`);
      }
    }
    return t;
  }

  function log(level, msg) {
    const entry = { t: Date.now(), level, msg: String(msg) };
    logs.push(entry);
    if (logs.length > LOG_LIMIT) logs.shift();
    emitter.emit('log', entry);
  }

  // --- presence -------------------------------------------------------------
  function presence() {
    return { phones: phones.size, exts: exts.size };
  }
  function broadcast(targetSet, obj) {
    const data = JSON.stringify(obj);
    for (const client of targetSet) if (client.readyState === client.OPEN) client.send(data);
  }
  function announcePresence() {
    broadcast(phones, { type: MSG.STATUS, ...presence() });
    broadcast(exts, { type: MSG.STATUS, ...presence() });
    emitter.emit('presence', presence());
  }

  // --- static + pages -------------------------------------------------------
  function serveStatic(req, res, urlPath) {
    const clean = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(MOBILE_DIR, clean === '/' ? 'index.html' : clean);
    if (!filePath.startsWith(MOBILE_DIR)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });
  }

  function renderLogsPage() {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Phone Keyboard — server logs</title>
<style>
  :root { color-scheme: dark; }
  body { font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; background:#0b1020; color:#cdd6f4; margin:0; padding:20px; }
  h1 { font-size:16px; color:#89b4fa; margin:0 0 4px; }
  .sub { color:#6c7086; margin:0 0 16px; font-size:12px; }
  .row { padding:4px 8px; border-left:3px solid transparent; white-space:pre-wrap; word-break:break-word; }
  .info { border-color:#89b4fa20; } .warn { border-color:#f9e2af; color:#f9e2af; } .error { border-color:#f38ba8; color:#f38ba8; }
  .t { color:#6c7086; } .bar { position:sticky; top:0; background:#0b1020; padding-bottom:10px; }
  label { font-size:12px; }
</style></head>
<body>
  <div class="bar"><h1>Phone Keyboard — server logs</h1>
  <p class="sub">Live tail · refreshes every 2s · <span id="count"></span></p>
  <label><input type="checkbox" id="auto" checked> auto-scroll</label></div>
  <div id="logs"></div>
<script>
  async function tick() {
    try {
      const r = await fetch('/api/logs', { cache: 'no-store' });
      const data = await r.json();
      document.getElementById('logs').innerHTML = data.logs.map(function (e) {
        return '<div class="row ' + e.level + '"><span class="t">' + new Date(e.t).toLocaleTimeString() + '</span>  ' + e.msg.replace(/</g,'&lt;') + '</div>';
      }).join('');
      document.getElementById('count').textContent = data.logs.length + ' lines';
      if (document.getElementById('auto').checked) window.scrollTo(0, document.body.scrollHeight);
    } catch (e) {}
  }
  tick(); setInterval(tick, 2000);
</script>
</body></html>`;
  }

  function phoneURL() {
    const primary = lanIPs()[0] || 'localhost';
    return `http://${primary}:${port}/?token=${token}`;
  }

  // --- lifecycle ------------------------------------------------------------
  function start(p) {
    return new Promise((resolve, reject) => {
      if (running) {
        reject(new Error('already running'));
        return;
      }
      port = Number(p) || 8787;

      httpServer = http.createServer((req, res) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        if (url.pathname === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ ok: true, port, lanIPs: lanIPs(), phoneURL: phoneURL(), ...presence() }));
          return;
        }
        if (url.pathname === '/api/logs') {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ logs }));
          return;
        }
        if (url.pathname === '/logs') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderLogsPage());
          return;
        }
        serveStatic(req, res, url.pathname);
      });

      wss = new WebSocketServer({ server: httpServer, path: '/ws' });
      wss.on('connection', (ws, req) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const role = url.searchParams.get('role');
        const tok = url.searchParams.get('token');
        const remote = req.socket.remoteAddress;
        const local = isLocalhost(remote);

        if (role !== ROLE.PHONE && role !== ROLE.EXT) {
          log('warn', `rejected connection: bad role "${role}" from ${remote}`);
          ws.close(4000, 'bad role');
          return;
        }
        if (!local && tok !== token) {
          log('warn', `rejected ${role} from ${remote}: invalid token`);
          ws.close(4001, 'invalid token');
          return;
        }

        const set = role === ROLE.PHONE ? phones : exts;
        const peers = role === ROLE.PHONE ? exts : phones;
        set.add(ws);
        log('info', `${role} connected from ${remote} (phones=${phones.size}, exts=${exts.size})`);
        announcePresence();

        ws.on('message', (raw) => {
          let msg;
          try {
            msg = JSON.parse(raw.toString());
          } catch {
            log('warn', `dropped non-JSON message from ${role}`);
            return;
          }
          if (msg.type === MSG.PING) {
            ws.send(JSON.stringify({ type: MSG.PONG }));
            return;
          }
          broadcast(peers, msg);
        });
        ws.on('close', () => {
          set.delete(ws);
          log('info', `${role} disconnected (phones=${phones.size}, exts=${exts.size})`);
          announcePresence();
        });
        ws.on('error', (e) => log('error', `${role} socket error: ${e.message}`));
      });

      httpServer.on('error', (e) => {
        running = false;
        if (e.code === 'EADDRINUSE') reject(new Error(`Port ${port} is already in use. Pick another port.`));
        else reject(e);
      });

      httpServer.listen(port, '0.0.0.0', () => {
        running = true;
        log('info', `server listening on 0.0.0.0:${port}`);
        emitter.emit('listening', getInfo());
        resolve(getInfo());
      });
    });
  }

  function stop() {
    return new Promise((resolve) => {
      if (!running) {
        resolve();
        return;
      }
      for (const c of [...phones, ...exts]) {
        try { c.close(); } catch {}
      }
      phones.clear();
      exts.clear();
      const done = () => {
        running = false;
        log('info', 'server stopped');
        emitter.emit('stopped');
        resolve();
      };
      try {
        if (wss) wss.close();
      } catch {}
      if (httpServer) httpServer.close(done);
      else done();
      httpServer = null;
      wss = null;
    });
  }

  function getInfo() {
    return {
      running,
      port,
      token,
      lanIPs: lanIPs(),
      phoneURL: running ? phoneURL() : null,
      ...presence(),
    };
  }
  function getLogs() {
    return logs.slice();
  }
  function resetToken() {
    token = crypto.randomBytes(9).toString('base64url');
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify({ token }, null, 2));
    } catch {}
    return token;
  }

  return {
    start,
    stop,
    getInfo,
    getLogs,
    resetToken,
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    get running() {
      return running;
    },
  };
}

module.exports = { createRelay, lanIPs };
