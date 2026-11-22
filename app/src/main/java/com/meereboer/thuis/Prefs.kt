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
    /** Deel van een groepsnaam die op het startscherm komt, leeg = eerste zenders. */
    var homeGroup: String
        get() = sp.getString("homeGroup", "") ?: ""
        set(v) = sp.edit().putString("homeGroup", v.trim()).apply()
    var lastChannel: Int
        get() = sp.getInt("lastChannel", -1)
        set(v) = sp.edit().putInt("lastChannel", v).apply()

    val configured: Boolean get() = server.isNotEmpty() && user.isNotEmpty()

    fun toJson(): JSONObject = JSONObject()
        .put("server", server).put("user", user).put("pass", pass)
        .put("format", format).put("homeGroup", homeGroup)
        .put("configured", configured)

    fun fromJson(o: JSONObject) {
        server = o.optString("server")
        user = o.optString("user")
        pass = o.optString("pass")
        format = o.optString("format", "ts")
        homeGroup = o.optString("homeGroup")
    }
}
