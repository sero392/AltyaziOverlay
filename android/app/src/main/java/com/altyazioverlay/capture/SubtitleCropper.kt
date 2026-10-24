package com.altyazioverlay.capture

import android.graphics.Bitmap
import android.media.Image

/**
 * Kırpılmış alt bölge. [bitmap] yeniden kullanılır — tüketici işi bitene kadar
 * bir sonraki kare üretilmez (bkz. [FrameSink.isReady]).
 *
 * [bitmap] genişliği, satır hizalaması (row padding) yüzünden [contentWidth]'ten
 * birkaç piksel büyük olabilir; sağdaki fazlalık siyahtır ve OCR'ı etkilemez.
 */
class CroppedFrame(
    val bitmap: Bitmap,
    val contentWidth: Int,
    val contentHeight: Int,
)

/**
 * Ekranın sadece alt [cropRatio] kısmını Bitmap'e kopyalar.
 *
 * Optimizasyon: Önce tam ekran Bitmap üretip sonra createBitmap(...) ile kırpmak yerine,
 * ImageReader'ın ham RGBA buffer'ında doğrudan kırpma satırına atlanır ve SADECE alt
 * satırlar kopyalanır. Böylece:
 *  - Her karede tam ekran (ör. 1920x1080x4 = ~8MB) ara Bitmap tahsis edilmez,
 *  - Kopyalanan bayt ~%80 azalır,
 *  - Tek bir Bitmap tekrar tekrar kullanılır (GC baskısı yok).
 */
class SubtitleCropper(private val cropRatio: Float) {

    private var reusable: Bitmap? = null

    fun crop(image: Image): CroppedFrame? {
        val plane = image.planes.firstOrNull() ?: return null
        val pixelStride = plane.pixelStride          // RGBA_8888 için 4
        val rowStride = plane.rowStride              // >= width * pixelStride
        val width = image.width
        val height = image.height

        val cropTop = (height * (1f - cropRatio)).toInt().coerceIn(0, height - 1)
        val rowPadding = rowStride - pixelStride * width
        // Son satırda padding bulunmayabilir; buffer taşmasını önlemek için bir satır eksik al.
        val cropHeight = (height - cropTop) - if (rowPadding > 0) 1 else 0
        if (cropHeight <= 0) return null

        val bufferWidth = rowStride / pixelStride
        val bitmap = obtainBitmap(bufferWidth, cropHeight)

        val buffer = plane.buffer
        buffer.rewind()
        buffer.position(cropTop * rowStride)
        bitmap.copyPixelsFromBuffer(buffer)

        return CroppedFrame(bitmap, width, cropHeight)
    }

    /**
     * Tampon tamamen boş mu (tüm örnek piksellerde alfa = 0)? Ekrana çizilen gerçek
     * içerik her zaman opaktır; boş tampon bileşimin başarısız olduğunu gösterir.
     * 8x4 = 32 noktadan örnekler, kare başına maliyeti ihmal edilebilir.
     */
    fun isTransparent(frame: CroppedFrame): Boolean {
        val bmp = frame.bitmap
        for (gy in 0 until 4) {
            val y = (frame.contentHeight * (2 * gy + 1)) / 8
            for (gx in 0 until 8) {
                val x = (frame.contentWidth * (2 * gx + 1)) / 16
                if ((bmp.getPixel(x, y) ushr 24) != 0) return false
            }
        }
        return true
    }

    private fun obtainBitmap(w: Int, h: Int): Bitmap {
        val current = reusable
        if (current != null && !current.isRecycled && current.width == w && current.height == h) {
            return current
        }
        current?.recycle()
        return Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).also { reusable = it }
    }

    fun release() {
        reusable?.recycle()
        reusable = null
    }
}
