package com.meereboer.thuis.brug

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.widget.TextView

/** Start de brug en laat kort zien dat hij draait. */
class StartActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val s = Intent(this, BrugService::class.java)
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(s) else startService(s)
        setContentView(TextView(this).apply {
            text = "Thuis-brug draait op poort 8765.\nJe kunt dit scherm sluiten."
            textSize = 28f
            gravity = Gravity.CENTER
        })
    }
}
