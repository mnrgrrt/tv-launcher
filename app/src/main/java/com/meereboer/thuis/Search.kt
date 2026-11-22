package com.meereboer.thuis

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Callable
import java.util.concurrent.Executors

/** Eén zoekvak voor alles: Plex, IPTV-films, IPTV-series en de streamingdiensten (via TMDB). */
object Search {
    private val pool = Executors.newFixedThreadPool(6)

    fun all(ctx: Context, p: Prefs, q: String): String {
        val tasks = listOf(
            Callable { "plex" to (try { PlexLib.search(p, q) } catch (_: Exception) { JSONArray() }) },
            Callable { "movies" to (try { if (p.configured) Vod.search(p, "movie", q) else JSONArray() } catch (_: Exception) { JSONArray() }) },
            Callable { "series" to (try { if (p.configured) Vod.search(p, "series", q) else JSONArray() } catch (_: Exception) { JSONArray() }) },
            Callable { "streaming" to (try { Tmdb.searchStreaming(ctx, p, q) } catch (_: Exception) { JSONArray() }) }
        )
        val out = JSONObject()
        pool.invokeAll(tasks).forEach { val (k, v) = it.get(); out.put(k, v) }
        return out.toString()
    }
}
