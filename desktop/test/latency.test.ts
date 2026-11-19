// DeepL gecikmesini azaltan parçalar: kalıcı bağlantı, ikinci istek, erken çeviri.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { CachedTranslationService } from '../../src/services/translation/CachedTranslationService';
import { TextChangeFilter } from '../src/main/pipeline/filters';
import { HedgedTranslationService } from '../src/main/translation/HedgedTranslationService';
import { httpRequest } from '../src/main/translation/http';
import { SubtitleTranslator } from '../src/main/translation/subtitleTranslator';

test('httpRequest: 5 sn boşluktan sonra da aynı bağlantıyı kullanır (fetch 4 sn sonra kapatıyordu)', async () => {
  let connections = 0;
  const server = createServer((req, res) => res.end('ok'));
  server.keepAliveTimeout = 60_000;
  server.on('connection', () => connections++);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port;
  const url = `http://127.0.0.1:${port}/x`;
  assert.equal((await httpRequest({ url, method: 'GET', headers: {} })).body, 'ok');
  await new Promise(r => setTimeout(r, 5000));
  assert.equal((await httpRequest({ url, method: 'POST', headers: {}, body: '{"a":1}' })).status, 200);
  assert.equal(connections, 1);
  server.closeAllConnections();
  server.close();
});

const slowThenFast = () => {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    translate() {
      const ms = calls++ === 0 ? 3000 : 50;
      return new Promise<{ text: string; fromCache: boolean }>(r =>
        setTimeout(() => r({ text: `yanıt ${ms}`, fromCache: false }), ms),
      );
    },
  };
};

test('yavaş kalan DeepL isteğine ikinci istek: hızlı olan kazanır', async () => {
  const deepl = slowThenFast();
  const svc = new HedgedTranslationService(deepl, deepl, () => {}, 700);
  const t = Date.now();
  const r = await svc.translate('Hello');
  const ms = Date.now() - t;
  assert.equal(r.text, 'yanıt 50');
  assert.ok(ms >= 700 && ms < 1200, `${ms} ms`);
  assert.equal(deepl.calls, 2);
});

test('TextChangeFilter.freshCandidate: yalnızca ilk görülen yeni aday', () => {
  const f = new TextChangeFilter(2, 0.8);
  assert.equal(f.onRecognized('Hold on, partner.'), null);
  assert.equal(f.freshCandidate(), 'Hold on, partner.');
  assert.equal(f.onRecognized('Hold on, partner.'), 'Hold on, partner.');
  assert.equal(f.freshCandidate(), null);
  f.onRecognized('Hold on, partner.');
  assert.equal(f.freshCandidate(), null); // zaten gösterildi
  f.onRecognized('');
  assert.equal(f.freshCandidate(), null); // boş = gizleme, çeviri yok
});

test('erken çeviri: onay geldiğinde istek paylaşılır, DeepL bir kez çağrılır', async () => {
  let calls = 0;
  const inner = {
    translate: () => {
      calls++;
      return new Promise<{ text: string; fromCache: boolean }>(r =>
        setTimeout(() => r({ text: 'Dur bakalım, ortak.', fromCache: false }), 300),
      );
    },
  };
  const shown: string[] = [];
  const tr = new SubtitleTranslator(new CachedTranslationService(inner), t => shown.push(t), () => {});
  const t0 = Date.now();
  tr.prefetch('Hold on, partner.');
  await new Promise(r => setTimeout(r, 250)); // kararlılık beklemesi
  await tr.handle({ text: 'Hold on, partner.', frameId: 1, ocrLatencyMs: 0, timestamp: Date.now() });
  assert.equal(calls, 1);
  assert.deepEqual(shown, ['Dur bakalım, ortak.']);
  assert.ok(Date.now() - t0 < 450);
  assert.ok(tr.history[0].translationLatencyMs! < 150, `${tr.history[0].translationLatencyMs} ms`);
});
