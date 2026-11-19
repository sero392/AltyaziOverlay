// "Tüm sayfayı çevir": blok çıkarma, sayfa kararlılığı, çeviri ve TV mesajı.
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { test } from 'node:test';
import type { OcrRawLine } from '../src/main/native/ocrHelper';
import { PageChangeFilter, extractPageBlocks, samePage, stripButtonGlyphs } from '../src/main/pipeline/pagePipeline';
import { upscale2x } from '../src/main/native/upscale';
import { PageTranslator } from '../src/main/translation/pageTranslator';
import { TvLink } from '../src/main/tvLink';
import { DEFAULT_STYLE, PageItem } from '../src/shared/types';

const W = 1920;
const H = 1080;
const line = (text: string, x: number, y: number, w: number, h = 30): OcrRawLine => ({ text, x, y, w, h });

test('menü öğeleri ayrı bloklar, paragraf satırları tek blok olur', () => {
  const blocks = extractPageBlocks(
    [
      // Sol menü: kısa, alt alta, sola hizalı satırlar -> ayrı ayrı çevrilir.
      line('Resume', 100, 300, 160),
      line('Options', 100, 345, 170),
      line('Quit Game', 100, 390, 220),
      // Sağda açıklama paragrafı (iki satıra kaydırılmış).
      line('A sturdy revolver favored by outlaws', 900, 300, 700),
      line('across the frontier.', 900, 340, 380),
      // HUD: sayı ve tek harf -> atlanır.
      line('100/100', 1700, 50, 120),
      line('X', 1800, 1000, 20),
      // Çok küçük yazı -> atlanır.
      line('v1.02 build 3381', 10, 1060, 150, 8),
    ],
    W,
    H,
    false,
  );
  assert.deepEqual(
    blocks.map(b => b.text),
    ['Resume', 'A sturdy revolver favored by outlaws across the frontier.', 'Options', 'Quit Game'],
  );
  const para = blocks[1].box;
  assert.ok(Math.abs(para.x - 900 / W) < 1e-3);
  assert.ok(Math.abs(para.y - 300 / H) < 1e-3);
  assert.ok(Math.abs(para.w - 700 / W) < 1e-3);
  assert.ok(Math.abs(para.h - 70 / H) < 1e-3);
});

test('haritadaki iki satırlık yer adı tek blok, büyük harfli menü öğeleri ayrı kalır', () => {
  const blocks = extractPageBlocks(
    [
      // Harita etiketi: ortalı, sıkı.
      line('WALLACE', 600, 400, 140, 24),
      line('STATION', 604, 428, 132, 24),
      // Büyük harfli menü: aralarında geniş boşluk.
      line('CONTINUE', 100, 300, 200, 30),
      line('OPTIONS', 100, 350, 180, 30),
    ],
    W,
    H,
    false,
  );
  assert.deepEqual(blocks.map(b => b.text).sort(), ['CONTINUE', 'OPTIONS', 'WALLACE STATION']);
});

test('tireyle bölünmüş kelime birleştirilir', () => {
  const blocks = extractPageBlocks(
    [line('This weapon deals extra damage to unarm-', 200, 500, 800), line('ored enemies.', 200, 540, 260)],
    W,
    H,
    false,
  );
  assert.deepEqual(blocks.map(b => b.text), ['This weapon deals extra damage to unarmored enemies.']);
});

test('sayfa kararlılığı: aynı yazılar iki kez görülünce yayınlanır, OCR gürültüsü yeni sayfa sayılmaz', () => {
  const f = new PageChangeFilter(2);
  const a = extractPageBlocks([line('Resume', 100, 300, 160), line('Options', 100, 345, 170)], W, H, false);
  const noisy = extractPageBlocks([line('Resurne', 100, 301, 162), line('Options', 100, 345, 170)], W, H, false);
  assert.equal(f.onRecognized(a), null);
  assert.deepEqual(f.onRecognized(noisy)?.map(b => b.text), ['Resurne', 'Options']);
  assert.ok(samePage(a, noisy));
  // Yayınlanmış sayfa tekrar okununca yeniden gönderilmez.
  assert.equal(f.onRecognized(a), null);
  // Sayfa değişti: önce aday, görüntü değişmeden kalınca onay.
  const b = extractPageBlocks([line('Inventory', 100, 300, 200)], W, H, false);
  assert.equal(f.onRecognized(b), null);
  assert.deepEqual(f.onFrameUnchanged()?.map(x => x.text), ['Inventory']);
  // Yazı kalktı: boş sayfa da kararlı olunca yayınlanır (TV temizlenir).
  assert.equal(f.onRecognized([]), null);
  assert.deepEqual(f.onRecognized([]), []);
});

test('PageTranslator: her blok çevrilir, aynı kalanlar örtülmez, eski sayfa yenisini ezmez', async () => {
  const shown: PageItem[][] = [];
  const dict: Record<string, string> = { Resume: 'Devam et', Options: 'Seçenekler', Arthur: 'Arthur' };
  let slow = true;
  const service = {
    async translate(text: string) {
      if (text === 'Options' && slow) {
        await new Promise(r => setTimeout(r, 50));
      }
      return { text: dict[text] ?? `TR(${text})`, fromCache: false };
    },
  };
  const history: unknown[] = [];
  const t = new PageTranslator(service, items => shown.push(items), e => history.push(e));
  const blocks = extractPageBlocks(
    [line('Resume', 100, 300, 160), line('Options', 100, 345, 170), line('Arthur', 900, 100, 160)],
    W,
    H,
    false,
  );
  const first = t.handle({ blocks, frameId: 1, ocrLatencyMs: 10 });
  // Yeni sayfa gelir: ilkinin geç biten çevirisi ekrana yazılmamalı.
  const second = t.handle({ blocks: blocks.filter(b => b.text === 'Resume'), frameId: 2, ocrLatencyMs: 10 });
  await Promise.all([first, second]);
  assert.deepEqual(shown.at(-1)!.map(i => i.text), ['Devam et']);
  assert.ok(shown.every(s => s.length <= 1 || !s.some(i => i.text === 'Arthur')));

  shown.length = 0;
  slow = false;
  await t.handle({ blocks, frameId: 3, ocrLatencyMs: 10 });
  assert.deepEqual(shown.at(-1)!.map(i => i.text).sort(), ['Devam et', 'Seçenekler']);
  assert.equal(shown.at(-1)!.find(i => i.text === 'Devam et')!.box.x, blocks.find(b => b.text === 'Resume')!.box.x);

  await t.handle({ blocks: [], frameId: 4, ocrLatencyMs: 0 });
  assert.deepEqual(shown.at(-1), []);
});

test('TvLink: page mesajı kutularla gider, yeniden bağlanınca tekrarlanır', async () => {
  const pages: any[] = [];
  let connections = 0;
  const server = createServer(sock => {
    connections++;
    let buf = '';
    sock.on('data', d => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const m = JSON.parse(buf.slice(0, i));
        buf = buf.slice(i + 1);
        if (m.t === 'page') {
          pages.push({ conn: connections, m });
        }
      }
    });
    if (connections === 1) {
      setTimeout(() => sock.destroy(), 200);
    }
  });
  await new Promise<void>(r => server.listen(47800, '127.0.0.1', r));
  const tv = new TvLink(() => {});
  try {
    tv.start('127.0.0.1', DEFAULT_STYLE);
    await new Promise(r => setTimeout(r, 100));
    tv.sendPage([{ text: 'Devam et', box: { x: 0.05, y: 0.27, w: 0.08, h: 0.03 } }]);
    await new Promise(r => setTimeout(r, 3600));
    assert.ok(pages.some(p => p.conn === 1 && p.m.items[0].text === 'Devam et'));
    assert.ok(pages.some(p => p.conn === 2 && p.m.items[0].box.x === 0.05), 'yeniden bağlanınca sayfa tekrar gönderilmeli');
  } finally {
    tv.stop();
    server.close();
  }
});

test('tuş simgeleri atılır, yazının noktalaması kalır', () => {
  const blocks = extractPageBlocks(
    [
      line('Read @', 1180, 570, 80),
      line('Put Away O', 1150, 640, 110),
      line('© Close', 1150, 700, 110),
      line('Just the biggest load of nonsense yet ...', 300, 600, 600),
    ],
    W,
    H,
    false,
  );
  assert.deepEqual(blocks.map(b => b.text).sort(), [
    'Close',
    'Just the biggest load of nonsense yet ...',
    'Put Away',
    'Read',
  ]);
  const read = blocks.find(b => b.text === 'Read')!.box;
  assert.ok(read.w < 80 / W * 0.8, 'kutu simgeyi örtmemeli');
});

test('OCR gürültüsüyle yeniden okunan yazı önceki metniyle yayınlanır', () => {
  const f = new PageChangeFilter(2);
  const read = (t: string, x = 300) => extractPageBlocks([line(t, x, 600, 640)], W, H, false);
  f.onRecognized(read("it's enough to turn a good honest feller to drink..."));
  assert.equal(f.onFrameUnchanged()![0].text, "it's enough to turn a good honest feller to drink...");
  // Kutu kaydı (yeniden yayın) ama metin gürültülü: eski metin korunur.
  const moved = f.onRecognized(read("it's enough to turn a good honest feller to djnk..", 360));
  assert.equal(moved![0].text, "it's enough to turn a good honest feller to drink...");
  // Yazı gidip geri gelince de aynı metin.
  f.onRecognized([]);
  f.onFrameUnchanged();
  f.onRecognized(read("it's enough to turn a good honest fe1ler to drink..."));
  assert.equal(f.onFrameUnchanged()![0].text, "it's enough to turn a good honest feller to drink...");
});

test("harita etiketi: OCR küçük harf okusa da ('CALIBAN’s') birleşir", () => {
  const blocks = extractPageBlocks([line('CALIBAN’s', 600, 400, 140, 24), line('SEAT', 630, 428, 80, 24)], W, H, false);
  assert.deepEqual(blocks.map(b => b.text), ['CALIBAN’s SEAT']);
});

test('satır içi simgeyle bölünen satır birleşir, uzak sütunlar ayrı kalır', () => {
  const blocks = extractPageBlocks(
    [
      line('Your temporary horse is out of', 30, 30, 360, 22),
      line('whistling range. While out of range, it', 30, 56, 440, 22),
      line('will be shown as', 30, 82, 200, 22),
      line('. You must get', 262, 82, 160, 22),
      line('closer in order to be able to call it.', 30, 108, 420, 22),
      // Uzak sütun: etiket ve değer ayrı çevrilir.
      line('Coat', 1400, 300, 60, 22),
      line('Palomino', 1700, 300, 110, 22),
    ],
    W,
    H,
    false,
  );
  assert.deepEqual(blocks.map(b => b.text), [
    'Your temporary horse is out of whistling range. While out of range, it will be shown as . You must get closer in order to be able to call it.',
    'Coat',
    'Palomino',
  ]);
});

test('bilgi kutusu hattı: yalnızca sol üst okunur, kutular tam kareye göre verilir', async () => {
  const { PagePipeline, INFO_REGION } = await import('../src/main/pipeline/pagePipeline');
  const fw = 1280;
  const fh = 720;
  const seen: { w: number; h: number }[] = [];
  const ocr = {
    info: { lang: 'en-US' },
    async recognize(_g: Uint8Array, w: number, h: number) {
      seen.push({ w, h });
      return [
        line('Individuals that owe the gang money', 22, 18, 280, 18),
        line('are marked on the map with . Seek', 22, 37, 284, 18),
        line('out the debtors and recover the money.', 22, 56, 288, 18),
        line('$219', 480, 18, 60, 30),
      ];
    },
  } as any;
  const events: any[] = [];
  const p = new PagePipeline(ocr, ev => events.push(ev));
  let n = 0;
  const frame = () => {
    const g = new Uint8Array(fw * fh);
    g.fill(n++ % 2 ? 200 : 20);
    return g;
  };
  for (let i = 0; i < 4 && !events.length; i++) {
    p.onFrame(frame(), fw, fh);
    await new Promise(r => setTimeout(r, 5));
  }
  assert.deepEqual(seen[0], { w: Math.round(fw * INFO_REGION.w), h: Math.round(fh * INFO_REGION.h) });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].blocks.map((b: any) => b.text), [
    'Individuals that owe the gang money are marked on the map with . Seek out the debtors and recover the money.',
  ]);
  const box = events[0].blocks[0].box;
  assert.ok(Math.abs(box.x - (22 / (fw * INFO_REGION.w)) * INFO_REGION.w) < 1e-3);
  assert.ok(box.y < 0.05 && box.h < 0.1);
});

test('GTA 6 ipuçlarındaki tuş simgesi kalıntıları temizlenir', () => {
  assert.equal(stripButtonGlyphs('You can also hold • : • to view'), 'You can also hold to view');
  assert.equal(stripButtonGlyphs('@Collect Brian\'s Rent'), "Collect Brian's Rent");
  assert.equal(stripButtonGlyphs('O Go See Cal'), 'Go See Cal');
  assert.equal(stripButtonGlyphs('AIM & LOOK SENSITIVITY'), 'AIM & LOOK SENSITIVITY');
});

test('ortadaki simge silinince kutu satırın iki ucunu kapsamaya devam eder', () => {
  const [b] = extractPageBlocks([{ text: 'You can also hold • : • to view', x: 100, y: 500, w: 620, h: 26 }], W, H, false);
  assert.equal(b.text, 'You can also hold to view');
  assert.ok(Math.abs(b.box.x * W - 100) < 1);
  assert.ok(Math.abs(b.box.w * W - 620) < 1);
});

test('upscale2x boyutu ikiye katlar ve düz alanı korur', () => {
  const out = upscale2x(new Uint8Array([10, 10, 10, 10]), 2, 2);
  assert.equal(out.length, 16);
  assert.ok(out.every(v => v === 10));
});
