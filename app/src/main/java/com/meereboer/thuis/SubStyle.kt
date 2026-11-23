package com.meereboer.thuis

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.ui.SubtitleView

/** Hoe ondertitels eruitzien: grootte, achtergrond en hoogte. Bewaard op het apparaat (later per profiel). */
@OptIn(UnstableApi::class)
object SubStyle {
    val sizes = listOf("Klein" to 0.045f, "Normaal" to 0.055f, "Groot" to 0.068f, "Extra groot" to 0.082f)
    val backs = listOf("Rand", "Zwarte balk", "Geel met rand")
    val places = listOf("Laag" to 0.04f, "Normaal" to 0.08f, "Hoger" to 0.15f)

    private fun sp(c: Context) = c.getSharedPreferences("subs", Context.MODE_PRIVATE)
    fun size(c: Context) = sp(c).getInt("size", 1).coerceIn(0, sizes.size - 1)
    fun back(c: Context) = sp(c).getInt("back", 0).coerceIn(0, backs.size - 1)
    fun place(c: Context) = sp(c).getInt("place", 1).coerceIn(0, places.size - 1)
    fun cycle(c: Context, key: String, n: Int) { sp(c).edit().putInt(key, (sp(c).getInt(key, if (key == "back") 0 else 1) + 1) % n).apply() }

    fun summary(c: Context) = "${sizes[size(c)].first} · ${backs[back(c)].lowercase()} · ${places[place(c)].first.lowercase()}"

    /** Toepassen; osd = infobalk in beeld, dan schuiven ze erboven. */
    fun apply(c: Context, v: SubtitleView?, osd: Boolean) {
        v ?: return
        val style = when (back(c)) {
            1 -> CaptionStyleCompat(Color.WHITE, 0xB3000000.toInt(), Color.TRANSPARENT, CaptionStyleCompat.EDGE_TYPE_NONE, Color.BLACK, Typeface.DEFAULT_BOLD)
            2 -> CaptionStyleCompat(0xFFFFE14D.toInt(), Color.TRANSPARENT, Color.TRANSPARENT, CaptionStyleCompat.EDGE_TYPE_OUTLINE, Color.BLACK, Typeface.DEFAULT_BOLD)
            else -> CaptionStyleCompat(Color.WHITE, Color.TRANSPARENT, Color.TRANSPARENT, CaptionStyleCompat.EDGE_TYPE_OUTLINE, Color.BLACK, Typeface.DEFAULT_BOLD)
        }
        v.setApplyEmbeddedStyles(false)
        v.setApplyEmbeddedFontSizes(false)
        v.setStyle(style)
        v.setFractionalTextSize(sizes[size(c)].second)
        v.setBottomPaddingFraction(places[place(c)].second + if (osd) 0.16f else 0f)
    }
}
