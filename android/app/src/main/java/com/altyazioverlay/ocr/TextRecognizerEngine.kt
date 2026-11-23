package com.altyazioverlay.ocr

import android.graphics.Bitmap
import android.util.Log
import com.altyazioverlay.capture.RegionBand
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.util.concurrent.Executor
import kotlin.math.abs

/**
 * Google ML Kit on-device (Latin) metin tanıma sarmalayıcısı.
 * Model APK ile paketli: ağ yok, ilk çağrıda indirme yok.
 *
 * @param callbackExecutor Sonuçların teslim edileceği executor (yakalama thread'i).
 *   Varsayılan ML Kit davranışı ana thread'e dönmektir; bunu bilerek engelliyoruz.
 */
class TextRecognizerEngine(
    private val callbackExecutor: Executor,
) {

    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

    /**
     * @param contentWidth Bitmap'in gerçek görüntü genişliği (sağdaki hizalama dolgusu hariç).
     * @param sourceWidth / sourceHeight Alanların kesildiği tam ekranın boyutu (eşikler ekrana göre).
     * @param onResult null = hata. Aksi halde okunan (boş olabilir) metin.
     */
    fun recognize(
        bitmap: Bitmap,
        contentWidth: Int,
        sourceWidth: Int,
        sourceHeight: Int,
        bands: List<RegionBand>,
        onResult: (String?) -> Unit,
    ) {
        recognizer.process(InputImage.fromBitmap(bitmap, 0))
            .addOnSuccessListener(callbackExecutor) {
                onResult(extract(it, contentWidth, sourceWidth, sourceHeight, bands))
            }
            .addOnFailureListener(callbackExecutor) {
                Log.w(TAG, "OCR failed", it)
                onResult(null)
            }
    }

    /**
     * Satırları yukarıdan aşağı sıralayıp tek cümle haline getirir (iki satırlık altyazılar).
     * Gürültü filtreleri:
     *  - çok kısa / harf içermeyen satırlar ve HUD gibi çok küçük yazılar,
     *  - yatayda ortalanmamış satırlar (altyazılar ortalanır; sahnedeki rastgele yazılar,
     *    köşe HUD'ları ve düğme etiketleri ortalanmaz),
     *  - düşük güvenli tanımalar (hareketli sahnede "hayalet" harfler),
     *  - yayın uygulamasının kendi arayüz yazıları ([UiTextFilter]).
     * Bu satırlar her karede değiştiği için kalırlarsa metin hiç kararlı hale gelmez.
     *
     * Ardından [SubtitleHeuristics] envanter / menü gibi oyun arayüzlerini eler. Ekranda
     * ortalanmamış çok sayıda yazı varsa (sola hizalı liste) bu da menü sayılır.
     */
    private fun extract(
        result: Text,
        frameWidth: Int,
        sourceWidth: Int,
        sourceHeight: Int,
        bands: List<RegionBand>,
    ): String {
        val minLineHeight = sourceHeight * MIN_LINE_HEIGHT_RATIO
        // Ortalama filtresi yalnızca ekranı (neredeyse) tam kaplayan alanda uygulanır (ör. varsayılan
        // alt %20 şeridi: köşe HUD'larını eler). Kullanıcı alanı kendisi çizdiyse içindeki her satır
        // altyazı adayıdır: alan altyazıya göre biraz yana kaymış çizildiğinde satırlar alanın
        // merkezinden uzak kalıp atılıyor, metin okunmuyordu. Alanlar birleşik karede ortalanır.
        val centerX = frameWidth / 2f
        val maxCenterOffset = sourceWidth * MAX_CENTER_OFFSET_RATIO
        // Alan bilgisi yoksa (eski çağıran) tüm kare tek alan.
        val regions = bands.ifEmpty { listOf(RegionBand(0, Int.MAX_VALUE, frameWidth, 0)) }

        val allLines = result.textBlocks.flatMap { it.lines }
        // Teşhis: her ham satır ve neden elendiği (geçici, çevrilmeyen altyazıları bulmak için).
        val diagLines = mutableListOf<String>()
        val textLines = allLines.filter { line ->
            val box = line.boundingBox
            val why = when {
                box == null -> "kutu-yok"
                box.height() < minLineHeight -> "kucuk(h=${box.height()}<${minLineHeight.toInt()})"
                line.confidence < MIN_CONFIDENCE -> "guven(${"%.2f".format(line.confidence)})"
                line.text.count(Char::isLetter) < 2 -> "harf<2"
                UiTextFilter.isUiText(line.text) -> "arayuz-yazisi"
                else -> null
            }
            diagLines += "\"${line.text}\"${why?.let { " X $it" } ?: ""}"
            why == null
        }

        val perRegion = regions.map { band ->
            val inBand = textLines.filter {
                val cy = it.boundingBox!!.exactCenterY()
                cy >= band.top && cy < band.bottom
            }
            val applyCenterFilter = band.width >= sourceWidth * FULL_WIDTH_RATIO
            val lines = inBand
                .filter {
                    val ok = !applyCenterFilter || abs(it.boundingBox!!.exactCenterX() - centerX) <= maxCenterOffset
                    if (!ok) diagLines += "\"${it.text}\" X ortali-degil"
                    ok
                }
                .map { OcrLine(it.text.replace(WHITESPACE, " "), it.boundingBox!!.top, it.boundingBox!!.bottom) }
            SubtitleHeuristics.RegionLines(band.screenTop, lines, inBand.size)
        }

        val selected = SubtitleHeuristics.selectFromRegions(perRegion)
        if (selected.text.isEmpty()) selected.rejectReason?.let { Log.d(TAG, "rejected: $it") }
        val out = UiTextFilter.cleanSubtitleText(
            UiTextFilter.stripTrailingObjective(selected.text.replace(WHITESPACE, " ").trim()),
        )
        lastDiag = Diag(
            allLines.joinToString(" ") { it.text },
            diagLines,
            when {
                out.isNotEmpty() -> null
                selected.text.isEmpty() -> selected.rejectReason
                else -> "temizlikte-silindi"
            },
        )
        logDiag()
        return out
    }

    /** Son OCR karesinin teşhis özeti (yalnızca yakalama thread'inden okunur). */
    data class Diag(val raw: String, val lines: List<String>, val reason: String?)

    var lastDiag = Diag("", emptyList(), null)
        private set
    private var lastDiagSignature = ""

    /** Ham satırlar değiştiğinde bir kez yazar (her karede aynı satırı tekrarlamaz). */
    private fun logDiag() {
        val sig = lastDiag.lines.joinToString("|") + lastDiag.reason
        if (sig == lastDiagSignature || lastDiag.lines.isEmpty()) return
        lastDiagSignature = sig
        Log.d(DIAG_TAG, "ham=${lastDiag.lines.joinToString(" ; ")}${lastDiag.reason?.let { " => RED: $it" } ?: ""}")
    }

    fun close() = recognizer.close()

    companion object {
        private const val TAG = "TextRecognizerEngine"
        const val DIAG_TAG = "OcrDiag"
        /** Ekran yüksekliğine göre minimum satır yüksekliği (küçük HUD yazılarını eler). */
        private const val MIN_LINE_HEIGHT_RATIO = 0.012f
        /** Satır merkezinin ekran merkezinden en fazla sapması (genişliğin oranı). */
        private const val MAX_CENTER_OFFSET_RATIO = 0.15f
        /** OCR karesi ekran genişliğinin bu oranından genişse alan "tam genişlik" sayılır. */
        private const val FULL_WIDTH_RATIO = 0.9f
        private const val MIN_CONFIDENCE = 0.5f
        private val WHITESPACE = Regex("""\s+""")
    }
}
