package com.meereboer.thuis

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Live tv via tv-serverr: zenders, gids en (terugkijk)streams. De server kent de inlog van Dispatcharr, de tv niet. */
object LiveSrv {
    private val urls = HashMap<Int, String>()

    private fun channel(o: JSONObject): Channel {
        val c = Channel(o.getInt("id"), o.optInt("num"), o.optString("name"), o.optString("icon"), o.optString("cat"), o.optInt("archive"))
        o.optString("url").takeIf { it.isNotEmpty() }?.let { urls[c.id] = it }
        return c
    }

    /** De zenders van één categorie (of alle zenders), met de naam van die categorie. */
    fun load(ctx: Context, catId: String?): Pair<String, List<Channel>> {
        val cats = JSONArray(Server.call(ctx, "GET", "/api/live/categories"))
        var pick: JSONObject? = null
        for (i in 0 until cats.length()) {
            val c = cats.getJSONObject(i)
            if (c.optString("id") == (catId ?: "alle")) pick = c
            if (pick == null && c.optString("id") == "alle") pick = c
        }
        val c = pick ?: return "Alle zenders" to emptyList()
        val a = c.getJSONArray("channels")
        return c.optString("name") to (0 until a.length()).map { channel(a.getJSONObject(it)) }
    }

    fun streamUrl(ctx: Context, ch: Channel): String = Server.abs(ctx, urls[ch.id] ?: "/stream/live/${ch.id}")

    private fun progs(a: JSONArray?, archive: Boolean): List<Programme> {
        if (a == null) return emptyList()
        val now = System.currentTimeMillis()
        return (0 until a.length()).map { a.getJSONObject(it) }.map {
            Programme(it.optString("title"), it.optString("desc"), it.optLong("start"), it.optLong("end"), archive && it.optLong("end") < now)
        }
    }

    /** Gids rond nu: 20 uur terug, 6 uur vooruit (de server levert maximaal 26 uur per keer). */
    fun fullEpg(ctx: Context, ch: Channel): List<Programme> {
        val from = System.currentTimeMillis() - 20 * 3600_000L
        val a = JSONArray(Server.call(ctx, "GET", "/api/live/guide?ids=${ch.id}&from=$from&to=${from + 26 * 3600_000L}"))
        return if (a.length() == 0) emptyList() else progs(a.getJSONObject(0).optJSONArray("programmes"), ch.archiveDays > 0)
    }

    fun shortEpg(ctx: Context, id: Int): List<Programme> =
        progs(JSONObject(Server.call(ctx, "GET", "/api/live/nownext?ids=$id")).optJSONArray(id.toString()), false)

    /** Terugkijken: vraagt de server om een (ondertekende) link. Netwerk, dus niet op de UI-thread aanroepen. */
    fun catchupUrl(ctx: Context, ch: Channel, p: Programme): String =
        Server.abs(ctx, JSONObject(Server.call(ctx, "GET", "/api/live/catchup/${ch.id}?start=${p.start}&end=${p.end}")).getString("url"))
}
