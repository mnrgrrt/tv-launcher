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
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
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
 * Speler voor films en afleveringen van de IPTV-server.
 * OK = pauze, links/rechts = 10 s terug / 30 s vooruit, omhoog/omlaag = 5 min,
 * groene knop = geluidsspoor, gele knop = ondertitels, Terug = stoppen (positie wordt onthouden).
 */
@OptIn(UnstableApi::class)
class VodActivity : Activity() {
    private var player: ExoPlayer? = null
    private lateinit var item: JSONObject
    private lateinit var osd: LinearLayout
    private lateinit var tvTitle: TextView
    private lateinit var tvTime: TextView
    private lateinit var bar: ProgressBar
    private lateinit var center: TextView
    private val ui = Handler(Looper.getMainLooper())
    private var resumed = false
    private var subsTried = false
    private val bg = Executors.newSingleThreadExecutor()

    /** Geen Nederlandse ondertitels in het bestand en geen Nederlands geluid? Dan via OpenSubtitles. */
    private fun maybeFetchSubs(tracks: Tracks, manual: Boolean = false) {
        if (subsTried && !manual) return
        val prefs = Prefs(this)
        if (prefs.osKey.isEmpty()) { if (manual) flash("Geen OpenSubtitles-sleutel ingesteld"); return }
        val nl = setOf("nl", "nld", "dut")
        val hasNlText = tracks.groups.any { g -> g.type == C.TRACK_TYPE_TEXT && (0 until g.length).any { g.getTrackFormat(it).language?.lowercase() in nl } }
        val nlAudio = tracks.groups.any { g -> g.type == C.TRACK_TYPE_AUDIO && g.isSelected && (0 until g.length).any { g.getTrackFormat(it).language?.lowercase() in nl } }
        if (!manual && (hasNlText || nlAudio)) return
        subsTried = true
        if (manual) flash("Ondertitels zoeken…")
        bg.execute {
            val f = try { Subs.find(this, prefs, item) } catch (e: Exception) { ui.post { if (manual) flash("Ondertitels zoeken lukt niet: ${e.message?.take(60)}") }; null }
            ui.post {
                val p = player ?: return@post
                if (f == null) { if (manual) flash("Geen Nederlandse ondertitels gevonden"); return@post }
                val pos = p.currentPosition
                val sub = MediaItem.SubtitleConfiguration.Builder(android.net.Uri.fromFile(f))
                    .setMimeType(MimeTypes.APPLICATION_SUBRIP).setLanguage("nl").setLabel("Nederlands (OpenSubtitles)")
                    .setSelectionFlags(C.SELECTION_FLAG_DEFAULT).build()
                p.setMediaItem(MediaItem.Builder().setUri(item.optString("url")).setSubtitleConfigurations(listOf(sub)).build(), pos)
                p.prepare()
                p.trackSelectionParameters = p.trackSelectionParameters.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false).build()
                flash("Nederlandse ondertitels geladen")
            }
        }
    }

    private val hideOsd = Runnable { osd.visibility = View.GONE }
    private val tick = object : Runnable {
        override fun run() { updateOsd(); ui.postDelayed(this, 1000) }
    }

    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        item = JSONObject(intent.getStringExtra("item") ?: "{}")
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY)
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        val pv = PlayerView(this).apply {
            useController = false; keepScreenOn = true
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            setShutterBackgroundColor(Color.BLACK)
        }
        root.addView(pv, FrameLayout.LayoutParams(-1, -1))

        osd = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(48), dp(80), dp(48), dp(32))
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0x00000000, 0xE6000000.toInt()))
        }
        tvTitle = TextView(this).apply { setTextColor(Color.WHITE); textSize = 26f; typeface = Typeface.DEFAULT_BOLD; maxLines = 1 }
        bar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { max = 1000 }
        tvTime = TextView(this).apply { setTextColor(0xCCFFFFFF.toInt()); textSize = 16f }
        osd.addView(tvTitle)
        osd.addView(bar, LinearLayout.LayoutParams(-1, dp(6)).apply { topMargin = dp(10); bottomMargin = dp(8) })
        osd.addView(tvTime)
        root.addView(osd, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))

        center = TextView(this).apply {
            setTextColor(Color.WHITE); textSize = 24f; typeface = Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER
            setPadding(dp(28), dp(16), dp(28), dp(16))
            background = GradientDrawable().apply { setColor(0xB3000000.toInt()); cornerRadius = dp(14).toFloat() }
            visibility = View.GONE
        }
        root.addView(center, FrameLayout.LayoutParams(-2, -2, Gravity.CENTER))
        setContentView(root)

        tvTitle.text = listOf(item.optString("title"), item.optString("sub")).filter { it.isNotEmpty() }.joinToString("  ·  ")

        val http = DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(true).setUserAgent("Thuis/1.0")
            .setConnectTimeoutMs(10000).setReadTimeoutMs(20000)
        val renderers = DefaultRenderersFactory(this)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER)
            .setEnableDecoderFallback(true)
        val p = ExoPlayer.Builder(this, renderers)
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
                            val pos = Vod.position(this@VodActivity, item.optString("key"))
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
                if (tracks.groups.any { it.type == C.TRACK_TYPE_AUDIO }) maybeFetchSubs(tracks)
            }
            override fun onPlayerError(error: PlaybackException) { show("Dit speelt niet af\n${error.errorCodeName}", 0) }
        })
        pv.player = p
        player = p
        p.setMediaItem(MediaItem.fromUri(item.optString("url")))
        p.prepare()
        p.playWhenReady = true
        showOsd()
        ui.post(tick)
    }

    private fun fmt(ms: Long): String {
        val s = ms / 1000
        return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
    }

    private fun updateOsd() {
        val p = player ?: return
        val d = p.duration.takeIf { it > 0 } ?: return
        bar.progress = (p.currentPosition * 1000 / d).toInt()
        tvTime.text = "${fmt(p.currentPosition)} / ${fmt(d)}   ·   nog ${fmt(d - p.currentPosition)}" + if (!p.isPlaying) "   ·   gepauzeerd" else ""
    }

    private fun showOsd() {
        osd.visibility = View.VISIBLE; updateOsd()
        ui.removeCallbacks(hideOsd)
        if (player?.isPlaying != false) ui.postDelayed(hideOsd, 4000)
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
        when (keyCode) {
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
            KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE -> {
                p.playWhenReady = !p.playWhenReady
                ui.postDelayed({ showOsd() }, 100)
            }
            KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_MEDIA_REWIND -> { p.seekBack(); showOsd() }
            KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> { p.seekForward(); showOsd() }
            KeyEvent.KEYCODE_DPAD_UP -> { p.seekTo(p.currentPosition + 300_000); showOsd() }
            KeyEvent.KEYCODE_DPAD_DOWN -> { p.seekTo((p.currentPosition - 300_000).coerceAtLeast(0)); showOsd() }
            KeyEvent.KEYCODE_MEDIA_AUDIO_TRACK, KeyEvent.KEYCODE_PROG_GREEN, KeyEvent.KEYCODE_A -> cycle(C.TRACK_TYPE_AUDIO, "geluidssporen")
            KeyEvent.KEYCODE_CAPTIONS, KeyEvent.KEYCODE_PROG_YELLOW, KeyEvent.KEYCODE_S -> cycle(C.TRACK_TYPE_TEXT, "ondertitels")
            KeyEvent.KEYCODE_INFO, KeyEvent.KEYCODE_MENU -> showOsd()
            KeyEvent.KEYCODE_BACK -> { save(); finish() }
            else -> return super.onKeyDown(keyCode, event)
        }
        return true
    }

    private fun save() {
        val p = player ?: return
        if (p.duration > 0) Vod.save(this, item, p.currentPosition, p.duration)
    }

    override fun onStop() {
        super.onStop()
        save()
        ui.removeCallbacksAndMessages(null)
        player?.release(); player = null
        bg.shutdownNow()
    }
}
