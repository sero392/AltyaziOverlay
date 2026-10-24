import { useCallback, useEffect, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { RemotePlay } from '../native/RemotePlay';
import { CaptureOptions, SubtitleCapture } from '../native/SubtitleCapture';

/**
 * Kare kaynağı. 'remoteplay': PS5 yayını (chiaki-ng) — varsayılan.
 * 'screen': ekran yakalama (MediaProjection + ayrı Chiaki uygulaması) — yedek, devre dışı;
 * kodu korunuyor, gerekirse buradan tekrar açılabilir.
 */
const CAPTURE_SOURCE: 'remoteplay' | 'screen' = 'remoteplay';

/** Altyazı okuma servisinin yaşam döngüsü: başlat / durdur / native durum olayları. */
export function useCaptureSession() {
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    SubtitleCapture.isRunning().then(setRunning);
    const sub = SubtitleCapture.onState(e => {
      setRunning(e.running);
      // Remote Play yeniden bağlanınca hata null gelir ve mesaj kalkar.
      setError(e.error);
    });
    return () => sub?.remove();
  }, []);

  const start = useCallback(async (options?: CaptureOptions) => {
    setError(null);
    setStarting(true);
    try {
      // Android 13+: bildirim izni yoksa servis yine çalışır ama bildirim görünmez.
      if (Platform.OS === 'android' && Platform.Version >= 33) {
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        );
      }
      if (CAPTURE_SOURCE === 'remoteplay') {
        await RemotePlay.startStreaming(options);
      } else {
        await SubtitleCapture.start(options);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }, []);

  const stop = useCallback(() => {
    SubtitleCapture.stop();
    SubtitleCapture.setOverlayText('');
  }, []);

  return { running, starting, error, start, stop };
}
