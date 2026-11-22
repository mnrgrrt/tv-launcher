package com.meereboer.thuis

import android.content.Intent
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Callable
import java.util.concurrent.Executors

/** Brug tussen het startscherm (HTML) en Android. In JavaScript heet dit object "Native". */
class Bridge(private val act: MainActivity, private val web: WebView) {
    private val prefs = Prefs(act)
    private val pool = Executors.newFixedThreadPool(4)
    private val epgPool = Executors.newFixedThreadPool(6)

    private fun reply(id: Int, ok: Boolean, data: String) {
        web.post {
            web.evaluateJavascript(
                "window.__nativeCb && window.__nativeCb($id, $ok, ${JSONObject.quote(data)})", null
            )
        }
    }

    private fun async(id: Int, block: () -> String) {
        pool.execute {
            try {
                reply(id, true, block())
            } catch (e: Exception) {
                reply(id, false, e.message ?: e.javaClass.simpleName)
            }
        }
    }

    @JavascriptInterface fun isApp(): Boolean = true

    @JavascriptInterface fun getSettings(): String = prefs.toJson().toString()

    @JavascriptInterface fun saveSettings(json: String) {
        prefs.fromJson(JSONObject(json))
        Xtream.channels = emptyList()
    }

    @JavascriptInterface fun testConnection(id: Int) = async(id) {
        val ui = Xtream.test(prefs)
        val n = Xtream.load(prefs, true).size
        JSONObject().put("status", ui.optString("status")).put("channels", n).toString()
    }

    @JavascriptInterface fun getApps(id: Int) = async(id) { AppList.load(act).toString() }

    @JavascriptInterface fun launch(pkg: String) {
        act.runOnUiThread { AppList.launch(act, pkg) }
    }

    /** Zenders voor de rij "Nu live" op het startscherm, met nu/straks uit de korte gids. */
    @JavascriptInterface fun liveHome(id: Int) = async(id) {
        if (!prefs.configured) return@async JSONObject().put("configured", false).toString()
        val all = Xtream.load(prefs)
        // Een of meer groepen, gescheiden door komma's, bijvoorbeeld "sport, film".
        val groups = prefs.homeGroup.lowercase().split(',').map { it.trim() }.filter { it.isNotEmpty() }
        val pick = if (groups.isNotEmpty()) {
            val ids = Xtream.categories.filterValues { name -> groups.any { name.lowercase().contains(it) } }.keys
            all.filter { it.categoryId in ids }
        } else all
        val chosen = pick.take(24)
        val tasks = chosen.map { ch ->
            Callable { ch to (try { Xtream.shortEpg(prefs, ch.id, 2) } catch (_: Exception) { emptyList() }) }
        }
        val results = epgPool.invokeAll(tasks).map { it.get() }
        val arr = JSONArray()
        for ((ch, epg) in results) {
            val o = JSONObject().put("id", ch.id).put("num", ch.num).put("name", ch.name).put("icon", ch.icon)
            epg.getOrNull(0)?.let {
                o.put("now", JSONObject().put("title", it.title).put("desc", it.desc).put("start", it.start).put("end", it.end))
            }
            epg.getOrNull(1)?.let { o.put("next", JSONObject().put("title", it.title).put("start", it.start)) }
            arr.put(o)
        }
        JSONObject().put("configured", true).put("total", all.size).put("channels", arr).toString()
    }

    @JavascriptInterface fun playChannel(streamId: Int) {
        act.runOnUiThread {
            act.startActivity(Intent(act, PlayerActivity::class.java).putExtra("streamId", streamId))
        }
    }

    @JavascriptInterface fun playLast() {
        act.runOnUiThread { act.startActivity(Intent(act, PlayerActivity::class.java)) }
    }

    @JavascriptInterface fun checkUpdate(id: Int) = async(id) { Updater.check(act).toString() }

    @JavascriptInterface fun installUpdate(id: Int) = async(id) { Updater.downloadAndInstall(act) }

    @JavascriptInterface fun openAndroidSettings() {
        act.runOnUiThread {
            try {
                act.startActivity(Intent(android.provider.Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (_: Exception) { }
        }
    }
}
