// Canlı oyun kaydında bulunan sorunların düzeltmeleri: OCR karakter düzeltmesi ve DeepL gecikmesine
// karşı Google'a paralel soran "otomatik" çeviri.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DeepLError } from '../../src/services/translation/DeepLTranslationService';
import type { TranslationService } from '../../src/services/translation/TranslationService';
import { correctOcrEnglish } from '../src/main/pipeline/ocrCorrections';
import { HedgedTranslationService } from '../src/main/translation/HedgedTranslationService';

test('OCR düzeltmeleri: kayıttaki gerçek hatalar', () => {
  assert.equal(correctOcrEnglish("Sure, 1'11 shoot you."), "Sure, I'll shoot you.");
  assert.equal(correctOcrEnglish("1'11 crack your damn skull open."), "I'll crack your damn skull open.");
  assert.equal(correctOcrEnglish("1'm here and 1 know it."), "I'm here and I know it.");
  assert.equal(correctOcrEnglish('Corne on, pretty boy...'), 'Come on, pretty boy...');
  assert.equal(correctOcrEnglish('Gentlemen, alvvays a pleasure.'), 'Gentlemen, always a pleasure.');
  assert.equal(correctOcrEnglish('What business is it ofyours?'), 'What business is it of yours?');
  assert.equal(correctOcrEnglish('I beg yon.'), 'I beg you.');
});

test('OCR düzeltmeleri doğru metne dokunmaz', () => {
  for (const s of [
    'Turn the corner, often.',
    'He is savvy and within reach.',
    "I'll be there at 10 o'clock.",
    'Come on then, big boy.',
    'Those are 1 or 2 horses.',
  ]) {
    assert.equal(correctOcrEnglish(s), s);
  }
});

const fake = (ms: number, text: string, fail?: Error): TranslationService & { calls: number } => {
  const svc = {
    calls: 0,
    translate() {
      svc.calls++;
      return new Promise<{ text: string; fromCache: boolean }>((res, rej) =>
        setTimeout(() => (fail ? rej(fail) : res({ text, fromCache: false })), ms),
      );
    },
  };
  return svc;
};

test('Hedged: DeepL hızlıysa Google hiç çağrılmaz', async () => {
  const deepl = fake(50, 'deepl');
  const google = fake(10, 'google');
  const r = await new HedgedTranslationService(deepl, google, () => {}, 200).translate('x');
  assert.equal(r.text, 'deepl');
  assert.equal(google.calls, 0);
});

test('Hedged: DeepL gecikirse Google sonucu kullanılır', async () => {
  const r = await new HedgedTranslationService(fake(1000, 'deepl'), fake(20, 'google'), () => {}, 100).translate('x');
  assert.equal(r.text, 'google');
});

test('Hedged: DeepL hata verirse beklemeden Google; kalıcı hatada geçiş bildirilir', async () => {
  let reason = '';
  const svc = new HedgedTranslationService(fake(10, '', new DeepLError(456)), fake(10, 'google'), r => (reason = r), 5000);
  const t0 = Date.now();
  assert.equal((await svc.translate('x')).text, 'google');
  assert.ok(Date.now() - t0 < 1000);
  assert.match(reason, /kota/);
});

test('Hedged: ikisi de başarısızsa hata döner', async () => {
  const svc = new HedgedTranslationService(fake(10, '', new Error('a')), fake(10, '', new Error('b')), () => {}, 50);
  await assert.rejects(svc.translate('x'));
});

test('Yerel model: istem bağlamı önceki turlar olarak ekler', async () => {
  const { buildPrompt } = await import('../src/main/llm/LocalLlmTranslationService');
  const p = buildPrompt('Who are you?', [['Hello.', 'Merhaba.']]);
  assert.ok(p.startsWith('<bos><start_of_turn>user\n'));
  assert.ok(p.includes('Hello.<end_of_turn>\n<start_of_turn>model\nMerhaba.<end_of_turn>\n'));
  assert.ok(p.endsWith('Who are you?<end_of_turn>\n<start_of_turn>model\n'));
});

test('Yerel model hazır değilse beklemeden yedeğe geçilir ve sunucu başlatılır', async () => {
  const { LocalLlmTranslationService } = await import('../src/main/llm/LocalLlmTranslationService');
  let startCalls = 0;
  const llm = {
    ready: false,
    baseUrl: '',
    ensureStarted: () => {
      startCalls++;
      return new Promise<void>(() => {});
    },
  } as any;
  const backup = fake(50, 'yedek');
  const svc = new HedgedTranslationService(new LocalLlmTranslationService(llm), backup, () => {}, 1500);
  const t = Date.now();
  const r = await svc.translate('Hello');
  assert.equal(r.text, 'yedek');
  assert.ok(Date.now() - t < 500);
  assert.equal(startCalls, 1);
});

test('korunan adlarda Türkçe ek yeniden kurulur', async () => {
  const { protectWithPlaceholders, harmonizeSuffix } = await import('../../src/services/translation/protectedTerms');
  const terms = ['Hosea', 'Dutch', 'Saint Denis', 'Arthur', 'Valentine', 'Micah'];
  const p = protectWithPlaceholders('Ask Hosea if Dutch is in Saint Denis.', terms);
  assert.equal(p.text, 'Ask XZ0 if XZ1 is in XZ2.');
  assert.equal(
    p.restore("XZ0'ı bul, XZ1'nun XZ2'da olup olmadığını sor."),
    "Hosea'yı bul, Dutch'un Saint Denis'te olup olmadığını sor.",
  );
  assert.equal(harmonizeSuffix('Hosea', 'ı'), 'yı');
  assert.equal(harmonizeSuffix('Hosea', 'ın'), 'nın');
  assert.equal(harmonizeSuffix('Arthur', 'a'), 'a');
  assert.equal(harmonizeSuffix('Arthur', 'nın'), 'un');
  assert.equal(harmonizeSuffix('Micah', 'den'), 'tan');
  assert.equal(harmonizeSuffix('Valentine', 'ya'), 'e');
  assert.equal(harmonizeSuffix('Hosea', 'la'), 'yla');
  assert.equal(harmonizeSuffix('Dutch', 'ları'), 'ları'); // tanınmayan ek olduğu gibi kalır
});
