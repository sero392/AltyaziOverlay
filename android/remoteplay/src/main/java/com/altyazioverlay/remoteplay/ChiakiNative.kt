package com.altyazioverlay.remoteplay

/**
 * chiaki-ng çekirdeğinin JNI arayüzü (remoteplay_jni.c). Uygulamanın geri kalanı bunu
 * doğrudan değil, [RemotePlayClient] üzerinden kullanır.
 */
internal object ChiakiNative {

    init {
        System.loadLibrary("altyazi_remoteplay")
    }

    /** Callback'ler chiaki'nin kendi thread'lerinden çağrılır. */
    interface RegistCallback {
        fun onRegistFinished(
            success: Boolean,
            nickname: String?,
            registKey: ByteArray?,
            rpKey: ByteArray?,
            serverMac: ByteArray?,
            error: String?,
        )
    }

    interface SessionCallback {
        fun onConnected()
        fun onQuit(reason: Int, reasonText: String)

        /** Sıkıştırılmış video karesi (H.264/H.265 Annex-B). false dönerse chiaki IDR ister. */
        fun onVideoSample(data: ByteArray, framesLost: Int): Boolean
    }

    external fun errorString(code: Int): String

    external fun registStart(
        host: String,
        ps5: Boolean,
        broadcast: Boolean,
        psnAccountId: ByteArray,
        pin: Int,
        callback: RegistCallback,
    ): Long

    external fun registStop(ptr: Long)
    external fun registFree(ptr: Long)

    external fun sessionCreate(
        host: String,
        ps5: Boolean,
        registKey: ByteArray,
        morning: ByteArray,
        psnAccountId: ByteArray,
        resolution: Int,
        fps: Int,
        codec: Int,
        callback: SessionCallback,
    ): Long

    external fun sessionStart(ptr: Long): Int
    external fun sessionStop(ptr: Long): Int
    external fun sessionJoin(ptr: Long): Int
    external fun sessionRequestIdr(ptr: Long)
    external fun sessionFree(ptr: Long)
}
