import {
  EmitterSubscription,
  NativeEventEmitter,
  NativeModules,
  Platform,
} from 'react-native';

/** Native CaptureConfig ile birebir. Tüm alanlar opsiyonel; native taraf sınırları uygular. */
export interface CaptureOptions {
  /** İki OCR denemesi arası minimum süre (ms). Varsayılan 500. */
  intervalMs?: number;
  /** Alttan kırpılacak ekran oranı. Varsayılan 0.3 (alt %30). */
  cropRatio?: number;
  /** Sanal ekran maksimum genişliği (px). Varsayılan 1920. */
  maxCaptureWidth?: number;
  /** Metnin yayınlanması için gereken ardışık aynı okuma sayısı. Varsayılan 2. */
  stableFrames?: number;
  /** Önceki metne bu orandan fazla benzerse yok sayılır (0-1). Varsayılan 0.80. */
  similarityThreshold?: number;
}

export interface SubtitleTextEvent {
  /** Ham OCR metni. Boş string = altyazı ekrandan kalktı. */
  text: string;
  frameId: number;
  ocrLatencyMs: number;
  timestamp: number;
}

export type TvLinkState = 'OFF' | 'SEARCHING' | 'CONNECTING' | 'CONNECTED';

export interface TvStateEvent {
  state: TvLinkState;
  /** Bağlanılan / denenen TV IP adresi. */
  target: string | null;
  error: string | null;
}

/** Native SubtitleStyle ile birebir. */
export interface SubtitleStyle {
  /** TV'deki yazı boyutu (sp). Telefon penceresi bunun 2/3'ünü kullanır. */
  fontSize: number;
  /** "#RRGGBB" */
  textColor: string;
  /** "#RRGGBB" */
  bgColor: string;
  /** Arka plan opaklığı, 0-100. */
  bgOpacity: number;
}

export interface CaptureStateEvent {
  running: boolean;
  error: string | null;
}

export interface HttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  body: string;
}

interface SubtitleCaptureNative {
  hasOverlayPermission(): Promise<boolean>;
  requestOverlayPermission(): void;
  startCapture(options: CaptureOptions | null): Promise<boolean>;
  stopCapture(): void;
  isCaptureRunning(): Promise<boolean>;
  updateOverlayText(text: string): void;
  delay(ms: number): Promise<void>;
  httpRequest(options: HttpRequest): Promise<HttpResponse>;
  getSetting(key: string): Promise<string | null>;
  tvConnect(host: string | null): void;
  tvDisconnect(): void;
  setDisplayTargets(phone: boolean, tv: boolean): void;
  setSubtitleStyle(json: string): void;
  mlkitTranslate(text: string): Promise<string>;
  mlkitModelDownloaded(): Promise<boolean>;
  mlkitDownloadModel(): Promise<boolean>;
  setSetting(key: string, value: string | null): Promise<void>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

const EVENT_TEXT = 'SubtitleCapture_onText';
const EVENT_STATE = 'SubtitleCapture_onState';
const EVENT_TV_STATE = 'SubtitleCapture_onTvState';

const Native: SubtitleCaptureNative | undefined =
  Platform.OS === 'android' ? NativeModules.SubtitleCapture : undefined;

if (!Native && Platform.OS === 'android') {
  console.warn(
    '[SubtitleCapture] Native module bulunamadı. Uygulamayı yeniden derleyin.',
  );
}

const emitter = Native ? new NativeEventEmitter(Native as never) : null;

/**
 * Native modülün ince, tipli sarmalayıcısı. Uygulamanın geri kalanı NativeModules'a
 * doğrudan erişmez (test edilebilirlik + tek bağımlılık noktası).
 */
export const SubtitleCapture = {
  isAvailable: Native != null,

  hasOverlayPermission: (): Promise<boolean> =>
    Native ? Native.hasOverlayPermission() : Promise.resolve(false),

  requestOverlayPermission: (): void => Native?.requestOverlayPermission(),

  start: (options?: CaptureOptions): Promise<boolean> =>
    Native
      ? Native.startCapture(options ?? null)
      : Promise.reject(new Error('SubtitleCapture native module yok')),

  stop: (): void => Native?.stopCapture(),

  isRunning: (): Promise<boolean> =>
    Native ? Native.isCaptureRunning() : Promise.resolve(false),

  /** Yüzen penceredeki metni değiştirir. Boş string pencereyi gizler. */
  setOverlayText: (text: string): void => Native?.updateOverlayText(text),

  /**
   * Arka planda da çalışan bekleme (native Handler). RN, uygulama arka plandayken
   * JS setTimeout'larını durdurur; oyun öndeyken gecikme gerekiyorsa bunu kullanın.
   */
  delay: (ms: number): Promise<void> =>
    Native ? Native.delay(ms) : new Promise(resolve => setTimeout(resolve, ms)),

  /**
   * Native (OkHttp) HTTP isteği. RN fetch'i yanıtı JS setTimeout ile teslim ettiği için
   * uygulama arka plandayken (oyun öndeyken) asılı kalır; bu yol kalmaz.
   */
  httpRequest: (options: HttpRequest): Promise<HttpResponse> =>
    Native
      ? Native.httpRequest(options)
      : Promise.reject(new Error('SubtitleCapture native module yok')),

  /** TV alıcısına bağlan. host boşsa TV ağda kendiliğinden aranır. */
  tvConnect: (host?: string | null): void => Native?.tvConnect(host || null),

  tvDisconnect: (): void => Native?.tvDisconnect(),

  /** Çeviri telefondaki pencerede ve/veya TV'de gösterilsin. */
  setDisplayTargets: (phone: boolean, tv: boolean): void =>
    Native?.setDisplayTargets(phone, tv),

  /** Altyazı görünümünü kaydeder; telefondaki pencereye ve TV'ye hemen uygulanır. */
  setSubtitleStyle: (style: SubtitleStyle): void =>
    Native?.setSubtitleStyle(JSON.stringify(style)),

  /** ML Kit on-device EN -> TR çeviri. Dil modeli yoksa önce indirilir (~30 MB). */
  mlkitTranslate: (text: string): Promise<string> =>
    Native
      ? Native.mlkitTranslate(text)
      : Promise.reject(new Error('SubtitleCapture native module yok')),

  mlkitModelDownloaded: (): Promise<boolean> =>
    Native ? Native.mlkitModelDownloaded() : Promise.resolve(false),

  mlkitDownloadModel: (): Promise<boolean> =>
    Native
      ? Native.mlkitDownloadModel()
      : Promise.reject(new Error('SubtitleCapture native module yok')),

  onTvState(listener: (e: TvStateEvent) => void): EmitterSubscription | null {
    return (
      emitter?.addListener(EVENT_TV_STATE, e => listener(e as TvStateEvent)) ??
      null
    );
  },

  /** Uygulamaya özel kalıcı ayar (Android SharedPreferences). */
  getSetting: (key: string): Promise<string | null> =>
    Native ? Native.getSetting(key) : Promise.resolve(null),

  /** null / boş değer ayarı siler. */
  setSetting: (key: string, value: string | null): Promise<void> =>
    Native ? Native.setSetting(key, value) : Promise.resolve(),

  onText(listener: (e: SubtitleTextEvent) => void): EmitterSubscription | null {
    return (
      emitter?.addListener(EVENT_TEXT, e => listener(e as SubtitleTextEvent)) ??
      null
    );
  },

  onState(
    listener: (e: CaptureStateEvent) => void,
  ): EmitterSubscription | null {
    return (
      emitter?.addListener(EVENT_STATE, e =>
        listener(e as CaptureStateEvent),
      ) ?? null
    );
  },
};
