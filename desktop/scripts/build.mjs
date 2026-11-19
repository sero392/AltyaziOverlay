// esbuild ile tüm hedefleri dist/ altına paketler:
//   main.js (ana süreç), preload'lar, renderer (React), decoder ve overlay sayfaları.
// --tests: test/*.test.ts dosyalarını dist-tests/ altına derler (node --test ile çalışır).
import { build } from 'esbuild';
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');
const tests = process.argv.includes('--tests');

const common = {
  bundle: true,
  sourcemap: 'linked',
  logLevel: 'warning',
  // Paylaşılan mobil kodundan yalnızca tip olarak react-native gelir; paketlenmez.
  external: ['react-native'],
  define: { 'process.env.NODE_ENV': '"production"' },
};

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await Promise.all([
  build({
    ...common,
    entryPoints: [join(src, 'main', 'main.ts')],
    outfile: join(dist, 'main.js'),
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: [...common.external, 'electron'],
  }),
  ...['preload', 'decoderPreload', 'overlayPreload'].map(name =>
    build({
      ...common,
      entryPoints: [join(src, 'preload', `${name}.ts`)],
      outfile: join(dist, `${name}.js`),
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      external: [...common.external, 'electron'],
    }),
  ),
  build({
    ...common,
    entryPoints: [join(src, 'renderer', 'App.tsx')],
    outfile: join(dist, 'renderer', 'app.js'),
    platform: 'browser',
    format: 'iife',
    target: 'chrome130',
    jsx: 'automatic',
  }),
  build({
    ...common,
    entryPoints: [join(src, 'decoder', 'decoder.ts')],
    outfile: join(dist, 'decoder', 'decoder.js'),
    platform: 'browser',
    format: 'iife',
    target: 'chrome130',
  }),
  build({
    ...common,
    entryPoints: [join(src, 'overlay', 'overlay.ts')],
    outfile: join(dist, 'overlay', 'overlay.js'),
    platform: 'browser',
    format: 'iife',
    target: 'chrome130',
  }),
]);

cpSync(join(src, 'renderer', 'index.html'), join(dist, 'renderer', 'index.html'));
cpSync(join(src, 'renderer', 'styles.css'), join(dist, 'renderer', 'styles.css'));
cpSync(join(src, 'decoder', 'index.html'), join(dist, 'decoder', 'index.html'));
cpSync(join(src, 'overlay', 'index.html'), join(dist, 'overlay', 'index.html'));

if (tests) {
  const testDir = join(root, 'test');
  const out = join(root, 'dist-tests');
  rmSync(out, { recursive: true, force: true });
  await build({
    ...common,
    entryPoints: readdirSync(testDir).filter(f => f.endsWith('.test.ts')).map(f => join(testDir, f)),
    outdir: out,
    outExtension: { '.js': '.cjs' },
    platform: 'node',
    format: 'cjs',
    target: 'node22',
  });
}

console.log('build ok');
