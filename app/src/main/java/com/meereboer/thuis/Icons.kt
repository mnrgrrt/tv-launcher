package com.meereboer.thuis

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import androidx.core.graphics.PathParser

/** Pictogrammen zonder plaatjes in de app: Material-vormen (24x24) en zelf getekende spoelknoppen. */
object Icons {
    const val PLAY = "M8 5.5v13l10.5-6.5z"
    const val PAUSE = "M7 5h3.2v14H7zM13.8 5H17v14h-3.2z"
    const val SUBS = "M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z"
    const val AUDIO = "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"
    const val MORE = "M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"

    /** Een pictogram dat van kleur kan wisselen (wit, of donker op een witte knop). */
    abstract class Tinted : Drawable() {
        protected val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
        var color: Int
            get() = paint.color
            set(v) { paint.color = v; invalidateSelf() }
        override fun setAlpha(a: Int) { paint.alpha = a }
        override fun setColorFilter(cf: ColorFilter?) { paint.colorFilter = cf }
        @Deprecated("Deprecated in Java") override fun getOpacity() = PixelFormat.TRANSLUCENT
    }

    class Shape(data: String) : Tinted() {
        private val src: Path = PathParser.createPathFromPathData(data)
        private val path = Path()
        private val m = Matrix()
        override fun draw(c: Canvas) {
            m.setRectToRect(RectF(0f, 0f, 24f, 24f), RectF(bounds), Matrix.ScaleToFit.CENTER)
            src.transform(m, path); c.drawPath(path, paint)
        }
    }

    /** Spoelknop: open cirkel met pijlpunt en het aantal seconden netjes in het midden. */
    class Skip(private val ctx: Context, private val seconds: Int, private val forward: Boolean) : Tinted() {
        private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER }
        override fun draw(c: Canvas) {
            val b = bounds; val s = minOf(b.width(), b.height()).toFloat()
            val cx = b.exactCenterX(); val cy = b.exactCenterY(); val r = s * 0.40f; val w = s * 0.075f
            paint.style = Paint.Style.STROKE; paint.strokeWidth = w; paint.strokeCap = Paint.Cap.ROUND
            val oval = RectF(cx - r, cy - r, cx + r, cy + r)
            // Opening bovenin. De boog eindigt links (vooruit) of rechts (terug) van de opening; daar zit de pijlpunt.
            if (forward) c.drawArc(oval, -60f, 300f, false, paint) else c.drawArc(oval, -120f, -300f, false, paint)
            paint.style = Paint.Style.FILL
            val ax = cx - (if (forward) 1 else -1) * r * Math.cos(Math.toRadians(60.0)).toFloat()
            val ay = cy - r * Math.sin(Math.toRadians(60.0)).toFloat()
            val d = s * 0.13f; val dir = if (forward) 1 else -1
            val head = Path().apply { moveTo(ax + dir * d, ay); lineTo(ax - dir * d * 0.4f, ay - d); lineTo(ax - dir * d * 0.4f, ay + d); close() }
            c.drawPath(head, paint)
            text.color = paint.color; text.typeface = Fonts.semibold(ctx); text.textSize = s * 0.30f
            val fm = text.fontMetrics
            c.drawText(seconds.toString(), cx, cy - (fm.ascent + fm.descent) / 2f, text)
        }
    }

    /** Ronde knop. Zonder focus alleen het pictogram; met focus een witte cirkel en een donker pictogram. Alle knoppen even groot. */
    class Button(ctx: Context, private var icon: Tinted, sizeDp: Int) : FrameLayout(ctx) {
        private val bgc = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(0) }
        private val iv = ImageView(ctx).apply { setImageDrawable(icon) }
        init {
            val d = dp(ctx, sizeDp); background = bgc
            val pad = (d * 0.26f).toInt()
            addView(iv, LayoutParams(d - pad * 2, d - pad * 2, Gravity.CENTER))
            layoutParams = LayoutParams(d, d)
        }
        private var on = false
        fun setIcon(t: Tinted) { t.color = icon.color; icon = t; iv.setImageDrawable(t) }
        fun lit(v: Boolean) {
            if (v == on) return
            on = v
            bgc.setColor(if (v) Color.WHITE else 0)
            icon.color = if (v) 0xFF111113.toInt() else Color.WHITE
            animate().scaleX(if (v) 1.08f else 1f).scaleY(if (v) 1.08f else 1f).setDuration(160).start()
        }
    }

    fun dp(c: Context, v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), c.resources.displayMetrics).toInt()
}

/** Dunne voortgangsbalk; met focus iets dikker, met een bolletje. */
class Scrub(ctx: Context) : View(ctx) {
    var progress = 0f; set(v) { field = v; invalidate() }
    var buffered = 0f; set(v) { field = v; invalidate() }
    var lit = false; set(v) { field = v; invalidate() }
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    override fun onDraw(c: Canvas) {
        val h = Icons.dp(context, if (lit) 6 else 4).toFloat()
        val cy = height / 2f; val r = h / 2; val w = width.toFloat()
        p.color = 0x33FFFFFF; c.drawRoundRect(0f, cy - r, w, cy + r, r, r, p)
        p.color = 0x4DFFFFFF; c.drawRoundRect(0f, cy - r, w * buffered, cy + r, r, r, p)
        p.color = Color.WHITE; c.drawRoundRect(0f, cy - r, (w * progress).coerceAtLeast(h), cy + r, r, r, p)
        if (lit) c.drawCircle(w * progress, cy, Icons.dp(context, 8).toFloat(), p)
    }
}
