// Altyazı TV (LG webOS): seçilen HDMI girişini tam ekran gösterir, servisten gelen çeviriyi üstüne yazar.
// Eski webOS tarayıcıları için ES5.
(function () {
  'use strict';

  var SERVICE = 'luna://com.altyazioverlay.tv.service';
  var KEY_PORT = 'altyazi.hdmiPort';
  var KEY = { LEFT: 37, RIGHT: 39, ENTER: 13, BACK: 461, RED: 403 };

  var video = document.getElementById('hdmi');
  var sub = document.getElementById('sub');
  var panel = document.getElementById('panel');
  var portEl = document.getElementById('port');
  var statusEl = document.getElementById('status');
  var ipEl = document.getElementById('ip');

  var port = 1;
  try {
    port = Number(localStorage.getItem(KEY_PORT)) || 1;
  } catch (e) {}

  // ------------------------------------------------------------------ HDMI

  function showHdmi() {
    while (video.firstChild) {
      video.removeChild(video.firstChild);
    }
    var source = document.createElement('source');
    source.setAttribute('type', 'service/webos-external');
    source.setAttribute('src', 'ext://hdmi:' + port);
    video.appendChild(source);
    video.load();
    var p = video.play();
    if (p && p.catch) {
      p.catch(function () {});
    }
    portEl.textContent = String(port);
  }

  function changePort(delta) {
    port = ((port - 1 + delta + 4) % 4) + 1;
    try {
      localStorage.setItem(KEY_PORT, String(port));
    } catch (e) {}
    showHdmi();
  }

  // ------------------------------------------------------------------ altyazı

  // Android TV alıcısıyla aynı ölçek: ayardaki boyut sp, 1080p TV'de ~1.33 px/sp.
  var SP = 1.33;

  function hexToRgba(hex, opacity) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    var n = m ? parseInt(m[1], 16) : 0;
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + opacity / 100 + ')';
  }

  function applyStyle(s) {
    if (!s) {
      return;
    }
    sub.style.fontSize = Math.round(s.fontSize * SP) + 'px';
    sub.style.color = s.textColor;
    sub.style.background = hexToRgba(s.bgColor, s.bgOpacity);
    lastStyle = s;
  }

  // ------------------------------------------------------------------ konum

  var SCREEN_W = 1920;
  var SCREEN_H = 1080;
  /** Asıl altyazının üstüne yazarken arka planın en az opaklığı (%). */
  var MIN_OVER_OPACITY = 100;
  var wrap = document.getElementById('sub-wrap');
  var lastStyle = null;

  /**
   * box (İngilizce altyazının karedeki yeri, 0-1) varsa çeviri tam üstüne yazılır: kutu en az onun
   * kadar geniş/yüksek, alt kenarları hizalı, arka plan neredeyse opak. Yoksa alt orta.
   */
  function placeSub(box) {
    if (!box) {
      wrap.style.bottom = '70px';
      wrap.style.left = '0px';
      wrap.style.right = '0px';
      sub.style.minWidth = '';
      sub.style.minHeight = '';
      if (lastStyle) {
        sub.style.background = hexToRgba(lastStyle.bgColor, lastStyle.bgOpacity);
      }
      return;
    }
    var cx = (box.x + box.w / 2) * SCREEN_W;
    // Ortalanmış kutu: sarmalayıcıyı altyazı merkezine göre simetrik daralt.
    var half = Math.min(cx, SCREEN_W - cx);
    wrap.style.left = Math.round(cx - half) + 'px';
    wrap.style.right = Math.round(SCREEN_W - (cx + half)) + 'px';
    wrap.style.bottom = Math.max(0, Math.round((1 - box.y - box.h) * SCREEN_H) - 8) + 'px';
    sub.style.minWidth = Math.round(box.w * SCREEN_W) + 'px';
    sub.style.minHeight = Math.round(box.h * SCREEN_H) + 'px';
    sub.style.boxSizing = 'content-box';
    var s = lastStyle || { bgColor: '#000000', bgOpacity: 75 };
    sub.style.background = hexToRgba(s.bgColor, Math.max(s.bgOpacity, MIN_OVER_OPACITY));
  }

  function showSub(text, box) {
    sub.textContent = text || '';
    if (text) {
      placeSub(box || null);
    }
  }

  function setStatus(st) {
    if (!st.listening) {
      statusEl.textContent = st.error ? 'Hata: ' + st.error : 'Başlatılıyor…';
      statusEl.className = 'v warn';
    } else if (st.client) {
      statusEl.textContent = 'Bağlı: ' + st.client;
      statusEl.className = 'v ok';
    } else {
      statusEl.textContent = 'Telefon / bilgisayar bekleniyor';
      statusEl.className = 'v warn';
    }
    ipEl.textContent = st.ip ? st.ip + ' (port ' + st.port + ')' : '-';
  }

  // ------------------------------------------------------------------ servis (luna)

  function subscribe() {
    if (typeof window.PalmServiceBridge === 'undefined') {
      setStatus({ listening: false, error: 'webOS servis köprüsü yok (TV dışında mı çalışıyor?)' });
      return;
    }
    var bridge = new window.PalmServiceBridge();
    bridge.onservicecallback = function (raw) {
      var msg;
      try {
        msg = JSON.parse(raw);
      } catch (e) {
        return;
      }
      if (msg.returnValue === false) {
        setStatus({ listening: false, error: msg.errorText || 'servis başlatılamadı' });
        // Servis düşerse birkaç saniye sonra yeniden abone ol.
        setTimeout(subscribe, 3000);
        return;
      }
      if (msg.type === 'state') {
        setStatus(msg);
        applyStyle(msg.style);
        showSub(msg.lastText, msg.lastBox);
      } else if (msg.type === 'sub') {
        showSub(msg.text, msg.box);
      } else if (msg.type === 'style') {
        applyStyle(msg.style);
      }
    };
    bridge.call(SERVICE + '/listen', JSON.stringify({ subscribe: true }));
    window.__altyaziBridge = bridge; // çöp toplayıcı köprüyü kapatmasın
  }

  // ------------------------------------------------------------------ kumanda

  function togglePanel(show) {
    var visible = show === undefined ? panel.className.indexOf('hidden') >= 0 : show;
    panel.className = visible ? '' : 'hidden';
  }

  document.addEventListener('keydown', function (e) {
    var open = panel.className.indexOf('hidden') < 0;
    if (e.keyCode === KEY.ENTER || e.keyCode === KEY.RED) {
      togglePanel();
      e.preventDefault();
    } else if (open && (e.keyCode === KEY.LEFT || e.keyCode === KEY.RIGHT)) {
      changePort(e.keyCode === KEY.LEFT ? -1 : 1);
      e.preventDefault();
    } else if (e.keyCode === KEY.BACK) {
      if (open) {
        togglePanel(false);
        e.preventDefault();
      } else if (window.webOSSystem && window.webOSSystem.platformBack) {
        window.webOSSystem.platformBack();
      } else {
        window.close();
      }
    }
  });

  showHdmi();
  subscribe();
  // İlk açılışta panel 8 sn görünsün: kullanıcı HDMI girişini ve IP'yi görsün.
  togglePanel(true);
  setTimeout(function () {
    togglePanel(false);
  }, 8000);
})();
