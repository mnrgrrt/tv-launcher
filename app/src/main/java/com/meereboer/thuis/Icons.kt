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
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import androidx.core.graphics.PathParser

/** Pictogrammen (Material-vormen, 24x24) zonder plaatjes in de app. */
object Icons {
    const val PLAY = "M8 5v14l11-7z"
    const val PAUSE = "M6 19h4V5H6v14zm8-14v14h4V5h-4z"
    const val BACK = "M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"
    const val FWD = "M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"
    const val SUBS = "M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z"
    const val AUDIO = "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"
    const val MORE = "M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"

    class Shape(data: String) : Drawable() {
        private val src: Path = PathParser.createPathFromPathData(data)
        private val path = Path()
        private val m = Matrix()
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; style = Paint.Style.FILL }
        var color: Int
            get() = paint.color
            set(v) { paint.color = v; invalidateSelf() }
        override fun draw(c: Canvas) {
            val b = bounds; m.setRectToRect(RectF(0f, 0f, 24f, 24f), RectF(b), Matrix.ScaleToFit.CENTER)
            src.transform(m, path); c.drawPath(path, paint)
        }
        override fun setAlpha(a: Int) { paint.alpha = a }
        override fun setColorFilter(cf: ColorFilter?) { paint.colorFilter = cf }
        @Deprecated("Deprecated in Java") override fun getOpacity() = PixelFormat.TRANSLUCENT
    }

    /** Ronde knop met pictogram en eventueel een klein getal erin (10, 30). Focus = witte cirkel, donker pictogram. */
    class Button(ctx: Context, data: String, sizeDp: Int, label: String = "") : FrameLayout(ctx) {
        val icon = Shape(data)
        private val bgc = android.graphics.drawable.GradientDrawable().apply { shape = android.graphics.drawable.GradientDrawable.OVAL; setColor(0) }
        private val iv = ImageView(ctx).apply { setImageDrawable(icon) }
        private val tv = TextView(ctx).apply { text = label; textSize = 10f; setTextColor(Color.WHITE); typeface = android.graphics.Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER }
        init {
            val d = Icons.dp(ctx, sizeDp); background = bgc
            val pad = d / 4
            addView(iv, LayoutParams(d - pad * 2, d - pad * 2, Gravity.CENTER))
            if (label.isNotEmpty()) addView(tv, LayoutParams(-2, -2, Gravity.CENTER).apply { topMargin = d / 14 })
            layoutParams = LayoutParams(d, d)
        }
        fun setIcon(data: String) { val c = (iv.drawable as? Shape)?.color ?: Color.WHITE; iv.setImageDrawable(Shape(data).also { it.color = c }) }
        fun lit(on: Boolean) {
            bgc.setColor(if (on) Color.WHITE else 0)
            val c = if (on) 0xFF111111.toInt() else Color.WHITE
            (iv.drawable as? Shape)?.color = c; tv.setTextColor(c)
            animate().scaleX(if (on) 1.12f else 1f).scaleY(if (on) 1.12f else 1f).setDuration(180).start()
        }
    }

    fun dp(c: Context, v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), c.resources.displayMetrics).toInt()
}

/** Dunne voortgangsbalk; met focus wordt hij dikker en krijgt hij een bolletje. */
class Scrub(ctx: Context) : View(ctx) {
    var progress = 0f; set(v) { field = v; invalidate() }
    var buffered = 0f; set(v) { field = v; invalidate() }
    var lit = false; set(v) { field = v; invalidate() }
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    override fun onDraw(c: Canvas) {
        val h = if (lit) Icons.dp(context, 8).toFloat() else Icons.dp(context, 4).toFloat()
        val cy = height / 2f; val r = h / 2; val w = width.toFloat()
        p.color = 0x40FFFFFF; c.drawRoundRect(0f, cy - r, w, cy + r, r, r, p)
        p.color = 0x55FFFFFF; c.drawRoundRect(0f, cy - r, w * buffered, cy + r, r, r, p)
        p.color = Color.WHITE; c.drawRoundRect(0f, cy - r, (w * progress).coerceAtLeast(h), cy + r, r, r, p)
        if (lit) c.drawCircle(w * progress, cy, Icons.dp(context, 11).toFloat(), p)
    }
}
