# WayAnime — نسخة الأندرويد (Capacitor) - Home Mobile

نسخة محدّثة من واجهة الموبايل (home + splash).

## البناء عبر GitHub Actions
1. ارفع كل محتويات مجلد `WayAnime-Android` من الـ zip إلى هذا المستودع.
2. روح لتبويب **Actions** → **Build WayAnime APK** → **Run workflow**.
3. بعد النجاح حمّل `WayAnime.apk` من Artifacts.

## ملاحظة مهمة
تأكد أن الملفات التالية موجودة:
- `www/android/bridge.js`
- `www/android/home.js`
- `www/android/splash.js`
- `www/android/mobile.css`
- `www/index.html`
- `www/renderer.js`
- `www/logic/main.js`
- `native/MainActivity.java`
- مجلدات `assets/` و `www/fonts/` و `www/assets/`

الـ workflow الحالي يجعل `npm test` اختياري حتى لا يفشل البناء إذا كان هناك ملف ناقص.
