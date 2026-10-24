import type { HttpRequest, HttpResponse } from '../../native/SubtitleCapture';
import {
  AbortError,
  TranslationResult,
  TranslationService,
} from './TranslationService';

export interface DeepLUsage {
  characterCount: number;
  characterLimit: number;
}

/** DeepL'in HTTP durum kodlarını kullanıcıya anlamlı mesaja çevirir. */
export class DeepLError extends Error {
  constructor(readonly status: number, detail?: string) {
    super(DeepLError.describe(status, detail));
    this.name = 'DeepLError';
  }

  private static describe(status: number, detail?: string): string {
    switch (status) {
      case 403:
        return 'DeepL: API anahtarı geçersiz (403)';
      case 429:
        return 'DeepL: çok fazla istek, biraz bekleyin (429)';
      case 456:
        return 'DeepL: aylık karakter kotası doldu (456)';
      default:
        return `DeepL hatası ${status}${detail ? `: ${detail}` : ''}`;
    }
  }
}

/**
 * DeepL REST API (EN -> TR).
 *
 * - Ücretsiz anahtarlar ":fx" ile biter ve api-free.deepl.com'a gider; diğerleri api.deepl.com.
 * - Bir önceki altyazı `context` olarak gönderilir: zamirler / devam eden cümleler daha
 *   doğru çevrilir ve bu metin karakter kotasından düşmez.
 * - İstekler enjekte edilen `http` ile (native OkHttp) yapılır, fetch ile DEĞİL: RN fetch'i
 *   yanıtı JS setTimeout ile teslim eder ve oyun öndeyken (uygulama arka planda) JS
 *   zamanlayıcıları durduğu için hiç dönmez. Zaman aşımı da native tarafta uygulanır.
 */
export class DeepLTranslationService implements TranslationService {
  private readonly baseUrl: string;
  private previousText: string | null = null;

  constructor(
    private readonly apiKey: string,
    private readonly http: (req: HttpRequest) => Promise<HttpResponse>,
    private readonly timeoutMs = 5000,
  ) {
    this.baseUrl = apiKey.trim().endsWith(':fx')
      ? 'https://api-free.deepl.com'
      : 'https://api.deepl.com';
  }

  async translate(
    text: string,
    signal?: AbortSignal,
  ): Promise<TranslationResult> {
    const body: Record<string, unknown> = {
      text: [text],
      source_lang: 'EN',
      target_lang: 'TR',
    };
    if (this.previousText) {
      body.context = this.previousText;
    }

    const json = await this.request('/v2/translate', 'POST', signal, body);
    const translated: string | undefined = json?.translations?.[0]?.text;
    if (typeof translated !== 'string') {
      throw new Error('DeepL: beklenmeyen yanıt');
    }
    this.previousText = text;
    return { text: translated, fromCache: false };
  }

  async usage(): Promise<DeepLUsage> {
    const json = await this.request('/v2/usage', 'GET');
    return {
      characterCount: Number(json?.character_count ?? 0),
      characterLimit: Number(json?.character_limit ?? 0),
    };
  }

  private async request(
    path: string,
    method: 'GET' | 'POST',
    signal?: AbortSignal,
    body?: unknown,
  ): Promise<any> {
    if (signal?.aborted) {
      throw new AbortError();
    }

    let res: HttpResponse;
    try {
      res = await this.http({
        url: this.baseUrl + path,
        method,
        headers: {
          Authorization: `DeepL-Auth-Key ${this.apiKey.trim()}`,
          ...(body ? { 'Content-Type': 'application/json' } : null),
        },
        body: body ? JSON.stringify(body) : undefined,
        timeoutMs: this.timeoutMs,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        /timeout|timed out/i.test(msg)
          ? `DeepL: ${this.timeoutMs / 1000} sn içinde yanıt yok`
          : `DeepL bağlantı hatası: ${msg}`,
      );
    }

    // Native istek iptal edilemez; bu arada yeni altyazı geldiyse sonucu yok say.
    if (signal?.aborted) {
      throw new AbortError();
    }

    let json: any = null;
    try {
      json = res.body ? JSON.parse(res.body) : null;
    } catch {}
    if (res.status < 200 || res.status >= 300) {
      throw new DeepLError(res.status, json?.message);
    }
    return json;
  }
}
