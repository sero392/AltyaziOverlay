import { Bonjour, Browser } from 'bonjour-service';
import { Socket } from 'node:net';
import { hostname } from 'node:os';
import { PageItem, SubtitleBox, SubtitleStyle, TvLinkState, TvStatus } from '../shared/types';

const PORT = 47800;
const CONNECT_TIMEOUT_MS = 3000;
const RETRY_DELAY_MS = 3000;
const PING_INTERVAL_MS = 5000;
/** Ekrandaki sayfa her bu kadar ping'de bir yeniden gönderilir (TV'nin kendiliğinden gizlemesine karşı). */
const PAGE_REFRESH_TICKS = 2;

/**
 * Bilgisayar -> Android TV ("Altyazı TV" alıcısı). Telefondaki TvLink.kt ile aynı protokol:
 * TCP 47800 üzerinden satır satır JSON; TV mDNS ile "_altyazi._tcp" olarak bulunur.
 *   {"t":"hello","name":"..."}  {"t":"sub","text":"..."}  {"t":"style",...}  {"t":"ping"}
 *   "sub" isteğe bağlı "box":{x,y,w,h} taşır: İngilizce altyazının karedeki yeri (0-1). Bunu bilen
 *   alıcılar çeviriyi tam üstüne yazar, bilmeyenler yok sayar.
 *   {"t":"page","items":[{"text":"...","box":{x,y,w,h}}]}: tüm sayfa çevirisi; her çeviri kendi
 *   kutusunda. Boş dizi sayfayı temizler. TV kopmaya karşı bir süre sonra kendiliğinden gizler;
 *   ekrandaki sayfa bu yüzden belli aralıklarla yeniden gönderilir.
 */
export class TvLink {
  status: TvStatus = { state: 'OFF', target: null, error: null };
  private socket: Socket | null = null;
  private connected = false;
  private bonjour: Bonjour | null = null;
  private browser: Browser | null = null;
  private manualHost: string | null = null;
  private resolvedHost: string | null = null;
  private lastText = '';
  private lastBox: SubtitleBox | null = null;
  private lastPage: PageItem[] = [];
  private style: SubtitleStyle | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private active = false;

  constructor(private readonly onStatus: (s: TvStatus) => void) {}

  /** @param host boşsa TV ağda aranır. */
  start(host: string | null, style: SubtitleStyle) {
    this.stop();
    this.active = true;
    this.style = style;
    this.manualHost = host?.trim() || null;
    let ticks = 0;
    this.pingTimer = setInterval(() => {
      this.send({ t: 'ping' });
      if (++ticks % PAGE_REFRESH_TICKS === 0 && this.lastPage.length) {
        this.send({ t: 'page', items: this.lastPage });
      }
    }, PING_INTERVAL_MS);
    this.connectOrDiscover();
  }

  stop() {
    this.active = false;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
    }
    this.retryTimer = this.pingTimer = null;
    this.stopDiscovery();
    this.closeSocket();
    this.setStatus('OFF', null, null);
  }

  /** Boş metin TV'deki altyazıyı gizler. Bağlı değilse sessizce düşer. */
  sendSubtitle(text: string, box: SubtitleBox | null = null) {
    this.lastText = text;
    this.lastBox = box;
    this.send(box ? { t: 'sub', text, box } : { t: 'sub', text });
  }

  /** Tüm sayfa çevirisi. Boş dizi TV'deki sayfayı temizler. */
  sendPage(items: PageItem[]) {
    if (!items.length && !this.lastPage.length) {
      return;
    }
    this.lastPage = items;
    this.send({ t: 'page', items });
  }

  sendStyle(style: SubtitleStyle) {
    this.style = style;
    this.send({ t: 'style', ...style });
  }

  private connectOrDiscover() {
    if (!this.active) {
      return;
    }
    const host = this.manualHost ?? this.resolvedHost;
    if (host) {
      this.connect(host);
    } else {
      this.startDiscovery();
    }
  }

  private connect(host: string) {
    this.setStatus('CONNECTING', host, null);
    const s = new Socket();
    this.socket = s;
    s.setNoDelay(true);
    s.setTimeout(CONNECT_TIMEOUT_MS);
    s.once('timeout', () => s.destroy(new Error('zaman aşımı')));
    s.connect(PORT, host, () => {
      if (this.socket !== s) {
        return;
      }
      s.setTimeout(0);
      this.connected = true;
      this.setStatus('CONNECTED', host, null);
      this.send({ t: 'hello', name: hostname() });
      if (this.style) {
        this.send({ t: 'style', ...this.style });
      }
      if (this.lastText) {
        this.sendSubtitle(this.lastText, this.lastBox);
      }
      if (this.lastPage.length) {
        this.send({ t: 'page', items: this.lastPage });
      }
    });
    s.on('error', err => this.onSocketLost(s, host, err.message));
    s.on('close', () => this.onSocketLost(s, host, 'Bağlantı koptu'));
    s.on('data', () => {});
  }

  private onSocketLost(s: Socket, host: string, message: string) {
    if (this.socket !== s) {
      return;
    }
    const wasConnected = this.connected;
    this.closeSocket();
    if (!this.active) {
      return;
    }
    if (!this.manualHost) {
      this.resolvedHost = null; // TV'nin IP'si değişmiş olabilir: yeniden ara
    }
    this.setStatus('CONNECTING', host, wasConnected ? 'Bağlantı koptu' : `TV'ye bağlanılamadı (${message})`);
    this.scheduleRetry();
  }

  private send(obj: object) {
    if (!this.socket || !this.connected) {
      return;
    }
    this.socket.write(JSON.stringify(obj) + '\n');
  }

  private scheduleRetry() {
    if (!this.active || this.retryTimer) {
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.socket) {
        this.connectOrDiscover();
      }
    }, RETRY_DELAY_MS);
  }

  private closeSocket() {
    const s = this.socket;
    this.socket = null;
    this.connected = false;
    s?.destroy();
  }

  private startDiscovery() {
    if (this.browser) {
      return;
    }
    this.setStatus('SEARCHING', null, null);
    try {
      this.bonjour ??= new Bonjour();
      this.browser = this.bonjour.find({ type: 'altyazi', protocol: 'tcp' }, service => {
        const host = service.addresses?.find(a => /^\d+\.\d+\.\d+\.\d+$/.test(a)) ?? service.referer?.address;
        if (!host || this.socket || !this.active) {
          return;
        }
        console.log(`[tv] found ${service.name} at ${host}`);
        this.resolvedHost = host;
        this.stopDiscovery();
        this.connect(host);
      });
    } catch (e) {
      this.setStatus('SEARCHING', null, `Ağda arama başlatılamadı (${(e as Error).message}); TV IP'sini elle girin`);
      this.scheduleRetry();
    }
  }

  private stopDiscovery() {
    this.browser?.stop();
    this.browser = null;
  }

  private setStatus(state: TvLinkState, target: string | null, error: string | null) {
    this.status = { state, target, error };
    this.onStatus(this.status);
  }
}
