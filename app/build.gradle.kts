plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val runNumber = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
// Zichtbaar versienummer: "1.00", "1.01", ... Het interne nummer (versionCode) loopt altijd door,
// anders weigert Android de update. versie.txt: "<hoofdversie> <runnummer van x.00>".
val versie = file("versie.txt").readText().trim().split(Regex("\\s+"))
val major = versie[0].toInt()
val base = versie.getOrElse(1) { "0" }.toInt()
val branch = System.getenv("GITHUB_REF_NAME") ?: "lokaal"
val shownVersion = if (branch == "main") "%d.%02d".format(major, maxOf(0, runNumber - base))
    else "%d.00-test.%d".format(major, runNumber)

android {
    namespace = "com.meereboer.thuis"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.meereboer.thuis"
        minSdk = 24
        targetSdk = 34
        versionCode = runNumber
        versionName = shownVersion
    }

    signingConfigs {
        create("release") {
            val ks = System.getenv("KEYSTORE_FILE")
            if (ks != null) {
                storeFile = file(ks)
                storePassword = System.getenv("KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KEY_ALIAS")
                keyPassword = System.getenv("KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (System.getenv("KEYSTORE_FILE") != null)
                signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    // Het startscherm (HTML) is gedeeld tussen alle platforms en staat in /shared/web.
    sourceSets["main"].assets.srcDirs("../shared")

    compileOptions {
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.0.4")
    val media3 = "1.3.1"
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-exoplayer-hls:$media3")
    implementation("androidx.media3:media3-ui:$media3")
    // FFmpeg-geluid voor AC3, E-AC3 en MP2 (veel NL-zenders); gebouwd door het Jellyfin-project
    implementation("org.jellyfin.media3:media3-ffmpeg-decoder:$media3+2")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.core:core:1.13.1")
    implementation("androidx.annotation:annotation:1.8.2")
    implementation("androidx.annotation:annotation-experimental:1.4.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
