package com.meereboer.thuis

import android.content.Context
import android.graphics.Typeface
import android.widget.TextView

/**
 * Eén lettertype in heel Thuis: Inter (zelfde als het startscherm), in vier diktes.
 * Alles wat de app zelf tekent (spelers, gids, menu's, schermbeveiliging) gebruikt dit.
 */
object Fonts {
    private val cache = HashMap<String, Typeface>()
    private fun load(c: Context, name: String) = cache.getOrPut(name) {
        try { Typeface.createFromAsset(c.assets, "fonts/inter-$name.ttf") } catch (_: Exception) { Typeface.DEFAULT }
    }
    fun regular(c: Context) = load(c, "regular")
    fun medium(c: Context) = load(c, "medium")
    fun semibold(c: Context) = load(c, "semibold")
    fun bold(c: Context) = load(c, "bold")

    /** Tekst in Thuis-stijl: maat in sp, dikte 400/500/600/700. */
    fun style(t: TextView, sp: Float, weight: Int = 400, color: Int = 0xFFFFFFFF.toInt()) {
        t.textSize = sp
        t.setTextColor(color)
        t.typeface = when { weight >= 700 -> bold(t.context); weight >= 600 -> semibold(t.context); weight >= 500 -> medium(t.context); else -> regular(t.context) }
        t.includeFontPadding = false
    }
}
