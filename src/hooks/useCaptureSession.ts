import { useCallback, useEffect, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { CaptureOptions, SubtitleCapture } from '../native/SubtitleCapture';

/** Foreground service yaşam döngüsü: başlat / durdur / native durum olayları. */
export function useCaptureSession() {
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    SubtitleCapture.isRunning().then(setRunning);
    const sub = SubtitleCapture.onState(e => {
      setRunning(e.running);
      if (e.error) {
        setError(e.error);
      }
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
      await SubtitleCapture.start(options);
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
