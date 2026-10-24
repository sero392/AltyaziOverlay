export interface TranslationResult {
  text: string;
  fromCache: boolean;
}

/**
 * Çeviri sağlayıcı soyutlaması. Gerçek API (DeepL, Google, LLM vb.) eklemek için
 * sadece bu arayüzü uygulayan yeni bir sınıf yazmak yeterli; hook'lar değişmez.
 */
export interface TranslationService {
  translate(text: string, signal?: AbortSignal): Promise<TranslationResult>;
}

export class AbortError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortError';
  }
}

export const isAbortError = (e: unknown): boolean =>
  e instanceof Error && e.name === 'AbortError';
