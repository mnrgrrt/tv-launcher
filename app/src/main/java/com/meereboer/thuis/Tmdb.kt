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
            "&with_watch_monetization_types=flatrate&sort_by=popularity.desc&language=nl-NL&page=1&include_adult=false")
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
