import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TranslationSettings } from '../components/TranslationSettings';
import { TvSettingsCard } from '../components/TvSettingsCard';
import { Button, Card, Field, Para, Row, colors } from '../components/ui';
import { useDeepLKey } from '../hooks/useDeepLKey';
import { useTvLink } from '../hooks/useTvLink';
import { DiscoveredConsole, RemotePlay } from '../native/RemotePlay';
import { DeepLTranslationService } from '../services/translation/DeepLTranslationService';
import { SubtitleCapture } from '../native/SubtitleCapture';

const STEPS = [
  'Hoş geldin',
  'Remote Play hesabı',
  'PS5 seç',
  'Hesap kimliği',
  'Eşleştir',
  'Çeviri',
  'TV',
] as const;

const STATE_LABEL: Record<DiscoveredConsole['state'], string> = {
  READY: 'Açık',
  STANDBY: 'Bekleme modunda',
  UNKNOWN: 'Bilinmiyor',
};

/**
 * İlk kurulum: Remote Play için ayrı PSN hesabı -> PS5 seçimi -> hesap kimliği ->
 * eşleştirme -> DeepL -> TV. Eşleşme bittiyse ilk iki adım atlanabilir.
 */
export function SetupWizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [host, setHost] = useState('');
  const [accountId, setAccountId] = useState('');
  const next = () => setStep(s => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep(s => Math.max(s - 1, 0));

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Kurulum</Text>
        <Text style={styles.progress}>
          Adım {step + 1} / {STEPS.length} · {STEPS[step]}
        </Text>
        <View style={styles.bar}>
          <View
            style={[
              styles.barFill,
              { width: `${((step + 1) / STEPS.length) * 100}%` },
            ]}
          />
        </View>

        {step === 0 && <WelcomeStep onNext={next} />}
        {step === 1 && <AccountStep onNext={next} />}
        {step === 2 && (
          <ConsoleStep host={host} onSelect={setHost} onNext={next} />
        )}
        {step === 3 && (
          <AccountIdStep
            value={accountId}
            onChange={setAccountId}
            onNext={next}
          />
        )}
        {step === 4 && (
          <PairStep host={host} accountId={accountId} onNext={next} />
        )}
        {step === 5 && <TranslationStep onNext={next} />}
        {step === 6 && <TvStep onDone={onDone} />}

        {step > 0 ? (
          <Pressable onPress={back} style={styles.back}>
            <Text style={styles.link}>‹ Geri</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <Card title="Altyazı Çevirmeni">
      <Para tone="text">
        PS5 oyunlarındaki İngilizce altyazıları okuyup Türkçe çevirisini TV'de
        oyunun üstünde gösterir.
      </Para>
      <Para>
        Telefon, PS5'in Remote Play yayınını arka planda izler; ekranı kapalı
        olabilir. Sen oyunu her zamanki gibi TV'de kendi kolunla oynarsın.
      </Para>
      <Para>Gerekenler:</Para>
      <Para>• PS5 ve telefonun aynı Wi-Fi ağında olması</Para>
      <Para>
        • Remote Play için ayrı, ücretsiz bir PSN hesabı (sonraki adım)
      </Para>
      <Para>• DeepL API anahtarı (ücretsiz)</Para>
      <Para>• İsteğe bağlı: TV'de "Altyazı TV" uygulaması</Para>
      <Button label="Başlayalım" onPress={onNext} />
    </Card>
  );
}

function AccountStep({ onNext }: { onNext: () => void }) {
  return (
    <Card title="Remote Play için ayrı hesap">
      <Para tone="text">
        PS5, Remote Play bağlandığı kullanıcının kolunu kendine alır. Telefon
        senin hesabınla bağlanırsa oyundaki kolun kopar.
      </Para>
      <Para>
        Çözüm: telefon ayrı bir PSN hesabıyla bağlanır ve sadece izler. Sen
        oyunu kendi hesabınla, kendi kolunla oynamaya devam edersin.
      </Para>
      <Para>1. Ücretsiz yeni bir PSN hesabı aç.</Para>
      <Para>
        2. PS5'e bu hesabı yeni kullanıcı olarak ekle ve bir kez giriş yap.
      </Para>
      <Para>
        3. Bu hesapla oturum açıkken PS5: Ayarlar › Sistem › Uzaktan Oynatma
        (Remote Play) › Uzaktan Oynatmayı Etkinleştir. Yeni hesapta kapalı
        gelir; açık değilse PS5 bağlantıyı reddeder.
      </Para>
      <Button label="Hesap hazır" onPress={onNext} />
    </Card>
  );
}

function ConsoleStep({
  host,
  onSelect,
  onNext,
}: {
  host: string;
  onSelect: (host: string) => void;
  onNext: () => void;
}) {
  const [consoles, setConsoles] = useState<DiscoveredConsole[] | null>(null);
  const [searching, setSearching] = useState(false);

  const search = useCallback(async () => {
    setSearching(true);
    try {
      const found = await RemotePlay.discover(3000);
      setConsoles(found);
      if (found.length === 1) {
        onSelect(found[0].host);
      }
    } catch {
      setConsoles([]);
    } finally {
      setSearching(false);
    }
  }, [onSelect]);

  useEffect(() => {
    search();
  }, [search]);

  return (
    <Card title="PS5'i seç">
      <Para>PS5 açık ya da bekleme modunda olmalı.</Para>
      {searching ? <ActivityIndicator color={colors.primary} /> : null}
      {consoles?.map(c => (
        <Pressable
          key={c.host}
          onPress={() => onSelect(c.host)}
          style={[styles.option, host === c.host && styles.optionActive]}
        >
          <Text style={styles.optionTitle}>
            {c.name} {c.ps5 ? '(PS5)' : '(PS4)'}
          </Text>
          <Text style={styles.optionSub}>
            {c.host} · {STATE_LABEL[c.state]}
          </Text>
        </Pressable>
      ))}
      {consoles && consoles.length === 0 && !searching ? (
        <Para tone="warn">
          Ağda PlayStation bulunamadı. PS5'in açık olduğundan emin ol ya da IP
          adresini elle yaz (PS5: Ayarlar › Ağ › Bağlantı Durumu).
        </Para>
      ) : null}
      <Field
        value={host}
        onChangeText={onSelect}
        placeholder="PS5 IP adresi"
        keyboardType="numeric"
      />
      <Row>
        <Button label="Tekrar ara" onPress={search} variant="ghost" />
        <Button label="Devam" onPress={onNext} disabled={!host.trim()} />
      </Row>
    </Card>
  );
}

function AccountIdStep({
  value,
  onChange,
  onNext,
}: {
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
}) {
  // base64, 8 bayt -> 12 karakter (sonu "=").
  const valid = /^[A-Za-z0-9+/]{11}=$/.test(value.trim());
  return (
    <Card title="Remote Play hesabının kimliği">
      <Para tone="text">
        Ayrı açtığın PSN hesabının "hesap kimliği" (Account ID) gerekiyor. Bu
        bir şifre değil; 12 karakterlik, "=" ile biten bir metin.
      </Para>
      <Para>
        Nasıl bulunur: chiaki-ng belgelerindeki "PSN Account ID" bölümünde
        anlatılan yöntemlerden birini kullan (hesabın çevrimiçi kimliği ile
        sorgulama). Daha önce bir Chiaki uygulamasında bu hesabı kullandıysan
        oradaki değeri de girebilirsin.
      </Para>
      <Field
        value={value}
        onChangeText={onChange}
        placeholder="örn. AbCdEfGhIjK="
        autoCapitalize="none"
      />
      {value && !valid ? (
        <Para tone="warn">12 karakter olmalı ve "=" ile bitmeli.</Para>
      ) : null}
      <Button label="Devam" onPress={onNext} disabled={!valid} />
    </Card>
  );
}

function PairStep({
  host,
  accountId,
  onNext,
}: {
  host: string;
  accountId: string;
  onNext: () => void;
}) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const pair = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const name = await RemotePlay.register(
        host.trim(),
        accountId.trim(),
        pin,
      );
      setStatus({ ok: true, text: `Eşleşti: ${name}` });
    } catch (e) {
      setStatus({
        ok: false,
        text: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="PS5 ile eşleştir">
      <Para tone="text">PS5'te Remote Play hesabıyla oturum açıkken:</Para>
      <Para>
        Ayarlar › Sistem › Uzaktan Oynatma (Remote Play) › Cihazı Bağla (Link
        Device). Ekrandaki 8 haneli kodu aşağıya yaz. Kod birkaç dakika
        geçerlidir.
      </Para>
      <Field
        value={pin}
        onChangeText={setPin}
        placeholder="8 haneli kod"
        keyboardType="numeric"
        maxLength={8}
      />
      {status ? (
        <Para tone={status.ok ? 'ok' : 'error'}>{status.text}</Para>
      ) : null}
      {status?.ok ? (
        <>
          <Para>Artık PS5'te kendi hesabına dönüp oyununu oynayabilirsin.</Para>
          <Button label="Devam" onPress={onNext} />
        </>
      ) : (
        <Button
          label="Eşleştir"
          onPress={pair}
          loading={busy}
          disabled={pin.length !== 8}
        />
      )}
    </Card>
  );
}

function TranslationStep({ onNext }: { onNext: () => void }) {
  const deepl = useDeepLKey();
  const service = useMemo(
    () =>
      deepl.apiKey
        ? new DeepLTranslationService(deepl.apiKey, SubtitleCapture.httpRequest)
        : null,
    [deepl.apiKey],
  );
  return (
    <>
      <Card title="Çeviri (DeepL)">
        <Para>
          deepl.com/pro-api adresinden ücretsiz "DeepL API Free" hesabı açıp API
          anahtarını gir (ayda 500.000 karakter ücretsiz). Anahtar sadece bu
          telefonda saklanır.
        </Para>
      </Card>
      <TranslationSettings
        apiKey={deepl.apiKey}
        deepl={service}
        onSave={deepl.save}
        onClear={deepl.clear}
      />
      <Card>
        <Button
          label={deepl.apiKey ? 'Devam' : 'Şimdilik atla'}
          onPress={onNext}
          variant={deepl.apiKey ? 'primary' : 'ghost'}
        />
      </Card>
    </>
  );
}

function TvStep({ onDone }: { onDone: () => void }) {
  const tv = useTvLink();
  return (
    <>
      <Card title="TV'de göster (isteğe bağlı)">
        <Para>
          Android TV'ye "Altyazı TV" uygulamasını kurduysan açık bırak; telefon
          TV'yi ağda kendisi bulur. TV yoksa çeviriler telefonda gösterilir.
        </Para>
      </Card>
      {tv.settings ? (
        <TvSettingsCard
          settings={tv.settings}
          state={tv.state}
          onChange={tv.update}
        />
      ) : null}
      <Card>
        <Button label="Kurulumu bitir" onPress={onDone} />
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  title: { color: colors.text, fontSize: 24, fontWeight: '700' },
  progress: { color: colors.muted, marginTop: 4 },
  bar: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    marginTop: 8,
    overflow: 'hidden',
  },
  barFill: { height: 4, backgroundColor: colors.primary },
  option: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
  },
  optionActive: { borderColor: colors.primary, backgroundColor: '#172554' },
  optionTitle: { color: colors.text, fontWeight: '600' },
  optionSub: { color: colors.muted, marginTop: 2 },
  back: { marginTop: 16, alignSelf: 'flex-start' },
  link: { color: '#60a5fa' },
});
