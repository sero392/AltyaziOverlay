// Yerel yardımcıları derler ve desktop/resources/bin altına koyar:
//  - altyazi-rp.exe  : chiaki-ng (C) -> zig cc + CMake + Ninja (native/.toolchain)
//  - altyazi-ocr.exe : Windows.Media.Ocr (C#) -> dotnet publish
// Kullanım: npm run build:native [-- rp|ocr]
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const native = join(root, 'native');
const outDir = join(root, 'resources', 'bin');
const only = process.argv[2];
mkdirSync(outDir, { recursive: true });

const run = (cmd, args, opts = {}) => {
  console.log(`> ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
};

function buildRp() {
  const tc = join(native, '.toolchain', 'Scripts');
  const cmake = join(tc, 'cmake.exe');
  if (!existsSync(cmake)) {
    throw new Error(
      'Araç zinciri yok. Kur: python -m venv native/.toolchain && native/.toolchain/Scripts/python -m pip install ziglang cmake ninja',
    );
  }
  const wrappers = join(native, 'toolchain');
  const build = join(native, 'build', 'rp');
  const fwd = p => p.replace(/\\/g, '/');
  run(cmake, [
    '-S', join(native, 'rp-helper'),
    '-B', build,
    '-G', 'Ninja',
    `-DCMAKE_MAKE_PROGRAM=${fwd(join(tc, 'ninja.exe'))}`,
    '-DCMAKE_SYSTEM_NAME=Windows',
    `-DCMAKE_C_COMPILER=${fwd(join(wrappers, 'zig-cc.cmd'))}`,
    `-DCMAKE_AR=${fwd(join(wrappers, 'zig-ar.cmd'))}`,
    `-DCMAKE_RANLIB=${fwd(join(wrappers, 'zig-ranlib.cmd'))}`,
    `-DCMAKE_RC_COMPILER=${fwd(join(wrappers, 'zig-rc.cmd'))}`,
    '-DCMAKE_BUILD_TYPE=Release',
    '-DCMAKE_POLICY_VERSION_MINIMUM=3.5',
  ]);
  run(cmake, ['--build', build]);
  copyFileSync(join(build, 'altyazi-rp.exe'), join(outDir, 'altyazi-rp.exe'));
}

function buildOcr() {
  const publish = join(native, 'build', 'ocr');
  run('dotnet', [
    'publish', join(native, 'ocr-helper', 'OcrHelper.csproj'),
    '-c', 'Release', '-r', 'win-x64', '--self-contained', 'false',
    '-p:PublishSingleFile=true', '-o', publish,
  ]);
  copyFileSync(join(publish, 'altyazi-ocr.exe'), join(outDir, 'altyazi-ocr.exe'));
}

if (!only || only === 'rp') buildRp();
if (!only || only === 'ocr') buildOcr();
console.log(`Hazır: ${outDir}`);
