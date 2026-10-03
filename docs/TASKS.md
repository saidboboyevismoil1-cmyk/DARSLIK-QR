# Qolgan topshiriqlar (onlayn / telefondan davom ettirish uchun)

Avval `docs/HANDOFF.md` va `docs/TEACHER-PLAN.md` ni o'qing. Testlar: HANDOFF.md dagi "Testlar" bo'limi. Har bosqichdan keyin commit va `git push`.
Cloud muhitida (Linux) bajariladiganlar: server, web panel, testlar (Playwright), Android Gradle build (SDK o'rnatilsa). **Mac kerak**: iOS (Xcode/simulyator), Android emulyatori, real telefon sinovi.

## A. Cloud'da bajariladi (kompyutersiz)
1. **Ustoz panelini sayqallash:** `public/teacher/` — yangi panelni kunlik ishlatib ko'rib qulaylikni oshirish; `node tests/teacher-web.mjs`, `teacher-a11y.mjs`, `teacher-admin.mjs`, `teacher-i18n-check.mjs` yashil qolsin.
2. **Android «EduFocus O'qituvchi» ilovasi (5-bosqich) kodi:** `android/` ga `teacher` flavor (`com.edufocus.teacher`), `/teacher/` ni WebView'da ochadi, `window.EFTeacherNative` ko'prigi (biometricReady/biometricLogin/saveRefresh/clear), FCM push + "Tasdiqlash/Rad etish" tugmali bildirishnoma (`POST /api/lock/requests/:rid/decision`), doimiy bildirishnoma. Gradle build tekshiriladi; emulyator sinovi — Mac'da.
3. **iOS ustoz ilovasi kodi (6-bosqich):** `ios/` ga alohida target (XcodeGen), Face ID, APNs, actionable bildirishnoma, Live Activity (widget extension). Kompilyatsiya — Mac'da.
4. **Do'kon hujjatlari (7-bosqich):** `docs/store/teacher/` (review notes inglizcha, demo ustoz akkaunti, listing uz/ru/en, ma'lumot xavfsizligi), `docs/TEACHER-APP.md` (yakuniy hisobot).
5. **Server:** production uchun Dockerfile / `docker-compose`, `config/.env` namunasi, nginx+HTTPS yo'riqnomasi (`docs/DEPLOY.md`); SQLite zaxira skripti.
6. **Test qamrovi:** `/api/teacher/*` va `lock` uchun qo'shimcha server testlari; yuklama testi (`tests/perf.mjs`).

## B. Faqat sizning ruxsat/akkauntlaringiz bilan (men qila olmayman)
- Production server (VPS), domen, HTTPS; `config/.env` (JWT_SECRET, PUBLIC_BASE_URL, OWNER_*, ADMIN_BOOTSTRAP_*).
- Apple Developer ($99), Team ID; Family Controls / Automatic Assessment so'rovi (`docs/store/apple-entitlements.md`).
- Google Play ($25), Play Integrity (Google Cloud loyiha raqami), upload keystore (`scripts/create-upload-keystore.sh`).
- Firebase (FCM) va APNs `.p8` kalitlari; SMTP (parol tiklash xati).
- HEMIS rasmiy CSV namunasi.

## C. Mac'da bajariladi
- iOS simulyator/qurilma sinovi; Android emulyator va real telefon (`docs/testing/real-device-checklist.md`).
- Skrinshotlarni real qurilmada qayta olish.

## Telefondan beriladigan tayyor topshiriqlar (nusxalang)
**1.** "docs/HANDOFF.md va docs/TASKS.md ni o'qi. A-bo'limning 2-bandini (Android O'qituvchi ilovasi kodi) bajar: teacher flavor, WebView, biometrik ko'prik, FCM push. Gradle build tekshir, commit va push qil."
**2.** "docs/TASKS.md A-3: iOS ustoz ilovasi kodini yoz (XcodeGen target, Face ID, APNs, Live Activity). Kompilyatsiya qila olmasang, kodni tayyorla va nimani Mac'da tekshirish kerakligini yoz."
**3.** "docs/TASKS.md A-4 va A-5: do'kon hujjatlari va deploy hujjatlari (Dockerfile, DEPLOY.md). Commit va push."
**4.** "docs/TASKS.md A-1 va A-6: panel qulayligi va qo'shimcha testlar, hammasi yashil bo'lsin."
