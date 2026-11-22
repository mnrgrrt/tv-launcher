package com.meereboer.thuis

import android.content.Context
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.Normalizer
import java.util.concurrent.TimeUnit

data class SmartCategory(val id: String, val name: String, val img: String, val channels: List<Channel>, val parent: String? = null, val last: Boolean = false)

/**
 * Slimme categorieën op basis van zendernamen. De regels staan in shared/categories.json.
 * De app haalt de nieuwste regels van GitHub, met de meegeleverde versie als terugval.
 */
object Categorizer {
    private const val RULES_URL = "https://raw.githubusercontent.com/mnrgrrt/tv-launcher/main/shared/categories.json"
    private val dropTokens = setOf("nl", "be", "vl", "uk", "hd", "fhd", "uhd", "sd", "4k", "hevc", "h265", "h264", "50fps", "backup", "raw")

    @Volatile private var rules: JSONObject? = null
    @Volatile private var rulesAt = 0L

    /** "NL: SBS 6 HD" wordt "sbs6", "|BE| Één FHD" wordt "een". */
    fun norm(name: String): String {
        val plain = Normalizer.normalize(name, Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "")
        val tokens = plain.lowercase().split(Regex("[^a-z0-9]+")).filter { it.isNotEmpty() }
        return tokens.filter { it !in dropTokens }.joinToString("")
    }

    private fun matches(n: String, pattern: String): Boolean {
        val p = pattern.lowercase()
        return if (p.endsWith("*")) n.startsWith(p.dropLast(1)) else n == p
    }

    @Synchronized
    fun loadRules(ctx: Context): JSONObject {
        val fresh = System.currentTimeMillis() - rulesAt < 3600_000L
        rules?.let { if (fresh) return it }
        val cache = File(ctx.filesDir, "categories.json")
        val text = try {
            val client = Xtream.http.newBuilder().connectTimeout(4, TimeUnit.SECONDS).readTimeout(6, TimeUnit.SECONDS).build()
            client.newCall(Request.Builder().url(RULES_URL).build()).execute().use { r ->
                if (!r.isSuccessful) throw RuntimeException()
                r.body!!.string().also { JSONObject(it); cache.writeText(it) }
            }
        } catch (_: Exception) {
            if (cache.exists()) cache.readText() else ctx.assets.open("categories.json").bufferedReader().readText()
        }
        val o = JSONObject(text)
        rules = o
        rulesAt = System.currentTimeMillis()
        return o
    }

    private fun strings(a: JSONArray?): List<String> =
        if (a == null) emptyList() else (0 until a.length()).map { a.optString(it) }.filter { it.isNotEmpty() }

    fun build(ctx: Context, all: List<Channel>): List<SmartCategory> {
        val r = loadRules(ctx)
        val normed = all.map { it to norm(it.name) }
        val out = ArrayList<SmartCategory>()
        val cats = r.optJSONArray("categories") ?: JSONArray()
        for (i in 0 until cats.length()) {
            val c = cats.getJSONObject(i)
            val include = strings(c.optJSONArray("include"))
            val exclude = strings(c.optJSONArray("exclude"))
            val groups = strings(c.optJSONArray("groups")).map { it.lowercase() }
            val picked = LinkedHashSet<Channel>()
            fun ok(n: String) = exclude.none { matches(n, it) }
            for (p in include) {
                // Een exacte naam (zonder *) levert maar één zender op: de laagste nummering wint.
                // Zo komt "NPO 1" niet twee keer voor als de lijst ook een reservekopie heeft.
                val hits = normed.filter { (_, n) -> matches(n, p) && ok(n) }.map { it.first }
                if (p.endsWith("*")) picked.addAll(hits) else hits.firstOrNull { it !in picked }?.let { picked.add(it) }
            }
            if (groups.isNotEmpty()) {
                val ids = Xtream.categories.filterValues { g -> groups.any { g.lowercase().contains(it) } }.keys
                for ((ch, n) in normed) if (ch.categoryId in ids && ok(n)) picked.add(ch)
            }
            val parent = c.optString("parent").ifEmpty { null }
            out.add(SmartCategory(c.optString("id"), c.optString("name"), c.optString("img"), picked.toList(), parent, c.optBoolean("last")))
        }
        // Hoofdcategorie met subrijen: ook alles uit de subrijen hoort erbij, plus een rij "Overige".
        for (parent in out.filter { it.parent == null }) {
            val kids = out.filter { it.parent == parent.id }
            if (kids.isEmpty()) continue
            val inKids = kids.flatMap { it.channels }.toSet()
            val merged = LinkedHashSet<Channel>(parent.channels).apply { addAll(inKids) }
            val rest = merged.filter { it !in inKids }
            out[out.indexOf(parent)] = parent.copy(channels = merged.toList())
            out.add(SmartCategory(parent.id + "-overig", "Overige " + parent.name.lowercase(), parent.img, rest, parent.id))
        }
        if (r.optBoolean("alle", true)) out.add(SmartCategory("alle", "Alle zenders", "aurora", all))
        return out
    }

    /** Schrijft de zenderlijst met indeling naar Downloads/thuis-zenders.tsv, zodat de regels af te stemmen zijn. */
    fun export(ctx: Context, all: List<Channel>, cats: List<SmartCategory>) {
        try {
            val where = HashMap<Int, MutableList<String>>()
            for (c in cats) if (c.id != "alle") for (ch in c.channels) where.getOrPut(ch.id) { mutableListOf() }.add(c.id)
            val sb = StringBuilder("num\tnaam\tgenormaliseerd\tgroep\tcategorie\n")
            for (ch in all) {
                sb.append(ch.num).append('\t').append(ch.name).append('\t').append(norm(ch.name)).append('\t')
                    .append(Xtream.categories[ch.categoryId] ?: "").append('\t')
                    .append(where[ch.id]?.joinToString(",") ?: "-").append('\n')
            }
            writeDownload(ctx, "thuis-zenders.tsv", sb.toString().toByteArray())
        } catch (_: Exception) { }
    }

    /** Lijst met film- en seriecategorieën van de IPTV-server naar Downloads/thuis-vod.tsv. */
    fun exportVod(ctx: Context, p: Prefs) {
        try {
            val sb = StringBuilder("soort\tid\tnaam\n")
            for ((soort, action) in listOf("film" to "get_vod_categories", "serie" to "get_series_categories")) {
                val a = try { org.json.JSONArray(Xtream.api(p, action)) } catch (e: Exception) { sb.append("$soort\t-\tFOUT: ${e.message}\n"); continue }
                for (i in 0 until a.length()) a.getJSONObject(i).let {
                    sb.append(soort).append('\t').append(it.optString("category_id")).append('\t').append(it.optString("category_name")).append('\n')
                }
            }
            writeDownload(ctx, "thuis-vod.tsv", sb.toString().toByteArray())
        } catch (_: Exception) { }
    }

    private fun writeDownload(ctx: Context, name: String, bytes: ByteArray) {
        try {
            if (android.os.Build.VERSION.SDK_INT >= 29) {
                val res = ctx.contentResolver
                val col = android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI
                res.delete(col, "${android.provider.MediaStore.MediaColumns.DISPLAY_NAME} LIKE ?", arrayOf("$name%"))
                val values = android.content.ContentValues().apply {
                    put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, name)
                    put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "text/plain")
                    put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, "Download/")
                }
                res.insert(col, values)?.let { uri -> res.openOutputStream(uri)?.use { it.write(bytes) } }
            } else {
                ctx.getExternalFilesDir(null)?.let { File(it, name).writeBytes(bytes) }
            }
        } catch (_: Exception) { }
    }
}
