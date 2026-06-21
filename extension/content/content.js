/* Phone Keyboard — content script.
 *
 * Two jobs:
 *   1) Render a floating, draggable bubble (in a shadow root so page CSS can't
 *      touch it) that shows server status and exposes config + start/stop/logs.
 *   2) Track the input the user selects, mirror text to/from the phone in real
 *      time, and inject a real "Enter" when the phone asks.
 */
(function () {
  if (window.__pkContentLoaded) return;
  window.__pkContentLoaded = true;

  const { MSG } = window.PK_PROTOCOL;

  // ---- connection to the background service worker -------------------------
  let port = null;
  let state = { wsState: 'closed', presence: { phones: 0, exts: 0 }, config: {} };
  let enabled = true; // whole-component on/off, mirrored from config.enabled

  function connectPort() {
    port = chrome.runtime.connect({ name: 'pk-content' });
    port.onMessage.addListener(onBgMessage);
    port.onDisconnect.addListener(() => {
      port = null;
      // SW was recycled; reconnect shortly.
      setTimeout(connectPort, 500);
    });
  }

  function send(cmd, extra) {
    if (!port) return;
    try {
      port.postMessage({ cmd, ...extra });
    } catch {
      /* port died; will reconnect */
    }
  }
  function wsSend(msg) {
    send('wsSend', { msg });
  }

  function onBgMessage(m) {
    if (m.evt === 'state') {
      state = m;
      enabled = state.config.enabled !== false;
      renderStatus();
      renderEnabled();
    } else if (m.evt === 'health') {
      onHealth(m);
    } else if (m.evt === 'msg') {
      onServerMessage(m.msg);
    } else if (m.evt === 'native') {
      onNativeResult(m);
    }
  }

  // ========================================================================
  //  Input selection + sync
  // ========================================================================
  let activeEl = null;
  let lastSentValue = null;
  let syncTimer = null;
  let prevOutline = null; // saved inline outline of the highlighted field

  // Visually mark the field that's under phone control. We stash the field's
  // own inline outline first so we can restore it exactly on deselect.
  function applyHighlight(el) {
    prevOutline = { outline: el.style.outline, offset: el.style.outlineOffset };
    el.style.outline = '2px solid #dfecff'; // light blue, matches the bubble
    el.style.outlineOffset = '2px';
  }
  function clearHighlight() {
    if (activeEl && prevOutline) {
      activeEl.style.outline = prevOutline.outline;
      activeEl.style.outlineOffset = prevOutline.offset;
    }
    prevOutline = null;
  }

  function isEditable(el) {
    if (!el || el.disabled || el.readOnly) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') {
      const t = (el.type || 'text').toLowerCase();
      return ['text', 'search', 'email', 'url', 'tel', 'password', 'number', ''].includes(t);
    }
    if (el.isContentEditable) return true;
    return false;
  }

  function getValue(el) {
    return el.isContentEditable ? el.innerText : el.value;
  }

  // Set a value in a way React/Vue controlled components actually notice.
  function setValue(el, value) {
    if (el.isContentEditable) {
      el.innerText = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
      return;
    }
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function pressEnter(el) {
    const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    const down = new KeyboardEvent('keydown', opts);
    el.dispatchEvent(down);
    el.dispatchEvent(new KeyboardEvent('keypress', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
    // Many forms submit on Enter via the form, not a key handler.
    const form = el.form;
    if (form && !down.defaultPrevented && !el.isContentEditable) {
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
    }
  }

  function labelFor(el) {
    return (
      el.getAttribute?.('aria-label') ||
      el.getAttribute?.('placeholder') ||
      el.getAttribute?.('name') ||
      el.tagName.toLowerCase()
    );
  }

  function selectElement(el) {
    if (activeEl === el) return;
    // Switching straight from another field: clean it up first.
    if (activeEl) {
      clearHighlight();
      activeEl.removeEventListener('input', onLocalInput);
    }
    activeEl = el;
    lastSentValue = getValue(el);
    applyHighlight(el);
    wsSend({ type: MSG.INPUT_FOCUS, value: lastSentValue, label: labelFor(el) });
    showDeselect();
    positionDeselect();
    el.addEventListener('input', onLocalInput);
  }

  function deselect() {
    if (!activeEl) return;
    clearHighlight();
    activeEl.removeEventListener('input', onLocalInput);
    activeEl = null;
    lastSentValue = null;
    hideDeselect();
    wsSend({ type: MSG.INPUT_BLUR });
  }

  function onLocalInput() {
    if (!activeEl) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      const v = getValue(activeEl);
      if (v === lastSentValue) return;
      lastSentValue = v;
      wsSend({ type: MSG.TEXT_UPDATE, value: v, origin: 'ext' });
    }, 60);
  }

  function onServerMessage(msg) {
    if (!activeEl) return;
    if (msg.type === MSG.TEXT_UPDATE && msg.origin === 'phone') {
      lastSentValue = msg.value;
      setValue(activeEl, msg.value);
    } else if (msg.type === MSG.KEY_ENTER) {
      pressEnter(activeEl);
    }
  }

  // Clicking an input selects it for phone control.
  document.addEventListener(
    'focusin',
    (e) => {
      if (!enabled) return;
      const el = e.target;
      if (isEditable(el) && !isOurNode(el)) selectElement(el);
    },
    true
  );

  // ---- the small "deselect" tag pinned to the active input -----------------
  let deselectEl = null;
  function ensureDeselect() {
    if (deselectEl) return;
    deselectEl = document.createElement('div');
    deselectEl.id = 'pk-deselect';
    Object.assign(deselectEl.style, {
      position: 'fixed',
      zIndex: '2147483646',
      width: '22px',
      height: '22px',
      borderRadius: '50%',
      background: '#6c5ce7',
      color: '#fff',
      font: '600 13px/22px system-ui, sans-serif',
      textAlign: 'center',
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(108,92,231,.5)',
      display: 'none',
      userSelect: 'none',
      transition: 'transform .12s ease',
    });
    deselectEl.textContent = '×';
    deselectEl.title = 'Stop typing here from your phone';
    deselectEl.addEventListener('mouseenter', () => (deselectEl.style.transform = 'scale(1.15)'));
    deselectEl.addEventListener('mouseleave', () => (deselectEl.style.transform = 'scale(1)'));
    deselectEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      deselect();
    });
    document.documentElement.appendChild(deselectEl);
  }
  function showDeselect() {
    ensureDeselect();
    deselectEl.style.display = 'block';
  }
  function hideDeselect() {
    if (deselectEl) deselectEl.style.display = 'none';
  }
  function positionDeselect() {
    if (!activeEl || !deselectEl || deselectEl.style.display === 'none') return;
    const r = activeEl.getBoundingClientRect();
    // Inside the field, on the right, vertically centered (icon is 22px).
    deselectEl.style.left = `${Math.min(r.right - 28, window.innerWidth - 28)}px`;
    deselectEl.style.top = `${r.top + r.height / 2 - 11}px`;
  }
  window.addEventListener('scroll', positionDeselect, true);
  window.addEventListener('resize', positionDeselect);

  function isOurNode(el) {
    return el === deselectEl || (hostEl && (el === hostEl || hostEl.contains(el)));
  }

  // ========================================================================
  //  Floating bubble (shadow DOM)
  // ========================================================================
  let hostEl = null;
  let shadow = null;
  let refs = {};

  const STYLE = `
    :host { all: initial; }
    .fab {
      position: fixed; z-index: 2147483647; width: 56px; height: 56px;
      border-radius: 50%; cursor: grab; display: grid; place-items: center;
      background: radial-gradient(circle at 50% 35%, #a78bff 0%, #6d4af0 100%);
      color: #fff; border: 2px solid #e9e1ff;
      box-shadow: 0 8px 24px rgba(124,92,255,.35);
      transition: transform .12s ease, background .12s ease;
      touch-action: none; user-select: none;
    }
    .fab:hover { transform: scale(1.05); }
    .fab:active { cursor: grabbing; }
    /* white keyboard glyph, recolored from the black PNG via a CSS mask */
    .ico {
      display: inline-block; flex: none; width: 24px; height: 24px;
      background-color: #fff;
      -webkit-mask: var(--ico) center / contain no-repeat;
      mask: var(--ico) center / contain no-repeat;
    }
    .ring {
      position: absolute; inset: -4px; border-radius: 50%;
      border: 2px solid var(--c, #f6c945); opacity: .85;
      animation: pulse 2s infinite ease-in-out;
    }
    @keyframes pulse { 0%,100%{ transform: scale(1); opacity:.7 } 50%{ transform: scale(1.1); opacity:.25 } }
    .panel {
      position: fixed; z-index: 2147483647; width: 300px; max-width: calc(100vw - 24px);
      background: #ffffff; color: #20223a; border-radius: 16px;
      box-shadow: 0 18px 50px rgba(20,22,58,.28); padding: 16px;
      font: 14px/1.45 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      transform-origin: bottom right; opacity: 0; transform: scale(.92) translateY(8px);
      pointer-events: none; transition: opacity .16s ease, transform .16s ease;
    }
    .panel.open { opacity: 1; transform: scale(1) translateY(0); pointer-events: auto; }
    .hdr { display:flex; align-items:center; gap:10px; margin-bottom: 12px; }
    .title { font-size: 15px; font-weight: 700; flex: 1; }
    /* minimalist on/off switch in the header */
    .toggle { position:relative; flex:none; width:34px; height:18px; padding:0; border:0;
      border-radius:999px; cursor:pointer; background:#cdd2e0; transition:background .15s; }
    .toggle::after { content:""; position:absolute; top:2px; left:2px; width:14px; height:14px;
      border-radius:50%; background:#fff; box-shadow:0 1px 2px rgba(0,0,0,.3); transition:transform .15s; }
    .toggle.on { background:#27c093; }
    .toggle.on::after { transform:translateX(16px); }
    .x { cursor:pointer; color:#9aa0b4; font-size:18px; line-height:1; }
    .x:hover { color:#20223a; }
    .basic { margin-bottom: 4px; }
    .more { display:flex; align-items:center; justify-content:center; gap:6px; width:100%;
      margin-top:8px; padding:6px; background:none; border:0; color:#9aa0b4; font-size:11px; cursor:pointer; }
    .more:hover { color:#20223a; }
    .more-ico { font-size:13px; }
    .extra { display:none; margin-top:8px; padding-top:12px; border-top:1px solid #e2e4ee; }
    .extra.open { display:block; }
    .status { display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:10px;
              background:#f4f5fb; }
    .dot { width:10px; height:10px; border-radius:50%; background:var(--c,#f6c945);
           box-shadow:0 0 0 4px color-mix(in srgb, var(--c,#f6c945) 25%, transparent); }
    .status small { color:#6b7088; margin-left:auto; }
    label { display:block; font-size:12px; color:#6b7088; margin:8px 0 3px; }
    input[type=text], input[type=number] {
      width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid #e2e4ee;
      border-radius:9px; font-size:14px; outline:none; transition:border-color .12s; background:#fff; color:#20223a;
    }
    input:focus { border-color:#7c5cff; }
    .grid2 { display:grid; grid-template-columns: 1fr 90px; gap:8px; }
    .row { display:flex; gap:8px; margin-top:12px; }
    button {
      flex:1; border:0; border-radius:10px; padding:9px 10px; font-size:13px; font-weight:600;
      cursor:pointer; transition: filter .12s, transform .06s; color:#fff;
    }
    button:active { transform: scale(.97); }
    .b-primary { background: linear-gradient(135deg,#7c5cff,#5b8def); }
    button:hover { filter: brightness(1.04); }
    .phone { margin-top:12px; padding:10px; border-radius:10px; background:#f4f5fb; font-size:12px; word-break:break-all; }
    .phone a { color:#5b8def; text-decoration:none; }
    .msg { margin-top:10px; font-size:12px; color:#6b7088; min-height:14px; }
    .msg:empty { margin-top:0; min-height:0; }
    .msg.err { color:#d6455d; }
    .hint { font-size:11px; color:#9aa0b4; margin-top:10px; }
  `;

  const COLORS = { open: '#27c093', connecting: '#f6c945', closed: '#ef5d68' };
  const LABEL = { open: 'Connected', connecting: 'Connecting…', closed: 'Disconnected' };

  function buildBubble() {
    hostEl = document.createElement('div');
    hostEl.id = 'pk-bubble-host';
    shadow = hostEl.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    shadow.appendChild(style);

    const fab = document.createElement('div');
    fab.className = 'fab';
    fab.innerHTML = `<span class="ring"></span><span class="ico"></span>`;
    // Point the CSS mask at the bundled keyboard artwork (recolored white).
    const iconURL = chrome.runtime.getURL('icons/keyboard.png');
    fab.querySelector('.ico').style.setProperty('--ico', `url("${iconURL}")`);

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <div class="hdr">
        <b class="title">Phone Keyboard</b>
        <button class="toggle" data-toggle title="Turn off"></button>
        <span class="x" data-x>✕</span>
      </div>
      <div class="basic" data-basic>
        <div class="status"><span class="dot" data-dot></span><span data-stext>Disconnected</span><small data-pcount></small></div>
      </div>
      <button class="more" data-more><span class="more-ico">⚙</span> more settings</button>
      <div class="extra" data-extra>
        <label>Server address</label>
        <div class="grid2">
          <input type="text" data-host placeholder="127.0.0.1">
          <input type="number" data-port placeholder="8787">
        </div>
        <label>Token (only if server is on another machine)</label>
        <input type="text" data-token placeholder="optional">
        <div class="row"><button class="b-primary" data-save>Save & reconnect</button></div>
        <div class="phone" data-phone>Phone URL: <i>start the server…</i></div>
        <div class="hint">Tip: click any text box on the page, then type from your phone.</div>
      </div>
      <div class="msg" data-msg></div>
    `;

    shadow.appendChild(fab);
    shadow.appendChild(panel);
    document.documentElement.appendChild(hostEl);

    refs = {
      fab,
      panel,
      ring: fab.querySelector('.ring'),
      toggle: panel.querySelector('[data-toggle]'),
      more: panel.querySelector('[data-more]'),
      extra: panel.querySelector('[data-extra]'),
      dot: panel.querySelector('[data-dot]'),
      stext: panel.querySelector('[data-stext]'),
      pcount: panel.querySelector('[data-pcount]'),
      host: panel.querySelector('[data-host]'),
      port: panel.querySelector('[data-port]'),
      token: panel.querySelector('[data-token]'),
      phone: panel.querySelector('[data-phone]'),
      msg: panel.querySelector('[data-msg]'),
    };

    wireBubble(fab, panel);
    restorePosition(fab);
    renderEnabled();
  }

  function wireBubble(fab, panel) {
    // drag vs click detection
    let dragging = false;
    let moved = false;
    let startX = 0, startY = 0, originX = 0, originY = 0;

    fab.addEventListener('pointerdown', (e) => {
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      const r = fab.getBoundingClientRect();
      originX = r.left;
      originY = r.top;
      fab.setPointerCapture(e.pointerId);
    });
    fab.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      if (moved) {
        const x = Math.max(4, Math.min(window.innerWidth - 56, originX + dx));
        const y = Math.max(4, Math.min(window.innerHeight - 56, originY + dy));
        fab.style.left = x + 'px';
        fab.style.top = y + 'px';
        fab.style.right = 'auto';
        fab.style.bottom = 'auto';
        positionPanel();
      }
    });
    fab.addEventListener('pointerup', (e) => {
      dragging = false;
      try { fab.releasePointerCapture(e.pointerId); } catch {}
      if (moved) {
        savePosition(fab);
      } else {
        togglePanel();
      }
    });

    panel.querySelector('[data-x]').addEventListener('click', () => closePanel());

    // header on/off toggle drives the SW connect/disconnect (persists enabled)
    refs.toggle.addEventListener('click', () => {
      enabled = !enabled;
      renderEnabled();
      if (enabled) {
        send('connect');
      } else {
        send('disconnect');
        deselect();
      }
    });

    // basic ⇄ extra settings
    refs.more.addEventListener('click', () => {
      const open = refs.extra.classList.toggle('open');
      refs.more.innerHTML = open
        ? '<span class="more-ico">⚙</span> less settings'
        : '<span class="more-ico">⚙</span> more settings';
      positionPanel();
    });

    refs.host.value = '';
    panel.querySelector('[data-save]').addEventListener('click', () => {
      const cfg = {
        host: refs.host.value.trim() || '127.0.0.1',
        port: Number(refs.port.value) || 8787,
        token: refs.token.value.trim(),
        enabled: true,
      };
      send('setConfig', { config: cfg });
      flash('Saved. Reconnecting…');
    });
  }

  function renderEnabled() {
    if (!refs.toggle) return;
    refs.toggle.classList.toggle('on', enabled);
    refs.toggle.title = enabled ? 'Turn off' : 'Turn on';
    refs.toggle.setAttribute('aria-pressed', String(enabled));
  }

  let panelOpen = false;
  function togglePanel() {
    panelOpen ? closePanel() : openPanel();
  }
  function openPanel() {
    panelOpen = true;
    // hydrate fields from config
    refs.host.value = state.config.host || '127.0.0.1';
    refs.port.value = state.config.port || 8787;
    refs.token.value = state.config.token || '';
    positionPanel();
    refs.panel.classList.add('open');
    send('fetchHealth');
  }
  function closePanel() {
    panelOpen = false;
    refs.panel.classList.remove('open');
  }
  function positionPanel() {
    const r = refs.fab.getBoundingClientRect();
    const GAP = 10, pw = 300, ph = refs.panel.offsetHeight || 420;
    // Launcher in the top half → panel below it; bottom half → panel above it.
    const below = r.top + r.height / 2 < window.innerHeight / 2;
    let top = below ? r.bottom + GAP : r.top - ph - GAP;
    top = Math.max(8, Math.min(top, window.innerHeight - ph - 8));
    let left = Math.max(8, Math.min(r.right - pw, window.innerWidth - pw - 8));
    refs.panel.style.left = left + 'px';
    refs.panel.style.top = top + 'px';
  }

  function renderStatus() {
    if (!refs.dot) return;
    const c = COLORS[state.wsState] || COLORS.closed;
    refs.ring.style.setProperty('--c', c);
    refs.dot.style.setProperty('--c', c);
    refs.stext.textContent = LABEL[state.wsState] || 'Disconnected';
    const phones = state.presence?.phones || 0;
    refs.pcount.textContent = phones ? `${phones} phone${phones > 1 ? 's' : ''}` : 'no phone';
  }

  function onHealth(m) {
    if (!refs.phone) return;
    if (m.data && m.data.phoneURL) {
      refs.phone.innerHTML = `Phone URL: <a href="#" data-copy>${m.data.phoneURL}</a>`;
      refs.phone.querySelector('[data-copy]').addEventListener('click', (e) => {
        e.preventDefault();
        navigator.clipboard?.writeText(m.data.phoneURL);
        flash('Phone URL copied');
      });
    } else {
      refs.phone.innerHTML = 'Phone URL: <i>server not reachable</i>';
    }
  }

  function onNativeResult(m) {
    const r = m.result || {};
    if (r.ok) flash(r.message || `${m.action} ok`);
    else flash(r.error || `${m.action} failed`, true);
    if (m.action === 'start') setTimeout(() => send('fetchHealth'), 1000);
  }

  let flashTimer = null;
  function flash(text, isErr) {
    if (!refs.msg) return;
    refs.msg.textContent = text;
    refs.msg.className = isErr ? 'msg err' : 'msg';
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (refs.msg.textContent = ''), 4000);
  }

  async function restorePosition(fab) {
    try {
      const { bubblePos } = await chrome.storage.local.get('bubblePos');
      if (bubblePos) {
        fab.style.left = bubblePos.x + 'px';
        fab.style.top = bubblePos.y + 'px';
        fab.style.right = 'auto';
        fab.style.bottom = 'auto';
      } else {
        fab.style.right = '20px';
        fab.style.bottom = '20px';
      }
    } catch {
      fab.style.right = '20px';
      fab.style.bottom = '20px';
    }
  }
  function savePosition(fab) {
    const r = fab.getBoundingClientRect();
    chrome.storage.local.set({ bubblePos: { x: r.left, y: r.top } });
  }

  // ---- boot ---------------------------------------------------------------
  connectPort();
  if (document.body) buildBubble();
  else window.addEventListener('DOMContentLoaded', buildBubble);

  // keep the deselect tag glued to a moving layout
  setInterval(positionDeselect, 500);
})();
