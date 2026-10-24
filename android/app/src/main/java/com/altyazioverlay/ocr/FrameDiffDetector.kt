package com.altyazioverlay.ocr

import com.altyazioverlay.capture.CroppedFrame
import kotlin.math.abs

/**
 * OCR'dan ÖNCE çalışan çok ucuz piksel-düzeyi değişim dedektörü.
 *
 * Kırpılan bölgeyi [gridW]x[gridH] hücreye böler, her hücrenin ortalama parlaklığını
 * seyrek örnekleme ile hesaplar ve önceki kareyle karşılaştırır. Altyazı değişmediyse
 * ML Kit hiç çağrılmaz (CPU/pil tasarrufu). Maliyet: kare başına ~gridH*2 satır okuma.
 */
class FrameDiffDetector(
    private val gridW: Int = 64,
    private val gridH: Int = 16,
    /** Bir hücrenin "değişti" sayılması için gereken parlaklık farkı (0-255). */
    private val cellThreshold: Int = 18,
    /** Karenin değişmiş sayılması için gereken minimum hücre sayısı. */
    private val minChangedCells: Int = 3,
) {
    private var previous: IntArray? = null
    private var current = IntArray(gridW * gridH)
    private var rowBuffer = IntArray(0)
    private var lastW = -1
    private var lastH = -1

    fun hasChanged(frame: CroppedFrame): Boolean {
        val w = frame.contentWidth
        val h = frame.contentHeight
        if (w < gridW || h < gridH) return true
        if (w != lastW || h != lastH) {
            // Çözünürlük değişti (dönüş): referansı sıfırla.
            previous = null
            lastW = w
            lastH = h
        }
        if (rowBuffer.size < w) rowBuffer = IntArray(w)

        sample(frame, w, h)

        val prev = previous
        val changed = if (prev == null) {
            true
        } else {
            var count = 0
            for (i in current.indices) {
                if (abs(current[i] - prev[i]) > cellThreshold && ++count >= minChangedCells) break
            }
            count >= minChangedCells
        }

        // Dizileri takasla: tahsis yok.
        val tmp = previous ?: IntArray(gridW * gridH)
        previous = current
        current = tmp
        return changed
    }

    /** Bir sonraki kareyi koşulsuz "değişti" saydırır (ör. OCR hatası sonrası). */
    fun invalidate() {
        previous = null
    }

    private fun sample(frame: CroppedFrame, w: Int, h: Int) {
        val bmp = frame.bitmap
        val cellW = w / gridW
        val cellH = h / gridH
        val xStep = maxOf(1, cellW / 6)

        for (gy in 0 until gridH) {
            // Her hücre satırından 2 tarama çizgisi (1/3 ve 2/3 yükseklikte).
            for (s in 1..2) {
                val y = gy * cellH + (cellH * s) / 3
                bmp.getPixels(rowBuffer, 0, w, 0, y, w, 1)
                for (gx in 0 until gridW) {
                    var sum = 0
                    var n = 0
                    var x = gx * cellW
                    val end = x + cellW
                    while (x < end) {
                        val p = rowBuffer[x]
                        sum += (((p shr 16) and 0xFF) * 77 + ((p shr 8) and 0xFF) * 150 + (p and 0xFF) * 29) shr 8
                        n++
                        x += xStep
                    }
                    val idx = gy * gridW + gx
                    val avg = if (n == 0) 0 else sum / n
                    current[idx] = if (s == 1) avg else (current[idx] + avg) / 2
                }
            }
        }
    }
}
