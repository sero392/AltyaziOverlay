import { app, safeStorage } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  ADDED_PROTECTED_TERMS_V3,
  DEFAULT_PROTECTED_TERMS,
} from '../../../src/services/translation/protectedTerms';
import {
  DEFAULT_OCR,
  DEFAULT_STYLE,
  OcrSettings,
  SubtitleStyle,
  TranslationEngine,
  TvSettings,
} from '../shared/types';
import { regionFromCropRatio, sanitizeRegions } from '../shared/regions';
import { RegisteredConsole } from './remotePlay';

interface StoredData {
  setupDone: boolean;
  engine: TranslationEngine;
  protectedTerms: string[];
  style: SubtitleStyle;
  tv: TvSettings;
  ocr: OcrSettings;
  /** Ayar şeması sürümü (eski varsayılanları taşımak için). */
  version?: number;
  /** safeStorage ile şifreli (base64). */
  deeplKey?: string;
  console?: string;
}

const DEFAULTS: StoredData = {
  setupDone: false,
  engine: 'auto',
  protectedTerms: DEFAULT_PROTECTED_TERMS,
  style: DEFAULT_STYLE,
  tv: { enabled: false, host: '', alsoOnDesktop: true },
  ocr: DEFAULT_OCR,
};

/**
 * Kalıcı ayarlar (userData/settings.json). DeepL anahtarı ve PS5 eşleşme anahtarları
 * Windows DPAPI (safeStorage) ile şifrelenir; mobildeki uygulamaya özel SharedPreferences gibi
 * yalnızca bu kullanıcı hesabında okunabilir.
 */
export class Store {
  private readonly file = join(app.getPath('userData'), 'settings.json');
  data: StoredData;

  constructor() {
    let loaded: Partial<StoredData> = {};
    try {
      loaded = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {}
    this.data = {
      ...DEFAULTS,
      ...loaded,
      style: { ...DEFAULTS.style, ...loaded.style },
      tv: { ...DEFAULTS.tv, ...loaded.tv },
      ocr: { ...DEFAULTS.ocr, ...loaded.ocr },
    };
    const loadedVersion = this.data.version ?? 1;
    // Sürüm 3: canlı testte çevrilen yer / karakter adları kayıtlı listeye bir kez eklenir.
    if (loadedVersion < 3) {
      const missing = ADDED_PROTECTED_TERMS_V3.filter(t => !this.data.protectedTerms.includes(t));
      this.data.protectedTerms = [...this.data.protectedTerms, ...missing];
    }
    // Sürüm 4: okuma alanı "alttan oran" (cropRatio) yerine seçilebilen alanlar. Sürüm 2 öncesi
    // eski varsayılan (0.2) yeni varsayılana (alt %30) taşınır; kullanıcının seçtiği oran korunur.
    if (loadedVersion < 4) {
      const legacyCrop = (loaded.ocr as { cropRatio?: number } | undefined)?.cropRatio;
      if (!loaded.ocr?.regions && typeof legacyCrop === 'number' && !(loadedVersion < 2 && legacyCrop === 0.2)) {
        this.data.ocr = { ...this.data.ocr, regions: [regionFromCropRatio(legacyCrop)] };
      }
    }
    const { intervalMs, regions } = this.data.ocr;
    this.data.ocr = { intervalMs, regions: sanitizeRegions(regions) };
    if (loadedVersion < 4) {
      this.data.version = 4;
      try {
        this.save();
      } catch {}
    }
  }

  update(patch: Partial<StoredData>) {
    this.data = { ...this.data, ...patch };
    this.save();
  }

  get deeplKey(): string | null {
    return this.decrypt(this.data.deeplKey);
  }

  set deeplKey(key: string | null) {
    this.update({ deeplKey: key ? this.encrypt(key) : undefined });
  }

  get console(): RegisteredConsole | null {
    const json = this.decrypt(this.data.console);
    try {
      return json ? (JSON.parse(json) as RegisteredConsole) : null;
    } catch {
      return null;
    }
  }

  set console(c: RegisteredConsole | null) {
    this.update({ console: c ? this.encrypt(JSON.stringify(c)) : undefined });
  }

  private encrypt(s: string): string {
    if (safeStorage.isEncryptionAvailable()) {
      return 'enc:' + safeStorage.encryptString(s).toString('base64');
    }
    return 'raw:' + Buffer.from(s, 'utf8').toString('base64');
  }

  private decrypt(s: string | undefined): string | null {
    if (!s) {
      return null;
    }
    try {
      if (s.startsWith('enc:')) {
        return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64'));
      }
      if (s.startsWith('raw:')) {
        return Buffer.from(s.slice(4), 'base64').toString('utf8');
      }
    } catch {}
    return null;
  }

  private save() {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }
}
