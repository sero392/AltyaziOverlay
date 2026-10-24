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
import {
  OCR_CROP_RATIOS,
  OCR_INTERVALS,
  useOcrSettings,
} from '../hooks/useOcrSettings';
import { useOverlayPermission } from '../hooks/useOverlayPermission';
import { useSubtitleTranslator } from '../hooks/useSubtitleTranslator';
import { useTvLink } from '../hooks/useTvLink';
import { SubtitleCapture } from '../native/SubtitleCapture';
import { CachedTranslationService } from '../services/translation/CachedTranslationService';
import { DeepLTranslationService } from '../services/translation/DeepLTranslationService';
import { MockTranslationService } from '../services/translation/MockTranslationService';

/**
 * Yönetim paneli: altyazı okumayı başlat/durdur, PS5 durumu, DeepL, TV, okuma ayarları
 * ve son çeviriler.
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
  const ocr = useOcrSettings();
  const { history, stats, clearHistory } = useSubtitleTranslator(translator);

  const onToggle = () => {
    if (session.running) {
      session.stop();
    } else {
      session.start({ intervalMs: ocr.intervalMs, cropRatio: ocr.cropRatio });
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

      <Card title="Okuma ayarları">
        <Text style={styles.label}>OCR aralığı</Text>
        <ChipGroup
          options={OCR_INTERVALS}
          value={ocr.intervalMs}
          onChange={ocr.setIntervalMs}
          format={v => `${v} ms`}
          disabled={session.running}
        />
        <Text style={styles.label}>Okuma alanı (ekranın altından)</Text>
        <ChipGroup
          options={OCR_CROP_RATIOS}
          value={ocr.cropRatio}
          onChange={ocr.setCropRatio}
          format={v => `%${Math.round(v * 100)}`}
          disabled={session.running}
        />
        {session.running ? <Para>Değiştirmek için önce durdur.</Para> : null}
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

      <View style={styles.statsRow}>
        <Stat label="Gelen" value={stats.received} />
        <Stat label="Çevrilen" value={stats.translated} />
        <Stat label="Önbellek" value={stats.cacheHits} />
        <Stat label="İptal" value={stats.dropped} />
      </View>

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

function ChipGroup({
  options,
  value,
  onChange,
  format,
  disabled,
}: {
  options: number[];
  value: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  disabled?: boolean;
}) {
  return (
    <View style={styles.chips}>
      {options.map(v => (
        <Pressable
          key={v}
          disabled={disabled}
          onPress={() => onChange(v)}
          style={[
            styles.chip,
            value === v && styles.chipActive,
            disabled && styles.disabled,
          ]}
        >
          <Text style={styles.chipText}>{format(v)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16 },
  title: { color: colors.text, fontSize: 24, fontWeight: '700', marginTop: 12 },
  subtitle: { color: colors.muted, marginTop: 4 },
  label: { color: colors.muted, fontSize: 13, marginTop: 4 },
  chips: { flexDirection: 'row', gap: 8 },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: { color: colors.text },
  disabled: { opacity: 0.5 },
  statsRow: { flexDirection: 'row', marginTop: 12, gap: 8 },
  stat: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  statValue: { color: colors.text, fontSize: 18, fontWeight: '700' },
  statLabel: { color: colors.muted, fontSize: 12 },
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
