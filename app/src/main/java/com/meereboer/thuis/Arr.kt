package com.meereboer.thuis

import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** "Binnenkort": films uit Radarr en afleveringen uit Sonarr die de komende weken uitkomen. */
object Arr {
    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
    private val day = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    private val label = SimpleDateFormat("EEE d MMM", Locale("nl", "NL"))
    private val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }

    private fun get(url: String, key: String): JSONArray =
        Xtream.http.newCall(Request.Builder().url(url).header("X-Api-Key", key).header("Accept", "application/json").build()).execute().use {
            if (!it.isSuccessful) throw RuntimeException("fout ${it.code}")
            JSONArray(it.body?.string() ?: "[]")
        }

    private fun parse(s: String): Long = try { iso.parse(s.take(19))?.time ?: 0L } catch (_: Exception) { 0L }

    private fun image(images: JSONArray?, type: String): String {
        if (images == null) return ""
        for (i in 0 until images.length()) images.getJSONObject(i).let {
            if (it.optString("coverType") == type) {
                val u = it.optString("remoteUrl")
                return if (u.startsWith("http://")) "https://appassets.androidplatform.net/proxy?u=${enc(u)}" else u
            }
        }
        return ""
    }

    private fun range(days: Int): String {
        val now = System.currentTimeMillis()
        return "start=${day.format(Date(now - 86_400_000L))}&end=${day.format(Date(now + days * 86_400_000L))}"
    }

    fun upcoming(p: Prefs, kind: String): String {
        val out = ArrayList<JSONObject>()
        if (kind == "series") {
            if (p.sonarrUrl.isEmpty() || p.sonarrKey.isEmpty()) return "[]"
            val a = get("${p.sonarrUrl}/api/v3/calendar?${range(21)}&includeSeries=true&unmonitored=false", p.sonarrKey)
            val seen = HashSet<String>()
            for (i in 0 until a.length()) a.getJSONObject(i).let { e ->
                val s = e.optJSONObject("series") ?: return@let
                val t = parse(e.optString("airDateUtc"))
                // Eén tegel per serie per dag
                if (!seen.add(s.optString("title") + day.format(Date(t)))) return@let
                out.add(JSONObject()
                    .put("title", s.optString("title"))
                    .put("sub", "S${e.optInt("seasonNumber")} · afl. ${e.optInt("episodeNumber")} · ${e.optString("title")}")
                    .put("when", t).put("date", label.format(Date(t)))
                    .put("hasFile", e.optBoolean("hasFile"))
                    .put("thumb", image(s.optJSONArray("images"), "poster"))
                    .put("art", image(s.optJSONArray("images"), "fanart"))
                    .put("summary", e.optString("overview").ifEmpty { s.optString("overview") }))
            }
        } else {
            if (p.radarrUrl.isEmpty() || p.radarrKey.isEmpty()) return "[]"
            val a = get("${p.radarrUrl}/api/v3/calendar?${range(60)}&unmonitored=false", p.radarrKey)
            for (i in 0 until a.length()) a.getJSONObject(i).let { m ->
                // Voor thuis telt de digitale release; anders fysiek, anders bioscoop.
                val (t, kind2) = listOf("digitalRelease" to "digitaal", "physicalRelease" to "dvd/blu-ray", "inCinemas" to "bioscoop")
                    .map { parse(m.optString(it.first)) to it.second }.firstOrNull { it.first > 0 } ?: return@let
                out.add(JSONObject()
                    .put("title", m.optString("title"))
                    .put("sub", kind2)
                    .put("when", t).put("date", label.format(Date(t)))
                    .put("hasFile", m.optBoolean("hasFile"))
                    .put("year", m.optString("year"))
                    .put("thumb", image(m.optJSONArray("images"), "poster"))
                    .put("art", image(m.optJSONArray("images"), "fanart"))
                    .put("summary", m.optString("overview")))
            }
        }
        val arr = JSONArray()
        out.sortedBy { it.optLong("when") }.take(40).forEach { arr.put(it) }
        return arr.toString()
    }
}
