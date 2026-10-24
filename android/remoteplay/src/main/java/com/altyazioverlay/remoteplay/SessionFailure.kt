package com.altyazioverlay.remoteplay

/**
 * PS5'in oturum isteğini reddetme nedeni (session request "application reason").
 * chiaki bu kodların bir kısmını tanır; 0x80108b12 sahada gözlendi.
 *
 * @property retryable false ise yeniden denemek işe yaramaz; kullanıcı bir şey yapmalı.
 */
enum class SessionFailure(val code: Long, val message: String, val retryable: Boolean) {
    REMOTE_PLAY_DISABLED(
        0x80108b12,
        "PS5'te Uzaktan Oynatma etkin değil. Eşleşen hesapla PS5'te: Ayarlar › Sistem › " +
            "Uzaktan Oynatma › Uzaktan Oynatmayı Etkinleştir.",
        retryable = false,
    ),
    IN_USE(0x80108b10, "Remote Play başka bir cihazda kullanımda.", retryable = true),
    REGIST_FAILED(0x80108b09, "Eşleşme geçersiz; PS5 ile yeniden eşleştirin.", retryable = false),
    INVALID_PSN_ID(0x80108b02, "PSN hesap kimliği geçersiz; yeniden eşleştirin.", retryable = false),
    VERSION_MISMATCH(0x80108b11, "PS5 sistem sürümü bu Remote Play sürümüyle uyumsuz.", retryable = false),
    CRASH(0x80108b15, "PS5'teki Remote Play servisi yanıt vermedi.", retryable = true);

    companion object {
        fun fromCode(code: Long): SessionFailure? = entries.firstOrNull { it.code == code }
    }
}
