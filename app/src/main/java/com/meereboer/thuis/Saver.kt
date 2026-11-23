package com.meereboer.thuis

import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.service.dreams.DreamService
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import okhttp3.Request
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/**
 * De schermbeveiliging van Thuis. Android start hem zelf als de tv een tijd niets doet,
 * ook in andere apps of bij een gepauzeerde film. Beelden komen van tv-serverr.
 */
class Saver : DreamService() {
    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        isInteractive = false
        isFullscreen = true
        setContentView(SaverView(this))
    }
}

/** Instellingen van de schermbeveiliging, op dit apparaat bewaard. */
object SaverPrefs {
    /** Bronnen: film, album1, album2, album3, kunst, of klok (alleen klok en weer). */
    val SOURCES = listOf("film", "album1", "album2", "album3", "kunst", "klok")
    private fun sp(c: Context) = c.getSharedPreferences("saver", Context.MODE_PRIVATE)
    fun sources(c: Context) = (sp(c).getString("src", "film") ?: "film").split(",").filter { it in SOURCES }.ifEmpty { listOf("film") }
    fun speed(c: Context) = sp(c).getInt("speed", 45).coerceIn(10, 3600)
    /** Vaste foto (pad zonder ondertekening), of leeg = wisselen. */
    fun fixed(c: Context) = sp(c).getString("fixed", "") ?: ""

    /** Na hoeveel minuten (0 = nooit). Android bewaart dit zelf; Thuis mag het alleen aanpassen als dat is toegestaan. */
    fun delay(c: Context): Int {
        val ms = Settings.System.getLong(c.contentResolver, Settings.System.SCREEN_OFF_TIMEOUT, 600_000L)
        return if (ms >= Int.MAX_VALUE / 2) 0 else (ms / 60_000L).toInt()
    }
    fun active(c: Context): Boolean {
        val mine = ComponentName(c, Saver::class.java).flattenToShortString()
        val full = ComponentName(c, Saver::class.java).flattenToString()
        val set = Settings.Secure.getString(c.contentResolver, "screensaver_components") ?: ""
        return set.split(",").any { it == mine || it == full }
    }

    fun toJson(c: Context): String = JSONObject().put("src", sources(c).joinToString(",")).put("speed", speed(c)).put("fixed", fixed(c))
        .put("delay", delay(c)).put("canDelay", Settings.System.canWrite(c)).put("active", active(c)).toString()

    /** Vanuit de instellingen in Thuis. Onbekende waarden worden genegeerd. */
    fun set(c: Context, json: String) {
        val o = JSONObject(json); val e = sp(c).edit()
        if (o.has("src")) e.putString("src", o.getString("src").split(",").filter { it in SOURCES }.ifEmpty { listOf("film") }.joinToString(","))
        if (o.has("speed")) e.putInt("speed", o.getInt("speed").coerceIn(10, 3600))
        if (o.has("fixed")) e.putString("fixed", o.getString("fixed").substringBefore("?").take(200))
        e.apply()
        if (o.has("delay") && Settings.System.canWrite(c)) {
            val min = o.getInt("delay").coerceIn(0, 240)
            Settings.System.putInt(c.contentResolver, Settings.System.SCREEN_OFF_TIMEOUT, if (min == 0) Int.MAX_VALUE else min * 60_000)
        }
    }
}

/** Wisselende beelden met een langzame zoom, en de klok met datum en weer. */
class SaverView(ctx: Context) : FrameLayout(ctx) {
    private val ui = Handler(Looper.getMainLooper())
    private val bg = Executors.newSingleThreadExecutor()
    private val layers = List(2) { ImageView(ctx).apply { scaleType = ImageView.ScaleType.CENTER_CROP; alpha = 0f } }
    private var on = 0
    private val clock = TextView(ctx)
    private val date = TextView(ctx)
    private val weather = TextView(ctx)
    private val credit = TextView(ctx)
    private val clockOnly = SaverPrefs.sources(ctx) == listOf("klok")
    private var images: List<Pair<String, String>> = emptyList()
    private var n = 0
    private val tf = SimpleDateFormat("HH:mm", Locale("nl", "NL"))
    private val df = SimpleDateFormat("EEEE d MMMM", Locale("nl", "NL"))

    private fun dp(v: Int) = Icons.dp(context, v)

    init {
        setBackgroundColor(0xFF0E0E10.toInt())
        layers.forEach { addView(it, LayoutParams(-1, -1)) }
        // Zachte schaduw onderin, zodat de tekst altijd leesbaar is.
        addView(View(ctx).apply { background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0, 0, 0x8C000000.toInt())) }, LayoutParams(-1, -1))
        val box = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL; gravity = if (clockOnly) Gravity.CENTER_HORIZONTAL else Gravity.START }
        Fonts.style(clock, if (clockOnly) 96f else 56f, 400, Color.WHITE)
        Fonts.style(date, if (clockOnly) 22f else 17f, 500, 0xE6FFFFFF.toInt())
        Fonts.style(weather, if (clockOnly) 20f else 15f, 400, 0xCCFFFFFF.toInt())
        Fonts.style(credit, 11f, 400, 0x99FFFFFF.toInt())
        listOf(clock, date, weather).forEach { it.setShadowLayer(dp(6).toFloat(), 0f, dp(1).toFloat(), 0x99000000.toInt()) }
        box.addView(clock); box.addView(date, LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(2) })
        box.addView(weather, LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(6) })
        addView(box, if (clockOnly) LayoutParams(-2, -2, Gravity.CENTER) else LayoutParams(-2, -2, Gravity.START or Gravity.BOTTOM).apply { setMargins(dp(56), 0, 0, dp(44)) })
        credit.maxWidth = dp(420); credit.gravity = Gravity.END
        addView(credit, LayoutParams(-2, -2, Gravity.END or Gravity.BOTTOM).apply { setMargins(0, 0, dp(56), dp(48)) })
    }

    private val tick = object : Runnable {
        override fun run() { val now = Date(); clock.text = tf.format(now); date.text = df.format(now).replaceFirstChar { it.uppercase() }; ui.postDelayed(this, 10_000) }
    }
    private val next = object : Runnable {
        override fun run() { showNext(); if (images.size > 1) ui.postDelayed(this, SaverPrefs.speed(context) * 1000L) }
    }
    private val reload = object : Runnable { override fun run() { load(); ui.postDelayed(this, 30 * 60_000L) } }

    override fun onAttachedToWindow() { super.onAttachedToWindow(); ui.post(tick); ui.post(reload) }
    override fun onDetachedFromWindow() { ui.removeCallbacksAndMessages(null); bg.shutdownNow(); super.onDetachedFromWindow() }

    /** Lijst en weer ophalen. Zonder server: alleen de klok. */
    private fun load() {
        if (!Server.paired(context)) return
        val src = SaverPrefs.sources(context).filter { it != "klok" }.joinToString(",")
        bg.execute {
            val o = try { JSONObject(Server.call(context, "GET", "/api/saver?src=" + src.ifEmpty { "none" })) } catch (_: Exception) { null } ?: return@execute
            val a = o.optJSONArray("images")
            var l = (0 until (a?.length() ?: 0)).map { a!!.getJSONObject(it).let { j -> j.optString("url") to j.optString("by") } }
            val fixed = SaverPrefs.fixed(context)
            if (fixed.isNotEmpty()) l.filter { it.first.substringBefore("?") == fixed }.takeIf { it.isNotEmpty() }?.let { l = it }
            val w = o.optJSONObject("weather")
            ui.post {
                weather.text = w?.let { "${it.optString("place")}  ·  ${it.optInt("temp")}°  ${it.optString("text")}  ·  ${it.optInt("min")}° / ${it.optInt("max")}°" } ?: ""
                if (clockOnly) return@post
                val first = images.isEmpty()
                images = l
                if (first && l.isNotEmpty()) { ui.removeCallbacks(next); ui.post(next) }
            }
        }
    }

    private fun showNext() {
        if (images.isEmpty()) return
        val (url, by) = images[n++ % images.size]
        bg.execute {
            val bmp = fetch(url) ?: return@execute
            ui.post {
                val nxt = layers[1 - on]; val old = layers[on]; on = 1 - on
                nxt.setImageBitmap(bmp)
                nxt.animate().alpha(1f).setDuration(1500).start()
                old.animate().alpha(0f).setDuration(1500).start()
                // Heel langzaam inzoomen, zoals bij een fotolijst.
                android.animation.ObjectAnimator.ofPropertyValuesHolder(nxt,
                    android.animation.PropertyValuesHolder.ofFloat(View.SCALE_X, 1f, 1.06f),
                    android.animation.PropertyValuesHolder.ofFloat(View.SCALE_Y, 1f, 1.06f))
                    .setDuration(SaverPrefs.speed(context) * 1000L + 1500).start()
                credit.text = by
            }
        }
    }

    /** Plaatje ophalen en verkleinen tot schermformaat. Paden op tv-serverr gaan met de sleutel van dit apparaat. */
    private fun fetch(url: String): Bitmap? = try {
        val b = Request.Builder().url(Server.abs(context, url))
        if (url.startsWith("/")) b.header("X-Thuis-Key", Server.key(context))
        Server.http.newCall(b.build()).execute().use { r ->
            if (!r.isSuccessful) null else {
                val bytes = r.body!!.bytes()
                val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, o)
                var s = 1; while (o.outWidth / (s * 2) >= resources.displayMetrics.widthPixels) s *= 2
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = s })
            }
        }
    } catch (_: Exception) { null }
}
