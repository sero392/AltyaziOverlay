// Görünmez çözücü penceresi. Android'deki VideoDecoder (MediaCodec) + RemotePlayFrameSource
// karşılığı: Remote Play H.264 akışını WebCodecs ile (mümkünse donanımla) çözer; aralık dolunca
// kareyi griye çevirip OCR için ana sürece yollar (okuma alanları orada kesilir). İstenince okuma
// alanı kurulumu için tek bir renkli kareyi JPEG olarak verir. Görüntü hiçbir zaman ekrana çizilmez.
import type { DecoderBridge } from '../preload/decoderPreload';

declare global {
  interface Window {
    decoder: DecoderBridge;
  }
}

const bridge = window.decoder;
const CODEC_H264 = 'avc1.640028';

let cfg: { intervalMs: number } | null = null;
/** Okuma alanı kurulumu bir kare bekliyor. */
let wantSnapshot = false;
let decoder: VideoDecoder | null = null;
let waitingKey = true;
let lastProcessedAt = 0;
let lastIdrRequest = 0;
let decodedCount = 0;
let timestamp = 0;

const canvas = new OffscreenCanvas(16, 16);
const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
/** Kurulum karesi için ayrı tuval (gri kare tuvaline dokunmaz). */
const snapCanvas = new OffscreenCanvas(16, 16);
const snapCtx = snapCanvas.getContext('2d')!;
/** Kurulum karesinin en büyük genişliği (seçim için yeterli, IPC'de hafif). */
const SNAPSHOT_MAX_WIDTH = 1280;

function takeSnapshot(frame: VideoFrame) {
  wantSnapshot = false;
  const scale = Math.min(1, SNAPSHOT_MAX_WIDTH / frame.displayWidth);
  const w = Math.round(frame.displayWidth * scale);
  const h = Math.round(frame.displayHeight * scale);
  snapCanvas.width = w;
  snapCanvas.height = h;
  snapCtx.drawImage(frame, 0, 0, w, h);
  snapCanvas
    .convertToBlob({ type: 'image/jpeg', quality: 0.85 })
    .then(b => b.arrayBuffer())
    .then(
      buf => bridge.sendSnapshot(w, h, new Uint8Array(buf)),
      e => bridge.log(`snapshot failed: ${e?.message ?? e}`),
    );
}

const NAL_IDR = 5;
const NAL_SPS = 7;

/**
 * Chiaki'nin yayın başında BİR KEZ, ayrı örnek olarak verdiği SPS/PPS başlığı. Sonraki anahtar
 * karelerde (IDR) bu parametre setleri yoktur. Android'de MediaCodec başlığı hatırlar; WebCodecs
 * ise her "key" parçada SPS/PPS ister, yoksa sessizce hiçbir kare üretmez. Bu yüzden başlık
 * saklanır ve başlıksız her IDR'nin önüne eklenir.
 */
let paramSets: Uint8Array | null = null;

/** Annex-B örneğindeki NAL birimi tipleri (H.264). */
function nalTypes(data: Uint8Array): Set<number> {
  const types = new Set<number>();
  for (let i = 0; i + 3 < data.length; i++) {
    if (data[i] === 0 && data[i + 1] === 0) {
      let j = -1;
      if (data[i + 2] === 1) {
        j = i + 3;
      } else if (data[i + 2] === 0 && data[i + 3] === 1) {
        j = i + 4;
      }
      if (j >= 0 && j < data.length) {
        types.add(data[j] & 0x1f);
        // Bir dilimin içinde başka başlangıç kodu olmaz (emulation prevention); dilim
        // başladıysa gerisini taramaya gerek yok.
        const t = data[j] & 0x1f;
        if (t === 1 || t === NAL_IDR) {
          break;
        }
        i = j;
      }
    }
  }
  return types;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function requestIdr() {
  const now = performance.now();
  if (now - lastIdrRequest > 1000) {
    lastIdrRequest = now;
    bridge.requestIdr();
  }
}

function createDecoder() {
  decoder?.close();
  waitingKey = true;
  decoder = new VideoDecoder({
    output: onFrame,
    error: e => {
      bridge.log(`decode error: ${e.message}`);
      // Çözücü kapandı: yeniden kur, anahtar kare bekle.
      setTimeout(() => cfg && createDecoder(), 0);
      requestIdr();
    },
  });
  decoder.configure({
    codec: CODEC_H264,
    optimizeForLatency: true,
    hardwareAcceleration: 'no-preference',
  });
}

function onFrame(frame: VideoFrame) {
  try {
    decodedCount++;
    const c = cfg;
    if (!c) {
      return;
    }
    if (wantSnapshot) {
      takeSnapshot(frame);
    }
    const now = performance.now();
    if (now - lastProcessedAt < c.intervalMs) {
      return;
    }
    lastProcessedAt = now;
    const w = frame.displayWidth;
    const h = frame.displayHeight;
    if (w <= 0 || h <= 0) {
      return;
    }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.drawImage(frame, 0, 0, w, h);
    const rgba = ctx.getImageData(0, 0, w, h).data;
    const gray = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
      gray[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
    }
    bridge.sendFrame(w, h, gray);
  } finally {
    frame.close();
  }
}

bridge.onReset(next => {
  cfg = next;
  lastProcessedAt = 0;
  decodedCount = 0;
  if (next) {
    createDecoder();
  } else {
    decoder?.close();
    decoder = null;
  }
});

bridge.onConfig(next => {
  if (cfg) {
    cfg = next;
  }
});

bridge.onSnapshot(() => {
  wantSnapshot = true;
});

bridge.onVideo((input, framesLost) => {
  const types = nalTypes(input);
  const hasSlice = types.has(1) || types.has(NAL_IDR);
  if (types.has(NAL_SPS) && !hasSlice) {
    // Yalnızca başlık (SPS/PPS): sakla, tek başına çözülecek bir resim yok.
    paramSets = input;
    bridge.log(`stream header ${input.length} B`);
    return;
  }
  if (!decoder || decoder.state !== 'configured') {
    return;
  }
  const key = types.has(NAL_IDR);
  let sample = input;
  if (key && !types.has(NAL_SPS)) {
    if (!paramSets) {
      // Başlık kaçırıldı (ör. pencere yeniden yüklendi): çözülemez.
      bridge.log('IDR without stream header; skipping');
      return;
    }
    sample = concat(paramSets, input);
  }
  if (waitingKey && !key) {
    requestIdr();
    return;
  }
  if (framesLost > 0 && !key) {
    // Kayıp sonrası referans kareler bozuk olabilir; chiaki toparlar, biz de IDR isteriz.
    requestIdr();
  }
  // Çözücü geride kalırsa (OCR'a yetişmek tamlıktan önemli) yeni anahtar kareye kadar atla.
  if (decoder.decodeQueueSize > 30 && !key) {
    waitingKey = true;
    requestIdr();
    return;
  }
  waitingKey = false;
  timestamp += 33_333;
  decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp, data: sample }));
});

setInterval(() => {
  if (decoder && decodedCount === 0 && cfg) {
    requestIdr();
  }
}, 3000);

bridge.log('ready');
