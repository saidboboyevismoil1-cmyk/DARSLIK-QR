# Real qurilmada sinov ro'yxati

Emulyator/simulyatorda tekshirilganlar: `docs/RELEASE-LOCK-MODE.md` («Nima sinaldi»). Quyidagilar **faqat real qurilmada** ishonchli — kamida har bir qatorda 1 ta qurilma.
Har bir sinov uchun: bajarildi ✅ / muammo ❌ + izoh. Server: haqiqiy (HTTPS) yoki lokal tarmoqdagi `node server.js` + `serverUrl` bilan build.

## Barcha qurilmalar
- [ ] APK/IPA o'rnatiladi, ikonka va nom to'g'ri, til telefon tiliga mos (uz/ru/en)
- [ ] QR skaner ishlaydi (yorug'/qorong'i, ekrandan va qog'ozdan), kamera ruxsati rad etilsa tushunarli xabar
- [ ] Demo kod 123456 bilan kirish, test topshirish, material ochish
- [ ] Ustoz paneli (`/lock.html`): QR ko'rinadi, talaba «yashil» ko'rinadi, «Hammaga ruxsat» talabada ochilishni ko'rsatadi
- [ ] Wi-Fi → mobil internet almashinuvi, 1 daqiqa aloqasiz → «Aloqa yo'q» (30 s), qaytganda tiklanadi
- [ ] 15 daqiqa aloqasiz (yoki sozlamada 2 daqiqa qilib) → cheklov o'zi tugaydi
- [ ] Favqulodda qo'ng'iroq (SOS) raqamga tushadi, qaytgach himoya qayta yoqiladi
- [ ] Ma'lumotni o'chirish (Profil) ishlaydi; `/delete-data` so'rovi panelda ko'rinadi

## iPhone (iOS 15+; L0 hozir)
- [ ] iPhone 12–17 (kamida bitta kichik ekran — SE/mini): safe-area, klaviatura, bildirishnoma ruxsati
- [ ] App Attest: ATTESTATION_MODE=enforce da qo'shilish o'tadi (simulyatorda **o'tmaydi** — faqat real qurilma)
- [ ] Ilova orqa fonda 1 daqiqa → «chiqish» hodisasi ustozga ko'rinadi
- [ ] (Apple entitlement kelgach) L2: Ekran vaqti ruxsati → qalqon boshqa ilovada chiqadi → dars tugagach olinadi; ilova o'ldirilsa ham 15+ daqiqadan keyin qalqon tushadi (DeviceActivity)
- [ ] (kelgach) L1: AEAssessmentSession boshlanadi/tugaydi

## Android — direct APK (full) va Play (lite)
Har qurilmada **ikkala** variant. Tekshiruv: pinning dialogi, DND, (direct) Accessibility.
| Qurilma | Muhim sinov |
|---|---|
| Samsung (One UI) | pinning dialogi; «Ilovani mahkamlash» Sozlamalarda o'chiq bo'lsa yo'riqnoma; DND ruxsati |
| Xiaomi / Redmi (MIUI/HyperOS) | Avto-ishga tushirish va batareya cheklovi (OEM yo'riqnoma ekrani), fonda o'ldirilmasligi, qulf ekran |
| Tecno / Infinix (HiOS) | batareya «Phone Master» cheklovi, avto-start |
| Huawei (EMUI, GMS siz) | **Play Integrity ishlamaydi** → attestatsiya «log» rejimida bo'lishi kerak; direct APK ishlashi |
| Pixel (toza Android 15/16) | etalon: DND implicit rule, predictive back, 16 KB sahifa (Pixel 8+ developer opsiyasi) |
- [ ] Ekran mahkamlangan holatda Home/Recents bosish ishlamaydi; «Orqaga»+«Umumiy» uzoq bosib chiqish → ustozga «chiqish» ko'rinadi
- [ ] Bildirishnoma pardasi/DND: dars vaqtida bildirishnomalar jim; dars tugagach avvalgi holat tiklanadi (DND ni telefonda qo'lda yoqib sinang)
- [ ] Ilova majburan to'xtatilsa/telefon qayta yuklansa — DND «yopishib qolmaydi»
- [ ] (direct) Accessibility o'chirilsa — ustozga «himoya o'chiq»
- [ ] Play Integrity: Play'dan o'rnatilgan build bilan `ATTESTATION_MODE=enforce` (ichki test treki)
