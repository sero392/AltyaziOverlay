import { BrowserWindow, Menu, Tray, app, ipcMain, nativeImage, screen, shell } from 'electron';
import { join } from 'node:path';
import { CachedTranslationService } from '../../../src/services/translation/CachedTranslationService';
import { DeepLTranslationService } from '../../../src/services/translation/DeepLTranslationService';
import { TranslationService } from '../../../src/services/translation/TranslationService';
import {
  AppState,
  FrameSnapshot,
  OcrSettings,
  SettingsPatch,
  SubtitleBox,
  SubtitleStyle,
  TranslationEngine,
} from '../shared/types';
import { CaptureService } from './captureService';
import { appIcon } from './icon';
import { installFileLog } from './logFile';
import { OcrHelper } from './native/ocrHelper';
import { LocalLlmTranslationService } from './llm/LocalLlmTranslationService';
import { LocalLlm } from './llm/localLlm';
import { RemotePlay } from './remotePlay';
import { Store } from './store';
import { GoogleWebTranslationService } from './translation/GoogleWebTranslationService';
import { HedgedTranslationService } from './translation/HedgedTranslationService';
import { ConnectionWarmer, httpRequest } from './translation/http';
import { SubtitleTranslator } from './translation/subtitleTranslator';
import { sanitizeRegions } from '../shared/regions';
import { TvLink } from './tvLink';

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const DEV = process.argv.includes('--dev');
const dist = __dirname;

let store: Store;
let mainWin: BrowserWindow | null = null;
let decoderWin: BrowserWindow | null = null;
let overlayWin: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

const rp = new RemotePlay();
const ocr = new OcrHelper(() => pushState());
let tv: TvLink;
let capture: CaptureService;
let translator: SubtitleTranslator;
let llm: LocalLlm;
/** Okuma sürerken DeepL bağlantılarını sıcak tutar (DeepL kullanılıyorsa). */
let deeplWarmer: ConnectionWarmer | null = null;
let deeplOffReason: string | null = null;
let logFile = '';
let overlayText = '';
let overlayBox: SubtitleBox | null = null;

// ====================================================================== okuma alanı karesi

/** Okuma sürüyorsa kare bu sürede gelmeli. */
const SNAPSHOT_LIVE_TIMEOUT_MS = 5000;
/** Okuma kapalıysa PS5'i bulma, uyandırma ve bağlanma dahil üst sınır. */
const SNAPSHOT_CONNECT_TIMEOUT_MS = 90000;

let pendingSnapshot: { resolve: (s: FrameSnapshot) => void; reject: (e: Error) => void } | null = null;

/**
 * Okuma alanı kurulumu için yayından tek bir renkli kare. Okuma kapalıysa geçici olarak bağlanılır
 * ve kare gelince bağlantı kapatılır (mobildeki captureSnapshot gibi).
 */
async function captureSnapshot(): Promise<FrameSnapshot> {
  if (pendingSnapshot) {
    throw new Error('Kare zaten bekleniyor');
  }
  if (!decoderWin) {
    throw new Error('Çözücü penceresi hazır değil');
  }
  const startedHere = !capture.running;
  if (startedHere) {
    capture.start();
    if (!capture.running) {
      throw new Error(capture.state.error ?? 'PS5 yayını başlatılamadı');
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<FrameSnapshot>((resolve, reject) => {
      pendingSnapshot = { resolve, reject };
      timer = setTimeout(
        () =>
          reject(
            new Error(
              startedHere
                ? 'PS5 yayınından kare gelmedi (açık ve aynı ağda mı?)'
                : 'Yayından kare gelmedi (PS5 bağlantısı kopmuş olabilir)',
            ),
          ),
        startedHere ? SNAPSHOT_CONNECT_TIMEOUT_MS : SNAPSHOT_LIVE_TIMEOUT_MS,
      );
      decoderWin?.webContents.send('rp:snapshot');
    });
  } finally {
    clearTimeout(timer);
    pendingSnapshot = null;
    if (startedHere) {
      capture.stop();
    }
  }
}

// ====================================================================== durum

function maskKey(key: string | null) {
  if (!key) {
    return null;
  }
  const k = key.trim();
  return k.length <= 8 ? '••••' : `${k.slice(0, 4)}••••${k.slice(-4)}`;
}

function snapshot(): AppState {
  const d = store.data;
  const c = store.console;
  return {
    setupDone: d.setupDone,
    console: c ? { host: c.host, nickname: c.nickname, ps5: c.ps5 } : null,
    settings: {
      deeplKeyMasked: maskKey(store.deeplKey),
      engine: d.engine,
      protectedTerms: d.protectedTerms,
      style: d.style,
      tv: d.tv,
      ocr: d.ocr,
    },
    session: capture.state,
    tv: tv.status,
    history: translator.history,
    engineNote: describeEngine(d.engine, !!store.deeplKey, deeplOffReason),
    ocr: ocr.info,
    helpers: { rp: rp.available, ocr: ocr.available },
    llm: llm.state,
    diag: capture.diagnostics(),
    logFile,
  };
}

let pushQueued = false;
function pushState() {
  if (pushQueued || !store) {
    return;
  }
  pushQueued = true;
  setImmediate(() => {
    pushQueued = false;
    mainWin?.webContents.send('state', snapshot());
    updateTray();
  });
}

function describeEngine(engine: TranslationEngine, hasDeepL: boolean, offReason: string | null) {
  if (engine === 'local') {
    const backup = hasDeepL ? 'DeepL / Google' : 'Google Çeviri';
    switch (llm.state.status) {
      case 'ready':
        return { text: `Çeviri: yerel yapay zeka (TranslateGemma). 1,5 sn'de yanıt yoksa ${backup}.`, warn: false };
      case 'starting':
        return { text: `Yerel model açılıyor; hazır olana kadar çeviri ${backup} ile yapılır.`, warn: false };
      case 'downloading':
        return { text: `Yerel model indiriliyor; bitene kadar çeviri ${backup} ile yapılır.`, warn: false };
      case 'error':
        return { text: `${llm.state.error ?? 'Yerel model çalışmıyor'}. Çeviri ${backup} ile yapılıyor.`, warn: true };
      default:
        return { text: `Yerel model indirilmemiş; çeviri ${backup} ile yapılır.`, warn: true };
    }
  }
  if (engine === 'google') {
    return { text: 'Çeviri: Google Çeviri.', warn: false };
  }
  if (!hasDeepL) {
    return { text: 'DeepL anahtarı yok: çeviri Google Çeviri ile yapılır.', warn: true };
  }
  if (engine === 'deepl') {
    return { text: 'Çeviri: DeepL.', warn: false };
  }
  if (offReason) {
    return { text: `${offReason}. Bu oturumda Google Çeviri kullanılıyor.`, warn: true };
  }
  return { text: 'Çeviri: DeepL (1,5 sn içinde yanıt yoksa ya da sorun olursa Google Çeviri).', warn: false };
}

// ====================================================================== çeviri

/** Bu sürede DeepL yanıt vermezse ikinci DeepL isteği (ölçüm: sıcak bağlantıda p90 250 ms). */
const DEEPL_RETRY_MS = 700;
/** Bu sürede DeepL'den (iki istekten de) yanıt yoksa Google Çeviri'ye de sorulur. */
const GOOGLE_HEDGE_MS = 1500;

function buildTranslator(): TranslationService {
  const d = store.data;
  const key = store.deeplKey;
  const google = new GoogleWebTranslationService(d.protectedTerms);
  let inner: TranslationService = google;
  deeplWarmer?.stop();
  deeplWarmer = null;
  if (key && d.engine !== 'google') {
    const deepl = new DeepLTranslationService(key, httpRequest, d.protectedTerms);
    // DeepL'in yavaş kalan yanıtı genellikle o isteğe özgü: DEEPL_RETRY_MS'de yanıt yoksa ikinci
    // DeepL isteği (sıcak ikinci soketten) gönderilir, hangisi önce gelirse o kullanılır.
    const fastDeepl = new HedgedTranslationService(deepl, deepl, () => {}, DEEPL_RETRY_MS);
    deeplWarmer = new ConnectionWarmer(() => deepl.usage());
    if (d.engine === 'deepl') {
      inner = fastDeepl;
    } else {
      inner = new HedgedTranslationService(
        fastDeepl,
        google,
        reason => {
          deeplOffReason = reason;
          pushState();
        },
        GOOGLE_HEDGE_MS,
      );
    }
  }
  if (d.engine === 'local') {
    // Yerel model hazır değilse ya da hata verirse anında, 1,5 sn'de yanıt vermezse de yedeğe sorulur.
    const local = new LocalLlmTranslationService(llm, d.protectedTerms);
    inner = new HedgedTranslationService(local, inner, () => {}, 1500);
  }
  return new CachedTranslationService(inner);
}

/** Yerel motor seçiliyse ve model kuruluysa sunucuyu açar; değilse ekran kartı belleğini boşaltır. */
function applyLlm() {
  if (store.data.engine === 'local' && llm.installed) {
    llm.ensureStarted().catch(e => console.warn('[llm]', (e as Error).message));
  } else {
    llm.stop();
  }
}

function rebuildTranslator() {
  deeplOffReason = null;
  const service = buildTranslator();
  translator.setService(service);
  applyLlm();
  pushState();
}

// ====================================================================== ekran hedefleri

function showSubtitle(text: string, box?: SubtitleBox | null) {
  overlayText = text;
  overlayBox = box ?? null;
  const d = store.data;
  if (d.tv.enabled) {
    tv.sendSubtitle(text, box ?? null);
  }
  const onDesktop = !d.tv.enabled || d.tv.alsoOnDesktop;
  if (!overlayWin) {
    return;
  }
  overlayWin.webContents.send('overlay:text', onDesktop ? text : '');
  if (onDesktop && text) {
    if (!overlayWin.isVisible()) {
      positionOverlay();
      overlayWin.showInactive();
    }
  } else if (!text && overlayWin.isVisible()) {
    overlayWin.hide();
  }
}

function applyStyle(style: SubtitleStyle) {
  overlayWin?.webContents.send('overlay:style', style);
  tv.sendStyle(style);
}

function applyTv() {
  const t = store.data.tv;
  if (t.enabled) {
    tv.start(t.host, store.data.style);
  } else {
    tv.stop();
  }
}

// ====================================================================== pencereler

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 460,
    height: 860,
    minWidth: 380,
    minHeight: 600,
    backgroundColor: '#0b0f17',
    title: 'Altyazı Çevirmeni',
    icon: appIcon(256),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(dist, 'preload.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });
  mainWin.removeMenu();
  mainWin.loadFile(join(dist, 'renderer', 'index.html'));
  mainWin.once('ready-to-show', () => mainWin?.show());
  if (DEV) {
    mainWin.webContents.openDevTools({ mode: 'detach' });
  }
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  // Okuma sürerken pencereyi kapatmak uygulamayı tepsiye indirir; okuma devam eder.
  mainWin.on('close', e => {
    if (!quitting && capture.running) {
      e.preventDefault();
      mainWin?.hide();
    }
  });
  mainWin.on('closed', () => {
    mainWin = null;
    if (!capture.running) {
      quit();
    }
  });
}

/** Görünmez çözücü penceresi: WebCodecs ile H.264 çözer, alt bölgeyi kırpar, griye çevirir. */
function createDecoderWindow() {
  decoderWin = new BrowserWindow({
    show: false,
    width: 320,
    height: 180,
    webPreferences: {
      preload: join(dist, 'decoderPreload.js'),
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  decoderWin.loadFile(join(dist, 'decoder', 'index.html'));
  decoderWin.on('closed', () => {
    decoderWin = null;
  });
}

/** Ekranın altında, tıklamaları geçiren, her zaman üstte duran altyazı penceresi. */
function createOverlayWindow() {
  overlayWin = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: join(dist, 'overlayPreload.js'),
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setIgnoreMouseEvents(true);
  overlayWin.loadFile(join(dist, 'overlay', 'index.html'));
  overlayWin.webContents.on('did-finish-load', () => {
    overlayWin?.webContents.send('overlay:style', store.data.style);
    overlayWin?.webContents.send('overlay:text', overlayText);
  });
  positionOverlay();
}

function positionOverlay() {
  const area = screen.getPrimaryDisplay().workArea;
  const height = Math.round(area.height * 0.3);
  overlayWin?.setBounds({ x: area.x, y: area.y + area.height - height, width: area.width, height });
}

function showMain() {
  if (!mainWin) {
    createMainWindow();
  } else {
    mainWin.show();
    mainWin.focus();
  }
}

let trayMenuKey = '';

function updateTray() {
  if (!tray) {
    return;
  }
  const running = capture.running;
  tray.setToolTip(running ? `Altyazı Çevirmeni · ${capture.state.status}` : 'Altyazı Çevirmeni');
  // Menü yalnızca içeriği değişince kurulur: okuma sürerken durum her saniye yayınlanıyor ve
  // açık menünün altından yenisi konunca tıklama (ör. "Çıkış") kayboluyordu.
  const menuKey = `${running}|${!!store.console}`;
  if (menuKey === trayMenuKey) {
    return;
  }
  trayMenuKey = menuKey;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Aç', click: showMain },
      {
        label: running ? 'Okumayı durdur' : 'Okumayı başlat',
        click: () => (running ? capture.stop() : capture.start()),
        enabled: running || !!store.console,
      },
      { type: 'separator' },
      { label: 'Çıkış', click: quit },
    ]),
  );
}

function quit() {
  quitting = true;
  capture?.stop();
  rp.dispose();
  ocr.stop();
  tv?.stop();
  llm?.stop();
  app.quit();
}

// ====================================================================== IPC

function registerIpc() {
  ipcMain.handle('getState', () => snapshot());

  ipcMain.handle('discover', (_e, timeoutMs: number) => rp.discover(Math.min(timeoutMs, 10000)));

  ipcMain.handle('register', async (_e, host: string, accountId: string, pin: string) => {
    const c = await rp.register(host, accountId, pin);
    store.console = c;
    pushState();
    return c.nickname;
  });

  ipcMain.handle('probeConsole', async () => {
    const c = store.console;
    if (!c) {
      return null;
    }
    const found = await capture.findConsole(c, 3000);
    if (found && found.host !== c.host) {
      store.console = { ...c, host: found.host };
      pushState();
    }
    return found?.state ?? null;
  });

  ipcMain.handle('wakeConsole', async () => {
    const c = store.console;
    if (!c || !(await rp.wakeup(c))) {
      throw new Error('Uyandırma sinyali gönderilemedi');
    }
  });

  ipcMain.handle('forgetConsole', () => {
    capture.stop();
    store.console = null;
    pushState();
  });

  ipcMain.handle('startSession', () => capture.start());
  ipcMain.handle('stopSession', () => capture.stop());

  ipcMain.handle('setSettings', (_e, patch: SettingsPatch) => {
    if (patch.ocr) {
      patch = { ...patch, ocr: { ...patch.ocr, regions: sanitizeRegions(patch.ocr.regions) } };
    }
    store.update(patch);
    if (patch.engine || patch.protectedTerms) {
      rebuildTranslator();
    }
    if (patch.ocr) {
      capture.updateOcr(store.data.ocr);
    }
    if (patch.style) {
      applyStyle(store.data.style);
    }
    if (patch.tv) {
      applyTv();
  applyLlm();
      showSubtitle(overlayText, overlayBox);
    }
    pushState();
  });

  ipcMain.handle('setDeepLKey', (_e, key: string | null) => {
    store.deeplKey = key?.trim() || null;
    rebuildTranslator();
  });

  ipcMain.handle('deeplUsage', (_e, key?: string) => {
    const k = key?.trim() || store.deeplKey;
    if (!k) {
      throw new Error('DeepL anahtarı yok');
    }
    return new DeepLTranslationService(k, httpRequest).usage();
  });

  ipcMain.handle('simulate', (_e, text: string) =>
    translator.handle({ text, frameId: -1, ocrLatencyMs: 0, timestamp: Date.now() }),
  );
  ipcMain.handle('clearHistory', () => translator.clear());
  ipcMain.handle('llmInstall', async () => {
    await llm.install();
    applyLlm();
  });
  ipcMain.handle('llmCancelInstall', () => llm.cancelInstall());
  ipcMain.handle('captureSnapshot', () => captureSnapshot());
  ipcMain.handle('setSetupDone', (_e, done: boolean) => {
    store.update({ setupDone: done });
    pushState();
  });
  ipcMain.handle('openLog', () => logFile && shell.openPath(logFile));
  ipcMain.handle('openExternal', (_e, url: string) => {
    if (/^https:\/\//.test(url)) {
      return shell.openExternal(url);
    }
  });

  // Çözücü penceresi
  ipcMain.on('decoder:frame', (_e, frame: { w: number; h: number; gray: Uint8Array }) => {
    capture.onFrame(frame.gray, frame.w, frame.h);
  });
  ipcMain.on('decoder:idr', () => rp.requestIdr());
  ipcMain.on('decoder:snapshot', (_e, snap: { w: number; h: number; jpeg: Uint8Array }) => {
    pendingSnapshot?.resolve({
      dataUrl: `data:image/jpeg;base64,${Buffer.from(snap.jpeg).toString('base64')}`,
      width: snap.w,
      height: snap.h,
    });
  });
  ipcMain.on('decoder:log', (_e, msg: string) => {
    console.log(`[decoder] ${msg}`);
    if (msg.startsWith('decode error')) {
      capture.decoderErrors++;
    }
  });
}

// ====================================================================== başlangıç

app.whenReady().then(() => {
  app.setAppUserModelId('com.altyazioverlay.desktop');
  logFile = installFileLog();
  store = new Store();
  tv = new TvLink(() => pushState());
  llm = new LocalLlm(join(app.getPath('userData'), 'llm'), () => pushState());
  const service = buildTranslator();
  translator = new SubtitleTranslator(service, showSubtitle, () => pushState());
  capture = new CaptureService(rp, ocr, {
    loadConsole: () => store.console,
    saveConsole: c => {
      store.console = c;
      pushState();
    },
    ocrSettings: (): OcrSettings => store.data.ocr,
    onVideo: (sample, lost) => decoderWin?.webContents.send('rp:video', sample, lost),
    resetDecoder: cfg => decoderWin?.webContents.send('rp:reset', cfg),
    updateDecoder: cfg => decoderWin?.webContents.send('rp:config', cfg),
    onSubtitle: ev => void translator.handle(ev),
    onCandidate: text => translator.prefetch(text),
    onState: s => {
      // Kare beklenirken yayın kalıcı bir hatayla durdu.
      if (pendingSnapshot && !s.running) {
        pendingSnapshot.reject(new Error(s.error ?? 'PS5 yayını durdu'));
      }
      pushState();
    },
  });

  registerIpc();
  createMainWindow();
  createDecoderWindow();
  createOverlayWindow();
  applyTv();
  // OCR motorunu önceden başlat: dil bilgisi arayüzde görünsün, ilk kare beklemesin.
  if (ocr.available) {
    ocr.start();
  }

  tray = new Tray(appIcon(32));
  tray.on('click', showMain);
  updateTray();
  // Okuma sürerken tanılama sayaçlarını arayüzde canlı tut; 30 sn'de bir log'a özet yaz.
  let tick = 0;
  setInterval(() => {
    // Okuma sürerken DeepL bağlantılarını açık tut (sunucu boştakini 15-30 sn'de kapatıyor).
    if (deeplWarmer && capture.running !== deeplWarmer.running) {
      capture.running ? deeplWarmer.start() : deeplWarmer.stop();
    }
    const d = capture.diagnostics();
    if (!d) {
      return;
    }
    pushState();
    if (++tick % 30 === 0) {
      console.log('[diag]', JSON.stringify(d));
    }
  }, 1000);
  screen.on('display-metrics-changed', positionOverlay);
});

app.on('second-instance', showMain);
app.on('before-quit', () => {
  quitting = true;
  llm?.stop(); // llama-server alt süreci uygulamayla birlikte kapansın
});
app.on('window-all-closed', () => {
  // Tepside çalışmaya devam et; çıkış quit() ile.
});
