package com.meereboer.thuis.brug

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent?) {
        val s = Intent(ctx, BrugService::class.java)
        if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(s) else ctx.startService(s)
    }
}
