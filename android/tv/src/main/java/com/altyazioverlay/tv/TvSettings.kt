package com.altyazioverlay.tv

import android.content.Context

/** TV tarafı görünüm ayarları (kumanda ile ana ekrandan değiştirilir). */
class TvSettings(context: Context) {

    enum class Position(val label: String) { BOTTOM("Altta"), MIDDLE_LOW("Alt-orta"), TOP("Üstte") }

    enum class TextSize(val label: String, val sp: Float) {
        SMALL("Küçük", 24f), MEDIUM("Orta", 30f), LARGE("Büyük", 38f)
    }

    private val prefs = context.applicationContext.getSharedPreferences("tv_settings", Context.MODE_PRIVATE)

    var position: Position
        get() = enumValueOrDefault(prefs.getString(KEY_POSITION, null), Position.BOTTOM)
        set(value) = prefs.edit().putString(KEY_POSITION, value.name).apply()

    var textSize: TextSize
        get() = enumValueOrDefault(prefs.getString(KEY_SIZE, null), TextSize.MEDIUM)
        set(value) = prefs.edit().putString(KEY_SIZE, value.name).apply()

    private inline fun <reified T : Enum<T>> enumValueOrDefault(name: String?, default: T): T =
        enumValues<T>().firstOrNull { it.name == name } ?: default

    companion object {
        private const val KEY_POSITION = "position"
        private const val KEY_SIZE = "text_size"
    }
}
