package com.altyazioverlay.tv

/**
 * Telefon <-> TV protokolü. Telefon uygulamasındaki TvLink ile aynı sabitleri kullanır.
 *
 * TCP üzerinden satır satır JSON (UTF-8, her mesaj "\n" ile biter):
 *   {"t":"hello","name":"Redmi Note 10S"}
 *   {"t":"sub","text":"Dikkat et!"}      // boş text = altyazıyı gizle
 *   {"t":"ping"}                          // bağlantı canlı tutma
 */
object Protocol {
    const val PORT = 47800
    const val SERVICE_TYPE = "_altyazi._tcp."
}
