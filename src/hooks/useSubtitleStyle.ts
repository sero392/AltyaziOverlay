import { useCallback, useEffect, useState } from 'react';
import { SubtitleCapture, SubtitleStyle } from '../native/SubtitleCapture';

const KEY_STYLE = 'subtitle_style';

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontSize: 30,
  textColor: '#FFFFFF',
  bgColor: '#000000',
  bgOpacity: 75,
};

/**
 * Altyazı görünümü (kalıcı). Native taraf ayarı kendisi saklar ve açılışta yükler;
 * buradaki her değişiklik telefondaki pencereye ve TV'ye anında gider.
 */
export function useSubtitleStyle() {
  const [style, setStyle] = useState<SubtitleStyle>(DEFAULT_SUBTITLE_STYLE);

  useEffect(() => {
    SubtitleCapture.getSetting(KEY_STYLE).then(v => {
      if (!v) {
        return;
      }
      try {
        setStyle({ ...DEFAULT_SUBTITLE_STYLE, ...JSON.parse(v) });
      } catch {
        // Bozuk kayıt: varsayılan kalır.
      }
    });
  }, []);

  const update = useCallback((patch: Partial<SubtitleStyle>) => {
    setStyle(prev => {
      const next = { ...prev, ...patch };
      SubtitleCapture.setSubtitleStyle(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setStyle(DEFAULT_SUBTITLE_STYLE);
    SubtitleCapture.setSubtitleStyle(DEFAULT_SUBTITLE_STYLE);
  }, []);

  return { style, update, reset };
}
