import React from 'react';
import { SubtitleStyleCard } from '../../components/SubtitleStyleCard';
import { Page } from '../../components/ui';
import { useSubtitleStyle } from '../../hooks/useSubtitleStyle';

/** Altyazının ekranda nasıl görüneceği: yazı boyutu, yazı ve arka plan rengi. */
export function AppearanceTab({
  subtitleStyle,
}: {
  subtitleStyle: ReturnType<typeof useSubtitleStyle>;
}) {
  return (
    <Page
      title="Görünüm"
      subtitle="Çevrilen altyazının TV'de ve telefonda nasıl görüneceği."
    >
      <SubtitleStyleCard
        style={subtitleStyle.style}
        onChange={subtitleStyle.update}
        onReset={subtitleStyle.reset}
      />
    </Page>
  );
}
