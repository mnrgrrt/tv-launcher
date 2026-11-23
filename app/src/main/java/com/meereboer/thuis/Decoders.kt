package com.meereboer.thuis

import androidx.annotation.OptIn
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector

/**
 * Dolby Vision zonder eigen decoder (zoals op de JBL en de Formuler): speel dan de HDR10/HEVC-basislaag af
 * met de gewone HEVC-decoder. Zo krijg je bij 4K-remuxes met Dolby Vision profiel 7 toch beeld.
 */
@OptIn(UnstableApi::class)
object Decoders {
    val selector = MediaCodecSelector { mime, secure, tunneling ->
        val list = MediaCodecSelector.DEFAULT.getDecoderInfos(mime, secure, tunneling)
        if (list.isEmpty() && mime == MimeTypes.VIDEO_DOLBY_VISION)
            MediaCodecSelector.DEFAULT.getDecoderInfos(MimeTypes.VIDEO_H265, secure, tunneling)
        else list
    }
}
