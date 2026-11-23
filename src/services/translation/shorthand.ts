/**
 * Çeviriden önce uygulanan kalıplar: mesajlaşma kısaltmaları ("R U ok?") ve OCR'ın sık yaptığı
 * harf karışıklıkları ("lt's" -> "It's"). DeepL / ML Kit bunları tanımadığı için ya hiç çevirmiyor
 * ya da yanlış çeviriyor; metin açık haline getirilip öyle gönderilir.
 *
 * Kurallar bilerek temkinli: tek başına büyük "U" OCR'da "I" harfinin yanlış okunması da
 * olabildiği için yalnızca kalıp içinde (R U, U R, are U, U ok...) açılır.
 * Yeni kalıp eklemek için listeye bir satır eklemek yeterli.
 */
type Replacement = string | ((substring: string, ...args: any[]) => string);

const RULES: [RegExp, Replacement][] = [
  // --- Mesajlaşma kısaltmaları ---
  [/\bR\s+U\b/gi, 'are you'],
  [/\bU\s+R\b/g, 'you are'],
  [/\bu\s+r\b/g, 'you are'],
  [/\b(are|r|thank|love|see|miss|hear|told|got|for|with|to)\s+U\b/gi, '$1 you'],
  [/\bU\s+(ok|okay|alright|good|there|guys|know|sure|mean|think|want|need|can|will|do|did|have|got|gotta|wanna|gonna)\b/gi, 'you $1'],
  [/\bur\b/g, 'your'],
  [/\bu\b/g, 'you'], // küçük harf "u" OCR'da nadiren hata olur; tek başınaysa "you"
  [/\by\s+u\b/gi, 'why you'],
  [/\bthx\b|\bthnx\b|\btnx\b/gi, 'thanks'],
  [/\bty\b/g, 'thank you'],
  [/\bpl[sz]\b/gi, 'please'],
  [/\bidk\b/gi, "I don't know"],
  [/\bidc\b/gi, "I don't care"],
  [/\bimo\b/gi, 'in my opinion'],
  [/\bbtw\b/gi, 'by the way'],
  [/\bomg\b/gi, 'oh my god'],
  [/\bbrb\b/gi, 'be right back'],
  [/\bnvm\b/gi, 'never mind'],
  [/\bwtf\b/gi, 'what the fuck'],
  [/\bcuz\b|\bcos\b/gi, 'because'],
  [/\bdunno\b/gi, "don't know"],
  [/\blemme\b/gi, 'let me'],
  [/\bgimme\b/gi, 'give me'],
  [/\bb4\b/gi, 'before'],
  [/\bgr8\b/gi, 'great'],
  [/\bl8r\b/gi, 'later'],
  [/\b2day\b/gi, 'today'],
  [/\b2morrow\b/gi, 'tomorrow'],

  // --- OCR harf karışıklıkları (küçük L ile büyük I) ---
  // Cümle başındaysa "It", içindeyse "it".
  [
    /\blt(['’](?:s|ll|d))?\b/g,
    (_m: string, suffix: string | undefined, offset: number, all: string) =>
      (atSentenceStart(all.slice(0, offset)) ? 'It' : 'it') + (suffix ?? ''),
  ],
  [/\bl(['’](?:m|ll|d|ve))\b/g, 'I$1'],
];

function atSentenceStart(before: string): boolean {
  return /^\W*$/.test(before) || /[.!?]["'”’)]*\s+\W*$/.test(before);
}

export function expandShorthand(text: string): string {
  let out = text;
  for (const [re, rep] of RULES) {
    out =
      typeof rep === 'string' ? out.replace(re, rep) : out.replace(re, rep);
  }
  // Cümle başındaki küçük harfi düzelt ("are you ok?" -> "Are you ok?").
  return out === text ? text : out.replace(/^(\W*)([a-z])/, (_, p, c) => p + c.toUpperCase());
}
