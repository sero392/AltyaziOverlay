package com.altyazioverlay.ocr

/**
 * Metin düzeyinde değişim (diff) kontrolü. Saf Kotlin -> JVM birim testine uygun.
 *
 * Amaç: aynı altyazı için tekrar tekrar çeviri API'si çağrılmasını engellemek.
 *  1) Normalizasyon: büyük/küçük harf, noktalama, fazla boşluk yok sayılır
 *     ("Hello there." == "hello there").
 *  2) Bulanık eşleşme: OCR'ın tek-iki karakterlik titremesi (Levenshtein benzerliği
 *     >= [similarityThreshold]) "aynı metin" sayılır.
 *  3) Kararlılık: aday metin [stableFrames] kez art arda görülmeden yayınlanmaz.
 *     Görüntü hiç değişmediyse (piksel diff) bu da bir onay sayılır, OCR'a gerek kalmaz.
 *
 * Dönen değer: yayınlanacak ham metin, ya da null. "" = altyazı ekrandan kalktı.
 */
class TextChangeFilter(
    private val stableFrames: Int = 2,
    private val similarityThreshold: Float = 0.80f,
) {
    private var lastEmittedNorm: String = ""
    private var candidateRaw: String? = null
    private var candidateNorm: String = ""
    private var candidateHits = 0

    fun onRecognized(raw: String): String? {
        val norm = normalize(raw)
        if (candidateRaw != null && isSimilar(norm, candidateNorm)) {
            candidateHits++
            // Daha uzun okuma genellikle daha eksiksizdir (daktilo efekti vb.).
            if (raw.length >= (candidateRaw?.length ?: 0)) {
                candidateRaw = raw
                candidateNorm = norm
            }
        } else {
            candidateRaw = raw
            candidateNorm = norm
            candidateHits = 1
        }
        return tryEmit()
    }

    fun onFrameUnchanged(): String? {
        if (candidateRaw == null) return null
        candidateHits++
        return tryEmit()
    }

    fun reset() {
        lastEmittedNorm = ""
        candidateRaw = null
        candidateNorm = ""
        candidateHits = 0
    }

    private fun tryEmit(): String? {
        val raw = candidateRaw ?: return null
        // Gizleme (boş metin) bir kare fazla onay ister: altyazılar arası kısa boşluklarda
        // veya OCR'ın tek karelik kaçırmalarında çeviri kutusu yanıp sönmesin.
        val required = if (candidateNorm.isEmpty()) stableFrames + 1 else stableFrames
        if (candidateHits < required) return null
        if (isSimilar(candidateNorm, lastEmittedNorm)) return null
        lastEmittedNorm = candidateNorm
        return raw
    }

    private fun isSimilar(a: String, b: String): Boolean {
        if (a == b) return true
        if (a.isEmpty() || b.isEmpty()) return false
        return similarity(a, b) >= similarityThreshold || tokenContainment(a, b) >= CONTAINMENT_THRESHOLD
    }

    companion object {
        private val NON_WORD = Regex("""[^\p{L}\p{N} ]+""")
        private val SPACES = Regex("""\s+""")
        private const val MAX_LEN = 300
        private const val CONTAINMENT_THRESHOLD = 0.8f
        private const val MIN_CONTAINMENT_TOKENS = 3
        private const val FUZZY_TOKEN_MIN_LEN = 5
        private const val FUZZY_TOKEN_THRESHOLD = 0.6f

        /**
         * Kısa metnin kelimelerinin ne kadarı uzun metinde de var (0-1).
         * Levenshtein, okumaya fazladan bir kelime / satır eklenince (sahne gürültüsü,
         * daktilo efektiyle büyüyen altyazı) sert düşer; bu ölçü ise "aynı altyazı + ek"
         * durumunu aynı metin sayar. Kısa metinler (< 3 kelime) yanlış eşleşmesin diye hariç.
         *
         * Kelimeler bulanık eşleşir: OCR aynı kelimeyi karelere göre farklı bozabilir
         * ("approach" / "approuch" / "approacti"); bu yüzden [FUZZY_TOKEN_MIN_LEN] ve üzeri
         * uzunluktaki kelimeler [FUZZY_TOKEN_THRESHOLD] benzerlikle eşleşmiş sayılır.
         * Kısa kelimeler ("on" / "in") anlam değiştirebileceği için birebir aranır.
         */
        fun tokenContainment(a: String, b: String): Float {
            val ta = a.split(' ').filter { it.isNotEmpty() }.toSet()
            val tb = b.split(' ').filter { it.isNotEmpty() }.toSet()
            val (small, large) = if (ta.size <= tb.size) ta to tb else tb to ta
            if (small.size < MIN_CONTAINMENT_TOKENS) return 0f
            return small.count { token -> tokenMatches(token, large) }.toFloat() / small.size
        }

        private fun tokenMatches(token: String, candidates: Set<String>): Boolean {
            if (token in candidates) return true
            if (token.length < FUZZY_TOKEN_MIN_LEN) return false
            return candidates.any {
                it.length >= FUZZY_TOKEN_MIN_LEN && similarity(token, it) >= FUZZY_TOKEN_THRESHOLD
            }
        }

        fun normalize(s: String): String =
            s.lowercase().replace(NON_WORD, " ").replace(SPACES, " ").trim().take(MAX_LEN)

        /** 1 - (levenshtein / maxLen). İki satırlık bellek, O(n*m) zaman. */
        fun similarity(a: String, b: String): Float {
            val maxLen = maxOf(a.length, b.length)
            if (maxLen == 0) return 1f
            var prev = IntArray(b.length + 1) { it }
            var cur = IntArray(b.length + 1)
            for (i in 1..a.length) {
                cur[0] = i
                val ca = a[i - 1]
                for (j in 1..b.length) {
                    val cost = if (ca == b[j - 1]) 0 else 1
                    cur[j] = minOf(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
                }
                val t = prev; prev = cur; cur = t
            }
            return 1f - prev[b.length].toFloat() / maxLen
        }
    }
}
