import { OcrHelper, OcrRawLine } from '../native/ocrHelper';
import { correctOcrEnglish } from './ocrCorrections';
import type { SubtitleBox } from '../../shared/types';
import { FrameDiffDetector, normalize, similarity } from './filters';
import { debugRecorder } from '../debugRecorder';

/**
 * Bilgilendirme kutusu hattı: karenin sol üstündeki oyun ipuçları/görev bilgileri altyazıyla
 * birlikte her zaman okunur, paragrafa gruplanır ve karedeki yeriyle (0-1) yayınlanır. TV
 * çeviriyi İngilizcenin tam üstüne kendi kutusunda yazar.
 *
 * Kısa yazılar (para, saat, tek kelimelik etiketler) ve harf içermeyen satırlar atlanır.
 */

/** Ekran yüksekliğine göre minimum satır yüksekliği. */
const MIN_LINE_HEIGHT_RATIO = 0.011;
/** Aynı paragrafın satırları arasındaki en fazla boşluk (satır yüksekliğinin katı). */
const MAX_LINE_GAP = 0.75;
/** Aynı paragrafın satır yükseklikleri en fazla bu oranda farklı olabilir. */
const MAX_HEIGHT_RATIO = 1.4;
/** Bir satırın alttakiyle birleşmesi için en az kelime sayısı (kısa satır = menü öğesi). */
const MIN_WRAP_WORDS = 4;
/** Büyük harfli kısa satırların tek etiket sayılması için en fazla boşluk (satır yüksekliğinin katı). */
const MAX_LABEL_GAP = 0.35;
/** Aynı satır sayılmak için dikey örtüşme oranı ve en fazla yatay boşluk (satır yüksekliğinin katı). */
const SAME_ROW_OVERLAP = 0.6;
const SAME_ROW_GAP = 1.6;
const OCR_TIMEOUT_MS = 4000;
/** Bu benzerlikteki yeniden okumada önceki metin korunur. */
const KEEP_TEXT_SIMILARITY = 0.8;
const RECENT_BLOCKS = 40;
const WHITESPACE = /\s+/g;

const LATIN_FIX: Record<string, string> = {
  ı: 'i', İ: 'I', ş: 's', Ş: 'S', ğ: 'g', Ğ: 'G', ç: 'c', Ç: 'C', ö: 'o', Ö: 'O', ü: 'u', Ü: 'U',
};
const LATIN_FIX_RE = new RegExp(`[${Object.keys(LATIN_FIX).join('')}]`, 'g');

interface Line {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageBlock {
  text: string;
  box: SubtitleBox;
  /** Bloğu oluşturan OCR satırı sayısı. */
  lines?: number;
}

export interface PageEvent {
  /** Boş dizi = ekranda çevrilecek yazı yok. */
  blocks: PageBlock[];
  frameId: number;
  ocrLatencyMs: number;
}

const letterCount = (s: string) => [...s].filter(c => /\p{L}/u.test(c)).length;

/** Kumanda tuşu simgeleri OCR'da "@", "O", "©" gibi tek karakterlere dönüşür. */
const BUTTON_GLYPH = /^(?:[^\p{L}\p{N}.,!?'"]{1,3}|[OoQ0@e])$/u;

/** Cümle ortasındaki tuş simgesi kalıntıları ("hold • : • to view"); "&", "-" gibi gerçek işaretler değil. */
const INLINE_GLYPH = /^[•·:@©®○●◯◎□■△▲✕×+*„]{1,4}$/u;
/** Kelimeye yapışık simge ("@Collect", "•Go"). */
const GLUED_GLYPH = /^[@©®•·○●]+(?=\p{L})/u;

/**
 * Satır başı/sonundaki tuş simgelerini atar ("Read @" -> "Read", "© Close" -> "Close"); cümle
 * ortasındaki simge kalıntılarını ve kelimeye yapışık simgeleri de temizler.
 */
export function stripButtonGlyphs(text: string): string {
  const words = text
    .split(' ')
    .filter(Boolean)
    .map(w => w.replace(GLUED_GLYPH, ''))
    .filter((w, i, all) => i === 0 || i === all.length - 1 || !INLINE_GLYPH.test(w));
  if (words.length < 2) {
    return words.join(' ') || text;
  }
  while (words.length > 1 && BUTTON_GLYPH.test(words[words.length - 1])) {
    words.pop();
  }
  while (words.length > 1 && BUTTON_GLYPH.test(words[0])) {
    words.shift();
  }
  return words.join(' ');
}

/** Kelime: en az 2 harf. "x3", "100/100", "HP" gibi tek parçalık HUD yazıları da elenir. */
function isTranslatable(text: string): boolean {
  if (letterCount(text) < 2) {
    return false;
  }
  return text.split(' ').some(w => letterCount(w) >= 2 && /\p{L}{2}/u.test(w));
}

function canMerge(a: Line, b: Line): boolean {
  const h = Math.max(a.h, b.h);
  const ratio = Math.max(a.h, b.h) / Math.max(1, Math.min(a.h, b.h));
  if (ratio > MAX_HEIGHT_RATIO) {
    return false;
  }
  const gap = b.y - (a.y + a.h);
  if (gap < -h * 0.3 || gap > h * MAX_LINE_GAP) {
    return false;
  }
  // Sola hizalı ya da ortalı paragraf.
  const leftAligned = Math.abs(a.x - b.x) <= h * 1.5;
  const centered = Math.abs(a.x + a.w / 2 - (b.x + b.w / 2)) <= h * 1.5;
  if (!leftAligned && !centered) {
    return false;
  }
  // Üstteki satır uzun olmalı (paragraf kaydırması); kısa satırlar listedir, ayrı çevrilir.
  if (a.text.split(' ').filter(Boolean).length >= MIN_WRAP_WORDS) {
    return true;
  }
  // İstisna: haritadaki iki satırlık yer adları ("WALLACE / STATION") ortalı, büyük harfli ve
  // çok sıkı dizilir; menü öğeleri arasında ise daha geniş boşluk olur.
  const caps = (s: string) => {
    const letters = [...s].filter(c => /\p{L}/u.test(c));
    return letters.length > 0 && letters.filter(c => /\p{Lu}/u.test(c)).length / letters.length >= 0.75;
  };
  return centered && gap <= h * MAX_LABEL_GAP && caps(a.text) && caps(b.text);
}

/**
 * Satır içindeki simge (ör. haritadaki işaret) OCR satırını ikiye böler: aynı hizadaki yakın
 * parçalar tek satır yapılır, yoksa parça çevrilmiş paragrafın üstüne ayrı kutu olarak basılır.
 */
function joinSameRow(lines: Line[]) {
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i];
      const b = lines[j];
      if (b.y > a.y + a.h) {
        break;
      }
      const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      const h = Math.max(a.h, b.h);
      if (overlapY < Math.min(a.h, b.h) * SAME_ROW_OVERLAP || Math.max(a.h, b.h) / Math.min(a.h, b.h) > MAX_HEIGHT_RATIO) {
        continue;
      }
      const [l, r] = a.x <= b.x ? [a, b] : [b, a];
      const gap = r.x - (l.x + l.w);
      if (gap > h * SAME_ROW_GAP) {
        continue;
      }
      const x = l.x;
      const y = Math.min(a.y, b.y);
      lines[i] = {
        text: `${l.text} ${r.text}`,
        x,
        y,
        w: Math.max(l.x + l.w, r.x + r.w) - x,
        h: Math.max(a.y + a.h, b.y + b.h) - y,
      };
      lines.splice(j, 1);
      j = i;
    }
  }
}

/**
 * OCR satırlarını çevrilecek bloklara indirger: küçük ve harfsiz satırlar atılır, aynı paragrafın
 * alt alta satırları birleştirilir. Kutular tam kareye göre 0-1 aralığındadır.
 */
export function extractPageBlocks(
  raw: OcrRawLine[],
  frameWidth: number,
  frameHeight: number,
  latinFix: boolean,
  minWords = 1,
): PageBlock[] {
  const minH = frameHeight * MIN_LINE_HEIGHT_RATIO;
  const lines: Line[] = raw
    .map(l => ({
      ...l,
      text: correctOcrEnglish(latinFix ? l.text.replace(LATIN_FIX_RE, c => LATIN_FIX[c]) : l.text)
        .replace(WHITESPACE, ' ')
        .trim(),
    }))
    .map(l => {
      // Simge atılınca kutu da daralır: TV tuş simgesini örtmesin (oyuncu hangi tuş olduğunu görsün).
      const text = stripButtonGlyphs(l.text);
      if (text === l.text) {
        return l;
      }
      // Ortadaki simge silinmiş olabilir: kutu ilk ve son kalan kelimenin konumundan hesaplanır.
      const parts = text.split(' ');
      const start = Math.max(0, l.text.indexOf(parts[0]));
      const last = parts[parts.length - 1];
      const end = Math.max(start + text.length, l.text.lastIndexOf(last) + last.length);
      const charW = l.w / l.text.length;
      return { ...l, text, x: l.x + start * charW, w: Math.max(charW, (end - start) * charW) };
    })
    .filter(l => l.w > 0 && l.h >= minH && isTranslatable(l.text))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  joinSameRow(lines);

  // Her satır, üstündeki birleşebileceği son paragrafa eklenir.
  const groups: Line[][] = [];
  for (const line of lines) {
    let target: Line[] | null = null;
    for (let i = groups.length - 1; i >= 0; i--) {
      const last = groups[i][groups[i].length - 1];
      if (line.y - (last.y + last.h) > Math.max(line.h, last.h) * 2) {
        continue;
      }
      if (canMerge(last, line)) {
        target = groups[i];
        break;
      }
    }
    if (target) {
      target.push(line);
    } else {
      groups.push([line]);
    }
  }

  const r = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000;
  const blocks = groups.map(g => {
    let text = '';
    for (const l of g) {
      text = !text ? l.text : text.endsWith('-') ? text.slice(0, -1) + l.text : `${text} ${l.text}`;
    }
    const left = Math.min(...g.map(l => l.x));
    const right = Math.max(...g.map(l => l.x + l.w));
    const top = Math.min(...g.map(l => l.y));
    const bottom = Math.max(...g.map(l => l.y + l.h));
    return {
      text,
      lines: g.length,
      box: {
        x: r(left / frameWidth),
        y: r(top / frameHeight),
        w: r((right - left) / frameWidth),
        h: r((bottom - top) / frameHeight),
      },
    };
  });
  return blocks.filter(b => b.text.split(' ').filter(Boolean).length >= minWords);
}

function overlaps(a: SubtitleBox, b: SubtitleBox): boolean {
  const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (ix <= 0 || iy <= 0) {
    return false;
  }
  const inter = ix * iy;
  return inter / Math.min(a.w * a.h, b.w * b.h) >= 0.4;
}

function boxMoved(a: SubtitleBox, b: SubtitleBox): boolean {
  const tol = Math.max(a.h, b.h) * 0.5;
  return (
    Math.abs(a.x - b.x) > tol ||
    Math.abs(a.y - b.y) > tol ||
    Math.abs(a.w - b.w) > tol * 2 ||
    Math.abs(a.h - b.h) > tol
  );
}

/** İki okumadaki bloklar aynı yazılar mı (OCR gürültüsüne toleranslı)? */
export function samePage(a: PageBlock[], b: PageBlock[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const used = new Set<number>();
  for (const x of a) {
    const nx = normalize(x.text);
    const j = b.findIndex(
      (y, i) => !used.has(i) && overlaps(x.box, y.box) && similarity(nx, normalize(y.text)) >= 0.7,
    );
    if (j < 0) {
      return false;
    }
    used.add(j);
  }
  return true;
}

/**
 * Sayfa düzeyinde kararlılık: aynı yazı kümesi [stableFrames] kez görülmeden yayınlanmaz
 * (sahne geçişinde yarım okunan yazılar TV'ye gitmesin). Görüntü değişmediyse bekleyen aday
 * onaylanır. Yazılar aynı kalıp sadece yer değiştirdiyse (kaydırma) yeni konumlar yayınlanır.
 */
export class PageChangeFilter {
  private published: PageBlock[] | null = null;
  private candidate: PageBlock[] | null = null;
  private seen = 0;
  /** Yakın zamanda yayınlanan bloklar (yazı kaybolup geri gelince aynı metin kullanılsın). */
  private recent: PageBlock[] = [];

  constructor(private readonly stableFrames: number) {}

  onRecognized(blocks: PageBlock[]): PageBlock[] | null {
    if (this.published && samePage(blocks, this.published)) {
      this.candidate = null;
      this.seen = 0;
      const moved = blocks.some(b => {
        const old = this.published!.find(p => overlaps(p.box, b.box) || normalize(p.text) === normalize(b.text));
        return !old || boxMoved(old.box, b.box);
      });
      if (moved) {
        this.published = this.keepKnownText(blocks);
        return this.published;
      }
      return null;
    }
    if (this.candidate && samePage(blocks, this.candidate)) {
      this.candidate = blocks;
      this.seen++;
    } else {
      this.candidate = blocks;
      this.seen = 1;
    }
    return this.confirm();
  }

  onFrameUnchanged(): PageBlock[] | null {
    if (!this.candidate) {
      return null;
    }
    this.seen++;
    return this.confirm();
  }

  reset() {
    this.published = null;
    this.candidate = null;
    this.seen = 0;
    this.recent = [];
  }

  /**
   * Aynı yerde neredeyse aynı okunan yazı, daha önce yayınlanan haliyle kalır: OCR gürültüsü
   * ("drink" -> "djnk") yeni çeviri isteği ve TV'de titreyen yazı üretmesin.
   */
  private keepKnownText(blocks: PageBlock[]): PageBlock[] {
    const known = [...(this.published ?? []), ...this.recent];
    const out = blocks.map(b => {
      const nb = normalize(b.text);
      const old = known.find(k => overlaps(k.box, b.box) && similarity(nb, normalize(k.text)) >= KEEP_TEXT_SIMILARITY);
      return old && old.text !== b.text ? { ...b, text: old.text } : b;
    });
    this.recent = [...out, ...this.recent].slice(0, RECENT_BLOCKS);
    return out;
  }

  private confirm(): PageBlock[] | null {
    if (!this.candidate || this.seen < this.stableFrames) {
      return null;
    }
    const out = this.keepKnownText(this.candidate);
    this.published = out;
    this.candidate = null;
    this.seen = 0;
    return out;
  }
}

/** Karenin okunacak bölgesi (0-1). */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Sol üstteki bilgilendirme kutusu (oyun ipuçları, görev bilgisi). GTA 6'nın ipucu kutusu
 * yüksekliğin ~%28'inden başlayıp birkaç satır aşağı uzanır; bölge altyazı şeridine (alttan
 * %30-40) girmeyecek kadar aşağı iner.
 */
export const INFO_REGION: Region = { x: 0, y: 0, w: 0.42, h: 0.55 };

/** Bilgi kutusunda tek satırlık kısa yazılar (para, saat, konum adı) çevrilmez. */
const MIN_INFO_WORDS = 3;

/**
 * Kare -> bölge kırpma -> piksel diff -> (gerekirse) OCR -> bloklar -> kararlılık -> olay.
 * Kutular tam kareye göre 0-1 aralığında yayınlanır.
 */
export class PagePipeline {
  /** Tam karede 16 satırlık ızgara kaba kalır; satır başına bir hücre yüksekliği hedeflenir. */
  private readonly pixelDiff = new FrameDiffDetector(64, 36, 14, 2);
  private readonly filter: PageChangeFilter;
  private ocrInFlight = false;
  private ocrStartedAt = 0;
  private requestId = 0;
  private frameId = 0;
  private closed = false;
  readonly stats = {
    frames: 0,
    unchanged: 0,
    ocrRuns: 0,
    ocrErrors: 0,
    lastOcrText: '',
    lastReject: null as string | null,
    emitted: 0,
    lastFrameSize: '',
  };

  constructor(
    private readonly ocr: OcrHelper,
    private readonly onPage: (ev: PageEvent) => void,
    private readonly region: Region = INFO_REGION,
    stableFrames = 2,
  ) {
    this.filter = new PageChangeFilter(stableFrames);
  }

  isReady(): boolean {
    if (this.closed) {
      return false;
    }
    if (this.ocrInFlight && Date.now() - this.ocrStartedAt > OCR_TIMEOUT_MS) {
      console.warn(`[page] OCR timed out, dropping request #${this.requestId}`);
      this.requestId++;
      this.ocrInFlight = false;
      this.pixelDiff.invalidate();
    }
    return !this.ocrInFlight;
  }

  /** Tam karenin grisi verilir; bölge burada kırpılır. */
  onFrame(full: Uint8Array, fullW: number, fullH: number) {
    if (!this.isReady()) {
      return;
    }
    const rx = Math.round(this.region.x * fullW);
    const ry = Math.round(this.region.y * fullH);
    const w = Math.round(this.region.w * fullW);
    const h = Math.round(this.region.h * fullH);
    if (w <= 0 || h <= 0) {
      return;
    }
    const gray = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const src = (ry + y) * fullW + rx;
      gray.set(full.subarray(src, src + w), y * w);
    }
    const id = ++this.frameId;
    this.stats.frames++;
    this.stats.lastFrameSize = `${w}×${h}`;
    if (!this.pixelDiff.hasChanged(gray, w, h)) {
      this.stats.unchanged++;
      const blocks = this.filter.onFrameUnchanged();
      if (blocks) {
        this.publish(blocks, id, 0);
      }
      return;
    }
    this.ocrInFlight = true;
    const requestId = ++this.requestId;
    const startedAt = Date.now();
    this.ocrStartedAt = startedAt;
    const latinFix = !(this.ocr.info.lang ?? 'en').toLowerCase().startsWith('en');
    this.ocr.recognize(gray, w, h).then(
      lines => {
        if (requestId !== this.requestId || this.closed) {
          return;
        }
        this.ocrInFlight = false;
        this.stats.ocrRuns++;
        this.stats.lastOcrText = lines.map(l => l.text).join(' / ').slice(0, 400);
        debugRecorder.ocr(id, gray, w, h, lines);
        const blocks = extractPageBlocks(lines, w, h, latinFix, MIN_INFO_WORDS).map(b => ({
          ...b,
          box: {
            x: this.region.x + b.box.x * this.region.w,
            y: this.region.y + b.box.y * this.region.h,
            w: b.box.w * this.region.w,
            h: b.box.h * this.region.h,
          },
        }));
        this.stats.lastReject = lines.length > 0 && blocks.length === 0 ? 'çevrilecek yazı yok' : null;
        const out = this.filter.onRecognized(blocks);
        if (out) {
          this.publish(out, id, Date.now() - startedAt);
        }
      },
      err => {
        if (requestId !== this.requestId) {
          return;
        }
        console.warn('[page] OCR failed', err?.message ?? err);
        this.stats.ocrErrors++;
        this.ocrInFlight = false;
        this.pixelDiff.invalidate();
      },
    );
  }

  close() {
    this.closed = true;
  }

  private publish(blocks: PageBlock[], frameId: number, ocrLatencyMs: number) {
    console.log(`[page] EMIT #${frameId}: ${blocks.length} blok · ${blocks.map(b => `"${b.text}"`).join(' | ').slice(0, 300)}`);
    this.stats.emitted++;
    debugRecorder.emit(frameId, blocks);
    this.onPage({ blocks, frameId, ocrLatencyMs });
  }
}

