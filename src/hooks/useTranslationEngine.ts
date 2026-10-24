import { useCallback, useEffect, useState } from 'react';
import { SubtitleCapture } from '../native/SubtitleCapture';

const KEY_ENGINE = 'translation_engine';

/**
 * auto: DeepL anahtarı varsa DeepL, kota dolunca / hata olunca ML Kit.
 * deepl: sadece DeepL. mlkit: sadece ML Kit (ücretsiz, cihazda).
 */
export type TranslationEngine = 'auto' | 'deepl' | 'mlkit';

const ENGINES: TranslationEngine[] = ['auto', 'deepl', 'mlkit'];

/** Çeviri motoru seçimi (kalıcı) ve ML Kit dil modelinin durumu. */
export function useTranslationEngine() {
  const [engine, setEngineState] = useState<TranslationEngine>('auto');
  const [modelReady, setModelReady] = useState<boolean | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const refreshModel = useCallback(() => {
    SubtitleCapture.mlkitModelDownloaded()
      .then(setModelReady)
      .catch(() => setModelReady(false));
  }, []);

  useEffect(() => {
    SubtitleCapture.getSetting(KEY_ENGINE).then(v => {
      if (v && ENGINES.includes(v as TranslationEngine)) {
        setEngineState(v as TranslationEngine);
      }
    });
    refreshModel();
  }, [refreshModel]);

  const setEngine = useCallback((v: TranslationEngine) => {
    setEngineState(v);
    SubtitleCapture.setSetting(KEY_ENGINE, v === 'auto' ? null : v);
  }, []);

  const downloadModel = useCallback(async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      await SubtitleCapture.mlkitDownloadModel();
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
      refreshModel();
    }
  }, [refreshModel]);

  return {
    engine,
    setEngine,
    modelReady,
    downloading,
    downloadError,
    downloadModel,
    refreshModel,
  };
}
