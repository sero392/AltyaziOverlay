import React, { useRef, useState } from 'react';
import type { FrameSnapshot, ReadRegion } from '../shared/types';
import { DEFAULT_READ_REGIONS, MAX_READ_REGIONS } from '../shared/regions';
import { api, errorText } from './api';
import { Button, Card, Page, Para } from './ui';

const REGION_COLORS = ['#22d3ee', '#f472b6', '#a3e635', '#fbbf24'];
/** Bundan küçük çizimler yanlışlıkla tıklama sayılır (ekran oranı). */
const MIN_DRAW = 0.03;

/**
 * Okuma alanı kurulumu (mobildeki RegionSetupScreen): PS5 yayınından bir kare alınır, kullanıcı
 * altyazının çıktığı yerleri fareyle çerçeveler. Sadece bu alanlar OCR'a gider.
 */
export function RegionSetupScreen({
  initial,
  running,
  onSave,
  onCancel,
}: {
  initial: ReadRegion[];
  /** Okuma sürüyor mu (kare hemen gelir; değilse geçici bağlantı kurulur). */
  running: boolean;
  onSave: (regions: ReadRegion[]) => void;
  onCancel: () => void;
}) {
  const [regions, setRegions] = useState<ReadRegion[]>(initial);
  const [snapshot, setSnapshot] = useState<FrameSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReadRegion | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  const point = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) {
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = point(e);
    setDraft(null);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = start.current;
    if (s) {
      const p = point(e);
      setDraft(toRect(s.x, s.y, p.x, p.y));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const s = start.current;
    start.current = null;
    setDraft(null);
    if (!s) {
      return;
    }
    const p = point(e);
    const r = toRect(s.x, s.y, p.x, p.y);
    if (r.w < MIN_DRAW || r.h < MIN_DRAW) {
      return;
    }
    if (regions.length >= MAX_READ_REGIONS) {
      setError(`En çok ${MAX_READ_REGIONS} alan seçilebilir. Önce birini sil.`);
      return;
    }
    setError(null);
    setRegions([...regions, r]);
  };

  const takeSnapshot = async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await api.captureSnapshot());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };

  const remove = (i: number) => setRegions(regions.filter((_, idx) => idx !== i));
  const aspect = snapshot ? `${snapshot.width} / ${snapshot.height}` : '16 / 9';

  return (
    <Page title="Okuma alanları" subtitle="Sadece seçtiğin alanlardaki yazılar okunur ve çevrilir.">
      <Para>
        Oyunda altyazı ekrandayken "Ekrandan kare al"a bas. Sonra altyazının çıktığı yeri fareyle sürükleyerek
        çerçevele. En çok {MAX_READ_REGIONS} alan seçebilirsin (ör. oynanış ve ara sahne altyazıları ayrı yerdeyse).
      </Para>

      <div
        ref={canvasRef}
        className="region-canvas"
        style={{ aspectRatio: aspect }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          start.current = null;
          setDraft(null);
        }}
      >
        {snapshot ? (
          <img src={snapshot.dataUrl} alt="PS5 ekranı" draggable={false} />
        ) : (
          <div className="region-placeholder">Henüz kare yok</div>
        )}
        {regions.map((r, i) => (
          <RegionBox key={i} region={r} color={REGION_COLORS[i % REGION_COLORS.length]} label={String(i + 1)} />
        ))}
        {draft ? <RegionBox region={draft} color="#ffffff" dashed /> : null}
      </div>

      <Button
        label={snapshot ? 'Yeni kare al' : 'Ekrandan kare al'}
        onPress={takeSnapshot}
        loading={loading}
        variant="ghost"
      />
      {loading && !running ? <Para>PS5 yayınına bağlanılıyor, birkaç saniye sürebilir…</Para> : null}
      {error ? <Para tone="warn">{error}</Para> : null}

      <Card title="Seçili alanlar">
        {regions.length === 0 ? (
          <Para tone="warn">Alan yok. Kaydedersen varsayılan (ekranın alt %30'u) kullanılır.</Para>
        ) : (
          regions.map((r, i) => (
            <div key={i} className="region-row">
              <span className="region-swatch" style={{ background: REGION_COLORS[i % REGION_COLORS.length] }} />
              <span className="region-text">
                Alan {i + 1}: {describe(r)}
              </span>
              <button type="button" className="link danger-link" onClick={() => remove(i)}>
                Sil
              </button>
            </div>
          ))
        )}
        <button
          type="button"
          className="link"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => setRegions(DEFAULT_READ_REGIONS)}
        >
          Varsayılana dön (alt %30)
        </button>
      </Card>

      <div className="region-actions">
        <Button label="Kaydet" onPress={() => onSave(regions)} />
        <Button label="Vazgeç" onPress={onCancel} variant="ghost" />
      </div>
    </Page>
  );
}

function RegionBox({
  region,
  color,
  label,
  dashed,
}: {
  region: ReadRegion;
  color: string;
  label?: string;
  dashed?: boolean;
}) {
  return (
    <div
      className="region-box"
      style={{
        left: `${region.x * 100}%`,
        top: `${region.y * 100}%`,
        width: `${region.w * 100}%`,
        height: `${region.h * 100}%`,
        borderColor: color,
        borderStyle: dashed ? 'dashed' : 'solid',
      }}
    >
      {label ? (
        <span className="region-label" style={{ background: color }}>
          {label}
        </span>
      ) : null}
    </div>
  );
}

function toRect(x1: number, y1: number, x2: number, y2: number): ReadRegion {
  const c = (v: number) => Math.min(1, Math.max(0, v));
  const left = c(Math.min(x1, x2));
  const top = c(Math.min(y1, y2));
  return { x: left, y: top, w: c(Math.max(x1, x2)) - left, h: c(Math.max(y1, y2)) - top };
}

const pct = (v: number) => `%${Math.round(v * 100)}`;

export function describe(r: ReadRegion): string {
  return `soldan ${pct(r.x)}, üstten ${pct(r.y)} · ${pct(r.w)} × ${pct(r.h)}`;
}
