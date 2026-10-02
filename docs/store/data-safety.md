# Maxfiylik javoblari: App Store «App Privacy» va Google Play «Data safety»

Kod haqiqatiga mos (server: `server/lock`, `server/templates/privacy-policy.html`). O'zgarsa — bu jadvalni ham yangilang.

| Ma'lumot | Maqsad | Foydalanuvchiga bog'liq | Tracking |
|---|---|---|---|
| Ism-familiya (Name) | Ilova funksiyasi (davomat) | Ha | Yo'q |
| Qurilma identifikatori (tasodifiy kalit, SHA-256 xesh) | Ilova funksiyasi (guruh ro'yxatiga bog'lash, xavfsizlik) | Ha | Yo'q |
| Qurilma modeli / OS versiyasi | Ilova funksiyasi (himoya darajasini aniqlash) | Ha | Yo'q |
| Boshqa foydalanuvchi kontenti (test javoblari, izoh) | Ilova funksiyasi | Ha | Yo'q |
| Foydalanish ma'lumotlari (ilovada vaqt, chiqish hodisalari) | Ilova funksiyasi | Ha | Yo'q |
| Shaxssiz statistika (hisoblagichlar) | Tahlil (faqat o'z serverimizda) | Yo'q | Yo'q |

**Yig'ilmaydi:** joylashuv, kontaktlar, xabarlar, fotosuratlar/video (kamera faqat QR o'qish), o'rnatilgan ilovalar ro'yxati, ilova nomlari, reklama ID, moliyaviy ma'lumot, salomatlik.
**Uchinchi tomon SDK:** yo'q (Google ML Kit barcode va Play Integrity — qurilma ichida/Google xizmati; ML Kit skaner bundled model, tarmoqqa rasm yubormaydi; Play Integrity token faqat bizning serverga tekshirish uchun yuboriladi).
**Shifrlash tranzitda:** Ha (HTTPS). **O'chirish yo'li:** ilova ichida + `/delete-data` sahifasi.

### Play Data safety
Collected: Personal info → Name; Device or other IDs; App activity → App interactions; Other user-generated content. Shared with third parties: **No**. Purpose: App functionality. Data encrypted in transit: **Yes**. Users can request deletion: **Yes** (URL: `<PUBLIC_BASE_URL>/delete-data`).

### Yosh reytingi javoblari
- Apple: hamma «None», **Unrestricted Web Access: No**; yosh 4+ emas — **Age rating 17+/16+** deb belgilash tavsiya (talabalar 16+). Siz Apple so'rovnomasida bolalar uchun emasligini tanlang (Kids category EMAS).
- Google (IARC): Education / Utility; zo'ravonlik, jinsiy kontent, qimor yo'q; foydalanuvchi o'zaro muloqoti yo'q. Target audience: **16+ / 18+** (bolalar uchun emas) — «Families» dasturiga kirmang.
