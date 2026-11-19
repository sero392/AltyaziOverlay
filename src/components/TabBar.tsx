import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from './ui';

export interface TabItem<K extends string> {
  key: K;
  label: string;
  /** Tek karakterlik simge (emoji olarak çizilmesin diye metin sunumlu glifler). */
  icon: string;
  /** Sekmenin üstünde küçük yeşil nokta (ör. okuma çalışıyor). */
  badge?: boolean;
}

/** Ekranın altındaki sekme çubuğu; alt sistem çubuğu kadar boşluk bırakır. */
export function TabBar<K extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: TabItem<K>[];
  active: K;
  onChange: (key: K) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {tabs.map(tab => {
        const selected = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={tab.label}
          >
            <View style={[styles.pill, selected && styles.pillActive]}>
              <Text style={[styles.icon, selected && styles.iconActive]}>
                {tab.icon}
              </Text>
              {tab.badge ? <View style={styles.badge} /> : null}
            </View>
            <Text style={[styles.label, selected && styles.labelActive]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 8,
  },
  tab: { flex: 1, alignItems: 'center', gap: 4 },
  pill: {
    width: 56,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillActive: { backgroundColor: '#1e3a8a' },
  icon: { color: colors.muted, fontSize: 17, fontWeight: '700' },
  iconActive: { color: colors.text },
  badge: {
    position: 'absolute',
    top: 4,
    right: 12,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.ok,
  },
  label: { color: colors.muted, fontSize: 12 },
  labelActive: { color: colors.text, fontWeight: '600' },
});
