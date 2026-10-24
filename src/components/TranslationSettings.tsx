import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { maskKey } from '../hooks/useDeepLKey';
import { DeepLTranslationService } from '../services/translation/DeepLTranslationService';

interface Props {
  apiKey: string | null;
  deepl: DeepLTranslationService | null;
  onSave: (key: string) => Promise<void>;
  onClear: () => Promise<void>;
}

const TEST_SENTENCE = 'Are you ready with that bow?';

/** DeepL anahtarı girişi, bağlantı testi ve aylık kota görüntüleme. */
export function TranslationSettings({ apiKey, deepl, onSave, onClear }: Props) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

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

  const onTest = () =>
    run(async () => {
      if (!deepl) {
        throw new Error('Önce anahtarı kaydedin');
      }
      const [res, usage] = await Promise.all([
        deepl.translate(TEST_SENTENCE),
        deepl.usage(),
      ]);
      const used = usage.characterCount.toLocaleString('tr-TR');
      const limit = usage.characterLimit.toLocaleString('tr-TR');
      return `"${res.text}" · Bu ay: ${used} / ${limit} karakter`;
    });

  const onSavePress = () =>
    run(async () => {
      await onSave(draft);
      setDraft('');
      return 'Kaydedildi. "Bağlantıyı test et" ile doğrulayın.';
    });

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Çeviri servisi</Text>
      <Text style={styles.provider}>
        {apiKey ? `DeepL · ${maskKey(apiKey)}` : 'Sahte servis (test sözlüğü)'}
      </Text>

      {apiKey ? (
        <View style={styles.row}>
          <SmallButton
            label="Bağlantıyı test et"
            onPress={onTest}
            disabled={busy}
          />
          <SmallButton
            label="Anahtarı sil"
            onPress={onClear}
            disabled={busy}
            danger
          />
        </View>
      ) : (
        <>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="DeepL API anahtarı (…:fx)"
            placeholderTextColor="#64748b"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <SmallButton
            label="Kaydet"
            onPress={onSavePress}
            disabled={busy || draft.trim().length === 0}
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
  provider: { color: '#94a3b8' },
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
