# O'qituvchi paneli va ilovasi — REJA (tasdiq kutilmoqda)

## 1. Mavjud holat (o'rganildi)
- `public/dashboard.html` — 3322 qator, bitta fayl; bo'limlar: Dashboard, Sessiyalar, Guruhlar, Testlar to'plami, Talabalar (+ yangi `lock.html` — Dars rejimi).
- API (`server.js` + `server/lock/http.js`): login/register/profile, sessions (yaratish, tugatish, stats, lock/unlock, materials, upload-material, regenerate-qr), groups, testpacks (+broadcast), Dars rejimi API (overview, release/relock/extend, report CSV, requests/decision, rosters CSV, admin/*). Socket: `teacher-monitor`, `lock-subscribe`, `lock-overview`, `access-request`, `teacher-send-quiz/-material`.
- Tayyor, qayta ishlatiladi: dars rejimi mantig'i, guruh CSV (`/api/rosters`), hisobot (ball/davomat/fokus), admin sozlamalari, uch tilli i18n tizimi (talaba ilovasida), glass dizayn (`student.css`).

## 2. Topilgan bbo'shliqlar (reja shularni yopadi)
| # | Muammo | Xavf |
|---|---|---|
| 1 | `/api/groups` va `/api/testpacks` **hamma ustozga umumiy** (egasi yo'q) | ustoz boshqa ustozning guruh/testini ko'radi — talabingizga zid |
| 2 | Refresh token yo'q (JWT 7 kun) | kirish xavfsizligi/qulayligi |
| 3 | `/api/login`, `/api/register` da rate limit yo'q | parol terish |
| 4 | Parolni tiklash yo'q; telefon bilan kirish yo'q | SMTP/SMS kerak (pastda savol) |
| 5 | Test turlari: faqat bir nechta variantli (`correctIndex`); «bir nechta to'g'ri» va «qisqa javob» yo'q | server + talaba ilovasi kengayishi kerak |
| 6 | Guruhda talabalar ro'yxati ikki joyda (`groups` va `roster_groups`) | birlashtirish |
| 7 | Push, Live Activity, hisobni o'chirish API — yo'q | kalitlar sizdan |
| 8 | HEMIS formati — nima ekani aniq emas | namuna kerak |

## 3. Arxitektura qarori
- **Yagona dizayn tizimi** `public/css/ef-design.css` (tokenlar: rang, shrift, radius, komponentlar; light/dark) — talaba, ustoz, admin uchun. Talaba ilovasi hozirgi `student.css` dan tokenlarni ko'chiradi (buzilmasdan).
- **Ustoz web paneli** yangi: `public/teacher/` (mobile-first SPA, vanilla JS modullari — talaba ilovasidagi kabi, build bosqichisiz), `i18n` uz/ru/en. Eski `dashboard.html` **o'chirilmaydi**: yangi panel tayyor bo'lgach `/dashboard.html` → yangiga yo'naltiradi (eski `dashboard-legacy.html` sifatida qoladi, testlar buzilmasin). Admin — faqat web, `public/teacher/admin`.
- **Mobil «EduFocus O'qituvchi»**: alohida bundle `com.edufocus.teacher` — Android `teacher` flavor/alohida modul va iOS alohida target (`ios/EduFocusTeacher`, XcodeGen). Bir xil web panelni WebView'da yuklaydi (`/teacher/`), native: Face ID/barmoq izi (kalit zanjirida token), push (FCM/APNs), actionable bildirishnoma, doimiy bildirishnoma / Live Activity, oflayn navbat (web qatlamida, IndexedDB), QR → web havola ochish. Accessibility/Screen Time **yo'q**.
- **Server**: egalik filtri (#1), refresh token + rotatsiya, rate limit, parol tiklash (SMTP orqali), test turlari, push token ro'yxati va yuboruvchi (mock-testlanadigan), hisobni o'chirish, HEMIS CSV, haftalik hisobot (guruh/dars kesimida).

## 4. Ekranlar xaritasi
```
Kirish ─┬─ Parolni tiklash
        └─ (mobil) Face ID tez kirish
Birinchi kirish → Qo'llanma (5 ekran, "?" bilan qayta)
[Pastki navigatsiya: Bosh | Guruhlar | Testlar | Hisobot | Yana]
Bosh ── bugungi darslar + katta «Darsni boshlash» ── oxirgi natijalar
  └ Darsni boshlash (guruh → davomiylik+himoya → «Boshlash»)  ← 3 bosish
       └ QR ekrani (web: to'liq ekran proyektor + 6 xonali kod; mobil: «Proyektorga chiqarish»)
       └ JONLI DARS: yashil/sariq/qizil kartalar, so'rovlar (Tasdiq/Rad), 
            «Hammani ochish»*, «Tanlanganini ochish», Test yuborish, Material yuborish, Vaqt, «Tugatish»*
            (* tasdiq so'raladi); «To'liq ro'yxat» — bitta bosishda
Guruhlar ── yaratish ── CSV yuklash (namuna CSV, aniq xatolar) ── talaba ro'yxati
Testlar ── bank ── yaratish/tahrirlash/nusxalash (3 tur) ── darsga yuborish
Materiallar ── PDF/rasm/havola ── darsga biriktirish
Hisobot ── dars hisoboti (davomat, test, fokus, bypass, ball; CSV/PDF/HEMIS) ── haftalik (guruh/dars)
Yana ── Sozlamalar (profil, til, bildirishnoma, tema, chiqish, hisobni o'chirish), Yordam
Admin (faqat web) ── sozlamalar, fakultetlar, ustozlar, statistika, o'chirish so'rovlari
```

## 5. Bosqichlar (har biri alohida commit + test)
1. **Server poydevori:** egalik (guruh/test), refresh token, rate limit, parol tiklash (SMTP placeholder), test turlari, hisobni o'chirish, push token API (mock yuboruvchi).
2. **Dizayn tizimi + web ustoz paneli (kirish, bosh, darsni boshlash, jonli dars)** + qo'llanma, i18n.
3. **Guruhlar/CSV, testlar banki, materiallar, hisobotlar (CSV/PDF/HEMIS), haftalik.** Admin web.
4. **Playwright** (desktop + telefon): kirish → guruh (CSV) → dars → talaba (simulyatsiya) → so'rov → test → tugatish → hisobot. Bosish/soniya o'lchovi.
5. **Android «O'qituvchi»:** WebView, biometrik, push (FCM mock/real), doimiy bildirishnoma, oflayn navbat; emulyatorda test.
6. **iOS «O'qituvchi»:** target, Face ID, APNs, actionable, Live Activity (widget extension), simulyatorda test.
7. **Do'kon hujjatlari** `docs/store/teacher/` (demo ustoz akkaunti, review notes), skrinshotlar light/dark `docs/screens/teacher/`, `docs/TEACHER-APP.md`.

## 6. Muvaffaqiyat o'lchovi
Darsni boshlash ≤ 3 bosish va ≤ 15 s (Playwright bilan o'lchanadi, hisobotga yoziladi); har bir asosiy amal ≤ 1–2 bosish; tugmalar ≥ 48 px; kontrast ≥ 4.5:1.

## 7. Tasdiq kerak (savollar)
1. **Eski dashboard:** yangi panel tayyor bo'lgach `/dashboard.html` yangiga yo'naltirilsin, eskisi `dashboard-legacy.html` bo'lib qolsinmi? (Tavsiya: ha)
2. **Telefon bilan kirish** SMS talab qiladi (Eskiz/Playmobile kabi pullik provayder). Tavsiya: hozir faqat email + parol; telefon — keyinroq. Parolni tiklash — e-pochta (SMTP kerak, placeholder).
3. **HEMIS formati:** namuna fayl yoki ustunlar ro'yxati bormi? Bo'lmasa taxminiy CSV (HEMIS ID, FISH, ball, davomat) qilaman va hujjatda «tasdiqlanmagan» deb yozaman.
4. **Test turlari** talaba ilovasiga ham ta'sir qiladi («bir nechta to'g'ri» va «qisqa javob» tekshiruvi serverda; qisqa javob: avtomatik tekshirish — aniq moslik, katta-kichik harf farqsiz). Maqul?
5. **Live Activity / widget** iOS'da faqat real qurilma va Apple Developer akkauntida to'liq ishlaydi; simulyatorda ko'rinishini sinayman. Maqulmi?
6. Ustoz ilovasi bundle ID: `com.edufocus.teacher`, nomi «EduFocus O'qituvchi». To'g'rimi?
7. Hajm katta (7 bosqich). Tavsiya: 1–4 bosqich (server + web + testlar) → sizga ko'rsataman → keyin mobil. Shunday davom etaymi?
