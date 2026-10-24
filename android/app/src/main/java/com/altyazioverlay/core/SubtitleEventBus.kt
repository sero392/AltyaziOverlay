package com.altyazioverlay.core

import java.util.concurrent.CopyOnWriteArraySet

/** OCR hattından çıkan, değişmiş ve kararlı hale gelmiş tek bir altyazı. */
data class SubtitleEvent(
    /** Ham OCR metni. Boş string = altyazı ekrandan kalktı. */
    val text: String,
    val frameId: Long,
    val ocrLatencyMs: Long,
    val timestampMs: Long,
)

/**
 * Servis (üretici) ile React Native modülü (tüketici) arasındaki süreç içi olay yolu.
 *
 * Servis RN'den habersizdir; RN bağlamı yeniden yüklense bile servis çalışmaya devam eder.
 * Dinleyiciler çağıran thread'de (yakalama thread'i) tetiklenir — tüketici hafif kalmalı.
 */
object SubtitleEventBus {

    interface Listener {
        fun onSubtitle(event: SubtitleEvent)
        fun onCaptureStateChanged(running: Boolean, error: String?)
    }

    private val listeners = CopyOnWriteArraySet<Listener>()

    fun register(listener: Listener) {
        listeners.add(listener)
    }

    fun unregister(listener: Listener) {
        listeners.remove(listener)
    }

    fun publishSubtitle(event: SubtitleEvent) {
        listeners.forEach { it.onSubtitle(event) }
    }

    fun publishState(running: Boolean, error: String? = null) {
        listeners.forEach { it.onCaptureStateChanged(running, error) }
    }
}
