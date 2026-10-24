package com.altyazioverlay.core

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.util.Log
import org.json.JSONObject
import java.io.BufferedWriter
import java.io.OutputStreamWriter
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * Telefon -> Android TV bağlantısı (TV'deki "Altyazı TV" alıcısı).
 *
 * - TV'yi NSD (mDNS, "_altyazi._tcp") ile kendiliğinden bulur; [start]'a host verilirse
 *   doğrudan o IP'ye bağlanır (bazı modemler mDNS'i engeller).
 * - TCP üzerinden satır satır JSON gönderir (TV'deki Protocol.kt ile aynı).
 * - Bağlantı koparsa birkaç saniyede bir yeniden dener; 5 sn'de bir ping atar.
 * - Tüm ağ işi tek bir arka plan thread'inde; çağıranlar hiç bloklanmaz.
 */
object TvLink {

    enum class State { OFF, SEARCHING, CONNECTING, CONNECTED }

    data class Status(val state: State, val target: String?, val error: String?)

    fun interface Listener {
        fun onTvStatus(status: Status)
    }

    private const val TAG = "TvLink"
    private const val PORT = 47800
    private const val SERVICE_TYPE = "_altyazi._tcp."
    private const val CONNECT_TIMEOUT_MS = 3_000
    private const val RETRY_DELAY_S = 3L
    private const val PING_INTERVAL_S = 5L

    private val listeners = CopyOnWriteArraySet<Listener>()
    private var executor: ScheduledExecutorService? = null

    // Aşağıdaki alanlara yalnızca executor thread'inden dokunulur.
    private var appContext: Context? = null
    private var manualHost: String? = null
    private var socket: Socket? = null
    private var writer: BufferedWriter? = null
    private var nsdManager: NsdManager? = null
    private var discoveryListener: NsdManager.DiscoveryListener? = null
    private var resolvedHost: String? = null
    private var lastText: String = ""

    @Volatile
    var status = Status(State.OFF, null, null)
        private set

    fun addListener(l: Listener) {
        listeners.add(l)
        l.onTvStatus(status)
    }

    fun removeListener(l: Listener) {
        listeners.remove(l)
    }

    /** @param host null/boş ise TV ağda aranır. */
    fun start(context: Context, host: String?) {
        stop()
        val exec = Executors.newSingleThreadScheduledExecutor { Thread(it, "TvLink") }
        executor = exec
        exec.execute {
            appContext = context.applicationContext
            manualHost = host?.trim()?.ifEmpty { null }
            connectOrDiscover()
        }
        exec.scheduleWithFixedDelay({ send(JSONObject().put("t", "ping")) }, PING_INTERVAL_S, PING_INTERVAL_S, TimeUnit.SECONDS)
    }

    fun stop() {
        val exec = executor ?: return
        executor = null
        exec.execute {
            stopDiscovery()
            closeSocket()
            setStatus(State.OFF, null, null)
        }
        exec.shutdown()
    }

    /** Çeviriyi TV'ye yollar. Boş metin TV'deki altyazıyı gizler. Bağlı değilse sessizce düşer. */
    fun sendSubtitle(text: String) {
        executor?.execute {
            lastText = text
            send(JSONObject().put("t", "sub").put("text", text))
        }
    }

    /** Altyazı görünümünü TV'ye yollar. Bağlı değilse bağlanınca [SubtitleStyle.current] gider. */
    fun sendStyle(style: SubtitleStyle) {
        executor?.execute { send(style.toJson().put("t", "style")) }
    }

    // ------------------------------------------------------------------ connection (executor thread)

    private fun connectOrDiscover() {
        val host = manualHost ?: resolvedHost
        if (host != null) connect(host) else startDiscovery()
    }

    private fun connect(host: String) {
        setStatus(State.CONNECTING, host, null)
        try {
            val s = Socket()
            s.tcpNoDelay = true
            s.connect(InetSocketAddress(host, PORT), CONNECT_TIMEOUT_MS)
            socket = s
            writer = BufferedWriter(OutputStreamWriter(s.getOutputStream(), Charsets.UTF_8))
            setStatus(State.CONNECTED, host, null)
            Log.i(TAG, "Connected to TV $host")
            send(JSONObject().put("t", "hello").put("name", "${Build.MANUFACTURER} ${Build.MODEL}"))
            send(SubtitleStyle.current.toJson().put("t", "style"))
            // Bağlantı yeniden kurulduysa ekrandaki altyazıyı tazele.
            if (lastText.isNotEmpty()) send(JSONObject().put("t", "sub").put("text", lastText))
        } catch (e: Exception) {
            Log.w(TAG, "Connect to $host failed: ${e.message}")
            closeSocket()
            if (manualHost == null) resolvedHost = null  // TV'nin IP'si değişmiş olabilir: yeniden ara
            setStatus(State.CONNECTING, host, "TV'ye bağlanılamadı (${e.message})")
            scheduleRetry()
        }
    }

    private fun send(json: JSONObject) {
        val w = writer ?: return
        try {
            w.write(json.toString())
            w.write("\n")
            w.flush()
        } catch (e: Exception) {
            Log.w(TAG, "Send failed, reconnecting: ${e.message}")
            closeSocket()
            setStatus(State.CONNECTING, status.target, "Bağlantı koptu")
            scheduleRetry()
        }
    }

    private fun scheduleRetry() {
        val exec = executor ?: return
        if (exec.isShutdown) return
        exec.schedule({ if (socket == null) connectOrDiscover() }, RETRY_DELAY_S, TimeUnit.SECONDS)
    }

    private fun closeSocket() {
        runCatching { socket?.close() }
        socket = null
        writer = null
    }

    // ------------------------------------------------------------------ NSD (mDNS)

    private fun startDiscovery() {
        if (discoveryListener != null) return
        val ctx = appContext ?: return
        val manager = ctx.getSystemService(Context.NSD_SERVICE) as NsdManager
        nsdManager = manager
        setStatus(State.SEARCHING, null, null)

        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) {
                Log.i(TAG, "Searching for TV…")
            }

            override fun onServiceFound(info: NsdServiceInfo) {
                @Suppress("DEPRECATION")
                manager.resolveService(info, object : NsdManager.ResolveListener {
                    override fun onServiceResolved(resolved: NsdServiceInfo) {
                        @Suppress("DEPRECATION")
                        val host = resolved.host?.hostAddress ?: return
                        executor?.execute {
                            if (socket != null) return@execute
                            Log.i(TAG, "Found TV ${resolved.serviceName} at $host")
                            resolvedHost = host
                            stopDiscovery()
                            connect(host)
                        }
                    }

                    override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {
                        Log.w(TAG, "Resolve failed: $errorCode")
                    }
                })
            }

            override fun onServiceLost(info: NsdServiceInfo) = Unit
            override fun onDiscoveryStopped(serviceType: String) = Unit

            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                executor?.execute {
                    discoveryListener = null
                    setStatus(State.SEARCHING, null, "Ağda arama başlatılamadı ($errorCode); TV IP'sini elle girin")
                    scheduleRetry()
                }
            }

            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) = Unit
        }
        discoveryListener = listener
        manager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
    }

    private fun stopDiscovery() {
        val listener = discoveryListener ?: return
        discoveryListener = null
        runCatching { nsdManager?.stopServiceDiscovery(listener) }
    }

    private fun setStatus(state: State, target: String?, error: String?) {
        status = Status(state, target, error)
        listeners.forEach { it.onTvStatus(status) }
    }
}
