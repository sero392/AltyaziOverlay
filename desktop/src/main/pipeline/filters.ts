// Android'deki ocr/ paketinin (FrameDiffDetector, TextChangeFilter, SubtitleHeuristics,
// UiTextFilter) TypeScript karşılığı. Mantık ve eşikler birebir aynıdır; değiştirirken
// iki tarafı birlikte güncelle.

// ======================================================================== FrameDiffDetector

/**
 * OCR'dan ÖNCE çalışan ucuz piksel düzeyi değişim dedektörü. Kırpılan bölge
 * gridW x gridH hücreye bölünür, hücre ortalama parlaklığı önceki kareyle karşılaştırılır.
 * Altyazı değişmediyse OCR hiç çağrılmaz.
 */
export class FrameDiffDetector {
  private previous: Int32Array | null = null;
  private current: Int32Array;
  private lastW = -1;
  private lastH = -1;

  constructor(
    private readonly gridW = 64,
    private readonly gridH = 16,
    private readonly cellThreshold = 18,
    private readonly minChangedCells = 3,
  ) {
    this.current = new Int32Array(gridW * gridH);
  }

  /** @param gray w*h gri piksel */
  hasChanged(gray: Uint8Array, w: number, h: number): boolean {
    if (w < this.gridW || h < this.gridH) {
      return true;
    }
    if (w !== this.lastW || h !== this.lastH) {
      this.previous = null;
      this.lastW = w;
      this.lastH = h;
    }
    this.sample(gray, w, h);

    const prev = this.previous;
    let changed: boolean;
    if (!prev) {
      changed = true;
    } else {
      let count = 0;
      for (let i = 0; i < this.current.length; i++) {
        if (
          Math.abs(this.current[i] - prev[i]) > this.cellThreshold &&
          ++count >= this.minChangedCells
        ) {
          break;
        }
      }
      changed = count >= this.minChangedCells;
    }
    const tmp = this.previous ?? new Int32Array(this.gridW * this.gridH);
    this.previous = this.current;
    this.current = tmp;
    return changed;
  }

  /** Bir sonraki kareyi koşulsuz "değişti" saydırır (ör. OCR hatası sonrası). */
  invalidate() {
    this.previous = null;
  }

  private sample(gray: Uint8Array, w: number, h: number) {
    const cellW = Math.floor(w / this.gridW);
    const cellH = Math.floor(h / this.gridH);
    const xStep = Math.max(1, Math.floor(cellW / 6));
    for (let gy = 0; gy < this.gridH; gy++) {
      // Her hücre satırından 2 tarama çizgisi (1/3 ve 2/3 yükseklikte).
      for (let s = 1; s <= 2; s++) {
        const y = gy * cellH + Math.floor((cellH * s) / 3);
        const row = y * w;
        for (let gx = 0; gx < this.gridW; gx++) {
          let sum = 0;
          let n = 0;
          const end = (gx + 1) * cellW;
          for (let x = gx * cellW; x < end; x += xStep) {
            sum += gray[row + x];
            n++;
          }
          const idx = gy * this.gridW + gx;
          const avg = n === 0 ? 0 : Math.floor(sum / n);
          this.current[idx] = s === 1 ? avg : (this.current[idx] + avg) >> 1;
        }
      }
    }
  }
}

// ======================================================================== TextChangeFilter

const NON_WORD = /[^\p{L}\p{N} ]+/gu;
const SPACES = /\s+/g;
const MAX_LEN = 300;
const CONTAINMENT_THRESHOLD = 0.8;
const MIN_CONTAINMENT_TOKENS = 3;
const FUZZY_TOKEN_MIN_LEN = 5;
const FUZZY_TOKEN_THRESHOLD = 0.6;

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(NON_WORD, ' ')
    .replace(SPACES, ' ')
    .trim()
    .slice(0, MAX_LEN);
}

/** 1 - (levenshtein / maxLen). */
export function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) {
    return 1;
  }
  let prev = new Int32Array(b.length + 1).map((_, i) => i);
  let cur = new Int32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    const t = prev;
    prev = cur;
    cur = t;
  }
  return 1 - prev[b.length] / maxLen;
}

function tokenMatches(token: string, candidates: Set<string>): boolean {
  if (candidates.has(token)) {
    return true;
  }
  if (token.length < FUZZY_TOKEN_MIN_LEN) {
    return false;
  }
  for (const c of candidates) {
    if (c.length >= FUZZY_TOKEN_MIN_LEN && similarity(token, c) >= FUZZY_TOKEN_THRESHOLD) {
      return true;
    }
  }
  return false;
}

/** Kısa metnin kelimelerinin ne kadarı uzun metinde de var (0-1); "aynı altyazı + ek" durumu. */
export function tokenContainment(a: string, b: string): number {
  const ta = new Set(a.split(' ').filter(Boolean));
  const tb = new Set(b.split(' ').filter(Boolean));
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  if (small.size < MIN_CONTAINMENT_TOKENS) {
    return 0;
  }
  let hits = 0;
  for (const t of small) {
    if (tokenMatches(t, large)) {
      hits++;
    }
  }
  return hits / small.size;
}

/**
 * Metin düzeyinde değişim kontrolü: normalizasyon, bulanık eşleşme ve kararlılık
 * (aday metin stableFrames kez görülmeden yayınlanmaz). "" = altyazı ekrandan kalktı.
 */
export class TextChangeFilter {
  private lastEmittedNorm = '';
  private candidateRaw: string | null = null;
  private candidateNorm = '';
  private candidateHits = 0;

  constructor(
    private readonly stableFrames = 2,
    private readonly similarityThreshold = 0.8,
  ) {}

  onRecognized(raw: string): string | null {
    const norm = normalize(raw);
    if (this.candidateRaw !== null && this.isSimilar(norm, this.candidateNorm)) {
      this.candidateHits++;
      // Daha uzun okuma genellikle daha eksiksizdir (daktilo efekti vb.).
      if (raw.length >= this.candidateRaw.length) {
        this.candidateRaw = raw;
        this.candidateNorm = norm;
      }
    } else {
      this.candidateRaw = raw;
      this.candidateNorm = norm;
      this.candidateHits = 1;
    }
    return this.tryEmit();
  }

  onFrameUnchanged(): string | null {
    if (this.candidateRaw === null) {
      return null;
    }
    this.candidateHits++;
    return this.tryEmit();
  }

  /**
   * Henüz onaylanmamış (ilk kez görülen) yeni altyazı adayı; yoksa null. Çeviriye erken başlamak için:
   * kararlılık beklenirken çeviri hazırlanır, onay gelince önbellekten anında gösterilir.
   */
  freshCandidate(): string | null {
    const raw = this.candidateRaw;
    if (raw === null || this.candidateHits !== 1 || this.candidateNorm === '') {
      return null;
    }
    return this.isSimilar(this.candidateNorm, this.lastEmittedNorm) ? null : raw;
  }

  reset() {
    this.lastEmittedNorm = '';
    this.candidateRaw = null;
    this.candidateNorm = '';
    this.candidateHits = 0;
  }

  private tryEmit(): string | null {
    const raw = this.candidateRaw;
    if (raw === null) {
      return null;
    }
    // Gizleme bir kare fazla onay ister: altyazılar arası kısa boşluklarda kutu yanıp sönmesin.
    const required = this.candidateNorm === '' ? this.stableFrames + 1 : this.stableFrames;
    if (this.candidateHits < required) {
      return null;
    }
    if (this.isSimilar(this.candidateNorm, this.lastEmittedNorm)) {
      return null;
    }
    this.lastEmittedNorm = this.candidateNorm;
    return raw;
  }

  private isSimilar(a: string, b: string): boolean {
    if (a === b) {
      return true;
    }
    if (!a || !b) {
      return false;
    }
    return (
      similarity(a, b) >= this.similarityThreshold ||
      tokenContainment(a, b) >= CONTAINMENT_THRESHOLD
    );
  }
}

// ======================================================================== UiTextFilter

const UI_PATTERNS = [
  // Chiaki dokunmatik kontrol bildirimleri
  /on[\s-]*screen\s*controls?/i,
  /touch\s*pad\s*only/i,
  /controls?\s*(hidden|shown|enabled|disabled)/i,
  // Ekran üstü düğme etiketleri
  /^\s*[LR][123Il|]\s*$/i,
  /^\s*(share|options|create|ps)\s*$/i,
  /chiaki/i,
  // Oyunun kontrol ipuçları ("Hold L1 to view...", "Use L2 or R2 to select Bow")
  /\b[LR][123]\b/i,
  /^\s*p?(ress|hold|tap)\b.{0,25}\bto\s+\w+/i,
  /\bto\s+(select|equip|cycle|toggle|zoom|activate|interact|reload|holster|sprint)\b/i,
  // Satır başındaki düğme simgesi + komut ("R1 Focus on track" -> "RI", "R)", "RO", "LI")
  /^\s*[LR][123Il|)O0D9]\)?\s+[A-Za-z]/i,
];

/**
 * Görev / öğretici yazıları (RDR2 vb.): altyazının hemen altında, aynı okuma alanında çıkan kısa
 * emir cümleleri ("Follow Hosea", "Mount your horse", "Hunt a rabbit", "Pick up the rabbit").
 * Canlı testte altyazıya eklenip çeviriyi bozuyor ve önbelleği ıskalatıyordu.
 */
const OBJECTIVE_VERBS = [
  'follow', 'mount', 'dismount', 'hunt', 'pick up', 'cook', 'view', 'use', 'hold', 'press', 'tap',
  'switch to', 'tear down', 'return to', 'ride to', 'go to', 'head to', 'get to', 'get on', 'collect',
  'skin', 'loot', 'kill', 'exit', 'craft', 'equip', 'lasso', 'hogtie', 'track', 'escape', 'defend',
  'search', 'investigate', 'locate', 'deliver', 'sell', 'wait for', 'approach', 'catch', 'rob',
  'take cover', 'set up', 'make camp', 'feed', 'brush', 'lead', 'protect', 'enter',
]
  .map(v => v.replace(' ', '\\s+'))
  .join('|');
const OBJECTIVE_START = new RegExp(`^\\s*[^\\p{L}]*(?:${OBJECTIVE_VERBS})\\b`, 'iu');
/** Görev yazısında noktalama olmaz; diyalog satırında genellikle vardır. */
const SENTENCE_PUNCT = /[,.?!…]/;
const MAX_OBJECTIVE_WORDS = 5;

/** Menü / tekerlek adları ve OCR'ın tuş simgelerini okuduğu "@" işareti. */
const HUD_MARKERS = [/\b(menu|wheel)\b/i, /@/];

export function isObjectiveText(line: string): boolean {
  const words = line.trim().split(/\s+/).filter(Boolean);
  return (
    words.length > 0 &&
    words.length <= MAX_OBJECTIVE_WORDS &&
    !SENTENCE_PUNCT.test(line) &&
    OBJECTIVE_START.test(line)
  );
}

export const isUiText = (line: string) =>
  UI_PATTERNS.some(p => p.test(line)) || HUD_MARKERS.some(p => p.test(line)) || isObjectiveText(line);

/**
 * OCR görev yazısını altyazıyla aynı satırda okursa: cümle sonundan sonra gelen emir kalıbını
 * kırp ("Got one! Pick up the rabbit" -> "Got one!").
 */
const TRAILING_OBJECTIVE = new RegExp(
  `^(.*[.?!…])\\s+(?:${OBJECTIVE_VERBS})\\b[^,.?!…]{0,40}$`,
  'iu',
);

export function stripTrailingObjective(text: string): string {
  const m = TRAILING_OBJECTIVE.exec(text);
  return m && m[1].trim().length > 0 ? m[1].trim() : text;
}

// ======================================================================== SubtitleHeuristics

export interface OcrLine {
  text: string;
  top: number;
  bottom: number;
  /** Yatay sınırlar (konum için; sezgiler kullanmaz). */
  left?: number;
  right?: number;
}

const MAX_SUBTITLE_LINES = 3;
const MAX_LINE_GAP_FACTOR = 1.2;
const MAX_GROUPS = 2;
const MAX_UPPERCASE_RATIO = 0.7;
const MAX_DIGIT_RATIO = 0.25;
const SENTENCE_END = /[.?!…"'”]\s*$/;
const isLetter = (c: string) => /\p{L}/u.test(c);
const isUpper = (c: string) => c !== c.toLowerCase() && c === c.toUpperCase();

function looksLikeSubtitleLine(line: OcrLine): boolean {
  const letters = [...line.text].filter(isLetter);
  if (letters.length === 0) {
    return false;
  }
  const upper = letters.filter(isUpper).length / letters.length;
  if (letters.length >= 4 && upper > MAX_UPPERCASE_RATIO) {
    return false;
  }
  const nonSpace = [...line.text].filter(c => !/\s/.test(c)).length;
  const digits = [...line.text].filter(c => /\d/.test(c)).length / nonSpace;
  return digits <= MAX_DIGIT_RATIO;
}

function group(sorted: OcrLine[]): OcrLine[][] {
  const groups: OcrLine[][] = [[sorted[0]]];
  for (const line of sorted.slice(1)) {
    const last = groups[groups.length - 1];
    const prev = last[last.length - 1];
    const gap = line.top - prev.bottom;
    const ph = prev.bottom - prev.top;
    const lh = line.bottom - line.top;
    if (gap <= Math.max(ph, lh) * MAX_LINE_GAP_FACTOR) {
      last.push(line);
    } else {
      groups.push([line]);
    }
  }
  return groups;
}

/** Altyazıyı oyun arayüzünden (envanter, menü, liste) ayırır. */
export function selectSubtitle(lines: OcrLine[]): {
  text: string;
  rejectReason: string | null;
  /** Altyazı sayılan satırlar (ekrandaki konumu için). */
  lines?: OcrLine[];
} {
  if (lines.length === 0) {
    return { text: '', rejectReason: null };
  }
  const sentenceLike = lines.filter(looksLikeSubtitleLine);
  if (sentenceLike.length * 2 < lines.length) {
    return {
      text: '',
      rejectReason: `menu-like: ${lines.length - sentenceLike.length}/${lines.length} non-sentence lines`,
    };
  }
  if (sentenceLike.length === 0) {
    return { text: '', rejectReason: null };
  }
  if (sentenceLike.length > MAX_SUBTITLE_LINES) {
    return { text: '', rejectReason: `list-like: ${sentenceLike.length} lines` };
  }
  const groups = group([...sentenceLike].sort((a, b) => a.top - b.top));
  if (groups.length > MAX_GROUPS) {
    return { text: '', rejectReason: `scattered: ${groups.length} separate groups` };
  }
  const text = groups
    .flat()
    .map(l => l.text.trim())
    .join(' ');
  if (text.split(' ').filter(w => w.trim()).length < 2 && !SENTENCE_END.test(text)) {
    return { text: '', rejectReason: `single word: "${text}"` };
  }
  return { text, rejectReason: null, lines: groups.flat() };
}

// ======================================================================== OCR artıkları

/** Satır başındaki madde işareti / noktalama kırıntıları ("• How's", ", It's", ". I remember"). */
const LEADING_JUNK = /^[\s•·*,;:—–\-_|~]+(?=\S)/u;
/** Baştaki "." ama "..." değil. */
const LEADING_DOT = /^\.(?!\.)\s*/;
/** Tuş simgesinden kalan tek harf ("L Okay." / "...says... L"); "I", "a", "A", "O" sözcük olabilir. */
const LEADING_STRAY_LETTER = /^[B-HJ-NP-Zb-z]\s+(?=\p{Lu})/u;
const TRAILING_STRAY_LETTER = /(?<=[\p{L}.?!…,])\s+[B-HJ-NP-Zb-z]$/u;
const TRAILING_DASH = /\s*[—–\-_|]+$/u;

/** Altyazı metninin başındaki/sonundaki OCR kırıntılarını temizler (anlamlı noktalamaya dokunmaz). */
export function cleanSubtitleText(text: string): string {
  let t = text.trim();
  t = t.replace(LEADING_DOT, '');
  t = t.replace(LEADING_JUNK, '');
  t = t.replace(LEADING_STRAY_LETTER, '');
  t = t.replace(TRAILING_DASH, '');
  t = t.replace(TRAILING_STRAY_LETTER, '');
  return t.trim();
}
