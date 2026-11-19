import { protectWithPlaceholders } from '../../../../src/services/translation/protectedTerms';
import {
  AbortError,
  TranslationResult,
  TranslationService,
} from '../../../../src/services/translation/TranslationService';
import { httpRequest } from './http';

/**
 * Anahtarsız Google Çeviri (EN -> TR). Mobildeki Google ML Kit'in masaüstü karşılığı:
 * Windows'ta cihaz içi ML Kit çeviri modeli olmadığı için Google'ın web çeviri uç noktası
 * kullanılır. Ücretsiz ve kotasız ama resmi bir API değildir; DeepL'den düşük kalitededir.
 */
export class GoogleWebTranslationService implements TranslationService {
  constructor(
    private readonly protectedTerms: string[] = [],
    private readonly timeoutMs = 5000,
  ) {}

  async translate(text: string, signal?: AbortSignal): Promise<TranslationResult> {
    if (signal?.aborted) {
      throw new AbortError();
    }
    const prot = protectWithPlaceholders(text, this.protectedTerms);
    const url =
      'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=tr&dt=t&q=' +
      encodeURIComponent(prot.text);
    let json: any;
    try {
      // Paylaşılan bağlantı havuzu (http.ts): yedeğe düşüldüğünde de bağlantı kurma beklenmesin.
      const res = await httpRequest({ url, method: 'GET', headers: {}, timeoutMs: this.timeoutMs });
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`Google Çeviri hatası ${res.status}`);
      }
      json = JSON.parse(res.body);
    } catch (e) {
      if (signal?.aborted) {
        throw new AbortError();
      }
      const msg = /timeout/i.test((e as Error).message) ? 'yanıt yok (zaman aşımı)' : (e as Error).message;
      throw new Error(`Google Çeviri: ${msg}`);
    }
    if (signal?.aborted) {
      throw new AbortError();
    }
    const parts: unknown = json?.[0];
    if (!Array.isArray(parts)) {
      throw new Error('Google Çeviri: beklenmeyen yanıt');
    }
    const translated = parts.map(p => (Array.isArray(p) ? String(p[0] ?? '') : '')).join('');
    return { text: prot.restore(translated), fromCache: false, engine: 'Google' };
  }
}
