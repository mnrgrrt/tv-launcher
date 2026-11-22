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

    // ---------- hele catalogus (in het geheugen, 6 uur) ----------
    private class Cat(val at: Long, val cats: List<Pair<String, String>>, val items: List<JSONObject>)
    private val catalog = HashMap<String, Cat>()

    private fun genres(raw: String): List<String> = raw.split(Regex("[,/|;]")).map { it.trim() }.filter { it.isNotEmpty() }
        .mapNotNull { g -> (PlexLib.genreMap[g.lowercase()] ?: g.replaceFirstChar { it.uppercase() }).ifEmpty { null } }.distinct()

    @Synchronized
    fun all(p: Prefs, kind: String): Pair<List<Pair<String, String>>, List<JSONObject>> {
        catalog[kind]?.let { if (System.currentTimeMillis() - it.at < 6 * 3600_000L) return it.cats to it.items }
        val series = kind == "series"
        val ca = JSONArray(Xtream.api(p, if (series) "get_series_categories" else "get_vod_categories"))
        val cats = (0 until ca.length()).map { ca.getJSONObject(it) }.map { it.optString("category_id") to it.optString("category_name") }
        val a = JSONArray(Xtream.api(p, if (series) "get_series" else "get_vod_streams"))
        val items = ArrayList<JSONObject>(a.length())
        for (i in 0 until a.length()) a.getJSONObject(i).let { o ->
            val bd = o.opt("backdrop_path").let { b -> if (b is JSONArray) b.optString(0) else (b as? String).orEmpty() }
            items.add(JSONObject()
                .put("id", if (series) o.optString("series_id") else o.optString("stream_id"))
                .put("name", o.optString("name"))
                .put("icon", img(if (series) o.optString("cover") else o.optString("stream_icon")))
                .put("backdrop", img(bd))
                .put("rating", o.optString("rating"))
                .put("year", (o.optString("year").ifEmpty { o.optString("releaseDate").ifEmpty { o.optString("release_date") } }).take(4))
                .put("plot", o.optString("plot"))
                .put("ext", o.optString("container_extension", "mp4"))
                .put("cat", o.optString("category_id"))
                .put("genres", JSONArray(genres(o.optString("genre"))))
                .put("added", (if (series) o.optString("last_modified") else o.optString("added")).toLongOrNull() ?: 0L))
        }
        items.sortByDescending { it.optLong("added") }
        catalog[kind] = Cat(System.currentTimeMillis(), cats, items)
        return cats to items
    }

    /** Overzicht: diensten (categorieën), genres en het nieuwste. */
    fun overview(p: Prefs, kind: String): String {
        val (cats, items) = all(p, kind)
        val count = items.groupingBy { it.optString("cat") }.eachCount()
        val catArr = JSONArray()
        cats.sortedBy { if (it.second.contains("kind", true)) 1 else 0 }
            .forEach { (id, name) -> if ((count[id] ?: 0) > 0) catArr.put(JSONObject().put("id", id).put("name", name).put("count", count[id] ?: 0)) }
        val gCount = HashMap<String, Int>()
        items.forEach { o -> o.optJSONArray("genres")?.let { g -> for (i in 0 until g.length()) gCount.merge(g.optString(i), 1, Int::plus) } }
        val genreArr = JSONArray()
        gCount.entries.filter { it.value >= 5 }.sortedWith(compareBy<Map.Entry<String, Int>> { if (it.key in PlexLib.kids) 1 else 0 }.thenByDescending { it.value })
            .forEach { genreArr.put(JSONObject().put("name", it.key).put("count", it.value)) }
        val newest = JSONArray(); items.take(40).forEach { newest.put(it) }
        return JSONObject().put("total", items.size).put("cats", catArr).put("genres", genreArr).put("newest", newest).toString()
    }

    /** Alle titels van één dienst of genre (nieuwste eerst, maximaal 600). */
    fun browse(p: Prefs, kind: String, by: String, value: String): String {
        val (_, items) = all(p, kind)
        val hits = items.filter { o ->
            when (by) {
                "cat" -> o.optString("cat") == value
                "genre" -> o.optJSONArray("genres")?.let { g -> (0 until g.length()).any { g.optString(it) == value } } == true
                else -> true
            }
        }
        val arr = JSONArray(); hits.take(600).forEach { arr.put(it) }
        return JSONObject().put("total", hits.size).put("items", arr).toString()
    }

    private fun plain(s: String) = java.text.Normalizer.normalize(s, java.text.Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "").lowercase()

    fun search(p: Prefs, kind: String, q: String): JSONArray {
        val (_, items) = all(p, kind)
        val words = plain(q).split(Regex("\\s+")).filter { it.isNotEmpty() }
        val out = JSONArray()
        for (o in items) {
            val n = plain(o.optString("name"))
            if (words.all { n.contains(it) }) { out.put(o); if (out.length() >= 40) break }
        }
        return out
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
