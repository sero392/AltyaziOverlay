import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { OcrInfo } from '../../shared/types';
import { binPath } from './binPath';
import { UPSCALE_BELOW_WIDTH, upscale2x } from './upscale';

export interface OcrRawLine {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Pending {
  resolve: (lines: OcrRawLine[]) => void;
  reject: (e: Error) => void;
}

/**
 * altyazi-ocr.exe (Windows.Media.Ocr) süreç sarmalayıcısı. Android'deki
 * TextRecognizerEngine'in ML Kit çağrısının yerini alır. Süreç çökerse bir sonraki
 * istekte yeniden başlatılır.
 */
export class OcrHelper {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  info: OcrInfo = { ready: false, lang: null, available: [], error: null };

  constructor(private readonly onInfo: (info: OcrInfo) => void) {}

  get available() {
    return binPath('altyazi-ocr.exe') !== null;
  }

  start() {
    if (this.proc) {
      return;
    }
    const exe = binPath('altyazi-ocr.exe');
    if (!exe) {
      this.setInfo({ ready: false, lang: null, available: [], error: 'OCR yardımcısı derlenmemiş (npm run build:native)' });
      return;
    }
    const proc = spawn(exe, ['--lang', 'en-US'], { windowsHide: true });
    this.proc = proc;
    createInterface({ input: proc.stdout }).on('line', line => this.onLine(line));
    proc.stderr.on('data', d => console.warn('[ocr]', String(d).trim()));
    proc.on('exit', code => {
      if (this.proc === proc) {
        this.proc = null;
      }
      for (const p of this.pending.values()) {
        p.reject(new Error(`OCR süreci kapandı (${code})`));
      }
      this.pending.clear();
      this.setInfo({ ...this.info, ready: false });
    });
    proc.stdin.on('error', () => {});
  }

  stop() {
    this.proc?.stdin.end();
    this.proc?.kill();
    this.proc = null;
  }

  /**
   * Windows OCR küçük yazıda (satır ~10 px, 540p/720p yayın) harf karıştırır ("Continue" ->
   * "Canlinue"). Dar görüntüler 2 kat büyütülüp okunur; kutular yine orijinal piksellerde döner.
   */
  recognize(gray: Uint8Array, w: number, h: number): Promise<OcrRawLine[]> {
    const scale = w < UPSCALE_BELOW_WIDTH ? 2 : 1;
    if (scale === 1) {
      return this.recognizeRaw(gray, w, h);
    }
    return this.recognizeRaw(upscale2x(gray, w, h), w * 2, h * 2).then(lines =>
      lines.map(l => ({
        ...l,
        x: l.x / scale,
        y: l.y / scale,
        w: l.w / scale,
        h: l.h / scale,
      })),
    );
  }

  private recognizeRaw(gray: Uint8Array, w: number, h: number): Promise<OcrRawLine[]> {
    this.start();
    const proc = this.proc;
    if (!proc) {
      return Promise.reject(new Error(this.info.error ?? 'OCR yok'));
    }
    const id = this.nextId++ >>> 0;
    const header = Buffer.alloc(12);
    header.writeUInt32LE(id, 0);
    header.writeUInt32LE(w, 4);
    header.writeUInt32LE(h, 8);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      proc.stdin.write(header);
      proc.stdin.write(gray);
    });
  }

  private onLine(line: string) {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.ev === 'ready') {
      this.setInfo({
        ready: !!msg.lang,
        lang: msg.lang ?? null,
        available: msg.available ?? [],
        error: msg.lang ? null : 'Windows OCR dil paketi bulunamadı',
      });
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) {
      return;
    }
    this.pending.delete(msg.id);
    if (msg.error) {
      p.reject(new Error(msg.error));
    } else {
      p.resolve(msg.lines ?? []);
    }
  }

  private setInfo(info: OcrInfo) {
    this.info = info;
    this.onInfo(info);
  }
}
