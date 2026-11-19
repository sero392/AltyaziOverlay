import type { ReadRegion, SubtitleBox } from '../../shared/types';
import type { OcrLine } from './filters';

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** [width]x[height] karede piksel dikdörtgeni (en az 1 piksel, kare içinde). */
function toRect(r: ReadRegion, width: number, height: number): Rect {
  const c = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const left = c(Math.round(r.x * width), 0, width - 1);
  const top = c(Math.round(r.y * height), 0, height - 1);
  const right = c(Math.round((r.x + r.w) * width), left + 1, width);
  const bottom = c(Math.round((r.y + r.h) * height), top + 1, height);
  return { left, top, right, bottom };
}

/**
 * Seçili okuma alanlarının OCR karesine yerleşimi (Android RegionLayout ile aynı): alanlar alt
 * alta, her biri yatayda ortalanarak tek bir görüntüde birleştirilir (tek OCR çağrısı). Aralarına
 * boşluk konur ki farklı alanların satırları tek altyazı gibi birleşmesin.
 */
export class RegionLayout {
  /** Kaynak karedeki dikdörtgenler. */
  readonly sources: Rect[];
  readonly width: number;
  readonly height: number;
  readonly offsetsX: number[];
  readonly offsetsY: number[];
  /** Tek, tam genişlikte alan: kopyalamadan alt dizi verilir. */
  private readonly band: boolean;
  private buffer: Uint8Array | null = null;

  constructor(
    readonly regions: ReadRegion[],
    readonly sourceWidth: number,
    readonly sourceHeight: number,
  ) {
    this.sources = regions.map(r => toRect(r, sourceWidth, sourceHeight));
    const widths = this.sources.map(s => s.right - s.left);
    this.width = Math.max(...widths);
    const gap = Math.max(24, Math.floor(sourceHeight / 20));
    this.offsetsX = widths.map(w => Math.floor((this.width - w) / 2));
    let y = 0;
    this.offsetsY = this.sources.map(s => {
      const top = y;
      y += s.bottom - s.top + gap;
      return top;
    });
    this.height = y - gap;
    const only = this.sources.length === 1 ? this.sources[0] : null;
    this.band = !!only && only.left === 0 && only.right === sourceWidth;
  }

  matches(regions: ReadRegion[], w: number, h: number) {
    return regions === this.regions && w === this.sourceWidth && h === this.sourceHeight;
  }

  /** Tam gri kareden OCR karesini üretir. Dönen dizi bir sonraki çağrıda yeniden kullanılır. */
  compose(gray: Uint8Array): Uint8Array {
    const sw = this.sourceWidth;
    if (this.band) {
      const s = this.sources[0];
      return gray.subarray(s.top * sw, s.bottom * sw);
    }
    const out = (this.buffer ??= new Uint8Array(this.width * this.height));
    out.fill(0);
    this.sources.forEach((s, i) => {
      const w = s.right - s.left;
      for (let y = s.top; y < s.bottom; y++) {
        const src = y * sw + s.left;
        out.set(gray.subarray(src, src + w), (this.offsetsY[i] + y - s.top) * this.width + this.offsetsX[i]);
      }
    });
    return out;
  }

  /** OCR karesindeki satırların kapsadığı kutuyu tam kareye göre 0-1 aralığına çevirir. */
  toFrameBox(lines: OcrLine[]): SubtitleBox {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const l of lines) {
      const i = this.regionAt((l.top + l.bottom) / 2);
      const s = this.sources[i];
      const dx = s.left - this.offsetsX[i];
      const dy = s.top - this.offsetsY[i];
      const clampX = (v: number) => Math.min(s.right, Math.max(s.left, v + dx));
      const clampY = (v: number) => Math.min(s.bottom, Math.max(s.top, v + dy));
      left = Math.min(left, clampX(l.left ?? this.offsetsX[i]));
      right = Math.max(right, clampX(l.right ?? this.offsetsX[i] + s.right - s.left));
      top = Math.min(top, clampY(l.top));
      bottom = Math.max(bottom, clampY(l.bottom));
    }
    const r = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000;
    return {
      x: r(left / this.sourceWidth),
      y: r(top / this.sourceHeight),
      w: r((right - left) / this.sourceWidth),
      h: r((bottom - top) / this.sourceHeight),
    };
  }

  /** OCR karesinde [y] hangi alana düşüyor (aradaki boşluktaysa en yakını). */
  private regionAt(y: number): number {
    let best = 0;
    let bestDist = Infinity;
    this.sources.forEach((s, i) => {
      const top = this.offsetsY[i];
      const bottom = top + s.bottom - s.top;
      const d = y < top ? top - y : y > bottom ? y - bottom : 0;
      if (d < bestDist) {
        best = i;
        bestDist = d;
      }
    });
    return best;
  }
}
