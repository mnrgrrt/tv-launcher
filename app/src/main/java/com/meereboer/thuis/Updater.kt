package com.meereboer.thuis

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.pm.PackageInstaller
import okhttp3.Request
import org.json.JSONObject
import java.io.File

/** Zelf bijwerken: een testversie kijkt naar de release "test", een gewone versie naar "laatste". */
object Updater {
    /** Release op GitHub: tv "test"/"laatste", telefoon "telefoon-test"/"telefoon". */
    private fun tag(ctx: Context): String {
        val name = try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "" } catch (_: Exception) { "" }
        val test = name.contains("test")
        return if (BuildConfig.TELEFOON) (if (test) "telefoon-test" else "telefoon") else (if (test) "test" else "laatste")
    }
    /** Bestandsnaam met het interne nummer; de tv houdt zijn oude naam, zodat oudere versies hem blijven vinden. */
    private val asset = if (BuildConfig.TELEFOON) Regex("^sjuul-telefoon-(\\d+)\\.apk$") else Regex("^thuis-(\\d+)\\.apk$")
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
                .mapNotNull { a -> asset.find(a.optString("name"))?.groupValues?.get(1)?.toInt()?.let { it to a.optString("browser_download_url") } }
                .maxByOrNull { it.first }
            return Latest(best?.first ?: 0, o.optString("name").removePrefix("Sjuul TV ").removePrefix("telefoon ").trim(), best?.second ?: "")
        }
    }

    fun check(ctx: Context): JSONObject {
        val l = latest(ctx)
        val cur = installedVersion(ctx)
        val curName = try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "" } catch (_: Exception) { "" }
        return JSONObject().put("current", curName).put("latest", l.name).put("newer", l.code > cur)
    }

    /** Downloadt de nieuwste APK, controleert het versienummer en installeert via de PackageInstaller van Android.
     *  Android vraagt dan zelf één keer "Installeren?"; daarna start Thuis vanzelf opnieuw. */
    fun downloadAndInstall(ctx: android.app.Activity): String {
        if (Build.VERSION.SDK_INT >= 26 && !ctx.packageManager.canRequestPackageInstalls()) {
            val i = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ctx.startActivity(i)
            return "permission"
        }
        val l = latest(ctx)
        if (l.url.isEmpty()) throw RuntimeException("Geen nieuwe versie gevonden")
        val tmp = File(ctx.cacheDir, "thuis-update.apk")
        try {
            Server.http.newCall(Request.Builder().url(l.url).build()).execute().use { r ->
                if (!r.isSuccessful) throw RuntimeException("Download mislukt (${r.code})")
                tmp.outputStream().use { out -> r.body!!.byteStream().copyTo(out) }
            }
            // Is dit echt de nieuwe versie? Anders niet installeren (scheelt een installatie van dezelfde versie).
            @Suppress("DEPRECATION")
            val got = ctx.packageManager.getPackageArchiveInfo(tmp.path, 0)?.let { if (Build.VERSION.SDK_INT >= 28) it.longVersionCode.toInt() else it.versionCode } ?: 0
            if (got <= installedVersion(ctx)) throw RuntimeException("De download was nog de oude versie. Probeer het over een minuut opnieuw.")
            val pi = ctx.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
                setAppPackageName(ctx.packageName)
                // Android 12+: zichzelf bijwerken zonder "Wil je deze app updaten?". Lukt dat niet, dan vraagt Android het alsnog (InstallResult).
                if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            }
            val id = pi.createSession(params)
            pi.openSession(id).use { session ->
                session.openWrite("thuis.apk", 0, tmp.length()).use { out -> tmp.inputStream().use { it.copyTo(out) }; session.fsync(out) }
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
                val result = PendingIntent.getBroadcast(ctx, id, Intent(ctx, InstallResult::class.java), flags)
                session.commit(result.intentSender)
            }
        } finally { tmp.delete() }
        return "install"
    }
}

/** Antwoord van de PackageInstaller: vraagt Android om bevestiging, dan tonen we dat scherm meteen. */
class InstallResult : BroadcastReceiver() {
    override fun onReceive(ctx: Context, i: Intent) {
        if (i.getIntExtra(PackageInstaller.EXTRA_STATUS, -999) != PackageInstaller.STATUS_PENDING_USER_ACTION) return
        @Suppress("DEPRECATION")
        val confirm = i.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
        ctx.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
