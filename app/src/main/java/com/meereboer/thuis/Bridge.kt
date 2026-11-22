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
    private val epgPool = Executors.newFixedThreadPool(8)

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

    private fun channelJson(ch: Channel, epg: List<Programme>): JSONObject {
        val o = JSONObject().put("id", ch.id).put("num", ch.num).put("name", ch.name)
            .put("icon", ch.icon).put("cat", ch.categoryId)
        epg.getOrNull(0)?.let {
            o.put("now", JSONObject().put("title", it.title).put("desc", it.desc).put("start", it.start).put("end", it.end))
        }
        epg.getOrNull(1)?.let { o.put("next", JSONObject().put("title", it.title).put("start", it.start)) }
        return o
    }

    /** Categorie-tegels voor de rij "Live tv": slimme categorieën uit categories.json. */
    @JavascriptInterface fun liveCategories(id: Int) = async(id) {
        if (!prefs.configured) return@async JSONObject().put("configured", false).toString()
        val all = Xtream.load(prefs)
        val cats = Categorizer.build(act, all)
        Categorizer.export(act, all, cats)
        val show = prefs.categories.lowercase().split(',').map { it.trim() }.filter { it.isNotEmpty() }
        val visible = cats.filter { c ->
            c.parent == null && c.channels.isNotEmpty() && (show.isEmpty() || c.id == "alle" || show.any { c.name.lowercase().contains(it) || c.id == it })
        }
        val arr = JSONArray()
        for (c in visible) {
            arr.put(JSONObject().put("id", c.id).put("name", c.name).put("img", c.img).put("count", c.channels.size)
                .put("sample", JSONArray(c.channels.take(4).map { it.name })))
        }
        JSONObject().put("configured", true).put("total", all.size).put("categories", arr).toString()
    }

    private fun withEpg(list: List<Channel>): Map<Int, List<Programme>> {
        val tasks = list.distinctBy { it.id }.map { ch ->
            Callable { ch.id to (try { Xtream.shortEpg(prefs, ch.id, 2) } catch (_: Exception) { emptyList() }) }
        }
        return epgPool.invokeAll(tasks).associate { it.get() }
    }

    /**
     * Zenders van één categorie met nu/straks. Heeft de categorie subrijen (zoals Sport),
     * dan komt er per subrij een groep terug.
     */
    @JavascriptInterface fun liveCategory(id: Int, catId: String) = async(id) {
        val all = Xtream.load(prefs)
        val cats = Categorizer.build(act, all)
        val cat = cats.firstOrNull { it.id == catId }
        val kids = cats.filter { it.parent == catId && it.channels.isNotEmpty() }
        val out = JSONObject().put("name", cat?.name ?: "")
        if (kids.isNotEmpty()) {
            val epg = withEpg(kids.flatMap { it.channels.take(60) })
            val groups = JSONArray()
            for (k in kids) {
                val arr = JSONArray()
                for (ch in k.channels.take(60)) arr.put(channelJson(ch, epg[ch.id] ?: emptyList()))
                groups.put(JSONObject().put("id", k.id).put("name", k.name).put("channels", arr))
            }
            out.put("groups", groups)
        } else {
            val list = (cat?.channels ?: emptyList()).take(150)
            val epg = withEpg(list)
            val arr = JSONArray()
            for (ch in list) arr.put(channelJson(ch, epg[ch.id] ?: emptyList()))
            out.put("channels", arr)
        }
        out.toString()
    }

    @JavascriptInterface fun playInCategory(streamId: Int, catId: String) {
        act.runOnUiThread {
            act.startActivity(
                Intent(act, PlayerActivity::class.java).putExtra("streamId", streamId).putExtra("categoryId", catId)
            )
        }
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
