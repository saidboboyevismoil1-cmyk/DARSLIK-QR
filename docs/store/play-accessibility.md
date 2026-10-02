# Google Play: AccessibilityService deklaratsiyasi

**Muhim:** Accessibility faqat **direct APK** (`direct` flavor) ichida. **Play Store build (`store` flavor) da AccessibilityService YO'Q** — manifest ichida e'lon qilinmagan (`android/app/src/direct/AndroidManifest.xml` faqat direct'da). Shuning uchun Play Console'dagi deklaratsiya talab qilinmaydi; quyidagi matn faqat Google so'rasa yoki keyinchalik store flavor'ga qo'shilsa kerak.

Tekshirish: `aapt dump xmltree app-store-release.apk AndroidManifest.xml | grep -i accessib` → bo'sh bo'lishi kerak.

## Deklaratsiya matni (kerak bo'lsa)
**Core functionality:** ilova dars vaqtida o'quvchi ilovadan chiqib ketganini (foreground o'zgarishini) aniqlaydi va o'qituvchiga «qoidabuzarlik» sifatida ko'rsatadi.
**Foydalanadigan imkoniyatlar:** faqat `typeWindowStateChanged` hodisasi; `canRetrieveWindowContent=false` — ekran mazmuni o'qilmaydi; matn, parol, kiritish yig'ilmaydi; paket nomlari serverga yuborilmaydi (faqat mantiqiy «ilova oldinda / emas»).
**Prominent disclosure:** ruxsat berishdan oldin ilova ichida to'liq ekranli tushuntirish va «Ruxsat berish / Bekor qilish» tugmalari (`a11y_disclosure` matni, uz/ru/en). Foydalanuvchi rozi bo'lmaguncha Sozlamalar ochilmaydi.
**Foydalanuvchi nazorati:** istalgan vaqtda Sozlamalarda o'chirishi mumkin; o'chirilsa o'qituvchiga «himoya o'chiq» holati ko'rinadi.

## Demo-video ssenariysi (30–60 s, ekran yozuvi)
1. Ilovani oching → «Tayyorlik testi» ekrani.
2. «Maxsus imkoniyatlar» qatorini bosing → **disclosure oynasi ko'rinsin** (to'liq o'qiladigan vaqt bering).
3. «Ruxsat berish» → tizim Sozlamalari → EduFocus'ni yoqing → ilovaga qayting.
4. Demo darsga kod `123456` bilan kiring, «Himoya faol» ko'rinsin.
5. Boshqa ilovaga chiqing → qaytib kelganda «Chiqish qayd etildi» xabari.
6. Sozlamalarda xizmatni o'chirib, ilovada holat o'zgarishini ko'rsating.
Ovoz yoki subtitr bilan har qadamni qisqa izohlang (inglizcha).
