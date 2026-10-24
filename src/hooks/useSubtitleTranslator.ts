import { useCallback, useEffect, useRef, useState } from 'react';
import { SubtitleEntry, TranslatorStats } from '../domain/types';
import { SubtitleCapture, SubtitleTextEvent } from '../native/SubtitleCapture';
import {
  TranslationService,
  isAbortError,
} from '../services/translation/TranslationService';
import { useSubtitleStream } from './useSubtitleStream';

const HISTORY_LIMIT = 30;

/**
 * Orkestrasyon: native metin -> çeviri -> yüzen pencere.
 *
 * - "En son kazanır": yeni altyazı gelince önceki çeviri isteği iptal edilir
 *   (AbortController), geç dönen eski yanıt pencereyi asla ezmez.
 * - Boş metin = altyazı kalktı -> pencere anında gizlenir, API çağrısı yok.
 * - Yüzen pencereye köprüden tek bir string gider; RN render ağacı overlay'e dahil değil.
 */
export function useSubtitleTranslator(service: TranslationService) {
  const [history, setHistory] = useState<SubtitleEntry[]>([]);
  const [stats, setStats] = useState<TranslatorStats>({
    received: 0,
    translated: 0,
    cacheHits: 0,
    dropped: 0,
  });

  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const patchEntry = useCallback(
    (id: number, patch: Partial<SubtitleEntry>) => {
      setHistory(h => h.map(e => (e.id === id ? { ...e, ...patch } : e)));
    },
    [],
  );

  const handleText = useCallback(
    async (event: SubtitleTextEvent) => {
      const text = event.text.trim();

      // Önceki istek artık geçersiz.
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
        setStats(s => ({ ...s, dropped: s.dropped + 1 }));
      }

      if (text.length === 0) {
        seqRef.current++;
        SubtitleCapture.setOverlayText('');
        return;
      }

      const id = ++seqRef.current;
      const controller = new AbortController();
      abortRef.current = controller;

      setStats(s => ({ ...s, received: s.received + 1 }));
      setHistory(h =>
        [
          {
            id,
            original: text,
            translated: null,
            status: 'pending' as const,
            ocrLatencyMs: event.ocrLatencyMs,
            translationLatencyMs: null,
            fromCache: false,
            receivedAt: Date.now(),
          },
          ...h,
        ].slice(0, HISTORY_LIMIT),
      );

      const startedAt = Date.now();
      try {
        const result = await service.translate(text, controller.signal);
        if (id !== seqRef.current) {
          return; // Bu arada yeni altyazı geldi.
        }
        abortRef.current = null;
        SubtitleCapture.setOverlayText(result.text);
        patchEntry(id, {
          translated: result.text,
          status: 'done',
          translationLatencyMs: Date.now() - startedAt,
          fromCache: result.fromCache,
        });
        setStats(s => ({
          ...s,
          translated: s.translated + 1,
          cacheHits: s.cacheHits + (result.fromCache ? 1 : 0),
        }));
      } catch (e) {
        if (isAbortError(e)) {
          patchEntry(id, {
            status: 'error',
            translated: '(iptal: yeni altyazı geldi)',
          });
          return;
        }
        if (id === seqRef.current) {
          abortRef.current = null;
          // Çeviri başarısızsa orijinali göster: hiç yoktan iyidir.
          SubtitleCapture.setOverlayText(text);
        }
        patchEntry(id, {
          status: 'error',
          translated: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [service, patchEntry],
  );

  useSubtitleStream(handleText);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const clearHistory = useCallback(() => setHistory([]), []);

  /** Oyun olmadan hattı denemek için sahte bir OCR olayı enjekte eder. */
  const simulate = useCallback(
    (text: string) =>
      handleText({ text, frameId: -1, ocrLatencyMs: 0, timestamp: Date.now() }),
    [handleText],
  );

  return { history, stats, clearHistory, simulate };
}
