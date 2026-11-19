import { app } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Paketlenmiş uygulamada resources/bin, geliştirmede desktop/resources/bin. */
export function binPath(name: string): string | null {
  const candidates = [
    join(process.resourcesPath ?? '', 'bin', name),
    join(app.getAppPath(), 'resources', 'bin', name),
  ];
  return candidates.find(p => existsSync(p)) ?? null;
}
