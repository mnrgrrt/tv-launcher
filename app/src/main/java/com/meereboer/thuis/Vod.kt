package com.meereboer.thuis

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder

/** Films en series van de IPTV-server (Xtream VOD), plus onthouden waar je was. */
object Vod {
    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    /** Plaatjes over http laat de app zelf ophalen (zie MainActivity), https mag direct. */
    private fun img(u: String) = when {
        u.isBlank() -> ""
        u.startsWith("https://") -> u
        u.startsWith("http://") -> "https://appassets.androidplatform.net/proxy?u=${enc(u)}"
        else -> ""
    }

    private fun firstBackdrop(info: JSONObject?): String {
        val b = info?.opt("backdrop_path")
        val s = when (b) { is JSONArray -> if (b.length() > 0) b.optString(0) else ""; is String -> b; else -> "" }
        return img(s)
    }

    fun categories(p: Prefs, kind: String): String {
        val a = JSONArray(Xtream.api(p, if (kind == "series") "get_series_categories" else "get_vod_categories"))
        val out = JSONArray()
        val list = (0 until a.length()).map { a.getJSONObject(it) }
        // Kinderfilms achteraan.
        for (c in list.sortedBy { if (it.optString("category_name").contains("kind", true)) 1 else 0 })
            out.put(JSONObject().put("id", c.optString("category_id")).put("name", c.optString("category_name")))
        return out.toString()
    }

    fun list(p: Prefs, kind: String, cat: String, limit: Int): String {
        val series = kind == "series"
        val a = JSONArray(Xtream.api(p, if (series) "get_series" else "get_vod_streams", "&category_id=${enc(cat)}"))
        val items = (0 until a.length()).map { a.getJSONObject(it) }
            .sortedByDescending { (if (series) it.optString("last_modified") else it.optString("added")).toLongOrNull() ?: 0L }
        val out = JSONArray()
        for (o in items.take(limit)) {
            out.put(JSONObject()
                .put("id", if (series) o.optString("series_id") else o.optString("stream_id"))
                .put("name", o.optString("name"))
                .put("icon", img(if (series) o.optString("cover") else o.optString("stream_icon")))
                .put("backdrop", if (series) firstBackdrop(o) else "")
                .put("rating", o.optString("rating"))
                .put("year", (o.optString("year").ifEmpty { o.optString("releaseDate").ifEmpty { o.optString("release_date") } }).take(4))
                .put("plot", o.optString("plot"))
                .put("ext", o.optString("container_extension", "mp4")))
        }
        return JSONObject().put("total", items.size).put("items", out).toString()
    }

    fun info(p: Prefs, kind: String, id: String): String {
        if (kind == "series") {
            val o = JSONObject(Xtream.api(p, "get_series_info", "&series_id=${enc(id)}"))
            val info = o.optJSONObject("info")
            val eps = o.optJSONObject("episodes")
            val seasons = JSONArray()
            eps?.keys()?.asSequence()?.sortedBy { it.toIntOrNull() ?: 0 }?.forEach { s ->
                val arr = eps.optJSONArray(s) ?: return@forEach
                val list = JSONArray()
                for (i in 0 until arr.length()) arr.getJSONObject(i).let { e ->
                    val ei = e.optJSONObject("info")
                    list.put(JSONObject()
                        .put("id", e.optString("id"))
                        .put("num", e.optInt("episode_num"))
                        .put("title", e.optString("title"))
                        .put("ext", e.optString("container_extension", "mkv"))
                        .put("img", img(ei?.optString("movie_image").orEmpty()))
                        .put("plot", ei?.optString("plot").orEmpty())
                        .put("dur", ei?.optInt("duration_secs") ?: 0))
                }
                seasons.put(JSONObject().put("season", s).put("episodes", list))
            }
            return JSONObject()
                .put("plot", info?.optString("plot").orEmpty())
                .put("backdrop", firstBackdrop(info))
                .put("genre", info?.optString("genre").orEmpty())
                .put("year", info?.optString("releaseDate").orEmpty().take(4))
                .put("seasons", seasons).toString()
        }
        val o = JSONObject(Xtream.api(p, "get_vod_info", "&vod_id=${enc(id)}"))
        val info = o.optJSONObject("info")
        return JSONObject()
            .put("plot", info?.optString("plot").orEmpty().ifEmpty { info?.optString("description").orEmpty() })
            .put("backdrop", firstBackdrop(info))
            .put("genre", info?.optString("genre").orEmpty())
            .put("year", info?.optString("releasedate").orEmpty().take(4))
            .put("duration", info?.optString("duration").orEmpty())
            .toString()
    }

    fun url(p: Prefs, kind: String, id: String, ext: String) =
        "${p.server}/${if (kind == "series") "series" else "movie"}/${enc(p.user)}/${enc(p.pass)}/$id.${ext.ifEmpty { "mp4" }}"

    // ---------- onthouden ----------
    private fun sp(ctx: Context) = ctx.getSharedPreferences("vod", Context.MODE_PRIVATE)

    fun position(ctx: Context, key: String) = sp(ctx).getLong("pos:$key", 0L)

    /** Positie opslaan; het laatst gekeken item komt in Verder kijken (behalve als het bijna af is). */
    fun save(ctx: Context, item: JSONObject, pos: Long, dur: Long) {
        val key = item.optString("key")
        val done = dur > 0 && pos > dur * 0.95
        sp(ctx).edit()
            .putLong("pos:$key", if (done) 0L else pos)
            .putString("last", if (done) "" else item.put("pos", pos).put("dur", dur).put("when", System.currentTimeMillis()).toString())
            .apply()
    }

    fun last(ctx: Context): JSONObject? = sp(ctx).getString("last", "")?.takeIf { it.isNotEmpty() }?.let { JSONObject(it) }

    /** Eén tegel voor Verder kijken. */
    fun continueItem(ctx: Context): JSONObject? {
        val l = last(ctx) ?: return null
        val dur = l.optLong("dur"); val pos = l.optLong("pos")
        return JSONObject()
            .put("source", "iptv").put("key", l.optString("key"))
            .put("title", l.optString("title")).put("sub", l.optString("sub"))
            .put("overview", l.optString("plot"))
            .put("progress", if (dur > 0) pos.toDouble() / dur else 0.0)
            .put("left", if (dur > 0) ((dur - pos) / 60000).toInt() else -1)
            .put("backdrop", l.optString("backdrop").ifEmpty { l.optString("img") })
            .put("thumb", l.optString("backdrop").ifEmpty { l.optString("img") })
            .put("when", l.optLong("when"))
    }
}
