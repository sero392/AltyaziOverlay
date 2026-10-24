import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { PairedConsole, RemotePlay } from '../native/RemotePlay';
import { Button, Card, Para, Row, colors } from './ui';

const STATE: Record<
  PairedConsole['state'],
  { label: string; tone: 'ok' | 'warn' | 'error' | 'muted' }
> = {
  READY: { label: 'Açık', tone: 'ok' },
  STANDBY: { label: 'Bekleme modunda', tone: 'warn' },
  OFFLINE: { label: 'Ağda bulunamadı', tone: 'error' },
  UNKNOWN: { label: 'Bilinmiyor', tone: 'muted' },
};

/**
 * Eşleşmiş PS5: ad, IP, anlık durum; bekleme modundaysa uyandırma.
 * Başlat'a basınca servis zaten gerekirse uyandırır; bu kart durumu görmek içindir.
 */
export function ConsoleCard({ onRepair }: { onRepair: () => void }) {
  const [paired, setPaired] = useState<PairedConsole | null | undefined>(
    undefined,
  );
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setPaired(await RemotePlay.getPairedConsole());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const wake = async () => {
    setMessage(null);
    try {
      await RemotePlay.wake();
      setMessage('Uyandırma isteği gönderildi; PS5 açılıyor…');
      setTimeout(refresh, 15000);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  if (paired === undefined) {
    return (
      <Card title="PS5">
        <ActivityIndicator color={colors.primary} />
      </Card>
    );
  }

  if (paired === null) {
    return (
      <Card title="PS5">
        <Para tone="warn">Eşleşmiş PS5 yok.</Para>
        <Button label="Kurulum sihirbazını başlat" onPress={onRepair} />
      </Card>
    );
  }

  const state = STATE[paired.state];
  return (
    <Card title={`PS5 · ${paired.nickname}`}>
      <Row>
        <Para>{paired.host}</Para>
        <Text> </Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Para tone={state.tone}>● {state.label}</Para>
        )}
      </Row>
      {message ? <Para>{message}</Para> : null}
      <Row>
        <Button label="Yenile" onPress={refresh} variant="ghost" />
        {paired.state === 'STANDBY' ? (
          <Button label="Uyandır" onPress={wake} />
        ) : null}
        <Button label="Yeniden eşleştir" onPress={onRepair} variant="ghost" />
      </Row>
    </Card>
  );
}
