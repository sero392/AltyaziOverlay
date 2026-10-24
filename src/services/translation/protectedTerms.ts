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
];

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
      t.replace(/XZ(\d+)/gi, (m, i) => found[Number(i)] ?? m),
  };
}
