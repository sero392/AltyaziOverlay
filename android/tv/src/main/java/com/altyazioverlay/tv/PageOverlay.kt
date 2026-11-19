package com.altyazioverlay.tv

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Point
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView
import androidx.core.widget.TextViewCompat
import org.json.JSONArray
import kotlin.math.roundToInt

/** Tüm sayfa çevirisinin tek yazısı: çeviri + İngilizce aslının karedeki yeri. */
data class PageItem(val text: String, val box: SubtitleBox, val lines: Int = 1) {
    companion object {
        fun listFromJson(arr: JSONArray?): List<PageItem> {
            arr ?: return emptyList()
            return (0 until arr.length()).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                val text = o.optString("text").trim()
                val box = SubtitleBox.fromJson(o.optJSONObject("box"))
                if (text.isEmpty() || box == null) null else PageItem(text, box, o.optInt("lines", 1))
            }
        }
    }
}

/**
 * "Tüm sayfayı çevir": her çeviriyi İngilizce yazının tam üstüne, kendi kutusunda yazan tam ekran
 * pencere. Kutu İngilizceyi örtecek kadar opaktır; yazı kutuya sığacak şekilde küçülür.
 *
 * - Odak almaz ve dokunulmaz (kumanda tuşları HDMI girişine gider).
 * - Gönderen [AUTO_HIDE_MS] boyunca sayfa yollamazsa gizlenir (bağlantı koparsa eski çeviri kalmasın);
 *   gönderen ekrandaki sayfayı bu yüzden belli aralıklarla tekrar yollar.
 */
class PageOverlay(context: Context, private val settings: TvSettings) {

    private val appContext = context.applicationContext
    private val windowManager = appContext.getSystemService(WindowManager::class.java)
    private val mainHandler = Handler(Looper.getMainLooper())

    private var root: FrameLayout? = null
    private var items: List<PageItem> = emptyList()

    private val autoHide = Runnable { render(emptyList()) }
    private val measurePaint = android.text.TextPaint().apply { typeface = Typeface.DEFAULT_BOLD }

    fun attach(): Boolean {
        if (root != null) return true
        val container = FrameLayout(appContext)
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 0
            y = 0
        }
        return try {
            windowManager.addView(container, lp)
            root = container
            true
        } catch (e: Exception) {
            Log.e(TAG, "Sayfa penceresi eklenemedi", e)
            false
        }
    }

    /** Herhangi bir thread'den çağrılabilir. Boş liste sayfayı temizler. */
    fun show(next: List<PageItem>) = mainHandler.post {
        mainHandler.removeCallbacks(autoHide)
        if (next.isNotEmpty()) mainHandler.postDelayed(autoHide, AUTO_HIDE_MS)
        if (next == items) return@post
        render(next)
    }

    /** Stil değişince mevcut sayfayı yeniden çizer. */
    fun applySettings() = mainHandler.post { render(items, force = true) }

    fun detach() = mainHandler.post {
        mainHandler.removeCallbacks(autoHide)
        root?.let { runCatching { windowManager.removeViewImmediate(it) } }
        root = null
        items = emptyList()
    }

    private fun render(next: List<PageItem>, force: Boolean = false) {
        val container = root ?: return
        if (!force && next == items) return
        items = next
        container.removeAllViews()
        if (next.isEmpty()) return

        val size = Point()
        @Suppress("DEPRECATION")
        windowManager.defaultDisplay.getRealSize(size)
        val sw = size.x
        val sh = size.y
        val style = settings.style
        val bg = Color.argb(
            maxOf(Color.alpha(style.bgColor), MIN_BG_ALPHA),
            Color.red(style.bgColor), Color.green(style.bgColor), Color.blue(style.bgColor),
        )
        val maxTextPx = TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_SP, style.fontSize, appContext.resources.displayMetrics,
        )

        for (item in next) {
            val b = item.box
            // Kutu İngilizceyi tam örtsün: satır yüksekliğinin bir kısmı kadar taşır.
            val boxH = b.h * sh
            val padX = (boxH * 0.25f).coerceIn(4f, 24f)
            val padY = (boxH * 0.12f).coerceIn(2f, 12f)
            var left = (b.x * sw - padX).roundToInt().coerceAtLeast(0)
            val top = (b.y * sh - padY).roundToInt().coerceAtLeast(0)
            var right = (b.x * sw + b.w * sw + padX).roundToInt().coerceAtMost(sw)
            val bottom = (b.y * sh + boxH + padY).roundToInt().coerceAtMost(sh)
            // Türkçe çoğu zaman İngilizceden uzundur: yazı çok küçülecekse kutu iki yana genişler.
            val lineCount = item.lines.coerceAtLeast(1)
            val wantPx = minOf(maxTextPx, (bottom - top) * 0.8f / lineCount)
            measurePaint.textSize = wantPx
            val needW = measurePaint.measureText(item.text) / lineCount + padX * 2
            val haveW = (right - left).toFloat()
            if (needW > haveW) {
                val newW = minOf(needW, haveW * MAX_WIDEN, sw.toFloat())
                val cx = (left + right) / 2f
                left = (cx - newW / 2).roundToInt().coerceIn(0, sw)
                right = (left + newW).roundToInt().coerceAtMost(sw)
                if (right - left < newW) left = (right - newW).roundToInt().coerceAtLeast(0)
            }
            val w = right - left
            val h = bottom - top
            if (w <= 0 || h <= 0) continue

            val tv = TextView(appContext).apply {
                text = item.text
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(style.textColor)
                gravity = Gravity.CENTER_VERTICAL or Gravity.START
                includeFontPadding = false
                setPadding(padX.roundToInt() / 2, 0, padX.roundToInt() / 2, 0)
                background = GradientDrawable().apply {
                    cornerRadius = (boxH * 0.15f).coerceIn(2f, 10f)
                    setColor(bg)
                }
            }
            // Yazı kutuya sığana kadar küçülür; en büyük boyut: kutu yüksekliği ve ayardaki boyut.
            val maxPx = minOf(maxTextPx, h * 0.8f).roundToInt().coerceAtLeast(MIN_TEXT_PX + 1)
            TextViewCompat.setAutoSizeTextTypeUniformWithConfiguration(
                tv, MIN_TEXT_PX, maxPx, 1, TypedValue.COMPLEX_UNIT_PX,
            )
            container.addView(
                tv,
                FrameLayout.LayoutParams(w, h).apply {
                    leftMargin = left
                    topMargin = top
                },
            )
        }
    }

    companion object {
        private const val TAG = "PageOverlay"
        private const val AUTO_HIDE_MS = 25_000L
        /** Kutunun en az opaklığı (0-255): alttaki İngilizce okunmasın. */
        private const val MIN_BG_ALPHA = 235
        private const val MIN_TEXT_PX = 9
        /** Kutu en fazla bu kat genişler (komşu yazıların üstüne taşmasın). */
        private const val MAX_WIDEN = 1.6f
    }
}
