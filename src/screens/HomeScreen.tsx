import React, { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ConsoleCard } from '../components/ConsoleCard';
import { TranslationSettings } from '../components/TranslationSettings';
import { TvSettingsCard } from '../components/TvSettingsCard';
import { Button, Card, Para, colors } from '../components/ui';
import { SubtitleEntry } from '../domain/types';
import { useCaptureSession } from '../hooks/useCaptureSession';
import { useDeepLKey } from '../hooks/useDeepLKey';
import { DEFAULT_OCR_SETTINGS } from '../hooks/useOcrSettings';
import { useOverlayPermission } from '../hooks/useOverlayPermission';
import { useSubtitleTranslator } from '../hooks/useSubtitleTranslator';
import { useTvLink } from '../hooks/useTvLink';
import { SubtitleCapture } from '../native/SubtitleCapture';
import { CachedTranslationService } from '../services/translation/CachedTranslationService';
import { DeepLTranslationService } from '../services/translation/DeepLTranslationService';
import { MockTranslationService } from '../services/translation/MockTranslationService';

/**
 * Yönetim paneli: altyazı okumayı başlat/durdur, PS5 durumu, DeepL, TV ve son çeviriler.
 * Okuma ayarları şimdilik gizli; DEFAULT_OCR_SETTINGS kullanılır.
 */
export function HomeScreen({ onOpenWizard }: { onOpenWizard: () => void }) {
  const deeplKey = useDeepLKey();
  const deepl = useMemo(
    () =>
      deeplKey.apiKey
        ? new DeepLTranslationService(
            deeplKey.apiKey,
            SubtitleCapture.httpRequest,
          )
        : null,
    [deeplKey.apiKey],
  );
  // Anahtar varsa DeepL, yoksa sahte servis. Anahtar değişmedikçe tek örnek (önbellek korunur).
  const translator = useMemo(
    () =>
      new CachedTranslationService(
        deepl ?? new MockTranslationService(SubtitleCapture.delay),
      ),
    [deepl],
  );

  const tv = useTvLink();
  const overlay = useOverlayPermission();
  const session = useCaptureSession();
  const { history, clearHistory } = useSubtitleTranslator(translator);

  const onToggle = () => {
    if (session.running) {
      session.stop();
    } else {
      session.start(DEFAULT_OCR_SETTINGS);
    }
  };

  const header = (
    <>
      <Text style={styles.title}>Altyazı Çevirmeni</Text>
      <Text style={styles.subtitle}>
        PS5 altyazılarını okur, Türkçe çeviriyi TV'de oyunun üstünde gösterir.
      </Text>

      <Card title="Altyazı okuma">
        <Para tone={session.running ? 'ok' : 'muted'}>
          {session.running
            ? '● Çalışıyor — telefon ekranını kapatabilirsin'
            : '○ Durdu'}
        </Para>
        {session.error ? <Para tone="warn">{session.error}</Para> : null}
        {!deeplKey.apiKey ? (
          <Para tone="warn">
            DeepL anahtarı yok: çeviriler deneme sözlüğüyle yapılır.
          </Para>
        ) : null}
        <Button
          label={session.running ? 'Durdur' : 'Başlat'}
          onPress={onToggle}
          loading={session.starting}
          variant={session.running ? 'danger' : 'primary'}
        />
        {overlay.granted === false ? (
          <>
            <Para>
              Çeviriyi telefonda da görmek için "üstte gösterme" izni gerekir
              (TV için gerekmez).
            </Para>
            <Button
              label="Üstte gösterme iznini ver"
              onPress={overlay.request}
              variant="ghost"
            />
          </>
        ) : null}
      </Card>

      <ConsoleCard onRepair={onOpenWizard} />

      <TranslationSettings
        apiKey={deeplKey.apiKey}
        deepl={deepl}
        onSave={deeplKey.save}
        onClear={deeplKey.clear}
      />

      {tv.settings ? (
        <TvSettingsCard
          settings={tv.settings}
          state={tv.state}
          onChange={tv.update}
        />
      ) : null}

      <View style={styles.historyHeader}>
        <Text style={styles.label}>Son altyazılar</Text>
        <Pressable onPress={clearHistory}>
          <Text style={styles.link}>Temizle</Text>
        </Pressable>
      </View>
    </>
  );

  const footer = (
    <Pressable onPress={onOpenWizard} style={styles.footer}>
      <Text style={styles.link}>Kurulum sihirbazını yeniden çalıştır</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.root}>
      <FlatList
        data={history}
        keyExtractor={item => String(item.id)}
        renderItem={({ item }) => <HistoryItem item={item} />}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Henüz altyazı yok. Başlat'a basıp oyununa dön.
          </Text>
        }
        contentContainerStyle={styles.list}
      />
    </SafeAreaView>
  );
}

const HistoryItem = React.memo(({ item }: { item: SubtitleEntry }) => (
  <View style={styles.item}>
    <Text style={styles.original}>{item.original}</Text>
    <Text
      style={[
        styles.translated,
        item.status === 'error' && styles.translatedError,
      ]}
    >
      {item.status === 'pending' ? 'Çevriliyor…' : item.translated}
    </Text>
    <Text style={styles.meta}>
      OCR {item.ocrLatencyMs} ms
      {item.translationLatencyMs != null
        ? ` · çeviri ${item.translationLatencyMs} ms`
        : ''}
      {item.fromCache ? ' · önbellek' : ''}
    </Text>
  </View>
));

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16 },
  title: { color: colors.text, fontSize: 24, fontWeight: '700', marginTop: 12 },
  subtitle: { color: colors.muted, marginTop: 4 },
  label: { color: colors.muted, fontSize: 13, marginTop: 4 },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
  },
  link: { color: '#60a5fa' },
  list: { paddingVertical: 8, gap: 8 },
  empty: { color: colors.faint, textAlign: 'center', marginTop: 24 },
  footer: { alignSelf: 'center', marginVertical: 24 },
  item: { backgroundColor: colors.card, borderRadius: 10, padding: 12 },
  original: { color: colors.muted },
  translated: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    marginTop: 4,
  },
  translatedError: { color: colors.warn },
  meta: { color: '#475569', fontSize: 11, marginTop: 6 },
});
