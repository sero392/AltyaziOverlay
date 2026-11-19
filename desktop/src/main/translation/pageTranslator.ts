import { PageItem, SubtitleEntry } from '../../shared/types';
import { TranslationService } from '../../../../src/services/translation/TranslationService';
import { PageEvent } from '../pipeline/pagePipeline';
import { normalize } from '../pipeline/filters';

/** Aynı anda en fazla bu kadar çeviri isteği (menüde onlarca yazı olabilir). */
const MAX_PARALLEL = 6;
/** Yeni sayfa ilk kez bu süre dolunca ya da tüm çeviriler bitince gösterilir (parça parça titremesin). */
const FIRST_SHOW_MS = 1200;
/** İlk gösterimden sonra gelen çeviriler en fazla bu sıklıkla ekrana yansır. */
const UPDATE_THROTTLE_MS = 200;

/**
 * "Tüm sayfayı çevir": sayfadaki her blok ayrı çevrilir (önbellek aynı yazıları anında verir) ve
 * kutusuyla birlikte ekrana gönderilir. "En son kazanır": yeni sayfa gelince eski sayfanın geç
 * gelen çevirileri ekrana yansımaz.
 */
export class PageTranslator {
  private seq = 0;
  /** Geçmiş kayıtları altyazılarla çakışmasın diye negatif kimlik. */
  private historyId = 0;

  constructor(
    private service: TranslationService,
    private readonly show: (items: PageItem[]) => void,
    private readonly addHistory: (e: SubtitleEntry) => void,
  ) {}

  setService(service: TranslationService) {
    this.service = service;
  }

  /** Mod kapanınca / oturum bitince: bekleyen çeviriler ekrana yazmaz. */
  cancel() {
    this.seq++;
  }

  async handle(ev: PageEvent) {
    const id = ++this.seq;
    if (ev.blocks.length === 0) {
      this.show([]);
      return;
    }
    const startedAt = Date.now();
    const results: (PageItem | null)[] = ev.blocks.map(() => null);
    let shown = false;
    let lastPush = 0;
    let pushTimer: ReturnType<typeof setTimeout> | null = null;

    const push = () => {
      if (id !== this.seq) {
        return;
      }
      lastPush = Date.now();
      shown = true;
      this.show(results.filter((r): r is PageItem => r !== null));
    };
    const schedulePush = () => {
      if (!shown || pushTimer) {
        return;
      }
      const wait = Math.max(0, UPDATE_THROTTLE_MS - (Date.now() - lastPush));
      pushTimer = setTimeout(() => {
        pushTimer = null;
        push();
      }, wait);
    };
    const firstTimer = setTimeout(() => {
      if (!shown) {
        push();
      }
    }, FIRST_SHOW_MS);

    let next = 0;
    let failed = 0;
    const worker = async () => {
      while (next < ev.blocks.length && id === this.seq) {
        const i = next++;
        const block = ev.blocks[i];
        try {
          const r = await this.service.translate(block.text);
          const same = normalize(r.text) === normalize(block.text);
          // Çevirisi aynı kalan yazılar (isimler, sayılar) örtülmez.
          if (!same && r.text.trim()) {
            results[i] = { text: r.text.trim(), box: block.box, lines: block.lines ?? 1 };
          }
        } catch {
          failed++;
        }
        schedulePush();
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, ev.blocks.length) }, worker));
    clearTimeout(firstTimer);
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }
    if (id !== this.seq) {
      return;
    }
    push();

    const ms = Date.now() - startedAt;
    const done = results.filter(Boolean) as PageItem[];
    console.log(
      `[sayfa] ${ev.blocks.length} blok · ${done.length} çevrildi · ${failed} hata · ${ms} ms · ` +
        done.map(d => `"${d.text}"`).join(' | ').slice(0, 300),
    );
    this.addHistory({
      id: --this.historyId,
      original: ev.blocks.map(b => b.text).join(' · '),
      translated: done.length ? done.map(d => d.text).join(' · ') : '(çevrilecek yazı yok)',
      status: failed && !done.length ? 'error' : 'done',
      ocrLatencyMs: ev.ocrLatencyMs,
      translationLatencyMs: ms,
      fromCache: false,
      engine: 'sayfa',
      receivedAt: startedAt,
    });
  }
}
