import React from 'react';
import { ProtectedTermsCard } from '../../components/ProtectedTermsCard';
import { TranslationSettings } from '../../components/TranslationSettings';
import { Page } from '../../components/ui';
import { useDeepLKey } from '../../hooks/useDeepLKey';
import { useProtectedTerms } from '../../hooks/useProtectedTerms';
import { useTranslationEngine } from '../../hooks/useTranslationEngine';
import { DeepLTranslationService } from '../../services/translation/DeepLTranslationService';

interface Props {
  deeplKey: ReturnType<typeof useDeepLKey>;
  deepl: DeepLTranslationService | null;
  engine: ReturnType<typeof useTranslationEngine>;
  protectedTerms: ReturnType<typeof useProtectedTerms>;
}

/** Çeviri motoru, DeepL anahtarı ve çevrilmeyecek kelimeler. */
export function TranslationTab({
  deeplKey,
  deepl,
  engine,
  protectedTerms,
}: Props) {
  return (
    <Page
      title="Çeviri"
      subtitle="Çeviri motoru, DeepL anahtarı ve çevrilmeyecek kelimeler."
    >
      <TranslationSettings
        apiKey={deeplKey.apiKey}
        deepl={deepl}
        onSave={deeplKey.save}
        onClear={deeplKey.clear}
        engine={engine}
      />
      <ProtectedTermsCard
        terms={protectedTerms.terms}
        onAdd={protectedTerms.add}
        onRemove={protectedTerms.remove}
        onReset={protectedTerms.reset}
      />
    </Page>
  );
}
