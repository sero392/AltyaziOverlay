import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, PageHeader, Para, colors } from '../../components/ui';
import { SubtitleEntry } from '../../domain/types';
import { useCaptureSession } from '../../hooks/useCaptureSession';
import { useOverlayPermission } from '../../hooks/useOverlayPermission';

interface Props {
  session: ReturnType<typeof useCaptureSession>;
  overlay: ReturnType<typeof useOverlayPermission>;
  engineNote: { text: string; warn: boolean };
  history: SubtitleEntry[];
  onToggle: () => void;
  onClearHistory: () => void;
  regionsNote: string;
  onEditRegions: () => void;
}

/** Ana sekme: okumayı başlat/durdur, hangi çevirinin kullanıldığı ve son altyazılar. */
export function ReadingTab({
  session,
  overlay,
  engineNote,
  history,
  onToggle,
  onClearHistory,
  regionsNote,
  onEditRegions,
}: Props) {
  const header = (
    <>
      <PageHeader
        title="Altyazı Çevirmeni"
        subtitle="PS5 altyazılarını okur, Türkçe çeviriyi TV'de oyunun üstünde gösterir."
      />

      <Card title="Altyazı okuma">
        <Para tone={session.running ? 'ok' : 'muted'}>
          {session.running
            ? '● Çalışıyor — telefon ekranını kapatabilirsin'
            : '○ Durdu'}
        </Para>
        {session.error ? <Para tone="warn">{session.error}</Para> : null}
        <Para tone={engineNote.warn ? 'warn' : 'muted'}>{engineNote.text}</Para>
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

      <Card title="Okuma alanı">
        <Para>
          Ekranın sadece seçtiğin yerleri okunur; arayüz yazıları karışmaz.{' '}
          {regionsNote}
        </Para>
        <Button
          label="Okuma alanlarını ayarla"
          onPress={onEditRegions}
          variant="ghost"
        />
      </Card>

      <View style={styles.historyHeader}>
        <Text style={styles.label}>Son altyazılar</Text>
        {history.length > 0 ? (
          <Pressable onPress={onClearHistory}>
            <Text style={styles.link}>Temizle</Text>
          </Pressable>
        ) : null}
      </View>
    </>
  );

  return (
    <FlatList
      data={history}
      keyExtractor={item => String(item.id)}
      renderItem={({ item }) => <HistoryItem item={item} />}
      ListHeaderComponent={header}
      ListEmptyComponent={
        <Text style={styles.empty}>
          Henüz altyazı yok. Başlat'a basıp oyununa dön.
        </Text>
      }
      contentContainerStyle={styles.list}
    />
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
  list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24, gap: 8 },
  label: { color: colors.muted, fontSize: 13, marginTop: 4 },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
  },
  link: { color: '#60a5fa' },
  empty: { color: colors.faint, textAlign: 'center', marginTop: 24 },
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
