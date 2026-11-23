package com.altyazioverlay.ocr

/** OCR'dan gelen, temel filtrelerden geçmiş tek satır. */
data class OcrLine(val text: String, val top: Int, val bottom: Int) {
    val height: Int get() = bottom - top
}

/**
 * Altyazıyı oyun arayüzünden (envanter, menü, silah çarkı, istatistik listeleri) ayırır.
 * Saf Kotlin -> JVM birim testine uygun.
 *
 * Altyazının tipik özellikleri:
 *  - en fazla 2-3 satır, satırlar birbirine bitişik tek bir grup,
 *  - cümle gibidir: karışık büyük/küçük harf, birden çok kelime ya da noktalama ile biter,
 *  - rakam ağırlıklı değildir.
 * Menü / envanter ise çok sayıda kısa, aralıklı satır; BÜYÜK HARFLİ etiketler; sayılar
 * ("x12", "45/100") ve tek kelimelik eşya adları içerir.
 */
object SubtitleHeuristics {

    /** Altyazı en fazla bu kadar satırdır; daha uzun cümle bloğu ipucu / açıklama metnidir. */
    private const val MAX_SUBTITLE_LINES = 3
    /** Satırlar arası boşluk, satır yüksekliğinin bu katından büyükse ayrı grup sayılır. */
    private const val MAX_LINE_GAP_FACTOR = 1.2f
    /**
     * En alttaki grubun hemen üstündeki grup bu kat yakınsa aynı altyazının parçası sayılır
     * (satırları biraz aralıklı iki satırlık altyazı).
     */
    private const val JOIN_GROUP_GAP_FACTOR = 2.5f
    private const val MAX_UPPERCASE_RATIO = 0.7f
    private const val MAX_DIGIT_RATIO = 0.25f
    private val SENTENCE_END = Regex("""[.?!…"'”]\s*$""")

    /** Üstteki (altyazı olmayan) alanlarda bundan fazla yazı satırı varsa alan menüdür. */
    private const val MAX_TEXT_LINES_IN_REGION = 6

    data class Result(val text: String, val rejectReason: String?)

    /**
     * Bir okuma alanının satırları.
     * @param screenTop Alanın ekrandaki üst kenarı (sıralama için).
     * @param textLineCount Ortalama filtresinden önceki yazı satırı sayısı (menü tespiti).
     */
    data class RegionLines(val screenTop: Int, val lines: List<OcrLine>, val textLineCount: Int = lines.size)

    /**
     * Her okuma alanı ayrı değerlendirilir: bir alandaki menü / tabela / telefon ekranı başka alandaki
     * altyazıyı götürmesin. Önce en alttaki alana bakılır (altyazı alanı, esnek kurallar); orada
     * altyazı yoksa yukarıdakilere sıkı kurallarla ([select] strict) bakılır.
     */
    fun selectFromRegions(regions: List<RegionLines>): Result {
        val reasons = mutableListOf<String>()
        regions.sortedByDescending { it.screenTop }.forEachIndexed { i, region ->
            val strict = i > 0
            if (strict && region.textLineCount > MAX_TEXT_LINES_IN_REGION) {
                reasons += "menu: ${region.textLineCount} satir"
                return@forEachIndexed
            }
            val res = select(region.lines, strict)
            if (res.text.isNotEmpty()) return res
            res.rejectReason?.let { reasons += it }
        }
        return Result("", reasons.joinToString(" | ").ifEmpty { null })
    }

    /**
     * Tek bir okuma alanının satırlarından altyazıyı seçer.
     *
     * Karar satır satır verilir: cümleye benzemeyen satırlar (BÜYÜK HARFLİ etiketler, diyalog
     * seçenekleri, tabelalar, fiyatlar) tek tek atılır, kalan cümlelerden en alttaki grup altyazıdır.
     * Eskiden alanda bu satırlar çoğunluktaysa kare tamamen "menü" sayılıp altyazı da atılıyordu
     * (soygunda "THREATEN / STAFF MEMBER" seçenekleri, "Both of you, on the ground." satırını
     * götürüyordu). Kare yalnızca içinde hiç cümle yoksa reddedilir.
     *
     * Aynı alanda üstte ipucu kutusu, altta altyazı varsa: altyazılar ekranın altına yazılır,
     * bu yüzden en alttaki grup seçilir.
     *
     * @param strict Altyazı alanı olmayan (üstteki) alanlar için: orada cümle dışı satırlar
     *   çoğunluktaysa alan tamamen menü / tabela sayılır. Yoksa altyazının olmadığı anlarda
     *   sahnedeki rastgele tabela cümleleri çevrilirdi.
     */
    fun select(lines: List<OcrLine>, strict: Boolean = false): Result {
        if (lines.isEmpty()) return Result("", null)

        val sentenceLike = lines.filter(::looksLikeSubtitleLine)
        if (strict && sentenceLike.size * 2 < lines.size) {
            return Result("", "menu-like: ${lines.size - sentenceLike.size}/${lines.size} non-sentence lines")
        }
        if (sentenceLike.isEmpty()) {
            return Result("", "menu-like: ${lines.size}/${lines.size} non-sentence lines")
        }

        val groups = group(sentenceLike.sortedBy { it.top })
        var picked: List<OcrLine> = groups.last()
        if (groups.size >= 2) {
            val above = groups[groups.size - 2]
            val gap = picked.first().top - above.last().bottom
            val lineHeight = maxOf(above.last().height, picked.first().height)
            if (gap <= lineHeight * JOIN_GROUP_GAP_FACTOR && above.size + picked.size <= MAX_SUBTITLE_LINES) {
                picked = above + picked
            }
        }
        if (picked.size > MAX_SUBTITLE_LINES) {
            return Result("", "list-like: ${picked.size} lines")
        }

        val text = picked.joinToString(" ") { it.text.trim() }
        // Toplamda tek kelime ve cümle sonu yok -> eşya / düğme adı.
        if (text.split(' ').count { it.isNotBlank() } < 2 && !SENTENCE_END.containsMatchIn(text)) {
            return Result("", "single word: \"$text\"")
        }
        return Result(text, null)
    }

    private fun looksLikeSubtitleLine(line: OcrLine): Boolean {
        val letters = line.text.filter(Char::isLetter)
        if (letters.isEmpty()) return false
        val upper = letters.count(Char::isUpperCase).toFloat() / letters.length
        if (letters.length >= 4 && upper > MAX_UPPERCASE_RATIO) return false
        val nonSpace = line.text.count { !it.isWhitespace() }
        val digits = line.text.count(Char::isDigit).toFloat() / nonSpace
        return digits <= MAX_DIGIT_RATIO
    }

    /** Dikeyde bitişik satırları gruplar (iki satırlık altyazı = tek grup). */
    private fun group(sorted: List<OcrLine>): List<List<OcrLine>> {
        val groups = mutableListOf(mutableListOf(sorted.first()))
        for (line in sorted.drop(1)) {
            val prev = groups.last().last()
            val gap = line.top - prev.bottom
            if (gap <= maxOf(prev.height, line.height) * MAX_LINE_GAP_FACTOR) {
                groups.last().add(line)
            } else {
                groups.add(mutableListOf(line))
            }
        }
        return groups
    }
}
