package com.altyazioverlay.ocr

import com.altyazioverlay.ocr.SubtitleHeuristics.RegionLines
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Sahneler 21.11.2026 testinin kayıtlarından (OcrDiag logları + kaydedilen kareler): metinler
 * OCR'ın okuduğu haliyle, konumlar karelerdeki 4 okuma alanının yerleşiminden.
 * Alan sırası ekranda yukarıdan aşağı; en alttaki (screenTop en büyük) altyazı alanı.
 */
class SubtitleHeuristicsTest {

    private fun line(text: String, top: Int, height: Int = 24) = OcrLine(text, top, top + height)

    /** 4 alanlı kurulum: üst, orta, sağ-orta (düğme / telefon), alt (altyazı). */
    private fun scene(
        top: List<OcrLine> = emptyList(),
        middle: List<OcrLine> = emptyList(),
        right: List<OcrLine> = emptyList(),
        bottom: List<OcrLine> = emptyList(),
    ) = SubtitleHeuristics.selectFromRegions(
        listOf(
            RegionLines(screenTop = 40, lines = top),
            RegionLines(screenTop = 260, lines = middle),
            RegionLines(screenTop = 420, lines = right),
            RegionLines(screenTop = 600, lines = bottom),
        ),
    ).text

    @Test
    fun soygun_secenekler_ve_tabela_altyaziyi_gotirmez() {
        val text = scene(
            top = listOf(line("WE BUY", 140)),
            right = listOf(line("THREATEN O", 745), line("STAFF MEMBER)", 790)),
            bottom = listOf(line("Both of you, on the ground", 965)),
        )
        assertEquals("Both of you, on the ground", text)
    }

    @Test
    fun moses_telefon_tarama_ekrani_altyaziyi_gotirmez() {
        val phone = listOf("ACCESS", "SECURITY", "TRACKER", "COST TO REGISTER", "LOCKEDP", "ALARMED", "NONE", "BACK O")
            .mapIndexed { i, t -> line(t, 610 + i * 28) }
        val text = scene(right = phone, bottom = listOf(line("Alright. What about the next one?", 960)))
        assertEquals("Alright. What about the next one?", text)
    }

    @Test
    fun zach_diyalog_secenekleri_altyaziyi_gotirmez() {
        val text = scene(
            right = listOf(line("QUESTION", 710), line("CONFRONT O", 745), line("ZACH )", 790)),
            bottom = listOf(line("Im Zach, youre Lucia and-", 965)),
        )
        assertEquals("Im Zach, youre Lucia and-", text)
    }

    @Test
    fun ayni_alanda_secenek_dugmeleri_atilir_altyazi_kalir() {
        val text = scene(
            bottom = listOf(
                line("PAINKILLERS? A", 880),
                line("ZACH", 915),
                line("I heard you talking to each other.", 965),
            ),
        )
        assertEquals("I heard you talking to each other.", text)
    }

    @Test
    fun alt_alanda_tisort_yazisi_atilir() {
        val text = scene(bottom = listOf(line("DON'T TRIP", 880), line("Both of you, on the ground.", 965)))
        assertEquals("Both of you, on the ground.", text)
    }

    @Test
    fun ustte_ipucu_kutusu_altta_altyazi_varsa_altyazi_secilir() {
        val text = scene(
            top = listOf(
                line("Approach anyone at the motel and", 60),
                line("hold to ask them about", 88),
                line("painkillers.", 116),
            ),
            bottom = listOf(line("What the heck is that?", 965)),
        )
        assertEquals("What the heck is that?", text)
    }

    @Test
    fun ayni_alanda_ustte_ipucu_altta_altyazi() {
        val text = scene(
            bottom = listOf(
                line("You can equip a mask from your", 870),
                line("loadout before a crime to conceal", 898),
                line("your identity", 926),
                line("What? Woah, plot twist.", 990),
            ),
        )
        assertEquals("What? Woah, plot twist.", text)
    }

    @Test
    fun iki_satirlik_altyazi_birlestirilir() {
        val text = scene(
            bottom = listOf(
                line("I gotta get you some painkillers. Real ones.", 930),
                line("Someone in this shithole's got to have drugs.", 958),
            ),
        )
        assertEquals("I gotta get you some painkillers. Real ones. Someone in this shithole's got to have drugs.", text)
    }

    @Test
    fun biraz_aralikli_iki_satir_da_birlestirilir() {
        val text = scene(bottom = listOf(line("Doesn't say it has a tracker on it,", 900), line("but it does have some kind of alarm.", 960)))
        assertEquals("Doesn't say it has a tracker on it, but it does have some kind of alarm.", text)
    }

    @Test
    fun yalniz_menu_varsa_bos() {
        assertEquals("", scene(bottom = listOf(line("UNARMED", 900), line("IN HAND", 940))))
        val stats = listOf("KLOSE K17", "SIDEARM", "ACCURACY", "HANDLING", "RANGE", "MODS", "DROP O", "KLOSE K17")
            .mapIndexed { i, t -> line(t, 610 + i * 28) }
        assertEquals("", scene(right = stats))
    }

    @Test
    fun ust_alanlarda_tabela_cevrilmez() {
        assertEquals("", scene(top = listOf(line("WE BUY", 100), line("GOLD, SILVER,", 130), line("JEWELRY,", 160))))
        // Mağaza tabelaları arasında tek cümle: üst alanda sıkı kural, menü sayılır.
        assertEquals(
            "",
            scene(middle = listOf(line("SAVID I", 300), line("*PARI", 340), line("Thanks again!", 380), line("LESS COMMUNICATION", 420))),
        )
    }

    @Test
    fun ust_alanda_tek_basina_cumle_cevrilir() {
        // Altyazı alanı boşken üstteki ipucu / görev metni yine çevrilir (eskisi gibi).
        assertEquals("Steal a vehicle for yourself and take it to Moses Watkins", scene(
            top = listOf(line("Steal a vehicle for yourself and take", 60), line("it to Moses Watkins", 88)),
        ))
    }

    @Test
    fun tek_kelime_noktalamasiz_atilir() {
        assertEquals("", scene(bottom = listOf(line("OST", 960))))
        assertEquals("Dunk?", scene(bottom = listOf(line("Dunk?", 960))))
    }

    @Test
    fun alt_alanda_cok_satirli_ipucu_cevrilmez() {
        val text = scene(
            bottom = listOf(
                line("Locked vehicles will need to be", 870),
                line("hotwired. Any that have an alarm", 898),
                line("will draw attention when", 926),
                line("you get inside them.", 954),
            ),
        )
        assertEquals("", text)
    }
}
