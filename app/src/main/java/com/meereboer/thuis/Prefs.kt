package com.meereboer.thuis

import android.content.Context

/** Wat het apparaat zelf onthoudt. Geen wachtwoorden of sleutels: die staan op tv-serverr. */
class Prefs(ctx: Context) {
    private val sp = ctx.getSharedPreferences("thuis", Context.MODE_PRIVATE)

    var lastChannel: Int
        get() = sp.getInt("lastChannel", -1)
        set(v) = sp.edit().putInt("lastChannel", v).apply()

    /** Oude versies bewaarden hier wachtwoorden en tokens (Dispatcharr, Plex, TMDB, ...). Die gaan weg. */
    fun wipeOldSecrets() {
        val old = listOf("server", "user", "pass", "format", "categories", "tmdbToken", "jblWebhook", "plexUrl", "plexToken",
            "jellyfinUrl", "jellyfinKey", "osKey", "osUser", "osPass", "radarrUrl", "radarrKey", "sonarrUrl", "sonarrKey", "brugUrl", "jblListUrl")
        if (old.any { sp.contains(it) }) sp.edit().apply { old.forEach { remove(it) } }.apply()
    }
}
