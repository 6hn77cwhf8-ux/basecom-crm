plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Versão da app: igual ao CRM para ser fácil de comparar (VERSION_NAME/VERSION_CODE vêm do GitHub Actions).
val appVersionName = System.getenv("VERSION_NAME") ?: "0.8.0"
val appVersionCode = (System.getenv("VERSION_CODE") ?: "1").toInt()

android {
    namespace = "pt.basecom.crm"
    compileSdk = 35
    defaultConfig {
        applicationId = "pt.basecom.crm"
        minSdk = 29
        targetSdk = 34
        versionCode = appVersionCode
        versionName = appVersionName
    }
    signingConfigs {
        // Chave própria (segredo do GitHub) quando existir; senão, a chave de teste guardada entre compilações.
        create("basecom") {
            val ks = System.getenv("ANDROID_KEYSTORE_FILE")
            if (ks != null && file(ks).exists()) {
                storeFile = file(ks)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS") ?: "basecom"
                keyPassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
            } else {
                storeFile = file(System.getProperty("user.home") + "/.android/debug.keystore")
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("basecom")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
