package com.meereboer.thuis

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.view.KeyEvent
import android.view.View
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject

/** Het startscherm: een volledig scherm WebView met de HTML uit assets/web. */
class MainActivity : Activity() {
    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        registerReceiver(screenOff, android.content.IntentFilter(android.content.Intent.ACTION_SCREEN_OFF))
        hideSystemUi()

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        WebView.setWebContentsDebuggingEnabled(true)
        web = WebView(this)
        web.setBackgroundColor(Color.BLACK)
        web.isFocusable = true
        web.isFocusableInTouchMode = true
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            // De pagina is ontworpen op 1920 breed; Android schaalt hem passend op elk scherm.
            useWideViewPort = true
            loadWithOverviewMode = true
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val u = request.url
                // Plaatjes van http-adressen in het thuisnetwerk (zenderlogo's) haalt de app zelf op,
                // anders blokkeert de https-pagina ze.
                if (u.host == "appassets.androidplatform.net" && u.path == "/proxy") {
                    val target = u.getQueryParameter("u") ?: return null
                    return try {
                        val r = Server.http.newCall(okhttp3.Request.Builder().url(target).build()).execute()
                        if (!r.isSuccessful) { r.close(); return WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null) }
                        val type = r.header("Content-Type", "image/jpeg")!!.substringBefore(";")
                        WebResourceResponse(type, null, 200, "OK", mapOf("Cache-Control" to "max-age=3600"), r.body!!.byteStream())
                    } catch (_: Exception) { null }
                }
                // Plaatjes van tv-serverr (avatars, foto's, Plex-plaatjes): /srv/... gaat naar de server, met de sleutel van dit apparaat.
                if (u.host == "appassets.androidplatform.net" && (u.path ?: "").startsWith("/srv/") && request.method == "GET") {
                    return try {
                        val path = u.encodedPath!!.removePrefix("/srv") + (u.encodedQuery?.let { "?$it" } ?: "")
                        val r = Server.http.newCall(okhttp3.Request.Builder().url(Server.url(this@MainActivity) + path)
                            .header("X-Thuis-Key", Server.key(this@MainActivity)).build()).execute()
                        if (!r.isSuccessful) { r.close(); return WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null) }
                        val type = r.header("Content-Type", "image/jpeg")!!.substringBefore(";")
                        WebResourceResponse(type, null, 200, "OK", mapOf("Cache-Control" to "max-age=3600"), r.body!!.byteStream())
                    } catch (_: Exception) { null }
                }
                return loader.shouldInterceptRequest(u)
            }
        }
        web.addJavascriptInterface(Bridge(this, web), "Native")
        setContentView(web)
        Prefs(this).wipeOldSecrets()
        web.loadUrl("https://appassets.androidplatform.net/assets/web/index.html")
        web.requestFocus()
    }

    @Suppress("DEPRECATION")
    private fun hideSystemUi() {
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY)
    }

    // Hoe lang het scherm uit stond: daarmee vraagt Thuis na een tijdje "Wie kijkt er?".
    private var screenOffAt = 0L
    private val screenOff = object : android.content.BroadcastReceiver() {
        override fun onReceive(c: android.content.Context?, i: android.content.Intent?) { screenOffAt = System.currentTimeMillis() }
    }

    override fun onResume() {
        super.onResume()
        hideSystemUi()
        val away = if (screenOffAt > 0) System.currentTimeMillis() - screenOffAt else 0L
        screenOffAt = 0L
        if (::web.isInitialized) {
            web.requestFocus()
            web.evaluateJavascript("window.__resume && window.__resume($away)", null)
        }
    }

    override fun onDestroy() {
        try { unregisterReceiver(screenOff) } catch (_: Exception) {}
        super.onDestroy()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        // Als startscherm sluiten we nooit af met Terug: de pagina beslist wat Terug doet.
        if (event.keyCode == KeyEvent.KEYCODE_BACK) {
            if (event.action == KeyEvent.ACTION_UP) {
                web.evaluateJavascript("window.__back && window.__back()", null)
            }
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    // Spraak: Thuis luistert zelf (geen los Google-scherm) en stopt vanzelf als je klaar bent met praten.
    // Wat er al verstaan is, gaat meteen naar de pagina (window.__voicePartial). Alleen na een druk op Inspreken.
    private var voiceCb: ((Boolean, String) -> Unit)? = null
    private var recognizer: SpeechRecognizer? = null

    fun startVoice(cb: (Boolean, String) -> Unit) {
        voiceCb = cb
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 78); return
        }
        listenNow()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != 78) return
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) listenNow() else voiceDone(false, "Thuis mag de microfoon niet gebruiken")
    }

    private fun listenNow() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) { voiceDone(false, "Inspreken kan niet op dit apparaat"); return }
        recognizer?.destroy()
        val r = SpeechRecognizer.createSpeechRecognizer(this); recognizer = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onPartialResults(b: Bundle?) {
                val t = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: return
                web.evaluateJavascript("window.__voicePartial && window.__voicePartial(${JSONObject.quote(t)})", null)
            }
            override fun onResults(b: Bundle?) { voiceDone(true, b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: "") }
            override fun onError(error: Int) {
                voiceDone(false, when (error) {
                    SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Geen geluid gehoord"
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Thuis mag de microfoon niet gebruiken"
                    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Geen verbinding met de spraakherkenning"
                    else -> "Inspreken lukt niet ($error)"
                })
            }
            override fun onReadyForSpeech(p: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(v: Float) {}
            override fun onBufferReceived(b: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(t: Int, p: Bundle?) {}
        })
        r.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "nl-NL")
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true))
    }

    /** Stoppen (Terug op het luisterscherm). */
    fun stopVoice() { recognizer?.cancel(); voiceDone(true, "") }

    private fun voiceDone(ok: Boolean, text: String) {
        recognizer?.destroy(); recognizer = null
        val cb = voiceCb; voiceCb = null
        cb?.invoke(ok, text)
    }
}
