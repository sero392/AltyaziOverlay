import { ChildProcess, execFile, spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { LlmState } from '../../shared/types';
import { buildPrompt, complete } from './LocalLlmTranslationService';

/**
 * llama.cpp sunucusunun Vulkan derlemesi: CUDA kurulumu istemez, NVIDIA / AMD / Intel ekran
 * kartlarında çalışır; ekran kartı yoksa işlemciye düşer. Sürüm sabit: istem biçimi ve
 * parametreler bu sürümle denendi.
 */
const LLAMA_VERSION = 'b12328';
const LLAMA_URL = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_VERSION}/llama-${LLAMA_VERSION}-bin-win-vulkan-x64.zip`;

/** Google'ın çeviriye özel modeli TranslateGemma 4B, 4 bit (Q4_K_M, ~2,5 GB). */
export const MODEL_FILE = 'translategemma-4b-it.Q4_K_M.gguf';
const MODEL_URL = `https://huggingface.co/mradermacher/translategemma-4b-it-GGUF/resolve/main/${MODEL_FILE}`;

const START_TIMEOUT_MS = 120_000;

/**
 * Yerel çeviri modelinin yaşam döngüsü: ilk kullanımda llama.cpp sunucusunu ve modeli
 * userData/llm altına indirir, sunucuyu 127.0.0.1'de arka planda başlatır ve kapanışta durdurur.
 */
export class LocalLlm {
  private readonly llamaDir: string;
  private readonly modelPath: string;
  private proc: ChildProcess | null = null;
  private starting: Promise<void> | null = null;
  private download: AbortController | null = null;
  private port = 0;
  state: LlmState;

  constructor(
    private readonly root: string,
    private readonly onChange: () => void,
  ) {
    this.llamaDir = join(root, 'llama', LLAMA_VERSION);
    this.modelPath = join(root, 'models', MODEL_FILE);
    this.state = { status: this.installed ? 'stopped' : 'missing', progress: null, error: null };
  }

  get installed(): boolean {
    return this.serverExe() !== null && existsSync(this.modelPath);
  }

  get ready(): boolean {
    return this.state.status === 'ready';
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  // ------------------------------------------------------------------ indirme

  async install(): Promise<void> {
    if (this.download || this.installed) {
      return;
    }
    const ctrl = new AbortController();
    this.download = ctrl;
    try {
      if (!this.serverExe()) {
        const zip = join(this.root, `llama-${LLAMA_VERSION}.zip`);
        await this.fetchTo(LLAMA_URL, zip, 'llama.cpp sunucusu', ctrl.signal);
        rmSync(this.llamaDir, { recursive: true, force: true });
        mkdirSync(this.llamaDir, { recursive: true });
        await extractZip(zip, this.llamaDir);
        rmSync(zip, { force: true });
        if (!this.serverExe()) {
          throw new Error('llama-server.exe arşivde bulunamadı');
        }
      }
      if (!existsSync(this.modelPath)) {
        await this.fetchTo(MODEL_URL, this.modelPath, 'TranslateGemma modeli', ctrl.signal);
      }
      this.set({ status: 'stopped', progress: null, error: null });
    } catch (e) {
      const cancelled = ctrl.signal.aborted;
      this.set({
        status: this.installed ? 'stopped' : 'missing',
        progress: null,
        error: cancelled ? null : `İndirme başarısız: ${(e as Error).message}`,
      });
      if (!cancelled) {
        throw e;
      }
    } finally {
      this.download = null;
    }
  }

  cancelInstall() {
    this.download?.abort();
  }

  /** `.part` dosyasına indirir (kesilirse kaldığı yerden devam eder), bitince yerine taşır. */
  private async fetchTo(url: string, dest: string, label: string, signal: AbortSignal) {
    mkdirSync(join(dest, '..'), { recursive: true });
    const part = dest + '.part';
    const have = existsSync(part) ? statSync(part).size : 0;
    const res = await fetch(url, { signal, headers: have ? { Range: `bytes=${have}-` } : {} });
    if (!res.ok || !res.body) {
      throw new Error(`${label}: HTTP ${res.status}`);
    }
    const resumed = res.status === 206;
    const offset = resumed ? have : 0;
    const total = offset + Number(res.headers.get('content-length') ?? 0);
    let received = offset;
    let lastPush = 0;
    this.set({ status: 'downloading', progress: { label, received, total }, error: null });
    const counter = new Transform({
      transform: (chunk: Buffer, _enc, cb) => {
        received += chunk.length;
        const now = Date.now();
        if (now - lastPush > 250) {
          lastPush = now;
          this.set({ ...this.state, progress: { label, received, total } });
        }
        cb(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(res.body as any),
      counter,
      createWriteStream(part, { flags: resumed ? 'a' : 'w' }),
      { signal },
    );
    if (total > 0 && statSync(part).size !== total) {
      throw new Error(`${label}: dosya eksik indi`);
    }
    renameSync(part, dest);
  }

  // ------------------------------------------------------------------ sunucu

  /** Sunucu çalışmıyorsa başlatır; hazır olunca çözülür. Aynı anda tek başlatma yapılır. */
  ensureStarted(): Promise<void> {
    if (this.ready) {
      return Promise.resolve();
    }
    if (!this.starting) {
      this.starting = this.start().finally(() => {
        this.starting = null;
      });
    }
    return this.starting;
  }

  private async start(): Promise<void> {
    const exe = this.serverExe();
    if (!exe || !existsSync(this.modelPath)) {
      throw new Error('Yerel model indirilmemiş');
    }
    this.port = await freePort();
    this.set({ status: 'starting', progress: null, error: null });
    const args = [
      '-m', this.modelPath,
      '--host', '127.0.0.1',
      '--port', String(this.port),
      // Tüm katmanlar ekran kartında; kart yoksa llama.cpp işlemciye düşer.
      '-ngl', '99',
      // İki paralel yuva: önceki replik bitmeden yenisi gelirse sıraya girmesin.
      '-np', '2',
      '-c', '4096',
      '--no-webui',
    ];
    console.log(`[llm] başlatılıyor: ${exe} ${args.join(' ')}`);
    const proc = spawn(exe, args, { cwd: join(exe, '..'), windowsHide: true });
    this.proc = proc;
    let tail = '';
    const onData = (d: Buffer) => {
      tail = (tail + d.toString()).slice(-4000);
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.on('exit', code => {
      if (this.proc !== proc) {
        return;
      }
      this.proc = null;
      const lastLines = tail.trim().split(/\r?\n/).slice(-5).join('\n');
      console.warn(`[llm] sunucu kapandı (kod ${code})\n${lastLines}`);
      this.set({
        status: 'error',
        progress: null,
        error: `Yerel model sunucusu kapandı (kod ${code})`,
      });
    });

    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (this.proc !== proc) {
        throw new Error(this.state.error ?? 'Yerel model sunucusu başlatılamadı');
      }
      try {
        const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(1000) });
        if (res.ok) {
          await this.warmUp();
          console.log(`[llm] hazır (${this.baseUrl})`);
          this.set({ status: 'ready', progress: null, error: null });
          return;
        }
      } catch {}
      await new Promise(r => setTimeout(r, 300));
    }
    this.stop();
    this.set({ status: 'error', progress: null, error: 'Yerel model 2 dakikada açılmadı' });
    throw new Error('Yerel model 2 dakikada açılmadı');
  }

  /**
   * Vulkan, ilk farklı boyutlu isteklerde gölgelendiricileri derler: ilk birkaç çeviri 6-13 sn
   * sürüyordu. Hazır demeden önce bağlamsız ve bağlamlı örneklerle ısıtılır (bu sırada çeviriyi
   * yedek motor yapar).
   */
  private async warmUp() {
    const t = Date.now();
    const samples: [string, [string, string][]][] = [
      ['Hello.', []],
      ['We need to get out of here before they show up.', [['Hello.', 'Merhaba.']]],
      [
        "I don't know what you're talking about, mister, but you'd better leave right now.",
        [
          ['Hello.', 'Merhaba.'],
          ['Who are you?', 'Sen kimsin?'],
        ],
      ],
    ];
    for (const [text, ctx] of samples) {
      try {
        await complete(this.baseUrl, buildPrompt(text, ctx), 60_000);
      } catch (e) {
        console.warn('[llm] ısıtma isteği başarısız', (e as Error).message);
      }
    }
    console.log(`[llm] ısıtma ${Date.now() - t} ms`);
  }

  stop() {
    const p = this.proc;
    this.proc = null;
    p?.kill();
    if (this.state.status === 'ready' || this.state.status === 'starting') {
      this.set({ status: this.installed ? 'stopped' : 'missing', progress: null, error: null });
    }
  }

  private serverExe(): string | null {
    return findFile(this.llamaDir, 'llama-server.exe');
  }

  private set(s: LlmState) {
    this.state = s;
    this.onChange();
  }
}

function findFile(dir: string, name: string, depth = 2): string | null {
  if (!existsSync(dir)) {
    return null;
  }
  const direct = join(dir, name);
  if (existsSync(direct)) {
    return direct;
  }
  if (depth > 0) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        const found = findFile(join(dir, e.name), name, depth - 1);
        if (found) {
          return found;
        }
      }
    }
  }
  return null;
}

/** Windows 10+ ile gelen bsdtar zip açabilir; ek bağımlılık gerekmez. */
function extractZip(zip: string, dest: string): Promise<void> {
  const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  return new Promise((resolve, reject) =>
    execFile(tar, ['-xf', zip, '-C', dest], { windowsHide: true }, err =>
      err ? reject(new Error(`arşiv açılamadı: ${err.message}`)) : resolve(),
    ),
  );
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}
