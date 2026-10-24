package com.altyazioverlay.remoteplay

import android.media.Image
import android.util.Base64
import android.util.Log
import org.json.JSONObject

/** Eşleşmiş konsol: oturum açmak için gereken anahtarlar (kalıcı saklanır). */
data class RegisteredConsole(
    val host: String,
    val nickname: String,
    val ps5: Boolean,
    val registKey: ByteArray,
    val morning: ByteArray,
    val serverMac: ByteArray,
    val psnAccountId: ByteArray,
) {
    fun toJson(): String = JSONObject()
        .put("host", host)
        .put("nickname", nickname)
        .put("ps5", ps5)
        .put("registKey", b64(registKey))
        .put("morning", b64(morning))
        .put("serverMac", b64(serverMac))
        .put("psnAccountId", b64(psnAccountId))
        .toString()

    companion object {
        fun fromJson(json: String): RegisteredConsole {
            val o = JSONObject(json)
            return RegisteredConsole(
                host = o.getString("host"),
                nickname = o.optString("nickname"),
                ps5 = o.optBoolean("ps5", true),
                registKey = unb64(o.getString("registKey")),
                morning = unb64(o.getString("morning")),
                serverMac = unb64(o.optString("serverMac")),
                psnAccountId = unb64(o.getString("psnAccountId")),
            )
        }

        private fun b64(b: ByteArray) = Base64.encodeToString(b, Base64.NO_WRAP)
        private fun unb64(s: String) = Base64.decode(s, Base64.NO_WRAP)
    }
}

/** Yayın ayarları. 720p/30fps altyazı okumak için yeterli ve pil dostu. */
data class StreamSettings(
    val resolution: Resolution = Resolution.P720,
    val fps: Int = 30,
    val h265: Boolean = false,
) {
    enum class Resolution(val preset: Int, val width: Int, val height: Int) {
        P540(2, 960, 540), P720(3, 1280, 720), P1080(4, 1920, 1080)
    }
}

/**
 * PS Remote Play istemcisi (chiaki-ng). Ekrana hiçbir şey çizmez: video çözülür ve her kare
 * [FrameListener]'a verilir. Ses istenmez, kontrolcü girişi gönderilmez.
 */
class RemotePlayClient {

    interface RegistListener {
        fun onRegistered(console: RegisteredConsole)
        fun onRegistFailed(message: String)
    }

    interface SessionListener {
        fun onConnected()
        /**
         * @param failure PS5 oturumu reddettiyse nedeni (bilinen kodlar); [SessionFailure.retryable]
         *   false ise yeniden denemek anlamsızdır.
         */
        fun onDisconnected(reason: String, isError: Boolean, failure: SessionFailure?)
    }

    fun interface FrameListener {
        /** Decoder thread'inde çağrılır; [image] dönüşte kapatılır, tutulmamalı. */
        fun onFrame(image: Image)
    }

    private var registPtr = 0L
    private var sessionPtr = 0L
    private var decoder: VideoDecoder? = null

    // ------------------------------------------------------------------ eşleşme

    /**
     * @param psnAccountId 8 baytlık PSN hesap kimliği (base64 olarak gösterilen değerin çözülmüşü)
     * @param pin PS5: Ayarlar > Sistem > Remote Play > Cihazı Eşleştir ekranındaki 8 haneli kod
     */
    fun register(host: String, psnAccountId: ByteArray, pin: Int, listener: RegistListener) {
        require(psnAccountId.size == 8) { "PSN hesap kimliği 8 bayt olmalı" }
        cancelRegister()
        val callback = object : ChiakiNative.RegistCallback {
            override fun onRegistFinished(
                success: Boolean,
                nickname: String?,
                registKey: ByteArray?,
                rpKey: ByteArray?,
                serverMac: ByteArray?,
                error: String?,
            ) {
                if (success && registKey != null && rpKey != null) {
                    listener.onRegistered(
                        RegisteredConsole(
                            host = host,
                            nickname = nickname ?: "PS5",
                            ps5 = true,
                            registKey = registKey,
                            morning = rpKey,
                            serverMac = serverMac ?: ByteArray(0),
                            psnAccountId = psnAccountId,
                        ),
                    )
                } else {
                    listener.onRegistFailed(error ?: "failed")
                }
            }
        }
        registPtr = ChiakiNative.registStart(host, true, false, psnAccountId, pin, callback)
        if (registPtr == 0L) listener.onRegistFailed("Eşleştirme başlatılamadı")
    }

    fun cancelRegister() {
        if (registPtr != 0L) {
            ChiakiNative.registStop(registPtr)
            ChiakiNative.registFree(registPtr)
            registPtr = 0L
        }
    }

    // ------------------------------------------------------------------ yayın

    fun start(
        console: RegisteredConsole,
        settings: StreamSettings,
        sessionListener: SessionListener,
        frameListener: FrameListener,
    ): Boolean {
        stop()
        val dec = VideoDecoder(settings.resolution.width, settings.resolution.height, settings.h265) {
            frameListener.onFrame(it)
        }
        val callback = object : ChiakiNative.SessionCallback {
            override fun onConnected() {
                Log.i(TAG, "Connected to ${console.nickname}")
                sessionListener.onConnected()
            }

            override fun onQuit(reason: Int, reasonText: String, appReason: Long) {
                Log.i(TAG, "Session quit: $reason $reasonText (app reason 0x${appReason.toString(16)})")
                // CHIAKI_QUIT_REASON_STOPPED (1) = bizim durdurmamız.
                sessionListener.onDisconnected(
                    reasonText,
                    reason != QUIT_REASON_STOPPED,
                    SessionFailure.fromCode(appReason),
                )
            }

            override fun onVideoSample(data: ByteArray, framesLost: Int): Boolean {
                dec.submit(data)
                return true
            }
        }
        val ptr = ChiakiNative.sessionCreate(
            console.host,
            console.ps5,
            console.registKey,
            console.morning,
            console.psnAccountId,
            settings.resolution.preset,
            settings.fps,
            if (settings.h265) 1 else 0,
            callback,
        )
        if (ptr == 0L) {
            dec.release()
            return false
        }
        val err = ChiakiNative.sessionStart(ptr)
        if (err != 0) {
            Log.e(TAG, "sessionStart failed: ${ChiakiNative.errorString(err)}")
            ChiakiNative.sessionFree(ptr)
            dec.release()
            return false
        }
        sessionPtr = ptr
        decoder = dec
        return true
    }

    fun stop() {
        val ptr = sessionPtr
        if (ptr != 0L) {
            sessionPtr = 0L
            ChiakiNative.sessionStop(ptr)
            ChiakiNative.sessionJoin(ptr)
            ChiakiNative.sessionFree(ptr)
        }
        decoder?.release()
        decoder = null
    }

    val isRunning: Boolean get() = sessionPtr != 0L

    companion object {
        private const val TAG = "RemotePlayClient"
        private const val QUIT_REASON_STOPPED = 1
    }
}
