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

/** Zelf bijwerken vanaf de GitHub-release "laatste". */
object Updater {
    private const val API = "https://api.github.com/repos/mnrgrrt/tv-launcher/releases/tags/laatste"
    private const val APK = "https://github.com/mnrgrrt/tv-launcher/releases/download/laatste/thuis.apk"

    fun installedVersion(ctx: Context): Int {
        val pi = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        @Suppress("DEPRECATION")
        return if (Build.VERSION.SDK_INT >= 28) pi.longVersionCode.toInt() else pi.versionCode
    }

    /** Versienummer van de nieuwste build, uit de releasenaam "Thuis 12". */
    fun latestVersion(): Int {
        val req = Request.Builder().url(API).header("Accept", "application/vnd.github+json").build()
        Xtream.http.newCall(req).execute().use { r ->
            if (!r.isSuccessful) throw RuntimeException("GitHub gaf fout ${r.code}")
            val name = JSONObject(r.body?.string() ?: "{}").optString("name")
            return Regex("(\\d+)").find(name)?.value?.toInt() ?: 0
        }
    }

    fun check(ctx: Context): JSONObject {
        val cur = installedVersion(ctx)
        val latest = latestVersion()
        return JSONObject().put("current", cur).put("latest", latest).put("newer", latest > cur)
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
        Xtream.http.newCall(Request.Builder().url(APK).build()).execute().use { r ->
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
