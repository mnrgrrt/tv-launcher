package com.meereboer.thuis

data class Channel(
    val id: Int,
    val num: Int,
    val name: String,
    val icon: String,
    val categoryId: String,
    /** Dagen terugkijken die de aanbieder voor deze zender bewaart (0 = geen). */
    val archiveDays: Int = 0
)

data class Programme(val title: String, val desc: String, val start: Long, val end: Long, val archive: Boolean = false)
