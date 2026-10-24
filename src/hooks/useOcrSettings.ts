import { useCallback, useEffect, useState } from 'react';
import { SubtitleCapture } from '../native/SubtitleCapture';

const KEY_INTERVAL = 'ocr_interval_ms';
const KEY_CROP = 'ocr_crop_ratio';

export const OCR_INTERVALS = [300, 500, 800];
export const OCR_CROP_RATIOS = [0.2, 0.3, 0.4];

/**
 * OCR aralığı ve okuma alanı (kalıcı). Ara sahnelerde altyazı siyah bantta (alt ~%15),
 * oynanışta daha yukarıda (~%25-30) olduğu için varsayılan %30.
 */
export function useOcrSettings() {
  const [intervalMs, setIntervalState] = useState(500);
  const [cropRatio, setCropState] = useState(0.3);

  useEffect(() => {
    SubtitleCapture.getSetting(KEY_INTERVAL).then(v => {
      if (v && OCR_INTERVALS.includes(Number(v))) {
        setIntervalState(Number(v));
      }
    });
    SubtitleCapture.getSetting(KEY_CROP).then(v => {
      if (v && OCR_CROP_RATIOS.includes(Number(v))) {
        setCropState(Number(v));
      }
    });
  }, []);

  const setIntervalMs = useCallback((v: number) => {
    setIntervalState(v);
    SubtitleCapture.setSetting(KEY_INTERVAL, String(v));
  }, []);

  const setCropRatio = useCallback((v: number) => {
    setCropState(v);
    SubtitleCapture.setSetting(KEY_CROP, String(v));
  }, []);

  return { intervalMs, cropRatio, setIntervalMs, setCropRatio };
}
