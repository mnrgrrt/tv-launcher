package com.meereboer.thuis

import android.graphics.Color
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * De motor onder de gedeelde speler (speler.js) op Android: ExoPlayer.
 * Het beeld ligt onder de WebView; de knoppen, balken, gids en ondertitels tekent de pagina erbovenop.
 * In JavaScript heet dit object "Motor"; assets/android/motor.js maakt er window.SpelerMotor van.
 * ExoPlayer mag alleen vanaf de hoofdthread; de pagina leest daarom tijd en stand uit een kopie die elke 250 ms wordt bijgewerkt.
 */
@OptIn(UnstableApi::class)
class Motor(private val act: MainActivity, private val web: WebView, private val root: FrameLayout) {
    private val ui = Handler(Looper.getMainLooper())
    private var player: ExoPlayer? = null
    private var view: PlayerView? = null
    private var loadId = 0          // antwoord aan de pagina zodra het beeld klaarstaat
    private var live = false
    private var wantAudio = -1      // gekozen geluidsspoor (per zender onthouden door de pagina)
    private var retried = false

    @Volatile var active = false; private set
    @Volatile private var pos = 0.0
    @Volatile private var buf = 0.0
    @Volatile private var paused = false
    @Volatile private var audioJson = "[]"

    private fun ev(name: String) = web.evaluateJavascript("window.__motor && window.__motor('$name')", null)
    private fun reply(id: Int, ok: Boolean, data: String) =
        web.evaluateJavascript("window.__motorCb && window.__motorCb($id, $ok, ${JSONObject.quote(data)})", null)

    private val tick = object : Runnable {
        override fun run() {
            val p = player ?: return
            pos = p.currentPosition / 1000.0
            buf = p.bufferedPosition / 1000.0
            ui.postDelayed(this, 250)
        }
    }

    private fun build(): ExoPlayer {
        val v = view ?: PlayerView(act).apply {
            useController = false
            setShutterBackgroundColor(Color.BLACK)
            setBackgroundColor(Color.BLACK)
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            subtitleView?.visibility = View.GONE   // ondertitels tekent de pagina
            isFocusable = false
        }.also { view = it; root.addView(it, 0, FrameLayout.LayoutParams(-1, -1)) }
        val http = DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(true).setUserAgent("Thuis/1.0")
            .setConnectTimeoutMs(8000).setReadTimeoutMs(15000)
        // Eerst FFmpeg voor geluid (AC3/MP2 speelt dan altijd); Dolby Vision zonder eigen decoder via de HEVC-basislaag.
        val renderers = DefaultRenderersFactory(act).setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER)
            .setEnableDecoderFallback(true).setMediaCodecSelector(Decoders.selector)
        val selector = DefaultTrackSelector(act).apply {
            setParameters(buildUponParameters().setExceedVideoConstraintsIfNecessary(true).setExceedRendererCapabilitiesIfNecessary(true))
        }
        val p = ExoPlayer.Builder(act, renderers).setTrackSelector(selector)
            .setMediaSourceFactory(DefaultMediaSourceFactory(DefaultDataSource.Factory(act, http))).build()
        // Geluid: Nederlands eerst, dan Engels; geen audiodescriptie als er een gewoon spoor is. Ondertitels uit (die doet de pagina).
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
            .setPreferredAudioLanguages("nl", "nld", "dut", "en").setPreferredAudioRoleFlags(C.ROLE_FLAG_MAIN)
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build()
        p.addListener(object : Player.Listener {
            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                paused = !playWhenReady; v.keepScreenOn = playWhenReady; ev(if (playWhenReady) "play" else "pause")
            }
            override fun onPlaybackStateChanged(state: Int) {
                when (state) {
                    Player.STATE_BUFFERING -> ev("waiting")
                    Player.STATE_READY -> {
                        retried = false
                        if (loadId != 0) {
                            val d = p.duration
                            reply(loadId, true, if (live || d == C.TIME_UNSET) "0" else (d / 1000).toString()); loadId = 0
                        }
                        ev("playing")
                    }
                    Player.STATE_ENDED -> ev("ended")
                    else -> {}
                }
            }
            override fun onPlayerError(error: PlaybackException) {
                if (loadId != 0) { reply(loadId, false, "Deze bron speelt niet af (${error.errorCodeName})"); loadId = 0; return }
                // Live: één keer stil opnieuw proberen (haperende zender, achter het live-venster).
                if (live && !retried) { retried = true; p.prepare(); p.play(); return }
                ev("error")
            }
            override fun onTracksChanged(tracks: Tracks) {
                val audio = tracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }
                if (wantAudio in audio.indices && !audio[wantAudio].isSelected) {
                    p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
                        .setOverrideForType(TrackSelectionOverride(audio[wantAudio].mediaTrackGroup, 0)).build()
                }
                audioJson = JSONArray(audio.map { g ->
                    val f = g.getTrackFormat(0)
                    val name = f.label ?: f.language?.takeIf { it != "und" }?.let { Locale(it).getDisplayLanguage(Locale("nl")) } ?: ""
                    val kan = when (f.channelCount) { 1 -> "mono"; 2 -> "stereo"; 6 -> "5.1"; 8 -> "7.1"; else -> "" }
                    JSONObject().put("label", listOf(name, kan).filter { it.isNotEmpty() }.joinToString(" · "))
                        .put("lang", f.language ?: "").put("codec", f.sampleMimeType ?: "").put("on", g.isSelected)
                }).toString()
            }
        })
        v.player = p
        v.visibility = View.VISIBLE
        player = p
        return p
    }

    /** Afspelen. url = ondertekende /stream/-link van tv-serverr; from in seconden; audio = gekozen spoor of -1. */
    @JavascriptInterface fun load(id: Int, url: String, from: Double, isLive: Boolean, audio: Int) = ui.post {
        val p = player ?: build()
        if (!active) { active = true; web.setBackgroundColor(Color.TRANSPARENT); act.playing(true) }
        if (loadId != 0) reply(loadId, false, "Afgebroken")
        loadId = id; live = isLive; wantAudio = audio; retried = false; audioJson = "[]"
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon().clearOverridesOfType(C.TRACK_TYPE_AUDIO).build()
        p.setMediaItem(MediaItem.fromUri(Uri.parse(Server.abs(act, url))), if (!isLive && from > 0) (from * 1000).toLong() else 0L)
        p.prepare(); p.playWhenReady = true
        ui.removeCallbacks(tick); ui.post(tick)
    }

    @JavascriptInterface fun time(): Double = pos
    @JavascriptInterface fun buffered(): Double = buf
    @JavascriptInterface fun paused(): Boolean = paused
    @JavascriptInterface fun seek(sec: Double) = ui.post { pos = sec; player?.seekTo((sec * 1000).toLong()) }
    @JavascriptInterface fun play() = ui.post { player?.play() }
    @JavascriptInterface fun pause() = ui.post { player?.pause() }
    @JavascriptInterface fun audio(): String = audioJson
    @JavascriptInterface fun setAudio(i: Int) = ui.post {
        val p = player ?: return@post
        val g = p.currentTracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }.getOrNull(i) ?: return@post
        wantAudio = i
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon().setOverrideForType(TrackSelectionOverride(g.mediaTrackGroup, 0)).build()
    }

    /** Beeld klein (rechtsboven in de gids) of weer schermvullend. Maten in pagina-pixels; pageW = breedte van de pagina. */
    @JavascriptInterface fun rect(x: Double, y: Double, w: Double, h: Double, pageW: Double) = ui.post {
        val v = view ?: return@post
        val lp = FrameLayout.LayoutParams(-1, -1)
        if (w > 0 && pageW > 0) {
            val s = web.width / pageW
            lp.width = (w * s).toInt(); lp.height = (h * s).toInt(); lp.leftMargin = (x * s).toInt(); lp.topMargin = (y * s).toInt()
        }
        v.layoutParams = lp
    }

    /** Stoppen en alles vrijgeven: de JBL heeft weinig geheugen. */
    @JavascriptInterface fun stop() = ui.post { release() }

    fun release() {
        ui.removeCallbacks(tick)
        loadId = 0   // de speler is dicht; geen antwoord meer nodig
        player?.release(); player = null
        view?.let { it.player = null; it.keepScreenOn = false; it.visibility = View.GONE; it.layoutParams = FrameLayout.LayoutParams(-1, -1) }
        pos = 0.0; buf = 0.0; paused = false; audioJson = "[]"
        if (active) { active = false; web.setBackgroundColor(Color.BLACK); act.playing(false) }
    }
}
