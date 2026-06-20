'use strict';
const $ = (id) => document.getElementById(id);

let lastURL = null;

function fmtTime(t) { return new Date(t).toLocaleTimeString(); }

function render(state) {
  const running = !!state.running;
  $('dot').classList.toggle('on', running);
  $('stext').textContent = running ? `Running on port ${state.port}` : 'Stopped';

  const phones = state.phones || 0;
  const exts = state.exts || 0;
  $('conn').textContent = running ? `${phones} phone · ${exts} browser` : '';

  const toggle = $('toggle');
  toggle.textContent = running ? 'Stop' : 'Start';
  toggle.classList.toggle('stop', running);

  if (document.activeElement !== $('port') && state.port) $('port').value = state.port;

  $('openLogs').disabled = !running;

  // QR + URL
  $('qrCard').hidden = !running;
  if (running && state.phoneURL) {
    $('url').textContent = state.phoneURL;
    if (state.phoneURL !== lastURL) {
      lastURL = state.phoneURL;
      window.pk.qr(state.phoneURL).then((data) => { if (data) $('qr').src = data; });
    }
  } else {
    lastURL = null;
  }

  if (state.error) showMsg(state.error, true);
}

let msgTimer = null;
function showMsg(text, isErr) {
  $('msg').textContent = text;
  $('msg').className = isErr ? 'msg err' : 'msg';
  clearTimeout(msgTimer);
  if (text) msgTimer = setTimeout(() => { $('msg').textContent = ''; }, 5000);
}

// --- logs ---
function appendLog(e) {
  const box = $('logs');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 30;
  const span = document.createElement('span');
  span.className = e.level;
  span.textContent = `${fmtTime(e.t)}  ${e.msg}\n`;
  box.appendChild(span);
  while (box.childNodes.length > 400) box.removeChild(box.firstChild);
  if (atBottom) box.scrollTop = box.scrollHeight;
}

// --- wire up ---
$('toggle').addEventListener('click', async () => {
  const running = $('toggle').textContent === 'Stop';
  $('toggle').disabled = true;
  showMsg(running ? 'Stopping…' : 'Starting…');
  const res = running ? await window.pk.stop() : await window.pk.start(Number($('port').value) || 8787);
  $('toggle').disabled = false;
  if (res && res.error) showMsg(res.error, true);
  else showMsg(res && res.running ? 'Server started.' : 'Server stopped.');
  render(res);
});

$('copy').addEventListener('click', () => {
  if (lastURL) { window.pk.copy(lastURL); showMsg('Phone URL copied.'); }
});
$('openLogs').addEventListener('click', () => window.pk.openLogs());
$('resetToken').addEventListener('click', async () => {
  const s = await window.pk.resetToken();
  showMsg('New token generated — rescan the QR on your phone.');
  render(s);
});
$('logsToggle').addEventListener('click', () => {
  const body = $('logsBody');
  body.hidden = !body.hidden;
  $('logsToggle').textContent = body.hidden ? 'Technical details ▾' : 'Technical details ▴';
});

window.pk.onState(render);
window.pk.onLog(appendLog);

(async () => {
  const info = await window.pk.getInfo();
  render(info);
  const logs = await window.pk.getLogs();
  logs.forEach(appendLog);
})();
