package com.altyazioverlay.service

import android.content.Context
import android.os.SystemClock
import android.util.Log
import com.altyazioverlay.remoteplay.DiscoveredConsole
import com.altyazioverlay.remoteplay.PsDiscovery
import com.altyazioverlay.remoteplay.RegisteredConsole
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Yayına bağlanmadan önce eşleşmiş konsolu hazırlar (bloklayan çağrı; servis thread'inde):
 *  1. Ağda arar; konsolun IP'si değişmişse (DHCP) kaydı günceller (eşleşme MAC = host_id).
 *  2. Bekleme modundaysa uyandırır ve hazır (READY) olana kadar bekler.
 * Konsol hiç yanıt vermezse (kapalı / farklı ağ) yine de bağlanmayı denemesi için kaydı döner.
 */
class ConsolePreparer(private val context: Context) {

    sealed interface Result {
        data class Ready(val console: RegisteredConsole) : Result
        data class NotFound(val console: RegisteredConsole) : Result
        data class WakeFailed(val console: RegisteredConsole) : Result
    }

    fun prepare(stored: RegisteredConsole, onStatus: (String) -> Unit): Result {
        var console = stored
        val found = findConsole(console)
        if (found == null) {
            Log.i(TAG, "${console.nickname} did not answer discovery; connecting directly")
            return Result.NotFound(console)
        }
        Log.i(TAG, "${console.nickname} found at ${found.host}: ${found.state}")

        if (found.host != console.host) {
            Log.i(TAG, "Console IP changed ${console.host} -> ${found.host}")
            console = console.copy(host = found.host)
            RemotePlayStore.saveConsole(context, console)
        }
        if (found.state == DiscoveredConsole.State.READY) return Result.Ready(console)

        onStatus("${console.nickname} uyandırılıyor…")
        Log.i(TAG, "Sending wakeup to ${console.host}")
        if (!PsDiscovery.wakeup(console)) return Result.WakeFailed(console)

        val deadline = SystemClock.elapsedRealtime() + WAKE_TIMEOUT_MS
        while (SystemClock.elapsedRealtime() < deadline) {
            val state = findConsole(console, PROBE_MS)?.state
            if (state == DiscoveredConsole.State.READY) {
                Log.i(TAG, "${console.nickname} is awake")
                // Sistem açıldı ama Remote Play servisi birkaç saniye daha hazırlanıyor.
                Thread.sleep(POST_WAKE_SETTLE_MS)
                return Result.Ready(console)
            }
        }
        Log.w(TAG, "${console.nickname} did not wake within ${WAKE_TIMEOUT_MS / 1000}s")
        return Result.WakeFailed(console)
    }

    /** Konsolu MAC (host_id) ile, o yoksa IP ile eşleştirir. */
    private fun findConsole(console: RegisteredConsole, timeoutMs: Long = SEARCH_MS): DiscoveredConsole? {
        val mac = console.serverMac.joinToString("") { "%02X".format(it) }
        val result = AtomicReference<DiscoveredConsole?>(null)
        val latch = CountDownLatch(1)
        val discovery = PsDiscovery()
        discovery.start({ consoles ->
            val match = consoles.firstOrNull { mac.isNotEmpty() && it.hostId.equals(mac, ignoreCase = true) }
                ?: consoles.firstOrNull { it.host == console.host }
            if (match != null && match.state != DiscoveredConsole.State.UNKNOWN) {
                result.set(match)
                latch.countDown()
            }
        }, pingMs = 500)
        latch.await(timeoutMs, TimeUnit.MILLISECONDS)
        discovery.stop()
        return result.get()
    }

    companion object {
        private const val TAG = "ConsolePreparer"
        private const val SEARCH_MS = 3_000L
        private const val PROBE_MS = 2_000L
        private const val WAKE_TIMEOUT_MS = 60_000L
        private const val POST_WAKE_SETTLE_MS = 3_000L
    }
}
