# ساخت APK

## GitHub Actions

1. فایل‌های این پروژه را push کن (حتماً شامل `.github/workflows/main.yml`).
2. برو **Actions** → workflow **Build Anbarin APK**.
3. اگر خودکار اجرا نشد: **Run workflow**.
4. بعد از موفقیت، **Artifacts** → `anbarin-debug-apk` را دانلود کن.

## اگر fail شد

- در Actions روی run قرمز کلیک کن و **لاگ مرحله قرمز** را باز کن.
- خطاهای رایج:
  - `npm install` → registry / network
  - `tsc` → خطای TypeScript
  - `cap add android` → Capacitor در package.json نباشد
  - `gradlew` → SDK / license

## محلی

```bash
npm install
npm run build
npx cap add android
npx cap sync android
cd android && ./gradlew assembleDebug
```

APK: `android/app/build/outputs/apk/debug/app-debug.apk`
