/* Phone Keyboard — background service worker.
 *
 * Owns ONE WebSocket to the local relay server (as role=ext) and bridges it to:
 *   - content scripts (the bubble + input sync) via long-lived ports
 *   - the toolbar popup via long-lived ports
 *   - a native-messaging host that can start/stop the server process
 *
 * Why the WS lives here and not in the content script: a content script shares
 * the page's security context, so an https page would block an insecure ws://
 * connection (mixed content). The service worker runs in the extension origin
 * and may connect to ws://127.0.0.1 (localhost is treated as trustworthy).
 */

importScripts('/content/protocol.js');
const { ROLE, MSG } = self.PK_PROTOCOL;

const NATIVE_HOST = 'com.phonekeyboard.host';
const DEFAULT_CONFIG = { host: '127.0.0.1', port: 8787, token: '', enabled: true };

let config = { ...DEFAULT_CONFIG };
let ws = null;
let wsState = 'closed'; // 'closed' | 'connecting' | 'open'
let presence = { phones: 0, exts: 0 };
let activeTabId = null; // the tab whose input is currently selected

const contentPorts = new Map(); // tabId -> port
const popupPorts = new Set();

// --- config -----------------------------------------------------------------
async function loadConfig() {
  const stored = await chrome.storage.local.get('config');
  config = { ...DEFAULT_CONFIG, ...(stored.config || {}) };
}
async function saveConfig(patch) {
  config = { ...config, ...patch };
  await chrome.storage.local.set({ config });
}

function isLocalHost(h) {
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

// --- websocket --------------------------------------------------------------
function wsURL() {
  const params = new URLSearchParams({ role: ROLE.EXT });
  if (!isLocalHost(config.host) && config.token) params.set('token', config.token);
  return `ws://${config.host}:${config.port}/ws?${params.toString()}`;
}

function setState(state) {
  wsState = state;
  broadcast({ evt: 'state', wsState, presence, config });
}

function connect() {
  if (!config.enabled) return;
  if (ws && (wsState === 'open' || wsState === 'connecting')) return;
  try {
    setState('connecting');
    ws = new WebSocket(wsURL());
  } catch (e) {
    setState('closed');
    return;
  }
  ws.onopen = () => setState('open');
  ws.onclose = () => {
    ws = null;
    setState('closed');
  };
  ws.onerror = () => {
    // onclose will follow; keep state moving toward 'closed'
  };
  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === MSG.STATUS) {
      presence = { phones: msg.phones || 0, exts: msg.exts || 0 };
      broadcast({ evt: 'state', wsState, presence, config });
      return;
    }
    if (msg.type === MSG.PONG) return;
    // Phone -> browser messages (text updates, Enter) go to the active tab only.
    routeToActiveTab({ evt: 'msg', msg });
  };
}

function disconnect() {
  if (ws) {
    try {
      ws.close();
    } catch {
      /* noop */
    }
  }
  ws = null;
  setState('closed');
}

function wsSend(msg) {
  if (ws && wsState === 'open') {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* dropped */
    }
  }
}

// --- routing to content / popup --------------------------------------------
function broadcast(payload) {
  for (const p of contentPorts.values()) safePost(p, payload);
  for (const p of popupPorts) safePost(p, payload);
}
function routeToActiveTab(payload) {
  const port =
    (activeTabId != null && contentPorts.get(activeTabId)) ||
    // fall back to the single content port if exactly one exists
    (contentPorts.size === 1 ? [...contentPorts.values()][0] : null);
  if (port) safePost(port, payload);
}
function safePost(port, payload) {
  try {
    port.postMessage(payload);
  } catch {
    /* port closed */
  }
}

// --- native messaging (start/stop the server process) -----------------------
function native(message) {
  return new Promise((resolve) => {
    let settled = false;
    let port;
    try {
      port = chrome.runtime.connectNative(NATIVE_HOST);
    } catch (e) {
      resolve({ ok: false, error: 'native host not available' });
      return;
    }
    port.onMessage.addListener((resp) => {
      settled = true;
      resolve({ ok: true, ...resp });
      try {
        port.disconnect();
      } catch {
        /* noop */
      }
    });
    port.onDisconnect.addListener(() => {
      if (!settled) {
        const err = chrome.runtime.lastError;
        resolve({ ok: false, error: (err && err.message) || 'native host disconnected (not installed?)' });
      }
    });
    try {
      port.postMessage(message);
    } catch (e) {
      resolve({ ok: false, error: String(e) });
    }
  });
}

// --- port handling ----------------------------------------------------------
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'pk-content') {
    const tabId = port.sender && port.sender.tab && port.sender.tab.id;
    if (tabId != null) contentPorts.set(tabId, port);

    port.onMessage.addListener((m) => handleContentMessage(tabId, m));
    port.onDisconnect.addListener(() => {
      if (tabId != null) contentPorts.delete(tabId);
      if (tabId === activeTabId) activeTabId = null;
    });
    // send current state immediately
    safePost(port, { evt: 'state', wsState, presence, config });
    connect();
  } else if (port.name === 'pk-popup') {
    popupPorts.add(port);
    port.onMessage.addListener((m) => handlePopupMessage(port, m));
    port.onDisconnect.addListener(() => popupPorts.delete(port));
    safePost(port, { evt: 'state', wsState, presence, config });
    connect();
  }
});

async function handleContentMessage(tabId, m) {
  switch (m.cmd) {
    case 'wsSend':
      if (m.msg && m.msg.type === MSG.INPUT_FOCUS) activeTabId = tabId;
      if (m.msg && m.msg.type === MSG.INPUT_BLUR && tabId === activeTabId) activeTabId = null;
      wsSend(m.msg);
      break;
    case 'getState':
      broadcast({ evt: 'state', wsState, presence, config });
      break;
    case 'fetchHealth': {
      const port = contentPorts.get(tabId);
      const h = await fetchHealth();
      if (port) safePost(port, { evt: 'health', ...h });
      break;
    }
    default:
      await handleCommon(m);
  }
}

async function handlePopupMessage(port, m) {
  if (m.cmd === 'getState') {
    safePost(port, { evt: 'state', wsState, presence, config });
    return;
  }
  if (m.cmd === 'fetchHealth') {
    safePost(port, { evt: 'health', ...(await fetchHealth()) });
    return;
  }
  await handleCommon(m, port);
}

async function fetchHealth() {
  try {
    const r = await fetch(`http://${config.host}:${config.port}/health`, { cache: 'no-store' });
    return { data: await r.json() };
  } catch (e) {
    return { error: String(e) };
  }
}

async function handleCommon(m, replyPort) {
  switch (m.cmd) {
    case 'setConfig':
      await saveConfig(m.config || {});
      disconnect();
      connect();
      broadcast({ evt: 'state', wsState, presence, config });
      break;
    case 'connect':
      await saveConfig({ enabled: true });
      connect();
      break;
    case 'disconnect':
      await saveConfig({ enabled: false });
      disconnect();
      break;
    case 'openLogs':
      chrome.tabs.create({ url: `http://${config.host}:${config.port}/logs` });
      break;
    case 'nativeStart': {
      const r = await native({ cmd: 'start', port: config.port });
      if (replyPort) safePost(replyPort, { evt: 'native', action: 'start', result: r });
      else broadcast({ evt: 'native', action: 'start', result: r });
      setTimeout(connect, 800);
      break;
    }
    case 'nativeStop': {
      const r = await native({ cmd: 'stop' });
      if (replyPort) safePost(replyPort, { evt: 'native', action: 'stop', result: r });
      else broadcast({ evt: 'native', action: 'stop', result: r });
      break;
    }
    case 'nativeStatus': {
      const r = await native({ cmd: 'status' });
      if (replyPort) safePost(replyPort, { evt: 'native', action: 'status', result: r });
      else broadcast({ evt: 'native', action: 'status', result: r });
      break;
    }
  }
}

// --- keep-alive + reconnect -------------------------------------------------
chrome.alarms.create('pk-keepalive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name !== 'pk-keepalive') return;
  if (!config.enabled) return;
  if (wsState === 'open') wsSend({ type: MSG.PING });
  else connect();
});

chrome.runtime.onStartup.addListener(async () => {
  await loadConfig();
  connect();
});
chrome.runtime.onInstalled.addListener(async () => {
  await loadConfig();
  connect();
});

// Initial boot (covers the case where the SW is spun up by a port connection).
loadConfig().then(connect);
