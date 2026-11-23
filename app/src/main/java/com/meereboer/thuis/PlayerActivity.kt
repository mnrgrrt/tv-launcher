package com.meereboer.thuis

import android.app.Activity
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.ProgressBar
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/**
 * Live tv en terugkijken. Omhoog/omlaag = zappen, OK = balk met knoppen (pauze, vanaf begin, zenders, gids,
 * geluid, ondertitels, terug naar live). Bij terugkijken: links/rechts = spoelen (vasthouden = grotere stappen).
 * Cijfers = zendernummer, Terug = balk weg, terug naar live of terug naar het startscherm.
 */
@OptIn(UnstableApi::class)
class PlayerActivity : Activity() {
    private lateinit var prefs: Prefs
    private var player: ExoPlayer? = null
    private lateinit var playerView: PlayerView

    // Balk onderin: zender, programma, tijdlijn en (na OK) knoppen.
    private lateinit var bar: LinearLayout
    private lateinit var tvChan: TextView
    private lateinit var tvNow: TextView
    private lateinit var tvNext: TextView
    private lateinit var tvStart: TextView
    private lateinit var tvEnd: TextView
    private lateinit var progress: ProgressBar
    private lateinit var btnRow: LinearLayout
    private var buttons: List<Pair<String, () -> Unit>> = emptyList()
    private var btnSel = 0
    private var menuOpen = false

    private lateinit var listPanel: LinearLayout
    private lateinit var listView: ListView
    private lateinit var listTitle: TextView
    private lateinit var center: TextView
    private lateinit var root: FrameLayout
    private var catTitle = "Alle zenders"
    private lateinit var guide: GuideView
    private val epgCache = HashMap<Int, Pair<Long, List<Programme>>>()
    private val epgPool = Executors.newFixedThreadPool(6)
    /** Programma dat we nu terugkijken (null = live), en vanaf welk moment de stream loopt. */
    private var replay: Programme? = null
    private var replayFrom = 0L
    /** Spoelen: waar we heen willen (klok-tijd) en hoe vaak er al gedrukt is (voor grotere stappen). */
    private var seekTarget = 0L
    private var seekPresses = 0
    /** Live gepauzeerd: vanaf dit moment verder kijken (alleen bij zenders met terugkijken). */
    private var pausedAt = 0L
    /** Programma dat nu op de huidige zender loopt (uit de korte gids). */
    private var nowProg: Programme? = null
    /** Keuze "Live / Vanaf begin" uit de gids. */
    private lateinit var choice: LinearLayout
    private lateinit var choiceLive: TextView
    private lateinit var choiceStart: TextView
    private var choiceSel = 0
    private var choiceRow = -1
    private var choiceProg: Programme? = null

    private var channels: List<Channel> = emptyList()
    private var index = -1
    private var prevIndex = -1
    private var retried = false
    private var numBuf = ""

    private val ui = Handler(Looper.getMainLooper())
    // Tv uit: de speler stopt (kijkstand wordt bewaard). Bij weer aanzetten begint Thuis met "Wie kijkt er?".
    private val screenOff = object : android.content.BroadcastReceiver() {
        override fun onReceive(c: android.content.Context?, i: android.content.Intent?) { finish() }
    }
    private val bg = Executors.newSingleThreadExecutor()
    private val clock = SimpleDateFormat("HH:mm", Locale("nl", "NL"))

    private val hideBar = Runnable { hideBarNow() }
    private val commitSeek = Runnable { doSeek() }
    private val tick = object : Runnable { override fun run() { if (bar.visibility == View.VISIBLE) { updateTime(); ui.postDelayed(this, 1000) } } }
    private val commitNumber = Runnable { jumpToNumber() }

    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    /** Tekst in Inter, zoals de rest van Thuis. Maten op 70%: rustiger, meer beeld. */
    private fun text(sizeSp: Float, bold: Boolean = false, color: Int = Color.WHITE) = TextView(this).apply {
        Fonts.style(this, sizeSp * 0.7f, if (bold) 600 else 400, color)
        maxLines = 1
        ellipsize = android.text.TextUtils.TruncateAt.END
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        registerReceiver(screenOff, android.content.IntentFilter(android.content.Intent.ACTION_SCREEN_OFF))
        prefs = Prefs(this)
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY)

        root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }

        playerView = PlayerView(this).apply {
            useController = false
            keepScreenOn = true
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            setShutterBackgroundColor(Color.BLACK)
        }
        root.addView(playerView, FrameLayout.LayoutParams(-1, -1))

        // Balk onderin, in de stijl van Thuis. Ruime marges: sommige tv's snijden de randen af.
        bar = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(48), dp(100), dp(48), dp(24))
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0x00000000, 0xC005070A.toInt(), 0xF505070A.toInt()))
            visibility = View.GONE
        }
        tvChan = text(17f, false, 0xB3FFFFFF.toInt())
        tvNow = text(30f, true)
        tvNext = text(16f, false, 0xB3FFFFFF.toInt())
        bar.addView(tvChan); bar.addView(tvNow); bar.addView(tvNext)
        val timeRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        tvStart = text(16f); tvEnd = text(16f)
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 1000
            progressTintList = ColorStateList.valueOf(Color.WHITE)
            progressBackgroundTintList = ColorStateList.valueOf(0x40FFFFFF)
        }
        timeRow.addView(tvStart, LinearLayout.LayoutParams(-2, -2).apply { rightMargin = dp(14) })
        timeRow.addView(progress, LinearLayout.LayoutParams(0, dp(4), 1f))
        timeRow.addView(tvEnd, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(14) })
        bar.addView(timeRow, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10) })
        btnRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; visibility = View.GONE }
        bar.addView(btnRow, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(12) })
        root.addView(bar, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))

        // Zenderlijst links
        listPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xE60A0D12.toInt())
            setPadding(dp(24), dp(32), dp(12), dp(24))
            visibility = View.GONE
        }
        listTitle = text(22f, true).apply { setText("Zenders"); setPadding(0, 0, 0, dp(12)) }
        listPanel.addView(listTitle)
        listView = ListView(this).apply {
            selector = ColorDrawable(0x40FFFFFF)
            divider = null
            isVerticalScrollBarEnabled = false
            itemsCanFocus = false
            onItemClickListener = AdapterView.OnItemClickListener { _, _, pos, _ -> hideList(); play(pos) }
        }
        listPanel.addView(listView, LinearLayout.LayoutParams(-1, -1))
        root.addView(listPanel, FrameLayout.LayoutParams(dp(320), -1, Gravity.START))

        // Melding in het midden (laden, fouten, zendernummer)
        center = text(28f, true).apply {
            gravity = Gravity.CENTER
            maxLines = 2
            setPadding(dp(28), dp(16), dp(28), dp(16))
            background = GradientDrawable().apply { setColor(0xB3000000.toInt()); cornerRadius = dp(14).toFloat() }
            visibility = View.GONE
        }
        root.addView(center, FrameLayout.LayoutParams(-2, -2, Gravity.CENTER))

        choice = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(dp(24), dp(20), dp(24), dp(20))
            background = GradientDrawable().apply { setColor(0xF20A0D12.toInt()); cornerRadius = dp(18).toFloat() }
            visibility = View.GONE
        }
        fun pill() = text(22f, true).apply { setPadding(dp(18), dp(9), dp(18), dp(9)) }
        choiceLive = pill().apply { setText("● Live") }
        choiceStart = pill().apply { setText("↺ Vanaf begin") }
        choice.addView(choiceLive, LinearLayout.LayoutParams(-2, -2).apply { rightMargin = dp(16) })
        choice.addView(choiceStart)
        root.addView(choice, FrameLayout.LayoutParams(-2, -2, Gravity.CENTER))

        guide = GuideView(this).apply { visibility = View.GONE }
        root.addView(guide, 1, FrameLayout.LayoutParams(-1, -1))

        setContentView(root)
        // Aanraken (telefoon): tikken toont de balk met knoppen, nog eens tikken haalt hem weg.
        playerView.setOnClickListener { if (bar.visibility == View.VISIBLE && menuOpen) hideBarNow() else showBar(true) }
        loadChannels()
    }

    private fun buildPlayer(): ExoPlayer {
        val http = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setUserAgent("Thuis/1.0")
            .setConnectTimeoutMs(8000)
            .setReadTimeoutMs(15000)
        // Eerst FFmpeg voor geluid: dan speelt AC3/MP2 altijd als gewone stereo/surround af.
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
            .build()
        p.addListener(object : Player.Listener {
            // Gepauzeerd mag de schermbeveiliging na een tijd komen.
            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) { playerView.keepScreenOn = playWhenReady }
            override fun onPlaybackStateChanged(state: Int) {
                when (state) {
                    Player.STATE_BUFFERING -> showCenter("Laden…")
                    Player.STATE_READY -> { hideCenter(); retried = false }
                    else -> {}
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                if (!retried) {
                    retried = true
                    showCenter("Opnieuw proberen…")
                    ui.postDelayed({ if (index >= 0) { val r = replay; if (r != null) startReplay(channels[index], r, replayFrom) else startStream(channels[index]) } }, 1500)
                } else {
                    showCenter(if (replay != null) "Terugkijken lukt niet voor dit programma" else "Deze zender speelt niet\n${error.errorCodeName}")
                }
            }
        })
        // Geluid: Nederlands eerst, dan Engels; geen audiodescriptie als er een gewoon spoor is.
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
            .setPreferredAudioLanguages("nl", "nld", "dut", "en")
            .setPreferredAudioRoleFlags(C.ROLE_FLAG_MAIN)
            .build()
        p.addListener(object : Player.Listener {
            override fun onTracksChanged(tracks: Tracks) {
                val audio = tracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }
                if (audio.isEmpty()) return
                val ch = channels.getOrNull(index) ?: return
                // Eerder zelf gekozen spoor voor deze zender terugzetten.
                val want = getSharedPreferences("audio", MODE_PRIVATE).getInt("ch${ch.id}", -1)
                if (want in audio.indices && !audio[want].isSelected && !audioApplied) {
                    audioApplied = true
                    p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
                        .setOverrideForType(TrackSelectionOverride(audio[want].mediaTrackGroup, 0)).build()
                    return
                }
                if (audio.none { it.isSelected }) {
                    val fmt = audio.first().getTrackFormat(0).sampleMimeType ?: "onbekend"
                    flash("Geen geluid: dit geluidsformaat ($fmt) speelt niet af. Probeer de groene knop voor een ander spoor.")
                }
            }
        })
        playerView.player = p
        SubStyle.apply(this, playerView.subtitleView)
        return p
    }

    private fun loadChannels() {
        if (!Server.paired(this)) {
            showCenter("Deze tv is nog niet gekoppeld aan tv-serverr.\nKoppel hem eerst op het startscherm.")
            ui.postDelayed({ finish() }, 3500)
            return
        }
        showCenter("Zenders laden…")
        bg.execute {
            try {
                val cat = intent.getStringExtra("categoryId")
                // Gestart vanuit een categorie: dan zap je binnen die categorie.
                val (title, list) = LiveSrv.load(this, cat)
                ui.post {
                    channels = list
                    if (list.isEmpty()) { showCenter("Geen zenders gevonden"); return@post }
                    listView.adapter = ChannelAdapter(list)
                    catTitle = title
                    listTitle.text = "$title   ·   rechts = gids"
                    val wanted = intent.getIntExtra("streamId", prefs.lastChannel)
                    val i = list.indexOfFirst { it.id == wanted }
                    // Gestart vanuit de gids of zoeken om terug te kijken?
                    val rs = intent.getLongExtra("replayStart", 0L)
                    if (i >= 0 && rs > 0) {
                        play(i, quiet = true)
                        playReplay(i, Programme(intent.getStringExtra("replayTitle") ?: "", "", rs, intent.getLongExtra("replayEnd", rs + 3600_000L), true), rs)
                    } else play(if (i >= 0) i else 0)
                }
            } catch (e: Exception) {
                ui.post { showCenter("Live tv is nu niet bereikbaar\n${e.message}") }
            }
        }
    }

    private fun play(i: Int, quiet: Boolean = false) {
        if (channels.isEmpty()) return
        val n = ((i % channels.size) + channels.size) % channels.size
        if (n != index) prevIndex = index
        index = n
        retried = false
        replay = null
        pausedAt = 0L
        ui.removeCallbacks(commitSeek); seekPresses = 0
        val ch = channels[n]
        prefs.lastChannel = ch.id
        if (quiet) return
        startStream(ch)
        loadEpg(ch)
        showBar(menuOpen)
    }

    private fun startStream(ch: Channel) = startUrl(LiveSrv.streamUrl(this, ch))

    /** Terugkijken vanaf een moment; de link komt van de server, dus op de achtergrond. */
    private fun startReplay(ch: Channel, prog: Programme, from: Long) {
        bg.execute {
            val u = try { LiveSrv.catchupUrl(this, ch, from, prog.end) } catch (e: Exception) { ui.post { flash("Terugkijken lukt niet: ${e.message}") }; null }
            if (u != null) ui.post { startUrl(u) }
        }
    }

    private var audioApplied = false

    /** Volgende geluidsspoor kiezen (groene knop of audioknop) en per zender onthouden. */
    private fun nextAudio() {
        val p = player ?: return
        val audio = p.currentTracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }
        if (audio.size < 2) { flash("Deze zender heeft maar één geluidsspoor"); return }
        val cur = audio.indexOfFirst { it.isSelected }
        val next = (cur + 1) % audio.size
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
            .setOverrideForType(TrackSelectionOverride(audio[next].mediaTrackGroup, 0)).build()
        channels.getOrNull(index)?.let { getSharedPreferences("audio", MODE_PRIVATE).edit().putInt("ch${it.id}", next).apply() }
        val f = audio[next].getTrackFormat(0)
        flash("Geluid ${next + 1} van ${audio.size}: " + listOfNotNull(f.language, f.label, f.sampleMimeType?.substringAfter("/")).joinToString(" · "))
    }

    private fun flash(msg: String) {
        showCenter(msg)
        ui.postDelayed({ hideCenter() }, 3500)
    }

    private fun startUrl(url: String) {
        audioApplied = false
        val p = player ?: buildPlayer().also { player = it }
        // Bij een nieuwe zender geen geluidskeuze van de vorige meenemen.
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon().clearOverridesOfType(C.TRACK_TYPE_AUDIO).build()
        p.setMediaItem(MediaItem.fromUri(url))
        p.prepare()
        p.playWhenReady = true
    }

    // ---------- gids ----------

    private fun openGuide() {
        if (channels.isEmpty()) return
        hideList()
        guide.channels = channels
        guide.title = catTitle
        val now = System.currentTimeMillis()
        guide.epg = channels.mapNotNull { c -> epgCache[c.id]?.takeIf { now - it.first < 10 * 60_000L }?.let { c.id to it.second } }.toMap()
        guide.loading = guide.epg.size < channels.size
        guide.visibility = View.VISIBLE
        guide.start(index)
        bar.visibility = View.GONE
        root.post {
            val r = guide.previewRect(root.width, root.height)
            playerView.layoutParams = FrameLayout.LayoutParams(r.width().toInt(), r.height().toInt()).apply {
                leftMargin = r.left.toInt(); topMargin = r.top.toInt()
            }
            playerView.bringToFront()
        }
        val missing = channels.filter { it.id !in guide.epg }
        if (missing.isEmpty()) return
        bg.execute {
            val tasks = missing.map { c -> java.util.concurrent.Callable { c.id to (try { LiveSrv.fullEpg(this, c) } catch (_: Exception) { emptyList() }) } }
            val got = epgPool.invokeAll(tasks).map { it.get() }
            ui.post {
                val t = System.currentTimeMillis()
                for ((id, list) in got) epgCache[id] = t to list
                guide.epg = guide.epg + got.toMap()
                guide.loading = false
                guide.start(guide.row)
            }
        }
    }

    private fun closeGuide() {
        guide.visibility = View.GONE
        playerView.layoutParams = FrameLayout.LayoutParams(-1, -1)
        guide.bringToFront()
        listPanel.bringToFront(); bar.bringToFront(); center.bringToFront()
    }

    private fun guideOk() {
        val row = guide.row
        val ch = channels.getOrNull(row) ?: return
        val p = guide.selectedProgramme()
        val now = System.currentTimeMillis()
        closeGuide()
        when {
            p != null && now in p.start until p.end && p.archive && (channels.getOrNull(row)?.archiveDays ?: 0) > 0 -> showChoice(row, p)
            p == null || now in p.start until p.end -> play(row)
            p.start < now && p.archive -> playReplay(row, p, p.start)
            p.start < now -> { play(row); showCenter("Dit programma is niet terug te kijken"); ui.postDelayed({ hideCenter() }, 2500) }
            else -> { play(row); showCenter("Begint om ${clock.format(Date(p.start))}"); ui.postDelayed({ hideCenter() }, 2500) }
        }
    }

    private fun canRestart(ch: Channel): Boolean {
        val n = nowProg ?: return false
        return ch.archiveDays > 0 && n.start > 0 && n.start < System.currentTimeMillis()
    }

    private fun showChoice(row: Int, prog: Programme) {
        choiceRow = row; choiceProg = prog; choiceSel = 0
        renderChoice()
        choice.visibility = View.VISIBLE
        choice.bringToFront()
    }

    private fun renderChoice() {
        val on = GradientDrawable().apply { setColor(Color.WHITE); cornerRadius = dp(999).toFloat() }
        val off = GradientDrawable().apply { setColor(0x33FFFFFF); cornerRadius = dp(999).toFloat() }
        choiceLive.background = if (choiceSel == 0) on else off
        choiceLive.setTextColor(if (choiceSel == 0) 0xFF05070A.toInt() else Color.WHITE)
        choiceStart.background = if (choiceSel == 1) on else off
        choiceStart.setTextColor(if (choiceSel == 1) 0xFF05070A.toInt() else Color.WHITE)
    }

    /** Terugkijken vanaf from (klok-tijd). De aanbieder werkt per minuut, dus we ronden af. */
    private fun playReplay(i: Int, prog: Programme, from: Long) {
        if (i != index) prevIndex = index
        index = i
        retried = false
        replay = prog
        replayFrom = from - from % 60_000L
        pausedAt = 0L
        startReplay(channels[i], prog, replayFrom)
        showBar(menuOpen)
    }

    /** Waar we nu zijn, als klok-tijd. */
    private fun position(): Long {
        if (replay == null) return if (pausedAt > 0) pausedAt else System.currentTimeMillis()
        return replayFrom + (player?.currentPosition ?: 0L)
    }

    // ---------- balk ----------

    private fun showBar(menu: Boolean) {
        val ch = channels.getOrNull(index) ?: return
        val r = replay
        tvChan.text = "${ch.num}  ·  ${ch.name}  ·  " + when {
            r != null -> "terugkijken"
            pausedAt > 0 -> "gepauzeerd"
            else -> "live"
        }
        if (r != null) {
            tvNow.text = "↺  " + r.title.ifEmpty { ch.name }
            tvNext.text = ""
        }
        menuOpen = menu
        if (menu) {
            buttons = menuItems()
            btnSel = btnSel.coerceIn(0, (buttons.size - 1).coerceAtLeast(0))
            renderButtons()
            btnRow.visibility = View.VISIBLE
        } else btnRow.visibility = View.GONE
        updateTime()
        bar.animate().cancel()
        if (bar.visibility != View.VISIBLE) {
            bar.alpha = 0f
            bar.visibility = View.VISIBLE
            bar.animate().alpha(1f).setDuration(180)
        } else bar.alpha = 1f
        bar.bringToFront()
        center.bringToFront()
        ui.removeCallbacks(hideBar)
        ui.postDelayed(hideBar, if (menu) 10_000L else 5_000L)
        ui.removeCallbacks(tick); ui.postDelayed(tick, 1000)
    }

    private fun hideBarNow() {
        menuOpen = false
        ui.removeCallbacks(hideBar)
        bar.animate().alpha(0f).setDuration(220).withEndAction { bar.visibility = View.GONE }
    }

    /** Tijdlijn: begin en eind van het programma, en waar we nu zijn. */
    private fun updateTime() {
        val p = replay ?: nowProg
        if (p == null || p.start <= 0 || p.end <= p.start) {
            tvStart.text = ""; tvEnd.text = ""; progress.visibility = View.INVISIBLE; return
        }
        val pos = if (seekPresses > 0) seekTarget else position()
        tvStart.text = clock.format(Date(p.start))
        tvEnd.text = clock.format(Date(p.end))
        progress.progress = (((pos - p.start).toFloat() / (p.end - p.start)).coerceIn(0f, 1f) * 1000).toInt()
        progress.visibility = View.VISIBLE
    }

    private fun menuItems(): List<Pair<String, () -> Unit>> {
        val ch = channels.getOrNull(index) ?: return emptyList()
        val paused = player?.playWhenReady == false || pausedAt > 0
        val l = mutableListOf<Pair<String, () -> Unit>>()
        l += (if (paused) "▶  Verder" else "❚❚  Pauze") to { togglePause() }
        if (replay == null && canRestart(ch)) l += "↺  Vanaf begin" to { nowProg?.let { playReplay(index, it, it.start) }; Unit }
        if (replay != null) l += "●  Terug naar live" to { play(index) }
        l += "Zenders" to { hideBarNow(); showList() }
        if (!BuildConfig.TELEFOON) l += "Gids" to { hideBarNow(); openGuide() }   // telefoon: de gids staat in de app zelf (Live › zender)
        l += "Geluid" to { nextAudio() }
        l += "Ondertitels" to { nextSubs() }
        return l
    }

    private fun renderButtons() {
        btnRow.removeAllViews()
        buttons.forEachIndexed { i, b ->
            val on = i == btnSel
            btnRow.addView(text(19f, true, if (on) 0xFF05070A.toInt() else Color.WHITE).apply {
                text = b.first
                // Aanraken (telefoon): meteen uitvoeren.
                setOnClickListener { btnSel = i; b.second(); if (menuOpen) { buttons = menuItems(); renderButtons() } }
                setPadding(dp(16), dp(7), dp(16), dp(7))
                background = GradientDrawable().apply { setColor(if (on) Color.WHITE else 0x26FFFFFF); cornerRadius = dp(999).toFloat() }
            }, LinearLayout.LayoutParams(-2, -2).apply { rightMargin = dp(8) })
        }
        btnRow.addView(text(16f, false, 0x99FFFFFF.toInt()).apply {
            text = if (BuildConfig.TELEFOON) "" else if (replay != null) "↑ ↓ zappen   ·   ← → spoelen (vasthouden = sneller)" else "↑ ↓ zappen   ·   terug = balk weg"
            gravity = Gravity.END
        }, LinearLayout.LayoutParams(0, -2, 1f))
    }

    /** Pauze. Bij live met terugkijken gaat het daarna verder waar je was; anders weer live. */
    private fun togglePause() {
        val p = player ?: return
        val ch = channels.getOrNull(index) ?: return
        when {
            replay != null -> p.playWhenReady = !p.playWhenReady
            pausedAt > 0 -> {
                val from = pausedAt
                val prog = nowProg?.takeIf { it.start <= from } ?: Programme(ch.name, "", from, System.currentTimeMillis() + 3600_000L)
                playReplay(index, prog, from)
                return
            }
            ch.archiveDays > 0 -> { pausedAt = System.currentTimeMillis(); p.playWhenReady = false }
            else -> {
                p.playWhenReady = !p.playWhenReady
                if (p.playWhenReady) p.seekToDefaultPosition()
            }
        }
        showBar(true)
    }

    /** Spoelen bij terugkijken: stappen van 1 minuut, vasthouden = 5 en daarna 10 minuten. Pas na loslaten laden. */
    private fun seek(dir: Int, repeat: Int) {
        val r = replay ?: return
        if (seekPresses == 0) seekTarget = position()
        seekPresses++
        val step = when { repeat > 12 -> 10; repeat > 3 -> 5; else -> 1 } * 60_000L
        val now = System.currentTimeMillis()
        seekTarget = (seekTarget + dir * step).coerceIn(r.start, now)
        val diff = (seekTarget - position()) / 60_000L
        showCenter((if (dir < 0) "◄◄  " else "►►  ") + clock.format(Date(seekTarget)) + "   (" + (if (diff >= 0) "+" else "") + diff + " min)")
        showBar(false)
        ui.removeCallbacks(commitSeek)
        ui.postDelayed(commitSeek, 900)
    }

    private fun doSeek() {
        val r = replay ?: return
        seekPresses = 0
        hideCenter()
        // Bijna bij nu: dan gewoon live.
        if (seekTarget >= System.currentTimeMillis() - 90_000L) { play(index); return }
        playReplay(index, r, seekTarget)
    }

    /** Ondertitels: uit, of het volgende spoor. */
    private fun nextSubs() {
        val p = player ?: return
        val text = p.currentTracks.groups.filter { it.type == C.TRACK_TYPE_TEXT }
        if (text.isEmpty()) { flash("Geen ondertitels bij deze uitzending"); return }
        val cur = if (p.trackSelectionParameters.disabledTrackTypes.contains(C.TRACK_TYPE_TEXT)) -1 else text.indexOfFirst { it.isSelected }
        val next = cur + 1
        val b = p.trackSelectionParameters.buildUpon()
        if (next >= text.size) {
            p.trackSelectionParameters = b.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build()
            flash("Ondertitels uit")
        } else {
            p.trackSelectionParameters = b.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
                .setOverrideForType(TrackSelectionOverride(text[next].mediaTrackGroup, 0)).build()
            flash("Ondertitels: " + (text[next].getTrackFormat(0).language ?: "spoor ${next + 1}"))
        }
    }

    private fun loadEpg(ch: Channel) {
        tvNow.text = ch.name
        tvNext.text = ""
        nowProg = null
        updateTime()
        bg.execute {
            val epg = try { LiveSrv.shortEpg(this, ch.id) } catch (_: Exception) { emptyList() }
            ui.post {
                if (index < 0 || channels[index].id != ch.id || replay != null) return@post
                val now = epg.getOrNull(0)
                nowProg = now
                tvNow.text = now?.title ?: ch.name
                val next = epg.getOrNull(1)
                tvNext.text = when {
                    next != null && next.start > 0 -> "Daarna ${clock.format(Date(next.start))}  ·  ${next.title}"
                    next != null -> "Daarna: ${next.title}"
                    now == null -> "Geen gids voor deze zender"
                    else -> ""
                }
                updateTime()
                if (menuOpen) { buttons = menuItems(); renderButtons() }
            }
        }
    }

    private fun showCenter(msg: String) {
        center.text = msg
        center.visibility = View.VISIBLE
    }

    private fun hideCenter() {
        if (numBuf.isEmpty()) center.visibility = View.GONE
    }

    private fun showList() {
        if (channels.isEmpty()) return
        listPanel.visibility = View.VISIBLE
        listView.requestFocus()
        listView.setSelection(index.coerceAtLeast(0))
    }

    private fun hideList() {
        listPanel.visibility = View.GONE
    }

    private fun jumpToNumber() {
        val n = numBuf.toIntOrNull()
        numBuf = ""
        center.visibility = View.GONE
        if (n == null) return
        val i = channels.indexOfFirst { it.num == n }
        if (i >= 0) play(i) else showCenter("Zender $n bestaat niet").also { ui.postDelayed({ hideCenter() }, 1500) }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (choice.visibility == View.VISIBLE) {
            when (keyCode) {
                KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT -> { choiceSel = 1 - choiceSel; renderChoice() }
                KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> {
                    choice.visibility = View.GONE
                    val prog = choiceProg
                    if (choiceSel == 1 && prog != null) playReplay(choiceRow, prog, prog.start) else play(choiceRow)
                }
                KeyEvent.KEYCODE_BACK -> choice.visibility = View.GONE
                else -> return super.onKeyDown(keyCode, event)
            }
            return true
        }
        if (guide.visibility == View.VISIBLE) {
            when (keyCode) {
                KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_CHANNEL_UP -> guide.move(-1, 0)
                KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_CHANNEL_DOWN -> guide.move(1, 0)
                KeyEvent.KEYCODE_DPAD_LEFT -> guide.move(0, -1)
                KeyEvent.KEYCODE_DPAD_RIGHT -> guide.move(0, 1)
                KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> guideOk()
                KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_GUIDE, KeyEvent.KEYCODE_MENU -> closeGuide()
                else -> return super.onKeyDown(keyCode, event)
            }
            return true
        }
        if (keyCode == KeyEvent.KEYCODE_GUIDE || keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_G) {
            openGuide(); return true
        }
        if (listPanel.visibility == View.VISIBLE) {
            return when (keyCode) {
                KeyEvent.KEYCODE_BACK -> { hideList(); true }
                // Rechts in de zenderlijst: de volledige gids (de JBL heeft geen gidsknop).
                KeyEvent.KEYCODE_DPAD_RIGHT -> { hideList(); openGuide(); true }
                KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> {
                    val pos = listView.selectedItemPosition
                    hideList()
                    if (pos >= 0) play(pos)
                    true
                }
                else -> super.onKeyDown(keyCode, event)
            }
        }
        // Balk met knoppen open: links/rechts kiest een knop, OK voert hem uit.
        if (menuOpen && bar.visibility == View.VISIBLE) {
            when (keyCode) {
                KeyEvent.KEYCODE_DPAD_LEFT -> { btnSel = (btnSel - 1).coerceAtLeast(0); renderButtons(); showBar(true); return true }
                KeyEvent.KEYCODE_DPAD_RIGHT -> { btnSel = (btnSel + 1).coerceAtMost(buttons.size - 1); renderButtons(); showBar(true); return true }
                KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> { if (event.repeatCount == 0) buttons.getOrNull(btnSel)?.second?.invoke(); return true }
                KeyEvent.KEYCODE_BACK -> { hideBarNow(); return true }
            }
        }
        when (keyCode) {
            KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_CHANNEL_UP -> { play(index + 1); return true }
            KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_CHANNEL_DOWN -> { play(index - 1); return true }
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> { btnSel = 0; showBar(true); return true }
            KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_MEDIA_REWIND -> { if (replay != null) seek(-1, event.repeatCount) else showBar(false); return true }
            KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> { if (replay != null) seek(1, event.repeatCount) else showBar(false); return true }
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY -> { togglePause(); return true }
            KeyEvent.KEYCODE_INFO -> { showBar(false); return true }
            KeyEvent.KEYCODE_LAST_CHANNEL -> { if (prevIndex >= 0) play(prevIndex); return true }
            KeyEvent.KEYCODE_MEDIA_AUDIO_TRACK, KeyEvent.KEYCODE_PROG_GREEN, KeyEvent.KEYCODE_A -> { nextAudio(); return true }
            KeyEvent.KEYCODE_BACK -> {
                if (replay != null || pausedAt > 0) play(index) else finish()
                return true
            }
        }
        val digit = when (keyCode) {
            in KeyEvent.KEYCODE_0..KeyEvent.KEYCODE_9 -> keyCode - KeyEvent.KEYCODE_0
            in KeyEvent.KEYCODE_NUMPAD_0..KeyEvent.KEYCODE_NUMPAD_9 -> keyCode - KeyEvent.KEYCODE_NUMPAD_0
            else -> -1
        }
        if (digit >= 0) {
            if (numBuf.length < 4) numBuf += digit
            showCenter(numBuf)
            ui.removeCallbacks(commitNumber)
            ui.postDelayed(commitNumber, 1500)
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onStart() {
        super.onStart()
        if (player == null && index >= 0) { val r = replay; if (r != null) startReplay(channels[index], r, replayFrom) else startStream(channels[index]) }
    }

    override fun onStop() {
        super.onStop()
        player?.release()
        player = null
        playerView.player = null
    }

    override fun onDestroy() {
        try { unregisterReceiver(screenOff) } catch (_: Exception) {}
        super.onDestroy()
        ui.removeCallbacksAndMessages(null)
        bg.shutdownNow()
        epgPool.shutdownNow()
    }

    private inner class ChannelAdapter(items: List<Channel>) :
        ArrayAdapter<Channel>(this@PlayerActivity, 0, items) {
        override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
            val tv = (convertView as? TextView) ?: text(20f).apply {
                setPadding(dp(14), dp(10), dp(14), dp(10))
            }
            val ch = getItem(position)!!
            tv.text = "${ch.num}   ${ch.name}"
            tv.setTextColor(if (position == index) 0xFF7FE3C4.toInt() else Color.WHITE)
            return tv
        }
    }
}
