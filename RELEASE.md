# انتشار حرفه‌ای (Release)

## ۱) keystore (یک‌بار)

```bash
keytool -genkey -v -keystore anbarin-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias anbarin
```

فایل `anbarin-release.jks` را **هرگز** داخل git نگذار.

## ۲) `android/key.properties` (محلی، gitignore)

```
storePassword=***
keyPassword=***
keyAlias=anbarin
storeFile=/absolute/path/anbarin-release.jks
```

## ۳) امضا در `android/app/build.gradle`

داخل بلوک `android { ... }`:

```gradle
def keystorePropertiesFile = rootProject.file("key.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

signingConfigs {
    release {
        if (keystorePropertiesFile.exists()) {
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
            storeFile file(keystoreProperties['storeFile'])
            storePassword keystoreProperties['storePassword']
        }
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.release
        minifyEnabled false
    }
}
```

## ۴) بیلد

```bash
npm ci
npm run build
npx cap sync android
cd android && ./gradlew assembleRelease
```

APK: `android/app/build/outputs/apk/release/app-release.apk`

## هشدار «غیر امن»
روی نصب دستی (خارج از Play) اندروید همیشه ممکن است هشدار بدهد. برای حذف کامل:
- انتشار در Google Play، یا
- نصب enterprise با MDM

Debug APK همیشه «غیر رسمی» شناخته می‌شود — برای مشتری فقط Release بدهید.
