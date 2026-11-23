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
                // Plaatjes van Plex/Jellyfin (http op het thuisnetwerk) haalt de app zelf op,
                // anders blokkeert de https-pagina ze.
                if (u.host == "appassets.androidplatform.net" && u.path == "/proxy") {
                    val target = u.getQueryParameter("u") ?: return null
                    return try {
                        val r = Xtream.http.newCall(okhttp3.Request.Builder().url(target).build()).execute()
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
        applyExtras(intent)
        web.loadUrl("https://appassets.androidplatform.net/assets/web/index.html")
        web.requestFocus()
    }

    /** Instellingen op afstand zetten via adb: am start -n com.meereboer.thuis/.MainActivity --es tmdbToken ... */
    private fun applyExtras(i: Intent?) {
        val e = i?.extras ?: return
        val p = Prefs(this)
        e.getString("tmdbToken")?.let { p.tmdbToken = it }
        e.getString("jblWebhook")?.let { p.jblWebhook = it }
        e.getString("plexUrl")?.let { p.plexUrl = it }
        e.getString("plexToken")?.let { p.plexToken = it }
        e.getString("jellyfinUrl")?.let { p.jellyfinUrl = it }
        e.getString("jellyfinKey")?.let { p.jellyfinKey = it }
        e.getString("brugUrl")?.let { p.brugUrl = it }
        e.getString("osKey")?.let { p.osKey = it }
        e.getString("radarrUrl")?.let { p.radarrUrl = it }
        e.getString("radarrKey")?.let { p.radarrKey = it }
        e.getString("sonarrUrl")?.let { p.sonarrUrl = it }
        e.getString("sonarrKey")?.let { p.sonarrKey = it }
        e.getString("osUser")?.let { p.osUser = it }
        e.getString("jblListUrl")?.let { p.jblListUrl = it }
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        applyExtras(intent)
        if (intent?.extras?.isEmpty == false && ::web.isInitialized) web.reload()
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
}
