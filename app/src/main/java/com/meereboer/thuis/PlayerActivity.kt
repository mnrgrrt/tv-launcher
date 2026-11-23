package com.meereboer.thuis

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
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
 * Live tv. Omhoog/omlaag = zappen, OK = zenderlijst, links/rechts of Info = infobalk,
 * cijfers = zendernummer, Terug = terug naar het startscherm.
 */
@OptIn(UnstableApi::class)
class PlayerActivity : Activity() {
    private lateinit var prefs: Prefs
    private var player: ExoPlayer? = null
    private lateinit var playerView: PlayerView

    private lateinit var infoBar: LinearLayout
    private lateinit var tvNum: TextView
    private lateinit var tvName: TextView
    private lateinit var tvNow: TextView
    private lateinit var tvTime: TextView
    private lateinit var tvNext: TextView
    private lateinit var progress: ProgressBar

    private lateinit var listPanel: LinearLayout
    private lateinit var listView: ListView
    private lateinit var listTitle: TextView
    private lateinit var center: TextView
    private lateinit var root: FrameLayout
    private lateinit var guide: GuideView
    private val epgCache = HashMap<Int, Pair<Long, List<Programme>>>()
    private val epgPool = Executors.newFixedThreadPool(6)
    /** Programma dat we nu terugkijken (null = live). */
    private var replay: Programme? = null
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
    private val bg = Executors.newSingleThreadExecutor()
    private val clock = SimpleDateFormat("HH:mm", Locale("nl", "NL"))

    private val hideInfo = Runnable { infoBar.animate().alpha(0f).setDuration(250).withEndAction { infoBar.visibility = View.GONE } }
    private val commitNumber = Runnable { jumpToNumber() }

    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    private fun text(sizeSp: Float, bold: Boolean = false, color: Int = Color.WHITE) = TextView(this).apply {
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
        setTextColor(color)
        if (bold) typeface = Typeface.DEFAULT_BOLD
        maxLines = 1
        ellipsize = android.text.TextUtils.TruncateAt.END
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
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

        // Infobalk onderin
        infoBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.BOTTOM
            setPadding(dp(48), dp(80), dp(48), dp(32))
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0x00000000, 0xE6000000.toInt()))
            visibility = View.GONE
        }
        val left = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        tvNum = text(40f, true)
        tvName = text(18f, false, 0xCCFFFFFF.toInt())
        left.addView(tvNum); left.addView(tvName)
        infoBar.addView(left, LinearLayout.LayoutParams(dp(180), -2))
        val mid = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        tvNow = text(26f, true)
        tvTime = text(16f, false, 0xCCFFFFFF.toInt())
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { max = 1000 }
        tvNext = text(16f, false, 0x99FFFFFF.toInt())
        mid.addView(tvNow)
        val timeRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        timeRow.addView(tvTime, LinearLayout.LayoutParams(-2, -2).apply { rightMargin = dp(16) })
        timeRow.addView(progress, LinearLayout.LayoutParams(dp(260), dp(6)))
        mid.addView(timeRow, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6); bottomMargin = dp(6) })
        mid.addView(tvNext)
        infoBar.addView(mid, LinearLayout.LayoutParams(0, -2, 1f))
        root.addView(infoBar, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))

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
        root.addView(listPanel, FrameLayout.LayoutParams(dp(420), -1, Gravity.START))

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
        fun pill() = text(22f, true).apply { setPadding(dp(26), dp(14), dp(26), dp(14)) }
        choiceLive = pill().apply { setText("● Live") }
        choiceStart = pill().apply { setText("↺ Vanaf begin") }
        choice.addView(choiceLive, LinearLayout.LayoutParams(-2, -2).apply { rightMargin = dp(16) })
        choice.addView(choiceStart)
        root.addView(choice, FrameLayout.LayoutParams(-2, -2, Gravity.CENTER))

        guide = GuideView(this).apply { visibility = View.GONE }
        root.addView(guide, 1, FrameLayout.LayoutParams(-1, -1))

        setContentView(root)
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
                    ui.postDelayed({ if (index >= 0) { val r = replay; if (r != null) startUrl(Xtream.timeshiftUrl(prefs, channels[index], r)) else startStream(channels[index]) } }, 1500)
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
        SubStyle.apply(this, playerView.subtitleView, false)
        return p
    }

    private fun loadChannels() {
        if (!prefs.configured) {
            showCenter("Live tv is nog niet ingesteld.\nGa naar Instellingen op het startscherm.")
            ui.postDelayed({ finish() }, 3500)
            return
        }
        showCenter("Zenders laden…")
        bg.execute {
            try {
                val cat = intent.getStringExtra("categoryId")
                val all = Xtream.load(prefs)
                // Gestart vanuit een categorie: dan zap je binnen die categorie.
                val smart = if (!cat.isNullOrEmpty()) Categorizer.build(this, all).firstOrNull { it.id == cat } else null
                val list = smart?.channels?.ifEmpty { all } ?: all
                val title = smart?.name ?: "Alle zenders"
                ui.post {
                    channels = list
                    if (list.isEmpty()) { showCenter("Geen zenders gevonden"); return@post }
                    listView.adapter = ChannelAdapter(list)
                    listTitle.text = title
                    val wanted = intent.getIntExtra("streamId", prefs.lastChannel)
                    val i = list.indexOfFirst { it.id == wanted }
                    play(if (i >= 0) i else 0)
                }
            } catch (e: Exception) {
                ui.post { showCenter("Kan Dispatcharr niet bereiken\n${e.message}") }
            }
        }
    }

    private fun play(i: Int) {
        if (channels.isEmpty()) return
        val n = ((i % channels.size) + channels.size) % channels.size
        if (n != index) prevIndex = index
        index = n
        retried = false
        replay = null
        val ch = channels[n]
        prefs.lastChannel = ch.id
        startStream(ch)
        showInfo(ch)
        loadEpg(ch)
    }

    private fun startStream(ch: Channel) = startUrl(Xtream.streamUrl(prefs, ch))

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
        guide.title = listTitle.text.toString()
        val now = System.currentTimeMillis()
        guide.epg = channels.mapNotNull { c -> epgCache[c.id]?.takeIf { now - it.first < 10 * 60_000L }?.let { c.id to it.second } }.toMap()
        guide.loading = guide.epg.size < channels.size
        guide.visibility = View.VISIBLE
        guide.start(index)
        infoBar.visibility = View.GONE
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
            val tasks = missing.map { c -> java.util.concurrent.Callable { c.id to (try { Xtream.fullEpg(prefs, c) } catch (_: Exception) { emptyList() }) } }
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
        listPanel.bringToFront(); infoBar.bringToFront(); center.bringToFront()
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
            p.start < now && p.archive -> playReplay(row, p)
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

    private fun playReplay(i: Int, prog: Programme) {
        if (i != index) prevIndex = index
        index = i
        retried = false
        replay = prog
        val ch = channels[i]
        startUrl(Xtream.timeshiftUrl(prefs, ch, prog))
        tvNum.text = ch.num.toString()
        tvName.text = ch.name
        tvNow.text = "↺ " + prog.title
        tvTime.text = "Terugkijken · ${clock.format(Date(prog.start))} tot ${clock.format(Date(prog.end))}  ·  ◄► 30 sec  ·  OK pauze  ·  Terug = live"
        tvNext.text = ""
        progress.visibility = View.INVISIBLE
        infoBar.alpha = 1f
        infoBar.visibility = View.VISIBLE
        ui.removeCallbacks(hideInfo)
        ui.postDelayed(hideInfo, 6000)
    }

    private fun showInfo(ch: Channel) {
        tvNum.text = ch.num.toString()
        tvName.text = ch.name
        if (infoBar.visibility != View.VISIBLE) {
            infoBar.alpha = 0f
            infoBar.visibility = View.VISIBLE
            infoBar.animate().alpha(1f).setDuration(200)
        } else infoBar.alpha = 1f
        ui.removeCallbacks(hideInfo)
        ui.postDelayed(hideInfo, 5000)
    }

    private fun loadEpg(ch: Channel) {
        tvNow.text = ch.name
        tvTime.text = ""
        tvNext.text = ""
        nowProg = null
        progress.visibility = View.INVISIBLE
        bg.execute {
            val epg = try { Xtream.shortEpg(prefs, ch.id, 2) } catch (_: Exception) { emptyList() }
            ui.post {
                if (index < 0 || channels[index].id != ch.id) return@post
                val now = epg.getOrNull(0)
                nowProg = now
                if (now != null) {
                    tvNow.text = now.title
                    if (now.start > 0 && now.end > now.start) {
                        tvTime.text = "${clock.format(Date(now.start))} tot ${clock.format(Date(now.end))}"
                        val p = (System.currentTimeMillis() - now.start).toFloat() / (now.end - now.start)
                        progress.progress = (p.coerceIn(0f, 1f) * 1000).toInt()
                        progress.visibility = View.VISIBLE
                    }
                } else {
                    tvTime.text = "Geen gids beschikbaar"
                }
                epg.getOrNull(1)?.let {
                    tvNext.text = if (it.start > 0) "Daarna ${clock.format(Date(it.start))}  ${it.title}" else "Daarna: ${it.title}"
                }
                if (canRestart(ch)) tvNext.text = "◄ vanaf begin" + (if (tvNext.text.isNotEmpty()) "     " + tvNext.text else "")
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
                    if (choiceSel == 1 && prog != null) playReplay(choiceRow, prog) else play(choiceRow)
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
        if (replay != null) {
            val p = player
            when (keyCode) {
                KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_MEDIA_REWIND -> { p?.seekTo((p.currentPosition - 30_000).coerceAtLeast(0)); return true }
                KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> { p?.seekTo(p.currentPosition + 30_000); return true }
                KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> {
                    p?.let { it.playWhenReady = !it.playWhenReady; showCenter(if (it.playWhenReady) "▶" else "❚❚"); ui.postDelayed({ hideCenter() }, 800) }
                    return true
                }
                KeyEvent.KEYCODE_BACK -> { play(index); return true }
            }
        }
        if (keyCode == KeyEvent.KEYCODE_GUIDE || keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_G) {
            openGuide(); return true
        }
        if (listPanel.visibility == View.VISIBLE) {
            return when (keyCode) {
                KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_DPAD_RIGHT -> { hideList(); true }
                KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> {
                    val pos = listView.selectedItemPosition
                    hideList()
                    if (pos >= 0) play(pos)
                    true
                }
                else -> super.onKeyDown(keyCode, event)
            }
        }
        when (keyCode) {
            KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_CHANNEL_UP -> { play(index + 1); return true }
            KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_CHANNEL_DOWN -> { play(index - 1); return true }
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> { showList(); return true }
            KeyEvent.KEYCODE_DPAD_LEFT -> {
                val ch = channels.getOrNull(index)
                val n = nowProg
                if (ch != null && n != null && canRestart(ch)) playReplay(index, n)
                else if (ch != null) { showInfo(ch); loadEpg(ch) }
                return true
            }
            KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_INFO -> {
                if (index >= 0) { showInfo(channels[index]); loadEpg(channels[index]) }
                return true
            }
            KeyEvent.KEYCODE_LAST_CHANNEL -> { if (prevIndex >= 0) play(prevIndex); return true }
            KeyEvent.KEYCODE_MEDIA_AUDIO_TRACK, KeyEvent.KEYCODE_PROG_GREEN, KeyEvent.KEYCODE_A -> { nextAudio(); return true }
            KeyEvent.KEYCODE_BACK -> { finish(); return true }
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
        if (player == null && index >= 0) startStream(channels[index])
    }

    override fun onStop() {
        super.onStop()
        player?.release()
        player = null
        playerView.player = null
    }

    override fun onDestroy() {
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
