import { SubtitleBox, SubtitleEntry } from '../../shared/types';
import { TranslationService } from '../../../../src/services/translation/TranslationService';
import { SubtitleEvent } from '../pipeline/subtitlePipeline';

const HISTORY_LIMIT = 30;

/**
 * Orkestrasyon: OCR metni -> çeviri -> ekran (masaüstü penceresi / TV).
 * Mobildeki useSubtitleTranslator hook'unun ana süreç karşılığı; uygulama penceresi kapalı
 * (tepside) olsa da çalışır.
 *
 * - Ekranda "en son kazanır": yalnızca en son altyazının çevirisi gösterilir; geç gelen eski bir
 *   yanıt ekrandaki metni ezmez.
 * - Mobilden farkı: önceki istek İPTAL EDİLMEZ. Canlı oyunda DeepL'in yavaş kaldığı anlarda hızlı
 *   diyaloğun replikleri "(iptal)" olarak kayboluyordu; artık istek tamamlanır ve çeviri geçmişe
 *   "geç geldi" notuyla yazılır (ekrana çıkmaz, çünkü altyazı çoktan değişmiştir).
 * - Boş metin = altyazı kalktı -> anında gizlenir, API çağrısı yok.
 * - Çeviri başarısızsa orijinal gösterilir: hiç yoktan iyidir.
 */
export class SubtitleTranslator {
  history: SubtitleEntry[] = [];
  private seq = 0;

  constructor(
    private service: TranslationService,
    private readonly show: (text: string, box?: SubtitleBox | null) => void,
    private readonly onHistory: (h: SubtitleEntry[]) => void,
  ) {}

  setService(service: TranslationService) {
    this.service = service;
  }

  async handle(event: SubtitleEvent) {
    const text = event.text.trim();
    if (!text) {
      this.seq++;
      this.show('');
      return;
    }
    const id = ++this.seq;
    this.history = [
      {
        id,
        original: text,
        translated: null,
        status: 'pending' as const,
        ocrLatencyMs: event.ocrLatencyMs,
        translationLatencyMs: null,
        fromCache: false,
        late: false,
        receivedAt: Date.now(),
      },
      ...this.history,
    ].slice(0, HISTORY_LIMIT);
    this.onHistory(this.history);

    const startedAt = Date.now();
    try {
      const result = await this.service.translate(text);
      const ms = Date.now() - startedAt;
      const latest = id === this.seq;
      console.log(`[çeviri] ${ms} ms · ${result.engine ?? '?'}${latest ? '' : ' · geç'}: "${text}" -> "${result.text}"`);
      if (latest) {
        this.show(result.text, event.box);
      }
      this.patch(id, {
        translated: result.text,
        status: 'done',
        translationLatencyMs: ms,
        fromCache: result.fromCache,
        engine: result.engine,
        late: !latest,
      });
    } catch (e) {
      console.warn(`[çeviri] hata (${Date.now() - startedAt} ms): ${e instanceof Error ? e.message : e}`);
      if (id === this.seq) {
        this.show(text, event.box);
      }
      this.patch(id, { status: 'error', translated: e instanceof Error ? e.message : String(e) });
    }
  }

  /**
   * Altyazı henüz onaylanmadan çeviriyi başlatır (sonuç önbelleğe girer; aynı metin için onaylı
   * istek gelince bekleyen istek paylaşılır). Ekrana bir şey yazmaz, geçmişe eklemez.
   */
  prefetch(text: string) {
    const t = text.trim();
    if (t) {
      this.service.translate(t).catch(() => {});
    }
  }

  /** Başka kaynaktan (tam sayfa çeviri) gelen kaydı geçmişin başına ekler. */
  record(entry: SubtitleEntry) {
    this.history = [entry, ...this.history].slice(0, HISTORY_LIMIT);
    this.onHistory(this.history);
  }

  clear() {
    this.history = [];
    this.onHistory(this.history);
  }

  private patch(id: number, p: Partial<SubtitleEntry>) {
    this.history = this.history.map(e => (e.id === id ? { ...e, ...p } : e));
    this.onHistory(this.history);
  }
}
