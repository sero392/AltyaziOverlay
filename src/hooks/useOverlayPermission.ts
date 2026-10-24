import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { SubtitleCapture } from '../native/SubtitleCapture';

/**
 * SYSTEM_ALERT_WINDOW durumu. Kullanıcı ayarlardan döndüğünde (AppState -> active)
 * otomatik yeniden kontrol edilir.
 */
export function useOverlayPermission() {
  const [granted, setGranted] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    setGranted(await SubtitleCapture.hasOverlayPermission());
  }, []);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        refresh();
      }
    });
    return () => sub.remove();
  }, [refresh]);

  return {
    granted,
    request: SubtitleCapture.requestOverlayPermission,
    refresh,
  };
}
