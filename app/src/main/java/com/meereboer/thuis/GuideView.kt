package com.meereboer.thuis

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.text.TextPaint
import android.text.TextUtils
import android.view.View
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Programmagids als raster, getekend op één canvas (snel en simpel met de afstandsbediening).
 * Bovenaan details van het geselecteerde programma, links de zenders, rechts een tijdlijn.
 * De ruimte rechtsboven blijft vrij voor het doorlopende beeld (previewRect).
 */
class GuideView(context: Context) : View(context) {
    var channels: List<Channel> = emptyList()
    var epg: Map<Int, List<Programme>> = emptyMap()
    var loading = true
    var title = "Gids"

    var row = 0
        private set
    private var prog = 0
    private var focusTime = System.currentTimeMillis()
    private var winStart = 0L
    private val winSpan = 150 * 60_000L
    private var topRow = 0

    private val clock = SimpleDateFormat("HH:mm", Locale("nl", "NL"))
    private val bg = Paint().apply { color = 0xF20A0D12.toInt() }
    private val block = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF1B212B.toInt() }
    private val blockNow = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF232C3A.toInt() }
    private val blockFocus = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val rowFocus = Paint().apply { color = 0x1FFFFFFF }
    private val nowLine = Paint().apply { color = 0xFFFF4B4B.toInt(); strokeWidth = 4f }
    private val txt = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val dim = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xB3FFFFFF.toInt() }

    /** Waar het lopende beeld komt (rechtsboven), in pixels van deze view. */
    fun previewRect(w: Int, h: Int): RectF {
        val pw = w * 0.30f
        val ph = pw * 9f / 16f
        return RectF(w - pw - w * 0.04f, h * 0.05f, w - w * 0.04f, h * 0.05f + ph)
    }

    fun start(index: Int) {
        row = index.coerceIn(0, (channels.size - 1).coerceAtLeast(0))
        focusTime = System.currentTimeMillis()
        winStart = focusTime - (focusTime % (30 * 60_000L))
        topRow = (row - 2).coerceAtLeast(0)
        prog = 0
        snapProg()
        invalidate()
    }

    private fun progs(r: Int): List<Programme> = channels.getOrNull(r)?.let { epg[it.id] } ?: emptyList()

    /** Kies in de huidige rij het programma dat op focusTime loopt (of het eerste daarna). */
    private fun snapProg() {
        val list = progs(row)
        if (list.isEmpty()) { prog = 0; return }
        val i = list.indexOfFirst { it.end > focusTime }
        prog = if (i < 0) list.size - 1 else i
    }

    fun selectedProgramme(): Programme? = progs(row).getOrNull(prog)

    fun move(dRow: Int, dProg: Int) {
        if (channels.isEmpty()) return
        if (dRow != 0) {
            row = ((row + dRow) % channels.size + channels.size) % channels.size
            snapProg()
        }
        if (dProg != 0) {
            val list = progs(row)
            if (list.isNotEmpty()) {
                prog = (prog + dProg).coerceIn(0, list.size - 1)
                val p = list[prog]
                focusTime = p.start + 1
                if (p.start >= winStart + winSpan - 30 * 60_000L) winStart = p.start - 30 * 60_000L
                if (p.start < winStart) winStart = p.start - (p.start % (30 * 60_000L))
                focusTime = p.start + 1
            }
        }
        invalidate()
    }

    override fun onDraw(c: Canvas) {
        val w = width.toFloat()
        val h = height.toFloat()
        c.drawRect(0f, 0f, w, h, bg)
        val pad = w * 0.05f
        val preview = previewRect(width, height)

        // Kop: details van het geselecteerde programma
        val ch = channels.getOrNull(row)
        val p = selectedProgramme()
        dim.textSize = h * 0.026f
        dim.typeface = Typeface.DEFAULT_BOLD
        c.drawText(("$title  ·  " + (ch?.let { "${it.num}  ${it.name}" } ?: "")).uppercase(), pad, h * 0.08f, dim)
        txt.textSize = h * 0.058f
        txt.typeface = Typeface.DEFAULT_BOLD
        val maxW = preview.left - pad - w * 0.03f
        val head = when {
            loading -> "Gids laden…"
            p != null -> p.title
            else -> ch?.name ?: ""
        }
        c.drawText(TextUtils.ellipsize(head, txt, maxW, TextUtils.TruncateAt.END).toString(), pad, h * 0.16f, txt)
        dim.typeface = Typeface.DEFAULT
        dim.textSize = h * 0.028f
        if (p != null && p.start > 0) {
            val nowMs = System.currentTimeMillis()
            val live = when {
                nowMs in p.start until p.end -> "  ·  NU" + (if (p.archive) "  ·  OK = kijken, of vanaf begin via ◄" else "")
                p.start < nowMs && p.archive -> "  ·  TERUGKIJKEN"
                p.start < nowMs -> "  ·  geweest, niet terug te kijken"
                else -> ""
            }
            c.drawText("${clock.format(Date(p.start))} tot ${clock.format(Date(p.end))}$live", pad, h * 0.215f, dim)
        }
        if (p != null && p.desc.isNotBlank()) {
            drawWrapped(c, p.desc, pad, h * 0.265f, maxW, 2, dim)
        }

        // Tijdlijn
        val gridTop = h * 0.40f
        val nameW = w * 0.18f
        val gx = pad + nameW
        val gw = w - pad - gx
        val rowH = h * 0.078f
        dim.textSize = h * 0.024f
        var t = winStart
        while (t <= winStart + winSpan) {
            val x = gx + (t - winStart).toFloat() / winSpan * gw
            c.drawText(clock.format(Date(t)), x + 6f, gridTop - h * 0.015f, dim)
            t += 30 * 60_000L
        }

        // Rijen
        val visible = ((h - gridTop) / rowH).toInt().coerceAtLeast(1)
        if (row < topRow) topRow = row
        if (row >= topRow + visible) topRow = row - visible + 1
        txt.textSize = h * 0.027f
        for (i in 0 until visible) {
            val r = topRow + i
            val chan = channels.getOrNull(r) ?: break
            val y = gridTop + i * rowH
            if (r == row) c.drawRect(pad - 10f, y, w - pad + 10f, y + rowH, rowFocus)
            txt.typeface = if (r == row) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
            val label = "${chan.num}  ${chan.name}"
            c.drawText(TextUtils.ellipsize(label, txt, nameW - 20f, TextUtils.TruncateAt.END).toString(), pad, y + rowH * 0.62f, txt)
            val list = progs(r)
            if (list.isEmpty()) {
                dim.textSize = h * 0.024f
                c.drawText(if (loading) "…" else "Geen gids", gx + 12f, y + rowH * 0.62f, dim)
            }
            for ((k, pr) in list.withIndex()) {
                if (pr.end <= winStart || pr.start >= winStart + winSpan) continue
                val x1 = gx + ((maxOf(pr.start, winStart) - winStart).toFloat() / winSpan * gw)
                val x2 = gx + ((minOf(pr.end, winStart + winSpan) - winStart).toFloat() / winSpan * gw)
                val rect = RectF(x1 + 3f, y + 5f, x2 - 3f, y + rowH - 5f)
                val focused = r == row && k == prog
                val now = System.currentTimeMillis() in pr.start until pr.end
                c.drawRoundRect(rect, 10f, 10f, if (focused) blockFocus else if (now) blockNow else block)
                val tp = if (focused) TextPaint(txt).apply { color = 0xFF05070A.toInt() } else txt
                tp.textSize = h * 0.025f
                val avail = rect.width() - 24f
                if (avail > 30f) {
                    val label = if (pr.archive && pr.end <= System.currentTimeMillis()) "↺ " + pr.title else pr.title
                    c.drawText(TextUtils.ellipsize(label, tp, avail, TextUtils.TruncateAt.END).toString(), rect.left + 12f, y + rowH * 0.62f, tp)
                }
            }
        }

        // Nu-lijn
        val now = System.currentTimeMillis()
        if (now in winStart..(winStart + winSpan)) {
            val x = gx + (now - winStart).toFloat() / winSpan * gw
            c.drawLine(x, gridTop - h * 0.01f, x, h, nowLine)
        }

        // Hint onderaan
        dim.textSize = h * 0.022f
        c.drawText("▲▼ zender   ◄► programma (ook terug in de tijd)   OK kijken   ↺ = terugkijken   Terug sluiten", pad, h - h * 0.025f, dim)
    }

    private fun drawWrapped(c: Canvas, text: String, x: Float, y: Float, maxW: Float, lines: Int, paint: TextPaint) {
        var rest = text.trim()
        var yy = y
        for (i in 0 until lines) {
            if (rest.isEmpty()) break
            var n = paint.breakText(rest, true, maxW, null)
            if (n < rest.length) {
                val sp = rest.lastIndexOf(' ', n)
                if (sp > 0) n = sp
            }
            var line = rest.substring(0, n).trim()
            rest = rest.substring(n).trim()
            if (i == lines - 1 && rest.isNotEmpty()) line = TextUtils.ellipsize("$line $rest", paint, maxW, TextUtils.TruncateAt.END).toString()
            c.drawText(line, x, yy, paint)
            yy += paint.textSize * 1.35f
        }
    }
}
