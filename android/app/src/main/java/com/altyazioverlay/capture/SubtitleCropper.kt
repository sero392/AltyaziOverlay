package com.altyazioverlay.capture

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Rect
import android.media.Image

/**
 * OCR'a verilen kare: seçili okuma alanları (bkz. [RegionLayout]). [bitmap] yeniden
 * kullanılır — tüketici işi bitene kadar bir sonraki kare üretilmez (bkz. [FrameSink.isReady]).
 *
 * [bitmap] genişliği, satır hizalaması (row padding) yüzünden [contentWidth]'ten
 * birkaç piksel büyük olabilir; sağdaki fazlalık siyahtır ve OCR'ı etkilemez.
 *
 * [sourceWidth] / [sourceHeight]: alanların kesildiği tam karenin boyutu (aynı ölçekte).
 * OCR filtreleri (minimum satır yüksekliği, ortalama) ekrana göre sabit kalsın diye.
 */
class CroppedFrame(
    val bitmap: Bitmap,
    val contentWidth: Int,
    val contentHeight: Int,
    val sourceWidth: Int,
    val sourceHeight: Int,
    /** Birleşik karedeki okuma alanı şeritleri (aynı ölçekte). Boşsa kare tek alan sayılır. */
    val bands: List<RegionBand> = emptyList(),
)

/**
 * Birleşik karede bir okuma alanının kapladığı dikey şerit.
 * @param top / bottom Birleşik karedeki y aralığı.
 * @param width Alanın genişliği (ortalama filtresi: alan ekranı tam kaplıyor mu).
 * @param screenTop Alanın ekrandaki üst kenarı: altyazı en alttaki alanda aranır önce.
 */
data class RegionBand(val top: Int, val bottom: Int, val width: Int, val screenTop: Int)

/**
 * Ekran yakalamada (MediaProjection) okuma alanlarını Bitmap'e kopyalar.
 *
 * Optimizasyon: tam ekran Bitmap üretilmez. ImageReader'ın ham RGBA buffer'ında alanları
 * kapsayan satır şeridine atlanır ve SADECE o satırlar kopyalanır; tek bir Bitmap tekrar
 * tekrar kullanılır (GC baskısı yok). Alanlar [RegionLayout]'a göre (kenar dolgusuyla)
 * ikinci bir Bitmap'te birleştirilir.
 */
class SubtitleCropper(private val regions: List<ReadRegion>) {

    private var band: Bitmap? = null
    private var composed: Bitmap? = null
    private var layout: RegionLayout? = null
    private val canvas = Canvas()
    private val src = Rect()
    private val dst = Rect()

    /** Son [crop] çağrısındaki şerit tamamen boş muydu (bkz. [isTransparent]). */
    private var lastBandTransparent = false

    fun crop(image: Image): CroppedFrame? {
        val plane = image.planes.firstOrNull() ?: return null
        val pixelStride = plane.pixelStride          // RGBA_8888 için 4
        val rowStride = plane.rowStride              // >= width * pixelStride
        val width = image.width
        val height = image.height

        val l = layout?.takeIf { it.sourceWidth == width && it.sourceHeight == height }
            ?: RegionLayout(regions, width, height).also { layout = it }

        val bandTop = l.sources.minOf { it.top }
        val rowPadding = rowStride - pixelStride * width
        // Son satırda padding bulunmayabilir; buffer taşmasını önlemek için bir satır eksik al.
        val bandBottom = minOf(l.sources.maxOf { it.bottom }, height - if (rowPadding > 0) 1 else 0)
        val bandHeight = bandBottom - bandTop
        if (bandHeight <= 0) return null

        val bufferWidth = rowStride / pixelStride
        val bandBmp = obtain(band, bufferWidth, bandHeight).also { band = it }

        val buffer = plane.buffer
        buffer.rewind()
        buffer.position(bandTop * rowStride)
        buffer.limit(minOf(buffer.capacity(), bandBottom * rowStride))
        bandBmp.copyPixelsFromBuffer(buffer)
        buffer.limit(buffer.capacity())
        lastBandTransparent = isBlank(bandBmp, width, bandHeight)

        // Tam genişlikte tek şerit bile birleşik kareye kopyalanır: kenar dolgusu ([RegionLayout]) OCR için gerekli.
        val out = obtain(composed, l.width, l.height).also { composed = it }
        out.eraseColor(Color.BLACK)
        canvas.setBitmap(out)
        l.sources.forEachIndexed { i, r ->
            src.set(r.left, r.top - bandTop, r.right, minOf(r.bottom, bandBottom) - bandTop)
            dst.set(l.offsetsX[i], l.offsetsY[i], l.offsetsX[i] + src.width(), l.offsetsY[i] + src.height())
            canvas.drawBitmap(bandBmp, src, dst, null)
        }
        canvas.setBitmap(null)
        return CroppedFrame(out, l.width, l.height, width, height, l.bands(1))
    }

    /**
     * Tampon tamamen boş mu (tüm örnek piksellerde alfa = 0)? Ekrana çizilen gerçek
     * içerik her zaman opaktır; boş tampon bileşimin başarısız olduğunu gösterir.
     */
    @Suppress("UNUSED_PARAMETER")
    fun isTransparent(frame: CroppedFrame): Boolean = lastBandTransparent

    /** 8x4 = 32 noktadan örnekler, kare başına maliyeti ihmal edilebilir. */
    private fun isBlank(bmp: Bitmap, w: Int, h: Int): Boolean {
        for (gy in 0 until 4) {
            val y = (h * (2 * gy + 1)) / 8
            for (gx in 0 until 8) {
                val x = (w * (2 * gx + 1)) / 16
                if ((bmp.getPixel(x, y) ushr 24) != 0) return false
            }
        }
        return true
    }

    private fun obtain(current: Bitmap?, w: Int, h: Int): Bitmap {
        if (current != null && !current.isRecycled && current.width == w && current.height == h) {
            return current
        }
        current?.recycle()
        return Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    }

    fun release() {
        band?.recycle()
        band = null
        composed?.recycle()
        composed = null
    }
}
