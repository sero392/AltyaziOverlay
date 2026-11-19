// Kotlin tarafındaki filtrelerle aynı davranışı doğrular (FrameDiff / TextChange / Heuristics / UiText).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FrameDiffDetector,
  TextChangeFilter,
  isUiText,
  normalize,
  selectSubtitle,
  similarity,
  tokenContainment,
} from '../src/main/pipeline/filters';
import { extractSubtitle } from '../src/main/pipeline/subtitlePipeline';
import { RegionLayout } from '../src/main/pipeline/regionLayout';

test('normalize ve benzerlik', () => {
  assert.equal(normalize('Hello there.'), normalize('hello  there'));
  assert.ok(similarity('approach', 'approuch') > 0.8);
  assert.equal(similarity('', ''), 1);
  assert.ok(tokenContainment('we need to move now', 'we need to move now arthur') >= 0.8);
});

test('TextChangeFilter: kararlı olunca yayınlar, aynı metni tekrar yayınlamaz', () => {
  const f = new TextChangeFilter(2, 0.8);
  assert.equal(f.onRecognized('We need to go.'), null);
  assert.equal(f.onRecognized('We need to go'), 'We need to go.');
  assert.equal(f.onRecognized('We need to go.'), null);
  assert.equal(f.onFrameUnchanged(), null);
  // Gizleme bir kare fazla onay ister.
  assert.equal(f.onRecognized(''), null);
  assert.equal(f.onRecognized(''), null);
  assert.equal(f.onRecognized(''), '');
});

test('UiTextFilter kontrol ipuçlarını eler', () => {
  assert.ok(isUiText('Hold L1 to view'));
  assert.ok(isUiText('Press to select Bow'));
  assert.ok(!isUiText('Arthur, come here.'));
});

test('SubtitleHeuristics menüleri eler, altyazıyı birleştirir', () => {
  const sub = selectSubtitle([
    { text: 'We have to leave', top: 10, bottom: 40 },
    { text: 'before they find us.', top: 44, bottom: 74 },
  ]);
  assert.equal(sub.text, 'We have to leave before they find us.');
  const menu = selectSubtitle([
    { text: 'INVENTORY', top: 0, bottom: 20 },
    { text: 'x12', top: 30, bottom: 50 },
    { text: 'Bandage', top: 60, bottom: 80 },
  ]);
  assert.equal(menu.text, '');
});

test('extractSubtitle: ortalanmamış ve küçük satırları atar, Türkçe OCR harflerini düzeltir', () => {
  const w = 1280;
  const h = 144; // 720p'nin alt %20'si
  const lines = [
    { text: 'Thıs ıs a test lıne.', x: 440, y: 40, w: 400, h: 30 },
    { text: 'HUD 100', x: 10, y: 5, w: 80, h: 8 },
    { text: 'Corner label here', x: 0, y: 90, w: 200, h: 30 },
  ];
  const layout = new RegionLayout([{ x: 0, y: 0.8, w: 1, h: 0.2 }], w, 720);
  assert.equal(layout.height, h);
  assert.equal(extractSubtitle(lines, layout, true), 'This is a test line.');
});

test('FrameDiffDetector: aynı kare değişmemiş sayılır', () => {
  const d = new FrameDiffDetector();
  const w = 640;
  const h = 64;
  const a = new Uint8Array(w * h).fill(20);
  assert.equal(d.hasChanged(a, w, h), true);
  assert.equal(d.hasChanged(a, w, h), false);
  const b = new Uint8Array(a);
  for (let y = 10; y < 50; y++) {
    for (let x = 100; x < 500; x++) {
      b[y * w + x] = 230;
    }
  }
  assert.equal(d.hasChanged(b, w, h), true);
});

// ---------------------------------------------------------------- canlı test (RDR2) bulguları

test('görev / öğretici yazıları arayüz sayılır', async () => {
  const { isUiText } = await import('../src/main/pipeline/filters');
  for (const hud of [
    'Follow Hosea',
    'Follow Hosed',
    'Mount your horse',
    'Hunt (i rabbit',
    'Pick up the rabbit',
    'tear down your camp to',
    'Use O to cook',
    'View the Crafting menu',
    '@ ViÂw the Crafting menu',
    'Höld @ to exit crafting',
    'Hold ttv show the Weapon Wheel',
    'Switch to the Item Wheel',
    'Cook another or exit the Crafting menu',
  ]) {
    assert.equal(isUiText(hud), true, hud);
  }
  for (const line of [
    'Follow me.',
    'Lead the way.',
    'Mount up, we ride to Valentine.',
    'Cook that rabbit then.',
    "We'll try our luck down by the water, that's where I saw him",
    'Hold on, partner.',
    'I just hope I can remember how to get there.',
    'Can you mix up this bait for me while I finish',
  ]) {
    assert.equal(isUiText(line), false, line);
  }
});

test('aynı satırda okunan görev yazısı cümle sonundan kırpılır', async () => {
  const { stripTrailingObjective } = await import('../src/main/pipeline/filters');
  assert.equal(stripTrailingObjective('Got one! Pick up the rabbit'), 'Got one!');
  assert.equal(stripTrailingObjective('Not that much. Mount your horse'), 'Not that much.');
  assert.equal(stripTrailingObjective('So far, so good. Follow Hosea'), 'So far, so good.');
  assert.equal(stripTrailingObjective('Lead the way. Follow Hosea'), 'Lead the way.');
  assert.equal(stripTrailingObjective('Follow me. I know the way.'), 'Follow me. I know the way.');
  assert.equal(stripTrailingObjective('Get on your horse, we ride to Valentine.'), 'Get on your horse, we ride to Valentine.');
});

test('OCR kırıntıları temizlenir', async () => {
  const { cleanSubtitleText } = await import('../src/main/pipeline/filters');
  assert.equal(cleanSubtitleText("• How's that horse treating you?"), "How's that horse treating you?");
  assert.equal(cleanSubtitleText(", It's called O'Creagh's Run."), "It's called O'Creagh's Run.");
  assert.equal(cleanSubtitleText('. I remember this place...'), 'I remember this place...');
  assert.equal(cleanSubtitleText('- I was virtually weaned on bear meat.'), 'I was virtually weaned on bear meat.');
  assert.equal(cleanSubtitleText('L Okay.'), 'Okay.');
  assert.equal(cleanSubtitleText('so Trelawny says... L'), 'so Trelawny says...');
  assert.equal(cleanSubtitleText("Right... but, if he's alive, we gotta try. —"), "Right... but, if he's alive, we gotta try.");
  for (const keep of ['...and he knows that.', 'I know.', 'A man in a hat.', '"Run!" he said.']) {
    assert.equal(cleanSubtitleText(keep), keep);
  }
});

test('extractSubtitle: görev satırını atar, altyazının tam karedeki yerini verir', () => {
  // 720p'nin alt %30'u: 1280x216; altyazı iki satır, altında görev yazısı.
  const lines = [
    { text: "We'll try our luck down by the water, that's where I saw him", x: 340, y: 60, w: 600, h: 28 },
    { text: 'last.', x: 610, y: 94, w: 60, h: 28 },
    { text: 'Follow Hosea', x: 560, y: 150, w: 160, h: 26 },
  ];
  const geo = { box: null as any };
  const layout = new RegionLayout([{ x: 0, y: 0.7, w: 1, h: 0.3 }], 1280, 720);
  const text = extractSubtitle(lines, layout, false, undefined, geo);
  assert.equal(text, "We'll try our luck down by the water, that's where I saw him last.");
  assert.deepEqual(geo.box, { x: 0.2656, y: 0.7833, w: 0.4688, h: 0.0861 });
});

test('RegionLayout: alanları alt alta ortalayarak birleştirir, kutuyu tam kareye geri çevirir', () => {
  const sw = 100;
  const sh = 100;
  const gray = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      gray[y * sw + x] = y; // her satır kendi numarası
    }
  }
  // Üstte dar (40 px) ve altta geniş (80 px) iki alan.
  const layout = new RegionLayout(
    [
      { x: 0.3, y: 0.1, w: 0.4, h: 0.1 },
      { x: 0.1, y: 0.8, w: 0.8, h: 0.1 },
    ],
    sw,
    sh,
  );
  const gap = 24;
  assert.equal(layout.width, 80);
  assert.equal(layout.height, 10 + gap + 10);
  const out = layout.compose(gray);
  // İlk alan yatayda ortalanır (80-40)/2 = 20; solundaki boşluk siyah.
  assert.equal(out[0], 0);
  assert.equal(out[20], 10);
  assert.equal(out[(gap + 10) * 80], 80);
  // İkinci alandaki satırın tam karedeki yeri.
  const box = layout.toFrameBox([{ text: 'x', top: gap + 10 + 2, bottom: gap + 10 + 6, left: 10, right: 50 }]);
  assert.deepEqual(box, { x: 0.2, y: 0.82, w: 0.4, h: 0.04 });
  // Tek, tam genişlikte alan: kopyasız şerit.
  const band = new RegionLayout([{ x: 0, y: 0.7, w: 1, h: 0.3 }], sw, sh);
  const strip = band.compose(gray);
  assert.equal(strip.length, 30 * sw);
  assert.equal(strip[0], 70);
});
