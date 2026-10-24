import { useCallback, useEffect, useState } from 'react';
import { SubtitleCapture } from '../native/SubtitleCapture';
import { DEFAULT_PROTECTED_TERMS } from '../services/translation/protectedTerms';

const KEY_TERMS = 'protected_terms';

/** Çevrilmeyecek kelimeler listesi (kalıcı). Kayıt yoksa RDR2 varsayılan listesi. */
export function useProtectedTerms() {
  const [terms, setTerms] = useState<string[]>(DEFAULT_PROTECTED_TERMS);

  useEffect(() => {
    SubtitleCapture.getSetting(KEY_TERMS).then(v => {
      if (!v) {
        return;
      }
      try {
        const parsed = JSON.parse(v);
        if (Array.isArray(parsed)) {
          setTerms(parsed.filter(t => typeof t === 'string'));
        }
      } catch {
        // Bozuk kayıt: varsayılan kalır.
      }
    });
  }, []);

  const save = useCallback((next: string[]) => {
    setTerms(next);
    SubtitleCapture.setSetting(KEY_TERMS, JSON.stringify(next));
  }, []);

  const add = useCallback(
    (term: string) => {
      const t = term.trim();
      if (t && !terms.includes(t)) {
        save([...terms, t]);
      }
    },
    [terms, save],
  );

  const remove = useCallback(
    (term: string) => save(terms.filter(t => t !== term)),
    [terms, save],
  );

  const reset = useCallback(() => {
    setTerms(DEFAULT_PROTECTED_TERMS);
    SubtitleCapture.setSetting(KEY_TERMS, null);
  }, []);

  return { terms, add, remove, reset };
}
