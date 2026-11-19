import { useCallback, useEffect, useState } from 'react';
import { SubtitleCapture } from '../native/SubtitleCapture';

const KEY_INTERVAL = 'ocr_interval_ms';

export const OCR_INTERVALS = [300, 500, 800];

/** Arayüzde okuma aralığı gizliyken kullanılan sabit değer. Okuma alanı: useReadRegions. */
export const DEFAULT_OCR_SETTINGS = { intervalMs: 300 };

/** OCR aralığı (kalıcı). Şu an arayüzde kullanılmıyor. */
export function useOcrSettings() {
  const [intervalMs, setIntervalState] = useState(
    DEFAULT_OCR_SETTINGS.intervalMs,
  );

  useEffect(() => {
    SubtitleCapture.getSetting(KEY_INTERVAL).then(v => {
      if (v && OCR_INTERVALS.includes(Number(v))) {
        setIntervalState(Number(v));
      }
    });
  }, []);

  const setIntervalMs = useCallback((v: number) => {
    setIntervalState(v);
    SubtitleCapture.setSetting(KEY_INTERVAL, String(v));
  }, []);

  return { intervalMs, setIntervalMs };
}
