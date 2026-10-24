package com.altyazioverlay.tv

import android.content.Context
import android.graphics.Color
import org.json.JSONObject

/**
 * TV tarafı görünüm ayarları. Konum kumanda ile ana ekrandan, yazı boyutu ve renkler
 * telefondan ("style" mesajı) değiştirilir.
 */
class TvSettings(context: Context) {

    enum class Position(val label: String) { BOTTOM("Altta"), MIDDLE_LOW("Alt-orta"), TOP("Üstte") }

    /** Telefondaki altyazı görünümü (telefondaki SubtitleStyle ile aynı alanlar). */
    data class Style(
        val fontSize: Float = 30f,
        val textColor: Int = Color.WHITE,
        val bgColor: Int = Color.argb(190, 0, 0, 0),
    ) {
        companion object {
            fun fromJson(o: JSONObject): Style {
                val d = Style()
                val bg = parseColor(o.optString("bgColor"), Color.BLACK)
                val opacity = o.optInt("bgOpacity", 75).coerceIn(0, 100)
                return Style(
                    fontSize = o.optDouble("fontSize", d.fontSize.toDouble()).toFloat().coerceIn(12f, 72f),
                    textColor = parseColor(o.optString("textColor"), d.textColor),
                    bgColor = Color.argb(opacity * 255 / 100, Color.red(bg), Color.green(bg), Color.blue(bg)),
                )
            }

            private fun parseColor(hex: String, fallback: Int): Int =
                runCatching { Color.parseColor(hex) }.getOrDefault(fallback)
        }
    }

    private val prefs = context.applicationContext.getSharedPreferences("tv_settings", Context.MODE_PRIVATE)

    var position: Position
        get() = enumValueOrDefault(prefs.getString(KEY_POSITION, null), Position.BOTTOM)
        set(value) = prefs.edit().putString(KEY_POSITION, value.name).apply()

    /** Telefondan gelen son stil; hiç gelmediyse varsayılan. */
    val style: Style
        get() = prefs.getString(KEY_STYLE, null)
            ?.let { runCatching { Style.fromJson(JSONObject(it)) }.getOrNull() }
            ?: Style()

    fun saveStyle(json: JSONObject) = prefs.edit().putString(KEY_STYLE, json.toString()).apply()

    private inline fun <reified T : Enum<T>> enumValueOrDefault(name: String?, default: T): T =
        enumValues<T>().firstOrNull { it.name == name } ?: default

    companion object {
        private const val KEY_POSITION = "position"
        private const val KEY_STYLE = "style"
    }
}
