import { app } from 'electron';
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { format } from 'node:util';

const MAX_BYTES = 2 * 1024 * 1024;

/**
 * console.log/warn/error çıktısını userData/logs/main.log dosyasına da yazar. Paketlenmiş
 * uygulamada terminal olmadığı için sorun giderirken tek kaynak budur. 2 MB'ı geçince
 * main.old.log'a döner.
 */
export function installFileLog(): string {
  const dir = join(app.getPath('userData'), 'logs');
  const file = join(dir, 'main.log');
  try {
    mkdirSync(dir, { recursive: true });
  } catch {}
  let written = 0;
  try {
    written = statSync(file).size;
  } catch {}

  const write = (level: string, args: unknown[]) => {
    const line = `${new Date().toISOString()} ${level} ${format(...args)}\n`;
    try {
      if (written + line.length > MAX_BYTES) {
        renameSync(file, join(dir, 'main.old.log'));
        written = 0;
      }
      appendFileSync(file, line);
      written += line.length;
    } catch {}
  };
  for (const level of ['log', 'warn', 'error'] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      orig(...args);
      write(level.toUpperCase(), args);
    };
  }
  console.log(`--- Altyazı Çevirmeni ${app.getVersion()} başladı`);
  return file;
}
