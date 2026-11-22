package com.meereboer.thuis

import android.content.Context
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Callable
import java.util.concurrent.Executors

/**
 * Voorstellen via TMDB: wat er in Nederland populair is op jouw diensten,
 * alleen "inbegrepen bij abonnement" (geen huur of koop).
 */
object Tmdb {
    private const val API = "https://api.themoviedb.org/3"
    private const val IMG = "https://image.tmdb.org/t/p/"
    private val pool = Executors.newFixedThreadPool(6)
    @Volatile private var cache: Pair<Long, String>? = null

    private fun get(token: String, path: String): JSONObject {
        // Korte v3-sleutel (32 tekens) gaat als api_key mee, de lange v4-sleutel als Bearer.
        val v3 = token.length <= 40 && !token.contains(".")
        val url = if (v3) API + path + (if (path.contains("?")) "&" else "?") + "api_key=$token" else API + path
        val b = Request.Builder().url(url).header("accept", "application/json")
        if (!v3) b.header("Authorization", "Bearer $token")
        val req = b.build()
        Xtream.http.newCall(req).execute().use { r ->
            if (!r.isSuccessful) throw RuntimeException("TMDB gaf fout ${r.code}")
            return JSONObject(r.body?.string() ?: "{}")
        }
    }

    private fun discover(token: String, type: String, provider: Int): List<JSONObject> {
        val o = get(token, "/discover/$type?watch_region=NL&with_watch_providers=$provider" +
            "&with_watch_monetization_types=flatrate&sort_by=popularity.desc&language=nl-NL&page=1&include_adult=false" +
            // Geen kinderprogramma's: Kids en Familie eruit, bij films ook animatie.
            (if (type == "tv") "&without_genres=10762,10751" else "&without_genres=10751,16"))
        val a = o.optJSONArray("results") ?: JSONArray()
        return (0 until a.length()).map { a.getJSONObject(it).put("_type", type) }
            .filter { it.optString("backdrop_path").isNotEmpty() }
    }

    private fun item(o: JSONObject, service: String): JSONObject {
        val tv = o.optString("_type") == "tv"
        val date = if (tv) o.optString("first_air_date") else o.optString("release_date")
        return JSONObject()
            .put("id", (if (tv) "tv" else "movie") + o.optInt("id"))
            .put("title", if (tv) o.optString("name") else o.optString("title"))
            .put("overview", o.optString("overview"))
            .put("year", date.take(4))
            .put("type", if (tv) "Serie" else "Film")
            .put("rating", o.optDouble("vote_average", 0.0))
            .put("backdrop", IMG + "w1280" + o.optString("backdrop_path"))
            .put("thumb", IMG + "w780" + o.optString("backdrop_path"))
            .put("service", service)
    }

    /** TMDB-nummer op titel (voor ondertitels). */
    fun search(p: Prefs, type: String, title: String): Int {
        val r = get(p.tmdbToken, "/search/$type?query=" + java.net.URLEncoder.encode(title, "UTF-8") + "&language=nl-NL")
            .optJSONArray("results") ?: return 0
        return if (r.length() > 0) r.getJSONObject(0).optInt("id") else 0
    }

    // ---------- Verder kijken van de JBL ----------
    @Volatile private var pnCache: Pair<String, List<JSONObject>>? = null

    /**
     * HA zet na het streamen de schermuitlezing van het JBL-startscherm klaar. Daaruit halen we de rij
     * "Hierna afspelen", zoeken elke titel op bij TMDB en houden per dienst de eerste (meest recente) over.
     */
    fun playNext(ctx: Context, p: Prefs): List<JSONObject> {
        if (p.jblListUrl.isEmpty() || p.tmdbToken.isEmpty()) return emptyList()
        val xml = Xtream.http.newCall(Request.Builder().url(p.jblListUrl + "?t=" + System.currentTimeMillis()).build())
            .execute().use { if (it.isSuccessful) it.body?.string().orEmpty() else "" }
        if (xml.isEmpty()) return emptyList()
        pnCache?.let { if (it.first == xml) return it.second }
        val start = xml.indexOf("text=\"Hierna afspelen\"")
        if (start < 0) return emptyList()
        // Kaartjes in die rij: ImageView "id/image" met content-desc, tot de volgende rijtitel (een node met tekst).
        val descs = ArrayList<String>()
        for (m in Regex("<node [^>]*>").findAll(xml.substring(start + 10))) {
            val n = m.value
            val text = Regex("text=\"([^\"]*)\"").find(n)?.groupValues?.get(1).orEmpty()
            if (text.isNotEmpty()) break
            if (n.contains("tvlauncher:id/image")) {
                val d = Regex("content-desc=\"([^\"]*)\"").find(n)?.groupValues?.get(1).orEmpty()
                if (d.isNotEmpty()) descs.add(d.replace("&amp;", "&").replace("&quot;", "\"").replace("&#39;", "'"))
            }
        }
        val services = JSONObject(ctx.assets.open("web/services.json").bufferedReader().readText()).getJSONArray("services")
        val byProvider = HashMap<Int, String>()
        for (i in 0 until services.length()) services.getJSONObject(i).let { s ->
            if (s.optInt("provider") > 0 && s.optString("key") != "plex") byProvider[s.getInt("provider")] = s.getString("key")
        }
        val out = ArrayList<JSONObject>()
        val used = HashSet<String>()
        val now = System.currentTimeMillis()
        val epRe = Regex("^(.*?) S(\\d+), afl\\. (\\d+)(?: - (.*))?$")
        descs.forEachIndexed { idx, d ->
            val m = epRe.find(d)
            val title = m?.groupValues?.get(1) ?: d
            val sub = if (m != null) listOf("S${m.groupValues[2]}".takeIf { m.groupValues[2].length < 4 }, "afl. ${m.groupValues[3]}".takeIf { m.groupValues[3].length < 5 },
                m.groupValues[4].ifEmpty { null }).filterNotNull().joinToString(" · ") else ""
            try {
                val res = get(p.tmdbToken, "/search/multi?query=" + java.net.URLEncoder.encode(title, "UTF-8") + "&language=nl-NL&include_adult=false")
                    .optJSONArray("results") ?: return@forEachIndexed
                val hit = (0 until minOf(res.length(), 3)).map { res.getJSONObject(it) }
                    .firstOrNull { it.optString("media_type") in setOf("tv", "movie") } ?: return@forEachIndexed
                val type = hit.optString("media_type")
                val prov = get(p.tmdbToken, "/$type/${hit.optInt("id")}/watch/providers").optJSONObject("results")
                    ?.optJSONObject("NL")?.optJSONArray("flatrate") ?: return@forEachIndexed
                val key = (0 until prov.length()).map { prov.getJSONObject(it).optInt("provider_id") }
                    .firstNotNullOfOrNull { byProvider[it] } ?: return@forEachIndexed
                if (!used.add(key)) return@forEachIndexed
                val bd = hit.optString("backdrop_path")
                out.add(JSONObject()
                    .put("source", "svc").put("service", key).put("key", key)
                    .put("title", if (type == "tv") hit.optString("name") else hit.optString("title"))
                    .put("sub", sub)
                    .put("overview", hit.optString("overview"))
                    .put("progress", 0.0).put("left", -1)
                    .put("backdrop", if (bd.isEmpty()) "" else IMG + "w1280" + bd)
                    .put("thumb", if (bd.isEmpty()) "" else IMG + "w780" + bd)
                    .put("when", now - idx * 60_000L))
            } catch (_: Exception) { }
        }
        pnCache = xml to out
        return out
    }

    /** Per dienst een achtergrond en een gemengde rij voorstellen. Zes uur in het geheugen. */
    fun home(ctx: Context, token: String): String {
        cache?.let { if (System.currentTimeMillis() - it.first < 6 * 3600_000L) return it.second }
        val services = JSONObject(ctx.assets.open("web/services.json").bufferedReader().readText())
            .getJSONArray("services")
        val withProvider = (0 until services.length()).map { services.getJSONObject(it) }
            .filter { it.optInt("provider", 0) > 0 && it.optString("key") != "plex" }
        val tasks = withProvider.map { s ->
            Callable {
                val key = s.getString("key")
                val p = s.getInt("provider")
                val tv = try { discover(token, "tv", p) } catch (_: Exception) { emptyList() }
                val mv = try { discover(token, "movie", p) } catch (_: Exception) { emptyList() }
                key to (tv.take(4).map { item(it, key) } + mv.take(2).map { item(it, key) })
            }
        }
        val per = pool.invokeAll(tasks).map { it.get() }
        val svc = JSONObject()
        for ((key, list) in per) list.firstOrNull()?.let { svc.put(key, it) }
        // Om en om per dienst, zodat de rij gemengd is; dubbele titels eruit.
        val picks = JSONArray()
        val seen = HashSet<String>()
        for (round in 0 until 6) for ((_, list) in per) {
            val it = list.getOrNull(round) ?: continue
            if (seen.add(it.getString("id"))) picks.put(it)
            if (picks.length() >= 14) break
        }
        val out = JSONObject().put("services", svc).put("picks", picks).toString()
        if (picks.length() > 0) cache = System.currentTimeMillis() to out
        return out
    }
}
