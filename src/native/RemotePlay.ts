import { NativeModules, Platform } from 'react-native';

interface RemotePlayNative {
  getConsole(): Promise<string | null>;
  register(
    host: string,
    psnAccountIdBase64: string,
    pin: string,
  ): Promise<string>;
  captureTestFrame(holdSeconds: number): Promise<string>;
  forgetConsole(): void;
}

const Native: RemotePlayNative | undefined =
  Platform.OS === 'android' ? NativeModules.RemotePlay : undefined;

const missing = () => Promise.reject(new Error('RemotePlay native module yok'));

/** chiaki-ng tabanlı PS Remote Play istemcisi (0. aşama: eşleştirme + tek kare). */
export const RemotePlay = {
  /** Kayıtlı konsol ("Ad (IP)") ya da null. */
  getConsole: (): Promise<string | null> =>
    Native ? Native.getConsole() : Promise.resolve(null),

  register: (host: string, psnAccountIdBase64: string, pin: string) =>
    Native ? Native.register(host, psnAccountIdBase64, pin) : missing(),

  /**
   * Yayını açar ve kare kaydeder. holdSeconds=0: ilk karede kapatır (dosya yolunu döner);
   * >0: yayını o kadar açık tutar (kol/kullanıcı davranışı denemesi).
   */
  captureTestFrame: (holdSeconds = 0): Promise<string> =>
    Native ? Native.captureTestFrame(holdSeconds) : missing(),

  forgetConsole: (): void => Native?.forgetConsole(),
};
