package com.meereboer.thuis

import android.util.Base64
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

data class Channel(
    val id: Int,
    val num: Int,
    val name: String,
    val icon: String,
    val categoryId: String,
    /** Dagen terugkijken die de aanbieder voor deze zender bewaart (0 = geen). */
    val archiveDays: Int = 0
)

data class Programme(val title: String, val desc: String, val start: Long, val end: Long, val archive: Boolean = false)

/** Praat met Dispatcharr via de Xtream Codes-API, net als MYTVOnline. */
object Xtream {
    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    @Volatile var channels: List<Channel> = emptyList()
    @Volatile var categories: Map<String, String> = emptyMap()
    @Volatile private var loadedAt = 0L
    /** Tijdzone van de server; nodig voor de terugkijk-links. */
    @Volatile var serverTz: java.util.TimeZone = java.util.TimeZone.getDefault()

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    private fun get(url: String): String {
        http.newCall(Request.Builder().url(url).build()).execute().use { r ->
            if (!r.isSuccessful) throw RuntimeException("Server gaf fout ${r.code}")
            return r.body?.string() ?: ""
        }
    }

    fun api(p: Prefs, action: String?, extra: String = ""): String {
        if (!p.configured) throw RuntimeException("Nog niet ingesteld")
        val url = "${p.server}/player_api.php?username=${enc(p.user)}&password=${enc(p.pass)}" +
            (if (action != null) "&action=$action" else "") + extra
        return get(url)
    }

    /** Controleert de login. Geeft user_info terug zoals de server die meldt. */
    fun test(p: Prefs): JSONObject {
        val o = JSONObject(api(p, null))
        val ui = o.optJSONObject("user_info") ?: throw RuntimeException("Onverwacht antwoord van de server")
        if (ui.optInt("auth", 1) == 0) throw RuntimeException("Inloggen mislukt")
        return ui
    }

    @Synchronized
    fun load(p: Prefs, force: Boolean = false): List<Channel> {
        val fresh = System.currentTimeMillis() - loadedAt < 6 * 3600_000L
        if (!force && channels.isNotEmpty() && fresh) return channels
        val cm = HashMap<String, String>()
        try {
            val cats = JSONArray(api(p, "get_live_categories"))
            for (i in 0 until cats.length()) {
                val c = cats.getJSONObject(i)
                cm[c.optString("category_id")] = c.optString("category_name")
            }
        } catch (_: Exception) { }
        val arr = JSONArray(api(p, "get_live_streams"))
        val list = ArrayList<Channel>(arr.length())
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            list.add(
                Channel(
                    id = o.optInt("stream_id"),
                    num = o.optInt("num", i + 1),
                    name = o.optString("name"),
                    icon = o.optString("stream_icon"),
                    categoryId = o.optString("category_id"),
                    archiveDays = if (o.optInt("tv_archive", 0) == 1) o.optInt("tv_archive_duration", 1).coerceAtLeast(1) else 0
                )
            )
        }
        list.sortBy { it.num }
        try {
            val tz = JSONObject(api(p, null)).optJSONObject("server_info")?.optString("timezone").orEmpty()
            if (tz.isNotEmpty()) serverTz = java.util.TimeZone.getTimeZone(tz)
        } catch (_: Exception) { }
        categories = cm
        channels = list
        loadedAt = System.currentTimeMillis()
        return list
    }

    fun streamUrl(p: Prefs, c: Channel) =
        "${p.server}/live/${enc(p.user)}/${enc(p.pass)}/${c.id}.${p.format}"

    private val b64chars = Regex("^[A-Za-z0-9+/=\\s]+$")

    /** Titels in de korte gids zijn meestal base64. Als dat niet zo is, gewoon de tekst houden. */
    private fun text(s: String): String {
        if (s.isEmpty() || s.length % 4 != 0 || !b64chars.matches(s)) return s
        return try {
            val d = String(Base64.decode(s, Base64.DEFAULT), Charsets.UTF_8)
            if (d.contains('�') || d.any { it.code < 9 }) s else d
        } catch (_: Exception) { s }
    }

    /**
     * Volledige gids van één zender, ook wat al geweest is (voor terugkijken).
     * Valt terug op de korte gids als de server dat niet ondersteunt.
     */
    fun fullEpg(p: Prefs, ch: Channel): List<Programme> {
        val now = System.currentTimeMillis()
        val from = now - (if (ch.archiveDays > 0) ch.archiveDays.coerceAtMost(3) else 0) * 86_400_000L - 3 * 3600_000L
        val until = now + 24 * 3600_000L
        try {
            val o = JSONObject(api(p, "get_simple_data_table", "&stream_id=${ch.id}"))
            val a = o.optJSONArray("epg_listings")
            if (a != null && a.length() > 0) {
                val out = ArrayList<Programme>()
                for (i in 0 until a.length()) {
                    val e = a.getJSONObject(i)
                    val st = (e.optString("start_timestamp").toLongOrNull() ?: 0L) * 1000
                    val en = (e.optString("stop_timestamp").toLongOrNull() ?: 0L) * 1000
                    if (en < from || st > until || st == 0L) continue
                    val arch = e.optInt("has_archive", 0) == 1 || (ch.archiveDays > 0 && st < now)
                    out.add(Programme(text(e.optString("title")), text(e.optString("description")), st, en, arch))
                }
                if (out.isNotEmpty()) return out.sortedBy { it.start }.distinctBy { it.start }
            }
        } catch (_: Exception) { }
        return shortEpg(p, ch.id, 12)
    }

    /** Link om een programma terug te kijken (Xtream timeshift), tijd in de tijdzone van de server. */
    fun timeshiftUrl(p: Prefs, ch: Channel, prog: Programme): String {
        val fmt = java.text.SimpleDateFormat("yyyy-MM-dd:HH-mm", java.util.Locale.US).apply { timeZone = serverTz }
        val minutes = ((prog.end - prog.start) / 60_000L).coerceAtLeast(1)
        return "${p.server}/timeshift/${enc(p.user)}/${enc(p.pass)}/$minutes/${fmt.format(java.util.Date(prog.start))}/${ch.id}.ts"
    }

    /** Wat er nu en straks op een zender is. Wordt bij elke zap opnieuw opgehaald. */
    fun shortEpg(p: Prefs, id: Int, limit: Int = 2): List<Programme> {
        val o = JSONObject(api(p, "get_short_epg", "&stream_id=$id&limit=$limit"))
        val a = o.optJSONArray("epg_listings") ?: return emptyList()
        val out = ArrayList<Programme>()
        val now = System.currentTimeMillis()
        for (i in 0 until a.length()) {
            val e = a.getJSONObject(i)
            val st = e.optString("start_timestamp").toLongOrNull() ?: 0L
            val en = e.optString("stop_timestamp").toLongOrNull() ?: 0L
            val prog = Programme(text(e.optString("title")), text(e.optString("description")), st * 1000, en * 1000)
            if (prog.end == 0L || prog.end > now) out.add(prog)
        }
        return out
    }
}
