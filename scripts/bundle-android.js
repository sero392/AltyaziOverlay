/**
 * Release için JS paketini üretir ve Hermes bytecode'una derler:
 *   android/app/src/main/assets/index.android.bundle
 *
 * Ardından: cd android && gradlew assembleRelease -PprebundledJs
 *
 * Neden Gradle'ın kendi paketlemesi değil: Windows'ta proje yolu 260 karakteri aştığı için
 * native kısım `subst` ile kısa bir sürücüden derleniyor; Gradle'ın Metro paketlemesi bu
 * kısa/gerçek yol karışıklığında başarısız oluyor. Bu betik gerçek yoldan çalışır.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const tmpDir = path.join(root, 'android', 'app', 'build', 'prebundle');
const jsBundle = path.join(tmpDir, 'index.android.js');
const assetsDir = path.join(root, 'android', 'app', 'src', 'main', 'assets');
const output = path.join(assetsDir, 'index.android.bundle');

const hermesBin = {
  win32: 'win64-bin/hermesc.exe',
  darwin: 'osx-bin/hermesc',
  linux: 'linux64-bin/hermesc',
}[process.platform];
const hermesc = path.join(root, 'node_modules', 'hermes-compiler', 'hermesc', hermesBin);

fs.mkdirSync(tmpDir, { recursive: true });
fs.mkdirSync(assetsDir, { recursive: true });

console.log('1/2 Metro bundle…');
execFileSync(
  process.execPath,
  [
    path.join(root, 'node_modules', 'react-native', 'cli.js'),
    'bundle',
    '--platform', 'android',
    '--dev', 'false',
    '--minify', 'false',
    '--entry-file', 'index.js',
    '--bundle-output', jsBundle,
    '--assets-dest', path.join(tmpDir, 'res'),
    '--reset-cache',
  ],
  { cwd: root, stdio: 'inherit' },
);

console.log('2/2 Hermes bytecode…');
execFileSync(hermesc, ['-emit-binary', '-O', '-w', '-out', output, jsBundle], {
  stdio: 'inherit',
});

console.log(`OK -> ${path.relative(root, output)} (${fs.statSync(output).size} bytes)`);
