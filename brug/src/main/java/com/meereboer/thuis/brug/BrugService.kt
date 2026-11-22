package com.meereboer.thuis.brug

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.IBinder
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.util.concurrent.Executors

/**
 * Kleine webserver op de JBL (poort 8765) die de Android TV-lijst "Watch Next" deelt met Thuis.
 *   GET /ping            -> ok
 *   GET /watchnext       -> lijst met wat je aan het kijken bent (Netflix, Prime, ...)
 *   GET /img?u=...       -> plaatje uit die lijst (alleen adressen die in de lijst staan)
 *   GET /open?id=...     -> opent dat programma op de JBL
 * Alleen bereikbaar vanaf het thuisnetwerk (privé-adressen).
 */
class BrugService : Service() {
    private val pool = Executors.newFixedThreadPool(4)
    @Volatile private var server: ServerSocket? = null
    @Volatile private var allowedImages: Set<String> = emptySet()
    @Volatile private var intents: Map<Long, String> = emptyMap()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(1, notification())
        if (server == null) Thread { serve() }.start()
        return START_STICKY
    }

    private fun notification(): Notification {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        return if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(NotificationChannel("brug", "Thuis-brug", NotificationManager.IMPORTANCE_MIN))
            Notification.Builder(this, "brug").setContentTitle("Thuis-brug actief").setSmallIcon(android.R.drawable.ic_menu_share).build()
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this).setContentTitle("Thuis-brug actief").setSmallIcon(android.R.drawable.ic_menu_share).build()
        }
    }

    private fun serve() {
        try {
            val s = ServerSocket(8765)
            server = s
            while (true) {
                val c = s.accept()
                pool.execute { handle(c) }
            }
        } catch (_: Exception) {
            server = null
        }
    }

    private fun isPrivate(a: InetAddress) = a.isSiteLocalAddress || a.isLoopbackAddress || a.isLinkLocalAddress

    private fun handle(c: Socket) {
        c.use { sock ->
            try {
                sock.soTimeout = 8000
                val inp = BufferedReader(InputStreamReader(sock.getInputStream()))
                val line = inp.readLine() ?: return
                while (true) { val h = inp.readLine() ?: break; if (h.isEmpty()) break }
                val out = sock.getOutputStream()
                if (!isPrivate(sock.inetAddress)) return send(out, 403, "text/plain", "geen toegang".toByteArray())
                val parts = line.split(" ")
                val target = parts.getOrNull(1) ?: "/"
                val path = target.substringBefore("?")
                val q = target.substringAfter("?", "").split("&").filter { it.contains("=") }
                    .associate { it.substringBefore("=") to URLDecoder.decode(it.substringAfter("="), "UTF-8") }
                when (path) {
                    "/ping" -> send(out, 200, "text/plain", "ok".toByteArray())
                    "/watchnext" -> send(out, 200, "application/json", watchNext().toString().toByteArray())
                    "/img" -> image(out, q["u"].orEmpty())
                    "/open" -> {
                        val ok = open(q["id"]?.toLongOrNull() ?: -1)
                        send(out, if (ok) 200 else 404, "text/plain", (if (ok) "ok" else "niet gevonden").toByteArray())
                    }
                    else -> send(out, 404, "text/plain", "onbekend".toByteArray())
                }
            } catch (_: Exception) { }
        }
    }

    private fun send(out: OutputStream, code: Int, type: String, body: ByteArray) {
        val head = "HTTP/1.1 $code OK\r\nContent-Type: $type\r\nContent-Length: ${body.size}\r\n" +
            "Access-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
        out.write(head.toByteArray()); out.write(body); out.flush()
    }

    private fun watchNext(): JSONArray {
        val arr = JSONArray()
        val imgs = HashSet<String>()
        val ints = HashMap<Long, String>()
        val cur = contentResolver.query(Uri.parse("content://android.media.tv/watch_next_program"), null, null, null,
            "last_engagement_time_utc_millis DESC") ?: return arr
        cur.use { c ->
            fun str(n: String) = c.getColumnIndex(n).let { if (it >= 0) c.getString(it) ?: "" else "" }
            fun lng(n: String) = c.getColumnIndex(n).let { if (it >= 0) c.getLong(it) else 0L }
            while (c.moveToNext() && arr.length() < 30) {
                val id = lng("_id")
                val poster = str("poster_art_uri")
                val thumb = str("thumbnail_uri")
                listOf(poster, thumb).filter { it.isNotEmpty() }.forEach { imgs.add(it) }
                ints[id] = str("intent_uri")
                arr.put(JSONObject()
                    .put("id", id)
                    .put("package", str("package_name"))
                    .put("title", str("title"))
                    .put("episode", str("episode_title"))
                    .put("season", str("season_display_number"))
                    .put("number", str("episode_display_number"))
                    .put("description", str("short_description"))
                    .put("poster", poster)
                    .put("thumb", thumb)
                    .put("position", lng("last_playback_position_millis"))
                    .put("duration", lng("duration_millis"))
                    .put("type", lng("watch_next_type"))
                    .put("when", lng("last_engagement_time_utc_millis")))
            }
        }
        allowedImages = imgs
        intents = ints
        return arr
    }

    private fun image(out: OutputStream, u: String) {
        if (u !in allowedImages) watchNext()
        if (u !in allowedImages) return send(out, 404, "text/plain", "onbekend".toByteArray())
        val bytes = contentResolver.openInputStream(Uri.parse(u))?.use { it.readBytes() }
            ?: return send(out, 404, "text/plain", "leeg".toByteArray())
        send(out, 200, "image/jpeg", bytes)
    }

    private fun open(id: Long): Boolean {
        if (id !in intents) watchNext()
        val uri = intents[id] ?: return false
        if (uri.isEmpty()) return false
        val i = Intent.parseUri(uri, Intent.URI_INTENT_SCHEME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        i.selector = null
        i.component?.let { /* toegestaan: de app zelf heeft deze link opgegeven */ }
        startActivity(i)
        return true
    }
}
