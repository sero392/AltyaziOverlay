import { OcrHelper, OcrRawLine } from '../native/ocrHelper';
import { correctOcrEnglish } from './ocrCorrections';
import type { ReadRegion, SubtitleBox } from '../../shared/types';
import { RegionLayout } from './regionLayout';
import {
  FrameDiffDetector,
  OcrLine,
  TextChangeFilter,
  cleanSubtitleText,
  isUiText,
  selectSubtitle,
  stripTrailingObjective,
} from './filters';

export interface SubtitleEvent {
  /** Ham OCR metni. "" = altyazı ekrandan kalktı. */
  text: string;
  frameId: number;
  ocrLatencyMs: number;
  timestamp: number;
  /** İngilizce altyazının tam karedeki yeri (0-1); TV çeviriyi tam üstüne yazar. */
  box?: SubtitleBox | null;
}

export interface PipelineConfig {
  /** Okuma alanları; değiştirilince sonraki kare yeni alanlarla okunur. */
  regions: ReadRegion[];
  stableFrames: number;
  similarityThreshold: number;
}

const OCR_TIMEOUT_MS = 3000;
/** Ekran yüksekliğine göre minimum satır yüksekliği (küçük HUD yazılarını eler). */
const MIN_LINE_HEIGHT_RATIO = 0.012;
/** Satır merkezinin ekran merkezinden en fazla sapması (genişliğin oranı). */
const MAX_CENTER_OFFSET_RATIO = 0.15;
/** Okuma alanında bundan fazla yazı satırı varsa ekranda menü vardır. */
const MAX_TEXT_LINES_ON_SCREEN = 6;
const WHITESPACE = /\s+/g;

/**
 * İngilizce OCR dil paketi yoksa Windows OCR başka bir Latin dil (ör. Türkçe) modeliyle okur
 * ve İngilizce metne o dilin harflerini karıştırabilir ("ı", "ş"). İngilizce altyazıda bu
 * harfler hiç geçmediği için ASCII karşılıklarına çevrilir.
 */
const LATIN_FIX: Record<string, string> = {
  ı: 'i', İ: 'I', ş: 's', Ş: 'S', ğ: 'g', Ğ: 'G', ç: 'c', Ç: 'C', ö: 'o', Ö: 'O', ü: 'u', Ü: 'U',
};
const LATIN_FIX_RE = new RegExp(`[${Object.keys(LATIN_FIX).join('')}]`, 'g');

/**
 * OCR satırlarını altyazı metnine indirger (Android TextRecognizerEngine.extract ile aynı):
 * küçük HUD yazıları, harfsiz satırlar, ortalanmamış satırlar ve arayüz yazıları elenir,
 * ardından menü / envanter sezgileri uygulanır. Windows OCR güven puanı vermez.
 */
export function extractSubtitle(
  lines: OcrRawLine[],
  /** OCR karesinin (birleştirilmiş alanlar) tam kareyle ilişkisi. */
  layout: RegionLayout,
  latinFix: boolean,
  /** Tanılama: metin elendiyse nedeni buraya yazılır. */
  diag?: { reason: string | null },
  /** Altyazı bulunduysa tam karedeki konumu buraya yazılır. */
  geo?: { box: SubtitleBox | null },
): string {
  // Eşikler tam ekrana göre: alanlar OCR karesinde yatayda ortalanır; dar bir alan seçildiyse
  // (ör. diyalog kutusu) içindeki satırların hepsi ortalama sınırından geçer.
  const minLineHeight = layout.sourceHeight * MIN_LINE_HEIGHT_RATIO;
  const centerX = layout.width / 2;
  const maxCenterOffset = layout.sourceWidth * MAX_CENTER_OFFSET_RATIO;
  const reject = (reason: string) => {
    if (diag) {
      diag.reason = reason;
    }
    return '';
  };

  const fixed = lines.map(l => ({
    ...l,
    text: correctOcrEnglish(latinFix ? l.text.replace(LATIN_FIX_RE, c => LATIN_FIX[c]) : l.text),
  }));
  const textLines = fixed.filter(
    l =>
      l.h >= minLineHeight &&
      [...l.text].filter(c => /\p{L}/u.test(c)).length >= 2 &&
      !isUiText(l.text),
  );
  if (textLines.length > MAX_TEXT_LINES_ON_SCREEN) {
    return reject(`ekranda ${textLines.length} satır (menü)`);
  }
  const centered: OcrLine[] = textLines
    .filter(l => Math.abs(l.x + l.w / 2 - centerX) <= maxCenterOffset)
    .map(l => ({
      text: l.text.replace(WHITESPACE, ' '),
      top: l.y,
      bottom: l.y + l.h,
      left: l.x,
      right: l.x + l.w,
    }));
  if (fixed.length > 0 && centered.length === 0) {
    return reject(
      textLines.length === 0
        ? 'satırlar çok küçük ya da arayüz yazısı'
        : 'satırlar ortalanmamış',
    );
  }

  const selected = selectSubtitle(centered);
  if (selected.rejectReason) {
    return reject(selected.rejectReason);
  }
  const text = cleanSubtitleText(stripTrailingObjective(selected.text.replace(WHITESPACE, ' ').trim()));
  if (geo && text && selected.lines?.length) {
    geo.box = layout.toFrameBox(selected.lines);
  }
  return text;
}

/**
 * Kare -> piksel diff -> (gerekirse) OCR -> metin diff -> olay.
 * Aynı anda en fazla bir OCR çalışır; meşgulken gelen kareler atılır.
 */
export class SubtitlePipeline {
  private readonly pixelDiff = new FrameDiffDetector();
  private readonly textFilter: TextChangeFilter;
  private ocrInFlight = false;
  private ocrStartedAt = 0;
  private requestId = 0;
  private frameId = 0;
  private closed = false;
  /** Son okunan altyazının konumu; yayınlanan metinle birlikte gönderilir. */
  private lastBox: SubtitleBox | null = null;
  /** Tanılama sayaçları (arayüzdeki "Hat durumu" kartı). */
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
    readonly config: PipelineConfig,
    private readonly ocr: OcrHelper,
    private readonly onSubtitle: (ev: SubtitleEvent) => void,
    /** İlk kez okunan (henüz onaylanmamış) altyazı: çeviri erkenden başlatılabilir. */
    private readonly onCandidate?: (text: string) => void,
  ) {
    this.textFilter = new TextChangeFilter(config.stableFrames, config.similarityThreshold);
  }

  isReady(): boolean {
    if (this.closed) {
      return false;
    }
    if (this.ocrInFlight && Date.now() - this.ocrStartedAt > OCR_TIMEOUT_MS) {
      console.warn(`[pipeline] OCR timed out, dropping request #${this.requestId}`);
      this.requestId++;
      this.ocrInFlight = false;
      this.pixelDiff.invalidate();
    }
    return !this.ocrInFlight;
  }

  /** @param gray [layout] ile birleştirilmiş OCR karesi (layout.width x layout.height). */
  onFrame(gray: Uint8Array, layout: RegionLayout) {
    if (!this.isReady()) {
      return;
    }
    const w = layout.width;
    const h = layout.height;
    const id = ++this.frameId;
    this.stats.frames++;
    this.stats.lastFrameSize = `${w}×${h}`;
    if (!this.pixelDiff.hasChanged(gray, w, h)) {
      this.stats.unchanged++;
      const text = this.textFilter.onFrameUnchanged();
      if (text !== null) {
        this.publish(text, id, 0);
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
        this.stats.lastOcrText = lines.map(l => l.text).join(' / ');
        const diag = { reason: null as string | null };
        const geo = { box: null as SubtitleBox | null };
        const text = extractSubtitle(lines, layout, latinFix, diag, geo);
        if (text && geo.box) {
          this.lastBox = geo.box;
        }
        if (lines.length > 0) {
          this.stats.lastReject = diag.reason;
        }
        const emitted = this.textFilter.onRecognized(text);
        if (emitted !== null) {
          this.publish(emitted, id, Date.now() - startedAt);
        } else {
          const fresh = this.textFilter.freshCandidate();
          if (fresh) {
            this.onCandidate?.(fresh);
          }
        }
      },
      err => {
        if (requestId !== this.requestId) {
          return;
        }
        console.warn('[pipeline] OCR failed', err?.message ?? err);
        this.stats.ocrErrors++;
        this.ocrInFlight = false;
        this.pixelDiff.invalidate();
      },
    );
  }

  close() {
    this.closed = true;
  }

  private publish(text: string, frameId: number, ocrLatencyMs: number) {
    console.log(`[pipeline] EMIT #${frameId}: "${text}"`);
    this.stats.emitted++;
    this.onSubtitle({
      text,
      frameId,
      ocrLatencyMs,
      timestamp: Date.now(),
      box: text ? this.lastBox : null,
    });
  }
}
