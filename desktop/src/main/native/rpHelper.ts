import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { binPath } from './binPath';

/**
 * altyazi-rp.exe (chiaki-ng) süreç sarmalayıcısı. Android'deki ChiakiNative (JNI) karşılığı.
 * stdout ikili paketler: [tip:1][uzunluk:4 LE][veri]; 'J' = JSON olay, 'V' = video örneği.
 *
 * Olaylar: 'event' (json), 'video' (Buffer, framesLost), 'exit' (code)
 */
export class RpHelper extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buf: Buffer = Buffer.alloc(0);

  get available() {
    return binPath('altyazi-rp.exe') !== null;
  }

  private ensure(): ChildProcessWithoutNullStreams {
    if (this.proc) {
      return this.proc;
    }
    const exe = binPath('altyazi-rp.exe');
    if (!exe) {
      throw new Error('Remote Play yardımcısı derlenmemiş (npm run build:native)');
    }
    const proc = spawn(exe, [], { windowsHide: true });
    this.proc = proc;
    this.buf = Buffer.alloc(0);
    proc.stdout.on('data', (d: Buffer) => this.onData(d));
    proc.stderr.on('data', d => console.warn('[rp]', String(d).trim()));
    proc.stdin.on('error', () => {});
    proc.on('exit', code => {
      if (this.proc === proc) {
        this.proc = null;
      }
      this.emit('exit', code);
    });
    return proc;
  }

  send(...fields: (string | number | boolean)[]) {
    const line = fields
      .map(f => (typeof f === 'boolean' ? (f ? '1' : '0') : String(f)))
      .join(' ');
    this.ensure().stdin.write(line + '\n');
  }

  /** Bir olay tipini bekler (ör. 'regist'); zaman aşımında null. */
  waitFor(ev: string, timeoutMs: number): Promise<any | null> {
    return new Promise(resolve => {
      const onEvent = (msg: any) => {
        if (msg.ev === ev) {
          done(msg);
        }
      };
      const timer = setTimeout(() => done(null), timeoutMs);
      const done = (v: any) => {
        clearTimeout(timer);
        this.off('event', onEvent);
        resolve(v);
      };
      this.on('event', onEvent);
    });
  }

  dispose() {
    if (this.proc) {
      try {
        this.proc.stdin.write('quit\n');
      } catch {}
      const p = this.proc;
      (setTimeout(() => p.kill(), 3000) as unknown as NodeJS.Timeout).unref();
      this.proc = null;
    }
  }

  private onData(d: Buffer) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.buf.length >= 5) {
      const len = this.buf.readUInt32LE(1);
      if (this.buf.length < 5 + len) {
        break;
      }
      const type = this.buf[0];
      const payload = this.buf.subarray(5, 5 + len);
      this.buf = this.buf.subarray(5 + len);
      if (type === 0x4a /* J */) {
        let msg: any;
        try {
          msg = JSON.parse(payload.toString('utf8'));
        } catch {
          continue;
        }
        if (msg.ev === 'log') {
          console.log(`[chiaki ${msg.level}] ${msg.msg}`);
        }
        this.emit('event', msg);
      } else if (type === 0x56 /* V */) {
        // Alt tampon bir sonraki okumada üzerine yazılmasın diye kopyalanır.
        this.emit('video', Buffer.from(payload.subarray(4)), payload.readInt32LE(0));
      }
    }
  }
}
