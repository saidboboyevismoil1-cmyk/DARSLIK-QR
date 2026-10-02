# Apple: entitlement so'rovlari (matnlar ingliz tilida — Apple shu tilda ko'radi)

Kod tayyor va bayroq ostida o'chirilgan (`IOS_L1_ENABLED` / `IOS_L2_ENABLED` = NO). Tasdiq kelgach: `docs/RELEASE-LOCK-MODE.md` → «Apple tasdiqlagandan keyin».
Sahifa: https://developer.apple.com/contact/request/family-controls-distribution (Family Controls) va
https://developer.apple.com/contact/request/automatic-assessment-configuration (AAC).
Qaysi so'rovni yuborish — sizning qaroringiz; ikkalasi ham ixtiyoriy, ilova L0 da ham to'liq ishlaydi.

> Halol bo'ling: so'rovda ilovaning *nimani qila olishi*ni yozing. «Telefonni to'liq bloklaydi» deb yozmang — bu noto'g'ri.

## 1. Family Controls (Distribution) — `com.apple.developer.family-controls`
**Company / Developer:** {{OWNER_COMPANY}} (Team ID: <APPLE_TEAM_ID>)
**App:** EduFocus (`com.edufocus.app`)  **Extensions:** `com.edufocus.app.ShieldConfiguration`, `com.edufocus.app.ActivityMonitor`

**Describe how the app uses the Family Controls API:**
> EduFocus is a classroom attendance and focus tool for universities, colleges and schools in Uzbekistan. A teacher starts a class session and students join by scanning a QR code. During the class (typically 45–90 minutes) a student may choose to enable "Class mode". When enabled, the app uses `AuthorizationCenter` (individual authorization — the student approves it on their own device) and `ManagedSettingsStore` to place a shield over other apps and web domains until the class ends. The shield is shown with a clear message ("Class in progress — return to EduFocus"). We use `DeviceActivityMonitor` only to remove the shield automatically when the scheduled class interval ends, even if the app was closed.
>
> The restriction ends automatically: when the teacher allows it, when the class time ends, after 15 minutes without contact with our server, or when an emergency exit is approved. Emergency calls are never blocked (the shield is lifted for the call). The student can revoke Screen Time authorization in Settings at any time; the app then reports "protection off" to the teacher (we do not claim it cannot be bypassed).

**What data do you collect through the API?**
> None. We do not read which apps are installed or used. We never receive `ApplicationToken` values off the device and we do not send app names, categories or usage to any server. The server only receives a logical status ("protection active / inactive") and a coarse reason code.

**Is the app intended for children?** No — students aged 16+ (higher education / upper secondary). Individual authorization (`.individual`) is used; no parental-control features.

## 2. Automatic Assessment Configuration — `com.apple.developer.automatic-assessment-configuration`
> The app runs a short, teacher-initiated lesson/quiz session on the student's own device. `AEAssessmentSession` is started when the student joins a protected lesson and ended when the lesson ends, the teacher releases the student, the lesson timer expires, or 15 minutes pass without server contact. Configuration is the default restrictive profile; accessibility features remain enabled. The student sees system UI indicating the session is active.

## 3. Boshqa (entitlement talab qilmaydi)
- **App Attest** (`com.apple.developer.devicecheck.appattest-environment`): standart yoqiladi; Team ID kerak (server `APPLE_TEAM_ID`, `APPLE_BUNDLE_ID`).
- **Push (APNs)**: hozir **amalga oshirilmagan** (ustoz paneli ovozli ogohlantirish bilan ishlaydi). Keyinroq `.p8` kalit kerak.

## Javob kutish
Apple odatda bir necha hafta ichida javob beradi; rad etilishi mumkin. Rad bo'lsa — ilova L0 (kuzatish, himoyasiz) bilan chiqadi, App Store matnlarida «cheklash» va'dasi bo'lmasligi shart (listing shunday yozilgan).
