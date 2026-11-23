package com.meereboer.thuis

import android.content.Context
import android.graphics.Color
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.ui.SubtitleView

/** Hoe ondertitels eruitzien: Inter, grootte, dikte, achtergrond en hoogte. Bewaard op het apparaat. */
@OptIn(UnstableApi::class)
object SubStyle {
    val sizes = listOf("Klein" to 0.040f, "Normaal" to 0.047f, "Groot" to 0.056f, "Extra groot" to 0.068f)
    val weights = listOf("Normaal" to 400, "Medium" to 500, "Vet" to 700)
    val backs = listOf("Schaduw", "Rand", "Zwarte balk", "Geel")
    val places = listOf("Laag" to 0.04f, "Normaal" to 0.08f, "Hoger" to 0.15f)
    private val defaults = mapOf("size" to 1, "weight" to 1, "bg" to 0, "place" to 1)
    private val counts = mapOf("size" to sizes.size, "weight" to weights.size, "bg" to backs.size, "place" to places.size)

    private fun sp(c: Context) = c.getSharedPreferences("subs", Context.MODE_PRIVATE)
    fun get(c: Context, key: String) = sp(c).getInt(key, defaults[key] ?: 0).coerceIn(0, (counts[key] ?: 1) - 1)
    fun cycle(c: Context, key: String) { sp(c).edit().putInt(key, (get(c, key) + 1) % (counts[key] ?: 1)).apply() }

    fun summary(c: Context) = listOf(sizes[get(c, "size")].first, weights[get(c, "weight")].first, backs[get(c, "bg")].first).joinToString(" · ")

    /** Toepassen. lift = extra ruimte onderin (deel van de schermhoogte), bijvoorbeeld als de balk in beeld is. */
    fun apply(c: Context, v: SubtitleView?, lift: Float = 0f) {
        v ?: return
        val face = when (weights[get(c, "weight")].second) { 700 -> Fonts.bold(c); 500 -> Fonts.medium(c); else -> Fonts.regular(c) }
        val clear = Color.TRANSPARENT
        val style = when (get(c, "bg")) {
            1 -> CaptionStyleCompat(Color.WHITE, clear, clear, CaptionStyleCompat.EDGE_TYPE_OUTLINE, Color.BLACK, face)
            2 -> CaptionStyleCompat(Color.WHITE, 0xB3000000.toInt(), clear, CaptionStyleCompat.EDGE_TYPE_NONE, Color.BLACK, face)
            3 -> CaptionStyleCompat(0xFFFFE14D.toInt(), clear, clear, CaptionStyleCompat.EDGE_TYPE_DROP_SHADOW, 0xE6000000.toInt(), face)
            else -> CaptionStyleCompat(Color.WHITE, clear, clear, CaptionStyleCompat.EDGE_TYPE_DROP_SHADOW, 0xE6000000.toInt(), face)
        }
        v.setApplyEmbeddedStyles(false)
        v.setApplyEmbeddedFontSizes(false)
        v.setStyle(style)
        v.setFractionalTextSize(sizes[get(c, "size")].second)
        v.setBottomPaddingFraction(places[get(c, "place")].second + lift)
    }
}
