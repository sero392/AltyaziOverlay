import React, { useCallback, useEffect, useState } from 'react';
import type {
  AppState,
  ConsoleState,
  DeepLUsage,
  SubtitleStyle,
  TranslationEngine,
  TvSettings,
  TvStatus,
} from '../shared/types';
import { DEFAULT_STYLE } from '../shared/types';
import { DEFAULT_PROTECTED_TERMS } from '../../../src/services/translation/protectedTerms';
import { api, errorText } from './api';
import { Button, Card, Field, Para, Row, Toggle } from './ui';

// ====================================================================== Çeviri

const ENGINES: { key: TranslationEngine; title: string; sub: string }[] = [
  {
    key: 'local',
    title: 'Yerel yapay zeka',
    sub: 'Bu bilgisayarda TranslateGemma; internetsiz, kotasız, satır başı ~0,2-0,4 sn',
  },
  { key: 'auto', title: 'Otomatik', sub: 'DeepL; gecikirse, kota dolarsa ya da hata olursa Google Çeviri' },
  { key: 'deepl', title: 'DeepL', sub: 'En iyi kalite; anahtar gerekir' },
  { key: 'google', title: 'Google Çeviri', sub: 'Anahtarsız, kotasız; kalitesi daha düşük' },
];

/** DeepL anahtarı ve çeviri motoru (mobildeki TranslationSettings). */
export function TranslationSettings({
  state,
  showEngine = true,
}: {
  state: AppState;
  showEngine?: boolean;
}) {
  const masked = state.settings.deeplKeyMasked;
  const [draft, setDraft] = useState('');
  const [usage, setUsage] = useState<DeepLUsage | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const test = async (key?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const u = await api.deeplUsage(key);
      setUsage(u);
      setMsg({ tone: 'ok', text: 'Bağlantı başarılı.' });
      return true;
    } catch (e) {
      setMsg({ tone: 'error', text: errorText(e) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const key = draft.trim();
    if (await test(key)) {
      await api.setDeepLKey(key);
      setDraft('');
    }
  };

  return (
    <>
      {showEngine ? (
        <Card title="Çeviri motoru">
          {ENGINES.map(e => (
            <button
              key={e.key}
              type="button"
              className={`option ${state.settings.engine === e.key ? 'active' : ''}`}
              onClick={() => api.setSettings({ engine: e.key })}
            >
              <div className="option-title">{e.title}</div>
              <div className="option-sub">{e.sub}</div>
            </button>
          ))}
        </Card>
      ) : null}
      {showEngine && state.settings.engine === 'local' ? <LocalModelCard state={state} /> : null}
      <Card title="DeepL API anahtarı">
        {masked ? (
          <>
            <Para tone="text">Kayıtlı anahtar: {masked}</Para>
            {usage ? (
              <Para>
                Bu ay: {usage.characterCount.toLocaleString('tr-TR')} /{' '}
                {usage.characterLimit.toLocaleString('tr-TR')} karakter
              </Para>
            ) : null}
            {msg ? <Para tone={msg.tone}>{msg.text}</Para> : null}
            <Row>
              <Button label="Bağlantıyı test et" onPress={() => test()} loading={busy} variant="ghost" />
              <Button
                label="Anahtarı sil"
                onPress={() => {
                  setUsage(null);
                  setMsg(null);
                  api.setDeepLKey(null);
                }}
                variant="danger"
              />
            </Row>
          </>
        ) : (
          <>
            <Para>
              <button type="button" className="link" onClick={() => api.openExternal('https://www.deepl.com/pro-api')}>
                deepl.com/pro-api
              </button>{' '}
              adresinden ücretsiz "DeepL API Free" anahtarı alabilirsin (ayda 500.000 karakter). Anahtar bu bilgisayarda
              şifreli saklanır.
            </Para>
            <Field value={draft} onChangeText={setDraft} placeholder="xxxxxxxx-xxxx-…:fx" type="password" />
            {msg ? <Para tone={msg.tone}>{msg.text}</Para> : null}
            <Button label="Kaydet" onPress={save} loading={busy} disabled={!draft.trim()} />
          </>
        )}
      </Card>
    </>
  );
}

const mb = (n: number) => (n / 1048576).toLocaleString('tr-TR', { maximumFractionDigits: 0 });

/** Yerel modelin indirilmesi ve durumu. */
function LocalModelCard({ state }: { state: AppState }) {
  const { status, progress, error } = state.llm;
  const [err, setErr] = useState<string | null>(null);
  const install = async () => {
    setErr(null);
    try {
      await api.llmInstall();
    } catch (e) {
      setErr(errorText(e));
    }
  };
  const statusText: Record<typeof status, string> = {
    missing: 'İndirilmemiş.',
    downloading: 'İndiriliyor…',
    stopped: 'Kurulu, kapalı.',
    starting: 'Açılıyor ve ısınıyor (ilk açılışta 30 sn kadar sürebilir)…',
    ready: 'Hazır.',
    error: 'Çalışmıyor.',
  };
  return (
    <Card title="Yerel model">
      <Para tone="text">{statusText[status]}</Para>
      {status === 'missing' ? (
        <>
          <Para>
            İlk kullanımda llama.cpp sunucusu (~36 MB) ve Google'ın çeviri modeli TranslateGemma 4B (~2,5 GB) bu
            bilgisayara indirilir. Ekran kartında (NVIDIA / AMD / Intel) çalışır; yaklaşık 4 GB ekran kartı belleği
            kullanır. İndirme bitene kadar çeviri DeepL / Google ile yapılır.
          </Para>
          <Button label="Modeli indir" onPress={install} />
        </>
      ) : null}
      {status === 'downloading' && progress ? (
        <>
          <div className="meter">
            <div
              className="meter-fill"
              style={{ width: `${progress.total ? (progress.received / progress.total) * 100 : 0}%` }}
            />
          </div>
          <Para>
            {progress.label}: {mb(progress.received)} / {progress.total ? mb(progress.total) : '?'} MB
          </Para>
          <Button label="İptal" variant="ghost" onPress={() => api.llmCancelInstall()} />
        </>
      ) : null}
      {status === 'error' || status === 'stopped' ? (
        <Button label={status === 'error' ? 'Yeniden başlat' : 'Başlat'} variant="ghost" onPress={install} />
      ) : null}
      {error || err ? <Para tone="error">{err ?? error}</Para> : null}
    </Card>
  );
}

// ====================================================================== Çevrilmeyecek kelimeler

export function ProtectedTermsCard({ terms }: { terms: string[] }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const t = draft.trim();
    if (t && !terms.includes(t)) {
      api.setSettings({ protectedTerms: [...terms, t] });
    }
    setDraft('');
  };
  return (
    <Card title="Çevrilmeyecek kelimeler">
      <Para>
        Karakter ve yer adları çevrilmeden bırakılır (ör. "Dutch" Hollandaca diye çevrilmesin). Büyük/küçük harfe
        duyarlıdır.
      </Para>
      <Row>
        <Field
          value={draft}
          onChangeText={setDraft}
          placeholder="Kelime ekle"
          onKeyDown={e => e.key === 'Enter' && add()}
        />
        <button type="button" className="btn" style={{ flex: 'none' }} onClick={add} disabled={!draft.trim()}>
          Ekle
        </button>
      </Row>
      <div className="terms">
        {terms.map(t => (
          <span key={t} className="term">
            {t}
            <button
              type="button"
              aria-label={`${t} kelimesini kaldır`}
              onClick={() => api.setSettings({ protectedTerms: terms.filter(x => x !== t) })}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <button
        type="button"
        className="link"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => api.setSettings({ protectedTerms: DEFAULT_PROTECTED_TERMS })}
      >
        Varsayılan listeye dön (RDR2)
      </button>
    </Card>
  );
}

// ====================================================================== Görünüm

const MIN_SIZE = 10;
const MAX_SIZE = 60;
const SIZE_STEP = 2;
const TEXT_COLORS = ['#FFFFFF', '#FDE047', '#4ADE80', '#67E8F9', '#F9A8D4'];
const BG_COLORS = ['#000000', '#1E293B', '#1E3A8A', '#3F3F46'];
const BG_OPACITIES = [0, 25, 50, 75, 100];

export const withOpacity = (hex: string, opacity: number) => {
  const n = parseInt(hex.replace('#', ''), 16) || 0;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity / 100})`;
};

export function SubtitleStyleCard({ style }: { style: SubtitleStyle }) {
  const set = (patch: Partial<SubtitleStyle>) => api.setSettings({ style: { ...style, ...patch } });
  return (
    <Card title="Altyazı görünümü">
      <div className="preview">
        <span
          className="preview-text"
          style={{
            color: style.textColor,
            fontSize: (style.fontSize * 2) / 3,
            background: withOpacity(style.bgColor, style.bgOpacity),
          }}
        >
          Dikkat et, arkanda biri var!
        </span>
      </div>

      <div className="label">Yazı boyutu</div>
      <Row>
        <button
          type="button"
          className="step-btn"
          aria-label="Küçült"
          disabled={style.fontSize <= MIN_SIZE}
          onClick={() => set({ fontSize: Math.max(MIN_SIZE, style.fontSize - SIZE_STEP) })}
        >
          −
        </button>
        <span className="size-value">{style.fontSize}</span>
        <button
          type="button"
          className="step-btn"
          aria-label="Büyüt"
          disabled={style.fontSize >= MAX_SIZE}
          onClick={() => set({ fontSize: Math.min(MAX_SIZE, style.fontSize + SIZE_STEP) })}
        >
          +
        </button>
      </Row>

      <div className="label">Yazı rengi</div>
      <Swatches options={TEXT_COLORS} value={style.textColor} onChange={textColor => set({ textColor })} />
      <div className="label">Arka plan rengi</div>
      <Swatches options={BG_COLORS} value={style.bgColor} onChange={bgColor => set({ bgColor })} />
      <div className="label">Arka plan opaklığı</div>
      <Row>
        {BG_OPACITIES.map(v => (
          <button
            key={v}
            type="button"
            className={`chip ${style.bgOpacity === v ? 'active' : ''}`}
            onClick={() => set({ bgOpacity: v })}
          >
            %{v}
          </button>
        ))}
      </Row>
      <button
        type="button"
        className="link"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => api.setSettings({ style: DEFAULT_STYLE })}
      >
        Varsayılana dön
      </button>
    </Card>
  );
}

function Swatches({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="swatches">
      {options.map(c => (
        <button
          key={c}
          type="button"
          aria-label={c}
          className={`swatch ${c.toLowerCase() === value.toLowerCase() ? 'active' : ''}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

// ====================================================================== TV

const TV_LABEL: Record<TvStatus['state'], { text: string; tone: 'ok' | 'warn' | 'muted' }> = {
  OFF: { text: 'Kapalı', tone: 'muted' },
  SEARCHING: { text: 'TV ağda aranıyor…', tone: 'warn' },
  CONNECTING: { text: 'TV\'ye bağlanılıyor…', tone: 'warn' },
  CONNECTED: { text: 'TV\'ye bağlı', tone: 'ok' },
};

export function TvSettingsCard({ settings, status }: { settings: TvSettings; status: TvStatus }) {
  const [host, setHost] = useState(settings.host);
  useEffect(() => setHost(settings.host), [settings.host]);
  const set = (patch: Partial<TvSettings>) => api.setSettings({ tv: { ...settings, ...patch } });
  const label = TV_LABEL[status.state];
  return (
    <Card title="Android TV">
      <Toggle
        label="Çeviriyi TV'de göster"
        hint={'TV\'de "Altyazı TV" uygulaması açık olmalı'}
        value={settings.enabled}
        onChange={enabled => set({ enabled })}
      />
      {settings.enabled ? (
        <>
          <Para tone={label.tone}>
            ● {label.text}
            {status.target ? ` (${status.target})` : ''}
          </Para>
          {status.error ? <Para tone="warn">{status.error}</Para> : null}
          <Field
            value={host}
            onChangeText={setHost}
            onBlur={() => host.trim() !== settings.host && set({ host: host.trim() })}
            onKeyDown={e => e.key === 'Enter' && set({ host: host.trim() })}
            placeholder="TV IP adresi (boşsa ağda aranır)"
          />
          <Toggle
            label="Bilgisayar ekranında da göster"
            value={settings.alsoOnDesktop}
            onChange={alsoOnDesktop => set({ alsoOnDesktop })}
          />
        </>
      ) : (
        <Para>TV kapalıyken çeviri bu bilgisayarın ekranının altında gösterilir.</Para>
      )}
    </Card>
  );
}

// ====================================================================== PS5

const CONSOLE_LABEL: Record<ConsoleState, { label: string; tone: 'ok' | 'warn' | 'muted' }> = {
  READY: { label: 'Açık', tone: 'ok' },
  STANDBY: { label: 'Bekleme modunda', tone: 'warn' },
  UNKNOWN: { label: 'Bilinmiyor', tone: 'muted' },
};

export function ConsoleCard({ state, onRepair }: { state: AppState; onRepair: () => void }) {
  const paired = state.console;
  const [consoleState, setConsoleState] = useState<ConsoleState | null | undefined>(undefined);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const s = await api.probeConsole();
      setConsoleState(s);
      if (s === null) {
        setMessage('PS5 yanıt vermedi: kapalı ya da farklı bir ağda olabilir.');
      }
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (paired && !state.session.running) {
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paired?.host]);

  const wake = async () => {
    setBusy(true);
    try {
      await api.wakeConsole();
      setMessage('Uyandırma sinyali gönderildi; PS5 birkaç saniyede açılır.');
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!paired) {
    return (
      <Card title="PS5">
        <Para tone="warn">Eşleşmiş PS5 yok.</Para>
        <Button label="Kurulum sihirbazını başlat" onPress={onRepair} />
      </Card>
    );
  }
  const label = consoleState ? CONSOLE_LABEL[consoleState] : null;
  return (
    <Card title={`PS5 · ${paired.nickname}`}>
      <Para>{paired.host}</Para>
      {state.session.running ? (
        <Para tone="ok">● Yayın açık</Para>
      ) : label ? (
        <Para tone={label.tone}>● {label.label}</Para>
      ) : null}
      {message ? <Para>{message}</Para> : null}
      <Row>
        <Button label="Yenile" onPress={refresh} variant="ghost" loading={busy} />
        {consoleState === 'STANDBY' ? <Button label="Uyandır" onPress={wake} /> : null}
        <Button label="Yeniden eşleştir" onPress={onRepair} variant="ghost" />
      </Row>
    </Card>
  );
}
