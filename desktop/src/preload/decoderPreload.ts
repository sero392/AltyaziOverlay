import { contextBridge, ipcRenderer } from 'electron';

export interface DecoderBridge {
  onVideo(cb: (sample: Uint8Array, framesLost: number) => void): void;
  onReset(cb: (cfg: { intervalMs: number } | null) => void): void;
  /** Çözücüyü sıfırlamadan okuma ayarlarını değiştirir. */
  onConfig(cb: (cfg: { intervalMs: number }) => void): void;
  sendFrame(w: number, h: number, gray: Uint8Array): void;
  /** Okuma alanı kurulumu bir sonraki kareyi istiyor. */
  onSnapshot(cb: () => void): void;
  sendSnapshot(w: number, h: number, jpeg: Uint8Array): void;
  requestIdr(): void;
  log(msg: string): void;
}

const bridge: DecoderBridge = {
  onVideo: cb => ipcRenderer.on('rp:video', (_e, sample: Uint8Array, lost: number) => cb(sample, lost)),
  onReset: cb => ipcRenderer.on('rp:reset', (_e, cfg) => cb(cfg)),
  onConfig: cb => ipcRenderer.on('rp:config', (_e, cfg) => cb(cfg)),
  sendFrame: (w, h, gray) => ipcRenderer.send('decoder:frame', { w, h, gray }),
  onSnapshot: cb => ipcRenderer.on('rp:snapshot', () => cb()),
  sendSnapshot: (w, h, jpeg) => ipcRenderer.send('decoder:snapshot', { w, h, jpeg }),
  requestIdr: () => ipcRenderer.send('decoder:idr'),
  log: msg => ipcRenderer.send('decoder:log', msg),
};

contextBridge.exposeInMainWorld('decoder', bridge);
