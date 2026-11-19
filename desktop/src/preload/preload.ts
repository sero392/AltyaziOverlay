import { contextBridge, ipcRenderer } from 'electron';
import type { AppState, DesktopApi } from '../shared/types';

const invoke = (ch: string) => (...args: unknown[]) => ipcRenderer.invoke(ch, ...args);

const api: DesktopApi = {
  getState: invoke('getState') as DesktopApi['getState'],
  onState(cb) {
    const listener = (_e: unknown, s: AppState) => cb(s);
    ipcRenderer.on('state', listener);
    return () => ipcRenderer.off('state', listener);
  },
  discover: invoke('discover') as DesktopApi['discover'],
  register: invoke('register') as DesktopApi['register'],
  probeConsole: invoke('probeConsole') as DesktopApi['probeConsole'],
  wakeConsole: invoke('wakeConsole') as DesktopApi['wakeConsole'],
  forgetConsole: invoke('forgetConsole') as DesktopApi['forgetConsole'],
  startSession: invoke('startSession') as DesktopApi['startSession'],
  stopSession: invoke('stopSession') as DesktopApi['stopSession'],
  setSettings: invoke('setSettings') as DesktopApi['setSettings'],
  setDeepLKey: invoke('setDeepLKey') as DesktopApi['setDeepLKey'],
  deeplUsage: invoke('deeplUsage') as DesktopApi['deeplUsage'],
  simulate: invoke('simulate') as DesktopApi['simulate'],
  clearHistory: invoke('clearHistory') as DesktopApi['clearHistory'],
  setSetupDone: invoke('setSetupDone') as DesktopApi['setSetupDone'],
  openExternal: invoke('openExternal') as DesktopApi['openExternal'],
  openLog: invoke('openLog') as DesktopApi['openLog'],
  llmInstall: invoke('llmInstall') as DesktopApi['llmInstall'],
  llmCancelInstall: invoke('llmCancelInstall') as DesktopApi['llmCancelInstall'],
  captureSnapshot: invoke('captureSnapshot') as DesktopApi['captureSnapshot'],
};

contextBridge.exposeInMainWorld('api', api);
