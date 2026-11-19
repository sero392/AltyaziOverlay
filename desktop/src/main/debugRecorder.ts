import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { OcrRawLine } from './native/ocrHelper';

/**
 * Hata ayıklama kaydı: ALTYAZI_RECORD=<klasör> ile açılır. "Tüm sayfayı çevir" modunda OCR'ın
 * okuduğu kareler (gri PNG) ve TV'ye giden çeviriler zaman damgalı olarak yazılır; sonradan
 * TV'de görünen hal yeniden çizilebilir. Kapalıyken hiçbir şey yapmaz.
 */
const dir = process.env.ALTYAZI_RECORD || null;
const MIN_FRAME_GAP_MS = 1000;
let lastFrameAt = 0;

if (dir) {
  mkdirSync(join(dir, 'frames'), { recursive: true });
  console.log(`[kayıt] açık: ${dir}`);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) {
    c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function grayPng(gray: Uint8Array, w: number, h: number): Buffer {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0;
    raw.set(gray.subarray(y * w, y * w + w), y * (w + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit derinliği
  ihdr[9] = 0; // gri
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 3 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function log(ev: object) {
  if (!dir) {
    return;
  }
  try {
    appendFileSync(join(dir, 'events.jsonl'), JSON.stringify({ t: Date.now(), ...ev }) + '\n');
  } catch {
    // Kayıt hatası uygulamayı durdurmasın.
  }
}

export const debugRecorder = {
  enabled: !!dir,

  /** OCR sonucu: kare en fazla saniyede bir kaydedilir, satırlar her zaman. */
  ocr(frameId: number, gray: Uint8Array, w: number, h: number, lines: OcrRawLine[]) {
    if (!dir) {
      return;
    }
    const now = Date.now();
    let file: string | null = null;
    if (now - lastFrameAt >= MIN_FRAME_GAP_MS) {
      lastFrameAt = now;
      file = `frames/${now}_${frameId}.png`;
      try {
        writeFileSync(join(dir, file), grayPng(gray, w, h));
      } catch {
        file = null;
      }
    }
    log({ ev: 'ocr', frameId, w, h, file, lines });
  },

  emit(frameId: number, blocks: unknown) {
    log({ ev: 'emit', frameId, blocks });
  },

  show(items: unknown) {
    log({ ev: 'show', items });
  },
};
