import { useEffect, useRef } from 'react';
import { SubtitleCapture, SubtitleTextEvent } from '../native/SubtitleCapture';

/**
 * Native'den gelen (zaten filtrelenmiş) altyazı olaylarına abone olur.
 * Callback ref'te tutulur: her render'da yeniden abone olunmaz.
 */
export function useSubtitleStream(onText: (event: SubtitleTextEvent) => void) {
  const handlerRef = useRef(onText);
  handlerRef.current = onText;

  useEffect(() => {
    const sub = SubtitleCapture.onText(e => handlerRef.current(e));
    return () => sub?.remove();
  }, []);
}
