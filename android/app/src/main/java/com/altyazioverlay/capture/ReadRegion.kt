package com.altyazioverlay.capture

import android.graphics.Rect

/**
 * Ekranda OCR'lanacak bir dikdörtgen. Koordinatlar ekran boyutuna oranlıdır (0-1), böylece
 * yayın çözünürlüğü (720p / 1080p) değişse de alan kaymaz.
 */
data class ReadRegion(val x: Float, val y: Float, val w: Float, val h: Float) {

    /** [width]x[height] karede piksel dikdörtgeni (en az 1 piksel, kare içinde). */
    fun toRect(width: Int, height: Int): Rect {
        val left = (x * width).toInt().coerceIn(0, width - 1)
        val top = (y * height).toInt().coerceIn(0, height - 1)
        val right = ((x + w) * width).toInt().coerceIn(left + 1, width)
        val bottom = ((y + h) * height).toInt().coerceIn(top + 1, height)
        return Rect(left, top, right, bottom)
    }

    companion object {
        /** Kurulum yapılmadıysa: ekranın alt %20'si. */
        val DEFAULT: List<ReadRegion> = listOf(ReadRegion(0f, 0.8f, 1f, 0.2f))

        const val MAX_REGIONS = 4
        private const val MIN_SIZE = 0.02f

        /** Sınırları uygular, çok küçükleri atar, yukarıdan aşağı sıralar. Boşsa [DEFAULT]. */
        fun sanitize(list: List<ReadRegion>): List<ReadRegion> {
            val clean = list.mapNotNull { r ->
                if (r.x.isNaN() || r.y.isNaN() || r.w.isNaN() || r.h.isNaN()) return@mapNotNull null
                val x = r.x.coerceIn(0f, 1f)
                val y = r.y.coerceIn(0f, 1f)
                val w = r.w.coerceIn(0f, 1f - x)
                val h = r.h.coerceIn(0f, 1f - y)
                if (w < MIN_SIZE || h < MIN_SIZE) null else ReadRegion(x, y, w, h)
            }
                .take(MAX_REGIONS)
                .sortedWith(compareBy({ it.y }, { it.x }))
            return clean.ifEmpty { DEFAULT }
        }

        fun toFloatArray(list: List<ReadRegion>): FloatArray =
            list.flatMap { listOf(it.x, it.y, it.w, it.h) }.toFloatArray()

        fun fromFloatArray(a: FloatArray?): List<ReadRegion> {
            if (a == null) return DEFAULT
            return sanitize((0 until a.size / 4).map { i -> ReadRegion(a[i * 4], a[i * 4 + 1], a[i * 4 + 2], a[i * 4 + 3]) })
        }
    }
}

/**
 * Seçili alanların OCR karesine yerleşimi: alanlar alt alta, her biri yatayda ortalanarak
 * tek bir görüntüde birleştirilir (tek OCR çağrısı). Aralarına boşluk konur ki farklı
 * alanların satırları tek altyazı gibi birleşmesin.
 */
class RegionLayout(val regions: List<ReadRegion>, val sourceWidth: Int, val sourceHeight: Int) {
    /** Kaynak karedeki dikdörtgenler. */
    val sources: List<Rect> = regions.map { it.toRect(sourceWidth, sourceHeight) }
    val width: Int = sources.maxOf { it.width() }
    private val gap: Int = maxOf(24, sourceHeight / 20)
    /** Birleşik karedeki sol üst köşeler (x, y). */
    val offsetsX: IntArray = IntArray(sources.size) { (width - sources[it].width()) / 2 }
    val offsetsY: IntArray
    val height: Int

    init {
        var y = 0
        offsetsY = IntArray(sources.size) { i ->
            val top = y
            y += sources[i].height() + gap
            top
        }
        height = y - gap
    }
}
