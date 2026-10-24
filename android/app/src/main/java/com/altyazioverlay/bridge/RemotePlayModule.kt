package com.altyazioverlay.bridge

import android.graphics.Bitmap
import android.media.Image
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import com.altyazioverlay.remoteplay.RegisteredConsole
import com.altyazioverlay.remoteplay.RemotePlayClient
import com.altyazioverlay.remoteplay.StreamSettings
import com.altyazioverlay.service.RemotePlayService
import com.altyazioverlay.service.RemotePlayStore
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.module.annotations.ReactModule
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * PS Remote Play (chiaki-ng) köprüsü: eşleştirme, arka planda altyazı yayını
 * ([RemotePlayService]) ve deneme amaçlı kare yakalama.
 * Eşleşen konsolun anahtarları [RemotePlayStore] ile uygulamaya özel depoda saklanır.
 */
@ReactModule(name = RemotePlayModule.NAME)
class RemotePlayModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

    private val client = RemotePlayClient()
    private val worker = Executors.newSingleThreadScheduledExecutor { Thread(it, "RemotePlayModule") }

    override fun getName(): String = NAME

    /** Kayıtlı konsol: { host, nickname } ya da null. */
    @ReactMethod
    fun getConsole(promise: Promise) {
        val console = loadConsole()
        promise.resolve(console?.let { "${it.nickname} (${it.host})" })
    }

    /**
     * @param psnAccountIdBase64 PSN hesap kimliği (base64, 8 bayt)
     * @param pin PS5'te Ayarlar > Sistem > Remote Play > Cihazı Eşleştir ekranındaki 8 hane
     */
    @ReactMethod
    fun register(host: String, psnAccountIdBase64: String, pin: String, promise: Promise) {
        val accountId = runCatching { Base64.decode(psnAccountIdBase64.trim(), Base64.DEFAULT) }.getOrNull()
        if (accountId == null || accountId.size != 8) {
            promise.reject(E_INPUT, "PSN hesap kimliği geçersiz (base64, 8 bayt olmalı)")
            return
        }
        val pinValue = pin.trim().toIntOrNull()
        if (pinValue == null || pin.trim().length != 8) {
            promise.reject(E_INPUT, "PIN 8 haneli olmalı")
            return
        }
        worker.execute {
            client.register(host.trim(), accountId, pinValue, object : RemotePlayClient.RegistListener {
                override fun onRegistered(console: RegisteredConsole) {
                    RemotePlayStore.saveConsole(reactContext, console)
                    worker.execute { client.cancelRegister() }
                    promise.resolve("${console.nickname} (${console.host})")
                }

                override fun onRegistFailed(message: String) {
                    worker.execute { client.cancelRegister() }
                    promise.reject(E_REGIST, "Eşleştirme başarısız: $message")
                }
            })
        }
    }

    /**
     * Deneme: yayını açar, kararlı kareyi PNG kaydeder ([WARMUP_FRAMES] kare beklenir).
     * @param holdSeconds 0: ilk kararlı karede kapat. >0: yayını bu kadar açık tut (kol / kullanıcı
     *   davranışını denemek için); bu sürede 5 sn'de bir kare kaydedilir.
     */
    @ReactMethod
    fun captureTestFrame(holdSeconds: Double, promise: Promise) {
        val holdMs = (holdSeconds * 1000).toLong().coerceIn(0L, 10 * 60_000L)
        val console = loadConsole()
        if (console == null) {
            promise.reject(E_INPUT, "Önce PS5 ile eşleştirin")
            return
        }
        worker.execute {
            val done = AtomicBoolean(false)
            var frames = 0
            var lastSavedAt = 0L
            val startedAt = SystemClock.elapsedRealtime()

            fun finish(result: Result<String>) {
                if (!done.compareAndSet(false, true)) return
                worker.execute { client.stop() }
                result.fold({ promise.resolve(it) }, { promise.reject(E_STREAM, it.message, it) })
            }

            val ok = client.start(
                console,
                StreamSettings(),
                object : RemotePlayClient.SessionListener {
                    override fun onConnected() {
                        Log.i(TAG, "Stream connected")
                    }

                    override fun onDisconnected(reason: String, isError: Boolean) {
                        finish(Result.failure(IllegalStateException("Yayın kapandı: $reason")))
                    }
                },
                { image ->
                    frames++
                    if (done.get() || frames < WARMUP_FRAMES) return@start
                    val now = SystemClock.elapsedRealtime()
                    if (holdMs == 0L) {
                        val path = saveLuma(image)
                        finish(Result.success("$path (${image.width}x${image.height}, ${now - startedAt} ms)"))
                    } else if (now - lastSavedAt >= HOLD_SAVE_INTERVAL_MS) {
                        lastSavedAt = now
                        saveLuma(image)
                    }
                },
            )
            if (!ok) {
                finish(Result.failure(IllegalStateException("Yayın başlatılamadı (logcat: chiaki)")))
                return@execute
            }
            if (holdMs > 0L) {
                worker.schedule({
                    finish(
                        if (frames >= WARMUP_FRAMES) Result.success("${holdMs / 1000} sn yayın tamamlandı ($frames kare)")
                        else Result.failure(IllegalStateException("Kare gelmedi ($frames kare)")),
                    )
                }, holdMs, TimeUnit.MILLISECONDS)
            } else {
                worker.schedule({
                    finish(Result.failure(IllegalStateException("${TIMEOUT_MS / 1000} sn içinde kare gelmedi ($frames kare)")))
                }, TIMEOUT_MS, TimeUnit.MILLISECONDS)
            }
        }
    }

    @ReactMethod
    fun forgetConsole() {
        RemotePlayStore.forgetConsole(reactContext)
    }

    // ------------------------------------------------------------------ arka plan yayını

    /**
     * PS5 yayınından altyazı okumayı başlatır (ön plan servisi). Durum ve altyazılar
     * SubtitleCapture olaylarıyla (onState / onText) gelir.
     */
    @ReactMethod
    fun startStreaming(options: ReadableMap?, promise: Promise) {
        if (RemotePlayStore.loadConsole(reactContext) == null) {
            promise.reject(E_INPUT, "Önce PS5 ile eşleştirin")
            return
        }
        if (client.isRunning) {
            promise.reject(E_INPUT, "Deneme yayını sürüyor, bitmesini bekleyin")
            return
        }
        RemotePlayService.start(reactContext, options.toCaptureConfig())
        promise.resolve(true)
    }

    @ReactMethod
    fun stopStreaming() {
        RemotePlayService.stop(reactContext)
    }

    /** YUV karenin parlaklık (Y) düzlemini gri tonlamalı PNG olarak kaydeder. */
    private fun saveLuma(image: Image): String {
        val plane = image.planes[0]
        // Çözücü tamponu hizalı olabilir (ör. 1280x736); görünür alan cropRect.
        val crop = image.cropRect
        val w = crop.width()
        val h = crop.height()
        val pixels = IntArray(w * h)
        val buf = plane.buffer
        for (y in 0 until h) {
            val row = (crop.top + y) * plane.rowStride
            for (x in 0 until w) {
                val v = buf.get(row + (crop.left + x) * plane.pixelStride).toInt() and 0xFF
                pixels[y * w + x] = (0xFF shl 24) or (v shl 16) or (v shl 8) or v
            }
        }
        val bmp = Bitmap.createBitmap(pixels, w, h, Bitmap.Config.ARGB_8888)
        val dir = reactContext.getExternalFilesDir("debug")!!.apply { mkdirs() }
        val file = File(dir, "rp_frame.png")
        file.outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bmp.recycle()
        return file.absolutePath
    }

    private fun loadConsole(): RegisteredConsole? = RemotePlayStore.loadConsole(reactContext)

    override fun invalidate() {
        worker.execute { client.stop() }
        worker.shutdown()
        super.invalidate()
    }

    companion object {
        const val NAME = "RemotePlay"
        private const val TAG = "RemotePlayModule"
        private const val WARMUP_FRAMES = 90
        private const val TIMEOUT_MS = 25_000L
        private const val HOLD_SAVE_INTERVAL_MS = 5_000L
        private const val E_INPUT = "E_INPUT"
        private const val E_REGIST = "E_REGIST"
        private const val E_STREAM = "E_STREAM"
    }
}
