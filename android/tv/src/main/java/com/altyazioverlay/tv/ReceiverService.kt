package com.altyazioverlay.tv

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.CopyOnWriteArraySet
import kotlin.concurrent.thread

/**
 * Telefondan gelen çevirileri dinleyen ön plan servisi.
 *
 * - [Protocol.PORT] üzerinde TCP dinler; aynı anda tek telefon (yeni bağlanan eskisinin yerini alır).
 * - NSD (mDNS) ile "_altyazi._tcp" olarak kendini duyurur: telefon IP girmeden bulur.
 * - Gelen metni [SubtitleOverlay] ile HDMI görüntüsünün üstüne yazar.
 */
class ReceiverService : Service() {

    data class Status(
        val listening: Boolean = false,
        val clientName: String? = null,
        val lastText: String = "",
        val overlayReady: Boolean = false,
    )

    private lateinit var settings: TvSettings
    private lateinit var overlay: SubtitleOverlay

    @Volatile private var serverSocket: ServerSocket? = null
    @Volatile private var client: Socket? = null
    @Volatile private var running = false
    private var nsdManager: NsdManager? = null
    private var nsdListener: NsdManager.RegistrationListener? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        settings = TvSettings(this)
        overlay = SubtitleOverlay(this, settings)
        startInForeground()
        updateStatus { it.copy(overlayReady = overlay.attach()) }
        running = true
        thread(name = "AltyaziServer", isDaemon = true) { serverLoop() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // İzin sonradan (adb ile) verildiyse pencereyi şimdi ekle.
        if (!status.overlayReady) updateStatus { it.copy(overlayReady = overlay.attach()) }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        unregisterNsd()
        runCatching { client?.close() }
        runCatching { serverSocket?.close() }
        overlay.detach()
        instance = null
        updateStatus { Status() }
        super.onDestroy()
    }

    /** Ana thread'den (ayar ekranı) çağrılır. */
    fun applySettings() = overlay.applySettings()

    fun showTest(text: String) = overlay.show(text)

    // ------------------------------------------------------------------ server

    private fun serverLoop() {
        try {
            val server = ServerSocket(Protocol.PORT).apply { reuseAddress = true }
            serverSocket = server
            registerNsd(server.localPort)
            updateStatus { it.copy(listening = true) }
            Log.i(TAG, "Listening on ${server.localPort}")
            while (running) {
                val socket = server.accept()
                // Yeni telefon bağlandı: eskisini kapat (okuma döngüsü kendiliğinden biter).
                runCatching { client?.close() }
                client = socket
                thread(name = "AltyaziClient", isDaemon = true) { clientLoop(socket) }
            }
        } catch (e: Exception) {
            if (running) Log.e(TAG, "Server stopped", e)
        } finally {
            updateStatus { it.copy(listening = false, clientName = null) }
        }
    }

    private fun clientLoop(socket: Socket) {
        val remote = socket.inetAddress?.hostAddress ?: "?"
        Log.i(TAG, "Phone connected: $remote")
        updateStatus { it.copy(clientName = remote) }
        try {
            // Telefon 5 sn'de bir ping atar; 15 sn ses yoksa bağlantı ölü sayılır.
            socket.soTimeout = READ_TIMEOUT_MS
            val reader = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.UTF_8))
            while (running) {
                val line = try {
                    reader.readLine()
                } catch (_: SocketTimeoutException) {
                    Log.w(TAG, "Phone silent for ${READ_TIMEOUT_MS}ms, dropping")
                    break
                } ?: break
                handleMessage(line)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Client error: ${e.message}")
        } finally {
            runCatching { socket.close() }
            if (client === socket) {
                client = null
                overlay.show("")
                updateStatus { it.copy(clientName = null) }
            }
            Log.i(TAG, "Phone disconnected: $remote")
        }
    }

    private fun handleMessage(line: String) {
        val msg = runCatching { JSONObject(line) }.getOrNull() ?: return
        when (msg.optString("t")) {
            "sub" -> {
                val text = msg.optString("text")
                overlay.show(text)
                updateStatus { it.copy(lastText = text) }
            }
            "style" -> {
                settings.saveStyle(msg)
                overlay.applySettings()
            }
            "hello" -> updateStatus { it.copy(clientName = msg.optString("name").ifBlank { it.clientName }) }
            "ping" -> Unit
        }
    }

    // ------------------------------------------------------------------ NSD

    private fun registerNsd(port: Int) {
        val manager = getSystemService(Context.NSD_SERVICE) as NsdManager
        val info = NsdServiceInfo().apply {
            serviceName = "Altyazı TV (${Build.MODEL})"
            serviceType = Protocol.SERVICE_TYPE
            setPort(port)
        }
        val listener = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(info: NsdServiceInfo) {
                Log.i(TAG, "NSD registered: ${info.serviceName}")
            }
            override fun onRegistrationFailed(info: NsdServiceInfo, code: Int) {
                Log.w(TAG, "NSD failed: $code")
            }
            override fun onServiceUnregistered(info: NsdServiceInfo) = Unit
            override fun onUnregistrationFailed(info: NsdServiceInfo, code: Int) = Unit
        }
        manager.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener)
        nsdManager = manager
        nsdListener = listener
    }

    private fun unregisterNsd() {
        val listener = nsdListener ?: return
        runCatching { nsdManager?.unregisterService(listener) }
        nsdListener = null
    }

    // ------------------------------------------------------------------ foreground

    private fun startInForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL_ID) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Altyazı alıcısı", NotificationManager.IMPORTANCE_LOW),
            )
        }
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("Altyazı TV")
            .setContentText("Telefondan çeviri bekleniyor")
            .setOngoing(true)
            .build()
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
        } else {
            0
        }
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
    }

    companion object {
        private const val TAG = "AltyaziTv"
        private const val CHANNEL_ID = "receiver"
        private const val NOTIFICATION_ID = 4801
        private const val READ_TIMEOUT_MS = 15_000

        @Volatile
        var instance: ReceiverService? = null
            private set

        @Volatile
        var status: Status = Status()
            private set

        private val listeners = CopyOnWriteArraySet<(Status) -> Unit>()

        fun addListener(l: (Status) -> Unit) { listeners.add(l); l(status) }
        fun removeListener(l: (Status) -> Unit) { listeners.remove(l) }

        private fun updateStatus(change: (Status) -> Status) {
            status = change(status)
            listeners.forEach { it(status) }
        }

        fun start(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, ReceiverService::class.java))
        }
    }
}
