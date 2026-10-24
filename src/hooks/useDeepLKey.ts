import { useCallback, useEffect, useState } from 'react';
import { SubtitleCapture } from '../native/SubtitleCapture';

const SETTING_KEY = 'deepl_api_key';

/** DeepL API anahtarı; cihazda uygulamaya özel depoda (SharedPreferences) saklanır. */
export function useDeepLKey() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    SubtitleCapture.getSetting(SETTING_KEY)
      .then(setApiKey)
      .finally(() => setLoaded(true));
  }, []);

  const save = useCallback(async (key: string) => {
    const trimmed = key.trim();
    await SubtitleCapture.setSetting(SETTING_KEY, trimmed || null);
    setApiKey(trimmed || null);
  }, []);

  const clear = useCallback(async () => {
    await SubtitleCapture.setSetting(SETTING_KEY, null);
    setApiKey(null);
  }, []);

  return { apiKey, loaded, save, clear };
}

/** Anahtarı ekranda göstermek için maskeler: "••••a1b2:fx". */
export const maskKey = (key: string) =>
  key.length <= 8 ? '••••' : `••••${key.slice(-7)}`;
