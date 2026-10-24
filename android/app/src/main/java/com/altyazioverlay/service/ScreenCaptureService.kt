package com.altyazioverlay.service

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.altyazioverlay.MainActivity
import com.altyazioverlay.capture.ScreenCaptureManager
import com.altyazioverlay.core.OverlayController
import com.altyazioverlay.core.SubtitleEventBus
import com.altyazioverlay.ocr.SubtitlePipeline
import com.altyazioverlay.ocr.TextRecognizerEngine
import com.altyazioverlay.overlay.FloatingSubtitleWindow

/**
 * MediaProjection'ı tutan ön plan servisi. Tüm ağır iş (yakalama, kırpma, diff, OCR)
 * bu servisin arka plan thread'inde yürür; JS'e sadece değişen metin gider.
 *
 * Android 14+ kuralları:
 *  - startForeground(type = MEDIA_PROJECTION) getMediaProjection()'dan ÖNCE çağrılmalı.
 *  - MediaProjection.Callback, createVirtualDisplay()'den önce kaydedilmeli.
 *  - Her izin token'ı tek bir oturum içindir; servis durunca yeniden izin istenir.
 */
class ScreenCaptureService : Service() {

    private val mainHandler = Handler(Looper.getMainLooper())

    private var projection: MediaProjection? = null
    private var captureManager: ScreenCaptureManager? = null
    private var pipeline: SubtitlePipeline? = null
    private var overlay: FloatingSubtitleWindow? = null

    private val projectionCallback = object : MediaProjection.Callback() {
        override fun onStop() {
            // Kullanıcı sistem çipinden / bildirimden paylaşımı durdurdu.
            Log.i(TAG, "MediaProjection stopped by system/user")
            stopSelf()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_START -> handleStart(intent)
            else -> stopSelf()
        }
        // Token yeniden kullanılamadığı için sistem servisi tekrar başlatmamalı.
        return START_NOT_STICKY
    }

    private fun handleStart(intent: Intent) {
        if (projection != null) {
            Log.w(TAG, "Capture already running, ignoring duplicate start")
            return
        }

        // 1) Önce foreground'a geç (Android 14+ zorunlu sıralama).
        startInForeground()

        val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
        val resultData: Intent? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(EXTRA_RESULT_DATA)
        }
        val config = CaptureConfig.fromBundle(intent.getBundleExtra(EXTRA_CONFIG))

        if (resultCode != Activity.RESULT_OK || resultData == null) {
            fail("Ekran yakalama izni geçersiz")
            return
        }

        try {
            val mpm = getSystemService(MediaProjectionManager::class.java)
            val mp = mpm.getMediaProjection(resultCode, resultData)
                ?: return fail("MediaProjection alınamadı")
            // 2) Callback'i sanal ekrandan önce kaydet.
            mp.registerCallback(projectionCallback, mainHandler)
            projection = mp

            // 3) Yüzen pencere (ana thread'de eklenir).
            val window = FloatingSubtitleWindow(applicationContext, config.cropRatio)
            window.attach()
            OverlayController.attach(window)
            overlay = window

            // 4) OCR hattı + yakalama.
            val manager = ScreenCaptureManager(applicationContext, mp, config)
            val pipe = SubtitlePipeline(
                config = config,
                recognizer = TextRecognizerEngine(manager.callbackExecutor, config.cropRatio),
                onSubtitle = SubtitleEventBus::publishSubtitle,
                debugDir = if (isDebuggable()) getExternalFilesDir("debug") else null,
            )
            manager.start(pipe)
            pipeline = pipe
            captureManager = manager

            isRunning = true
            SubtitleEventBus.publishState(running = true)
        } catch (t: Throwable) {
            Log.e(TAG, "Failed to start capture", t)
            fail(t.message ?: "Yakalama başlatılamadı")
        }
    }

    private fun isDebuggable(): Boolean =
        (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

    private fun fail(message: String) {
        SubtitleEventBus.publishState(running = false, error = message)
        stopSelf()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // Dönüşte (portrait <-> landscape) sanal ekranı ve pencere konumunu güncelle.
        captureManager?.onDisplayChanged()
        overlay?.relayout()
    }

    override fun onDestroy() {
        captureManager?.stop()
        captureManager = null
        pipeline?.close()
        pipeline = null

        overlay?.let {
            OverlayController.detach(it)
            it.detach()
        }
        overlay = null

        projection?.let {
            it.unregisterCallback(projectionCallback)
            it.stop()
        }
        projection = null

        if (isRunning) {
            isRunning = false
            SubtitleEventBus.publishState(running = false)
        }
        super.onDestroy()
    }

    // ---------------------------------------------------------------- notification

    private fun startInForeground() {
        createChannel()
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        } else {
            0
        }
        ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), type)
    }

    private fun buildNotification(): Notification {
        val piFlags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val openApp = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), piFlags,
        )
        val stop = PendingIntent.getService(
            this, 1, Intent(this, ScreenCaptureService::class.java).setAction(ACTION_STOP), piFlags,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("Altyazı çevirisi aktif")
            .setContentText("Ekranın alt kısmı okunuyor")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(openApp)
            .addAction(0, "Durdur", stop)
            .build()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Altyazı yakalama", NotificationManager.IMPORTANCE_LOW).apply {
                setShowBadge(false)
            },
        )
    }

    companion object {
        private const val TAG = "ScreenCaptureService"
        private const val CHANNEL_ID = "subtitle_capture"
        private const val NOTIFICATION_ID = 4201

        const val ACTION_START = "com.altyazioverlay.action.START_CAPTURE"
        const val ACTION_STOP = "com.altyazioverlay.action.STOP_CAPTURE"
        private const val EXTRA_RESULT_CODE = "resultCode"
        private const val EXTRA_RESULT_DATA = "resultData"
        private const val EXTRA_CONFIG = "config"

        @Volatile
        var isRunning: Boolean = false
            private set

        fun start(context: Context, resultCode: Int, resultData: Intent, config: CaptureConfig) {
            val intent = Intent(context, ScreenCaptureService::class.java)
                .setAction(ACTION_START)
                .putExtra(EXTRA_RESULT_CODE, resultCode)
                .putExtra(EXTRA_RESULT_DATA, resultData)
                .putExtra(EXTRA_CONFIG, config.toBundle())
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            context.startService(
                Intent(context, ScreenCaptureService::class.java).setAction(ACTION_STOP),
            )
        }
    }
}
