# Davom etish uchun yozuv (2026-10-03)

## Holat
- **Tayyor va commit qilingan:** dars rejimi (server, talaba web, Android, iOS L0), do'kon hujjatlari, ustoz paneli web (1–4-bosqichlar, `docs/TEACHER-PLAN.md`).
- **Navbatdagi:** 5-bosqich Android «EduFocus O'qituvchi» (`com.edufocus.teacher`, WebView `/teacher/`, biometrik kirish, FCM push + actionable, doimiy bildirishnoma, oflayn navbat — web qatlamida `act()`/`flushQueue()` tayyor), 6-bosqich iOS (Face ID, APNs, Live Activity), 7-bosqich `docs/store/teacher/`, `docs/TEACHER-APP.md`.
- Web tomonda mobil ilova uchun kutilayotgan hook: `window.EFTeacherNative` (`biometricReady()`, `biometricLogin()`, `saveRefresh(token)`, `clear()`) — `public/teacher/js/screens/auth.js`, `more.js`.

## Ishga tushirish
```
node server.js                       # lokal; demo ustoz teacher@edufocus.uz / 123456 (admin)
ATTESTATION_MODE=off node server.js  # haqiqiy telefon bilan sinash (mock rejimi haqiqiy tokenni rad etadi)
```
Ustoz paneli: `/teacher/`. Eski panel: `/dashboard-legacy.html`. Dars rejimi sahifasi: `/lock.html`.

## Testlar
```
node --test tests/server/lock.test.mjs tests/server/lock2.test.mjs tests/server/lock-prod.test.mjs tests/server/lock-offline.test.mjs tests/server/units.test.mjs tests/server/teacher.test.mjs   # 40 ta
node tests/teacher-web.mjs [phone|desktop]   # asosiy oqim + bosish/soniya o'lchovi + skrinshotlar (docs/screens/teacher)
node tests/teacher-a11y.mjs                  # kontrast (axe)
node tests/teacher-admin.mjs  node tests/teacher-i18n-check.mjs  node tests/i18n-check.mjs
node tests/e2e-lock.mjs android|ios   node tests/lock-panel.mjs   node tests/dashboard-smoke.mjs
```

## Ochiq masalalar / qarorlar
- HEMIS CSV formati taxminiy (rasmiy namuna kerak). Telefon bilan kirish (SMS) yo'q.
- Access token 12 soat (`ACCESS_TOKEN_TTL`), refresh 30 kun.
- Android debug build: LAN IP orqali HTTP (`edufocus-LAN-test.apk`, IP o'zgarsa qayta yig'ish: `./gradlew assembleDirectDebug -PserverUrl=http://<IP>:3000`, JAVA_HOME = Android Studio JBR).
- Production serverda hali eski kod turibdi (talaba ilovasi dizayni shu sababli boshqacha ko'rinadi) — deploy kerak.
- Foydalanuvchining tugallanmagan fayllari (`public/app.html`, `public/login.html`) commitga kiritilmagan, tegmang.
