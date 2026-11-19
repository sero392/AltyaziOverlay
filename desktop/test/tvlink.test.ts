// TV'ye giden "sub" mesajı İngilizce altyazının konumunu taşır.
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { DEFAULT_STYLE } from '../src/shared/types';
import { TvLink } from '../src/main/tvLink';

test('TvLink: sub mesajı box alanını taşır, box yoksa alan yok', async () => {
  const lines: any[] = [];
  let resolveDone: () => void;
  const done = new Promise<void>(r => (resolveDone = r));
  const server = createServer(sock => {
    let buf = '';
    sock.on('data', d => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        lines.push(JSON.parse(buf.slice(0, i)));
        buf = buf.slice(i + 1);
        if (lines.filter(l => l.t === 'sub').length === 2) {
          resolveDone();
        }
      }
    });
  });
  await new Promise<void>(r => server.listen(47800, '127.0.0.1', r));
  const tv = new TvLink(s => {
    if (s.state === 'CONNECTED') {
      tv.sendSubtitle('Merhaba', { x: 0.25, y: 0.8, w: 0.5, h: 0.08 });
      tv.sendSubtitle('Konumsuz');
    }
  });
  tv.start('127.0.0.1', DEFAULT_STYLE);
  await done;
  tv.stop();
  server.close();
  const subs = lines.filter(l => l.t === 'sub');
  assert.deepEqual(subs[0], { t: 'sub', text: 'Merhaba', box: { x: 0.25, y: 0.8, w: 0.5, h: 0.08 } });
  assert.deepEqual(subs[1], { t: 'sub', text: 'Konumsuz' });
});
