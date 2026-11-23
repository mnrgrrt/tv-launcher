package com.meereboer.thuis

import android.content.Context
import android.content.Intent
import android.media.tv.TvContract
import android.media.tv.TvInputInfo
import android.media.tv.TvInputManager
import org.json.JSONArray
import org.json.JSONObject

/**
 * HDMI-ingangen van dit apparaat. Alleen ingangen waar iets op zit dat aan staat; heeft het apparaat via HDMI-CEC een naam
 * doorgegeven (bijv. "PlayStation 5"), dan die naam. Thuis krijgt bericht als er iets in- of uitgeplugd wordt.
 */
object Inputs {
    private fun tim(c: Context) = c.getSystemService(Context.TV_INPUT_SERVICE) as? TvInputManager

    fun load(c: Context): JSONArray {
        val out = JSONArray()
        val m = tim(c) ?: return out
        val all = try { m.tvInputList } catch (_: Exception) { return out }
        val ports = all.filter { it.type == TvInputInfo.TYPE_HDMI && it.parentId == null }
        ports.sortedBy { it.loadLabel(c).toString() }.forEachIndexed { i, port ->
            // Een CEC-apparaat verschijnt als "kind" van de poort; dat heeft de mooiste naam.
            val child = all.firstOrNull { it.parentId == port.id && m.getInputState(it.id) == TvInputManager.INPUT_STATE_CONNECTED }
            val use = child ?: port
            // Alleen wat echt aan staat. Sommige apparaten (zoals de JBL) melden een lege ingang als "stand-by".
            if (m.getInputState(use.id) != TvInputManager.INPUT_STATE_CONNECTED) return@forEachIndexed
            if (use.isHidden(c)) return@forEachIndexed
            val label = (use.loadCustomLabel(c) ?: use.loadLabel(c))?.toString()?.trim().orEmpty().ifEmpty { "HDMI ${i + 1}" }
            out.put(JSONObject().put("id", use.id).put("port", port.id).put("label", label))
        }
        return out
    }

    /** Naar een ingang schakelen (Android opent hem in zijn eigen tv-app). */
    fun open(c: Context, id: String) {
        val m = tim(c) ?: return
        if (m.tvInputList.none { it.id == id }) return   // alleen bestaande ingangen
        c.startActivity(Intent(Intent.ACTION_VIEW, TvContract.buildChannelUriForPassthroughInput(id)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /** Bericht bij in- of uitpluggen. */
    fun watch(c: Context, changed: () -> Unit): TvInputManager.TvInputCallback? {
        val m = tim(c) ?: return null
        val cb = object : TvInputManager.TvInputCallback() {
            override fun onInputStateChanged(inputId: String, state: Int) = changed()
            override fun onInputAdded(inputId: String) = changed()
            override fun onInputRemoved(inputId: String) = changed()
            override fun onInputUpdated(inputId: String) = changed()
        }
        m.registerCallback(cb, android.os.Handler(android.os.Looper.getMainLooper()))
        return cb
    }
    fun unwatch(c: Context, cb: TvInputManager.TvInputCallback?) { if (cb != null) tim(c)?.unregisterCallback(cb) }
}
