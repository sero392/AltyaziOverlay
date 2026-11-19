package com.altyazioverlay.capture

import android.graphics.Bitmap
import android.media.Image
import java.io.File

/**
 * Okuma alanı kurulumu için yayından tek bir renkli kare. Çözücüden gelen YUV_420_888
 * görüntü kopyalanır ([capture], çözücü thread'inde hızlı), JPEG'e çevirme ise ayrı
 * thread'de yapılır ([save]).
 */
class FrameSnapshot private constructor(val width: Int, val height: Int, private val argb: IntArray) {

    fun save(file: File): File {
        file.parentFile?.mkdirs()
        val bmp = Bitmap.createBitmap(argb, width, height, Bitmap.Config.ARGB_8888)
        try {
            file.outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 85, it) }
        } finally {
            bmp.recycle()
        }
        return file
    }

    companion object {
        /** [image] çağrı bitince kapanabilir; referans tutulmaz. */
        fun capture(image: Image): FrameSnapshot {
            val crop = image.cropRect
            val w = crop.width()
            val h = crop.height()
            val out = IntArray(w * h)
            val yp = image.planes[0]
            if (image.planes.size < 3) {
                // Beklenmeyen biçim: sadece parlaklık (gri).
                for (y in 0 until h) for (x in 0 until w) {
                    val v = yp.buffer.get((crop.top + y) * yp.rowStride + (crop.left + x) * yp.pixelStride).toInt() and 0xFF
                    out[y * w + x] = (0xFF shl 24) or (v shl 16) or (v shl 8) or v
                }
                return FrameSnapshot(w, h, out)
            }
            val up = image.planes[1]
            val vp = image.planes[2]
            val yb = yp.buffer
            val ub = up.buffer
            val vb = vp.buffer
            for (y in 0 until h) {
                val sy = crop.top + y
                val yRow = sy * yp.rowStride
                val uRow = (sy / 2) * up.rowStride
                val vRow = (sy / 2) * vp.rowStride
                for (x in 0 until w) {
                    val sx = crop.left + x
                    val yy = (yb.get(yRow + sx * yp.pixelStride).toInt() and 0xFF) - 16
                    val u = (ub.get(uRow + (sx / 2) * up.pixelStride).toInt() and 0xFF) - 128
                    val v = (vb.get(vRow + (sx / 2) * vp.pixelStride).toInt() and 0xFF) - 128
                    // BT.601 (video aralığı), tamsayı yaklaşımı.
                    val c = 1192 * maxOf(yy, 0)
                    val r = ((c + 1634 * v) shr 10).coerceIn(0, 255)
                    val g = ((c - 833 * v - 400 * u) shr 10).coerceIn(0, 255)
                    val b = ((c + 2066 * u) shr 10).coerceIn(0, 255)
                    out[y * w + x] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
                }
            }
            return FrameSnapshot(w, h, out)
        }
    }
}
