import { contextBridge, ipcRenderer } from 'electron';
import type { SubtitleStyle } from '../shared/types';

contextBridge.exposeInMainWorld('overlay', {
  onText: (cb: (text: string) => void) => ipcRenderer.on('overlay:text', (_e, t: string) => cb(t)),
  onStyle: (cb: (s: SubtitleStyle) => void) => ipcRenderer.on('overlay:style', (_e, s: SubtitleStyle) => cb(s)),
});
