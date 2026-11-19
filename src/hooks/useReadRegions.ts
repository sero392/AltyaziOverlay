import { useCallback, useEffect, useState } from 'react';
import { RemotePlay } from '../native/RemotePlay';
import { ReadRegion, SubtitleCapture } from '../native/SubtitleCapture';

const KEY_REGIONS = 'ocr_regions';

export const MAX_READ_REGIONS = 4;

/** Kurulum yapılmadıysa: ekranın alt %20'si (eski varsayılan okuma alanı). */
export const DEFAULT_READ_REGIONS: ReadRegion[] = [
  { x: 0, y: 0.8, w: 1, h: 0.2 },
];

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** Sınırları uygular, çok küçükleri atar; native ReadRegion.sanitize ile aynı kurallar. */
export function sanitizeRegions(list: unknown): ReadRegion[] {
  if (!Array.isArray(list)) {
    return DEFAULT_READ_REGIONS;
  }
  const clean = list
    .filter(
      (r): r is ReadRegion =>
        r != null &&
        ['x', 'y', 'w', 'h'].every(k => typeof r[k] === 'number' && isFinite(r[k])),
    )
    .map(r => {
      const x = clamp(r.x);
      const y = clamp(r.y);
      return { x, y, w: Math.min(clamp(r.w), 1 - x), h: Math.min(clamp(r.h), 1 - y) };
    })
    .filter(r => r.w >= 0.02 && r.h >= 0.02)
    .slice(0, MAX_READ_REGIONS);
  return clean.length > 0 ? clean : DEFAULT_READ_REGIONS;
}

export function isDefaultRegions(list: ReadRegion[]): boolean {
  return JSON.stringify(list) === JSON.stringify(DEFAULT_READ_REGIONS);
}

/** Ekranda OCR'lanacak alanlar (kalıcı). Okuma sürüyorsa değişiklik hemen uygulanır. */
export function useReadRegions() {
  const [regions, setState] = useState<ReadRegion[]>(DEFAULT_READ_REGIONS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    SubtitleCapture.getSetting(KEY_REGIONS).then(v => {
      if (v) {
        try {
          setState(sanitizeRegions(JSON.parse(v)));
        } catch {
          // bozuk kayıt: varsayılan kalır
        }
      }
      setLoaded(true);
    });
  }, []);

  const setRegions = useCallback((list: ReadRegion[]) => {
    const clean = sanitizeRegions(list);
    setState(clean);
    SubtitleCapture.setSetting(
      KEY_REGIONS,
      isDefaultRegions(clean) ? null : JSON.stringify(clean),
    );
    RemotePlay.setReadRegions(clean);
  }, []);

  return { regions, loaded, setRegions };
}
