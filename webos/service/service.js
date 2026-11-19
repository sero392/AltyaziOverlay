// webOS JS servisi: TCP alıcısını ve mDNS duyurusunu çalıştırır, olayları "listen" aboneliğiyle
// web uygulamasına iletir. Uygulama abone olduğu sürece (açıkken) servis canlı kalır.
'use strict';

var Service = require('webos-service');
var receiver = require('./receiver');
var mdns = require('./mdns');

var SERVICE_ID = 'com.altyazioverlay.tv.service';
var service = new Service(SERVICE_ID);

var subscribers = {};
var state = {
  listening: false,
  port: receiver.PORT,
  client: null,
  lastText: '',
  lastBox: null,
  style: null,
  ip: mdns.localIPv4(),
  error: null,
};
var started = false;
var keepAlive = null;

function broadcast(msg) {
  Object.keys(subscribers).forEach(function (k) {
    try {
      subscribers[k].respond(Object.assign({ returnValue: true, subscribed: true }, msg));
    } catch (e) {
      delete subscribers[k];
    }
  });
}

function snapshot() {
  return Object.assign({ type: 'state' }, state, { ip: mdns.localIPv4() });
}

function start() {
  if (started) {
    return;
  }
  started = true;
  // Abonelik yokken de servis kapatılmasın (uygulama arka plana alınıp geri gelebilir).
  service.activityManager.create('altyaziKeepAlive', function (activity) {
    keepAlive = activity;
  });
  receiver.createReceiver(function (ev) {
    if (ev.type === 'listening') {
      state.listening = true;
      state.port = ev.port;
      broadcast(snapshot());
    } else if (ev.type === 'client') {
      state.client = ev.connected ? ev.name : null;
      broadcast(snapshot());
    } else if (ev.type === 'sub') {
      state.lastText = ev.text;
      state.lastBox = ev.box || null;
      broadcast({ type: 'sub', text: ev.text, box: state.lastBox });
    } else if (ev.type === 'style') {
      state.style = ev.style;
      broadcast({ type: 'style', style: ev.style });
    } else if (ev.type === 'error') {
      state.error = ev.message;
      broadcast(snapshot());
    }
  });
  mdns.advertise(
    { instance: 'Altyazı TV (LG)', type: '_altyazi._tcp', port: receiver.PORT, host: 'altyazi-lg' },
    function (m) {
      console.error(m);
    },
  );
}

service.register(
  'listen',
  function (message) {
    start();
    if (message.isSubscription) {
      subscribers[message.uniqueToken] = message;
    }
    message.respond(Object.assign({ returnValue: true, subscribed: !!message.isSubscription }, snapshot()));
  },
  function (message) {
    delete subscribers[message.uniqueToken];
  },
);

service.register('stop', function (message) {
  if (keepAlive) {
    service.activityManager.complete(keepAlive, function () {});
    keepAlive = null;
  }
  message.respond({ returnValue: true });
});
