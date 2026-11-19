// Ana süreç <-> arayüz arasında paylaşılan tipler (IPC sözleşmesi).

export type ConsoleState = 'UNKNOWN' | 'READY' | 'STANDBY';

export interface DiscoveredConsole {
  host: string;
  name: string;
  hostId: string;
  ps5: boolean;
  state: ConsoleState;
}

export interface PairedConsole {
  host: string;
  nickname: string;
  ps5: boolean;
}

export type TranslationEngine = 'deepl' | 'google' | 'auto' | 'local';

export type LlmStatus = 'missing' | 'downloading' | 'stopped' | 'starting' | 'ready' | 'error';

/** Yerel çeviri modelinin (llama.cpp + TranslateGemma) durumu. */
export interface LlmState {
  status: LlmStatus;
  progress: { label: string; received: number; total: number } | null;
  error: string | null;
}

/** Altyazının tam görüntü karesindeki yeri; 0-1 aralığında (sol üst köşe + boyut). */
export interface SubtitleBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SubtitleStyle {
  /** TV'deki yazı boyutu. Masaüstü penceresi bunu doğrudan px olarak kullanır. */
  fontSize: number;
  textColor: string;
  bgColor: string;
  /** 0-100 */
  bgOpacity: number;
}

export const DEFAULT_STYLE: SubtitleStyle = {
  fontSize: 30,
  textColor: '#FFFFFF',
  bgColor: '#000000',
  bgOpacity: 75,
};

export interface TvSettings {
  enabled: boolean;
  /** Elle girilen TV IP'si; boşsa ağda (mDNS) aranır. */
  host: string;
  /** TV açıkken çeviri bilgisayar ekranında da gösterilsin mi? */
  alsoOnDesktop: boolean;
}

/** Ekranda OCR'lanacak alan; 0-1 aralığında (sol üst köşe + boyut). */
export type ReadRegion = SubtitleBox;

export interface OcrSettings {
  intervalMs: number;
  /** Okuma alanları (en çok 4); yalnızca bunların içindeki yazılar okunur. */
  regions: ReadRegion[];
}

/** Okuma alanı kurulumu için yayından alınan renkli kare. */
export interface FrameSnapshot {
  dataUrl: string;
  width: number;
  height: number;
}

/** Tam sayfa çevirinin tek yazısı: çeviri + İngilizce aslının karedeki yeri (0-1). */
export interface PageItem {
  text: string;
  box: SubtitleBox;
  /** İngilizce aslının satır sayısı (TV kutuyu genişletirken kullanır). */
  lines?: number;
}

/**
 * Masaüstü varsayılanı alt %30 (mobilde %20). Canlı oyun kaydında ara sahne altyazıları siyah bandın
 * hemen üstünde, %20'lik alanın en tepesinde duruyordu; iki satırlık altyazının üst satırı dışarıda kalır.
 */
export const DEFAULT_OCR: OcrSettings = { intervalMs: 300, regions: [{ x: 0, y: 0.7, w: 1, h: 0.3 }] };

/** Arayüze giden ayarlar (gizli anahtarlar maskeli). */
export interface PublicSettings {
  deeplKeyMasked: string | null;
  engine: TranslationEngine;
  protectedTerms: string[];
  style: SubtitleStyle;
  tv: TvSettings;
  ocr: OcrSettings;
}

export interface SessionState {
  running: boolean;
  starting: boolean;
  connected: boolean;
  status: string;
  error: string | null;
}

export type TvLinkState = 'OFF' | 'SEARCHING' | 'CONNECTING' | 'CONNECTED';

export interface TvStatus {
  state: TvLinkState;
  target: string | null;
  error: string | null;
}

export type TranslationStatus = 'pending' | 'done' | 'error';

export interface SubtitleEntry {
  id: number;
  original: string;
  translated: string | null;
  status: TranslationStatus;
  ocrLatencyMs: number;
  translationLatencyMs: number | null;
  fromCache: boolean;
  /** Çeviriyi yapan motor. */
  engine?: string;
  /** Çeviri geldiğinde ekranda başka altyazı vardı; yalnızca geçmişe yazıldı. */
  late?: boolean;
  receivedAt: number;
}

export interface OcrInfo {
  ready: boolean;
  lang: string | null;
  available: string[];
  error: string | null;
}

export interface AppState {
  setupDone: boolean;
  console: PairedConsole | null;
  settings: PublicSettings;
  session: SessionState;
  tv: TvStatus;
  history: SubtitleEntry[];
  engineNote: { text: string; warn: boolean };
  ocr: OcrInfo;
  helpers: { rp: boolean; ocr: boolean };
  llm: LlmState;
  /** Okuma sürerken hattın her adımının sayaçları; durmuşsa null. */
  diag: PipelineDiag | null;
  /** Ayrıntılı log dosyasının yolu. */
  logFile: string;
}

export interface PipelineDiag {
  /** PS5'ten gelen sıkıştırılmış video örnekleri. */
  videoSamples: number;
  /** Çözülüp kırpılarak OCR hattına gelen kareler. */
  frames: number;
  /** Değişmediği için OCR'a gönderilmeyen kareler. */
  unchanged: number;
  ocrRuns: number;
  ocrErrors: number;
  decoderErrors: number;
  lastFrameSize: string;
  /** Son OCR'ın okuduğu ham satırlar. */
  lastOcrText: string;
  /** Son okumanın altyazı sayılmama nedeni. */
  lastReject: string | null;
  /** Çeviriye giden altyazılar. */
  emitted: number;
}

export interface DeepLUsage {
  characterCount: number;
  characterLimit: number;
}

export type SettingsPatch = Partial<{
  engine: TranslationEngine;
  protectedTerms: string[];
  style: SubtitleStyle;
  tv: TvSettings;
  ocr: OcrSettings;
}>;

/** preload'un window.api olarak açtığı arayüz. */
export interface DesktopApi {
  getState(): Promise<AppState>;
  onState(cb: (s: AppState) => void): () => void;
  discover(timeoutMs: number): Promise<DiscoveredConsole[]>;
  register(host: string, accountId: string, pin: string): Promise<string>;
  probeConsole(): Promise<ConsoleState | null>;
  wakeConsole(): Promise<void>;
  forgetConsole(): Promise<void>;
  startSession(): Promise<void>;
  stopSession(): Promise<void>;
  setSettings(patch: SettingsPatch): Promise<void>;
  setDeepLKey(key: string | null): Promise<void>;
  deeplUsage(key?: string): Promise<DeepLUsage>;
  simulate(text: string): Promise<void>;
  clearHistory(): Promise<void>;
  setSetupDone(done: boolean): Promise<void>;
  openExternal(url: string): Promise<void>;
  openLog(): Promise<void>;
  llmInstall(): Promise<void>;
  llmCancelInstall(): Promise<void>;
  /** PS5 yayınından tek kare (okuma sürmüyorsa geçici olarak bağlanır). */
  captureSnapshot(): Promise<FrameSnapshot>;
}
