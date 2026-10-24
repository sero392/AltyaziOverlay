package com.altyazioverlay.bridge

import com.altyazioverlay.service.CaptureConfig
import com.facebook.react.bridge.ReadableMap

/** JS'ten gelen yakalama seçenekleri -> [CaptureConfig] (sınırları fromBundle uygular). */
internal fun ReadableMap?.toCaptureConfig(): CaptureConfig {
    val d = CaptureConfig()
    if (this == null) return d
    val map = this
    fun num(key: String) = if (map.hasKey(key) && !map.isNull(key)) map.getDouble(key) else null
    val raw = CaptureConfig(
        intervalMs = num("intervalMs")?.toLong() ?: d.intervalMs,
        cropRatio = num("cropRatio")?.toFloat() ?: d.cropRatio,
        maxCaptureWidth = num("maxCaptureWidth")?.toInt() ?: d.maxCaptureWidth,
        stableFrames = num("stableFrames")?.toInt() ?: d.stableFrames,
        similarityThreshold = num("similarityThreshold")?.toFloat() ?: d.similarityThreshold,
        landscapeOnly = if (map.hasKey("landscapeOnly") && !map.isNull("landscapeOnly")) {
            map.getBoolean("landscapeOnly")
        } else {
            d.landscapeOnly
        },
    )
    // fromBundle sınırları (coerceIn) uygular.
    return CaptureConfig.fromBundle(raw.toBundle())
}
