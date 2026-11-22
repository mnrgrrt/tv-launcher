package com.meereboer.thuis

import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder

/** Je eigen Plex-bibliotheek: bladeren per genre en afspelen in de Thuis-speler, met kijkstand terug naar Plex. */
object PlexLib {
    private const val CLIENT = "thuis-formuler"
    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    private fun get(p: Prefs, path: String): JSONObject {
        val sep = if (path.contains("?")) "&" else "?"
        val r = Request.Builder().url("${p.plexUrl}$path${sep}X-Plex-Token=${enc(p.plexToken)}")
            .header("Accept", "application/json")
            .header("X-Plex-Client-Identifier", CLIENT).header("X-Plex-Product", "Thuis").header("X-Plex-Device-Name", "Formuler")
            .build()
        Xtream.http.newCall(r).execute().use {
            if (!it.isSuccessful) throw RuntimeException("Plex gaf fout ${it.code}")
            return JSONObject(it.body?.string() ?: "{}").optJSONObject("MediaContainer") ?: JSONObject()
        }
    }

    private fun img(p: Prefs, path: String, w: Int, h: Int): String {
        if (path.isEmpty()) return ""
        val u = "${p.plexUrl}/photo/:/transcode?width=$w&height=$h&minSize=1&upscale=1&url=${enc(path)}&X-Plex-Token=${enc(p.plexToken)}"
        return "https://appassets.androidplatform.net/proxy?u=${enc(u)}"
    }

    // Plex mengt Nederlandse en Engelse genres; hier één naam per genre.
    private val genreMap = mapOf(
        "action" to "Actie", "actie" to "Actie", "adventure" to "Avontuur", "avontuur" to "Avontuur",
        "animation" to "Animatie", "animatie" to "Animatie", "biography" to "Biografie", "biografie" to "Biografie",
        "comedy" to "Komedie", "komedie" to "Komedie", "crime" to "Misdaad", "misdaad" to "Misdaad",
        "documentary" to "Documentaire", "documentaire" to "Documentaire", "drama" to "Drama",
        "family" to "Familie", "familie" to "Familie", "kids" to "Familie", "fantasy" to "Fantasie", "fantasie" to "Fantasie",
        "history" to "Historisch", "historisch" to "Historisch", "horror" to "Horror",
        "music" to "Muziek", "muziek" to "Muziek", "musical" to "Muziek", "mystery" to "Mysterie", "mysterie" to "Mysterie",
        "romance" to "Romantiek", "romantiek" to "Romantiek", "science fiction" to "Sciencefiction", "sci-fi" to "Sciencefiction",
        "sciencefiction" to "Sciencefiction", "sci-fi & fantasy" to "Sciencefiction", "thriller" to "Thriller", "suspense" to "Thriller",
        "war" to "Oorlog", "oorlog" to "Oorlog", "war & politics" to "Oorlog", "western" to "Western", "sport" to "Sport",
        "reality" to "Reality", "martial arts" to "Actie", "tv film" to "", "tv movie" to ""
    )
    private val kids = setOf("Animatie", "Familie")

    private fun tmdbOf(m: JSONObject): Int {
        val g = m.optJSONArray("Guid") ?: return 0
        for (i in 0 until g.length()) g.getJSONObject(i).optString("id").let { if (it.startsWith("tmdb://")) return it.removePrefix("tmdb://").toIntOrNull() ?: 0 }
        return 0
    }

    private fun item(p: Prefs, m: JSONObject): JSONObject {
        val ep = m.optString("type") == "episode"
        val dur = m.optLong("duration"); val off = m.optLong("viewOffset")
        return JSONObject()
            .put("key", m.optString("ratingKey"))
            .put("type", m.optString("type"))
            .put("title", if (ep) m.optString("grandparentTitle") else m.optString("title"))
            .put("sub", if (ep) "S${m.optInt("parentIndex")} · afl. ${m.optInt("index")} · ${m.optString("title")}" else "")
            .put("year", m.optString("year"))
            .put("rating", m.optDouble("audienceRating", m.optDouble("rating", 0.0)))
            .put("summary", m.optString("summary"))
            .put("thumb", img(p, if (ep) m.optString("grandparentThumb").ifEmpty { m.optString("thumb") } else m.optString("thumb"), 300, 450))
            .put("art", img(p, (if (ep) m.optString("grandparentArt") else "").ifEmpty { m.optString("art") }, 1280, 720))
            .put("progress", if (dur > 0) off.toDouble() / dur else 0.0)
            .put("minutes", (dur / 60000).toInt())
    }

    fun sections(p: Prefs): String {
        if (p.plexUrl.isEmpty() || p.plexToken.isEmpty()) return "[]"
        val d = get(p, "/library/sections").optJSONArray("Directory") ?: JSONArray()
        val out = JSONArray()
        for (i in 0 until d.length()) d.getJSONObject(i).let {
            val t = it.optString("type")
            if (t == "movie" || t == "show") out.put(JSONObject().put("key", it.optString("key")).put("title", it.optString("title")).put("type", t))
        }
        return out.toString()
    }

    /** Rijen voor één bibliotheek: Verder kijken, Nieuw toegevoegd, daarna per genre (kinderen onderaan). */
    fun library(p: Prefs, section: String): String {
        val all = get(p, "/library/sections/$section/all?sort=addedAt:desc").optJSONArray("Metadata") ?: JSONArray()
        val items = (0 until all.length()).map { all.getJSONObject(it) }
        val rows = JSONArray()
        try {
            val deck = get(p, "/library/sections/$section/onDeck").optJSONArray("Metadata")
            if (deck != null && deck.length() > 0) {
                val a = JSONArray(); for (i in 0 until minOf(deck.length(), 20)) a.put(item(p, deck.getJSONObject(i)))
                rows.put(JSONObject().put("title", "Verder kijken").put("items", a))
            }
        } catch (_: Exception) { }
        if (items.isNotEmpty()) {
            val a = JSONArray(); items.take(40).forEach { a.put(item(p, it)) }
            rows.put(JSONObject().put("title", "Nieuw toegevoegd").put("total", items.size).put("items", a))
        }
        val byGenre = LinkedHashMap<String, MutableList<JSONObject>>()
        for (m in items) {
            val g = m.optJSONArray("Genre") ?: continue
            val names = (0 until g.length()).mapNotNull { i ->
                val raw = g.getJSONObject(i).optString("tag")
                (genreMap[raw.lowercase()] ?: raw).ifEmpty { null }
            }.toSet()
            for (n in names) byGenre.getOrPut(n) { mutableListOf() }.add(m)
        }
        byGenre.entries.sortedWith(compareBy<Map.Entry<String, MutableList<JSONObject>>> { if (it.key in kids) 1 else 0 }.thenByDescending { it.value.size })
            .filter { it.value.size >= 3 }
            .forEach { (name, list) ->
                val a = JSONArray(); list.take(40).forEach { a.put(item(p, it)) }
                rows.put(JSONObject().put("title", name).put("total", list.size).put("items", a))
            }
        return JSONObject().put("total", items.size).put("rows", rows).toString()
    }

    /** Alle afleveringen van een serie, per seizoen. */
    fun show(p: Prefs, key: String): String {
        val meta = get(p, "/library/metadata/$key").optJSONArray("Metadata")?.optJSONObject(0)
        val leaves = get(p, "/library/metadata/$key/allLeaves").optJSONArray("Metadata") ?: JSONArray()
        val seasons = LinkedHashMap<Int, JSONArray>()
        for (i in 0 until leaves.length()) leaves.getJSONObject(i).let { e ->
            val dur = e.optLong("duration"); val off = e.optLong("viewOffset")
            seasons.getOrPut(e.optInt("parentIndex")) { JSONArray() }.put(JSONObject()
                .put("key", e.optString("ratingKey")).put("num", e.optInt("index")).put("title", e.optString("title"))
                .put("img", img(p, e.optString("thumb"), 640, 360)).put("plot", e.optString("summary"))
                .put("dur", (dur / 1000).toInt()).put("progress", if (dur > 0) off.toDouble() / dur else 0.0)
                .put("watched", e.optInt("viewCount") > 0))
        }
        val arr = JSONArray()
        seasons.toSortedMap().forEach { (s, eps) -> arr.put(JSONObject().put("season", s.toString()).put("episodes", eps)) }
        return JSONObject()
            .put("plot", meta?.optString("summary").orEmpty())
            .put("backdrop", img(p, meta?.optString("art").orEmpty(), 1280, 720))
            .put("seasons", arr).toString()
    }

    /** Alles wat de speler nodig heeft: bestand, waar je was, losse ondertitels en het TMDB-nummer. */
    fun playItem(p: Prefs, key: String): JSONObject {
        val m = get(p, "/library/metadata/$key").optJSONArray("Metadata")?.optJSONObject(0) ?: throw RuntimeException("Niet gevonden in Plex")
        val part = m.optJSONArray("Media")?.optJSONObject(0)?.optJSONArray("Part")?.optJSONObject(0) ?: throw RuntimeException("Geen bestand")
        val ep = m.optString("type") == "episode"
        val subs = JSONArray()
        part.optJSONArray("Stream")?.let { st ->
            for (i in 0 until st.length()) st.getJSONObject(i).let { s ->
                if (s.optInt("streamType") == 3 && s.optString("key").isNotEmpty()) {
                    val lang = s.optString("languageCode").ifEmpty { s.optString("languageTag") }
                    subs.put(JSONObject().put("url", "${p.plexUrl}${s.optString("key")}?X-Plex-Token=${enc(p.plexToken)}")
                        .put("lang", lang).put("label", s.optString("displayTitle")).put("codec", s.optString("codec")))
                }
            }
        }
        var tmdb = tmdbOf(m)
        if (ep) try {
            tmdb = tmdbOf(get(p, "/library/metadata/${m.optString("grandparentRatingKey")}").optJSONArray("Metadata")?.optJSONObject(0) ?: JSONObject())
        } catch (_: Exception) { }
        return JSONObject()
            .put("kind", if (ep) "series" else "movie")
            .put("key", "plex:$key").put("plexKey", key)
            .put("url", "${p.plexUrl}${part.optString("key")}?X-Plex-Token=${enc(p.plexToken)}")
            .put("title", if (ep) m.optString("grandparentTitle") else m.optString("title"))
            .put("sub", if (ep) "S${m.optInt("parentIndex")} · afl. ${m.optInt("index")} · ${m.optString("title")}" else m.optString("year"))
            .put("season", if (ep) m.optInt("parentIndex") else 0).put("episode", if (ep) m.optInt("index") else 0)
            .put("tmdb", tmdb).put("offsetMs", m.optLong("viewOffset"))
            .put("subs", subs)
    }

    /** Kijkstand naar Plex, zodat de Plex-app ook weet waar je was. */
    fun timeline(p: Prefs, key: String, state: String, pos: Long, dur: Long) {
        try {
            get(p, "/:/timeline?ratingKey=$key&key=${enc("/library/metadata/$key")}&state=$state&time=$pos&duration=$dur")
            if (state == "stopped" && dur > 0 && pos > dur * 0.9)
                get(p, "/:/scrobble?identifier=com.plexapp.plugins.library&key=$key")
        } catch (_: Exception) { }
    }
}
