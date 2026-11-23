package com.meereboer.thuis

import android.content.Context
import android.os.Build
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Verbinding met tv-serverr. Het apparaat bewaart alleen het adres en zijn eigen sleutel;
 * alle andere sleutels en wachtwoorden blijven op de server.
 */
object Server {
    const val DEFAULT_URL = "http://192.168.40.60:8484"
    private const val SP = "thuis-server"

    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    private fun sp(ctx: Context) = ctx.getSharedPreferences(SP, Context.MODE_PRIVATE)
    fun url(ctx: Context): String = sp(ctx).getString("url", DEFAULT_URL) ?: DEFAULT_URL
    fun key(ctx: Context): String = sp(ctx).getString("key", "") ?: ""
    fun paired(ctx: Context) = key(ctx).isNotEmpty()

    /** Profiel dat nu kijkt (op dit apparaat). 0 = nog niet gekozen. */
    fun profile(ctx: Context): Int = sp(ctx).getInt("profile", 0)
    fun setProfile(ctx: Context, id: Int) = sp(ctx).edit().putInt("profile", id).apply()

    fun info(ctx: Context): JSONObject = JSONObject()
        .put("url", url(ctx)).put("paired", paired(ctx)).put("profile", profile(ctx))
        .put("device", Build.MODEL ?: "tv")

    /** Koppelen met de code van de beheerpagina. Bewaart de sleutel die de server teruggeeft. */
    fun pair(ctx: Context, url: String, code: String, name: String): String {
        val base = url.trim().trimEnd('/').ifEmpty { DEFAULT_URL }.let { if (it.startsWith("http")) it else "http://$it" }
        val body = JSONObject().put("code", code.trim()).put("name", name.ifBlank { Build.MODEL ?: "tv" }).toString()
        val req = Request.Builder().url("$base/api/pair").post(body.toRequestBody(JSON)).build()
        http.newCall(req).execute().use { r ->
            val txt = r.body?.string() ?: ""
            val o = try { JSONObject(txt) } catch (_: Exception) { JSONObject() }
            if (!r.isSuccessful) throw Exception(o.optString("error", "Koppelen mislukt (${r.code})"))
            sp(ctx).edit().putString("url", base).putString("key", o.getString("key")).apply()
        }
        return info(ctx).toString()
    }

    fun unpair(ctx: Context) = sp(ctx).edit().remove("key").remove("profile").apply()

    private val JSON = "application/json; charset=utf-8".toMediaType()

    /** Een API-aanroep. Geeft de tekst van het antwoord terug, of gooit een fout met de melding van de server. */
    fun call(ctx: Context, method: String, path: String, body: String? = null): String {
        val b = Request.Builder().url(url(ctx) + path).header("X-Thuis-Key", key(ctx))
        when (method.uppercase()) {
            "POST" -> b.post((body ?: "{}").toRequestBody(JSON))
            "PUT" -> b.put((body ?: "{}").toRequestBody(JSON))
            "DELETE" -> b.delete()
            else -> b.get()
        }
        http.newCall(b.build()).execute().use { r ->
            val txt = r.body?.string() ?: ""
            if (r.code == 401) throw Exception("NIET_GEKOPPELD")
            if (!r.isSuccessful) {
                val msg = try { JSONObject(txt).optString("error") } catch (_: Exception) { "" }
                throw Exception(msg.ifEmpty { "Server gaf fout ${r.code}" })
            }
            return txt
        }
    }

    /** Volledig adres voor een pad dat de server teruggeeft (streams, ondertitels). */
    fun abs(ctx: Context, path: String): String = if (path.startsWith("http")) path else url(ctx) + path
}
