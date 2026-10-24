import {
  AbortError,
  TranslationResult,
  TranslationService,
} from './TranslationService';

const PHRASES: Record<string, string> = {
  'where are you going': 'Nereye gidiyorsun?',
  'we have to go': 'Gitmemiz gerek.',
  'follow me': 'Beni takip et.',
  'watch out': 'Dikkat et!',
  'i know': 'Biliyorum.',
  'are you okay': 'İyi misin?',
  "let's go": 'Hadi gidelim.',
  'thank you': 'Teşekkürler.',
  'what happened': 'Ne oldu?',
  'get down': 'Eğil!',
  'over here': 'Buraya!',
  'stay close': 'Yakın dur.',
};

const WORDS: Record<string, string> = {
  i: 'ben',
  you: 'sen',
  we: 'biz',
  they: 'onlar',
  he: 'o',
  she: 'o',
  it: 'o',
  is: '',
  are: '',
  am: '',
  the: '',
  a: '',
  an: '',
  go: 'git',
  come: 'gel',
  run: 'koş',
  stop: 'dur',
  help: 'yardım',
  wait: 'bekle',
  here: 'burada',
  there: 'orada',
  now: 'şimdi',
  yes: 'evet',
  no: 'hayır',
  what: 'ne',
  where: 'nerede',
  why: 'neden',
  who: 'kim',
  how: 'nasıl',
  good: 'iyi',
  bad: 'kötü',
  enemy: 'düşman',
  friend: 'dost',
  door: 'kapı',
  weapon: 'silah',
  ammo: 'cephane',
  kill: 'öldür',
  find: 'bul',
  look: 'bak',
  hurry: 'acele et',
  quiet: 'sessiz',
  dead: 'ölü',
  alive: 'canlı',
  and: 've',
};

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[.,!?;:"“”‘’…()[\]{}<>*_~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Ağ çağrısı simülasyonu: 120–450ms gecikme, %3 hata, AbortSignal desteği.
 * Önce sabit ifade sözlüğü, sonra kelime kelime "çeviri", olmazsa [TR] etiketi.
 *
 * Gecikme için JS setTimeout DEĞİL, enjekte edilen `sleep` kullanılır: RN, uygulama
 * arka plandayken (oyun öndeyken) JS zamanlayıcılarını durdurur.
 */
export class MockTranslationService implements TranslationService {
  constructor(
    private readonly sleep: (ms: number) => Promise<void>,
    private readonly minDelayMs = 120,
    private readonly maxDelayMs = 450,
    private readonly failureRate = 0.03,
  ) {}

  async translate(
    text: string,
    signal?: AbortSignal,
  ): Promise<TranslationResult> {
    const delay =
      this.minDelayMs + Math.random() * (this.maxDelayMs - this.minDelayMs);
    await this.sleep(delay);
    if (signal?.aborted) {
      throw new AbortError();
    }
    if (Math.random() < this.failureRate) {
      throw new Error('Simüle edilmiş çeviri API hatası (503)');
    }
    return { text: this.fakeTranslate(text), fromCache: false };
  }

  private fakeTranslate(text: string): string {
    const norm = normalize(text);
    const phrase = PHRASES[norm];
    if (phrase) {
      return phrase;
    }

    let hits = 0;
    const words = norm.split(' ').map(w => {
      const t = WORDS[w];
      if (t !== undefined) {
        hits++;
        return t;
      }
      return w;
    });
    const out = words.filter(Boolean).join(' ');
    if (hits > 0 && out.length > 0) {
      return out.charAt(0).toLocaleUpperCase('tr-TR') + out.slice(1);
    }
    return `[TR] ${text}`;
  }
}
