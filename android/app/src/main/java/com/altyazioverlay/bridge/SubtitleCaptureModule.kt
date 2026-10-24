package com.altyazioverlay.bridge

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import com.altyazioverlay.core.CaptureGate
import com.altyazioverlay.core.OverlayController
import com.altyazioverlay.core.SubtitleEvent
import com.altyazioverlay.core.SubtitleEventBus
import com.altyazioverlay.core.TvLink
import com.altyazioverlay.service.CaptureConfig
import com.altyazioverlay.service.RemotePlayService
import com.altyazioverlay.service.ScreenCaptureService
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Kotlin <-> TS köprüsü.
 *
 * Darboğaz stratejisi: Köprüden ASLA görüntü/bitmap/base64 geçmez. Native taraf
 * kareleri kendi içinde filtreler (piksel diff + metin diff + kararlılık) ve JS'e yalnızca
 * gerçekten DEĞİŞMİŞ altyazı metnini küçük bir map olarak gönderir — tipik olarak
 * birkaç saniyede bir olay. Ters yönde de yalnızca çevrilmiş string gider.
 */
@ReactModule(name = SubtitleCaptureModule.NAME)
class SubtitleCaptureModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext),
    ActivityEventListener,
    LifecycleEventListener,
    SubtitleEventBus.Listener {

    private var pendingStart: Promise? = null
    private var pendingConfig: CaptureConfig = CaptureConfig()
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun getName(): String = NAME

    override fun initialize() {
        super.initialize()
        reactContext.addActivityEventListener(this)
        reactContext.addLifecycleEventListener(this)
        SubtitleEventBus.register(this)
        TvLink.addListener(tvListener)
    }

    override fun invalidate() {
        TvLink.removeListener(tvListener)
        SubtitleEventBus.unregister(this)
        reactContext.removeLifecycleEventListener(this)
        reactContext.removeActivityEventListener(this)
        CaptureGate.hostAppInForeground = false
        super.invalidate()
    }

    // ------------------------------------------------------------------ lifecycle

    /** Uygulamamız öndeyken yakalama duraklar ve yüzen pencere gizlenir. */
    override fun onHostResume() {
        CaptureGate.hostAppInForeground = true
        OverlayController.showText("")
    }

    override fun onHostPause() {
        CaptureGate.hostAppInForeground = false
    }

    override fun onHostDestroy() {
        CaptureGate.hostAppInForeground = false
    }

    // ------------------------------------------------------------------ permissions

    @ReactMethod
    fun hasOverlayPermission(promise: Promise) {
        promise.resolve(Settings.canDrawOverlays(reactContext))
    }

    @ReactMethod
    fun requestOverlayPermission() {
        val intent = Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:${reactContext.packageName}"),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        reactContext.startActivity(intent)
    }

    // ------------------------------------------------------------------ capture

    @ReactMethod
    fun startCapture(options: ReadableMap?, promise: Promise) {
        if (ScreenCaptureService.isRunning) {
            promise.resolve(true)
            return
        }
        if (!Settings.canDrawOverlays(reactContext)) {
            promise.reject(E_NO_OVERLAY, "Diğer uygulamaların üzerinde gösterme izni gerekli")
            return
        }
        val activity = reactContext.currentActivity
        if (activity == null) {
            promise.reject(E_NO_ACTIVITY, "Aktif Activity yok")
            return
        }
        if (pendingStart != null) {
            promise.reject(E_BUSY, "İzin penceresi zaten açık")
            return
        }

        pendingConfig = options.toCaptureConfig()
        pendingStart = promise
        val mpm = activity.getSystemService(MediaProjectionManager::class.java)
        try {
            activity.startActivityForResult(mpm.createScreenCaptureIntent(), REQUEST_MEDIA_PROJECTION)
        } catch (e: Exception) {
            pendingStart = null
            promise.reject(E_START_FAILED, e)
        }
    }

    /** Hangi kaynak çalışıyorsa (Remote Play ya da yedek ekran yakalama) onu durdurur. */
    @ReactMethod
    fun stopCapture() {
        if (RemotePlayService.isRunning) RemotePlayService.stop(reactContext)
        if (ScreenCaptureService.isRunning) ScreenCaptureService.stop(reactContext)
    }

    @ReactMethod
    fun isCaptureRunning(promise: Promise) {
        promise.resolve(ScreenCaptureService.isRunning || RemotePlayService.isRunning)
    }

    /** JS -> yüzen pencere. Boş string pencereyi gizler. */
    @ReactMethod
    fun updateOverlayText(text: String) {
        Log.d(NAME, "overlay <- \"$text\" (attached=${OverlayController.isAttached})")
        OverlayController.showText(text)
    }

    /**
     * Native zamanlayıcı. RN, uygulama arka plandayken JS setTimeout'larını durdurur;
     * oyun öndeyken çalışması gereken gecikmeler (ör. API simülasyonu, retry backoff)
     * bunu kullanmalı.
     */
    @ReactMethod
    fun delay(ms: Double, promise: Promise) {
        mainHandler.postDelayed({ promise.resolve(null) }, ms.toLong().coerceAtLeast(0L))
    }

    // ------------------------------------------------------------------ TV

    /**
     * TV alıcısına bağlanmayı başlatır. host boşsa TV ağda (mDNS) aranır.
     * Durum "SubtitleCapture_onTvState" olayıyla gelir.
     */
    @ReactMethod
    fun tvConnect(host: String?) {
        TvLink.start(reactContext, host)
    }

    @ReactMethod
    fun tvDisconnect() {
        TvLink.stop()
    }

    /** Çevirinin nerede gösterileceği: telefonda yüzen pencere ve/veya TV. */
    @ReactMethod
    fun setDisplayTargets(phone: Boolean, tv: Boolean) {
        OverlayController.showOnPhone = phone
        OverlayController.sendToTv = tv
    }

    private val tvListener = TvLink.Listener { s ->
        emit(EVENT_TV_STATE, Arguments.createMap().apply {
            putString("state", s.state.name)
            if (s.target != null) putString("target", s.target) else putNull("target")
            if (s.error != null) putString("error", s.error) else putNull("error")
        })
    }

    // ------------------------------------------------------------------ http

    /**
     * Native HTTP isteği (OkHttp). RN'nin fetch'i yanıtı JS setTimeout ile teslim eder;
     * uygulama arka plandayken (oyun öndeyken) JS zamanlayıcıları durduğu için fetch
     * hiç dönmez. Bu yol zamanlayıcıya bağlı değildir.
     *
     * @param options { url, method, headers: {..}, body?: string, timeoutMs?: number }
     * @return { status: number, body: string }
     */
    @ReactMethod
    fun httpRequest(options: ReadableMap, promise: Promise) {
        val url = options.getString("url")
        if (url == null) {
            promise.reject(E_HTTP, "url gerekli")
            return
        }
        val method = options.getString("method") ?: "GET"
        val body = if (options.hasKey("body") && !options.isNull("body")) options.getString("body") else null
        val timeoutMs = if (options.hasKey("timeoutMs")) options.getDouble("timeoutMs").toLong() else 10_000L

        val builder = Request.Builder().url(url)
        options.getMap("headers")?.let { headers ->
            val it = headers.keySetIterator()
            while (it.hasNextKey()) {
                val name = it.nextKey()
                headers.getString(name)?.let { value -> builder.header(name, value) }
            }
        }
        val contentType = options.getMap("headers")?.getString("Content-Type") ?: "application/json"
        builder.method(method, body?.toRequestBody(contentType.toMediaTypeOrNull()))

        val client = httpClient.newBuilder().callTimeout(timeoutMs, TimeUnit.MILLISECONDS).build()
        client.newCall(builder.build()).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                promise.reject(E_HTTP, e.message ?: "Ağ hatası", e)
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    promise.resolve(Arguments.createMap().apply {
                        putInt("status", it.code)
                        putString("body", it.body?.string() ?: "")
                    })
                }
            }
        })
    }

    // ------------------------------------------------------------------ settings

    /** Uygulamaya özel SharedPreferences (diğer uygulamalar okuyamaz). API anahtarı burada. */
    private val prefs by lazy {
        reactContext.getSharedPreferences(PREFS_NAME, android.content.Context.MODE_PRIVATE)
    }

    @ReactMethod
    fun getSetting(key: String, promise: Promise) {
        promise.resolve(prefs.getString(key, null))
    }

    /** Boş / null değer anahtarı siler. */
    @ReactMethod
    fun setSetting(key: String, value: String?, promise: Promise) {
        prefs.edit().apply {
            if (value.isNullOrEmpty()) remove(key) else putString(key, value)
        }.apply()
        promise.resolve(null)
    }

    // NativeEventEmitter sözleşmesi (no-op; olaylar bus'tan gelir).
    @ReactMethod
    @Suppress("UNUSED_PARAMETER")
    fun addListener(eventName: String) = Unit

    @ReactMethod
    @Suppress("UNUSED_PARAMETER")
    fun removeListeners(count: Double) = Unit

    // ------------------------------------------------------------------ activity result

    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQUEST_MEDIA_PROJECTION) return
        val promise = pendingStart ?: return
        pendingStart = null

        if (resultCode != Activity.RESULT_OK || data == null) {
            promise.reject(E_DENIED, "Ekran yakalama izni reddedildi")
            return
        }
        try {
            ScreenCaptureService.start(reactContext, resultCode, data, pendingConfig)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject(E_START_FAILED, e)
        }
    }

    override fun onNewIntent(intent: Intent) = Unit

    // ------------------------------------------------------------------ events -> JS

    override fun onSubtitle(event: SubtitleEvent) {
        emit(EVENT_TEXT, Arguments.createMap().apply {
            putString("text", event.text)
            putDouble("frameId", event.frameId.toDouble())
            putDouble("ocrLatencyMs", event.ocrLatencyMs.toDouble())
            putDouble("timestamp", event.timestampMs.toDouble())
        })
    }

    override fun onCaptureStateChanged(running: Boolean, error: String?) {
        emit(EVENT_STATE, Arguments.createMap().apply {
            putBoolean("running", running)
            if (error != null) putString("error", error) else putNull("error")
        })
    }

    private fun emit(name: String, payload: WritableMap) {
        if (!reactContext.hasActiveReactInstance()) return
        reactContext.emitDeviceEvent(name, payload)
    }


    companion object {
        const val NAME = "SubtitleCapture"
        const val EVENT_TEXT = "SubtitleCapture_onText"
        const val EVENT_STATE = "SubtitleCapture_onState"
        const val EVENT_TV_STATE = "SubtitleCapture_onTvState"

        private const val REQUEST_MEDIA_PROJECTION = 0x5C1
        private const val PREFS_NAME = "altyazi_settings"
        private const val E_HTTP = "E_HTTP"

        /** RN'nin paylaşılan OkHttp istemcisi (bağlantı havuzu ortak). */
        private val httpClient: OkHttpClient by lazy { OkHttpClientProvider.getOkHttpClient() }
        private const val E_NO_OVERLAY = "E_NO_OVERLAY_PERMISSION"
        private const val E_NO_ACTIVITY = "E_NO_ACTIVITY"
        private const val E_BUSY = "E_BUSY"
        private const val E_DENIED = "E_PERMISSION_DENIED"
        private const val E_START_FAILED = "E_START_FAILED"
    }
}
