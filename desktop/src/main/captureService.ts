import { OcrSettings, PipelineDiag, SessionState } from '../shared/types';
import { OcrHelper } from './native/ocrHelper';
import { RegionLayout } from './pipeline/regionLayout';
import { SubtitleEvent, SubtitlePipeline } from './pipeline/subtitlePipeline';
import { RegisteredConsole, RemotePlay } from './remotePlay';

const RETRY_DELAYS_MS = [2000, 5000, 10000, 30000];
const SEARCH_MS = 3000;
const PROBE_MS = 2000;
const WAKE_TIMEOUT_MS = 60000;
const POST_WAKE_SETTLE_MS = 3000;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Çözücü penceresinin ayarları: tam kare verir, alanlar ana süreçte kesilir. */
export interface DecoderConfig {
  intervalMs: number;
}

/**
 * Çözücü tam kareyi verir; yalnızca kullanıcının seçtiği okuma alanları kesilip okunur.
 */
export function decoderSettings(cfg: OcrSettings): DecoderConfig {
  return { intervalMs: cfg.intervalMs };
}

export interface CaptureHost {
  loadConsole(): RegisteredConsole | null;
  saveConsole(c: RegisteredConsole): void;
  ocrSettings(): OcrSettings;
  /** Video örneklerini çözücü penceresine iletir. */
  onVideo(sample: Buffer, framesLost: number): void;
  /** Çözücüyü sıfırlar (yeni oturum) ve kırpma ayarlarını verir. */
  resetDecoder(cfg: DecoderConfig | null): void;
  updateDecoder(cfg: DecoderConfig): void;
  onSubtitle(ev: SubtitleEvent): void;
  /** İlk kez okunan altyazı (onaysız): çeviri erkenden başlatılabilir. */
  onCandidate?(text: string): void;
  onState(s: SessionState): void;
}

/**
 * PS5 Remote Play yayınını alıp OCR hattına veren servis. Android'deki RemotePlayService +
 * ConsolePreparer karşılığı:
 *  - bağlanmadan önce konsolu ağda bulur (IP değiştiyse kaydı günceller), uyuyorsa uyandırır,
 *  - bağlantı koparsa artan aralıklarla yeniden bağlanır; sadece kullanıcı durdurunca biter,
 *  - PS5 yeniden denemenin işe yaramayacağı bir nedenle reddederse durur ve nedeni söyler.
 */
export class CaptureService {
  private pipeline: SubtitlePipeline | null = null;
  private layout: RegionLayout | null = null;
  private console: RegisteredConsole | null = null;
  private stopping = true;
  private retryAttempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private videoSamples = 0;
  decoderErrors = 0;
  state: SessionState = { running: false, starting: false, connected: false, status: '', error: null };

  /** Hattın tanılama sayaçları (yalnızca çalışırken). */
  diagnostics(): PipelineDiag | null {
    const p = this.pipeline;
    if (!this.state.running || !p) {
      return null;
    }
    return { videoSamples: this.videoSamples, decoderErrors: this.decoderErrors, ...p.stats };
  }

  constructor(
    private readonly rp: RemotePlay,
    private readonly ocr: OcrHelper,
    private readonly host: CaptureHost,
  ) {}

  get running() {
    return this.state.running;
  }

  start() {
    if (this.state.running) {
      return;
    }
    const stored = this.host.loadConsole();
    if (!stored) {
      this.setState({ running: false, starting: false, connected: false, status: '', error: 'Önce PS5 ile eşleştirin' });
      return;
    }
    if (!this.rp.available) {
      this.setState({ ...this.state, error: 'Remote Play yardımcısı bulunamadı (npm run build:native)' });
      return;
    }
    this.console = stored;
    this.stopping = false;
    this.retryAttempt = 0;
    this.videoSamples = 0;
    this.decoderErrors = 0;
    this.generation++;
    const cfg = this.host.ocrSettings();
    this.ocr.start();
    this.pipeline = this.createPipeline(cfg);
    this.host.resetDecoder(decoderSettings(cfg));
    this.setState({ running: true, starting: true, connected: false, status: 'Başlatılıyor…', error: null });
    void this.connect(this.generation);
  }

  stop() {
    if (!this.state.running) {
      return;
    }
    this.stopping = true;
    this.generation++;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.rp.stop();
    this.pipeline?.close();
    this.pipeline = null;
    this.host.resetDecoder(null);
    this.host.onSubtitle({ text: '', frameId: -1, ocrLatencyMs: 0, timestamp: Date.now() });
    this.setState({ running: false, starting: false, connected: false, status: '', error: null });
  }

  /** Okuma ayarı yayın sürerken değişti: çözücü ve hat yeni alanla devam eder. */
  updateOcr(cfg: OcrSettings) {
    const p = this.pipeline;
    if (!p) {
      return;
    }
    p.config.regions = cfg.regions;
    this.host.updateDecoder(decoderSettings(cfg));
  }

  private createPipeline(cfg: OcrSettings): SubtitlePipeline {
    return new SubtitlePipeline(
      { regions: cfg.regions, stableFrames: 2, similarityThreshold: 0.8 },
      this.ocr,
      ev => this.host.onSubtitle(ev),
      text => this.host.onCandidate?.(text),
    );
  }

  /** Çözücü penceresinden gelen gri tam kare: yalnızca okuma alanları kesilip okunur. */
  onFrame(gray: Uint8Array, w: number, h: number) {
    const p = this.pipeline;
    if (p?.isReady()) {
      let layout = this.layout;
      if (!layout?.matches(p.config.regions, w, h)) {
        layout = this.layout = new RegionLayout(p.config.regions, w, h);
      }
      p.onFrame(layout.compose(gray), layout);
    }
  }

  /** Çözücü hazırken OCR meşgulse kare kopyalamaya gerek yok. */
  isReady() {
    return this.pipeline?.isReady() ?? false;
  }

  // ------------------------------------------------------------------ bağlantı

  private alive(gen: number) {
    return !this.stopping && gen === this.generation;
  }

  private async connect(gen: number) {
    const stored = this.console;
    if (!stored || !this.alive(gen)) {
      return;
    }
    this.status(`${stored.nickname} aranıyor…`);
    const prepared = await this.prepare(stored, gen);
    if (!this.alive(gen)) {
      return;
    }
    if (prepared.kind === 'wakeFailed') {
      this.scheduleReconnect(`${stored.nickname} uyandırılamadı`, gen);
      return;
    }
    const target = prepared.console;
    this.console = target;
    this.status(`${target.nickname}'a bağlanılıyor…`);
    this.host.resetDecoder(decoderSettings(this.host.ocrSettings()));
    const started = await this.rp.start(target, {
      onConnected: () => {
        if (!this.alive(gen)) {
          return;
        }
        this.retryAttempt = 0;
        this.setState({
          running: true,
          starting: false,
          connected: true,
          status: `${target.nickname} · altyazılar okunuyor`,
          error: null,
        });
        // Çözücü ilk anahtar kareyi beklesin diye hemen IDR iste.
        this.rp.requestIdr();
      },
      onDisconnected: (reason, _isError, failure) => {
        if (!this.alive(gen)) {
          return;
        }
        console.warn(`[capture] stream ended: ${reason} (${failure?.message ?? '-'})`);
        this.rp.stop();
        if (failure && !failure.retryable) {
          this.fail(failure.message);
        } else if (failure) {
          this.scheduleReconnect(failure.message, gen);
        } else {
          this.scheduleReconnect(`Bağlantı koptu: ${reason}`, gen);
        }
      },
      onVideo: (sample, lost) => {
        this.videoSamples++;
        this.host.onVideo(sample, lost);
      },
    });
    if (!started && this.alive(gen)) {
      this.scheduleReconnect('PS5\'e bağlanılamadı (açık ve aynı ağda mı?)', gen);
    }
  }

  private scheduleReconnect(message: string, gen: number) {
    if (!this.alive(gen)) {
      return;
    }
    const delay = RETRY_DELAYS_MS[Math.min(this.retryAttempt, RETRY_DELAYS_MS.length - 1)];
    this.retryAttempt++;
    console.log(`[capture] ${message} -> retry in ${delay}ms`);
    this.host.onSubtitle({ text: '', frameId: -1, ocrLatencyMs: 0, timestamp: Date.now() });
    this.setState({
      running: true,
      starting: false,
      connected: false,
      status: `${message} · ${delay / 1000} sn sonra tekrar`,
      error: `${message} · yeniden deneniyor`,
    });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect(gen);
    }, delay);
  }

  private fail(message: string) {
    this.stop();
    this.setState({ ...this.state, error: message });
  }

  // ------------------------------------------------------------------ ConsolePreparer

  private async prepare(
    stored: RegisteredConsole,
    gen: number,
  ): Promise<{ kind: 'ready' | 'notFound' | 'wakeFailed'; console: RegisteredConsole }> {
    let console = stored;
    const found = await this.findConsole(console, SEARCH_MS);
    if (!found) {
      // Yanıt yok (kapalı / farklı ağ): yine de doğrudan dene.
      return { kind: 'notFound', console };
    }
    if (found.host !== console.host) {
      console = { ...console, host: found.host };
      this.host.saveConsole(console);
    }
    if (found.state === 'READY') {
      return { kind: 'ready', console };
    }
    this.status(`${console.nickname} uyandırılıyor…`);
    if (!(await this.rp.wakeup(console))) {
      return { kind: 'wakeFailed', console };
    }
    const deadline = Date.now() + WAKE_TIMEOUT_MS;
    while (Date.now() < deadline && this.alive(gen)) {
      const state = (await this.findConsole(console, PROBE_MS))?.state;
      if (state === 'READY') {
        // Sistem açıldı ama Remote Play servisi birkaç saniye daha hazırlanıyor.
        await sleep(POST_WAKE_SETTLE_MS);
        return { kind: 'ready', console };
      }
    }
    return { kind: 'wakeFailed', console };
  }

  /** Konsolu MAC (host_id) ile, o yoksa IP ile eşleştirir. */
  async findConsole(console: RegisteredConsole, timeoutMs: number) {
    const mac = Buffer.from(console.serverMac || '', 'base64').toString('hex').toUpperCase();
    const match = (list: { host: string; hostId: string; state: string }[]) =>
      list.find(c => mac && c.hostId.toUpperCase() === mac) ?? list.find(c => c.host === console.host);
    const list = await this.rp.discover(
      timeoutMs,
      '255.255.255.255',
      l => {
        const m = match(l);
        return !!m && m.state !== 'UNKNOWN';
      },
      500,
    );
    const m = match(list);
    return m && m.state !== 'UNKNOWN' ? m : null;
  }

  private status(text: string) {
    this.setState({ ...this.state, status: text });
  }

  private setState(s: SessionState) {
    this.state = s;
    this.host.onState(s);
  }
}
