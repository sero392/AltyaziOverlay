package com.altyazioverlay.capture

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
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
    private var lumaLayout: RegionLayout? = null
    private var lumaHeight = 0
    private var sourceWidth = 0
    private var sourceHeight = 0

    // Yalnızca yakalama thread'inde.
    private var pixels = IntArray(0)
    private var bitmap: Bitmap? = null
    private var upscaled: Bitmap? = null
    private val canvas = Canvas()
    private val filterPaint = Paint(Paint.FILTER_BITMAP_FLAG)

    fun start(frameSink: FrameSink) {
        sink = frameSink
    }

    /** Okuma alanları; yayın sürerken kurulum ekranından değiştirilebilir ([setRegions]). */
    @Volatile private var regions: List<ReadRegion> = config.regions
    private var layout: RegionLayout? = null

    /** Bir sonraki çözülmüş karede çağrılır (kurulum ekranı için anlık görüntü). */
    private val snapshotRequest = java.util.concurrent.atomic.AtomicReference<((FrameSnapshot) -> Unit)?>(null)

    /**
     * Teşhis (geçici): doluysa [FULL_FRAME_INTERVAL_MS]'de bir tam ekran JPEG buraya yazılır;
     * okuma alanlarının dışında kalan altyazıları görmek için.
     */
    @Volatile
    var diagDir: java.io.File? = null
    private var lastFullFrameAt = 0L
    private var fullFrameCount = 0
    private val diagExecutor by lazy { java.util.concurrent.Executors.newSingleThreadExecutor() }

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
        val dir = diagDir
        if (dir != null && now - lastFullFrameAt >= FULL_FRAME_INTERVAL_MS && fullFrameCount < MAX_FULL_FRAMES) {
            lastFullFrameAt = now
            fullFrameCount++
            val snap = FrameSnapshot.capture(image)
            val name = "full_" + java.text.SimpleDateFormat("HHmmss_SSS", java.util.Locale.US)
                .format(java.util.Date()) + ".jpg"
            diagExecutor.execute {
                try {
                    snap.save(java.io.File(dir, name))
                    android.util.Log.d("OcrDiag", "TAM-EKRAN $name")
                } catch (t: Throwable) {
                    android.util.Log.w("OcrDiag", "full frame save failed", t)
                }
            }
        }
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
        lumaLayout = l
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
            if (w < UPSCALE_BELOW_WIDTH && w.toLong() * h <= UPSCALE_MAX_PIXELS) {
                // 720p yayında altyazı harfleri ML Kit için küçük kalıyor (masaüstündeki upscale.ts ile
                // aynı neden): çift doğrusal 2x büyütme. Eşikler aynı ölçekte kalsın diye kaynak
                // boyutu da 2 ile çarpılır.
                val big = upscaled?.takeIf { it.width == w * 2 && it.height == h * 2 && !it.isRecycled }
                    ?: Bitmap.createBitmap(w * 2, h * 2, Bitmap.Config.ARGB_8888).also {
                        upscaled?.recycle()
                        upscaled = it
                    }
                canvas.setBitmap(big)
                canvas.save()
                canvas.scale(2f, 2f)
                canvas.drawBitmap(bmp, 0f, 0f, filterPaint)
                canvas.restore()
                canvas.setBitmap(null)
                target.onFrame(CroppedFrame(big, w * 2, h * 2, sourceWidth * 2, sourceHeight * 2, lumaLayout?.bands(2).orEmpty()))
            } else {
                target.onFrame(CroppedFrame(bmp, w, h, sourceWidth, sourceHeight, lumaLayout?.bands(1).orEmpty()))
            }
        } finally {
            pending.set(false)
        }
    }

    private companion object {
        /** Bu genişliğin altındaki OCR kareleri 2x büyütülür (masaüstü: UPSCALE_BELOW_WIDTH). */
        const val UPSCALE_BELOW_WIDTH = 1600
        /** Büyütme öncesi en çok piksel: çok büyük alanlarda OCR süresi gereksiz uzamasın. */
        const val UPSCALE_MAX_PIXELS = 700_000L
        const val FULL_FRAME_INTERVAL_MS = 10_000L
        const val MAX_FULL_FRAMES = 400
    }

    fun stop() {
        sink = null
        handler.post {
            bitmap?.recycle()
            bitmap = null
            upscaled?.recycle()
            upscaled = null
        }
        thread.quitSafely()
    }
}
