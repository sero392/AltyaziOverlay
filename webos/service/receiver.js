// Telefon / bilgisayar -> TV protokolünün alıcısı (Android TV'deki ReceiverService ile aynı):
// TCP 47800 üzerinden satır satır JSON (UTF-8, "\n" ile biter):
//   {"t":"hello","name":"..."}  {"t":"sub","text":"..."} (boş = gizle)
//   {"t":"style","fontSize":30,"textColor":"#FFFFFF","bgColor":"#000000","bgOpacity":75}  {"t":"ping"}
// Aynı anda tek gönderici: yeni bağlanan eskisinin yerini alır. 15 sn ses yoksa bağlantı ölü sayılır.
// webOS'un eski Node sürümleri için ES5/ES2015.
'use strict';

var net = require('net');

var PORT = 47800;
var READ_TIMEOUT_MS = 15000;
var MAX_LINE = 64 * 1024;

/**
 * @param onEvent function({type: 'sub'|'style'|'client'|'listening'|'error', ...})
 */
function createReceiver(onEvent, port) {
  var current = null;
  var server = net.createServer(function (sock) {
    if (current) {
      current.destroy();
    }
    current = sock;
    var remote = sock.remoteAddress ? sock.remoteAddress.replace(/^::ffff:/, '') : '?';
    var name = remote;
    var buf = '';
    sock.setEncoding('utf8');
    sock.setNoDelay(true);
    sock.setTimeout(READ_TIMEOUT_MS);
    onEvent({ type: 'client', connected: true, name: name });

    sock.on('data', function (chunk) {
      buf += chunk;
      if (buf.length > MAX_LINE) {
        buf = '';
        return;
      }
      var nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        var line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) {
          continue;
        }
        var msg;
        try {
          msg = JSON.parse(line);
        } catch (e) {
          continue;
        }
        if (msg.t === 'sub') {
          onEvent({ type: 'sub', text: typeof msg.text === 'string' ? msg.text : '', box: parseBox(msg.box) });
        } else if (msg.t === 'style') {
          onEvent({
            type: 'style',
            style: {
              fontSize: Number(msg.fontSize) || 30,
              textColor: String(msg.textColor || '#FFFFFF'),
              bgColor: String(msg.bgColor || '#000000'),
              bgOpacity: msg.bgOpacity == null ? 75 : Number(msg.bgOpacity),
            },
          });
        } else if (msg.t === 'hello') {
          name = String(msg.name || remote) + ' (' + remote + ')';
          onEvent({ type: 'client', connected: true, name: name });
        }
      }
    });
    sock.on('timeout', function () {
      sock.destroy();
    });
    sock.on('error', function () {});
    sock.on('close', function () {
      if (current === sock) {
        current = null;
        onEvent({ type: 'client', connected: false, name: null });
        // Gönderici gitti: ekranda eski altyazı asılı kalmasın.
        onEvent({ type: 'sub', text: '' });
      }
    });
  });
  server.on('error', function (e) {
    onEvent({ type: 'error', message: e.message });
  });
  server.listen(port || PORT, '0.0.0.0', function () {
    onEvent({ type: 'listening', port: server.address().port });
  });
  return {
    close: function () {
      if (current) {
        current.destroy();
      }
      server.close();
    },
  };
}

module.exports = { createReceiver: createReceiver, PORT: PORT };

/**
 * İngilizce altyazının karedeki yeri ({x,y,w,h}, 0-1). Bilinmiyorsa ya da geçersizse null.
 */
function parseBox(b) {
  if (!b || typeof b !== 'object') {
    return null;
  }
  var x = Number(b.x);
  var y = Number(b.y);
  var w = Number(b.w);
  var h = Number(b.h);
  if (!(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1.01 && y + h <= 1.01)) {
    return null;
  }
  return { x: x, y: y, w: w, h: h };
}
