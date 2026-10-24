package com.altyazioverlay.ocr

import android.graphics.Bitmap
import android.os.SystemClock
import android.util.Log
import com.altyazioverlay.capture.CroppedFrame
import com.altyazioverlay.capture.FrameSink
import com.altyazioverlay.core.SubtitleEvent
import com.altyazioverlay.service.CaptureConfig
import java.io.File

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
    /** Debug: son kırpılmış kare buraya PNG olarak yazılır (adb pull ile incelenir). */
    private val debugDir: File? = null,
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
            recognizer.recognize(frame.bitmap, frame.contentWidth) { text ->
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
        textFilter.onRecognized(text)?.let { publish(it, id, latency) }
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

    fun close() {
        closed = true
        recognizer.close()
    }

    companion object {
        private const val TAG = "SubtitlePipeline"
        private const val DUMP_INTERVAL_MS = 3_000L
        private const val OCR_TIMEOUT_MS = 3_000L
    }
}
