import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SubtitleEntry } from '../domain/types';
import { SubtitleCapture } from '../native/SubtitleCapture';
import { useCaptureSession } from '../hooks/useCaptureSession';
import { useOverlayPermission } from '../hooks/useOverlayPermission';
import { useSubtitleTranslator } from '../hooks/useSubtitleTranslator';
import { TranslationSettings } from '../components/TranslationSettings';
import { RemotePlayTestCard } from '../components/RemotePlayTestCard';
import { TvSettingsCard } from '../components/TvSettingsCard';
import { useTvLink } from '../hooks/useTvLink';
import { useDeepLKey } from '../hooks/useDeepLKey';
import { CachedTranslationService } from '../services/translation/CachedTranslationService';
import { DeepLTranslationService } from '../services/translation/DeepLTranslationService';
import { MockTranslationService } from '../services/translation/MockTranslationService';

const INTERVALS = [300, 500, 800];
const CROP_RATIOS = [0.2, 0.3, 0.4];
const SAMPLE_LINES = [
  'Follow me.',
  'Watch out!',
  'Where are you going?',
  'We have to find the door now',
];

export function HomeScreen() {
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
  const { history, stats, clearHistory, simulate } =
    useSubtitleTranslator(translator);
  const [intervalMs, setIntervalMs] = useState<number>(500);
  // Ara sahnelerde altyazı siyah bantta (alt ~%15), oynanışta daha yukarıda (~%25-30).
  const [cropRatio, setCropRatio] = useState<number>(0.3);
  const [sampleIdx, setSampleIdx] = useState(0);

  const onToggle = () => {
    if (session.running) {
      session.stop();
    } else {
      session.start({ intervalMs, cropRatio });
    }
  };

  const onSimulate = () => {
    simulate(SAMPLE_LINES[sampleIdx % SAMPLE_LINES.length]);
    setSampleIdx(i => i + 1);
  };

  const header = (
    <>
      <Text style={styles.title}>Altyazı Çevirmeni</Text>
      <Text style={styles.subtitle}>
        Ekranın alt kısmındaki altyazıyı okur, Türkçe çeviriyi oyunun üstüne
        bindirir.
      </Text>

      <View style={styles.card}>
        <Row
          label="Üstte gösterme izni"
          value={
            overlay.granted == null ? '…' : overlay.granted ? 'Verildi' : 'Yok'
          }
          ok={overlay.granted === true}
        />
        <Row
          label="Yakalama servisi"
          value={session.running ? 'Çalışıyor' : 'Durdu'}
          ok={session.running}
        />
        {session.error ? (
          <Text style={styles.error}>{session.error}</Text>
        ) : null}

        {overlay.granted === false ? (
          <Button label="Üstte gösterme iznini ver" onPress={overlay.request} />
        ) : null}

        <Text style={styles.label}>OCR aralığı</Text>
        <ChipGroup
          options={INTERVALS}
          value={intervalMs}
          onChange={setIntervalMs}
          format={v => `${v} ms`}
          disabled={session.running}
        />

        <Text style={styles.label}>Okuma alanı (ekranın altından)</Text>
        <ChipGroup
          options={CROP_RATIOS}
          value={cropRatio}
          onChange={setCropRatio}
          format={v => `%${Math.round(v * 100)}`}
          disabled={session.running}
        />

        <Button
          label={session.running ? 'Durdur' : 'Başlat'}
          onPress={onToggle}
          disabled={session.starting}
          loading={session.starting}
          variant={session.running ? 'danger' : 'primary'}
        />
        <Button
          label="Sahte altyazı gönder (test)"
          onPress={onSimulate}
          variant="ghost"
        />
      </View>

      <TranslationSettings
        apiKey={deeplKey.apiKey}
        deepl={deepl}
        onSave={deeplKey.save}
        onClear={deeplKey.clear}
      />

      <RemotePlayTestCard />

      {tv.settings ? (
        <TvSettingsCard
          settings={tv.settings}
          state={tv.state}
          onChange={tv.update}
        />
      ) : null}

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

  return (
    <SafeAreaView style={styles.root}>
      <FlatList
        data={history}
        keyExtractor={item => String(item.id)}
        renderItem={({ item }) => <HistoryItem item={item} />}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Henüz altyazı yok. Başlat'a basıp oyuna geçin.
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

function Row({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, ok ? styles.ok : styles.bad]}>
        {value}
      </Text>
    </View>
  );
}

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

function Button({
  label,
  onPress,
  disabled,
  loading,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'danger' | 'ghost';
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        variant === 'danger' && styles.buttonDanger,
        variant === 'ghost' && styles.buttonGhost,
        (disabled || pressed) && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={styles.buttonText}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0f17', paddingHorizontal: 16 },
  title: { color: '#fff', fontSize: 24, fontWeight: '700', marginTop: 12 },
  subtitle: { color: '#94a3b8', marginTop: 4, marginBottom: 16 },
  card: {
    backgroundColor: '#131a26',
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowLabel: { color: '#cbd5e1' },
  rowValue: { fontWeight: '600' },
  ok: { color: '#4ade80' },
  bad: { color: '#f87171' },
  error: { color: '#f87171' },
  label: { color: '#94a3b8', fontSize: 13, marginTop: 4 },
  chips: { flexDirection: 'row', gap: 8 },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#1e293b',
  },
  chipActive: { backgroundColor: '#2563eb' },
  chipText: { color: '#fff' },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonDanger: { backgroundColor: '#dc2626' },
  buttonGhost: { backgroundColor: '#1e293b' },
  buttonText: { color: '#fff', fontWeight: '600' },
  disabled: { opacity: 0.5 },
  statsRow: { flexDirection: 'row', marginTop: 12, gap: 8 },
  stat: {
    flex: 1,
    backgroundColor: '#131a26',
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  statValue: { color: '#fff', fontSize: 18, fontWeight: '700' },
  statLabel: { color: '#94a3b8', fontSize: 12 },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
  },
  link: { color: '#60a5fa' },
  list: { paddingVertical: 8, gap: 8 },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 24 },
  item: { backgroundColor: '#131a26', borderRadius: 10, padding: 12 },
  original: { color: '#94a3b8' },
  translated: { color: '#fff', fontSize: 16, fontWeight: '600', marginTop: 4 },
  translatedError: { color: '#fbbf24' },
  meta: { color: '#475569', fontSize: 11, marginTop: 6 },
});
