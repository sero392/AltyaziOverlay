import { NativeModules, Platform } from 'react-native';
import type { CaptureOptions } from './SubtitleCapture';

export type ConsoleState = 'READY' | 'STANDBY' | 'UNKNOWN';

/** Ağda bulunan PlayStation. */
export interface DiscoveredConsole {
  host: string;
  name: string;
  state: ConsoleState;
  ps5: boolean;
  /** Bu uygulamayla eşleşmiş konsol mu? */
  paired: boolean;
}

/** Eşleşmiş konsol ve anlık durumu (OFFLINE = ağda yanıt yok). */
export interface PairedConsole {
  nickname: string;
  host: string;
  state: 'READY' | 'STANDBY' | 'OFFLINE' | 'UNKNOWN';
}

interface RemotePlayNative {
  getConsole(): Promise<string | null>;
  getPairedConsole(): Promise<PairedConsole | null>;
  discover(timeoutMs: number): Promise<DiscoveredConsole[]>;
  wake(): Promise<boolean>;
  register(
    host: string,
    psnAccountIdBase64: string,
    pin: string,
  ): Promise<string>;
  captureTestFrame(holdSeconds: number): Promise<string>;
  forgetConsole(): void;
  startStreaming(options: CaptureOptions | null): Promise<boolean>;
  stopStreaming(): void;
}

const Native: RemotePlayNative | undefined =
  Platform.OS === 'android' ? NativeModules.RemotePlay : undefined;

const missing = () => Promise.reject(new Error('RemotePlay native module yok'));

/** chiaki-ng tabanlı PS Remote Play istemcisi. */
export const RemotePlay = {
  /** Kayıtlı konsol ("Ad (IP)") ya da null. */
  getConsole: (): Promise<string | null> =>
    Native ? Native.getConsole() : Promise.resolve(null),

  /** Eşleşmiş konsol + ağdaki durumu (~2 sn sürer) ya da eşleşme yoksa null. */
  getPairedConsole: (): Promise<PairedConsole | null> =>
    Native ? Native.getPairedConsole() : Promise.resolve(null),

  /** Ağdaki PlayStation'ları arar. */
  discover: (timeoutMs = 3000): Promise<DiscoveredConsole[]> =>
    Native ? Native.discover(timeoutMs) : Promise.resolve([]),

  /** Bekleme modundaki eşleşmiş konsolu uyandırır. */
  wake: (): Promise<boolean> => (Native ? Native.wake() : missing()),

  /**
   * PS5 ile eşleştirir. PIN: PS5'te (Remote Play hesabıyla oturum açıkken)
   * Ayarlar > Sistem > Uzaktan Oynatma > Cihazı Bağla ekranındaki 8 hane.
   */
  register: (host: string, psnAccountIdBase64: string, pin: string) =>
    Native ? Native.register(host, psnAccountIdBase64, pin) : missing(),

  /**
   * Geliştirme denemesi: yayını açar ve kare kaydeder. holdSeconds=0: ilk karede
   * kapatır (dosya yolunu döner); >0: yayını o kadar açık tutar.
   */
  captureTestFrame: (holdSeconds = 0): Promise<string> =>
    Native ? Native.captureTestFrame(holdSeconds) : missing(),

  forgetConsole: (): void => Native?.forgetConsole(),

  /**
   * PS5 yayınından arka planda altyazı okumayı başlatır. Durum ve altyazılar
   * SubtitleCapture.onState / onText ile gelir; durdurmak için SubtitleCapture.stop().
   */
  startStreaming: (options?: CaptureOptions): Promise<boolean> =>
    Native ? Native.startStreaming(options ?? null) : missing(),

  stopStreaming: (): void => Native?.stopStreaming(),
};
