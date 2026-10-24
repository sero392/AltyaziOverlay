package com.altyazioverlay.core

/**
 * Yakalamanın o an işlenip işlenmeyeceğine karar veren paylaşılan durum.
 *
 * Kendi uygulamamız öndeyken (Başlat'a basıp oyuna geçene kadar) ekranda bizim
 * arayüzümüz var; onu OCR'lamak gereksiz çeviri üretir. RN modülü Activity
 * yaşam döngüsünü buraya yazar, yakalama hattı kareleri buna göre atlar.
 */
object CaptureGate {

    @Volatile
    var hostAppInForeground: Boolean = false

    val isPaused: Boolean
        get() = hostAppInForeground
}
