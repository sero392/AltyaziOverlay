// Okuma alanları: ekranda OCR'lanacak dikdörtgenler (mobildeki useReadRegions / ReadRegion.kt).
import type { ReadRegion } from './types';

export const MAX_READ_REGIONS = 4;
const MIN_SIZE = 0.02;

/** Kurulum yapılmadıysa: ekranın alt %30'u (masaüstü varsayılanı, bkz. DEFAULT_OCR notu). */
export const DEFAULT_READ_REGIONS: ReadRegion[] = [{ x: 0, y: 0.7, w: 1, h: 0.3 }];

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** Sınırları uygular, çok küçükleri atar, yukarıdan aşağı sıralar; boşsa varsayılan. */
export function sanitizeRegions(list: unknown): ReadRegion[] {
  if (!Array.isArray(list)) {
    return DEFAULT_READ_REGIONS;
  }
  const clean = list
    .filter(
      (r): r is ReadRegion =>
        r != null &&
        (['x', 'y', 'w', 'h'] as const).every(k => typeof r[k] === 'number' && Number.isFinite(r[k])),
    )
    .map(r => {
      const x = clamp(r.x);
      const y = clamp(r.y);
      return { x, y, w: Math.min(clamp(r.w), 1 - x), h: Math.min(clamp(r.h), 1 - y) };
    })
    .filter(r => r.w >= MIN_SIZE && r.h >= MIN_SIZE)
    .slice(0, MAX_READ_REGIONS)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  return clean.length > 0 ? clean : DEFAULT_READ_REGIONS;
}

export function isDefaultRegions(list: ReadRegion[]): boolean {
  return JSON.stringify(list) === JSON.stringify(DEFAULT_READ_REGIONS);
}

/** Eski "alttan oran" ayarının alan karşılığı. */
export function regionFromCropRatio(cropRatio: number): ReadRegion {
  const h = clamp(cropRatio);
  return { x: 0, y: Math.round((1 - h) * 10000) / 10000, w: 1, h };
}
