export type TranslationStatus = 'pending' | 'done' | 'error';

/** Ekranda görülen bir altyazının yaşam döngüsü (UI geçmişi için). */
export interface SubtitleEntry {
  id: number;
  original: string;
  translated: string | null;
  status: TranslationStatus;
  /** Native tarafta OCR'ın sürdüğü süre (ms). */
  ocrLatencyMs: number;
  /** Çeviri süresi (ms). Önbellekten gelirse ~0. */
  translationLatencyMs: number | null;
  fromCache: boolean;
  receivedAt: number;
}

export interface TranslatorStats {
  received: number;
  translated: number;
  cacheHits: number;
  dropped: number;
}
