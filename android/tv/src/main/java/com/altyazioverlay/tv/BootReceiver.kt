package com.altyazioverlay.tv

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** TV açıldığında alıcıyı başlatır: kullanıcı uygulamayı her seferinde açmak zorunda kalmaz. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED ||
            intent.action == Intent.ACTION_LOCKED_BOOT_COMPLETED
        ) {
            ReceiverService.start(context)
        }
    }
}
