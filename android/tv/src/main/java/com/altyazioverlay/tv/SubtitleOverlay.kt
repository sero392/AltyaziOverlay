package com.altyazioverlay.tv

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView

/**
 * TV'de açık olan girişin (HDMI / PS5) üstünde duran altyazı penceresi.
 *
 * - Odak almaz ve dokunulmaz: kumanda tuşları alttaki uygulamaya (TV girişine) gider.
 * - Telefon "" gönderirse ya da [AUTO_HIDE_MS] boyunca yeni metin gelmezse gizlenir
 *   (telefonla bağlantı koparsa eski çeviri ekranda asılı kalmasın).
 */
class SubtitleOverlay(context: Context, private val settings: TvSettings) {

    private val appContext = context.applicationContext
    private val windowManager = appContext.getSystemService(WindowManager::class.java)
    private val mainHandler = Handler(Looper.getMainLooper())

    private var root: FrameLayout? = null
    private var textView: TextView? = null
    private var params: WindowManager.LayoutParams? = null

    private val autoHide = Runnable { textView?.visibility = View.GONE }

    val canDraw: Boolean get() = Settings.canDrawOverlays(appContext)

    fun attach(): Boolean {
        if (root != null) return true
        if (!canDraw) {
            Log.w(TAG, "SYSTEM_ALERT_WINDOW izni yok; adb ile verilmeli")
            return false
        }

        val tv = TextView(appContext).apply {
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setShadowLayer(8f, 0f, 0f, Color.BLACK)
            setPadding(dp(28), dp(12), dp(28), dp(12))
            background = GradientDrawable().apply {
                cornerRadius = dp(12).toFloat()
            }
            maxLines = 3
            visibility = View.GONE
        }
        val container = FrameLayout(appContext).apply {
            addView(
                tv,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.WRAP_CONTENT,
                    FrameLayout.LayoutParams.WRAP_CONTENT,
                    Gravity.CENTER_HORIZONTAL,
                ),
            )
        }
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        )

        return try {
            windowManager.addView(container, lp)
            root = container
            textView = tv
            params = lp
            applySettings()
            true
        } catch (e: Exception) {
            Log.e(TAG, "Overlay eklenemedi", e)
            false
        }
    }

    /** Konum ya da telefondan gelen stil değişince çağrılır. Herhangi bir thread'den çağrılabilir. */
    fun applySettings() = mainHandler.post {
        val tv = textView ?: return@post
        val lp = params ?: return@post
        val style = settings.style
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, style.fontSize)
        tv.setTextColor(style.textColor)
        (tv.background as? GradientDrawable)?.setColor(style.bgColor)
        val screenHeight = appContext.resources.displayMetrics.heightPixels
        when (settings.position) {
            TvSettings.Position.BOTTOM -> {
                lp.gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
                lp.y = (screenHeight * 0.06f).toInt()
            }
            TvSettings.Position.MIDDLE_LOW -> {
                lp.gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
                lp.y = (screenHeight * 0.22f).toInt()
            }
            TvSettings.Position.TOP -> {
                lp.gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
                lp.y = (screenHeight * 0.06f).toInt()
            }
        }
        root?.let { windowManager.updateViewLayout(it, lp) }
    }

    /** Herhangi bir thread'den çağrılabilir. Boş metin gizler. */
    fun show(text: String) = mainHandler.post {
        val tv = textView ?: return@post
        mainHandler.removeCallbacks(autoHide)
        if (text.isBlank()) {
            tv.visibility = View.GONE
        } else {
            tv.text = text
            tv.visibility = View.VISIBLE
            mainHandler.postDelayed(autoHide, AUTO_HIDE_MS)
        }
    }

    fun detach() = mainHandler.post {
        mainHandler.removeCallbacks(autoHide)
        root?.let { runCatching { windowManager.removeViewImmediate(it) } }
        root = null
        textView = null
        params = null
    }

    private fun dp(v: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), appContext.resources.displayMetrics).toInt()

    companion object {
        private const val TAG = "SubtitleOverlay"
        private const val AUTO_HIDE_MS = 12_000L
    }
}
