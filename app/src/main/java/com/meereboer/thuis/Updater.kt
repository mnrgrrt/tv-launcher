package com.meereboer.thuis

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import okhttp3.Request
import org.json.JSONObject
import java.io.File

/** Zelf bijwerken: een testversie kijkt naar de release "test", een gewone versie naar "laatste". */
object Updater {
    private fun tag(ctx: Context): String {
        val name = try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "" } catch (_: Exception) { "" }
        return if (name.contains("test")) "test" else "laatste"
    }
    private fun api(ctx: Context) = "https://api.github.com/repos/mnrgrrt/tv-launcher/releases/tags/${tag(ctx)}"

    fun installedVersion(ctx: Context): Int {
        val pi = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        @Suppress("DEPRECATION")
        return if (Build.VERSION.SDK_INT >= 28) pi.longVersionCode.toInt() else pi.versionCode
    }

    private class Latest(val code: Int, val name: String, val url: String)

    /** Nieuwste build: intern nummer uit de bestandsnaam thuis-<nummer>.apk, zichtbare naam uit de release ("Thuis 1.03").
     *  We downloaden precies dat genummerde bestand: de vaste naam thuis.apk kan bij GitHub nog even de vorige versie geven. */
    private fun latest(ctx: Context): Latest {
        val req = Request.Builder().url(api(ctx)).header("Accept", "application/vnd.github+json").build()
        Server.http.newCall(req).execute().use { r ->
            if (!r.isSuccessful) throw RuntimeException("GitHub gaf fout ${r.code}")
            val o = JSONObject(r.body?.string() ?: "{}")
            val assets = o.optJSONArray("assets")
            val best = (0 until (assets?.length() ?: 0)).map { assets!!.getJSONObject(it) }
                .mapNotNull { a -> Regex("^thuis-(\\d+)\\.apk$").find(a.optString("name"))?.groupValues?.get(1)?.toInt()?.let { it to a.optString("browser_download_url") } }
                .maxByOrNull { it.first }
            return Latest(best?.first ?: 0, o.optString("name").removePrefix("Thuis ").trim(), best?.second ?: "")
        }
    }

    fun check(ctx: Context): JSONObject {
        val l = latest(ctx)
        val cur = installedVersion(ctx)
        val curName = try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "" } catch (_: Exception) { "" }
        return JSONObject().put("current", curName).put("latest", l.name).put("newer", l.code > cur)
    }

    /** Downloadt de nieuwste APK, controleert het versienummer en opent meteen het installatiescherm van Android. */
    fun downloadAndInstall(ctx: android.app.Activity): String {
        if (Build.VERSION.SDK_INT >= 26 && !ctx.packageManager.canRequestPackageInstalls()) {
            val i = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ctx.startActivity(i)
            return "permission"
        }
        val dir = File(ctx.cacheDir, "updates").apply { mkdirs() }
        val l = latest(ctx)
        if (l.url.isEmpty()) throw RuntimeException("Geen nieuwe versie gevonden")
        val file = File(dir, "thuis.apk")
        val tmp = File(dir, "thuis.apk.part")
        Server.http.newCall(Request.Builder().url(l.url).build()).execute().use { r ->
            if (!r.isSuccessful) throw RuntimeException("Download mislukt (${r.code})")
            tmp.outputStream().use { out -> r.body!!.byteStream().copyTo(out) }
        }
        // Is dit echt de nieuwe versie? Anders niet installeren (scheelt een installatie van dezelfde versie).
        @Suppress("DEPRECATION")
        val got = ctx.packageManager.getPackageArchiveInfo(tmp.path, 0)?.let { if (Build.VERSION.SDK_INT >= 28) it.longVersionCode.toInt() else it.versionCode } ?: 0
        if (got <= installedVersion(ctx)) { tmp.delete(); throw RuntimeException("De download was nog de oude versie. Probeer het over een minuut opnieuw.") }
        file.delete(); tmp.renameTo(file)
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.updates", file)
        val i = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.runOnUiThread { ctx.startActivity(i) }
        return "install"
    }
}
