package com.meereboer.thuis

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.FrameLayout
import android.widget.ListView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import org.json.JSONObject
import androidx.media3.common.MimeTypes
import androidx.media3.common.Tracks
import java.util.concurrent.Executors

/**
 * Speler voor films en afleveringen (Plex en IPTV).
 * Onderin een rustige balk: titel, voortgang en ronde knoppen.
 * Op de balk: links/rechts = 10 s terug / 30 s vooruit, OK = pauze. Omlaag = de knoppen (ondertitels, geluid, meer).
 * Terug = eerst de balk weg, daarna stoppen (positie wordt onthouden).
 */
@OptIn(UnstableApi::class)
class VodActivity : Activity() {
    private var player: ExoPlayer? = null
    private lateinit var item: JSONObject
    private lateinit var osd: LinearLayout
    private lateinit var tvTitle: TextView
    private lateinit var tvSub: TextView
    private lateinit var tvTime: TextView
    private lateinit var tvLeft: TextView
    private lateinit var bar: Scrub
    private lateinit var btns: List<Icons.Button>
    private lateinit var btnPlay: Icons.Button
    private var zone = -1   // -1 = voortgangsbalk, 0.. = knop
    private lateinit var center: TextView
    private val ui = Handler(Looper.getMainLooper())
    private var resumed = false
    private var subsTried = false
    private lateinit var pv: PlayerView
    private lateinit var menu: LinearLayout
    private lateinit var menuTitle: TextView
    private lateinit var menuList: ListView
    private var menuActions: List<() -> Unit> = emptyList()
    private val extraSubs = ArrayList<MediaItem.SubtitleConfiguration>()
    private var pendingLabel: String? = null
    // Losse ondertitelbestanden (label -> origineel) en de timing per film
    private val subFiles = HashMap<String, java.io.File>()
    private fun offsetKey() = "subofs:" + item.optString("key")
    private fun subOffset() = getSharedPreferences("vod", MODE_PRIVATE).getLong(offsetKey(), 0L)

    /** Kopie van het .srt-bestand met alle tijden verschoven. */
    private fun shifted(f: java.io.File, ms: Long): java.io.File {
        if (ms == 0L) return f
        val re = Regex("(\\d{2}):(\\d{2}):(\\d{2})[,.](\\d{3})")
        val txt = re.replace(f.readText()) { m ->
            val (h, mi, s, x) = m.destructured
            val t = ((((h.toLong() * 60) + mi.toLong()) * 60 + s.toLong()) * 1000 + x.toLong() + ms).coerceAtLeast(0)
            "%02d:%02d:%02d,%03d".format(t / 3600000, t / 60000 % 60, t / 1000 % 60, t % 1000)
        }
        return java.io.File(cacheDir, "shift-" + f.name).apply { writeText(txt) }
    }

    /** Eerder of later zetten: herlaadt het bestand op dezelfde plek. */
    private fun nudge(label: String, delta: Long) = setOffset(label, subOffset() + delta)

    // ---------- gelijkzetten op één zin ----------
    private var syncLabel: String? = null
    private var syncStart = 0L

    private fun cues(f: java.io.File): List<Pair<Long, String>> {
        val re = Regex("(\\d{2}):(\\d{2}):(\\d{2})[,.](\\d{3})\\s*-->")
        return f.readText().replace("\r", "").split(Regex("\n\\s*\n")).mapNotNull { b ->
            val m = re.find(b) ?: return@mapNotNull null
            val (h, mi, sec, x) = m.destructured
            val t = (((h.toLong() * 60) + mi.toLong()) * 60 + sec.toLong()) * 1000 + x.toLong()
            val text = b.substring(b.indexOf('\n', m.range.last).coerceAtLeast(0)).trim().replace(Regex("<[^>]+>"), "")
            if (text.isEmpty()) null else t to text
        }
    }

    /** Toont de eerstvolgende zin; jij drukt OK zodra je hem hoort. */
    private fun startSync(label: String) {
        val orig = subFiles[label] ?: return
        val p = player ?: return
        val ofs = subOffset()
        val next = cues(orig).firstOrNull { it.first + ofs > p.currentPosition + 2500 } ?: run { flash("Geen volgende zin gevonden"); return }
        syncLabel = label; syncStart = next.first
        p.playWhenReady = true
        center.text = "Druk op OK zodra je dit hoort:\n\n\u201c" + next.second.take(120) + "\u201d\n\n(Terug = stoppen)"
        center.visibility = View.VISIBLE
    }

    private fun setOffset(label: String, ofs: Long) {
        val orig = subFiles[label] ?: return
        val p = player ?: return
        getSharedPreferences("vod", MODE_PRIVATE).edit().putLong(offsetKey(), ofs).apply()
        val f = shifted(orig, ofs)
        val i = extraSubs.indexOfFirst { it.label == label }
        if (i < 0) return
        extraSubs[i] = MediaItem.SubtitleConfiguration.Builder(android.net.Uri.fromFile(f))
            .setMimeType(MimeTypes.APPLICATION_SUBRIP).setLanguage(extraSubs[i].language).setLabel(label).build()
        pendingLabel = label
        val pos = p.currentPosition
        p.setMediaItem(mediaItem(extraSubs), pos)
        p.prepare()
        flash("Ondertitels staan gelijk" + (if (ofs == 0L) "" else (if (ofs < 0) " (%.1f s naar voren)" else " (%.1f s naar achteren)").format(Math.abs(ofs) / 1000.0)))
    }

    /** Losse ondertitel toevoegen (OpenSubtitles) en meteen kiezen. */
    private fun addExternal(f: java.io.File, lang: String, label: String) {
        val p = player ?: return
        subFiles[label] = f
        if (extraSubs.none { it.label == label }) extraSubs.add(MediaItem.SubtitleConfiguration.Builder(android.net.Uri.fromFile(shifted(f, subOffset())))
            .setMimeType(MimeTypes.APPLICATION_SUBRIP).setLanguage(lang).setLabel(label).build())
        pendingLabel = label
        val pos = p.currentPosition
        p.setMediaItem(mediaItem(extraSubs), pos)
        p.prepare()
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false).build()
    }

    private fun trackName(g: Tracks.Group, i: Int): String {
        val f = g.getTrackFormat(0)
        val lang = f.language?.let { java.util.Locale(it).getDisplayLanguage(java.util.Locale("nl")).replaceFirstChar { c -> c.uppercase() } }
        return listOfNotNull(f.label, lang).distinct().joinToString(" · ").ifEmpty { "Spoor ${i + 1}" }
    }

    private fun openMenu(titleText: String, labels: List<String>, actions: List<() -> Unit>, selected: Int) {
        menuTitle.text = titleText
        menuActions = actions
        menuList.adapter = object : ArrayAdapter<String>(this, android.R.layout.simple_list_item_1, labels) {
            override fun getView(position: Int, convertView: View?, parent: android.view.ViewGroup): View =
                (super.getView(position, convertView, parent) as TextView).apply { setTextColor(Color.WHITE); textSize = 14f; setPadding(dp(14), dp(7), dp(14), dp(7)); background = null; isSingleLine = true; ellipsize = android.text.TextUtils.TruncateAt.END }
        }
        menu.visibility = View.VISIBLE
        menuList.requestFocus()
        menuList.setSelection(selected.coerceAtLeast(0))
    }
    private fun closeMenu() { menu.visibility = View.GONE; pv.requestFocus() }

    /** Gele knop: alle ondertitels uit het bestand, uit, en versies van OpenSubtitles. */
    /** Grootte, achtergrond en hoogte; elke OK wisselt en je ziet het meteen. */
    private fun styleMenu(sel: Int = 0) {
        val labels = listOf(
            "Grootte: " + SubStyle.sizes[SubStyle.size(this)].first,
            "Achtergrond: " + SubStyle.backs[SubStyle.back(this)],
            "Hoogte: " + SubStyle.places[SubStyle.place(this)].first,
            "Klaar")
        val acts = listOf<() -> Unit>(
            { SubStyle.cycle(this, "size", SubStyle.sizes.size); SubStyle.apply(this, pv.subtitleView, osd.visibility == View.VISIBLE); styleMenu(0) },
            { SubStyle.cycle(this, "back", SubStyle.backs.size); SubStyle.apply(this, pv.subtitleView, osd.visibility == View.VISIBLE); styleMenu(1) },
            { SubStyle.cycle(this, "place", SubStyle.places.size); SubStyle.apply(this, pv.subtitleView, osd.visibility == View.VISIBLE); styleMenu(2) },
            { })
        openMenu("Weergave ondertitels", labels, acts, sel)
    }

    private fun subtitleMenu() {
        val p = player ?: return
        val groups = p.currentTracks.groups.filter { it.type == C.TRACK_TYPE_TEXT && it.isSupported }
        val off = p.trackSelectionParameters.disabledTrackTypes.contains(C.TRACK_TYPE_TEXT) || groups.none { it.isSelected }
        val labels = ArrayList<String>(); val acts = ArrayList<() -> Unit>()
        labels.add("    \u2699 Weergave: " + SubStyle.summary(this))
        acts.add { styleMenu() }
        labels.add((if (off) "✓ " else "    ") + "Uit")
        acts.add { p.trackSelectionParameters = p.trackSelectionParameters.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build(); flash("Ondertitels uit") }
        groups.forEachIndexed { i, g ->
            labels.add((if (g.isSelected && !off) "✓ " else "    ") + trackName(g, i))
            acts.add {
                p.trackSelectionParameters = p.trackSelectionParameters.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
                    .setOverrideForType(TrackSelectionOverride(g.mediaTrackGroup, 0)).build()
                flash("Ondertitels: " + trackName(g, i))
            }
        }
        // Timing alleen voor losse bestanden (OpenSubtitles)
        val cur = groups.firstOrNull { it.isSelected }?.getTrackFormat(0)?.label
        if (!off && cur != null && subFiles.containsKey(cur)) {
            val o = subOffset()
            labels.add("    \u25ce Gelijkzetten op een zin (makkelijkst)"); acts.add { startSync(cur) }
            labels.add("    Tekst komt te vroeg (al in beeld v\u00f3\u00f3r het praten)"); acts.add { nudge(cur, 500) }
            labels.add("    Tekst komt te laat (pas in beeld n\u00e1 het praten)"); acts.add { nudge(cur, -500) }
            if (o != 0L) { labels.add("    Timing terugzetten zoals hij was"); acts.add { setOffset(cur, 0L) } }
        }
        val sel = if (off) 0 else groups.indexOfFirst { it.isSelected } + 1
        labels.add("    OpenSubtitles: zoeken…"); acts.add { }
        openMenu("Ondertitels", labels, acts, sel)
        bg.execute {
            val res = try { subsSearch() } catch (e: Exception) { emptyList() }
            ui.post {
                if (menu.visibility != View.VISIBLE) return@post
                labels.removeAt(labels.size - 1); acts.removeAt(acts.size - 1)
                if (res.isEmpty()) { labels.add("    OpenSubtitles: niets gevonden"); acts.add { } }
                res.forEach { r ->
                    val lang = if (r.optString("lang") == "nl") "NL" else r.optString("lang").uppercase()
                    val label = "OpenSubtitles · $lang · " + r.optString("release").take(40) + (if (r.optBoolean("hearing")) " · SDH" else "")
                    labels.add("    $label  (${r.optInt("downloads")}×)")
                    acts.add {
                        flash("Ondertitel ophalen…")
                        bg.execute {
                            val f = try { subsDownload(r.optLong("fileId")) } catch (e: Exception) { null }
                            ui.post { if (f == null) flash("Ophalen lukt niet") else addExternal(f, r.optString("lang"), label) }
                        }
                    }
                }
                openMenu("Ondertitels", labels, acts, sel)
            }
        }
    }

    private fun moreMenu() {
        openMenu("Meer", listOf("5 minuten vooruit", "5 minuten terug", "Weergave ondertitels", "Vanaf het begin"),
            listOf({ player?.let { it.seekTo(it.currentPosition + 300_000) }; showOsd() },
                { player?.let { it.seekTo((it.currentPosition - 300_000).coerceAtLeast(0)) }; showOsd() },
                { styleMenu() }, { player?.seekTo(0); showOsd() }), 0)
    }

    /** Groene knop: geluidssporen. */
    private fun audioMenu() {
        val p = player ?: return
        val groups = p.currentTracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO && it.isSupported }
        if (groups.size < 2) { flash("Maar één geluidsspoor"); return }
        openMenu("Geluid", groups.mapIndexed { i, g -> (if (g.isSelected) "✓ " else "    ") + trackName(g, i) },
            groups.mapIndexed { i, g -> { p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
                .setOverrideForType(TrackSelectionOverride(g.mediaTrackGroup, 0)).build(); flash("Geluid: " + trackName(g, i)) } },
            groups.indexOfFirst { it.isSelected })
    }
    private val bg = Executors.newSingleThreadExecutor()

    /** Geen Nederlandse ondertitels in het bestand en geen Nederlands geluid? Dan via OpenSubtitles. */
    private fun maybeFetchSubs(tracks: Tracks, manual: Boolean = false) {
        if (subsTried && !manual) return

        val nl = setOf("nl", "nld", "dut")
        val hasNlText = tracks.groups.any { g -> g.type == C.TRACK_TYPE_TEXT && (0 until g.length).any { g.getTrackFormat(it).language?.lowercase() in nl } }
        val nlAudio = tracks.groups.any { g -> g.type == C.TRACK_TYPE_AUDIO && g.isSelected && (0 until g.length).any { g.getTrackFormat(it).language?.lowercase() in nl } }
        if (!manual && (hasNlText || nlAudio)) return
        subsTried = true
        if (manual) flash("Ondertitels zoeken…")
        bg.execute {
            val f = try { subsSearch().firstOrNull { it.optString("lang") == "nl" }?.let { subsDownload(it.optLong("fileId")) } } catch (e: Exception) { ui.post { if (manual) flash("Ondertitels zoeken lukt niet: ${e.message?.take(60)}") }; null }
            ui.post {
                val p = player ?: return@post
                if (f == null) { if (manual) flash("Geen Nederlandse ondertitels gevonden"); return@post }
                addExternal(f, "nl", "Nederlands · OpenSubtitles")
                flash("Nederlandse ondertitels geladen (omlaag = andere kiezen)")
            }
        }
    }

    /** Ondertitels zoeken via tv-serverr (de OpenSubtitles-sleutel staat op de server). */
    private fun subsSearch(): List<JSONObject> {
        fun e(v: String) = java.net.URLEncoder.encode(v, "UTF-8")
        val q = "/api/subs/search?kind=${e(item.optString("kind"))}&title=${e(item.optString("title"))}&tmdbId=${item.optInt("tmdb")}" +
            "&season=${item.optInt("season")}&episode=${item.optInt("episode")}"
        val a = org.json.JSONArray(Server.call(this, "GET", q))
        return (0 until a.length()).map { a.getJSONObject(it) }
    }
    private fun subsDownload(fileId: Long): java.io.File =
        java.io.File(cacheDir, "os-$fileId.srt").apply { if (!exists()) writeText(Server.call(this@VodActivity, "GET", "/api/subs/file/$fileId")) }

    private val hideOsd = Runnable { hideBar() }
    private fun hideBar() {
        zone = -1
        osd.animate().alpha(0f).setDuration(250).withEndAction { osd.visibility = View.GONE }.start()
        SubStyle.apply(this, pv.subtitleView, false)
    }
    private val tick = object : Runnable {
        override fun run() {
            updateOsd()
            if (syncLabel != null) center.visibility = View.VISIBLE
            val now = System.currentTimeMillis()
            if (now - lastReport > 10_000) { lastReport = now; report(if (player?.isPlaying == true) "playing" else "paused") }
            ui.postDelayed(this, 1000)
        }
    }

    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        item = JSONObject(intent.getStringExtra("item") ?: "{}")
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY)
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        pv = PlayerView(this).apply {
            useController = false; keepScreenOn = true
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            setShutterBackgroundColor(Color.BLACK)
        }
        root.addView(pv, FrameLayout.LayoutParams(-1, -1))

        // Onderbalk: titel links, daaronder de voortgang met tijden, en een rij ronde knoppen.
        osd = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(48), dp(120), dp(48), dp(18))
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0x00000000, 0x99000000.toInt(), 0xE0000000.toInt()))
        }
        tvTitle = TextView(this).apply { setTextColor(Color.WHITE); textSize = 17f; typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL); maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END }
        tvSub = TextView(this).apply { setTextColor(0xB3FFFFFF.toInt()); textSize = 12f; maxLines = 1 }
        bar = Scrub(this)
        tvTime = TextView(this).apply { setTextColor(0xCCFFFFFF.toInt()); textSize = 11f }
        tvLeft = TextView(this).apply { setTextColor(0xCCFFFFFF.toInt()); textSize = 11f; gravity = Gravity.END }
        osd.addView(tvTitle); osd.addView(tvSub)
        osd.addView(bar, LinearLayout.LayoutParams(-1, dp(20)).apply { topMargin = dp(8) })
        val times = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        times.addView(tvTime, LinearLayout.LayoutParams(0, -2, 1f)); times.addView(tvLeft, LinearLayout.LayoutParams(0, -2, 1f))
        osd.addView(times)
        val back = Icons.Button(this, Icons.BACK, 40, "10"); btnPlay = Icons.Button(this, Icons.PAUSE, 50); val fwd = Icons.Button(this, Icons.FWD, 40, "30")
        val subs = Icons.Button(this, Icons.SUBS, 36); val audio = Icons.Button(this, Icons.AUDIO, 36); val more = Icons.Button(this, Icons.MORE, 36)
        btns = listOf(back, btnPlay, fwd, subs, audio, more)
        val row = FrameLayout(this)
        val mid = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        listOf(back, btnPlay, fwd).forEach { mid.addView(it, LinearLayout.LayoutParams(it.layoutParams.width, it.layoutParams.height).apply { marginStart = dp(14); marginEnd = dp(14) }) }
        val right = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        listOf(subs, audio, more).forEach { right.addView(it, LinearLayout.LayoutParams(it.layoutParams.width, it.layoutParams.height).apply { marginStart = dp(10) }) }
        row.addView(mid, FrameLayout.LayoutParams(-2, -2, Gravity.CENTER))
        row.addView(right, FrameLayout.LayoutParams(-2, -2, Gravity.END or Gravity.CENTER_VERTICAL))
        osd.addView(row, LinearLayout.LayoutParams(-1, dp(64)).apply { topMargin = dp(4) })
        root.addView(osd, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))

        center = TextView(this).apply {
            setTextColor(Color.WHITE); textSize = 15f; typeface = Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER
            setPadding(dp(20), dp(12), dp(20), dp(12))
            background = GradientDrawable().apply { setColor(0xB3000000.toInt()); cornerRadius = dp(14).toFloat() }
            visibility = View.GONE
        }
        root.addView(center, FrameLayout.LayoutParams(-2, -2, Gravity.CENTER))
        // Keuzemenu (ondertitels, geluid, meer): een zwevende kaart rechts onderin, boven de knoppen.
        menu = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable().apply { setColor(0xF21C1C1F.toInt()); cornerRadius = dp(20).toFloat() }
            setPadding(dp(10), dp(14), dp(10), dp(10))
            elevation = dp(12).toFloat()
            visibility = View.GONE
        }
        menuTitle = TextView(this).apply { setTextColor(0x99FFFFFF.toInt()); textSize = 11f; typeface = Typeface.DEFAULT_BOLD; isAllCaps = true; letterSpacing = 0.08f; setPadding(dp(18), 0, 0, dp(8)) }
        menu.addView(menuTitle)
        menuList = ListView(this).apply {
            divider = null; isVerticalScrollBarEnabled = false
            selector = GradientDrawable().apply { setColor(0x33FFFFFF); cornerRadius = dp(12).toFloat() }
            onItemClickListener = AdapterView.OnItemClickListener { _, _, pos, _ -> val a = menuActions.getOrNull(pos); closeMenu(); a?.invoke() }
        }
        menu.addView(menuList, LinearLayout.LayoutParams(-1, -2))
        root.addView(menu, FrameLayout.LayoutParams(dp(360), -2, Gravity.END or Gravity.BOTTOM).apply { setMargins(0, dp(40), dp(40), dp(96)) })
        setContentView(root)

        tvTitle.text = item.optString("title").replace(Regex("^\\[[A-Z]{2}\\]\\s*|^[A-Z]{2}\\s*[|:-]\\s*"), "")
        tvSub.text = item.optString("sub")

        val http = DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(true).setUserAgent("Thuis/1.0")
            .setConnectTimeoutMs(10000).setReadTimeoutMs(20000)
        val renderers = DefaultRenderersFactory(this)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER)
            .setEnableDecoderFallback(true)
            .setMediaCodecSelector(Decoders.selector)
        // Ook proberen als de chip zegt dat een spoor zwaar is (4K-remux, hoog niveau)
        val selector = androidx.media3.exoplayer.trackselection.DefaultTrackSelector(this).apply {
            setParameters(buildUponParameters().setExceedVideoConstraintsIfNecessary(true).setExceedRendererCapabilitiesIfNecessary(true))
        }
        val p = ExoPlayer.Builder(this, renderers)
            .setTrackSelector(selector)
            .setMediaSourceFactory(DefaultMediaSourceFactory(DefaultDataSource.Factory(this, http)))
            .setSeekBackIncrementMs(10_000).setSeekForwardIncrementMs(30_000)
            .build()
        // Nederlands geluid eerst; Nederlandse ondertitels aan als ze er zijn (ook bij anderstalig geluid).
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
            .setPreferredAudioLanguages("nl", "nld", "dut", "en")
            .setPreferredAudioRoleFlags(C.ROLE_FLAG_MAIN)
            .setPreferredTextLanguages("nl", "nld", "dut")
            .setSelectUndeterminedTextLanguage(false)
            .build()
        p.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                when (state) {
                    Player.STATE_BUFFERING -> show("Laden…", 0)
                    Player.STATE_READY -> {
                        center.visibility = View.GONE
                        if (!resumed) {
                            resumed = true
                            val pos = item.optLong("offsetMs")
                            if (pos > 60_000 && (p.duration <= 0 || pos < p.duration * 0.95)) {
                                p.seekTo(pos); flash("Verder vanaf ${fmt(pos)}")
                            }
                        }
                    }
                    Player.STATE_ENDED -> { save(); finish() }
                    else -> {}
                }
            }
            override fun onTracksChanged(tracks: Tracks) {
                pendingLabel?.let { want ->
                    tracks.groups.firstOrNull { g -> g.type == C.TRACK_TYPE_TEXT && g.getTrackFormat(0).label == want }?.let { g ->
                        pendingLabel = null
                        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
                            .setOverrideForType(TrackSelectionOverride(g.mediaTrackGroup, 0)).build()
                        flash("Ondertitels: " + want)
                    }
                }
                if (tracks.groups.any { it.type == C.TRACK_TYPE_AUDIO }) maybeFetchSubs(tracks)
            }
            override fun onPlayerError(error: PlaybackException) { show("Dit speelt niet af\n${error.errorCodeName}", 0) }
        })
        pv.player = p
        SubStyle.apply(this, pv.subtitleView, false)
        player = p
        p.setMediaItem(mediaItem(emptyList()))
        p.prepare()
        p.playWhenReady = true
        showOsd()
        ui.post(tick)
    }

    /** Losse ondertitels uit Plex (bijv. een .nl.srt naast de film) meteen meegeven. */
    private fun mediaItem(extra: List<MediaItem.SubtitleConfiguration>): MediaItem {
        val subs = ArrayList<MediaItem.SubtitleConfiguration>()
        item.optJSONArray("subs")?.let { a ->
            for (i in 0 until a.length()) a.getJSONObject(i).let { s ->
                val mime = when (s.optString("codec").lowercase()) {
                    "srt", "subrip" -> MimeTypes.APPLICATION_SUBRIP
                    "ass", "ssa" -> MimeTypes.TEXT_SSA
                    "vtt", "webvtt" -> MimeTypes.TEXT_VTT
                    else -> null
                } ?: return@let
                val nl = s.optString("lang").lowercase() in setOf("nl", "nld", "dut")
                subs.add(MediaItem.SubtitleConfiguration.Builder(android.net.Uri.parse(Server.abs(this, s.optString("url"))))
                    .setMimeType(mime).setLanguage(s.optString("lang")).setLabel(s.optString("label"))
                    .setSelectionFlags(if (nl) C.SELECTION_FLAG_DEFAULT else 0).build())
            }
        }
        subs.addAll(extra)
        return MediaItem.Builder().setUri(Server.abs(this, item.optString("url"))).setSubtitleConfigurations(subs).build()
    }

    // Kijkstand bijhouden (elke 10 seconden en bij stoppen).
    private var lastReport = 0L
    private fun report(state: String) {
        val p = player ?: return
        val pos = p.currentPosition; val dur = p.duration
        if (dur <= 0) return
        // Kijkstand per profiel naar tv-serverr; de server meldt het zelf aan Plex.
        val body = JSONObject().put("profile", item.optInt("profile", 1)).put("key", item.optString("key"))
            .put("seriesKey", item.optString("seriesKey")).put("kind", item.optString("kind")).put("plexKey", item.optString("plexKey"))
            .put("pos", pos).put("dur", dur).put("state", state).put("meta", item.optJSONObject("meta") ?: JSONObject()).toString()
        // Eigen thread: bij het stoppen wordt de achtergrondpool meteen afgesloten.
        Thread { try { Server.call(this, "POST", "/api/progress", body) } catch (_: Exception) {} }.start()
    }

    private fun fmt(ms: Long): String {
        val s = ms / 1000
        return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
    }

    private fun updateOsd() {
        val p = player ?: return
        btnPlay.setIcon(if (p.playWhenReady) Icons.PAUSE else Icons.PLAY)
        val d = p.duration.takeIf { it > 0 } ?: return
        bar.progress = p.currentPosition.toFloat() / d; bar.buffered = p.bufferedPosition.toFloat() / d
        tvTime.text = fmt(p.currentPosition)
        tvLeft.text = "-" + fmt(d - p.currentPosition)
    }

    /** Welke knop of de balk is gekozen. */
    private fun light() {
        bar.lit = zone < 0
        btns.forEachIndexed { i, b -> b.lit(i == zone) }
    }

    private fun showOsd() {
        if (osd.visibility != View.VISIBLE) { osd.alpha = 0f; osd.visibility = View.VISIBLE; osd.animate().alpha(1f).setDuration(200).start() }
        updateOsd(); light()
        SubStyle.apply(this, pv.subtitleView, true)   // ondertitels boven de balk
        ui.removeCallbacks(hideOsd)
        if (player?.playWhenReady != false) ui.postDelayed(hideOsd, 5000)
    }

    private fun press(i: Int) {
        val p = player ?: return
        when (i) {
            0 -> p.seekBack()
            1 -> p.playWhenReady = !p.playWhenReady
            2 -> p.seekForward()
            3 -> subtitleMenu()
            4 -> audioMenu()
            5 -> moreMenu()
        }
        if (i <= 2) ui.postDelayed({ showOsd() }, 80)
    }

    private fun show(msg: String, ms: Long) {
        center.text = msg; center.visibility = View.VISIBLE
        if (ms > 0) ui.postDelayed({ center.visibility = View.GONE }, ms)
    }
    private fun flash(msg: String) = show(msg, 3000)

    private fun cycle(type: Int, name: String) {
        val p = player ?: return
        val groups = p.currentTracks.groups.filter { it.type == type && it.isSupported }
        if (groups.isEmpty()) {
            if (type == C.TRACK_TYPE_TEXT && !subsTried) { maybeFetchSubs(p.currentTracks, manual = true); return }
            flash("Geen $name beschikbaar"); return
        }
        val cur = groups.indexOfFirst { it.isSelected }
        val b = p.trackSelectionParameters.buildUpon()
        if (type == C.TRACK_TYPE_TEXT) {
            // Uit -> spoor 1 -> spoor 2 -> ... -> uit
            val next = cur + 1
            if (next >= groups.size) {
                p.trackSelectionParameters = b.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build()
                flash("Ondertitels uit"); return
            }
            p.trackSelectionParameters = b.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
                .setOverrideForType(TrackSelectionOverride(groups[next].mediaTrackGroup, 0)).build()
            val f = groups[next].getTrackFormat(0)
            flash("Ondertitels: " + (f.label ?: f.language ?: "spoor ${next + 1}"))
        } else {
            if (groups.size < 2) { flash("Maar één geluidsspoor"); return }
            val next = (cur + 1) % groups.size
            p.trackSelectionParameters = b.setOverrideForType(TrackSelectionOverride(groups[next].mediaTrackGroup, 0)).build()
            val f = groups[next].getTrackFormat(0)
            flash("Geluid: " + listOfNotNull(f.language, f.label).joinToString(" · ").ifEmpty { "spoor ${next + 1}" })
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        val p = player ?: return super.onKeyDown(keyCode, event)
        syncLabel?.let { label ->
            when (keyCode) {
                KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> {
                    syncLabel = null; center.visibility = View.GONE
                    // 0,2 s eraf: je drukt altijd net na het horen
                    setOffset(label, p.currentPosition - syncStart - 200)
                }
                KeyEvent.KEYCODE_BACK -> { syncLabel = null; center.visibility = View.GONE; flash("Gelijkzetten gestopt") }
            }
            return true
        }
        if (menu.visibility == View.VISIBLE) {
            if (keyCode == KeyEvent.KEYCODE_BACK || keyCode == KeyEvent.KEYCODE_DPAD_LEFT) { closeMenu(); return true }
            return super.onKeyDown(keyCode, event)
        }
        val shown = osd.visibility == View.VISIBLE
        when (keyCode) {
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE -> press(1)
            KeyEvent.KEYCODE_MEDIA_REWIND -> press(0)
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> press(2)
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER ->
                if (!shown || zone < 0) press(1) else press(zone)
            KeyEvent.KEYCODE_DPAD_LEFT -> if (!shown || zone < 0) { zone = -1; press(0) } else { zone = (zone - 1).coerceAtLeast(0); showOsd() }
            KeyEvent.KEYCODE_DPAD_RIGHT -> if (!shown || zone < 0) { zone = -1; press(2) } else { zone = (zone + 1).coerceAtMost(btns.size - 1); showOsd() }
            // Omlaag: naar de knoppen (start op pauze). Omhoog: terug naar de balk.
            KeyEvent.KEYCODE_DPAD_DOWN -> { if (shown && zone < 0) zone = 1 else if (!shown) zone = 1; showOsd() }
            KeyEvent.KEYCODE_DPAD_UP -> { zone = -1; showOsd() }
            KeyEvent.KEYCODE_MEDIA_AUDIO_TRACK, KeyEvent.KEYCODE_PROG_GREEN, KeyEvent.KEYCODE_A -> audioMenu()
            KeyEvent.KEYCODE_CAPTIONS, KeyEvent.KEYCODE_PROG_YELLOW, KeyEvent.KEYCODE_S, KeyEvent.KEYCODE_MENU -> subtitleMenu()
            KeyEvent.KEYCODE_INFO -> showOsd()
            KeyEvent.KEYCODE_BACK -> if (shown) { ui.removeCallbacks(hideOsd); hideBar() } else { save(); finish() }
            else -> return super.onKeyDown(keyCode, event)
        }
        return true
    }

    private fun save() {
        val p = player ?: return
        if (p.duration <= 0) return
        report("stopped")
    }

    override fun onStop() {
        super.onStop()
        save()
        ui.removeCallbacksAndMessages(null)
        player?.release(); player = null
        bg.shutdownNow()
    }
}
