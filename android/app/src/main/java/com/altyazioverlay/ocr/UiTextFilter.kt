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

    fun isUiText(line: String): Boolean = PATTERNS.any { it.containsMatchIn(line) }
}
