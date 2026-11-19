import type { DesktopApi } from '../shared/types';

declare global {
  interface Window {
    api: DesktopApi;
  }
}

export const api = window.api;

/** IPC hataları "Error invoking remote method 'x': Error: ..." biçiminde gelir; öneki at. */
export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
