package com.altyazioverlay.bridge

import com.altyazioverlay.capture.ReadRegion
import com.altyazioverlay.service.CaptureConfig
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap

/** JS'ten gelen yakalama seçenekleri -> [CaptureConfig] (sınırları fromBundle uygular). */
internal fun ReadableMap?.toCaptureConfig(): CaptureConfig {
    val d = CaptureConfig()
    if (this == null) return d
    val map = this
    fun num(key: String) = if (map.hasKey(key) && !map.isNull(key)) map.getDouble(key) else null
    val raw = CaptureConfig(
        intervalMs = num("intervalMs")?.toLong() ?: d.intervalMs,
        regions = readRegions(map) ?: d.regions,
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

/**
 * "regions": [{x, y, w, h}] (0-1 oranlar). Eski istemciler için "cropRatio" (alt şerit) de kabul edilir.
 */
private fun readRegions(map: ReadableMap): List<ReadRegion>? {
    if (map.hasKey("regions") && !map.isNull("regions")) {
        return map.getArray("regions")?.toReadRegions()
    }
    if (map.hasKey("cropRatio") && !map.isNull("cropRatio")) {
        val r = map.getDouble("cropRatio").toFloat().coerceIn(0.05f, 0.6f)
        return listOf(ReadRegion(0f, 1f - r, 1f, r))
    }
    return null
}

internal fun ReadableArray.toReadRegions(): List<ReadRegion> =
    ReadRegion.sanitize(
        (0 until size()).mapNotNull { i ->
            val m = getMap(i) ?: return@mapNotNull null
            fun f(k: String) = if (m.hasKey(k) && !m.isNull(k)) m.getDouble(k).toFloat() else Float.NaN
            ReadRegion(f("x"), f("y"), f("w"), f("h"))
        },
    )
