import { DeepLError } from './DeepLTranslationService';
import {
  AbortError,
  TranslationResult,
  TranslationService,
} from './TranslationService';

/** Bu hatalardan sonra birincil motor bu oturumda bir daha denenmez (kota doldu / anahtar geçersiz). */
const PERMANENT_STATUSES = [403, 456];

/**
 * "Otomatik" çeviri: önce DeepL; DeepL [hedgeMs] içinde yanıt vermezse yedeğe (masaüstünde Google,
 * telefonda ML Kit) de sorulur ve hangisi önce gelirse o kullanılır.
 *
 * Neden: canlı oyunda DeepL'in çoğu yanıtı 150-500 ms'de gelirken bazıları 2-3,5 sn sürüyor; hızlı
 * diyalogda o sırada sonraki replik geldiği için çeviri hiç gösterilemiyordu (12 dk'lık kayıtta
 * 97 replikten 15'i). Gecikme nadir olduğu için yedeğe giden ek istek de azdır.
 *
 * [wait]: bekleme işlevi. Telefonda SubtitleCapture.delay verilmeli: uygulama arka plandayken
 * (oyun öndeyken) JS setTimeout'ları durur, native bekleme durmaz.
 *
 * Mobildeki FallbackTranslationService'in davranışını korur: DeepL kotası dolarsa (456) ya da anahtar
 * geçersizse (403) bu örnek kalıcı olarak yedeğe geçer ve [onSwitch] ile nedeni bildirir; diğer
 * DeepL hatalarında yalnızca o altyazı yedekle çevrilir.
 */
export class HedgedTranslationService implements TranslationService {
  private switched = false;

  constructor(
    private readonly primary: TranslationService,
    private readonly fallback: TranslationService,
    private readonly onSwitch: (reason: string) => void,
    private readonly hedgeMs = 1000,
    private readonly wait: (ms: number) => Promise<void> = ms =>
      new Promise(resolve => setTimeout(resolve, ms)),
  ) {}

  async translate(text: string, signal?: AbortSignal): Promise<TranslationResult> {
    if (this.switched) {
      return this.fallback.translate(text, signal);
    }
    if (signal?.aborted) {
      throw new AbortError();
    }

    const primary = this.primary.translate(text).catch(e => {
      if (e instanceof DeepLError && PERMANENT_STATUSES.includes(e.status) && !this.switched) {
        this.switched = true;
        this.onSwitch(e.message);
      }
      throw e;
    });

    return new Promise<TranslationResult>((resolve, reject) => {
      let settled = false;
      let fallbackStarted = false;
      let failures = 0;
      let lastError: unknown = null;
      const finish = (fn: () => void) => {
        if (!settled) {
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          fn();
        }
      };
      const onAbort = () => finish(() => reject(new AbortError()));
      signal?.addEventListener('abort', onAbort);

      const startFallback = () => {
        if (fallbackStarted || settled) {
          return;
        }
        fallbackStarted = true;
        this.fallback.translate(text).then(
          r => finish(() => resolve(r)),
          e => onFailure(e),
        );
      };
      const onFailure = (e: unknown) => {
        lastError = e;
        failures++;
        if (!fallbackStarted) {
          startFallback(); // DeepL hata verdi: beklemeden yedeğe geç
        } else if (failures >= 2) {
          finish(() => reject(lastError));
        }
      };
      this.wait(this.hedgeMs).then(startFallback, startFallback);
      primary.then(
        r => finish(() => resolve(r)),
        e => onFailure(e),
      );
    });
  }
}
