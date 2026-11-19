package com.altyazioverlay.tv

/**
 * Telefon <-> TV protokolü. Telefon uygulamasındaki TvLink ile aynı sabitleri kullanır.
 *
 * TCP üzerinden satır satır JSON (UTF-8, her mesaj "\n" ile biter):
 *   {"t":"hello","name":"Redmi Note 10S"}
 *   {"t":"sub","text":"Dikkat et!"}      // boş text = altyazıyı gizle
 *   {"t":"sub","text":"...","box":{"x":0.27,"y":0.78,"w":0.47,"h":0.09}}
 *                                         // isteğe bağlı: İngilizce altyazının karedeki yeri (0-1)
 *   {"t":"page","items":[{"text":"Devam et","box":{"x":0.05,"y":0.27,"w":0.08,"h":0.03}}]}
 *                                         // tüm sayfa çevirisi: her çeviri kendi kutusunda; boş dizi = temizle
 *   {"t":"style","fontSize":30,"textColor":"#FFFFFF","bgColor":"#000000","bgOpacity":75}
 *   {"t":"ping"}                          // bağlantı canlı tutma
 */
/** İngilizce altyazının görüntü karesindeki yeri; 0-1 aralığında, sol üst köşe + boyut. */
data class SubtitleBox(val x: Float, val y: Float, val w: Float, val h: Float) {
    companion object {
        fun fromJson(o: org.json.JSONObject?): SubtitleBox? {
            o ?: return null
            val b = SubtitleBox(
                o.optDouble("x", -1.0).toFloat(),
                o.optDouble("y", -1.0).toFloat(),
                o.optDouble("w", -1.0).toFloat(),
                o.optDouble("h", -1.0).toFloat(),
            )
            val valid = b.x >= 0f && b.y >= 0f && b.w > 0f && b.h > 0f && b.x + b.w <= 1.01f && b.y + b.h <= 1.01f
            return if (valid) b else null
        }
    }
}

object Protocol {
    const val PORT = 47800
    const val SERVICE_TYPE = "_altyazi._tcp."
}
