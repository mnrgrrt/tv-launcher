package com.meereboer.thuis

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.widget.TextView
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Staat Netflix (of een andere dienst) op de JBL, dan vangt dit scherm de toetsen van de
 * Formuler-afstandsbediening en stuurt ze via Home Assistant door naar de JBL.
 * Home op de afstandsbediening = terug naar Thuis (de JBL gaat dan ook weer naar HDMI 1).
 */
class RemoteActivity : Activity() {
    private val send = Executors.newSingleThreadExecutor()
    private lateinit var prefs: Prefs

    private val keys = mapOf(
        KeyEvent.KEYCODE_DPAD_UP to "DPAD_UP", KeyEvent.KEYCODE_DPAD_DOWN to "DPAD_DOWN",
        KeyEvent.KEYCODE_DPAD_LEFT to "DPAD_LEFT", KeyEvent.KEYCODE_DPAD_RIGHT to "DPAD_RIGHT",
        KeyEvent.KEYCODE_DPAD_CENTER to "DPAD_CENTER", KeyEvent.KEYCODE_ENTER to "DPAD_CENTER",
        KeyEvent.KEYCODE_NUMPAD_ENTER to "DPAD_CENTER", KeyEvent.KEYCODE_BACK to "BACK",
        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE to "MEDIA_PLAY_PAUSE", KeyEvent.KEYCODE_MEDIA_PLAY to "MEDIA_PLAY",
        KeyEvent.KEYCODE_MEDIA_PAUSE to "MEDIA_PAUSE", KeyEvent.KEYCODE_MEDIA_FAST_FORWARD to "MEDIA_FAST_FORWARD",
        KeyEvent.KEYCODE_MEDIA_REWIND to "MEDIA_REWIND", KeyEvent.KEYCODE_MEDIA_STOP to "MEDIA_STOP",
        KeyEvent.KEYCODE_MENU to "MENU"
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        setContentView(TextView(this).apply {
            text = "De afstandsbediening bedient nu de JBL.\nDruk op Home om terug te gaan naar Thuis."
            setTextColor(Color.WHITE); setBackgroundColor(Color.BLACK)
            textSize = 26f; gravity = Gravity.CENTER
        })
    }

    private fun post(key: String) {
        val url = prefs.jblWebhook
        if (url.isEmpty()) return
        send.execute {
            try {
                val body = JSONObject().put("key", key).toString().toRequestBody("application/json".toMediaType())
                Xtream.http.newCall(okhttp3.Request.Builder().url("$url-toets").post(body).build()).execute().close()
            } catch (_: Exception) { }
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        val k = keys[keyCode] ?: return super.onKeyDown(keyCode, event)
        post(k)
        return true
    }

    // Home ingedrukt: JBL terug naar HDMI 1 (Thuis).
    override fun onUserLeaveHint() { post("TERUG"); finish() }
}
