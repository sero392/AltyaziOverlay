import {
  AbortError,
  TranslationResult,
  TranslationService,
} from './TranslationService';
import { protectWithPlaceholders } from './protectedTerms';

/**
 * Google ML Kit on-device çeviri (EN -> TR). Ücretsiz, kota yok, internet gerekmez
 * (ilk kullanımda dil modeli indirildikten sonra). Kalitesi DeepL'den düşüktür.
 *
 * Çağrı native tarafta yapılır; uygulama arka plandayken de çalışır.
 */
export class MlKitTranslationService implements TranslationService {
  constructor(
    private readonly native: (text: string) => Promise<string>,
    /** Çevrilmeyecek kelimeler (karakter / yer adları). */
    private readonly protectedTerms: string[] = [],
  ) {}

  async translate(
    text: string,
    signal?: AbortSignal,
  ): Promise<TranslationResult> {
    if (signal?.aborted) {
      throw new AbortError();
    }
    const prot = protectWithPlaceholders(text, this.protectedTerms);
    let translated: string;
    try {
      translated = prot.restore(await this.native(prot.text));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`ML Kit: ${msg}`);
    }
    // Native çağrı iptal edilemez; bu arada yeni altyazı geldiyse sonucu yok say.
    if (signal?.aborted) {
      throw new AbortError();
    }
    return { text: translated, fromCache: false };
  }
}
