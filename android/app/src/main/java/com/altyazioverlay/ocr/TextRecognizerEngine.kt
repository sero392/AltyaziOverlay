package com.altyazioverlay.ocr

import android.graphics.Bitmap
import android.util.Log
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
        onResult: (String?) -> Unit,
    ) {
        recognizer.process(InputImage.fromBitmap(bitmap, 0))
            .addOnSuccessListener(callbackExecutor) {
                onResult(extract(it, contentWidth, sourceWidth, sourceHeight))
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
    private fun extract(result: Text, frameWidth: Int, sourceWidth: Int, sourceHeight: Int): String {
        val minLineHeight = sourceHeight * MIN_LINE_HEIGHT_RATIO
        // Alanlar karede yatayda ortalanır; sapma sınırı ekran genişliğine göre. Dar bir alan
        // seçildiyse (ör. diyalog kutusu) içindeki satırların hepsi geçer.
        val centerX = frameWidth / 2f
        val maxCenterOffset = sourceWidth * MAX_CENTER_OFFSET_RATIO

        val textLines = result.textBlocks
            .flatMap { it.lines }
            .filter { line ->
                val box = line.boundingBox
                box != null &&
                    box.height() >= minLineHeight &&
                    line.confidence >= MIN_CONFIDENCE &&
                    line.text.count(Char::isLetter) >= 2 &&
                    !UiTextFilter.isUiText(line.text)
            }
        if (textLines.size > MAX_TEXT_LINES_ON_SCREEN) {
            Log.d(TAG, "rejected: ${textLines.size} text lines on screen (menu)")
            return ""
        }

        val centered = textLines
            .filter { abs(it.boundingBox!!.exactCenterX() - centerX) <= maxCenterOffset }
            .map { OcrLine(it.text.replace(WHITESPACE, " "), it.boundingBox!!.top, it.boundingBox!!.bottom) }

        val selected = SubtitleHeuristics.select(centered)
        selected.rejectReason?.let { Log.d(TAG, "rejected: $it") }
        return UiTextFilter.cleanSubtitleText(
            UiTextFilter.stripTrailingObjective(selected.text.replace(WHITESPACE, " ").trim()),
        )
    }

    fun close() = recognizer.close()

    companion object {
        private const val TAG = "TextRecognizerEngine"
        /** Ekran yüksekliğine göre minimum satır yüksekliği (küçük HUD yazılarını eler). */
        private const val MIN_LINE_HEIGHT_RATIO = 0.012f
        /** Satır merkezinin ekran merkezinden en fazla sapması (genişliğin oranı). */
        private const val MAX_CENTER_OFFSET_RATIO = 0.15f
        private const val MIN_CONFIDENCE = 0.5f
        /** Okuma alanlarında bundan fazla yazı satırı varsa (ortalı olsun olmasın) ekranda menü vardır. */
        private const val MAX_TEXT_LINES_ON_SCREEN = 6
        private val WHITESPACE = Regex("""\s+""")
    }
}
