/* Phone Keyboard — toolbar popup. Talks to the background SW over a port. */
const $ = (id) => document.getElementById(id);
const COLORS = { open: '#27c093', connecting: '#f6c945', closed: '#ef5d68' };
const LABEL = { open: 'Connected', connecting: 'Connecting…', closed: 'Disconnected' };

let port = chrome.runtime.connect({ name: 'pk-popup' });
let cfg = {};
let msgTimer = null;

port.onMessage.addListener((m) => {
  if (m.evt === 'state') {
    cfg = m.config || {};
    renderState(m);
  } else if (m.evt === 'health') {
    renderHealth(m);
  }
});

function renderState(m) {
  const enabled = cfg.enabled !== false;
  $('enabledSwitch').classList.toggle('on', enabled);
  $('body').classList.toggle('off-dim', !enabled);
  const c = COLORS[m.wsState] || COLORS.closed;
  $('dot').style.setProperty('--c', c);
  $('stext').textContent = LABEL[m.wsState] || 'Disconnected';
  // Enabled but can't reach the server → the desktop app probably isn't
  // installed/running. Point the user at the releases page.
  $('dlNotice').classList.toggle('show', enabled && m.wsState === 'closed');
  const phones = (m.presence && m.presence.phones) || 0;
  $('pcount').textContent = phones ? `${phones} phone${phones > 1 ? 's' : ''}` : 'no phone';
  if (document.activeElement !== $('host')) $('host').value = cfg.host || '127.0.0.1';
  if (document.activeElement !== $('port')) $('port').value = cfg.port || 8787;
  if (document.activeElement !== $('token')) $('token').value = cfg.token || '';
}

function renderHealth(m) {
  if (m.data && m.data.phoneURL) {
    $('phone').innerHTML = `Phone URL: <a id="copy">${m.data.phoneURL}</a>`;
    $('copy').addEventListener('click', () => {
      navigator.clipboard?.writeText(m.data.phoneURL);
      flash('Phone URL copied');
    });
  } else {
    $('phone').innerHTML = 'Phone URL: <i>server not reachable</i>';
  }
}

function flash(text, isErr) {
  $('msg').textContent = text;
  $('msg').className = isErr ? 'msg err' : 'msg';
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => ($('msg').textContent = ''), 4000);
}

$('enabledSwitch').addEventListener('click', () => {
  const turningOn = cfg.enabled === false;
  // SW persists enabled and (dis)connects; it broadcasts new state back to us.
  port.postMessage({ cmd: turningOn ? 'connect' : 'disconnect' });
  flash(turningOn ? 'Enabled' : 'Disabled');
});

$('save').addEventListener('click', () => {
  port.postMessage({
    cmd: 'setConfig',
    config: {
      host: $('host').value.trim() || '127.0.0.1',
      port: Number($('port').value) || 8787,
      token: $('token').value.trim(),
      enabled: true,
    },
  });
  flash('Saved. Reconnecting…');
});

port.postMessage({ cmd: 'getState' });
port.postMessage({ cmd: 'fetchHealth' });
