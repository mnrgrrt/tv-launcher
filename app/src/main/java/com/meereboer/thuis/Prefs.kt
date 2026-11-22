package com.meereboer.thuis

import android.content.Context
import org.json.JSONObject

/** Instellingen die op het apparaat zelf worden opgeslagen (niet in de code). */
class Prefs(ctx: Context) {
    private val sp = ctx.getSharedPreferences("thuis", Context.MODE_PRIVATE)

    var server: String
        get() = sp.getString("server", "") ?: ""
        set(v) = sp.edit().putString("server", v.trim().trimEnd('/')).apply()
    var user: String
        get() = sp.getString("user", "") ?: ""
        set(v) = sp.edit().putString("user", v.trim()).apply()
    var pass: String
        get() = sp.getString("pass", "") ?: ""
        set(v) = sp.edit().putString("pass", v).apply()
    /** "ts" of "m3u8" */
    var format: String
        get() = sp.getString("format", "ts") ?: "ts"
        set(v) = sp.edit().putString("format", if (v == "m3u8") "m3u8" else "ts").apply()
    /** Welke categorieën op het startscherm komen, gescheiden door komma's. Leeg = allemaal. */
    var categories: String
        get() = sp.getString("categories", "") ?: ""
        set(v) = sp.edit().putString("categories", v.trim()).apply()
    var tmdbToken: String
        get() = sp.getString("tmdbToken", "") ?: ""
        set(v) = sp.edit().putString("tmdbToken", v.trim()).apply()
    /** Home Assistant-webhook die een app op de JBL start, bijv. http://192.168.x.x:8123/api/webhook/... */
    var jblWebhook: String
        get() = sp.getString("jblWebhook", "") ?: ""
        set(v) = sp.edit().putString("jblWebhook", v.trim()).apply()
    var plexUrl: String
        get() = sp.getString("plexUrl", "") ?: ""
        set(v) = sp.edit().putString("plexUrl", v.trim().trimEnd('/')).apply()
    var plexToken: String
        get() = sp.getString("plexToken", "") ?: ""
        set(v) = sp.edit().putString("plexToken", v.trim()).apply()
    var jellyfinUrl: String
        get() = sp.getString("jellyfinUrl", "") ?: ""
        set(v) = sp.edit().putString("jellyfinUrl", v.trim().trimEnd('/')).apply()
    var osKey: String
        get() = sp.getString("osKey", "") ?: ""
        set(v) = sp.edit().putString("osKey", v.trim()).apply()
    var osUser: String
        get() = sp.getString("osUser", "") ?: ""
        set(v) = sp.edit().putString("osUser", v.trim()).apply()
    var osPass: String
        get() = sp.getString("osPass", "") ?: ""
        set(v) = sp.edit().putString("osPass", v).apply()
    var jellyfinKey: String
        get() = sp.getString("jellyfinKey", "") ?: ""
        set(v) = sp.edit().putString("jellyfinKey", v.trim()).apply()
    /** Adres van de Thuis-brug op de JBL, bijv. http://192.168.10.85:8765 */
    /** Adres van de uitlezing van het JBL-startscherm (door HA klaargezet). */
    var jblListUrl: String
        get() = sp.getString("jblListUrl", "") ?: ""
        set(v) = sp.edit().putString("jblListUrl", v.trim()).apply()
    var brugUrl: String
        get() = sp.getString("brugUrl", "") ?: ""
        set(v) = sp.edit().putString("brugUrl", v.trim().trimEnd('/')).apply()
    var lastChannel: Int
        get() = sp.getInt("lastChannel", -1)
        set(v) = sp.edit().putInt("lastChannel", v).apply()

    val configured: Boolean get() = server.isNotEmpty() && user.isNotEmpty()

    fun toJson(): JSONObject = JSONObject()
        .put("server", server).put("user", user).put("pass", pass)
        .put("format", format).put("categories", categories)
        .put("tmdbToken", tmdbToken).put("jblWebhook", jblWebhook)
        .put("plexUrl", plexUrl).put("plexToken", plexToken).put("jellyfinUrl", jellyfinUrl).put("jellyfinKey", jellyfinKey).put("osKey", osKey).put("osUser", osUser).put("osPass", osPass).put("brugUrl", brugUrl).put("jblListUrl", jblListUrl)
        .put("configured", configured)

    fun fromJson(o: JSONObject) {
        server = o.optString("server")
        user = o.optString("user")
        pass = o.optString("pass")
        format = o.optString("format", "ts")
        categories = o.optString("categories")
        if (o.has("tmdbToken")) tmdbToken = o.optString("tmdbToken")
        if (o.has("jblWebhook")) jblWebhook = o.optString("jblWebhook")
        if (o.has("plexUrl")) plexUrl = o.optString("plexUrl")
        if (o.has("plexToken")) plexToken = o.optString("plexToken")
        if (o.has("jellyfinUrl")) jellyfinUrl = o.optString("jellyfinUrl")
        if (o.has("jellyfinKey")) jellyfinKey = o.optString("jellyfinKey")
        if (o.has("osKey")) osKey = o.optString("osKey")
        if (o.has("osUser")) osUser = o.optString("osUser")
        if (o.has("osPass")) osPass = o.optString("osPass")
        if (o.has("brugUrl")) brugUrl = o.optString("brugUrl")
        if (o.has("jblListUrl")) jblListUrl = o.optString("jblListUrl")
    }
}
