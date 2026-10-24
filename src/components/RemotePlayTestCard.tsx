import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { RemotePlay } from '../native/RemotePlay';

/**
 * 0. aşama deneme kartı: PS5 ile eşleştir ve Remote Play yayınından tek kare yakala.
 * Asıl yönetim paneli (konsol bulma, uyandırma, sürekli yayın) sonraki aşamada gelecek.
 */
export function RemotePlayTestCard() {
  const [consoleName, setConsoleName] = useState<string | null>(null);
  const [host, setHost] = useState('');
  const [accountId, setAccountId] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  useEffect(() => {
    RemotePlay.getConsole().then(setConsoleName);
  }, []);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setStatus(null);
    try {
      setStatus({ ok: true, text: await fn() });
    } catch (e) {
      setStatus({
        ok: false,
        text: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const onRegister = () =>
    run(async () => {
      const name = await RemotePlay.register(host, accountId, pin);
      setConsoleName(name);
      setPin('');
      return `Eşleşti: ${name}`;
    });

  const onCapture = () =>
    run(async () => `Kare kaydedildi: ${await RemotePlay.captureTestFrame()}`);

  const onHold = () => run(async () => await RemotePlay.captureTestFrame(60));

  const onForget = () => {
    RemotePlay.forgetConsole();
    setConsoleName(null);
    setStatus(null);
  };

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>PS5 Remote Play (deneme)</Text>
      {consoleName ? (
        <>
          <Text style={styles.ok}>Eşleşmiş konsol: {consoleName}</Text>
          <View style={styles.row}>
            <SmallButton
              label="Test karesi al"
              onPress={onCapture}
              disabled={busy}
            />
            <SmallButton label="60 sn yayın" onPress={onHold} disabled={busy} />
            <SmallButton
              label="Eşleşmeyi sil"
              onPress={onForget}
              disabled={busy}
              danger
            />
          </View>
        </>
      ) : (
        <>
          <TextInput
            value={host}
            onChangeText={setHost}
            placeholder="PS5 IP adresi (örn. 192.168.1.50)"
            placeholderTextColor="#64748b"
            keyboardType="numeric"
            style={styles.input}
          />
          <TextInput
            value={accountId}
            onChangeText={setAccountId}
            placeholder="PSN hesap kimliği (base64)"
            placeholderTextColor="#64748b"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <TextInput
            value={pin}
            onChangeText={setPin}
            placeholder="PS5'teki 8 haneli eşleştirme kodu"
            placeholderTextColor="#64748b"
            keyboardType="numeric"
            maxLength={8}
            style={styles.input}
          />
          <SmallButton
            label="Eşleştir"
            onPress={onRegister}
            disabled={busy || !host || !accountId || pin.length !== 8}
          />
        </>
      )}
      {busy ? <ActivityIndicator color="#60a5fa" /> : null}
      {status ? (
        <Text style={status.ok ? styles.ok : styles.error}>{status.text}</Text>
      ) : null}
    </View>
  );
}

function SmallButton({
  label,
  onPress,
  disabled,
  danger,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.button,
        danger && styles.buttonDanger,
        disabled && styles.disabled,
      ]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
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
  heading: { color: '#fff', fontWeight: '700', fontSize: 16 },
  row: { flexDirection: 'row', gap: 8 },
  input: {
    backgroundColor: '#0b0f17',
    color: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  button: {
    flexGrow: 1,
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  buttonDanger: { backgroundColor: '#7f1d1d' },
  buttonText: { color: '#fff', fontWeight: '600' },
  disabled: { opacity: 0.5 },
  ok: { color: '#4ade80' },
  error: { color: '#f87171' },
});
