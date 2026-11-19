import React, { useState } from 'react';
import type { AppState, SubtitleEntry } from '../shared/types';
import { api } from './api';
import {
  ConsoleCard,
  ProtectedTermsCard,
  SubtitleStyleCard,
  TranslationSettings,
  TvSettingsCard,
} from './cards';
import { isDefaultRegions } from '../shared/regions';
import { RegionSetupScreen } from './RegionSetupScreen';
import { TabBar, TabItem } from './TabBar';
import { Button, Card, Page, PageHeader, Para, Row } from './ui';

type Tab = 'reading' | 'translation' | 'appearance' | 'devices';

/** Yönetim paneli: alttaki sekmelerle Okuma / Çeviri / Görünüm / Cihazlar (mobil ile aynı). */
export function HomeScreen({ state, onOpenWizard }: { state: AppState; onOpenWizard: () => void }) {
  const [tab, setTab] = useState<Tab>('reading');
  const [regionSetup, setRegionSetup] = useState(false);

  if (regionSetup) {
    return (
      <main className="content">
        <RegionSetupScreen
          initial={state.settings.ocr.regions}
          running={state.session.running}
          onSave={regions => {
            api.setSettings({ ocr: { ...state.settings.ocr, regions } });
            setRegionSetup(false);
          }}
          onCancel={() => setRegionSetup(false)}
        />
      </main>
    );
  }

  const tabs: TabItem<Tab>[] = [
    { key: 'reading', label: 'Okuma', icon: '▶︎', badge: state.session.running },
    { key: 'translation', label: 'Çeviri', icon: '⇄' },
    { key: 'appearance', label: 'Görünüm', icon: 'Aa' },
    { key: 'devices', label: 'Cihazlar', icon: '▣' },
  ];

  let content: React.ReactNode;
  switch (tab) {
    case 'reading':
      content = <ReadingTab state={state} onSetupRegions={() => setRegionSetup(true)} />;
      break;
    case 'translation':
      content = (
        <Page title="Çeviri" subtitle="Çeviri motoru, DeepL anahtarı ve çevrilmeyecek kelimeler.">
          <TranslationSettings state={state} />
          <ProtectedTermsCard terms={state.settings.protectedTerms} />
        </Page>
      );
      break;
    case 'appearance':
      content = (
        <Page title="Görünüm" subtitle="Çevrilen altyazının TV'de ve bilgisayar ekranında nasıl görüneceği.">
          <SubtitleStyleCard style={state.settings.style} />
          <Card title="Ekranda dene">
            <Para>Örnek bir altyazıyı çevirip ekranın altında (ve açıksa TV'de) gösterir.</Para>
            <Button
              label="Örnek altyazı göster"
              variant="ghost"
              onPress={async () => {
                await api.simulate('Watch out, there is someone behind you!');
                setTimeout(() => api.simulate(''), 4000);
              }}
            />
          </Card>
        </Page>
      );
      break;
    case 'devices':
      content = (
        <Page title="Cihazlar" subtitle="Eşleşmiş PS5 ve çevirinin gösterildiği TV.">
          <ConsoleCard state={state} onRepair={onOpenWizard} />
          <TvSettingsCard settings={state.settings.tv} status={state.tv} />
          <div className="footer">
            <button type="button" className="link" onClick={onOpenWizard}>
              Kurulum sihirbazını yeniden çalıştır
            </button>
          </div>
        </Page>
      );
      break;
  }

  return (
    <>
      <main className="content">{content}</main>
      <TabBar tabs={tabs} active={tab} onChange={setTab} />
    </>
  );
}

/** Ana sekme: okumayı başlat/durdur, çeviri motoru notu ve son altyazılar. */
function ReadingTab({ state, onSetupRegions }: { state: AppState; onSetupRegions: () => void }) {
  const { session, history, ocr, helpers } = state;
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      await (session.running ? api.stopSession() : api.startSession());
    } finally {
      setBusy(false);
    }
  };
  const ocrNonEnglish = ocr.ready && ocr.lang && !ocr.lang.toLowerCase().startsWith('en');

  return (
    <div className="page">
      <PageHeader
        title="Altyazı Çevirmeni"
        subtitle="PS5 altyazılarını okur, Türkçe çeviriyi oyunun üstünde gösterir."
      />

      {!helpers.rp || !helpers.ocr ? (
        <Card title="Eksik bileşen">
          <Para tone="error">
            {!helpers.rp ? 'Remote Play yardımcısı (altyazi-rp.exe) ' : ''}
            {!helpers.rp && !helpers.ocr ? 've ' : ''}
            {!helpers.ocr ? 'OCR yardımcısı (altyazi-ocr.exe) ' : ''}
            bulunamadı. Geliştirme ortamında: npm run build:native
          </Para>
        </Card>
      ) : null}

      <Card title="Altyazı okuma">
        <Para tone={session.running ? (session.connected ? 'ok' : 'warn') : 'muted'}>
          {session.running
            ? `● ${session.status || 'Çalışıyor'}`
            : '○ Durdu'}
        </Para>
        {session.running && session.connected ? (
          <Para>Pencereyi kapatabilirsin; okuma sistem tepsisinde sürer.</Para>
        ) : null}
        {session.error && !session.running ? <Para tone="warn">{session.error}</Para> : null}
        <Para tone={state.engineNote.warn ? 'warn' : 'muted'}>{state.engineNote.text}</Para>
        {ocrNonEnglish ? (
          <Para>
            OCR: Windows "{ocr.lang}" modeli. İngilizce altyazıyı okur; sorun olursa Ayarlar › Saat ve dil › Dil ve
            bölge › İngilizce (ABD) ekle.
          </Para>
        ) : null}
        {ocr.error ? <Para tone="error">{ocr.error}</Para> : null}
        <Button
          label={session.running ? 'Durdur' : 'Başlat'}
          onPress={toggle}
          loading={busy || session.starting}
          disabled={!state.console || !helpers.rp}
          variant={session.running ? 'danger' : 'primary'}
        />
        {!state.console ? <Para tone="warn">Önce Cihazlar sekmesinden PS5 ile eşleştir.</Para> : null}
      </Card>

      <Card title="Okuma alanları">
        <Para>
          {isDefaultRegions(state.settings.ocr.regions)
            ? "Ekranın alt %30'u okunuyor. Altyazı başka yerde çıkıyorsa ya da arayüz yazıları karışıyorsa alanı kendin seç."
            : `${state.settings.ocr.regions.length} alan seçili; yalnızca bunların içindeki yazılar okunur.`}
        </Para>
        <Button
          label="Okuma alanlarını ayarla"
          onPress={onSetupRegions}
          variant="ghost"
          disabled={!state.console || !helpers.rp}
        />
      </Card>

      {state.diag ? <DiagCard state={state} onSetupRegions={onSetupRegions} /> : null}

      <div className="history-header">
        <span className="label">Son altyazılar</span>
        {history.length > 0 ? (
          <button type="button" className="link" onClick={() => api.clearHistory()}>
            Temizle
          </button>
        ) : null}
      </div>
      {history.length === 0 ? (
        <div className="empty">Henüz altyazı yok. Başlat'a basıp oyununa dön.</div>
      ) : (
        <div className="history">
          {history.map(item => (
            <HistoryItem key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Okuma sürerken hattın her adımı: PS5 görüntüsü -> çözme -> OCR -> altyazı filtresi -> çeviri.
 * "Çalışıyor ama çeviri yok" durumunda hangi adımda durduğunu gösterir.
 */
function DiagCard({ state, onSetupRegions }: { state: AppState; onSetupRegions: () => void }) {
  const d = state.diag!;
  let hint: { tone: 'warn' | 'ok' | 'muted'; text: string };
  if (!state.session.connected) {
    hint = { tone: 'muted', text: 'PS5 yayını bekleniyor.' };
  } else if (d.videoSamples === 0) {
    hint = { tone: 'warn', text: 'PS5\'ten görüntü gelmiyor.' };
  } else if (d.frames === 0) {
    hint = { tone: 'warn', text: 'Görüntü geliyor ama çözülemiyor (çözücü hatası).' };
  } else if (d.ocrRuns > 0 && !d.lastOcrText) {
    hint = {
      tone: 'warn',
      text: 'Okuma alanında hiç yazı bulunamadı. Altyazı başka yerde çıkıyorsa okuma alanlarını yeniden seç.',
    };
  } else if (d.emitted === 0 && d.lastReject) {
    hint = { tone: 'warn', text: `Okunan yazı altyazı sayılmadı: ${d.lastReject}` };
  } else {
    hint = { tone: 'ok', text: 'Hat çalışıyor.' };
  }
  return (
    <Card title="Hat durumu">
      <Para tone={hint.tone}>{hint.text}</Para>
      <Para>
        Video {d.videoSamples} · kare {d.frames}
        {d.lastFrameSize ? ` (${d.lastFrameSize})` : ''} · OCR {d.ocrRuns}
        {d.ocrErrors ? ` (${d.ocrErrors} hata)` : ''} · altyazı {d.emitted}
        {d.decoderErrors ? ` · çözücü hatası ${d.decoderErrors}` : ''}
      </Para>
      {d.lastOcrText ? <Para>Son okunan: "{d.lastOcrText.slice(0, 160)}"</Para> : null}
      <button type="button" className="link" style={{ alignSelf: 'flex-start' }} onClick={onSetupRegions}>
        Okuma alanlarını ayarla
      </button>
      <button type="button" className="link" style={{ alignSelf: 'flex-start' }} onClick={() => api.openLog()}>
        Ayrıntılı log dosyasını aç
      </button>
    </Card>
  );
}

const HistoryItem = React.memo(({ item }: { item: SubtitleEntry }) => (
  <div className="item">
    <div className="original">{item.original}</div>
    <div className={`translated ${item.status === 'error' ? 'error' : ''}`}>
      {item.status === 'pending' ? 'Çevriliyor…' : item.translated}
    </div>
    <div className="meta">
      OCR {item.ocrLatencyMs} ms
      {item.translationLatencyMs != null ? ` · çeviri ${item.translationLatencyMs} ms` : ''}
      {item.fromCache ? ' · önbellek' : item.engine ? ` · ${item.engine}` : ''}
      {item.late ? ' · geç geldi, ekranda gösterilmedi' : ''}
    </div>
  </div>
));
