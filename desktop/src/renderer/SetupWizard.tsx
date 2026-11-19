import React, { useCallback, useEffect, useState } from 'react';
import type { AppState, ConsoleState, DiscoveredConsole } from '../shared/types';
import { api, errorText } from './api';
import { TranslationSettings, TvSettingsCard } from './cards';
import { Button, Card, Field, Para, Row, Spinner } from './ui';

const STEPS = ['Hoş geldin', 'Remote Play hesabı', 'PS5 seç', 'Hesap kimliği', 'Eşleştir', 'Çeviri', 'TV'] as const;

const STATE_LABEL: Record<ConsoleState, string> = {
  READY: 'Açık',
  STANDBY: 'Bekleme modunda',
  UNKNOWN: 'Bilinmiyor',
};

/**
 * İlk kurulum (mobil sihirbazla aynı adımlar): Remote Play için ayrı PSN hesabı -> PS5 seçimi
 * -> hesap kimliği -> eşleştirme -> DeepL -> TV.
 */
export function SetupWizard({ state, onDone }: { state: AppState; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [host, setHost] = useState('');
  const [accountId, setAccountId] = useState('');
  const next = () => setStep(s => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep(s => Math.max(s - 1, 0));

  return (
    <main className="content">
      <div className="wizard">
        <h1 className="page-title">Kurulum</h1>
        <div className="progress">
          Adım {step + 1} / {STEPS.length} · {STEPS[step]}
        </div>
        <div className="bar">
          <div className="bar-fill" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>

        {step === 0 && <WelcomeStep onNext={next} onSkip={state.console ? onDone : undefined} />}
        {step === 1 && <AccountStep onNext={next} />}
        {step === 2 && <ConsoleStep host={host} onSelect={setHost} onNext={next} />}
        {step === 3 && <AccountIdStep value={accountId} onChange={setAccountId} onNext={next} />}
        {step === 4 && <PairStep host={host} accountId={accountId} onNext={next} />}
        {step === 5 && <TranslationStep state={state} onNext={next} />}
        {step === 6 && <TvStep state={state} onDone={onDone} />}

        {step > 0 ? (
          <div style={{ marginTop: 16 }}>
            <button type="button" className="link" onClick={back}>
              ‹ Geri
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function WelcomeStep({ onNext, onSkip }: { onNext: () => void; onSkip?: () => void }) {
  return (
    <Card title="Altyazı Çevirmeni">
      <Para tone="text">
        PS5 oyunlarındaki İngilizce altyazıları okuyup Türkçe çevirisini oyunun üstünde gösterir.
      </Para>
      <Para>
        Bilgisayar, PS5'in Remote Play yayınını arka planda izler; görüntü ekrana çizilmez. Sen oyunu her zamanki gibi
        TV'de kendi kolunla oynarsın. Çeviri bu bilgisayarın ekranında ya da Android TV'de gösterilir.
      </Para>
      <Para>Gerekenler:</Para>
      <Para>• PS5 ve bilgisayarın aynı ağda olması</Para>
      <Para>• Remote Play için ayrı, ücretsiz bir PSN hesabı (sonraki adım)</Para>
      <Para>• DeepL API anahtarı (ücretsiz, isteğe bağlı)</Para>
      <Para>• İsteğe bağlı: TV'de "Altyazı TV" uygulaması</Para>
      <Button label="Başlayalım" onPress={onNext} />
      {onSkip ? <Button label="Kurulumu kapat" onPress={onSkip} variant="ghost" /> : null}
    </Card>
  );
}

function AccountStep({ onNext }: { onNext: () => void }) {
  return (
    <Card title="Remote Play için ayrı hesap">
      <Para tone="text">
        PS5, Remote Play bağlandığı kullanıcının kolunu kendine alır. Bilgisayar senin hesabınla bağlanırsa oyundaki
        kolun kopar.
      </Para>
      <Para>
        Çözüm: bilgisayar ayrı bir PSN hesabıyla bağlanır ve sadece izler. Sen oyunu kendi hesabınla, kendi kolunla
        oynamaya devam edersin.
      </Para>
      <Para>1. Ücretsiz yeni bir PSN hesabı aç.</Para>
      <Para>2. PS5'e bu hesabı yeni kullanıcı olarak ekle ve bir kez giriş yap.</Para>
      <Para>
        3. Bu hesapla oturum açıkken PS5: Ayarlar › Sistem › Uzaktan Oynatma (Remote Play) › Uzaktan Oynatmayı
        Etkinleştir. Yeni hesapta kapalı gelir; açık değilse PS5 bağlantıyı reddeder.
      </Para>
      <Para>Telefon uygulamasında kullandığın Remote Play hesabını burada da kullanabilirsin.</Para>
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
      const found = await api.discover(3000);
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
      {searching ? <Spinner /> : null}
      {consoles?.map(c => (
        <button
          key={c.host}
          type="button"
          className={`option ${host === c.host ? 'active' : ''}`}
          onClick={() => onSelect(c.host)}
        >
          <div className="option-title">
            {c.name} {c.ps5 ? '(PS5)' : '(PS4)'}
          </div>
          <div className="option-sub">
            {c.host} · {STATE_LABEL[c.state]}
          </div>
        </button>
      ))}
      {consoles && consoles.length === 0 && !searching ? (
        <Para tone="warn">
          Ağda PlayStation bulunamadı. PS5'in açık olduğundan emin ol ya da IP adresini elle yaz (PS5: Ayarlar › Ağ ›
          Bağlantı Durumu). Windows Güvenlik Duvarı izin sorduysa "İzin ver" de.
        </Para>
      ) : null}
      <Field value={host} onChangeText={onSelect} placeholder="PS5 IP adresi" inputMode="decimal" />
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
        Ayrı açtığın PSN hesabının "hesap kimliği" (Account ID) gerekiyor. Bu bir şifre değil; 12 karakterlik, "=" ile
        biten bir metin.
      </Para>
      <Para>
        Nasıl bulunur: chiaki-ng belgelerindeki "PSN Account ID" bölümünde anlatılan yöntemlerden birini kullan. Telefon
        uygulamasında ya da başka bir Chiaki uygulamasında bu hesabı kullandıysan oradaki değeri girebilirsin.
      </Para>
      <Field value={value} onChangeText={onChange} placeholder="örn. AbCdEfGhIjK=" />
      {value && !valid ? <Para tone="warn">12 karakter olmalı ve "=" ile bitmeli.</Para> : null}
      <Button label="Devam" onPress={onNext} disabled={!valid} />
    </Card>
  );
}

function PairStep({ host, accountId, onNext }: { host: string; accountId: string; onNext: () => void }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const pair = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const name = await api.register(host.trim(), accountId.trim(), pin);
      setStatus({ ok: true, text: `Eşleşti: ${name}` });
    } catch (e) {
      setStatus({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="PS5 ile eşleştir">
      <Para tone="text">PS5'te Remote Play hesabıyla oturum açıkken:</Para>
      <Para>
        Ayarlar › Sistem › Uzaktan Oynatma (Remote Play) › Cihazı Bağla (Link Device). Ekrandaki 8 haneli kodu aşağıya
        yaz. Kod birkaç dakika geçerlidir.
      </Para>
      <Field
        value={pin}
        onChangeText={v => setPin(v.replace(/\D/g, '').slice(0, 8))}
        placeholder="8 haneli kod"
        inputMode="numeric"
      />
      {status ? <Para tone={status.ok ? 'ok' : 'error'}>{status.text}</Para> : null}
      {status?.ok ? (
        <>
          <Para>Artık PS5'te kendi hesabına dönüp oyununu oynayabilirsin.</Para>
          <Button label="Devam" onPress={onNext} />
        </>
      ) : (
        <Button label="Eşleştir" onPress={pair} loading={busy} disabled={pin.length !== 8} />
      )}
    </Card>
  );
}

function TranslationStep({ state, onNext }: { state: AppState; onNext: () => void }) {
  const hasKey = !!state.settings.deeplKeyMasked;
  return (
    <>
      <Card title="Çeviri (DeepL)">
        <Para>
          DeepL en iyi çeviriyi verir. Anahtar girmezsen çeviri anahtarsız Google Çeviri ile yapılır; sonra Çeviri
          sekmesinden ekleyebilirsin.
        </Para>
      </Card>
      <TranslationSettings state={state} showEngine={false} />
      <Card>
        <Button label={hasKey ? 'Devam' : 'Şimdilik atla'} onPress={onNext} variant={hasKey ? 'primary' : 'ghost'} />
      </Card>
    </>
  );
}

function TvStep({ state, onDone }: { state: AppState; onDone: () => void }) {
  return (
    <>
      <Card title="Nerede gösterilsin?">
        <Para>
          Android TV'ye "Altyazı TV" uygulamasını kurduysan açık bırak; bilgisayar TV'yi ağda kendisi bulur. TV yoksa
          çeviriler bu bilgisayarın ekranının altında, her şeyin üstünde gösterilir.
        </Para>
      </Card>
      <TvSettingsCard settings={state.settings.tv} status={state.tv} />
      <Card>
        <Button label="Kurulumu bitir" onPress={onDone} />
      </Card>
    </>
  );
}
