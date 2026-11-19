/**
 * İngilizce altyazıda Windows OCR'ın sık yaptığı karakter karışıklıklarını çeviriden ÖNCE düzeltir.
 * Kurallar canlı oyun kaydında görülen hatalardan çıkarıldı ve bilerek dar tutuldu: yalnızca
 * İngilizcede doğru yazımı olmayan kalıplar değiştirilir, gerçek bir kelimeyi bozma riski
 * olan genel kurallar (her "rn" -> "m" gibi) yoktur.
 *
 * Görülen örnekler: "1'11 shoot you" (I'll), "Corne on" (Come on), "alvvays" (always),
 * "ofyours" (of yours), "I beg yon" (you).
 */

const RULES: [RegExp, string | ((m: string, ...g: string[]) => string)][] = [
  // "1'll", "1'11", "1'II", "1'm", "1'd", "1've" -> I'll / I'm / I'd / I've
  [/\b1'(?:ll|11|II|Il|lI|l1|1l)\b/g, "I'll"],
  [/\b1'(m|d|ve)\b/g, (_m, s) => `I'${s}`],
  // Tek başına "1" + "I"dan sonra gelen tipik fiil -> "I" ("and 1 think", "1 know"). Fiil listesi
  // şart: "1 or 2 horses" gibi gerçek sayılar korunmalı.
  [
    /(^|[\s"“(])1(?=\s+(?:am|was|have|had|will|would|can|can't|could|don't|do|did|didn't|think|know|need|want|got|guess|mean|told|said|just|never|swear|reckon|ain't|wish|hope|see|saw|believe|thought|heard|really|still|should|must)\b)/g,
    (_m, pre) => `${pre}I`,
  ],
  // "vv" İngilizce kelime içinde neredeyse hiç geçmez (savvy vb. hariç) -> "w"
  [/\b(?!(?:savv|navv|chivv|skivv|divv|revv))([A-Za-z]*)vv([A-Za-z]*)\b/g, (_m, a, b) => `${a}w${b}`],
  // "Corne on" -> "Come on" (rn/m karışması; yalnızca bu kalıpta güvenli)
  [/\b([Cc])orne on\b/g, (_m, c) => `${c}ome on`],
  // Boşluğu yutulmuş sık ikililer: "ofyours", "ifyou", "toyou", "forthe"...
  [/\b(of|if|to|for|and|that|what|with|at|in|on)(you|your|yours|the)\b/gi, (_m, a, b) => `${a} ${b}`],
  // "yon" (arkaik) altyazıda pratikte hep "you"nun yanlış okunmasıdır
  [/\byon\b/g, 'you'],
];

export function correctOcrEnglish(text: string): string {
  let out = text;
  for (const [re, rep] of RULES) {
    out = out.replace(re, rep as never);
  }
  return out;
}
