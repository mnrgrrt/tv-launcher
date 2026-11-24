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

/** Afstandsbediening tijdens het kijken: Android-knop naar de knopcode van speler.js (dezelfde als op de Samsung). */
private val PLAYER_KEYS = mapOf(
    KeyEvent.KEYCODE_CHANNEL_UP to 427, KeyEvent.KEYCODE_CHANNEL_DOWN to 428,
    KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE to 10252, KeyEvent.KEYCODE_MEDIA_PLAY to 415, KeyEvent.KEYCODE_MEDIA_PAUSE to 19,
    KeyEvent.KEYCODE_MEDIA_FAST_FORWARD to 417, KeyEvent.KEYCODE_MEDIA_REWIND to 412,
    KeyEvent.KEYCODE_PROG_GREEN to 404, KeyEvent.KEYCODE_MEDIA_AUDIO_TRACK to 404, KeyEvent.KEYCODE_PROG_YELLOW to 405,
    KeyEvent.KEYCODE_CAPTIONS to 405, KeyEvent.KEYCODE_LAST_CHANNEL to 10190, KeyEvent.KEYCODE_INFO to 457,
    KeyEvent.KEYCODE_GUIDE to 458, KeyEvent.KEYCODE_MENU to 458)

/** Het startscherm: een volledig scherm WebView met de HTML uit assets/web. Het beeld van de speler ligt eronder (Motor). */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var motor: Motor
    private var inputWatch: android.media.tv.TvInputManager.TvInputCallback? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Telefoon: altijd staand. Tablet (kortste zijde 600dp of meer): draait mee met het scherm.
        if (BuildConfig.TELEFOON && resources.configuration.smallestScreenWidthDp < 600)
            requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        registerReceiver(screen, android.content.IntentFilter().apply { addAction(Intent.ACTION_SCREEN_OFF); addAction(Intent.ACTION_SCREEN_ON) })
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
            // De motor onder de gedeelde speler (ExoPlayer) aanmelden bij de pagina.
            override fun onPageFinished(view: WebView, url: String) {
                view.evaluateJavascript(assets.open("android/motor.js").bufferedReader().use { it.readText() }, null)
            }
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
        // Fouten in de pagina naar het logboek van Android (tag ThuisWeb), zodat we ze op de tv kunnen terugvinden.
        web.webChromeClient = object : android.webkit.WebChromeClient() {
            override fun onConsoleMessage(m: android.webkit.ConsoleMessage): Boolean {
                if (m.messageLevel() == android.webkit.ConsoleMessage.MessageLevel.ERROR || m.messageLevel() == android.webkit.ConsoleMessage.MessageLevel.WARNING)
                    android.util.Log.w("ThuisWeb", "${m.message()} (${m.sourceId()?.substringAfterLast('/')}:${m.lineNumber()})")
                return true
            }
        }
        web.addJavascriptInterface(Bridge(this, web), "Native")
        // Het beeld van de speler ligt onder de pagina; de pagina tekent de knoppen erop.
        val root = android.widget.FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        root.addView(web, android.widget.FrameLayout.LayoutParams(-1, -1))
        motor = Motor(this, web, root)
        web.addJavascriptInterface(motor, "Motor")
        setContentView(root)
        Prefs(this).wipeOldSecrets()
        // Tv en telefoon delen de kern (kern.js), maar hebben elk een eigen scherm.
        web.loadUrl("https://appassets.androidplatform.net/assets/web/" + if (BuildConfig.TELEFOON) "telefoon.html" else "index.html")
        // HDMI-apparaat in- of uitgeplugd: de rij Kijken bijwerken.
        inputWatch = Inputs.watch(this) { web.evaluateJavascript("window.__inputs && window.__inputs()", null) }
        web.requestFocus()
    }

    /** De speler gaat open of dicht. Telefoon: tijdens het kijken liggend en schermvullend, daarna weer zoals het was. */
    fun playing(on: Boolean) {
        if (!BuildConfig.TELEFOON) return
        val small = resources.configuration.smallestScreenWidthDp < 600
        requestedOrientation = when {
            on -> android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            small -> android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            else -> android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
        hideSystemUi()
    }

    @Suppress("DEPRECATION")
    private fun hideSystemUi() {
        // Op de telefoon blijven de klok en de knoppen van Android gewoon zichtbaar, behalve tijdens het kijken.
        if (BuildConfig.TELEFOON && !(::motor.isInitialized && motor.active)) {
            window.decorView.systemUiVisibility = 0
            window.statusBarColor = Color.BLACK; window.navigationBarColor = Color.BLACK; return
        }
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY)
    }

    // Aan/uit: na elke keer uit vraagt Thuis wie er kijkt (bij scherm aan, of zodra Thuis weer voor is).
    private var woke = false
    private val screen = object : android.content.BroadcastReceiver() {
        override fun onReceive(c: android.content.Context?, i: Intent?) {
            when (i?.action) {
                Intent.ACTION_SCREEN_OFF -> woke = true
                Intent.ACTION_SCREEN_ON -> if (hasWindowFocus()) resumeWeb()
            }
        }
    }
    private fun resumeWeb() {
        if (!::web.isInitialized) return
        val w = woke; woke = false
        web.evaluateJavascript("window.__resume && window.__resume($w)", null)
    }

    override fun onResume() {
        super.onResume()
        hideSystemUi()
        if (::web.isInitialized) web.requestFocus()
        resumeWeb()
    }

    /** Home-knop: altijd naar het beginscherm, waar je ook bent (ook vanuit de spelers of een andere app). */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.hasCategory(Intent.CATEGORY_HOME) && ::web.isInitialized) web.evaluateJavascript("window.__home && window.__home()", null)
    }

    // Naar een andere app of scherm uit: wat speelt stopt (zoals de oude spelers deden).
    override fun onStop() {
        if (::motor.isInitialized && motor.active) {
            motor.release()
            web.evaluateJavascript("window.Speler && window.Speler.isOpen() && window.Speler.close()", null)
        }
        super.onStop()
    }

    override fun onDestroy() {
        if (::motor.isInitialized) motor.release()
        try { unregisterReceiver(screen) } catch (_: Exception) {}
        Inputs.unwatch(this, inputWatch)
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
        // Tijdens het kijken: knoppen die de pagina niet zelf kent (zenders, kleuren, gids, info) doorgeven aan de speler.
        if (::motor.isInitialized && motor.active) {
            val code = PLAYER_KEYS[event.keyCode]
            if (code != null) {
                if (event.action == KeyEvent.ACTION_DOWN)
                    web.evaluateJavascript("window.Speler && window.Speler.key($code, ${event.repeatCount > 0})", null)
                return true
            }
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
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) listenNow() else voiceDone(false, "Sjuul TV mag de microfoon niet gebruiken")
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
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Sjuul TV mag de microfoon niet gebruiken"
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
