/**
 * Çevrilmeyecek kelimeler (oyun karakterleri, yer adları). Ör. RDR2'deki "Dutch" bir
 * karakterdir; DeepL / ML Kit onu "Hollandaca" diye çevirmesin.
 *
 * Eşleşme büyük/küçük harfe duyarlıdır ("Bill" korunur, "the bill" çevrilir); OCR tümü büyük
 * harf okursa diye "DUTCH" gibi tamamı büyük yazımlar da korunur.
 */

/** RDR2 karakter ve yer adları: listesi ayarlardan değiştirilebilir, bu varsayılanıdır. */
export const DEFAULT_PROTECTED_TERMS = [
  'Dutch',
  'Arthur',
  'Morgan',
  'John',
  'Marston',
  'Micah',
  'Hosea',
  'Sadie',
  'Javier',
  'Charles',
  'Lenny',
  'Bill',
  'Sean',
  'Kieran',
  'Abigail',
  'Jack',
  'Tilly',
  'Karen',
  'Mary-Beth',
  'Pearson',
  'Strauss',
  'Swanson',
  'Uncle',
  'Molly',
  'Susan',
  'Grimshaw',
  'Trelawny',
  'Josiah',
  'Colm',
  "O'Driscoll",
  'Cornwall',
  'Pinkerton',
  'Milton',
  'Valentine',
  'Saint Denis',
  'Rhodes',
  'Strawberry',
  'Blackwater',
  'Annesburg',
  'Van Horn',
  'Armadillo',
  'Tumbleweed',
  'Guarma',
  // Canlı testte çevrilen / karışan adlar
  'Bessie',
  'Leopold',
  'Moonstone Pond',
  "O'Creagh's Run",
  'Cumberland Falls',
  'Great Plains',
  'Horseshoe Overlook',
  'Colter',
  'Clemens Point',
  'Shady Belle',
  'Beaver Hollow',
  'Emerald Ranch',
  'Flat Iron Lake',
  'Heartlands',
  'Big Valley',
  'Lemoyne',
  'New Hanover',
  'West Elizabeth',
  'New Austin',
  'Ambarino',
];

/** Sonradan eklenen varsayılanlar: kayıtlı listesi olan kullanıcılara bir kez eklenir. */
export const ADDED_PROTECTED_TERMS_V3 = DEFAULT_PROTECTED_TERMS.slice(
  DEFAULT_PROTECTED_TERMS.indexOf('Bessie'),
);

export interface Protected {
  /** Çeviriye gönderilecek metin. */
  text: string;
  /** Çeviri sonucundaki işaretleri gerçek kelimelere geri çevirir. */
  restore: (translated: string) => string;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Terimleri (ve tamamı büyük harf hallerini) bulan regex; uzun terimler önce denenir. */
function termRegex(terms: string[]): RegExp | null {
  const variants = new Set<string>();
  for (const t of terms) {
    const term = t.trim();
    if (term) {
      variants.add(term);
      variants.add(term.toUpperCase());
    }
  }
  if (variants.size === 0) {
    return null;
  }
  const alternation = [...variants]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|');
  return new RegExp(`\\b(?:${alternation})\\b`, 'g');
}

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * DeepL için: terimler <keep> etiketine alınır, istek `tag_handling: 'xml'` ve
 * `ignore_tags: ['keep']` ile gönderilir. DeepL etiket içine dokunmaz; Türkçe ekleri
 * (Dutch'a, Dutch'ın) cümleye göre kendisi getirir.
 */
export function protectForDeepL(text: string, terms: string[]): Protected {
  const re = termRegex(terms);
  if (!re) {
    return { text, restore: t => t };
  }
  return {
    text: escapeXml(text).replace(re, m => `<keep>${m}</keep>`),
    restore: t => unescapeXml(t.replace(/<\/?keep>/g, '')),
  };
}

/**
 * ML Kit etiket bilmez: terimler "XZ0", "XZ1"… yer tutucularıyla değiştirilir, çeviriden
 * sonra geri yazılır. Yer tutucu çeviride kaybolursa terim de kaybolur (nadir).
 */
export function protectWithPlaceholders(
  text: string,
  terms: string[],
): Protected {
  const re = termRegex(terms);
  if (!re) {
    return { text, restore: t => t };
  }
  const found: string[] = [];
  const replaced = text.replace(re, m => {
    let i = found.indexOf(m);
    if (i < 0) {
      i = found.push(m) - 1;
    }
    return `XZ${i}`;
  });
  return {
    text: replaced,
    restore: t =>
      t.replace(/XZ(\d+)(['’]([a-zçğıöşü]+))?/gi, (m, i, _ap, suffix) => {
        const word = found[Number(i)];
        if (word === undefined) {
          return m;
        }
        return suffix ? `${word}'${harmonizeSuffix(word, suffix)}` : word;
      }),
  };
}

// ---------------------------------------------------------------- Türkçe ek uyumu

const VOWELS = 'aeıioöuü';
const BACK = 'aıou';
const ROUND = 'oöuü';
/** "FıSTıKÇıŞaHaP": sert ünsüzle biten sözcükten sonra -da/-dan -ta/-tan olur. */
const HARD = 'fstkçşhp';

/**
 * Model ekleri yer tutucuya ("XZ0'ı") göre seçer; gerçek ad geri yazılınca kaynaştırma harfi ve
 * ünlü uyumu yanlış kalır ("Hosea'ı", "Dutch'nun"). Ekin türünü (belirtme, tamlayan, yönelme,
 * bulunma, ayrılma, vasıta) tanıyıp ada göre yeniden kurar; tanımadığı eke dokunmaz.
 * Ünlü uyumu yazımdaki son ünlüye göredir (İngilizce okunuşu bilinmez).
 */
export function harmonizeSuffix(word: string, suffix: string): string {
  const w = word.toLocaleLowerCase('tr').replace(/[^a-zçğıöşü]/g, '');
  if (!w) {
    return suffix;
  }
  // Sondaki "y" okunuşta ünlüdür (Kitty, Abigail değil): "i" gibi davranır.
  let letters = w.endsWith('y') && w.length > 1 ? w.slice(0, -1) + 'i' : w;
  // Sondaki sessiz "e" okunmaz (Valentine, Pinkerton değil): ünsüzle biter sayılır.
  if (/[^aeıioöuü]e$/.test(letters) && letters.length > 3 && /[aıioöuü]/.test(letters.slice(0, -1))) {
    letters = letters.slice(0, -1);
  }
  const last = [...letters].reverse().find(c => VOWELS.includes(c)) ?? 'e';
  const endsVowel = VOWELS.includes(letters[letters.length - 1]);
  const hard = HARD.includes(letters[letters.length - 1]);
  const back = BACK.includes(last);
  const round = ROUND.includes(last);
  const I = back ? (round ? 'u' : 'ı') : round ? 'ü' : 'i';
  const A = back ? 'a' : 'e';
  const D = hard ? 't' : 'd';

  const s = suffix.toLocaleLowerCase('tr');
  const cases: [RegExp, () => string][] = [
    [/^(n)?[ıiuü]n$/, () => (endsVowel ? 'n' : '') + I + 'n'], // tamlayan: Dutch'ın, Hosea'nın
    [/^(y)?[ıiuü]$/, () => (endsVowel ? 'y' : '') + I], // belirtme: Hosea'yı, Arthur'u
    [/^(y)?[ae]$/, () => (endsVowel ? 'y' : '') + A], // yönelme: Valentine'a, Hosea'ya
    [/^[dt][ae]$/, () => D + A], // bulunma: Rhodes'ta
    [/^[dt][ae]n$/, () => D + A + 'n'], // ayrılma: Saint Denis'ten
    [/^(y)?l[ae]$/, () => (endsVowel ? 'y' : '') + 'l' + A], // vasıta: Hosea'yla
  ];
  for (const [re, build] of cases) {
    if (re.test(s)) {
      return build();
    }
  }
  return suffix;
}
