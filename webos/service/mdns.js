// Küçük bir mDNS (DNS-SD) yanıtlayıcı: TV'yi ağda "_altyazi._tcp" olarak duyurur, böylece telefon
// (Android NsdManager) ve bilgisayar (bonjour-service) IP girmeden bulur. Android TV alıcısındaki
// NSD kaydının karşılığı. webOS'taki eski Node sürümleri için bağımlılıksız ve ES5/ES2015 yazıldı.
'use strict';

var dgram = require('dgram');
var os = require('os');

var MDNS_ADDR = '224.0.0.251';
var MDNS_PORT = 5353;
var TTL = 120;

function localIPv4() {
  var ifaces = os.networkInterfaces();
  var names = Object.keys(ifaces);
  for (var i = 0; i < names.length; i++) {
    var list = ifaces[names[i]] || [];
    for (var j = 0; j < list.length; j++) {
      var a = list[j];
      if (a.family === 'IPv4' && !a.internal) {
        return a.address;
      }
    }
  }
  return null;
}

function encodeName(name) {
  var parts = name.split('.').filter(function (p) { return p.length > 0; });
  var bufs = parts.map(function (p) {
    var label = Buffer.from(p, 'utf8');
    return Buffer.concat([Buffer.from([label.length]), label]);
  });
  bufs.push(Buffer.from([0]));
  return Buffer.concat(bufs);
}

function record(name, type, cls, ttl, rdata) {
  var head = Buffer.alloc(10);
  head.writeUInt16BE(type, 0);
  head.writeUInt16BE(cls, 2);
  head.writeUInt32BE(ttl, 4);
  head.writeUInt16BE(rdata.length, 8);
  return Buffer.concat([encodeName(name), head, rdata]);
}

/** Sorgu paketindeki soru adlarını (küçük harf) döndürür; sıkıştırma işaretçilerini izler. */
function parseQuestions(msg) {
  if (msg.length < 12) {
    return [];
  }
  var flags = msg.readUInt16BE(2);
  if (flags & 0x8000) {
    return []; // yanıt paketi
  }
  var qd = msg.readUInt16BE(4);
  var off = 12;
  var out = [];
  function readName(start) {
    var labels = [];
    var p = start;
    var jumped = false;
    var end = start;
    var guard = 0;
    while (p < msg.length && guard++ < 64) {
      var len = msg[p];
      if (len === 0) {
        if (!jumped) {
          end = p + 1;
        }
        break;
      }
      if ((len & 0xc0) === 0xc0) {
        if (!jumped) {
          end = p + 2;
        }
        p = ((len & 0x3f) << 8) | msg[p + 1];
        jumped = true;
        continue;
      }
      labels.push(msg.slice(p + 1, p + 1 + len).toString('utf8'));
      p += 1 + len;
    }
    return { name: labels.join('.').toLowerCase(), end: end };
  }
  for (var i = 0; i < qd && off < msg.length; i++) {
    var r = readName(off);
    out.push(r.name);
    off = r.end + 4; // tip + sınıf
  }
  return out;
}

/**
 * @param opts {instance: 'Altyazı TV (LG)', type: '_altyazi._tcp', port: 47800, host: 'altyazi-lg'}
 * @returns {{stop: function(), ip: function(): string|null}}
 */
function advertise(opts, log) {
  var type = opts.type + '.local';
  var instance = opts.instance + '.' + type;
  var host = opts.host + '.local';
  var socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  var stopped = false;

  function answer() {
    var ip = localIPv4();
    if (!ip) {
      return null;
    }
    var srv = Buffer.alloc(6);
    srv.writeUInt16BE(0, 0);
    srv.writeUInt16BE(0, 2);
    srv.writeUInt16BE(opts.port, 4);
    var records = [
      record(type, 12, 1, TTL, encodeName(instance)), // PTR
      record(instance, 33, 0x8001, TTL, Buffer.concat([srv, encodeName(host)])), // SRV
      record(instance, 16, 0x8001, TTL, Buffer.from([0])), // TXT (boş)
      record(host, 1, 0x8001, TTL, Buffer.from(ip.split('.').map(Number))), // A
    ];
    var header = Buffer.alloc(12);
    header.writeUInt16BE(0x8400, 2); // yanıt, yetkili
    header.writeUInt16BE(records.length, 6);
    return Buffer.concat([header].concat(records));
  }

  function send() {
    var pkt = answer();
    if (pkt && !stopped) {
      socket.send(pkt, 0, pkt.length, MDNS_PORT, MDNS_ADDR);
    }
  }

  socket.on('message', function (msg) {
    var names = parseQuestions(msg);
    var lt = type.toLowerCase();
    var li = instance.toLowerCase();
    var lh = host.toLowerCase();
    for (var i = 0; i < names.length; i++) {
      if (names[i] === lt || names[i] === li || names[i] === lh || names[i] === '_services._dns-sd._udp.local') {
        send();
        return;
      }
    }
  });
  socket.on('error', function (e) {
    if (log) {
      log('mdns error: ' + e.message);
    }
  });
  socket.bind(MDNS_PORT, function () {
    try {
      socket.addMembership(MDNS_ADDR);
      socket.setMulticastTTL(255);
    } catch (e) {
      if (log) {
        log('mdns membership failed: ' + e.message);
      }
    }
    // Açılış duyurusu (RFC 6762: iki kez, 1 sn arayla).
    send();
    setTimeout(send, 1000);
  });

  return {
    ip: localIPv4,
    stop: function () {
      stopped = true;
      try {
        socket.close();
      } catch (e) {}
    },
  };
}

module.exports = { advertise: advertise, localIPv4: localIPv4, parseQuestions: parseQuestions };
