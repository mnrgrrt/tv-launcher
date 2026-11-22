package com.meereboer.thuis

import android.content.Context
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.net.URLEncoder

/**
 * Nederlandse ondertitels via OpenSubtitles.com voor films en afleveringen zonder eigen NL-ondertitels.
 * Zoekt op TMDB-nummer (uit de IPTV-gegevens, anders via TMDB op titel). Gedownloade bestanden blijven bewaard,
 * zodat dezelfde film geen tweede download kost.
 */
object Subs {
    private const val API = "https://api.opensubtitles.com/api/v1"
    private const val UA = "Thuis v1.0"
    private val json = "application/json".toMediaType()

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    private fun req(p: Prefs, path: String, token: String? = null) = Request.Builder().url(API + path)
        .header("Api-Key", p.osKey).header("User-Agent", UA).header("Accept", "application/json")
        .apply { if (token != null) header("Authorization", "Bearer $token") }

    private fun call(r: Request): JSONObject = Xtream.http.newCall(r).execute().use {
        val body = it.body?.string().orEmpty()
        if (!it.isSuccessful) throw RuntimeException("OpenSubtitles ${it.code}: " + body.take(120))
        JSONObject(body.ifEmpty { "{}" })
    }

    /** Inloggen geeft een token dat 24 uur geldig is; we bewaren het 20 uur. */
    private fun token(ctx: Context, p: Prefs): String? {
        if (p.osUser.isEmpty() || p.osPass.isEmpty()) return null
        val sp = ctx.getSharedPreferences("subs", Context.MODE_PRIVATE)
        val t = sp.getString("token", "").orEmpty()
        if (t.isNotEmpty() && System.currentTimeMillis() - sp.getLong("tokenAt", 0) < 20 * 3600_000L) return t
        val body = JSONObject().put("username", p.osUser).put("password", p.osPass).toString().toRequestBody(json)
        val o = call(req(p, "/login").post(body).build())
        val nt = o.optString("token")
        sp.edit().putString("token", nt).putLong("tokenAt", System.currentTimeMillis()).apply()
        return nt
    }

    private fun tmdbId(p: Prefs, item: JSONObject): Int {
        // 1. Uit de IPTV-server
        try {
            val series = item.optString("kind") == "series"
            val raw = if (series) Xtream.api(p, "get_series_info", "&series_id=${enc(item.optString("seriesId"))}")
                      else Xtream.api(p, "get_vod_info", "&vod_id=${enc(item.optString("id"))}")
            val info = JSONObject(raw).optJSONObject("info")
            val id = (info?.optString("tmdb_id").orEmpty().ifEmpty { info?.optString("tmdb").orEmpty() }).toIntOrNull() ?: 0
            if (id > 0) return id
        } catch (_: Exception) { }
        // 2. Via TMDB op titel
        if (p.tmdbToken.isEmpty()) return 0
        return try {
            val type = if (item.optString("kind") == "series") "tv" else "movie"
            val title = item.optString("title").replace(Regex("\\s*\\(\\d{4}\\)\\s*$"), "").replace(Regex("^[A-Z]{2}\\s*[-|:]\\s*"), "")
            Tmdb.search(p, type, title)
        } catch (_: Exception) { 0 }
    }

    /** Geeft een .srt-bestand terug, of null als er niets te vinden is. */
    fun find(ctx: Context, p: Prefs, item: JSONObject): File? {
        if (p.osKey.isEmpty()) return null
        val dir = File(ctx.filesDir, "subs").apply { mkdirs() }
        val file = File(dir, item.optString("key").replace(Regex("[^A-Za-z0-9_-]"), "_") + ".nl.srt")
        if (file.exists() && file.length() > 0) return file
        val tmdb = tmdbId(p, item)
        val q = StringBuilder("/subtitles?languages=nl&order_by=download_count")
        if (item.optString("kind") == "series") {
            if (tmdb > 0) q.append("&parent_tmdb_id=$tmdb") else q.append("&query=${enc(item.optString("title"))}")
            if (item.optInt("season") > 0) q.append("&season_number=${item.optInt("season")}")
            if (item.optInt("episode") > 0) q.append("&episode_number=${item.optInt("episode")}")
        } else {
            if (tmdb > 0) q.append("&tmdb_id=$tmdb") else q.append("&query=${enc(item.optString("title"))}")
        }
        val data = call(req(p, q.toString()).get().build()).optJSONArray("data") ?: return null
        if (data.length() == 0) return null
        val fileId = data.getJSONObject(0).optJSONObject("attributes")?.optJSONArray("files")?.optJSONObject(0)?.optInt("file_id") ?: return null
        val body = JSONObject().put("file_id", fileId).put("sub_format", "srt").toString().toRequestBody(json)
        val link = call(req(p, "/download", token(ctx, p)).post(body).build()).optString("link")
        if (link.isEmpty()) return null
        val bytes = Xtream.http.newCall(Request.Builder().url(link).header("User-Agent", UA).build()).execute().use {
            if (!it.isSuccessful) return null
            it.body?.bytes() ?: return null
        }
        file.writeBytes(bytes)
        return file
    }
}
