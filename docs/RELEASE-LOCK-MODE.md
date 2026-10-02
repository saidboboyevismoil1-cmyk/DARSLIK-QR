# Dars rejimi va do'kon tayyorgarligi — yakuniy hisobot

Sana: 2026-10-03 · versiya 5.0.0 · branch `main` (har bosqich alohida commit; `git log --oneline`).

## 1. Nima qilindi
| Qism | Holat |
|---|---|
| **Server** (Node/Express/Socket.io): himoya darajalari, qo'shilishda tekshiruv, heartbeat 10 s / offline 30 s / avto-ochilish 15 daqiqa, qoida mexanizmi va ball (30/50/20, sozlanadi), CSV guruh + bir martalik qurilma bog'lash, istisno so'rovlari, favqulodda chiqish, DEMO dars (`123456`), saqlash muddati (anonimlashtirish), ma'lumot o'chirish API, shaxssiz statistika, SQLite (`node:sqlite`) migratsiyalar bilan | ✅ tayyor, 29 ta test o'tadi |
| **Talaba ilovasi** (web, uz/ru/en): rozilik, tayyorlik testi, himoyani yoqish, dars ekrani, test, materiallar, SOS, favqulodda chiqish, himoyasiz kirish so'rovi, ma'lumotni o'chirish | ✅ |
| **Android** (store + direct flavor): ekran mahkamlash + DND (+ direct: Accessibility), native QR skaner, Keystore qurilma kaliti, Play Integrity klienti, o'lik odam taymeri, SOS, R8, 16 KB, targetSdk 36 | ✅ emulyatorda sinalgan |
| **iOS**: native ko'prik (L0 faol), App Attest klienti, Keychain kaliti, AVFoundation QR skaner, L1 (AEAssessmentSession) va L2 (FamilyControls + ShieldConfiguration + DeviceActivityMonitor) **kodi yozilgan, bayroq ostida o'chiq**, PrivacyInfo.xcprivacy, XcodeGen loyiha (`project.yml`, `project-l2.yml`) | ✅ kompilyatsiya + simulyator ko'prik testi; L1/L2 ishlashi **sinalmagan** (entitlement yo'q) |
| **Ustoz paneli** `/lock.html` (dashboard menyusida «Dars rejimi»): QR proyektor, faqat istisnolar jadvali, bir tugmali ruxsat/rad, hammaga ruxsat/qayta qulf/vaqt uzaytirish, hisobot CSV + PDF(chop etish), guruh CSV yuklash, admin: sozlamalar, fakultetlar, haftalik hisobot, statistika, o'chirish so'rovlari | ✅ (Web Push yo'q — pastga qarang) |
| **Huquqiy**: uch tilli maxfiylik siyosati `/privacy-policy`, `/delete-data` (egasi va muddatlar `config/.env` dan qo'yiladi) | ✅ |
| **Do'kon hujjatlari** `docs/store/*`, sinov ro'yxati `docs/testing/*`, build skriptlari `scripts/*` | ✅ |

## 2. Nima sinaldi (va nima sinalMAdi)
**Sinaldi:** server testlari (29); Playwright e2e (mock native) Android va iOS oqimlari; panel testi (`tests/lock-panel.mjs`); dashboard regressiya (`tests/dashboard-smoke.mjs`); haqiqiy Android emulyator API 36 (direct+store: pinning, DND, taymerlar, SOS, offline-avtoochilish) va API 26 (native tutun testi); iOS simulyator iPhone 17: ilova yuklanadi, haqiqiy talaba ekrani, ko'prik metodlari (info/permissions/deviceKey/attest(mock)/start/state/stop/xato); ikkala iOS konfiguratsiyasi (L0 va L1/L2+kengaytmalar) kompilyatsiya bo'ladi.
**SINALMADI (real qurilma/kalit kerak):**
- Play Integrity va App Attest **haqiqiy** tekshiruvi (mock rejimida sinalgan; `ATTESTATION_MODE=log` bilan boshlang).
- Real QR dekodlash kamerasi (emulyatorda virtual sahna); iOS kamerasi.
- iOS L1/L2 ishlashi (Apple entitlement kerak). Release APK real telefonda ishga tushirilmagan.
- OEM xatti-harakatlari (Xiaomi/Tecno/Huawei) → `docs/testing/real-device-checklist.md`.

## 3. Bilishingiz kerak bo'lgan cheklovlar (halol)
1. **Telefonni 100% bloklamaydi** — hech qayerda shunday va'da yo'q. Android'da foydalanuvchi pinning'ni qo'lda yechishi mumkin (ustozga «himoyasiz» deb ko'rinadi). iOS'da hozir faqat kuzatish (L0).
2. **iOS L2'da** foydalanuvchi Ekran vaqti ruxsatini o'chira olishi mumkin — server buni darhol bila olmaydi (`assumed` holati, sozlanadi).
3. **Push bildirishnomalar amalga oshirilmagan** (APNs/FCM/Web Push). Ustoz panelida ovozli ogohlantirish bor (sahifa ochiq turganda). Kalitlar `.env` da placeholder.
4. **E-pochta hisoboti yo'q** — hisobot faqat panelda (CSV/PDF); SMTP placeholder.
5. Skrinshotlar haqiqiy talaba ekranlari, lekin native qatlam sinov bilan almashtirilgan; real qurilmada qayta olish tavsiya.
6. Android store build'da Accessibility yo'q (faqat direct APK) — Play uchun deklaratsiya kerak emas.
7. Repo tarixi: bir commit tasodifan sizning tugallanmagan fayllaringizni (`mobile-app.css`, `style.css`, `pdf*.js`) ham o'z ichiga oldi — tekshirib ko'ring.
8. Android'da imzolash kaliti sinov (debug/test) — do'kon uchun o'zingiz yarating (pastda).

## 4. SIZ qilishingiz kerak bo'lgan ishlar (qadam-baqadam)
### A. Server (production)
1. `cp config/.env.example config/.env`, to'ldiring: `NODE_ENV=production`, `JWT_SECRET` (`openssl rand -hex 32`), `PUBLIC_BASE_URL` (HTTPS!), `ADMIN_BOOTSTRAP_EMAIL/PASSWORD`, `OWNER_COMPANY_NAME / OWNER_EMAIL / OWNER_STIR`, `ENABLE_DEMO_TEACHER=false`. Production'da `JWT_SECRET` bo'lmasa server ishga tushmaydi.
2. `config/app-config.json` → `productionUrl` ni haqiqiy domen bilan almashtiring (Android va iOS shu faylni o'qiydi), so'ng ilovalarni qayta build qiling.
3. Saqlash muddati: `RETENTION_DAYS_AFTER_SEMESTER=90` (hozir), semestr sanasini admin panelida kiriting (Admin → Sozlamalar → `retention.semesterEnd`). Maxfiylik siyosati shu qiymatlarni avtomatik ko'rsatadi.
4. Server `DATA_DIR` ni zaxiralang (SQLite + sessiyalar JSON).
### B. Google Play
1. Play Console akkaunti ($25), ilova `com.edufocus.app`.
2. `scripts/create-upload-keystore.sh` → kalit va parolni zaxiralang (yo'qolsa muammo).
3. Google Cloud loyihasi → **Play Integrity API** yoqing; loyiha raqamini `config/app-config.json → googleCloudProjectNumber` ga yozing; service account JSON → `GOOGLE_SERVICE_ACCOUNT_PATH`. Avval `ATTESTATION_MODE=log`.
4. `scripts/build-android.sh store` → `build/android/*.aab` ni **Internal testing** ga yuklang. Listing: `docs/store/listings.md`, skrinshotlar `docs/store/screenshots/final/android-phone`, feature graphic. Data safety: `docs/store/data-safety.md`. Maxfiylik URL: `<PUBLIC_BASE_URL>/privacy-policy`; o'chirish URL: `/delete-data`.
5. Yangi shaxsiy akkauntlar uchun Play 12 sinovchi × 14 kun talab qilishi mumkin (tashkilot akkaunti uchun yo'q).
6. Direct APK (Accessibility bilan): `scripts/build-android.sh direct` → `build/android/app-direct-release.apk`; faqat o'z saytingizdan tarqating.
### C. Apple
1. Apple Developer Program (yillik $99; tashkilot uchun D-U-N-S).
2. App Store Connect'da ilova (`com.edufocus.app`), Team ID ni `APPLE_TEAM_ID` ga yozing (server `.env` va `scripts/build-ios.sh`).
3. `APPLE_TEAM_ID=… scripts/build-ios.sh l0` → ipa → Transporter → TestFlight. Review notes: `docs/store/review-notes.md` (demo kod 123456).
4. **Entitlement'lar (ixtiyoriy, haftalar):** `docs/store/apple-entitlements.md` matnlari bilan so'rang. Tasdiq kelgach: `IOS_L2_ENABLED/IOS_L1_ENABLED` (project-l2.yml allaqachon YES), serverda `features.iosL1/iosL2` ni admin panelida yoqing, `scripts/build-ios.sh l2`, **real qurilmada sinang** (`docs/testing`).
5. Apple tasdiqlamasa — L0 bilan chiqing (listing shunga mos yozilgan).
### D. Keyinroq (ixtiyoriy)
Push (APNs `.p8` + Firebase), SMTP, Web Push VAPID kalitlari: `openssl`/`web-push generate-vapid-keys`. Hozir ularsiz ham hamma narsa ishlaydi.

## 5. Ishga tushirish va tekshirish
```
node server.js                                   # lokal (config/.env; demo ustoz teacher@edufocus.uz / 123456 — faqat lokal)
node --test tests/server/lock*.test.mjs tests/server/units.test.mjs
node tests/e2e-lock.mjs android | ios            # mock native e2e
node tests/lock-panel.mjs                        # ustoz paneli
node tests/i18n-check.mjs                        # uz/ru/en kalitlari mosligi
cd ios && xcodegen generate && xcodebuild …      # iOS (scripts/build-ios.sh)
STORE_SHOTS=1 node tests/e2e-lock.mjs ios        # do'kon skrinshotlari
```
Emulyator testlari: `tests/android/*.mjs` (adb + CDP; API 26/36 AVD kerak — joy ko'p talab qiladi).

## 6. Pilot rejasi (tavsiya)
1. 1 hafta: 1–2 ustoz, 1 guruh (20–30 talaba), `protection.default=optional`, `ATTESTATION_MODE=log`. Faqat statistikani (Admin → Statistika) va qurilmadagi muammolarni (`deviceIssues`) kuzating.
2. Qurilma muammolari ro'yxatini (Xiaomi/Tecno) yig'ing → yo'riqnomalarni yangilang.
3. Yaxshi bo'lsa `required` (ustoz tanlaydi) va `ATTESTATION_MODE=enforce` (Android, Play build'da).
4. 2–3 haftadan keyin ommaviy; Apple entitlement kelsa iOS L2 alohida pilotda.
5. Muvaffaqiyat mezonlari: himoyalangan vaqt ulushi, «istisno» sonining kamayishi, ustoz faolligi daqiqasi/dars (statistikada).

## 7. Joylashuv xaritasi
`server/lock/*` (mantiq), `server/db/*`, `server/repos/*`, `server/templates/*` (huquqiy sahifalar), `public/js/student/*` (talaba), `public/lock.html` (ustoz), `android/`, `ios/`, `config/`, `docs/lock-mode/*` (protokollar), `docs/store/*`, `docs/testing/*`, `scripts/*`.
