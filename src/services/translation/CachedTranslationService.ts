import {
  AbortError,
  TranslationResult,
  TranslationService,
} from './TranslationService';

/**
 * LRU önbellek dekoratörü. Oyunlarda tekrar eden replikler (menü, "Follow me" vb.)
 * ikinci kez API'ye gitmez. Aynı metin için eşzamanlı istekler de tek isteğe indirgenir.
 */
export class CachedTranslationService implements TranslationService {
  private readonly cache = new Map<string, string>();
  private readonly inflight = new Map<string, Promise<TranslationResult>>();

  constructor(
    private readonly inner: TranslationService,
    private readonly capacity = 200,
  ) {}

  async translate(
    text: string,
    signal?: AbortSignal,
  ): Promise<TranslationResult> {
    const key = text.trim().toLowerCase();

    const cached = this.cache.get(key);
    if (cached !== undefined) {
      // LRU: en sona taşı.
      this.cache.delete(key);
      this.cache.set(key, cached);
      return { text: cached, fromCache: true };
    }

    let pending = this.inflight.get(key);
    if (!pending) {
      // Paylaşılan istek tekil çağıranın iptaline bağlı olmamalı -> signal iletilmez;
      // iptal edilen çağıran sadece sonucu yok sayar.
      pending = this.inner.translate(text).then(res => {
        this.put(key, res.text);
        return res;
      });
      pending.finally(() => this.inflight.delete(key)).catch(() => {});
      this.inflight.set(key, pending);
    }

    return raceWithAbort(pending, signal);
  }

  private put(key: string, value: string) {
    this.cache.set(key, value);
    if (this.cache.size > this.capacity) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }
  }
}

function raceWithAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return p;
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new AbortError());
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort);
    p.then(resolve, reject).finally(() =>
      signal.removeEventListener('abort', onAbort),
    );
  });
}
