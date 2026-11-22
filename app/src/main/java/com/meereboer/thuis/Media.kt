package com.meereboer.thuis

import android.content.Context
import android.content.Intent
import android.net.Uri
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder

/** "Verder kijken" uit je eigen Plex- en Jellyfin-server. */
object Media {
    @Volatile private var plexMachine: String = ""

    private fun getJson(url: String, headers: Map<String, String> = emptyMap()): JSONObject {
        val b = Request.Builder().url(url).header("Accept", "application/json")
        headers.forEach { (k, v) -> b.header(k, v) }
        Xtream.http.newCall(b.build()).execute().use { r ->
            if (!r.isSuccessful) throw RuntimeException("fout ${r.code}")
            return JSONObject(r.body?.string() ?: "{}")
        }
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    // ---------- Plex ----------
    private fun plexImg(p: Prefs, path: String, w: Int, h: Int): String {
        if (path.isEmpty()) return ""
        return "${p.plexUrl}/photo/:/transcode?width=$w&height=$h&minSize=1&upscale=1&url=${enc(path)}&X-Plex-Token=${enc(p.plexToken)}"
    }

    fun plex(p: Prefs): List<JSONObject> {
        if (p.plexUrl.isEmpty() || p.plexToken.isEmpty()) return emptyList()
        val tok = "X-Plex-Token=${enc(p.plexToken)}"
        if (plexMachine.isEmpty()) try {
            plexMachine = getJson("${p.plexUrl}/identity?$tok").optJSONObject("MediaContainer")?.optString("machineIdentifier").orEmpty()
        } catch (_: Exception) { }
        val mc = getJson("${p.plexUrl}/library/onDeck?X-Plex-Container-Size=15&$tok").optJSONObject("MediaContainer") ?: return emptyList()
        val items = mc.optJSONArray("Metadata") ?: return emptyList()
        val out = ArrayList<JSONObject>()
        for (i in 0 until items.length()) {
            val m = items.getJSONObject(i)
            val ep = m.optString("type") == "episode"
            val art = m.optString("grandparentArt").ifEmpty { m.optString("art") }
            val dur = m.optLong("duration", 0)
            val off = m.optLong("viewOffset", 0)
            out.add(JSONObject()
                .put("source", "plex")
                .put("key", m.optString("ratingKey"))
                .put("title", if (ep) m.optString("grandparentTitle") else m.optString("title"))
                .put("sub", if (ep) "S${m.optInt("parentIndex")} · afl. ${m.optInt("index")} · ${m.optString("title")}" else m.optString("year"))
                .put("overview", m.optString("summary"))
                .put("progress", if (dur > 0) off.toDouble() / dur else 0.0)
                .put("left", if (dur > 0 && off > 0) ((dur - off) / 60000).toInt() else -1)
                .put("backdrop", plexImg(p, art, 1920, 1080))
                .put("thumb", plexImg(p, art, 780, 439))
                .put("when", m.optLong("lastViewedAt", m.optLong("addedAt", 0)) * 1000))
        }
        return out
    }

    fun openPlex(ctx: Context, key: String) {
        val pkg = "com.plexapp.android"
        if (plexMachine.isNotEmpty() && key.isNotEmpty()) {
            try {
                val uri = Uri.parse("plex://server://$plexMachine/com.plexapp.plugins.library/library/metadata/$key")
                ctx.startActivity(Intent(Intent.ACTION_VIEW, uri).setPackage(pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                return
            } catch (_: Exception) { }
        }
        AppList.launch(ctx, pkg)
    }

    // ---------- Jellyfin ----------
    @Volatile private var jfUser: String = ""

    fun jellyfin(p: Prefs): List<JSONObject> {
        if (p.jellyfinUrl.isEmpty() || p.jellyfinKey.isEmpty()) return emptyList()
        val h = mapOf("X-Emby-Token" to p.jellyfinKey)
        if (jfUser.isEmpty()) {
            val users = JSONArray(Xtream.http.newCall(Request.Builder().url("${p.jellyfinUrl}/Users").header("X-Emby-Token", p.jellyfinKey).build())
                .execute().use { it.body?.string() ?: "[]" })
            val admin = (0 until users.length()).map { users.getJSONObject(it) }
                .firstOrNull { it.optJSONObject("Policy")?.optBoolean("IsAdministrator") == true } ?: users.optJSONObject(0)
            jfUser = admin?.optString("Id").orEmpty()
            if (jfUser.isEmpty()) return emptyList()
        }
        val res = getJson("${p.jellyfinUrl}/Users/$jfUser/Items/Resume?Limit=15&Fields=Overview&MediaTypes=Video", h)
        val items = res.optJSONArray("Items") ?: return emptyList()
        val out = ArrayList<JSONObject>()
        for (i in 0 until items.length()) {
            val m = items.getJSONObject(i)
            val ep = m.optString("Type") == "Episode"
            val artId = if (ep) m.optString("SeriesId").ifEmpty { m.optString("Id") } else m.optString("Id")
            val ud = m.optJSONObject("UserData")
            val ticks = m.optLong("RunTimeTicks", 0)
            val pos = ud?.optLong("PlaybackPositionTicks", 0) ?: 0
            fun img(w: Int) = "${p.jellyfinUrl}/Items/$artId/Images/Backdrop?maxWidth=$w&quality=85&api_key=${enc(p.jellyfinKey)}"
            out.add(JSONObject()
                .put("source", "jellyfin")
                .put("key", m.optString("Id"))
                .put("title", if (ep) m.optString("SeriesName") else m.optString("Name"))
                .put("sub", if (ep) "S${m.optInt("ParentIndexNumber")} · afl. ${m.optInt("IndexNumber")} · ${m.optString("Name")}" else m.optString("ProductionYear"))
                .put("overview", m.optString("Overview"))
                .put("progress", if (ticks > 0) pos.toDouble() / ticks else 0.0)
                .put("left", if (ticks > 0 && pos > 0) ((ticks - pos) / 600_000_000L).toInt() else -1)
                .put("backdrop", img(1920))
                .put("thumb", img(780))
                .put("when", try { java.time.Instant.parse(ud?.optString("LastPlayedDate") ?: "").toEpochMilli() } catch (_: Exception) { 0L }))
        }
        return out
    }

    fun openJellyfin(ctx: Context) {
        val pm = ctx.packageManager
        val pkg = listOf("org.jellyfin.androidtv", "org.jellyfin.mobile").firstOrNull { pm.getLaunchIntentForPackage(it) != null || pm.getLeanbackLaunchIntentForPackage(it) != null }
        if (pkg != null) AppList.launch(ctx, pkg)
    }

    /** Plex en Jellyfin samen, meest recent bovenaan. Een bron die faalt slaat hij over. */
    fun continueWatching(p: Prefs): String {
        val all = ArrayList<JSONObject>()
        val errors = JSONArray()
        try { all.addAll(plex(p)) } catch (e: Exception) { errors.put("Plex: ${e.message}") }
        try { all.addAll(jellyfin(p)) } catch (e: Exception) { errors.put("Jellyfin: ${e.message}") }
        all.sortByDescending { it.optLong("when") }
        return JSONObject().put("items", JSONArray(all.take(15))).put("errors", errors).toString()
    }
}
