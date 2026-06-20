// ES-module re-export of the shared protocol for the mobile web app.
// Keep these values in sync with ../shared/protocol.js
export const ROLE = { PHONE: 'phone', EXT: 'ext' };

export const MSG = {
  INPUT_FOCUS: 'input:focus',
  INPUT_BLUR: 'input:blur',
  TEXT_UPDATE: 'text:update',
  KEY_ENTER: 'key:enter',
  STATUS: 'status',
  PING: 'ping',
  PONG: 'pong',
};
