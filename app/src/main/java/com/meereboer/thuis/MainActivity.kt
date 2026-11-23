package com.meereboer.thuis

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader

/** Het startscherm: een volledig scherm WebView met de HTML uit assets/web. */
class MainActivity : Activity() {
    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
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

    override fun onResume() {
        super.onResume()
        hideSystemUi()
        if (::web.isInitialized) {
            web.requestFocus()
            web.evaluateJavascript("window.__resume && window.__resume()", null)
        }
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

    // Spraak: Android vraagt de tekst op (Google-spraakherkenning) en geeft hem terug aan het startscherm.
    private var voiceCb: ((String?) -> Unit)? = null
    fun startVoice(cb: (String?) -> Unit) {
        val i = Intent(android.speech.RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE_MODEL, android.speech.RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE, "nl-NL")
            .putExtra(android.speech.RecognizerIntent.EXTRA_PROMPT, "Wat zoek je?")
        voiceCb = cb
        try { @Suppress("DEPRECATION") startActivityForResult(i, 77) } catch (_: Exception) { voiceCb = null; cb(null) }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION") super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == 77) {
            val t = data?.getStringArrayListExtra(android.speech.RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
            voiceCb?.invoke(if (resultCode == RESULT_OK) t else null); voiceCb = null
        }
    }
}
