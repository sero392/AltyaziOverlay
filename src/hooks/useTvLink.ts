import { useCallback, useEffect, useState } from 'react';
import { SubtitleCapture, TvStateEvent } from '../native/SubtitleCapture';

const KEY_ENABLED = 'tv_enabled';
const KEY_HOST = 'tv_host';
const KEY_PHONE = 'tv_also_on_phone';

export interface TvLinkSettings {
  /** Çeviriler TV'ye gönderilsin mi? */
  enabled: boolean;
  /** Elle girilen TV IP'si; boşsa TV ağda aranır. */
  host: string;
  /** TV açıkken çeviri telefonda da gösterilsin mi? */
  alsoOnPhone: boolean;
}

/**
 * TV bağlantısı ayarları (kalıcı) + canlı bağlantı durumu.
 * Ayar her değiştiğinde native tarafa uygulanır: bağlantı ve çeviri hedefleri.
 */
export function useTvLink() {
  const [settings, setSettings] = useState<TvLinkSettings | null>(null);
  const [state, setState] = useState<TvStateEvent>({
    state: 'OFF',
    target: null,
    error: null,
  });

  useEffect(() => {
    const sub = SubtitleCapture.onTvState(setState);
    Promise.all([
      SubtitleCapture.getSetting(KEY_ENABLED),
      SubtitleCapture.getSetting(KEY_HOST),
      SubtitleCapture.getSetting(KEY_PHONE),
    ]).then(([enabled, host, phone]) =>
      setSettings({
        enabled: enabled === '1',
        host: host ?? '',
        alsoOnPhone: phone === '1',
      }),
    );
    return () => sub?.remove();
  }, []);

  // Ayarları native tarafa uygula. Bağlantı sadece açık/kapalı veya IP değişince yenilenir.
  const enabled = settings?.enabled;
  const host = settings?.host;
  const alsoOnPhone = settings?.alsoOnPhone;
  useEffect(() => {
    if (enabled === undefined) {
      return;
    }
    if (enabled) {
      SubtitleCapture.tvConnect(host);
    } else {
      SubtitleCapture.tvDisconnect();
    }
  }, [enabled, host]);

  useEffect(() => {
    if (enabled === undefined) {
      return;
    }
    SubtitleCapture.setDisplayTargets(!enabled || !!alsoOnPhone, enabled);
  }, [enabled, alsoOnPhone]);

  const update = useCallback((patch: Partial<TvLinkSettings>) => {
    setSettings(prev => {
      if (!prev) {
        return prev;
      }
      const next = { ...prev, ...patch };
      SubtitleCapture.setSetting(KEY_ENABLED, next.enabled ? '1' : null);
      SubtitleCapture.setSetting(KEY_HOST, next.host.trim() || null);
      SubtitleCapture.setSetting(KEY_PHONE, next.alsoOnPhone ? '1' : null);
      return next;
    });
  }, []);

  return { settings, state, update };
}
