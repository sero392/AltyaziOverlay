package com.altyazioverlay.service

import android.os.Bundle
import com.altyazioverlay.capture.ReadRegion

/**
 * Yakalama hattının ayarları. JS tarafından gelir, Intent extra'sı olarak servise taşınır.
 */
data class CaptureConfig(
    /** İki OCR denemesi arasındaki minimum süre (ms). Saniyede ~2 kare altyazı için yeterli. */
    val intervalMs: Long = 500L,
    /** OCR'lanacak ekran alanları (oranlı). Kurulumda kullanıcı seçer; boşsa alt %20. */
    val regions: List<ReadRegion> = ReadRegion.DEFAULT,
    /** Sanal ekranın maksimum genişliği. OCR doğruluğu / bellek dengesi. */
    val maxCaptureWidth: Int = 1920,
    /** Aynı metnin kaç ardışık okumada görülünce yayınlanacağı (titreşimi engeller). */
    val stableFrames: Int = 2,
    /** Son yayınlanan metne bu orandan fazla benzeyen metinler yok sayılır. */
    val similarityThreshold: Float = 0.80f,
    /** Sadece yatay ekranda oku: oyun akışı yatay, ana ekran / menüler dikey. */
    val landscapeOnly: Boolean = true,
) {
    /**
     * Telefondaki yüzen pencerenin alttan yüksekliği (ekran oranı): en üstteki okuma alanının
     * hemen üstü, böylece pencere okunan altyazıyı örtmez.
     */
    val overlayBottomRatio: Float
        get() = (1f - regions.minOf { it.y }).coerceIn(0.05f, 0.6f)

    fun toBundle(): Bundle = Bundle().apply {
        putLong(KEY_INTERVAL, intervalMs)
        putFloatArray(KEY_REGIONS, ReadRegion.toFloatArray(regions))
        putInt(KEY_MAX_WIDTH, maxCaptureWidth)
        putInt(KEY_STABLE, stableFrames)
        putFloat(KEY_SIMILARITY, similarityThreshold)
        putBoolean(KEY_LANDSCAPE, landscapeOnly)
    }

    companion object {
        private const val KEY_INTERVAL = "intervalMs"
        private const val KEY_REGIONS = "regions"
        private const val KEY_MAX_WIDTH = "maxCaptureWidth"
        private const val KEY_STABLE = "stableFrames"
        private const val KEY_SIMILARITY = "similarityThreshold"
        private const val KEY_LANDSCAPE = "landscapeOnly"

        fun fromBundle(b: Bundle?): CaptureConfig {
            val d = CaptureConfig()
            if (b == null) return d
            return CaptureConfig(
                intervalMs = b.getLong(KEY_INTERVAL, d.intervalMs).coerceIn(150L, 5_000L),
                regions = ReadRegion.fromFloatArray(b.getFloatArray(KEY_REGIONS)),
                maxCaptureWidth = b.getInt(KEY_MAX_WIDTH, d.maxCaptureWidth).coerceIn(640, 3840),
                stableFrames = b.getInt(KEY_STABLE, d.stableFrames).coerceIn(1, 5),
                similarityThreshold = b.getFloat(KEY_SIMILARITY, d.similarityThreshold).coerceIn(0.5f, 1f),
                landscapeOnly = b.getBoolean(KEY_LANDSCAPE, d.landscapeOnly),
            )
        }
    }
}
