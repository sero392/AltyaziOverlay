import { ConsoleState, DiscoveredConsole } from '../shared/types';
import { RpHelper } from './native/rpHelper';

/** Eşleşmiş konsol: oturum açmak için gereken anahtarlar (base64, kalıcı saklanır). */
export interface RegisteredConsole {
  host: string;
  nickname: string;
  ps5: boolean;
  registKey: string;
  morning: string;
  serverMac: string;
  psnAccountId: string;
}

/** Yayın ayarları. 720p/30fps altyazı ve sol üst bilgi kutusunu net okumak için yeterli. */
export const STREAM = { resolutionPreset: 3, width: 1280, height: 720, fps: 30, h265: false };

const STATES: ConsoleState[] = ['UNKNOWN', 'READY', 'STANDBY'];

/**
 * PS5'in oturum isteğini reddetme nedenleri (Android'deki SessionFailure ile aynı).
 * retryable false ise yeniden denemek işe yaramaz; kullanıcı bir şey yapmalı.
 */
export const SESSION_FAILURES: Record<number, { message: string; retryable: boolean }> = {
  0x80108b12: {
    message:
      'PS5\'te Uzaktan Oynatma etkin değil. Eşleşen hesapla PS5\'te: Ayarlar › Sistem › Uzaktan Oynatma › Uzaktan Oynatmayı Etkinleştir.',
    retryable: false,
  },
  0x80108b10: { message: 'Remote Play başka bir cihazda kullanımda.', retryable: true },
  0x80108b09: { message: 'Eşleşme geçersiz; PS5 ile yeniden eşleştirin.', retryable: false },
  0x80108b02: { message: 'PSN hesap kimliği geçersiz; yeniden eşleştirin.', retryable: false },
  0x80108b11: { message: 'PS5 sistem sürümü bu Remote Play sürümüyle uyumsuz.', retryable: false },
  0x80108b15: { message: 'PS5\'teki Remote Play servisi yanıt vermedi.', retryable: true },
};

/** CHIAKI_QUIT_REASON_STOPPED = bizim durdurmamız. */
const QUIT_REASON_STOPPED = 1;

export interface SessionListener {
  onConnected(): void;
  onDisconnected(reason: string, isError: boolean, failure: { message: string; retryable: boolean } | null): void;
  onVideo(sample: Buffer, framesLost: number): void;
}

/**
 * PS Remote Play istemcisi (chiaki-ng, altyazi-rp.exe üzerinden). Android'deki
 * RemotePlayClient + PsDiscovery karşılığı. Ses istenmez, giriş gönderilmez.
 */
export class RemotePlay {
  readonly helper = new RpHelper();
  private sessionListener: SessionListener | null = null;
  private discoveryChain: Promise<unknown> = Promise.resolve();

  constructor() {
    this.helper.on('event', msg => this.onEvent(msg));
    this.helper.on('video', (sample: Buffer, lost: number) => this.sessionListener?.onVideo(sample, lost));
    this.helper.on('exit', () => {
      const l = this.sessionListener;
      this.sessionListener = null;
      l?.onDisconnected('Remote Play yardımcısı kapandı', true, null);
    });
  }

  get available() {
    return this.helper.available;
  }

  // ------------------------------------------------------------------ keşif

  /**
   * Ağdaki PlayStation'ları arar (UDP yayın). [until] true dönerse erken biter.
   * Keşif servisi tektir; çağrılar sıraya girer.
   */
  discover(
    timeoutMs: number,
    sendHost = '255.255.255.255',
    until?: (consoles: DiscoveredConsole[]) => boolean,
    pingMs = 1000,
  ): Promise<DiscoveredConsole[]> {
    const run = () =>
      new Promise<DiscoveredConsole[]>(resolve => {
        let last: DiscoveredConsole[] = [];
        const onEvent = (msg: any) => {
          if (msg.ev === 'discover' && msg.ok === false) {
            finish();
          }
          if (msg.ev !== 'hosts') {
            return;
          }
          last = (msg.hosts as any[])
            .filter(h => h.addr)
            .map(h => ({
              host: h.addr,
              name: h.name ?? h.addr,
              hostId: h.id ?? '',
              ps5: !!h.ps5,
              state: STATES[h.state] ?? 'UNKNOWN',
            }));
          if (until?.(last)) {
            finish();
          }
        };
        const timer = setTimeout(() => finish(), timeoutMs);
        const finish = () => {
          clearTimeout(timer);
          this.helper.off('event', onEvent);
          try {
            this.helper.send('discover_stop');
          } catch {}
          resolve(last);
        };
        this.helper.on('event', onEvent);
        try {
          this.helper.send('discover', sendHost, pingMs);
        } catch {
          finish();
        }
      });
    const p = this.discoveryChain.then(run, run);
    this.discoveryChain = p.catch(() => {});
    return p;
  }

  /** Bekleme modundaki eşleşmiş konsolu uyandırır. */
  async wakeup(console: RegisteredConsole): Promise<boolean> {
    const wait = this.helper.waitFor('wakeup', 5000);
    this.helper.send('wakeup', console.host, console.ps5, console.registKey);
    const res = await wait;
    if (!res?.ok) {
      console_warn(`Wakeup failed: ${res?.error ?? 'timeout'}`);
    }
    return !!res?.ok;
  }

  // ------------------------------------------------------------------ eşleşme

  /**
   * @param accountId 8 baytlık PSN hesap kimliği, base64 (12 karakter)
   * @param pin PS5: Ayarlar › Sistem › Uzaktan Oynatma › Cihazı Bağla ekranındaki 8 haneli kod
   */
  async register(host: string, accountId: string, pin: string): Promise<RegisteredConsole> {
    if (Buffer.from(accountId, 'base64').length !== 8) {
      throw new Error('PSN hesap kimliği 8 bayt olmalı');
    }
    // Chiaki başarısızlık nedenini yalnızca loga yazar; kullanıcıya doğru ipucunu vermek için toplanır.
    const logs: string[] = [];
    const onLog = (msg: any) => msg.ev === 'log' && logs.push(String(msg.msg));
    let crashed = false;
    const onExit = () => {
      crashed = true;
    };
    this.helper.on('event', onLog);
    this.helper.once('exit', onExit);
    try {
      const wait = Promise.race([
        this.helper.waitFor('regist', 40_000),
        new Promise<null>(r => this.helper.once('exit', () => r(null))),
      ]);
      this.helper.send('regist', host, true, false, accountId, pin);
      const res = await wait;
      if (crashed) {
        throw new Error('Remote Play yardımcısı eşleştirme sırasında kapandı.');
      }
      if (!res) {
        this.helper.send('regist_stop');
        throw new Error('PS5 yanıt vermedi. PS5 açık ve aynı ağda mı?');
      }
      if (!res.ok) {
        throw new Error(describeRegistFailure(logs, res.error));
      }
      return {
        host,
        nickname: res.nickname ?? 'PS5',
        ps5: true,
        registKey: res.registKey,
        morning: res.rpKey,
        serverMac: res.serverMac ?? '',
        psnAccountId: accountId,
      };
    } finally {
      this.helper.off('event', onLog);
      this.helper.off('exit', onExit);
    }
  }

  // ------------------------------------------------------------------ yayın

  async start(console: RegisteredConsole, listener: SessionListener): Promise<boolean> {
    this.stop();
    this.sessionListener = listener;
    const wait = this.helper.waitFor('session', 5000);
    this.helper.send(
      'session',
      console.host,
      console.ps5,
      console.registKey,
      console.morning,
      console.psnAccountId,
      STREAM.resolutionPreset,
      STREAM.fps,
      STREAM.h265 ? 1 : 0,
    );
    const res = await wait;
    if (!res?.ok) {
      console_warn(`session start failed: ${res?.error ?? 'timeout'}`);
      this.sessionListener = null;
      return false;
    }
    return true;
  }

  stop() {
    this.sessionListener = null;
    try {
      this.helper.send('session_stop');
    } catch {}
  }

  requestIdr() {
    try {
      this.helper.send('idr');
    } catch {}
  }

  dispose() {
    this.sessionListener = null;
    this.helper.dispose();
  }

  private onEvent(msg: any) {
    const l = this.sessionListener;
    if (!l) {
      return;
    }
    if (msg.ev === 'connected') {
      l.onConnected();
    } else if (msg.ev === 'quit') {
      this.sessionListener = null;
      const failure = SESSION_FAILURES[msg.appReason >>> 0] ?? null;
      l.onDisconnected(msg.text ?? '', msg.reason !== QUIT_REASON_STOPPED, failure);
    }
  }
}

/** chiaki regist loglarından kullanıcıya yönelik neden çıkarır. */
function describeRegistFailure(logs: string[], error: string): string {
  const all = logs.join('\n');
  if (/timed out waiting for search response/i.test(all)) {
    return 'PS5 eşleştirme isteğine yanıt vermedi. PS5\'te Remote Play hesabıyla Ayarlar › Sistem › Uzaktan Oynatma › Cihazı Bağla ekranı açık olmalı (kod ekranda görünürken eşleştir).';
  }
  const reason = /Application Reason: (0x[0-9a-f]+)/i.exec(all)?.[1];
  if (reason) {
    const known = SESSION_FAILURES[parseInt(reason, 16) >>> 0];
    return known
      ? known.message
      : `PS5 eşleştirmeyi reddetti (${reason}). Kodu ve hesap kimliğini kontrol et; kod birkaç dakika geçerlidir.`;
  }
  if (/failed to connect|connect failed/i.test(all)) {
    return 'PS5\'e bağlanılamadı. Windows Güvenlik Duvarı uygulamayı engelliyor olabilir.';
  }
  return error === 'failed'
    ? 'Eşleştirme başarısız. Kodu ve hesap kimliğini kontrol et; kod birkaç dakika geçerlidir.'
    : `Eşleştirme başarısız: ${error}`;
}

const console_warn =(m: string) => console.warn(`[RemotePlay] ${m}`);
