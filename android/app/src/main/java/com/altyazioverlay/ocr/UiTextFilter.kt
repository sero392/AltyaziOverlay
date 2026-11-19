package com.altyazioverlay.ocr

/**
 * Yayın uygulamasının (Chiaki vb.) kendi arayüz yazılarını ve oyunun kontrol
 * ipuçlarını OCR sonucundan ayıklar.
 * Bu satırlar altyazı değildir; çeviriye girerlerse cümleyi bozarlar.
 *
 * Eşleşme satır bazındadır: kalıplardan birini içeren satır tamamen atılır.
 * Altyazı ile arayüz yazısı ekranda farklı konumlarda olduğu için ML Kit onları
 * ayrı satır olarak döndürür.
 */
object UiTextFilter {

    private val PATTERNS: List<Regex> = listOf(
        // Chiaki dokunmatik kontrol bildirimleri
        """on[\s-]*screen\s*controls?""",
        """touch\s*pad\s*only""",
        """controls?\s*(hidden|shown|enabled|disabled)""",
        // Ekran üstü düğme etiketleri (L1/L2/L3/R1/R2/R3, OCR'ın I/1 karıştırması dahil)
        """^\s*[LR][123Il|]\s*$""",
        """^\s*(share|options|create|ps)\s*$""",
        // Uygulama adı
        """chiaki""",
        // Oyunun kontrol ipuçları ("Hold L1 to view...", "Use L2 or R2 to select Bow").
        // Düğme simgeleri OCR'da "L1"/"R2" olarak okunur ya da tamamen kaybolur ("Hold to view").
        """\b[LR][123]\b""",
        // Simgeler "3", "L9", "RD)" gibi okunabildiği için arası serbest; ilk harf de kaybolabilir ("ress").
        """^\s*p?(ress|hold|tap)\b.{0,25}\bto\s+\w+""",
        """\bto\s+(select|equip|cycle|toggle|zoom|activate|interact|reload|holster|sprint)\b""",
        // Satır başındaki düğme simgesi + komut ("R1 Focus on track" -> "RI", "R)", "RO", "LI").
        """^\s*[LR][123Il|)O0D9]\)?\s+[A-Za-z]""",
    ).map { Regex(it, RegexOption.IGNORE_CASE) }

    /**
     * Görev / öğretici yazıları (RDR2 vb.): altyazının hemen altında çıkan kısa emir cümleleri
     * ("Follow Hosea", "Mount your horse", "Hunt a rabbit"). Masaüstündeki filters.ts ile aynı liste.
     */
    private val OBJECTIVE_VERBS = listOf(
        "follow", "mount", "dismount", "hunt", "pick up", "cook", "view", "use", "hold", "press", "tap",
        "switch to", "tear down", "return to", "ride to", "go to", "head to", "get to", "get on", "collect",
        "skin", "loot", "kill", "exit", "craft", "equip", "lasso", "hogtie", "track", "escape", "defend",
        "search", "investigate", "locate", "deliver", "sell", "wait for", "approach", "catch", "rob",
        "take cover", "set up", "make camp", "feed", "brush", "lead", "protect", "enter",
    ).joinToString("|") { it.replace(" ", """\s+""") }

    private val OBJECTIVE_START = Regex("""^\s*[^\p{L}]*(?:$OBJECTIVE_VERBS)\b""", RegexOption.IGNORE_CASE)
    private val SENTENCE_PUNCT = Regex("""[,.?!…]""")
    private const val MAX_OBJECTIVE_WORDS = 5

    /** Menü / tekerlek adları ve OCR'ın tuş simgelerini okuduğu "@" işareti. */
    private val HUD_MARKERS = listOf(Regex("""\b(menu|wheel)\b""", RegexOption.IGNORE_CASE), Regex("@"))

    fun isObjectiveText(line: String): Boolean {
        val words = line.trim().split(Regex("""\s+""")).filter { it.isNotEmpty() }
        return words.isNotEmpty() &&
            words.size <= MAX_OBJECTIVE_WORDS &&
            !SENTENCE_PUNCT.containsMatchIn(line) &&
            OBJECTIVE_START.containsMatchIn(line)
    }

    fun isUiText(line: String): Boolean =
        PATTERNS.any { it.containsMatchIn(line) } ||
            HUD_MARKERS.any { it.containsMatchIn(line) } ||
            isObjectiveText(line)

    /** Görev yazısı altyazıyla aynı satırda okunduysa cümle sonundan sonrasını kırpar ("Got one! Pick up the rabbit"). */
    private val TRAILING_OBJECTIVE =
        Regex("""^(.*[.?!…])\s+(?:$OBJECTIVE_VERBS)\b[^,.?!…]{0,40}$""", RegexOption.IGNORE_CASE)

    fun stripTrailingObjective(text: String): String {
        val m = TRAILING_OBJECTIVE.find(text) ?: return text
        val kept = m.groupValues[1].trim()
        return kept.ifEmpty { text }
    }

    private val LEADING_DOT = Regex("""^\.(?!\.)\s*""")
    private val LEADING_JUNK = Regex("""^[\s•·*,;:—–\-_|~]+(?=\S)""")
    private val LEADING_STRAY_LETTER = Regex("""^[B-HJ-NP-Zb-z]\s+(?=\p{Lu})""")
    private val TRAILING_STRAY_LETTER = Regex("""(?<=[\p{L}.?!…,])\s+[B-HJ-NP-Zb-z]$""")
    private val TRAILING_DASH = Regex("""\s*[—–\-_|]+$""")

    /** Altyazı metninin başındaki/sonundaki OCR kırıntılarını temizler ("• How's", "...says... L"). */
    fun cleanSubtitleText(text: String): String =
        text.trim()
            .replace(LEADING_DOT, "")
            .replace(LEADING_JUNK, "")
            .replace(LEADING_STRAY_LETTER, "")
            .replace(TRAILING_DASH, "")
            .replace(TRAILING_STRAY_LETTER, "")
            .trim()
}
