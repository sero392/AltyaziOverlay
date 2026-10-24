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

    /** Bu kadar satırdan fazlası altyazı değil, liste/menüdür. */
    private const val MAX_SUBTITLE_LINES = 3
    /** Satırlar arası boşluk, satır yüksekliğinin bu katından büyükse ayrı grup sayılır. */
    private const val MAX_LINE_GAP_FACTOR = 1.2f
    /** Bundan fazla ayrık grup varsa ekranda liste/menü vardır. */
    private const val MAX_GROUPS = 2
    private const val MAX_UPPERCASE_RATIO = 0.7f
    private const val MAX_DIGIT_RATIO = 0.25f
    private val SENTENCE_END = Regex("""[.?!…"'”]\s*$""")

    data class Result(val text: String, val rejectReason: String?)

    fun select(lines: List<OcrLine>): Result {
        if (lines.isEmpty()) return Result("", null)

        val sentenceLike = lines.filter(::looksLikeSubtitleLine)
        // Ekrandaki satırların çoğu cümleye benzemiyorsa (etiket, sayı, eşya adı) bu bir menüdür;
        // aradaki tek tük cümle benzeri satır da (eşya açıklaması gibi) altyazı değildir.
        if (sentenceLike.size * 2 < lines.size) {
            return Result("", "menu-like: ${lines.size - sentenceLike.size}/${lines.size} non-sentence lines")
        }
        if (sentenceLike.isEmpty()) return Result("", null)
        if (sentenceLike.size > MAX_SUBTITLE_LINES) {
            return Result("", "list-like: ${sentenceLike.size} lines")
        }

        val groups = group(sentenceLike.sortedBy { it.top })
        if (groups.size > MAX_GROUPS) {
            return Result("", "scattered: ${groups.size} separate groups")
        }

        val text = groups.flatten().joinToString(" ") { it.text.trim() }
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
