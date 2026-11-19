import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { ConsoleCard } from '../../components/ConsoleCard';
import { TvSettingsCard } from '../../components/TvSettingsCard';
import { Page } from '../../components/ui';
import { useTvLink } from '../../hooks/useTvLink';

/** Bağlı cihazlar: eşleşmiş PS5 ve çevirinin gönderildiği Android TV. */
export function DevicesTab({
  tv,
  onOpenWizard,
}: {
  tv: ReturnType<typeof useTvLink>;
  onOpenWizard: () => void;
}) {
  return (
    <Page title="Cihazlar" subtitle="Eşleşmiş PS5 ve çevirinin gösterildiği TV.">
      <ConsoleCard onRepair={onOpenWizard} />
      {tv.settings ? (
        <TvSettingsCard
          settings={tv.settings}
          state={tv.state}
          onChange={tv.update}
        />
      ) : null}
      <Pressable onPress={onOpenWizard} style={styles.footer}>
        <Text style={styles.link}>Kurulum sihirbazını yeniden çalıştır</Text>
      </Pressable>
    </Page>
  );
}

const styles = StyleSheet.create({
  footer: { alignSelf: 'center', marginVertical: 24 },
  link: { color: '#60a5fa' },
});
