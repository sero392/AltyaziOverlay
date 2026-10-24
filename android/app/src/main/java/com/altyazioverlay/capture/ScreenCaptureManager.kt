package com.altyazioverlay.capture

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.PixelFormat
import android.graphics.Point
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.os.SystemClock
import android.util.Log
import android.view.Display
import com.altyazioverlay.core.CaptureGate
import com.altyazioverlay.service.CaptureConfig
import java.util.concurrent.Executor

/** Kırpılmış kareleri tüketen taraf (OCR hattı). Tüm çağrılar yakalama thread'inde gelir. */
interface FrameSink {
    /** false ise kare kırpılmadan atılır (ör. OCR hâlâ önceki kareyi işliyor). */
    fun isReady(): Boolean
    fun onFrame(frame: CroppedFrame)
}

/**
 * MediaProjection -> VirtualDisplay -> ImageReader zinciri.
 *
 * - Tüm kare işleme özel bir arka plan HandlerThread'inde; UI ve JS thread'i hiç bloklanmaz.
 * - Ekran 60fps üretse de kareler [CaptureConfig.intervalMs] ile kısılır. Atlanan kareler
 *   sadece acquire/close edilir (kopyalama yok), böylece üretici hiç tıkanmaz.
 * - OCR meşgulken gelen kareler kırpılmadan atılır (backpressure).
 */
class ScreenCaptureManager(
    private val context: Context,
    private val projection: MediaProjection,
    private val config: CaptureConfig,
) {
    private val thread = HandlerThread("SubtitleCapture", Process.THREAD_PRIORITY_BACKGROUND).apply { start() }
    private val handler = Handler(thread.looper)

    /** ML Kit callback'lerini de aynı thread'e indirir -> hat tamamen tek thread'li, kilitsiz. */
    val callbackExecutor: Executor = Executor { handler.post(it) }

    private val cropper = SubtitleCropper(config.cropRatio)
    private var imageReader: ImageReader? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var spec: CaptureSpec? = null
    private var sink: FrameSink? = null
    private var lastProcessedAt = 0L

    private data class CaptureSpec(val width: Int, val height: Int, val dpi: Int)

    fun start(frameSink: FrameSink) {
        sink = frameSink
        val s = computeSpec()
        spec = s
        val reader = newReader(s)
        imageReader = reader
        // Android 14+: bir token ile createVirtualDisplay yalnızca bir kez çağrılabilir.
        // Dönüşlerde yeniden oluşturmak yerine resize + setSurface kullanıyoruz.
        virtualDisplay = projection.createVirtualDisplay(
            "AltyaziCapture",
            s.width, s.height, s.dpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader.surface,
            null,
            handler,
        )
        Log.i(TAG, "Capture started ${s.width}x${s.height}@${s.dpi}dpi, crop=${config.cropRatio}")
    }

    fun onDisplayChanged() {
        handler.post {
            val vd = virtualDisplay ?: return@post
            val newSpec = computeSpec()
            if (newSpec == spec) return@post
            val old = imageReader
            val reader = newReader(newSpec)
            vd.resize(newSpec.width, newSpec.height, newSpec.dpi)
            vd.surface = reader.surface
            imageReader = reader
            spec = newSpec
            old?.close()
            Log.i(TAG, "Display changed -> ${newSpec.width}x${newSpec.height}")
        }
    }

    fun stop() {
        handler.post {
            virtualDisplay?.release()
            virtualDisplay = null
            imageReader?.close()
            imageReader = null
            cropper.release()
            sink = null
        }
        thread.quitSafely()
    }

    private fun newReader(s: CaptureSpec): ImageReader =
        // maxImages=2: biri işlenirken diğeri dolabilir; daha fazlası boşa bellek.
        ImageReader.newInstance(s.width, s.height, PixelFormat.RGBA_8888, 2).apply {
            setOnImageAvailableListener(::onImageAvailable, handler)
        }

    private fun onImageAvailable(reader: ImageReader) {
        val image = try {
            reader.acquireLatestImage()
        } catch (e: IllegalStateException) {
            null
        } ?: return

        try {
            val target = sink ?: return
            if (CaptureGate.isPaused) return                         // kendi arayüzümüz önde
            if (config.landscapeOnly && image.width < image.height) return  // oyun değil (dikey)
            val now = SystemClock.elapsedRealtime()
            if (now - lastProcessedAt < config.intervalMs) return   // kısma
            if (!target.isReady()) return                            // backpressure
            lastProcessedAt = now

            val frame = cropper.crop(image) ?: return
            stats.processed++
            if (cropper.isTransparent(frame)) {
                // Boş tampon: OCR'a verme (yanlışlıkla "altyazı kalktı" sayılmasın), onarmayı dene.
                stats.blank++
                onBlankFrame(now)
                return
            }
            blankSince = 0L
            target.onFrame(frame)
        } catch (t: Throwable) {
            Log.e(TAG, "Frame processing failed", t)
        } finally {
            image.close()
            logStatsIfDue()
        }
    }

    // ------------------------------------------------------------------ blank-frame recovery

    /**
     * Bazı SoC'lerde (ör. MediaTek) donanım bileşimcisi (HWC) video katmanını (YUV
     * SurfaceView) sanal ekrana ara ara çizmiyor: SurfaceFlinger kareleri 60fps üretse de
     * tampon tamamen sıfır (alfa=0) geliyor. Gerçek bir karede siyah sahnede bile alfa 255'tir.
     * Bu durum [BLANK_RECOVERY_MS] sürerse sanal ekranın yüzeyini sökülüp yeniden takılır;
     * bu, SurfaceFlinger'ı bileşimi yeniden kurmaya zorlar. İkinci denemeden itibaren
     * ImageReader da yenilenir.
     */
    private fun onBlankFrame(now: Long) {
        if (blankSince == 0L) blankSince = now
        if (now - blankSince < BLANK_RECOVERY_MS) return
        if (now - lastRecoveryAt < BLANK_RECOVERY_MS) return
        val vd = virtualDisplay ?: return
        val s = spec ?: return
        lastRecoveryAt = now
        recoveryAttempt++
        stats.recoveries++

        val renewReader = recoveryAttempt % 2 == 0
        Log.w(TAG, "Blank capture for ${now - blankSince}ms -> recovery #$recoveryAttempt (renewReader=$renewReader)")
        vd.surface = null
        handler.postDelayed({
            val current = virtualDisplay ?: return@postDelayed
            if (renewReader) {
                val old = imageReader
                val reader = newReader(s)
                current.surface = reader.surface
                imageReader = reader
                old?.close()
            } else {
                current.surface = imageReader?.surface
            }
        }, SURFACE_REATTACH_DELAY_MS)
    }

    private class Stats {
        var received = 0
        var processed = 0
        var blank = 0
        var recoveries = 0
    }

    private var stats = Stats()
    private var statsSince = SystemClock.elapsedRealtime()
    private var blankSince = 0L
    private var lastRecoveryAt = 0L
    private var recoveryAttempt = 0

    private fun logStatsIfDue() {
        stats.received++
        val now = SystemClock.elapsedRealtime()
        if (now - statsSince < STATS_INTERVAL_MS) return
        Log.i(
            TAG,
            "stats ${now - statsSince}ms: received=${stats.received} processed=${stats.processed} " +
                "blank=${stats.blank} recoveries=${stats.recoveries} paused=${CaptureGate.isPaused}",
        )
        stats = Stats()
        statsSince = now
    }

    @SuppressLint("NewApi")
    private fun computeSpec(): CaptureSpec {
        val dm = context.getSystemService(DisplayManager::class.java)
        val display = dm.getDisplay(Display.DEFAULT_DISPLAY)
        val size = Point()
        @Suppress("DEPRECATION")
        display.getRealSize(size)  // dönüşü yansıtır, sistem çubukları dahil gerçek boyut

        val scale = (config.maxCaptureWidth.toFloat() / size.x).coerceAtMost(1f)
        // Çift sayı: bazı encoder/gralloc uygulamaları tek boyutlarda sorun çıkarır.
        val w = ((size.x * scale).toInt() / 2) * 2
        val h = ((size.y * scale).toInt() / 2) * 2
        val dpi = (context.resources.displayMetrics.densityDpi * scale).toInt().coerceAtLeast(120)
        return CaptureSpec(w, h, dpi)
    }

    companion object {
        private const val TAG = "ScreenCaptureManager"
        private const val BLANK_RECOVERY_MS = 1_500L
        private const val SURFACE_REATTACH_DELAY_MS = 100L
        private const val STATS_INTERVAL_MS = 5_000L
    }
}
