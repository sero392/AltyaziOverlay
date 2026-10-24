package com.altyazioverlay.remoteplay

import android.media.Image
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.util.Log
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * Remote Play video akışını donanım çözücüyle (MediaCodec) çözer ve her kareyi
 * [onFrame]'e YUV_420_888 [Image] olarak verir. Görüntü hiçbir zaman ekrana çizilmez.
 *
 * Neden yüzey (Surface/ImageReader) değil de ByteBuffer modu: bazı çözücüler (ör. MediaTek
 * c2.mtk.*) yüzeye üreticiye özel bir formatta (0x7f000001) yazar ve ImageReader bu kareleri
 * düzlemlere ayıramaz (JNI abort). ByteBuffer modunda COLOR_FormatYUV420Flexible istenir;
 * bunu her çözücü desteklemek zorundadır ve [MediaCodec.getOutputImage] standart YUV döner.
 *
 * chiaki'nin video thread'i [submit] ile kare iter; giriş kuyruğu doluysa en eski kare
 * atılır (OCR için gecikme, tamlıktan önemli).
 */
class VideoDecoder(
    width: Int,
    height: Int,
    h265: Boolean,
    private val onFrame: (Image) -> Unit,
) {
    private val codec: MediaCodec
    private val pending = ArrayBlockingQueue<ByteArray>(8)
    @Volatile private var running = true
    private val inputThread: Thread
    private val outputThread: Thread
    private var presentationUs = 0L

    init {
        val mime = if (h265) MediaFormat.MIMETYPE_VIDEO_HEVC else MediaFormat.MIMETYPE_VIDEO_AVC
        val format = MediaFormat.createVideoFormat(mime, width, height).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
            setInteger(MediaFormat.KEY_LOW_LATENCY, 1)
        }
        codec = MediaCodec.createDecoderByType(mime)
        codec.configure(format, null, null, 0)
        codec.start()
        inputThread = Thread(::inputLoop, "RemotePlayDecoderIn").apply { start() }
        outputThread = Thread(::outputLoop, "RemotePlayDecoder").apply { start() }
    }

    /** chiaki video thread'inden çağrılır. Kuyruk doluysa en eski kare düşer. */
    fun submit(sample: ByteArray) {
        if (!running) return
        while (!pending.offer(sample)) pending.poll()
    }

    private fun inputLoop() {
        while (running) {
            val sample = pending.poll(100, TimeUnit.MILLISECONDS) ?: continue
            try {
                val index = codec.dequeueInputBuffer(50_000)
                if (index < 0) continue
                val buffer = codec.getInputBuffer(index) ?: continue
                buffer.clear()
                val size = minOf(sample.size, buffer.remaining())
                buffer.put(sample, 0, size)
                codec.queueInputBuffer(index, 0, size, presentationUs, 0)
                presentationUs += 33_333
            } catch (e: IllegalStateException) {
                if (running) Log.w(TAG, "Decoder input error: ${e.message}")
            }
        }
    }

    private fun outputLoop() {
        val info = MediaCodec.BufferInfo()
        while (running) {
            try {
                val index = codec.dequeueOutputBuffer(info, 50_000)
                if (index < 0) continue  // INFO_TRY_AGAIN_LATER / FORMAT_CHANGED vb.
                try {
                    codec.getOutputImage(index)?.use { image ->
                        try {
                            onFrame(image)
                        } catch (t: Throwable) {
                            Log.e(TAG, "Frame consumer failed", t)
                        }
                    }
                } finally {
                    codec.releaseOutputBuffer(index, false)
                }
            } catch (e: IllegalStateException) {
                if (running) Log.w(TAG, "Decoder output error: ${e.message}")
            }
        }
    }

    fun release() {
        running = false
        inputThread.join(500)
        outputThread.join(500)
        runCatching { codec.stop() }
        runCatching { codec.release() }
    }

    companion object {
        private const val TAG = "RemotePlayDecoder"
    }
}
