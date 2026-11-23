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
    private fun apk(ctx: Context) = "https://github.com/mnrgrrt/tv-launcher/releases/download/${tag(ctx)}/thuis.apk"

    fun installedVersion(ctx: Context): Int {
        val pi = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        @Suppress("DEPRECATION")
        return if (Build.VERSION.SDK_INT >= 28) pi.longVersionCode.toInt() else pi.versionCode
    }

    /** Nieuwste build: intern nummer uit de bestandsnaam thuis-<nummer>.apk, zichtbare naam uit de release ("Thuis 1.03"). */
    private fun latest(ctx: Context): Pair<Int, String> {
        val req = Request.Builder().url(api(ctx)).header("Accept", "application/vnd.github+json").build()
        Server.http.newCall(req).execute().use { r ->
            if (!r.isSuccessful) throw RuntimeException("GitHub gaf fout ${r.code}")
            val o = JSONObject(r.body?.string() ?: "{}")
            val assets = o.optJSONArray("assets")
            val code = (0 until (assets?.length() ?: 0)).mapNotNull { Regex("^thuis-(\\d+)\\.apk$").find(assets!!.getJSONObject(it).optString("name"))?.groupValues?.get(1)?.toInt() }.maxOrNull() ?: 0
            return code to o.optString("name").removePrefix("Thuis ").trim()
        }
    }

    fun check(ctx: Context): JSONObject {
        val (code, name) = latest(ctx)
        val cur = installedVersion(ctx)
        val curName = try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "" } catch (_: Exception) { "" }
        return JSONObject().put("current", curName).put("latest", name).put("newer", code > cur)
    }

    /** Downloadt de APK en opent het installatiescherm van Android. */
    fun downloadAndInstall(ctx: Context): String {
        if (Build.VERSION.SDK_INT >= 26 && !ctx.packageManager.canRequestPackageInstalls()) {
            val i = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ctx.startActivity(i)
            return "permission"
        }
        val dir = File(ctx.cacheDir, "updates").apply { mkdirs() }
        val file = File(dir, "thuis.apk")
        Server.http.newCall(Request.Builder().url(apk(ctx)).build()).execute().use { r ->
            if (!r.isSuccessful) throw RuntimeException("Download mislukt (${r.code})")
            file.outputStream().use { out -> r.body!!.byteStream().copyTo(out) }
        }
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.updates", file)
        val i = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(i)
        return "install"
    }
}
