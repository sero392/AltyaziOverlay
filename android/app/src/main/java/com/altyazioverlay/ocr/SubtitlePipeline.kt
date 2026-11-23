package com.altyazioverlay.ocr

import android.graphics.Bitmap
import android.os.SystemClock
import android.util.Log
import com.altyazioverlay.capture.CroppedFrame
import com.altyazioverlay.capture.FrameSink
import com.altyazioverlay.core.SubtitleEvent
import com.altyazioverlay.service.CaptureConfig
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Kare -> piksel diff -> (gerekirse) OCR -> metin diff -> olay.
 *
 * Tamamen yakalama thread'inde çalışır (ML Kit callback'leri de oraya yönlendirilir),
 * bu yüzden kilit gerektirmez. Aynı anda en fazla bir OCR çalışır.
 */
class SubtitlePipeline(
    config: CaptureConfig,
    private val recognizer: TextRecognizerEngine,
    private val onSubtitle: (SubtitleEvent) -> Unit,
    /** Yeni aday metin (henüz kararlı değil): çeviri önceden başlatılsın diye. */
    private val onCandidate: (String) -> Unit = {},
    /** Debug: son kırpılmış kare buraya PNG olarak yazılır (adb pull ile incelenir). */
    private val debugDir: File? = null,
    /**
     * Teşhis (geçici): OCR yazı okuduğu halde altyazı çıkmayan kareler buraya PNG olarak yazılır
     * ve logda "KACIRILDI" satırıyla dosya adı + eleme sebebi görünür.
     */
    private val missDir: File? = null,
) : FrameSink {

    private val pixelDiff = FrameDiffDetector()
    private val textFilter = TextChangeFilter(config.stableFrames, config.similarityThreshold)

    @Volatile
    private var ocrInFlight = false
    @Volatile
    private var closed = false
    private var frameId = 0L
    private var lastDumpAt = 0L
    private var ocrStartedAt = 0L
    /** Zaman aşımına uğrayan isteğin geç gelen sonucunu ayırt etmek için. */
    private var ocrRequestId = 0L

    override fun isReady(): Boolean {
        if (closed) return false
        if (ocrInFlight && SystemClock.elapsedRealtime() - ocrStartedAt > OCR_TIMEOUT_MS) {
            // ML Kit sonuç döndürmedi: hattı kilitli bırakma, isteği terk et.
            Log.w(TAG, "OCR timed out, dropping request #$ocrRequestId")
            ocrRequestId++
            ocrInFlight = false
            pixelDiff.invalidate()
        }
        return !ocrInFlight
    }

    override fun onFrame(frame: CroppedFrame) {
        val id = ++frameId

        if (!pixelDiff.hasChanged(frame)) {
            // Görüntü aynı: OCR yok, ama bekleyen adayı onayla.
            textFilter.onFrameUnchanged()?.let { publish(it, id, 0L) }
            return
        }

        ocrInFlight = true
        val requestId = ++ocrRequestId
        val startedAt = SystemClock.elapsedRealtime()
        ocrStartedAt = startedAt
        try {
            recognizer.recognize(frame.bitmap, frame.contentWidth, frame.sourceWidth, frame.sourceHeight, frame.bands) { text ->
                onOcrResult(requestId, frame, text, id, startedAt)
            }
        } catch (t: Throwable) {
            Log.e(TAG, "OCR could not be started", t)
            ocrInFlight = false
            pixelDiff.invalidate()
        }
    }

    private fun onOcrResult(requestId: Long, frame: CroppedFrame, text: String?, id: Long, startedAt: Long) {
        if (requestId != ocrRequestId) return  // zaman aşımına uğramış eski istek
        if (debugDir != null) debugDump(frame.bitmap, text)
        ocrInFlight = false
        if (closed) return
        if (text == null) {
            pixelDiff.invalidate()
            return
        }
        val latency = SystemClock.elapsedRealtime() - startedAt
        val emitted = textFilter.onRecognized(text)
        textFilter.lastDiscarded?.let { Log.d(TAG, "KARARSIZ (onaylanmadan atildi): \"$it\"") }
        if (text.isEmpty()) recordMiss(frame.bitmap)
        val fresh = textFilter.takeNewCandidate()
        if (emitted != null) {
            publish(emitted, id, latency)
        } else if (fresh != null) {
            onCandidate(fresh)
        }
    }

    private fun publish(text: String, id: Long, latencyMs: Long) {
        Log.d(TAG, "EMIT #$id: \"$text\"")
        onSubtitle(SubtitleEvent(text, id, latencyMs, System.currentTimeMillis()))
    }

    /** Bitmap henüz yeniden kullanılmadı (ocrInFlight=true), güvenle okunabilir. */
    private fun debugDump(bitmap: Bitmap, text: String?) {
        Log.d(TAG, "OCR raw: \"${text ?: "<error>"}\"")
        val now = SystemClock.elapsedRealtime()
        if (now - lastDumpAt < DUMP_INTERVAL_MS) return
        lastDumpAt = now
        try {
            debugDir?.mkdirs()
            File(debugDir, "last_crop.png").outputStream().use {
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
            }
        } catch (t: Throwable) {
            Log.w(TAG, "debug dump failed", t)
        }
    }

    private var lastMissAt = 0L
    private var lastMissRaw = ""
    private var missCount = 0

    /** Bitmap henüz yeniden kullanılmadı (ocrInFlight=false yapılmadan önce çağrılır). */
    private fun recordMiss(bitmap: Bitmap) {
        val dir = missDir ?: return
        val diag = recognizer.lastDiag
        val words = diag.raw.split(' ').count { w -> w.count(Char::isLetter) >= 2 }
        if (words < 2 || diag.raw == lastMissRaw) return
        val now = SystemClock.elapsedRealtime()
        if (now - lastMissAt < MISS_INTERVAL_MS || missCount >= MAX_MISS_FILES) return
        lastMissAt = now
        lastMissRaw = diag.raw
        missCount++
        val name = "miss_" + SimpleDateFormat("HHmmss_SSS", Locale.US).format(Date()) + ".png"
        try {
            dir.mkdirs()
            File(dir, name).outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        } catch (t: Throwable) {
            Log.w(TAG, "miss dump failed", t)
        }
        Log.d(TAG, "KACIRILDI $name sebep=${diag.reason ?: "?"} ham=${diag.lines.joinToString(" ; ")}")
    }

    fun close() {
        closed = true
        recognizer.close()
    }

    companion object {
        private const val TAG = "SubtitlePipeline"
        private const val DUMP_INTERVAL_MS = 3_000L
        private const val OCR_TIMEOUT_MS = 3_000L
        private const val MISS_INTERVAL_MS = 1_500L
        private const val MAX_MISS_FILES = 400
    }
}
