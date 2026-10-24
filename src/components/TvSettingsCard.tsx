import React, { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { TvStateEvent } from '../native/SubtitleCapture';
import { TvLinkSettings } from '../hooks/useTvLink';

interface Props {
  settings: TvLinkSettings;
  state: TvStateEvent;
  onChange: (patch: Partial<TvLinkSettings>) => void;
}

const STATE_LABEL: Record<TvStateEvent['state'], string> = {
  OFF: 'Kapalı',
  SEARCHING: 'TV ağda aranıyor…',
  CONNECTING: 'Bağlanıyor…',
  CONNECTED: 'Bağlı',
};

/** Çevirileri Android TV'deki "Altyazı TV" uygulamasına gönderme ayarları. */
export function TvSettingsCard({ settings, state, onChange }: Props) {
  // IP alanı yazarken her tuşta yeniden bağlanmasın: odaktan çıkınca kaydedilir.
  const [hostDraft, setHostDraft] = useState(settings.host);
  useEffect(() => setHostDraft(settings.host), [settings.host]);

  const connected = state.state === 'CONNECTED';

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.heading}>Çeviriyi TV'de göster</Text>
        <Switch
          value={settings.enabled}
          onValueChange={enabled => onChange({ enabled })}
        />
      </View>

      {settings.enabled ? (
        <>
          <Text style={connected ? styles.ok : styles.muted}>
            {STATE_LABEL[state.state]}
            {state.target ? ` · ${state.target}` : ''}
          </Text>
          {state.error && !connected ? (
            <Text style={styles.error}>{state.error}</Text>
          ) : null}

          <TextInput
            value={hostDraft}
            onChangeText={setHostDraft}
            onEndEditing={() => onChange({ host: hostDraft })}
            placeholder="TV IP adresi (boş = otomatik bul)"
            placeholderTextColor="#64748b"
            keyboardType="numeric"
            autoCorrect={false}
            style={styles.input}
          />

          <View style={styles.row}>
            <Text style={styles.label}>Telefonda da göster</Text>
            <Switch
              value={settings.alsoOnPhone}
              onValueChange={alsoOnPhone => onChange({ alsoOnPhone })}
            />
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#131a26',
    borderRadius: 14,
    padding: 16,
    gap: 10,
    marginTop: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heading: { color: '#fff', fontWeight: '700', fontSize: 16 },
  label: { color: '#cbd5e1' },
  muted: { color: '#94a3b8' },
  ok: { color: '#4ade80', fontWeight: '600' },
  error: { color: '#f87171' },
  input: {
    backgroundColor: '#0b0f17',
    color: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
});
