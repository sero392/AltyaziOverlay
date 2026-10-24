package com.altyazioverlay.tv

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.net.Inet4Address
import java.net.NetworkInterface

/**
 * Kumanda ile kullanılan durum / ayar ekranı. Asıl iş [ReceiverService]'te; bu ekran
 * kapatılsa da servis çalışmaya devam eder.
 */
class MainActivity : Activity() {

    private lateinit var settings: TvSettings
    private lateinit var statusView: TextView
    private lateinit var positionButton: Button
    private lateinit var permissionButton: Button
    private var permissionScreenMissing = false

    private val statusListener: (ReceiverService.Status) -> Unit = { s -> runOnUiThread { render(s) } }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        settings = TvSettings(this)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0B0F17"))
            setPadding(dp(64), dp(40), dp(64), dp(40))
        }
        root.addView(text("Altyazı TV", 34f, bold = true))
        root.addView(text("Telefondaki Altyazı Çevirmeni'nden gelen Türkçe çeviriyi oyunun üstünde gösterir.", 18f, "#94A3B8"))
        root.addView(text("Yazı boyutu ve renkleri telefondaki \"Altyazı görünümü\" bölümünden ayarlanır.", 16f, "#64748B"))

        statusView = text("", 20f).apply { setPadding(0, dp(24), 0, dp(24)) }
        root.addView(statusView)

        val buttons = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        positionButton = button("") {
            val values = TvSettings.Position.entries
            settings.position = values[(settings.position.ordinal + 1) % values.size]
            onSettingsChanged()
        }
        permissionButton = button("Ekran üstü iznini ver") { openOverlaySettings() }
        buttons.addView(permissionButton)
        buttons.addView(positionButton)
        buttons.addView(button("Test yazısı göster") {
            ReceiverService.instance?.showTest("Bu bir deneme altyazısıdır. Dikkat et, arkanda biri var!")
        })
        root.addView(buttons)

        setContentView(root)
        updateButtonLabels()
        (if (Settings.canDrawOverlays(this)) positionButton else permissionButton).requestFocus()

        ReceiverService.start(this)
    }

    override fun onResume() {
        super.onResume()
        // İzin adb ile verildiyse servisin pencereyi eklemesi için tekrar tetikle.
        ReceiverService.start(this)
        ReceiverService.addListener(statusListener)
    }

    override fun onPause() {
        ReceiverService.removeListener(statusListener)
        super.onPause()
    }

    /**
     * "Diğer uygulamaların üzerinde göster" ayar ekranını açar. Bazı Android TV'lerde bu ekran
     * yoktur (o zaman izin sadece adb ile verilebilir); önce uygulamaya özel ekran, olmazsa
     * genel liste denenir.
     */
    private fun openOverlaySettings() {
        val candidates = listOf(
            Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")),
            Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION),
        )
        for (intent in candidates) {
            try {
                startActivity(intent)
                return
            } catch (_: ActivityNotFoundException) {
            }
        }
        permissionScreenMissing = true
        render(ReceiverService.status)
    }

    private fun onSettingsChanged() {
        updateButtonLabels()
        ReceiverService.instance?.applySettings()
        ReceiverService.instance?.showTest("Konum önizlemesi")
    }

    private fun updateButtonLabels() {
        positionButton.text = "Konum: ${settings.position.label}"
    }

    private fun render(s: ReceiverService.Status) {
        val ip = localIpv4() ?: "bulunamadı (Wi-Fi/Ethernet bağlı mı?)"
        val lines = buildList {
            add("TV adresi: $ip  ·  port ${Protocol.PORT}")
            add(if (s.listening) "Alıcı: çalışıyor" else "Alıcı: başlatılıyor…")
            add(if (s.clientName != null) "Telefon: bağlı (${s.clientName})" else "Telefon: bekleniyor")
            if (!Settings.canDrawOverlays(this@MainActivity)) {
                add("")
                if (permissionScreenMissing) {
                    add("⚠ Bu TV'de izin ekranı yok. İzin bilgisayardan adb ile verilmeli:")
                    add("adb shell appops set $packageName SYSTEM_ALERT_WINDOW allow")
                } else {
                    add("⚠ Ekran üstü izni yok: \"Ekran üstü iznini ver\" düğmesine basın,")
                    add("açılan listede Altyazı TV'yi bulup izni açın.")
                }
            } else if (!s.overlayReady) {
                add("Ekran üstü penceresi hazırlanıyor…")
            }
            if (s.lastText.isNotBlank()) add("Son çeviri: ${s.lastText}")
        }
        statusView.text = lines.joinToString("\n")
    }

    private fun localIpv4(): String? = runCatching {
        NetworkInterface.getNetworkInterfaces().toList()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.toList() }
            .firstOrNull { it is Inet4Address && !it.isLoopbackAddress }
            ?.hostAddress
    }.getOrNull()

    private fun text(value: String, sp: Float, color: String = "#FFFFFF", bold: Boolean = false) =
        TextView(this).apply {
            text = value
            setTextColor(Color.parseColor(color))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
            if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
        }

    private fun button(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
        gravity = Gravity.CENTER
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT,
        ).apply { marginEnd = dp(16) }
    }

    private fun dp(v: Int) =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()
}
