package com.altyazioverlay.translate

import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.TranslateRemoteModel
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.TranslatorOptions

/**
 * ML Kit on-device çeviri (EN -> TR). Ücretsiz ve çevrimdışı; kalitesi DeepL'den düşük.
 *
 * Türkçe dil modeli APK'da yok, ilk kullanımda indirilir (~30 MB). [translate] model yoksa
 * önce indirir; ayar ekranı [download] ile modeli önceden (ör. Wi-Fi'deyken) indirebilir.
 * Tek bir çevirmen örneği uygulama boyunca açık kalır (model belleğe bir kez yüklenir).
 */
object MlKitTranslator {

    private val translator by lazy {
        Translation.getClient(
            TranslatorOptions.Builder()
                .setSourceLanguage(TranslateLanguage.ENGLISH)
                .setTargetLanguage(TranslateLanguage.TURKISH)
                .build(),
        )
    }

    private val turkishModel by lazy { TranslateRemoteModel.Builder(TranslateLanguage.TURKISH).build() }

    fun translate(text: String, onResult: (String) -> Unit, onError: (Exception) -> Unit) {
        translator.downloadModelIfNeeded()
            .onSuccessTask { translator.translate(text) }
            .addOnSuccessListener { onResult(it) }
            .addOnFailureListener(onError)
    }

    fun isModelDownloaded(onResult: (Boolean) -> Unit, onError: (Exception) -> Unit) {
        RemoteModelManager.getInstance().isModelDownloaded(turkishModel)
            .addOnSuccessListener { onResult(it) }
            .addOnFailureListener(onError)
    }

    fun download(onDone: () -> Unit, onError: (Exception) -> Unit) {
        translator.downloadModelIfNeeded(DownloadConditions.Builder().build())
            .addOnSuccessListener { onDone() }
            .addOnFailureListener(onError)
    }
}
