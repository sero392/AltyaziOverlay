// webOS simgeleri (80x80 icon, 130x130 largeIcon): masaüstü uygulamasının kodla çizilen simgesi.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, '..', 'desktop', 'scripts', 'build-icon.mjs');
for (const [size, name] of [[80, 'icon.png'], [130, 'largeIcon.png']]) {
  execFileSync(process.execPath, [script, String(size), join(root, 'app', name)], { stdio: 'inherit' });
}
