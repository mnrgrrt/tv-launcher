package com.meereboer.thuis

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.Drawable
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/** Geïnstalleerde apps, met hun TV-banner, in een vaste volgorde voor de bekende diensten. */
object AppList {
    private val order = listOf(
        "plex", "netflix", "prime", "videoland", "skyshowtime", "sky", "youtube",
        "npo", "ziggo", "mytv", "disney", "viaplay", "espn", "spotify"
    )

    private data class App(val pkg: String, val label: String, val banner: String, val icon: String)

    fun load(ctx: Context): JSONArray {
        val pm = ctx.packageManager
        val seen = HashSet<String>()
        val apps = ArrayList<App>()
        for (cat in listOf(Intent.CATEGORY_LEANBACK_LAUNCHER, Intent.CATEGORY_LAUNCHER)) {
            val ris = pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(cat), 0)
            for (ri in ris) {
                val pkg = ri.activityInfo.packageName
                if (pkg == ctx.packageName || !seen.add(pkg)) continue
                val label = ri.loadLabel(pm).toString()
                val bannerDrawable = ri.activityInfo.loadBanner(pm) ?: ri.activityInfo.applicationInfo.loadBanner(pm)
                val banner = bannerDrawable?.let { dataUrl(it, 320, 180) } ?: ""
                val icon = if (banner.isEmpty()) dataUrl(ri.loadIcon(pm), 128, 128) else ""
                apps.add(App(pkg, label, banner, icon))
            }
        }
        fun rank(a: App): Int {
            val l = a.label.lowercase()
            val i = order.indexOfFirst { l.contains(it) }
            return if (i < 0) 100 else i
        }
        apps.sortWith(compareBy<App>({ rank(it) }, { it.label.lowercase() }))
        val out = JSONArray()
        for (a in apps) {
            out.put(JSONObject().put("pkg", a.pkg).put("label", a.label).put("banner", a.banner).put("icon", a.icon))
        }
        return out
    }

    private fun dataUrl(d: Drawable, w: Int, h: Int): String {
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        d.setBounds(0, 0, w, h)
        d.draw(c)
        val bos = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.PNG, 100, bos)
        return "data:image/png;base64," + Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP)
    }

    fun launch(ctx: Context, pkg: String): Boolean {
        val pm = ctx.packageManager
        val i = pm.getLeanbackLaunchIntentForPackage(pkg) ?: pm.getLaunchIntentForPackage(pkg) ?: return false
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(i)
        return true
    }
}
