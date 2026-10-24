package com.altyazioverlay.core

import android.content.Context
import android.graphics.Color
import org.json.JSONObject

/**
 * Altyazının görünümü (JS'teki useSubtitleStyle ile aynı alanlar). Telefondaki yüzen pencereye
 * uygulanır ve TV'ye "style" mesajıyla gider.
 *
 * @param fontSize TV'deki yazı boyutu (sp). Telefon penceresi bunun 2/3'ünü kullanır.
 * @param bgOpacity Arka plan opaklığı, 0-100.
 */
data class SubtitleStyle(
    val fontSize: Float = 30f,
    val textColor: String = "#FFFFFF",
    val bgColor: String = "#000000",
    val bgOpacity: Int = 75,
) {
    val textColorInt: Int get() = parseColor(textColor, Color.WHITE)

    val bgColorInt: Int
        get() {
            val c = parseColor(bgColor, Color.BLACK)
            return Color.argb(bgOpacity * 255 / 100, Color.red(c), Color.green(c), Color.blue(c))
        }

    fun toJson(): JSONObject = JSONObject()
        .put("fontSize", fontSize.toDouble())
        .put("textColor", textColor)
        .put("bgColor", bgColor)
        .put("bgOpacity", bgOpacity)

    companion object {
        const val PREF_KEY = "subtitle_style"
        private const val PREFS_NAME = "altyazi_settings"

        /** Son uygulanan stil. Servisler pencereyi açarken bunu kullanır. */
        @Volatile
        var current: SubtitleStyle = SubtitleStyle()

        /** Hatalı / eksik alanlar varsayılana düşer. */
        fun fromJson(json: String?): SubtitleStyle {
            val o = json?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return SubtitleStyle()
            val d = SubtitleStyle()
            return SubtitleStyle(
                fontSize = o.optDouble("fontSize", d.fontSize.toDouble()).toFloat().coerceIn(12f, 72f),
                textColor = o.optString("textColor", d.textColor),
                bgColor = o.optString("bgColor", d.bgColor),
                bgOpacity = o.optInt("bgOpacity", d.bgOpacity).coerceIn(0, 100),
            )
        }

        fun load(context: Context) {
            val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            current = fromJson(prefs.getString(PREF_KEY, null))
        }

        private fun parseColor(hex: String, fallback: Int): Int =
            runCatching { Color.parseColor(hex) }.getOrDefault(fallback)
    }
}
