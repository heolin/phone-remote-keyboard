/**
 * Phone Keyboard — shared wire protocol.
 *
 * This file documents the JSON message envelope exchanged over the WebSocket
 * relay. It is written as a plain script that attaches `PK_PROTOCOL` to the
 * global object so it can be reused unchanged by:
 *   - the Node server      (require via a small shim, see server/protocol.cjs)
 *   - the extension        (loaded as the first content/background script)
 *   - the mobile web app   (imported as an ES module, see mobile/protocol.js)
 *
 * Every message is: { type: <string>, ...payload }
 *
 * Roles: a client identifies itself on connect with ?role=phone or ?role=ext.
 * The server relays phone->ext and ext->phone (never echoes to same role).
 */
(function (root) {
  const PK_PROTOCOL = {
    ROLE: {
      PHONE: 'phone',
      EXT: 'ext',
    },

    MSG: {
      // ext -> phone : an input element was focused/selected in the browser.
      // { type, value, label }  label = a human hint (placeholder/name/url)
      INPUT_FOCUS: 'input:focus',

      // ext -> phone : the selected input was deselected.
      INPUT_BLUR: 'input:blur',

      // both ways : live content of the active field changed.
      // { type, value, origin }  origin = 'phone' | 'ext'
      TEXT_UPDATE: 'text:update',

      // phone -> ext : press Enter in the active field.
      KEY_ENTER: 'key:enter',

      // server -> both : presence / connection summary.
      // { type, phones, exts }
      STATUS: 'status',

      // either -> server, server -> peers : lightweight ping for liveness.
      PING: 'ping',
      PONG: 'pong',
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PK_PROTOCOL;
  } else {
    root.PK_PROTOCOL = PK_PROTOCOL;
  }
})(typeof self !== 'undefined' ? self : this);
