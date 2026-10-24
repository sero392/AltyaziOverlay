package com.altyazioverlay.overlay

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Point
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.hardware.display.DisplayManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.TypedValue
import android.view.Display
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView

/**
 * Diğer uygulamaların (Chiaki vb.) üzerinde duran, dokunmaları tamamen alttaki uygulamaya
 * geçiren şeffaf altyazı penceresi. Saf native View — RN render ağacı yok, köprü maliyeti yok.
 *
 * Dokunma geçirgenliği:
 *  - FLAG_NOT_TOUCHABLE + FLAG_NOT_FOCUSABLE: pencere hiçbir girdi almaz.
 *  - Android 12+ "untrusted touch" engeli: Başka uygulamanın overlay'i dokunmayı ancak
 *    pencere opaklığı <= 0.8 ise geçirir. Bu yüzden window alpha = 0.8.
 *
 * Geri besleme döngüsü önlemi:
 *  - FLAG_SECURE: pencere MediaProjection çıktısında görünmez (siyah), kendi Türkçe
 *    metnimizi tekrar OCR'lamayız.
 *  - Pencere, okunan alt bölgenin hemen ÜSTÜNE konur; böylece siyah alan orijinal
 *    altyazının üstünü örtmez.
 */
class FloatingSubtitleWindow(
    context: Context,
    private val captureRatio: Float,
) {
    private val appContext = context.applicationContext
    private val windowManager = appContext.getSystemService(WindowManager::class.java)
    private val mainHandler = Handler(Looper.getMainLooper())

    private var container: FrameLayout? = null
    private var textView: TextView? = null
    private var params: WindowManager.LayoutParams? = null
    private var lastText: String = ""

    fun attach() = runOnMain {
        if (container != null) return@runOnMain

        val tv = TextView(appContext).apply {
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setShadowLayer(6f, 0f, 0f, Color.BLACK)
            setPadding(dp(16), dp(8), dp(16), dp(8))
            background = GradientDrawable().apply {
                cornerRadius = dp(10).toFloat()
                setColor(Color.argb(170, 0, 0, 0))
            }
            maxLines = 3
            visibility = View.GONE
        }

        val root = FrameLayout(appContext).apply {
            addView(
                tv,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.WRAP_CONTENT,
                    FrameLayout.LayoutParams.WRAP_CONTENT,
                    Gravity.CENTER_HORIZONTAL,
                ),
            )
        }

        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_SECURE,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            y = bottomOffsetPx()
            alpha = MAX_PASSTHROUGH_ALPHA
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }

        try {
            windowManager.addView(root, lp)
            container = root
            textView = tv
            params = lp
        } catch (e: Exception) {
            // Genellikle SYSTEM_ALERT_WINDOW izni yok.
            Log.e(TAG, "Overlay could not be added", e)
        }
    }

    /** Herhangi bir thread'den çağrılabilir. Boş metin pencereyi gizler. */
    fun setText(text: String) = runOnMain {
        val tv = textView ?: return@runOnMain
        if (text == lastText) return@runOnMain
        lastText = text
        if (text.isBlank()) {
            tv.visibility = View.GONE
        } else {
            tv.text = text
            tv.visibility = View.VISIBLE
        }
    }

    /** Ekran dönünce konum yeniden hesaplanır. */
    fun relayout() = runOnMain {
        val root = container ?: return@runOnMain
        val lp = params ?: return@runOnMain
        lp.y = bottomOffsetPx()
        windowManager.updateViewLayout(root, lp)
    }

    fun detach() = runOnMain {
        container?.let {
            try {
                windowManager.removeViewImmediate(it)
            } catch (_: Exception) {
            }
        }
        container = null
        textView = null
        params = null
    }

    private fun bottomOffsetPx(): Int {
        val dm = appContext.getSystemService(DisplayManager::class.java)
        val size = Point()
        @Suppress("DEPRECATION")
        dm.getDisplay(Display.DEFAULT_DISPLAY).getRealSize(size)
        return (size.y * captureRatio).toInt() + dp(4)
    }

    private fun dp(v: Int): Int =
        TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), appContext.resources.displayMetrics,
        ).toInt()

    private inline fun runOnMain(crossinline block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block() else mainHandler.post { block() }
    }

    companion object {
        private const val TAG = "FloatingSubtitleWindow"
        /** InputManager.getMaximumObscuringOpacityForTouch() varsayılanı (Android 12+). */
        private const val MAX_PASSTHROUGH_ALPHA = 0.8f
    }
}
