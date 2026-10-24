package com.altyazioverlay.remoteplay

import android.util.Log

/** Ağda bulunan bir PlayStation. */
data class DiscoveredConsole(
    val host: String,
    val name: String,
    val hostId: String,
    val ps5: Boolean,
    val state: State,
) {
    enum class State { UNKNOWN, READY, STANDBY }
}

/**
 * Yerel ağdaki PlayStation'ları bulur (chiaki discovery: UDP yayın, PS4 987 / PS5 9302).
 * Konsollar açıkken READY, bekleme modundayken STANDBY yanıtı verir; kapalıysa yanıt yoktur.
 */
class PsDiscovery {

    fun interface Listener {
        /** chiaki keşif thread'inden çağrılır. */
        fun onConsoles(consoles: List<DiscoveredConsole>)
    }

    private var ptr = 0L

    /** @param sendHost yayın için "255.255.255.255", tek konsolu yoklamak için IP. */
    fun start(listener: Listener, sendHost: String = BROADCAST, pingMs: Int = 1_000): Boolean {
        stop()
        val callback = object : ChiakiNative.DiscoveryCallback {
            override fun onHosts(
                states: IntArray,
                ps5: BooleanArray,
                addrs: Array<String?>,
                names: Array<String?>,
                hostIds: Array<String?>,
            ) {
                val consoles = states.indices.mapNotNull { i ->
                    val host = addrs[i] ?: return@mapNotNull null
                    DiscoveredConsole(
                        host = host,
                        name = names[i] ?: host,
                        hostId = hostIds[i] ?: "",
                        ps5 = ps5[i],
                        state = DiscoveredConsole.State.entries.getOrElse(states[i]) { DiscoveredConsole.State.UNKNOWN },
                    )
                }
                listener.onConsoles(consoles)
            }
        }
        ptr = ChiakiNative.discoveryStart(sendHost, pingMs, callback)
        if (ptr == 0L) Log.e(TAG, "Discovery could not start")
        return ptr != 0L
    }

    fun stop() {
        if (ptr != 0L) {
            ChiakiNative.discoveryStop(ptr)
            ptr = 0L
        }
    }

    companion object {
        private const val TAG = "PsDiscovery"
        const val BROADCAST = "255.255.255.255"

        /** Bekleme modundaki eşleşmiş konsolu uyandırır. @return başarılıysa true */
        fun wakeup(console: RegisteredConsole): Boolean {
            val err = ChiakiNative.wakeup(console.host, console.registKey, console.ps5)
            if (err != 0) Log.w(TAG, "Wakeup failed: ${ChiakiNative.errorString(err)}")
            return err == 0
        }
    }
}
