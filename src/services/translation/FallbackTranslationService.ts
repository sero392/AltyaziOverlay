import { DeepLError } from './DeepLTranslationService';
import {
  isAbortError,
  TranslationResult,
  TranslationService,
} from './TranslationService';

/** Bu hatalardan sonra DeepL bu oturumda bir daha denenmez (kota doldu / anahtar geçersiz). */
const PERMANENT_STATUSES = [403, 456];

/**
 * "Otomatik" çeviri: önce DeepL, olmazsa ML Kit.
 *
 * - DeepL kotası dolarsa (456) ya da anahtar geçersizse (403) bu örnek kalıcı olarak ML Kit'e
 *   geçer ve [onSwitch] ile nedeni bildirir. Uygulama yeniden açılınca DeepL tekrar denenir.
 * - Diğer DeepL hatalarında (ağ, zaman aşımı, 429) yalnızca o altyazı ML Kit ile çevrilir.
 */
export class FallbackTranslationService implements TranslationService {
  private switched = false;

  constructor(
    private readonly primary: TranslationService,
    private readonly fallback: TranslationService,
    private readonly onSwitch: (reason: string) => void,
  ) {}

  async translate(
    text: string,
    signal?: AbortSignal,
  ): Promise<TranslationResult> {
    if (this.switched) {
      return this.fallback.translate(text, signal);
    }
    try {
      return await this.primary.translate(text, signal);
    } catch (e) {
      if (isAbortError(e)) {
        throw e;
      }
      if (
        e instanceof DeepLError &&
        PERMANENT_STATUSES.includes(e.status) &&
        !this.switched
      ) {
        this.switched = true;
        this.onSwitch(e.message);
      }
      return this.fallback.translate(text, signal);
    }
  }
}
