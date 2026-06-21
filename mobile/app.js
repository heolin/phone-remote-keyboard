import { h, render } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { MSG } from './protocol.js';

const html = htm.bind(h);
const HISTORY_KEY = 'pk.history.v1';
const MAX_HISTORY = 100;

// ---------------------------------------------------------------------------
// Relay (WebSocket) hook
// ---------------------------------------------------------------------------
function useRelay({ onText, onTarget }) {
  const [status, setStatus] = useState('connecting');
  const [presence, setPresence] = useState({ phones: 0, exts: 0 });
  const wsRef = useRef(null);
  const handlers = useRef({});
  handlers.current = { onText, onTarget };

  useEffect(() => {
    let stop = false;
    let retry = 0;
    let pingTimer = null;

    const sendRaw = (msg) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };

    function connect() {
      if (stop) return;
      const token = new URLSearchParams(location.search).get('token') || '';
      const url = `ws://${location.host}/ws?role=phone&token=${encodeURIComponent(token)}`;
      setStatus('connecting');
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        retry = 0;
        setStatus('open');
        clearInterval(pingTimer);
        pingTimer = setInterval(() => sendRaw({ type: MSG.PING }), 20000);
      };
      ws.onclose = () => {
        clearInterval(pingTimer);
        if (!stop) {
          setStatus('closed');
          retry++;
          setTimeout(connect, Math.min(5000, 400 * retry));
        }
      };
      ws.onerror = () => {};
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m.type === MSG.STATUS) setPresence({ phones: m.phones || 0, exts: m.exts || 0 });
        else if (m.type === MSG.TEXT_UPDATE && m.origin === 'ext') handlers.current.onText(m.value || '');
        else if (m.type === MSG.INPUT_FOCUS) handlers.current.onTarget({ label: m.label || 'text field', value: m.value || '' });
        else if (m.type === MSG.INPUT_BLUR) handlers.current.onTarget(null);
      };
    }

    connect();
    return () => { stop = true; clearInterval(pingTimer); if (wsRef.current) wsRef.current.close(); };
  }, []);

  const send = (msg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
  return { status, presence, send };
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
function App() {
  const [text, setText] = useState('');
  const [target, setTarget] = useState(null);
  const [tab, setTab] = useState('all');
  const [expanded, setExpanded] = useState({});
  const [toast, setToast] = useState('');
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
  });

  const typingRef = useRef(false);

  const relay = useRelay({
    onText: (v) => { if (!typingRef.current) setText(v); },
    onTarget: (t) => {
      setTarget(t);
      // On focus, mirror the field's current value; on blur (input disabled),
      // clear the box so stale text doesn't linger.
      setText(t ? t.value : '');
    },
  });

  useEffect(() => {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch {}
  }, [history]);

  const toastTimer = useRef(null);
  function showToast(msg) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 1600);
  }

  function onInput(e) {
    const v = e.target.value;
    typingRef.current = true;
    setText(v);
    relay.send({ type: MSG.TEXT_UPDATE, value: v, origin: 'phone' });
    clearTimeout(onInput._t);
    onInput._t = setTimeout(() => { typingRef.current = false; }, 400);
  }

  function addHistory(t) {
    setHistory((h) => [{ id: Date.now() + '-' + Math.round(Math.random() * 1e4), text: t, ts: Date.now(), starred: false }, ...h].slice(0, MAX_HISTORY));
  }

  function sendMessage(t) {
    const val = t != null ? t : text;
    relay.send({ type: MSG.TEXT_UPDATE, value: val, origin: 'phone' });
    relay.send({ type: MSG.KEY_ENTER });
    if (val.trim()) addHistory(val);
    setText('');
    relay.send({ type: MSG.TEXT_UPDATE, value: '', origin: 'phone' });
    navigator.vibrate && navigator.vibrate(15);
    showToast('Sent ✓');
  }

  function resend(item) {
    setText(item.text);
    relay.send({ type: MSG.TEXT_UPDATE, value: item.text, origin: 'phone' });
    showToast('Loaded — tap Send');
    navigator.vibrate && navigator.vibrate(10);
  }

  const toggleStar = (id) => setHistory((h) => h.map((x) => (x.id === id ? { ...x, starred: !x.starred } : x)));
  const del = (id) => setHistory((h) => h.filter((x) => x.id !== id));
  const toggleExpand = (id) => setExpanded((e) => ({ ...e, [id]: !e[id] }));
  function clearAll() {
    if (confirm('Clear all message history? Starred messages are kept.')) {
      setHistory((h) => h.filter((x) => x.starred));
      showToast('History cleared');
    }
  }

  const connected = relay.status === 'open' && relay.presence.exts > 0;
  const dotClass = relay.status !== 'open' ? (relay.status === 'closed' ? 'closed' : 'connecting') : (connected ? 'open' : 'connecting');
  const connLabel = relay.status !== 'open' ? (relay.status === 'closed' ? 'Reconnecting…' : 'Connecting…') : (connected ? 'Connected' : 'No browser');

  const list = tab === 'starred' ? history.filter((x) => x.starred) : history;
  const starredCount = history.filter((x) => x.starred).length;

  return html`
    <div class="top">
      <div class="logo"><span class="ico"></span></div>
      <h1>Phone Keyboard</h1>
      <div class="conn"><span class="dot ${dotClass}"></span>${connLabel}</div>
    </div>

    <div class="card">
      ${target
        ? html`<div class="target"><span>✏️ Typing into</span><span class="pill">${target.label}</span></div>`
        : html`<div class="target idle"><span>👆 Click a text box in your browser to start</span></div>`}

      <textarea
        placeholder=${target ? 'Type here — it appears on your laptop instantly' : 'Waiting for a text box…'}
        value=${text}
        onInput=${onInput}
        disabled=${!target}
      ></textarea>

      <div class="actions">
        <button class="btn ghost" title="Clear" disabled=${!target} onClick=${() => { setText(''); relay.send({ type: MSG.TEXT_UPDATE, value: '', origin: 'phone' }); }}>✕</button>
        <button class="btn" disabled=${relay.status !== 'open' || !target} onClick=${() => sendMessage()}>Send ⏎</button>
      </div>
    </div>

    <div class="tabs">
      <button class="tab ${tab === 'all' ? 'active' : ''}" onClick=${() => setTab('all')}>All<span class="count">${history.length}</span></button>
      <button class="tab ${tab === 'starred' ? 'active' : ''}" onClick=${() => setTab('starred')}>★ Starred<span class="count">${starredCount}</span></button>
    </div>

    <div class="hist-head">
      <h2>${tab === 'starred' ? 'Starred messages' : 'Recent messages'}</h2>
      ${tab === 'all' && history.length > 0 ? html`<button class="clear" onClick=${clearAll}>Reset</button>` : null}
    </div>

    ${list.length === 0
      ? html`<div class="empty"><span class="big">${tab === 'starred' ? '★' : '💬'}</span>${tab === 'starred' ? 'Star messages to keep them here.' : 'Sent messages will appear here.'}</div>`
      : list.map((item) => {
          const long = item.text.length > 120 || item.text.split('\n').length > 2;
          const open = expanded[item.id];
          return html`
            <div class="item" key=${item.id}>
              <div class="text ${long && !open ? 'clamp' : ''}">${item.text}</div>
              ${long ? html`<button class="more" onClick=${() => toggleExpand(item.id)}>${open ? 'Show less' : 'Show more'}</button>` : null}
              <div class="meta">
                <span class="time">${timeAgo(item.ts)}</span>
                <button class="iconbtn star ${item.starred ? 'on' : ''}" title="Star" onClick=${() => toggleStar(item.id)}>${item.starred ? '★' : '☆'}</button>
                <button class="iconbtn resend" title="Resend" onClick=${() => resend(item)}>↻</button>
                <button class="iconbtn del" title="Delete" onClick=${() => del(item.id)}>🗑</button>
              </div>
            </div>`;
        })}

    <div class="toast ${toast ? 'show' : ''}">${toast}</div>
  `;
}

function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleDateString();
}

render(html`<${App} />`, document.getElementById('app'));
