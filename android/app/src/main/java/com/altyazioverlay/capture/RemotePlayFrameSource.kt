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
 * - Kareler çözücü thread'inden gelir; [Image] çağrı bitince kapanır. Bu yüzden sadece seçili
 *   okuma alanlarının ([CaptureConfig.regions]) parlaklık (Y) satırları hızlıca bir tampona
 *   alt alta kopyalanır ([RegionLayout]), OCR işi yakalama thread'ine devredilir. Gri görüntü OCR için yeterli; renk dönüşümü yok.
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
    private var sourceWidth = 0
    private var sourceHeight = 0

    // Yalnızca yakalama thread'inde.
    private var pixels = IntArray(0)
    private var bitmap: Bitmap? = null

    fun start(frameSink: FrameSink) {
        sink = frameSink
    }

    /** Okuma alanları; yayın sürerken kurulum ekranından değiştirilebilir ([setRegions]). */
    @Volatile private var regions: List<ReadRegion> = config.regions
    private var layout: RegionLayout? = null

    /** Bir sonraki çözülmüş karede çağrılır (kurulum ekranı için anlık görüntü). */
    private val snapshotRequest = java.util.concurrent.atomic.AtomicReference<((FrameSnapshot) -> Unit)?>(null)

    fun setRegions(list: List<ReadRegion>) {
        regions = list
    }

    fun requestSnapshot(callback: (FrameSnapshot) -> Unit) {
        snapshotRequest.set(callback)
    }

    /** Çözücü thread'inden çağrılır. Dönüşte [image] kapatılır; referans tutulmaz. */
    fun onDecodedFrame(image: Image) {
        snapshotRequest.getAndSet(null)?.let { cb ->
            val snap = FrameSnapshot.capture(image)
            handler.post { cb(snap) }
        }
        val target = sink ?: return
        val now = SystemClock.elapsedRealtime()
        if (now - lastProcessedAt < config.intervalMs) return
        if (pending.get() || !target.isReady()) return

        val crop = image.cropRect
        val frameW = crop.width()
        val frameH = crop.height()
        if (frameW <= 0 || frameH <= 0) return
        val current = regions
        val l = layout?.takeIf { it.sourceWidth == frameW && it.sourceHeight == frameH && it.regions === current }
            ?: RegionLayout(current, frameW, frameH).also { layout = it }
        val width = l.width
        val height = l.height

        val plane = image.planes[0]
        val buffer = plane.buffer
        val rowStride = plane.rowStride
        val pixelStride = plane.pixelStride
        if (luma.size != width * height) luma = ByteArray(width * height)
        java.util.Arrays.fill(luma, 0)
        l.sources.forEachIndexed { i, r ->
            val rw = r.width()
            for (y in 0 until r.height()) {
                val dst = (l.offsetsY[i] + y) * width + l.offsetsX[i]
                val row = (crop.top + r.top + y) * rowStride + (crop.left + r.left) * pixelStride
                if (pixelStride == 1) {
                    buffer.position(row)
                    buffer.get(luma, dst, rw)
                } else {
                    for (x in 0 until rw) luma[dst + x] = buffer.get(row + x * pixelStride)
                }
            }
        }
        lumaWidth = width
        lumaHeight = height
        sourceWidth = frameW
        sourceHeight = frameH
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
            target.onFrame(CroppedFrame(bmp, w, h, sourceWidth, sourceHeight))
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
