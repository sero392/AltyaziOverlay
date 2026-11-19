// Paketleme simgesi: src/shared/iconBitmap.ts'teki çizimi PNG'ye yazar.
// Varsayılan: 256x256 -> build/icon.png (electron-builder bunu .ico'ya çevirir).
// Kullanım: node build-icon.mjs [boyut] [çıktı.png]  (webOS simgeleri de buradan üretilir)
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = await build({
  entryPoints: [join(root, 'src', 'shared', 'iconBitmap.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const { drawIconBgra } = await import(
  'data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64')
);

const size = Number(process.argv[2]) || 256;
const outFile = process.argv[3] ? resolve(process.argv[3]) : join(root, 'build', 'icon.png');
const bgra = drawIconBgra(size);
// BGRA (önceden çarpılmış) -> RGBA (düz alfa), satır başına filtre baytı 0.
const raw = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const o = y * (size * 4 + 1) + 1 + x * 4;
    const a = bgra[i + 3];
    const un = v => (a ? Math.min(255, Math.round((v * 255) / a)) : 0);
    raw[o] = un(bgra[i + 2]);
    raw[o + 1] = un(bgra[i + 1]);
    raw[o + 2] = un(bgra[i]);
    raw[o + 3] = a;
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = buf => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8; // bit derinliği
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, png);
console.log('icon ok');
