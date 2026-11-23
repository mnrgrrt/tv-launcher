package com.meereboer.thuis

import android.content.Intent
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Brug tussen het startscherm (HTML) en Android. In JavaScript heet dit object "Native".
 * Alle gegevens komen van tv-serverr via srv(); de sleutel van dit apparaat blijft in Android.
 */
class Bridge(private val act: MainActivity, private val web: WebView) {
    private val pool = Executors.newFixedThreadPool(4)

    private fun reply(id: Int, ok: Boolean, data: String) {
        web.post { web.evaluateJavascript("window.__nativeCb && window.__nativeCb($id, $ok, ${JSONObject.quote(data)})", null) }
    }

    private fun async(id: Int, block: () -> String) {
        pool.execute {
            try { reply(id, true, block()) } catch (e: Exception) { reply(id, false, e.message ?: e.javaClass.simpleName) }
        }
    }

    @JavascriptInterface fun isApp(): Boolean = true
    @JavascriptInterface fun isPhone(): Boolean = BuildConfig.TELEFOON
    /** Telefoon: Terug op het eerste scherm sluit de app (op de tv is Sjuul TV het startscherm en blijft hij staan). */
    @JavascriptInterface fun closeApp() { if (BuildConfig.TELEFOON) act.runOnUiThread { act.moveTaskToBack(true) } }
    /** Mobiel internet (of een andere verbinding met een databundel)? Dan zuiniger afspelen. */
    @JavascriptInterface fun metered(): Boolean = try {
        (act.getSystemService(android.content.Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager).isActiveNetworkMetered
    } catch (_: Exception) { false }
    @JavascriptInterface fun appVersion(): String =
        try { act.packageManager.getPackageInfo(act.packageName, 0).versionName ?: "" } catch (_: Exception) { "" }

    // ---------- tv-serverr ----------
    @JavascriptInterface fun srvInfo(): String = Server.info(act).toString()
    @JavascriptInterface fun srvPair(id: Int, url: String, code: String, name: String) = async(id) { Server.pair(act, url, code, name) }
    @JavascriptInterface fun srvUnpair() = Server.unpair(act)
    @JavascriptInterface fun srvSetProfile(p: Int) = Server.setProfile(act, p)
    @JavascriptInterface fun srv(id: Int, method: String, path: String, body: String) =
        async(id) { Server.call(act, method, path, body.ifEmpty { null }) }

    // ---------- afspelen ----------
    /** Live tv: zappen binnen de categorie waaruit je startte. start > 0 = terugkijken vanaf dat moment. */
    @JavascriptInterface fun playLive(catId: String, streamId: Int, start: Double, end: Double, title: String) {
        act.runOnUiThread {
            act.startActivity(Intent(act, PlayerActivity::class.java).putExtra("categoryId", catId).putExtra("streamId", streamId)
                .putExtra("replayStart", start.toLong()).putExtra("replayEnd", end.toLong()).putExtra("replayTitle", title))
        }
    }

    /** Film of aflevering. json komt van tv-serverr (url, ondertitels, profiel, kijkstand-sleutels). */
    @JavascriptInterface fun playItem(json: String) {
        act.runOnUiThread { act.startActivity(Intent(act, VodActivity::class.java).putExtra("item", json)) }
    }

    // ---------- apps en apparaat ----------
    @JavascriptInterface fun getApps(id: Int) = async(id) { AppList.load(act).toString() }
    @JavascriptInterface fun launch(pkg: String) { act.runOnUiThread { AppList.launch(act, pkg) } }
    /** HDMI-ingangen waar iets op zit, en ernaar schakelen. */
    @JavascriptInterface fun getInputs(): String = Inputs.load(act).toString()
    @JavascriptInterface fun openInput(id: String) { act.runOnUiThread { try { Inputs.open(act, id) } catch (_: Exception) {} } }

    // ---------- schermbeveiliging ----------
    @JavascriptInterface fun saverGet(): String = SaverPrefs.toJson(act)
    @JavascriptInterface fun saverSet(json: String) = SaverPrefs.set(act, json)

    /** Android-instellingen openen: "all", "wifi", "bluetooth", "sound", "display", "apps", "home" (oorspronkelijk startscherm), "saver" (schermbeveiliging). */
    @JavascriptInterface fun openSystem(what: String) {
        act.runOnUiThread {
            val action = when (what) {
                "wifi" -> android.provider.Settings.ACTION_WIFI_SETTINGS
                "bluetooth" -> android.provider.Settings.ACTION_BLUETOOTH_SETTINGS
                "sound" -> android.provider.Settings.ACTION_SOUND_SETTINGS
                "display" -> android.provider.Settings.ACTION_DISPLAY_SETTINGS
                "apps" -> android.provider.Settings.ACTION_APPLICATION_SETTINGS
                "home" -> android.provider.Settings.ACTION_HOME_SETTINGS
                "saver" -> android.provider.Settings.ACTION_DREAM_SETTINGS
                else -> android.provider.Settings.ACTION_SETTINGS
            }
            try { act.startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            catch (_: Exception) {
                try { act.startActivity(Intent(android.provider.Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) {}
            }
        }
    }

    /** Inspreken; geeft de verstane tekst terug, of een foutmelding. */
    @JavascriptInterface fun voice(id: Int) { act.runOnUiThread { act.startVoice { ok, t -> reply(id, ok, t) } } }
    @JavascriptInterface fun voiceStop() { act.runOnUiThread { act.stopVoice() } }

    /** Een https-link openen in de bijbehorende app (bijvoorbeeld een trailer in YouTube). */
    @JavascriptInterface fun openUrl(url: String) {
        if (!url.startsWith("https://")) return
        act.runOnUiThread { try { act.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) {} }
    }

    // ---------- bijwerken ----------
    @JavascriptInterface fun checkUpdate(id: Int) = async(id) { Updater.check(act).toString() }
    @JavascriptInterface fun installUpdate(id: Int) = async(id) { Updater.downloadAndInstall(act) }
}
