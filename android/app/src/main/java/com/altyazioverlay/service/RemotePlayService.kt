package com.altyazioverlay.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.altyazioverlay.MainActivity
import com.altyazioverlay.capture.RemotePlayFrameSource
import com.altyazioverlay.core.OverlayController
import com.altyazioverlay.core.SubtitleEventBus
import com.altyazioverlay.ocr.SubtitlePipeline
import com.altyazioverlay.ocr.TextRecognizerEngine
import com.altyazioverlay.overlay.FloatingSubtitleWindow
import com.altyazioverlay.remoteplay.RegisteredConsole
import com.altyazioverlay.remoteplay.RemotePlayClient
import com.altyazioverlay.remoteplay.SessionFailure
import com.altyazioverlay.remoteplay.StreamSettings

/**
 * PS5 Remote Play yayınını arka planda alıp OCR hattına veren ön plan servisi.
 * Ekran yakalama ([ScreenCaptureService]) yerine geçer: izin penceresi yok, telefon ekranı
 * kapalıyken de çalışır, kareler doğrudan video çözücüden gelir.
 *
 * - CPU ve Wi-Fi kilitleri: ekran kapalıyken ağ ve çözücü uyumasın.
 * - Bağlantı koparsa (PS5 uykuya geçti, Wi-Fi gitti...) artan aralıklarla yeniden bağlanır;
 *   sadece kullanıcı durdurunca biter.
 */
class RemotePlayService : Service() {

    private lateinit var worker: Handler
    private lateinit var workerThread: HandlerThread

    private val client = RemotePlayClient()
    private var frameSource: RemotePlayFrameSource? = null
    private var pipeline: SubtitlePipeline? = null
    private var overlay: FloatingSubtitleWindow? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

    private var console: RegisteredConsole? = null
    private var config = CaptureConfig()
    @Volatile private var stopping = false
    private var retryAttempt = 0

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        workerThread = HandlerThread("RemotePlayService").apply { start() }
        worker = Handler(workerThread.looper)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_START -> handleStart(intent)
            else -> stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun handleStart(intent: Intent) {
        startInForeground()
        if (isRunning) return
        val stored = RemotePlayStore.loadConsole(this)
        if (stored == null) {
            fail("Önce PS5 ile eşleştirin")
            return
        }
        console = stored
        config = CaptureConfig.fromBundle(intent.getBundleExtra(EXTRA_CONFIG))
        acquireLocks()

        if (Settings.canDrawOverlays(this)) {
            overlay = FloatingSubtitleWindow(applicationContext, config.cropRatio).also {
                it.attach()
                OverlayController.attach(it)
            }
        }

        val source = RemotePlayFrameSource(config)
        val pipe = SubtitlePipeline(
            config = config,
            recognizer = TextRecognizerEngine(source.callbackExecutor, config.cropRatio),
            onSubtitle = SubtitleEventBus::publishSubtitle,
            debugDir = if (isDebuggable()) getExternalFilesDir("debug") else null,
        )
        source.start(pipe)
        frameSource = source
        pipeline = pipe

        isRunning = true
        SubtitleEventBus.publishState(running = true)
        worker.post(::connect)
    }

    // ------------------------------------------------------------------ session

    private fun connect() {
        val stored = console ?: return
        if (stopping) return
        updateNotification("${stored.nickname} aranıyor…")
        // Bulma + gerekirse uyandırma (bloklar; worker thread'indeyiz).
        val target = when (val r = ConsolePreparer(this).prepare(stored, ::updateNotification)) {
            is ConsolePreparer.Result.Ready -> r.console
            is ConsolePreparer.Result.NotFound -> r.console  // yanıt yok: yine de doğrudan dene
            is ConsolePreparer.Result.WakeFailed -> {
                scheduleReconnect("${stored.nickname} uyandırılamadı")
                return
            }
        }
        console = target
        if (stopping) return
        updateNotification("${target.nickname}'a bağlanılıyor…")
        val started = client.start(
            target,
            StreamSettings(),
            object : RemotePlayClient.SessionListener {
                override fun onConnected() {
                    retryAttempt = 0
                    updateNotification("${target.nickname} · altyazılar okunuyor")
                    SubtitleEventBus.publishState(running = true)
                }

                override fun onDisconnected(reason: String, isError: Boolean, failure: SessionFailure?) {
                    if (stopping) return
                    Log.w(TAG, "Stream ended: $reason (${failure ?: "-"})")
                    // chiaki'nin kendi thread'indeyiz: oturumu oradan durdurmak kilitlenir.
                    worker.post {
                        client.stop()
                        when {
                            // Yeniden denemek işe yaramaz (ör. Remote Play kapalı): dur ve söyle.
                            failure != null && !failure.retryable -> fail(failure.message)
                            failure != null -> scheduleReconnect(failure.message)
                            else -> scheduleReconnect("Bağlantı koptu: $reason")
                        }
                    }
                }
            },
            { image -> frameSource?.onDecodedFrame(image) },
        )
        if (!started) scheduleReconnect("PS5'e bağlanılamadı (açık ve aynı ağda mı?)")
    }

    private fun scheduleReconnect(message: String) {
        if (stopping) return
        val delayMs = RETRY_DELAYS_MS[minOf(retryAttempt, RETRY_DELAYS_MS.lastIndex)]
        retryAttempt++
        Log.i(TAG, "$message -> retry in ${delayMs}ms")
        SubtitleEventBus.publishState(running = true, error = "$message · yeniden deneniyor")
        updateNotification("$message · ${delayMs / 1000} sn sonra tekrar")
        OverlayController.showText("")
        worker.postDelayed(::connect, delayMs)
    }

    private fun fail(message: String) {
        SubtitleEventBus.publishState(running = false, error = message)
        stopSelf()
    }

    override fun onDestroy() {
        stopping = true
        worker.removeCallbacksAndMessages(null)
        // Oturumu kapat (chiaki join) ve kaynakları bırak; hepsi worker thread'inde, sırayla.
        worker.post {
            client.stop()
            frameSource?.stop()
            pipeline?.close()
        }
        workerThread.quitSafely()
        frameSource = null
        pipeline = null
        overlay?.let {
            OverlayController.detach(it)
            it.detach()
        }
        overlay = null
        releaseLocks()
        if (isRunning) {
            isRunning = false
            SubtitleEventBus.publishState(running = false)
        }
        super.onDestroy()
    }

    // ------------------------------------------------------------------ locks

    private fun acquireLocks() {
        val pm = getSystemService(PowerManager::class.java)
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Altyazi:RemotePlay").apply {
            setReferenceCounted(false)
            acquire()
        }
        val wm = applicationContext.getSystemService(WifiManager::class.java)
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            WifiManager.WIFI_MODE_FULL_LOW_LATENCY
        } else {
            @Suppress("DEPRECATION")
            WifiManager.WIFI_MODE_FULL_HIGH_PERF
        }
        wifiLock = wm.createWifiLock(mode, "Altyazi:RemotePlay").apply {
            setReferenceCounted(false)
            acquire()
        }
    }

    private fun releaseLocks() {
        runCatching { wakeLock?.release() }
        runCatching { wifiLock?.release() }
        wakeLock = null
        wifiLock = null
    }

    private fun isDebuggable() = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

    // ------------------------------------------------------------------ notification

    private fun startInForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL_ID) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Remote Play altyazı", NotificationManager.IMPORTANCE_LOW).apply {
                    setShowBadge(false)
                },
            )
        }
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
        } else {
            0
        }
        ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification("Başlatılıyor…"), type)
    }

    private fun buildNotification(text: String): Notification {
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), flags)
        val stop = PendingIntent.getService(
            this, 1, Intent(this, RemotePlayService::class.java).setAction(ACTION_STOP), flags,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("Altyazı çevirisi (PS5)")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(open)
            .addAction(0, "Durdur", stop)
            .build()
    }

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification(text))
    }

    companion object {
        private const val TAG = "RemotePlayService"
        private const val CHANNEL_ID = "remote_play"
        private const val NOTIFICATION_ID = 4202
        private const val ACTION_START = "com.altyazioverlay.action.START_REMOTE_PLAY"
        private const val ACTION_STOP = "com.altyazioverlay.action.STOP_REMOTE_PLAY"
        private const val EXTRA_CONFIG = "config"
        private val RETRY_DELAYS_MS = longArrayOf(2_000, 5_000, 10_000, 30_000)

        @Volatile
        var isRunning: Boolean = false
            private set

        fun start(context: Context, config: CaptureConfig) {
            val intent = Intent(context, RemotePlayService::class.java)
                .setAction(ACTION_START)
                .putExtra(EXTRA_CONFIG, config.toBundle())
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            context.startService(Intent(context, RemotePlayService::class.java).setAction(ACTION_STOP))
        }
    }
}

/** Eşleşmiş konsolun kalıcı kaydı (uygulamaya özel SharedPreferences). */
object RemotePlayStore {
    private const val PREFS = "altyazi_settings"
    private const val KEY_CONSOLE = "rp_console"

    fun loadConsole(context: Context): RegisteredConsole? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_CONSOLE, null)
            ?.let { runCatching { RegisteredConsole.fromJson(it) }.getOrNull() }

    fun saveConsole(context: Context, console: RegisteredConsole) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_CONSOLE, console.toJson()).apply()
    }

    fun forgetConsole(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY_CONSOLE).apply()
    }
}
