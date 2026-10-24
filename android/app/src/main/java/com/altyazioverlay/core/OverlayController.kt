package com.altyazioverlay.core

import com.altyazioverlay.overlay.FloatingSubtitleWindow

/**
 * JS -> çeviri hedefleri yönü: telefondaki yüzen pencere ve/veya TV ([TvLink]).
 * Servis pencereyi bağlar, RN modülü sadece metin gönderir.
 * Pencere yoksa (servis kapalı) telefon tarafı sessizce düşer; TV'ye yine gider
 * (servisi başlatmadan "Sahte altyazı" ile TV'yi denemek için).
 */
object OverlayController {

    @Volatile
    private var window: FloatingSubtitleWindow? = null

    /** Çeviri telefondaki yüzen pencerede gösterilsin mi? */
    @Volatile
    var showOnPhone: Boolean = true
        set(value) {
            field = value
            if (!value) window?.setText("")
        }

    /** Çeviri TV'ye gönderilsin mi? */
    @Volatile
    var sendToTv: Boolean = false
        set(value) {
            field = value
            if (!value) TvLink.sendSubtitle("")
        }

    fun attach(window: FloatingSubtitleWindow) {
        this.window = window
    }

    fun detach(window: FloatingSubtitleWindow) {
        if (this.window === window) this.window = null
    }

    fun showText(text: String) {
        if (showOnPhone) window?.setText(text)
        if (sendToTv) TvLink.sendSubtitle(text)
    }

    val isAttached: Boolean
        get() = window != null
}
