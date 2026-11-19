import React, { useEffect, useMemo, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TabBar, TabItem } from '../components/TabBar';
import { colors } from '../components/ui';
import { useCaptureSession } from '../hooks/useCaptureSession';
import { useDeepLKey } from '../hooks/useDeepLKey';
import { DEFAULT_OCR_SETTINGS } from '../hooks/useOcrSettings';
import { useOverlayPermission } from '../hooks/useOverlayPermission';
import { useProtectedTerms } from '../hooks/useProtectedTerms';
import { isDefaultRegions, useReadRegions } from '../hooks/useReadRegions';
import { useSubtitleStyle } from '../hooks/useSubtitleStyle';
import { useSubtitleTranslator } from '../hooks/useSubtitleTranslator';
import {
  TranslationEngine,
  useTranslationEngine,
} from '../hooks/useTranslationEngine';
import { useTvLink } from '../hooks/useTvLink';
import { SubtitleCapture } from '../native/SubtitleCapture';
import { CachedTranslationService } from '../services/translation/CachedTranslationService';
import { DeepLTranslationService } from '../services/translation/DeepLTranslationService';
import { FallbackTranslationService } from '../services/translation/FallbackTranslationService';
import { MlKitTranslationService } from '../services/translation/MlKitTranslationService';
import { TranslationService } from '../services/translation/TranslationService';
import { AppearanceTab } from './tabs/AppearanceTab';
import { RegionSetupScreen } from './RegionSetupScreen';
import { DevicesTab } from './tabs/DevicesTab';
import { ReadingTab } from './tabs/ReadingTab';
import { TranslationTab } from './tabs/TranslationTab';

type Tab = 'reading' | 'translation' | 'appearance' | 'devices';

/**
 * Yönetim paneli: alttaki sekmelerle Okuma / Çeviri / Görünüm / Cihazlar sayfaları.
 * Durum (çevirmen, oturum, ayarlar) burada tutulur; sekme değişince kaybolmaz.
 * OCR aralığı şimdilik gizli (DEFAULT_OCR_SETTINGS); okuma alanları kurulum ekranından seçilir.
 */
export function HomeScreen({ onOpenWizard }: { onOpenWizard: () => void }) {
  const [tab, setTab] = useState<Tab>('reading');
  const [editingRegions, setEditingRegions] = useState(false);

  // Android geri tuşu: ana sekmede değilsek önce ana sekmeye dön.
  useEffect(() => {
    if (tab === 'reading') {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setTab('reading');
      return true;
    });
    return () => sub.remove();
  }, [tab]);

  const deeplKey = useDeepLKey();
  const protectedTerms = useProtectedTerms();
  const deepl = useMemo(
    () =>
      deeplKey.apiKey
        ? new DeepLTranslationService(
            deeplKey.apiKey,
            SubtitleCapture.httpRequest,
            protectedTerms.terms,
          )
        : null,
    [deeplKey.apiKey, protectedTerms.terms],
  );
  const engine = useTranslationEngine();
  const mlkit = useMemo(
    () =>
      new MlKitTranslationService(
        SubtitleCapture.mlkitTranslate,
        protectedTerms.terms,
      ),
    [protectedTerms.terms],
  );
  // Otomatik modda DeepL kotası dolunca / anahtar geçersizse ML Kit'e geçilir; neden burada tutulur.
  const [deeplOffReason, setDeeplOffReason] = useState<string | null>(null);
  useEffect(() => setDeeplOffReason(null), [deepl, engine.engine]);

  // Anahtar ya da motor değişmedikçe tek örnek (önbellek korunur). Anahtar yoksa ML Kit.
  const translator = useMemo(() => {
    let inner: TranslationService = mlkit;
    if (deepl && engine.engine === 'deepl') {
      inner = deepl;
    } else if (deepl && engine.engine === 'auto') {
      inner = new FallbackTranslationService(deepl, mlkit, setDeeplOffReason);
    }
    return new CachedTranslationService(inner);
  }, [deepl, engine.engine, mlkit]);

  const engineNote = describeEngine(
    engine.engine,
    !!deepl,
    deeplOffReason,
    engine.modelReady,
  );

  const tv = useTvLink();
  const overlay = useOverlayPermission();
  const session = useCaptureSession();
  const subtitleStyle = useSubtitleStyle();
  const readRegions = useReadRegions();
  const { history, clearHistory } = useSubtitleTranslator(translator);

  // ML Kit modeli ilk çeviride indirilir; çeviri gelince durum notunu tazele.
  const { modelReady, refreshModel } = engine;
  const hasHistory = history.length > 0;
  useEffect(() => {
    if (hasHistory && modelReady === false) {
      refreshModel();
    }
  }, [hasHistory, modelReady, refreshModel]);

  const onToggle = () => {
    if (session.running) {
      session.stop();
    } else {
      session.start({
        ...DEFAULT_OCR_SETTINGS,
        regions: readRegions.regions,
      });
    }
  };

  if (editingRegions) {
    return (
      <RegionSetupScreen
        initial={readRegions.regions}
        onSave={list => {
          readRegions.setRegions(list);
          setEditingRegions(false);
        }}
        onCancel={() => setEditingRegions(false)}
      />
    );
  }

  const tabs: TabItem<Tab>[] = [
    { key: 'reading', label: 'Okuma', icon: '▶︎', badge: session.running },
    { key: 'translation', label: 'Çeviri', icon: '⇄' },
    { key: 'appearance', label: 'Görünüm', icon: 'Aa' },
    { key: 'devices', label: 'Cihazlar', icon: '▣' },
  ];

  let content: React.ReactNode;
  switch (tab) {
    case 'reading':
      content = (
        <ReadingTab
          session={session}
          overlay={overlay}
          engineNote={engineNote}
          history={history}
          onToggle={onToggle}
          onClearHistory={clearHistory}
          regionsNote={
            isDefaultRegions(readRegions.regions)
              ? "Varsayılan: ekranın alt %20'si."
              : `${readRegions.regions.length} alan seçili.`
          }
          onEditRegions={() => setEditingRegions(true)}
        />
      );
      break;
    case 'translation':
      content = (
        <TranslationTab
          deeplKey={deeplKey}
          deepl={deepl}
          engine={engine}
          protectedTerms={protectedTerms}
        />
      );
      break;
    case 'appearance':
      content = <AppearanceTab subtitleStyle={subtitleStyle} />;
      break;
    case 'devices':
      content = <DevicesTab tv={tv} onOpenWizard={onOpenWizard} />;
      break;
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <View style={styles.content}>{content}</View>
      <TabBar tabs={tabs} active={tab} onChange={setTab} />
    </SafeAreaView>
  );
}

/** "Altyazı okuma" kartında hangi çevirinin kullanıldığını anlatan satır. */
function describeEngine(
  engine: TranslationEngine,
  hasDeepL: boolean,
  deeplOffReason: string | null,
  modelReady: boolean | null,
): { text: string; warn: boolean } {
  const modelNote =
    modelReady === false ? ' Dil modeli ilk çeviride indirilecek (~30 MB).' : '';
  if (engine === 'mlkit') {
    return { text: `Çeviri: Google ML Kit.${modelNote}`, warn: false };
  }
  if (!hasDeepL) {
    return {
      text: `DeepL anahtarı yok: çeviri Google ML Kit ile yapılır.${modelNote}`,
      warn: true,
    };
  }
  if (engine === 'deepl') {
    return { text: 'Çeviri: DeepL.', warn: false };
  }
  if (deeplOffReason) {
    return {
      text: `${deeplOffReason}. Bu oturumda Google ML Kit kullanılıyor.`,
      warn: true,
    };
  }
  return { text: 'Çeviri: DeepL (sorun olursa Google ML Kit).', warn: false };
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1 },
});
