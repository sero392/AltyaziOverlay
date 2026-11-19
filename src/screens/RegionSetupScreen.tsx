import React, { useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Image,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, PageHeader, Para, colors } from '../components/ui';
import {
  DEFAULT_READ_REGIONS,
  MAX_READ_REGIONS,
} from '../hooks/useReadRegions';
import { FrameSnapshot, RemotePlay } from '../native/RemotePlay';
import { ReadRegion } from '../native/SubtitleCapture';

const REGION_COLORS = ['#22d3ee', '#f472b6', '#a3e635', '#fbbf24'];
/** Bundan küçük çizimler yanlışlıkla dokunma sayılır (ekran oranı). */
const MIN_DRAW = 0.03;

interface Props {
  initial: ReadRegion[];
  onSave: (regions: ReadRegion[]) => void;
  onCancel: () => void;
}

/**
 * Okuma alanı kurulumu: PS5 yayınından bir kare alınır, kullanıcı altyazının çıktığı
 * yerleri parmağıyla çerçeveler. Sadece bu alanlar OCR'a gider.
 */
export function RegionSetupScreen({ initial, onSave, onCancel }: Props) {
  const [regions, setRegions] = useState<ReadRegion[]>(initial);
  const [snapshot, setSnapshot] = useState<FrameSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReadRegion | null>(null);

  // PanResponder bir kez oluşturulur; güncel değerlere ref'lerle erişir.
  const size = useRef({ w: 1, h: 1 });
  const regionsRef = useRef(regions);
  regionsRef.current = regions;
  const start = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onCancel();
      return true;
    });
    return () => sub.remove();
  }, [onCancel]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: e => {
        start.current = {
          x: e.nativeEvent.locationX / size.current.w,
          y: e.nativeEvent.locationY / size.current.h,
        };
        setDraft(null);
      },
      onPanResponderMove: (_, g) => {
        setDraft(
          toRect(
            start.current.x,
            start.current.y,
            start.current.x + g.dx / size.current.w,
            start.current.y + g.dy / size.current.h,
          ),
        );
      },
      onPanResponderRelease: (_, g) => {
        const r = toRect(
          start.current.x,
          start.current.y,
          start.current.x + g.dx / size.current.w,
          start.current.y + g.dy / size.current.h,
        );
        setDraft(null);
        if (r.w < MIN_DRAW || r.h < MIN_DRAW) {
          return;
        }
        if (regionsRef.current.length >= MAX_READ_REGIONS) {
          setError(`En çok ${MAX_READ_REGIONS} alan seçilebilir. Önce birini sil.`);
          return;
        }
        setError(null);
        setRegions([...regionsRef.current, r]);
      },
      onPanResponderTerminate: () => setDraft(null),
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    size.current = { w: Math.max(1, width), h: Math.max(1, height) };
  };

  const takeSnapshot = async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await RemotePlay.captureSnapshot());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const remove = (i: number) =>
    setRegions(regions.filter((_, idx) => idx !== i));

  const aspect = snapshot ? snapshot.width / snapshot.height : 16 / 9;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.page}>
        <PageHeader
          title="Okuma alanları"
          subtitle="Sadece seçtiğin alanlardaki yazılar okunur ve çevrilir."
        />

        <Para>
          Oyunda altyazı ekrandayken "Ekrandan kare al"a bas. Sonra altyazının
          çıktığı yeri parmağınla sürükleyerek çerçevele. En çok{' '}
          {MAX_READ_REGIONS} alan seçebilirsin (ör. oynanış ve ara sahne
          altyazıları ayrı yerdeyse).
        </Para>

        <View
          style={[styles.canvas, { aspectRatio: aspect }]}
          onLayout={onLayout}
          {...pan.panHandlers}
        >
          {snapshot ? (
            <Image
              source={{ uri: snapshot.uri }}
              style={StyleSheet.absoluteFill}
              resizeMode="stretch"
              pointerEvents="none"
            />
          ) : (
            <View style={styles.placeholder} pointerEvents="none">
              <Text style={styles.placeholderText}>Henüz kare yok</Text>
            </View>
          )}
          {regions.map((r, i) => (
            <RegionBox
              key={i}
              region={r}
              color={REGION_COLORS[i % REGION_COLORS.length]}
              label={String(i + 1)}
            />
          ))}
          {draft ? <RegionBox region={draft} color="#ffffff" dashed /> : null}
        </View>

        <Button
          label={snapshot ? 'Yeni kare al' : 'Ekrandan kare al'}
          onPress={takeSnapshot}
          loading={loading}
          variant="ghost"
        />
        {loading ? (
          <Para>PS5 yayınına bağlanılıyor, birkaç saniye sürebilir…</Para>
        ) : null}
        {error ? <Para tone="warn">{error}</Para> : null}

        <Card title="Seçili alanlar">
          {regions.length === 0 ? (
            <Para tone="warn">
              Alan yok. Kaydedersen varsayılan (ekranın alt %20'si) kullanılır.
            </Para>
          ) : (
            regions.map((r, i) => (
              <View key={i} style={styles.regionRow}>
                <View
                  style={[
                    styles.swatch,
                    { backgroundColor: REGION_COLORS[i % REGION_COLORS.length] },
                  ]}
                />
                <Text style={styles.regionText}>
                  Alan {i + 1}: {describe(r)}
                </Text>
                <Pressable onPress={() => remove(i)} hitSlop={8}>
                  <Text style={styles.remove}>Sil</Text>
                </Pressable>
              </View>
            ))
          )}
          <Pressable onPress={() => setRegions(DEFAULT_READ_REGIONS)}>
            <Text style={styles.link}>Varsayılana dön (alt %20)</Text>
          </Pressable>
        </Card>

        <Button label="Kaydet" onPress={() => onSave(regions)} />
        <Button label="Vazgeç" onPress={onCancel} variant="ghost" />
      </ScrollView>
    </SafeAreaView>
  );
}

function RegionBox({
  region,
  color,
  label,
  dashed,
}: {
  region: ReadRegion;
  color: string;
  label?: string;
  dashed?: boolean;
}) {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.box,
        {
          left: `${region.x * 100}%`,
          top: `${region.y * 100}%`,
          width: `${region.w * 100}%`,
          height: `${region.h * 100}%`,
          borderColor: color,
        },
        dashed && styles.dashed,
      ]}
    >
      {label ? (
        <Text style={[styles.boxLabel, { backgroundColor: color }]}>{label}</Text>
      ) : null}
    </View>
  );
}

function toRect(x1: number, y1: number, x2: number, y2: number): ReadRegion {
  const c = (v: number) => Math.min(1, Math.max(0, v));
  const left = c(Math.min(x1, x2));
  const top = c(Math.min(y1, y2));
  return {
    x: left,
    y: top,
    w: c(Math.max(x1, x2)) - left,
    h: c(Math.max(y1, y2)) - top,
  };
}

const pct = (v: number) => `%${Math.round(v * 100)}`;

function describe(r: ReadRegion): string {
  return `soldan ${pct(r.x)}, üstten ${pct(r.y)} · ${pct(r.w)} × ${pct(r.h)}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  page: { padding: 16, gap: 12 },
  canvas: {
    width: '100%',
    backgroundColor: '#000',
    borderRadius: 6,
    overflow: 'hidden',
  },
  placeholder: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: { color: colors.faint },
  box: { position: 'absolute', borderWidth: 2 },
  dashed: { borderStyle: 'dashed' },
  boxLabel: {
    position: 'absolute',
    top: 0,
    left: 0,
    color: '#000',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 4,
  },
  regionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  swatch: { width: 12, height: 12, borderRadius: 2 },
  regionText: { color: colors.text, flex: 1, fontSize: 13 },
  remove: { color: colors.error, fontWeight: '600' },
  link: { color: '#60a5fa', marginTop: 8 },
});
