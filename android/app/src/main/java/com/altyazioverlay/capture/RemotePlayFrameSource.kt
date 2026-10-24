package com.altyazioverlay.capture

import android.graphics.Bitmap
import android.media.Image
import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.os.SystemClock
import com.altyazioverlay.service.CaptureConfig
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Remote Play yayınından (çözülmüş YUV kareler) OCR hattına kare kaynağı.
 * [ScreenCaptureManager]'ın yayın karşılığı: aynı [FrameSink] arayüzünü besler, böylece OCR,
 * diff, filtreler, çeviri ve TV bağlantısı değişmeden kalır.
 *
 * - Kareler çözücü thread'inden gelir; [Image] çağrı bitince kapanır. Bu yüzden sadece alt
 *   [CaptureConfig.cropRatio] kısmın parlaklık (Y) satırları hızlıca bir tampona kopyalanır,
 *   OCR işi yakalama thread'ine devredilir. Gri görüntü OCR için yeterli; renk dönüşümü yok.
 * - Kısma ve backpressure ekran yakalamadakiyle aynı: aralık dolmadan veya OCR meşgulken
 *   gelen kareler hiç kopyalanmaz.
 */
class RemotePlayFrameSource(private val config: CaptureConfig) {

    private val thread = HandlerThread("RemotePlayOcr", Process.THREAD_PRIORITY_BACKGROUND).apply { start() }
    private val handler = Handler(thread.looper)

    /** ML Kit callback'leri de aynı thread'e -> hat tek thread'li ve kilitsiz. */
    val callbackExecutor: Executor = Executor { handler.post(it) }

    @Volatile private var sink: FrameSink? = null
    private val pending = AtomicBoolean(false)
    @Volatile private var lastProcessedAt = 0L

    // Çözücü thread'i yazar, yakalama thread'i okur; [pending] bayrağı sırayı korur.
    private var luma = ByteArray(0)
    private var lumaWidth = 0
    private var lumaHeight = 0

    // Yalnızca yakalama thread'inde.
    private var pixels = IntArray(0)
    private var bitmap: Bitmap? = null

    fun start(frameSink: FrameSink) {
        sink = frameSink
    }

    /** Çözücü thread'inden çağrılır. Dönüşte [image] kapatılır; referans tutulmaz. */
    fun onDecodedFrame(image: Image) {
        val target = sink ?: return
        val now = SystemClock.elapsedRealtime()
        if (now - lastProcessedAt < config.intervalMs) return
        if (pending.get() || !target.isReady()) return

        val crop = image.cropRect
        val width = crop.width()
        val height = (crop.height() * config.cropRatio).toInt()
        if (width <= 0 || height <= 0) return
        val top = crop.bottom - height

        val plane = image.planes[0]
        val buffer = plane.buffer
        val rowStride = plane.rowStride
        val pixelStride = plane.pixelStride
        if (luma.size != width * height) luma = ByteArray(width * height)
        if (pixelStride == 1) {
            for (y in 0 until height) {
                buffer.position((top + y) * rowStride + crop.left)
                buffer.get(luma, y * width, width)
            }
        } else {
            for (y in 0 until height) {
                val row = (top + y) * rowStride + crop.left * pixelStride
                for (x in 0 until width) luma[y * width + x] = buffer.get(row + x * pixelStride)
            }
        }
        lumaWidth = width
        lumaHeight = height
        lastProcessedAt = now
        pending.set(true)
        handler.post(::deliver)
    }

    /** Yakalama thread'inde: gri tampon -> yeniden kullanılan ARGB Bitmap -> OCR hattı. */
    private fun deliver() {
        try {
            val target = sink ?: return
            val w = lumaWidth
            val h = lumaHeight
            if (pixels.size != w * h) pixels = IntArray(w * h)
            for (i in 0 until w * h) {
                val v = luma[i].toInt() and 0xFF
                pixels[i] = (0xFF shl 24) or (v shl 16) or (v shl 8) or v
            }
            val bmp = bitmap?.takeIf { it.width == w && it.height == h && !it.isRecycled }
                ?: Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).also {
                    bitmap?.recycle()
                    bitmap = it
                }
            bmp.setPixels(pixels, 0, w, 0, 0, w, h)
            target.onFrame(CroppedFrame(bmp, w, h))
        } finally {
            pending.set(false)
        }
    }

    fun stop() {
        sink = null
        handler.post {
            bitmap?.recycle()
            bitmap = null
        }
        thread.quitSafely()
    }
}
