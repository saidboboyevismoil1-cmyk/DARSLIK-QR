# Dars rejimi: server protokoli (mijozlar uchun)

Barcha vaqtlar server soati bo'yicha. Mijoz taymerni `remainingSeconds` dan **monotonik soat** bilan sanaydi.

## Himoya darajalari (`client.level`)
| Daraja | Ma'nosi | `protection.active` qachon true |
|---|---|---|
| `ios-l1` | AEAssessmentSession | sessiya ishlayapti va ilova oldinda |
| `ios-l2` | FamilyControls + shield | ruxsat berilgan va shield qo'yilgan |
| `ios-l0` | faqat kuzatish | ilova oldinda |
| `android-full` | pinning + Accessibility + DND (direct APK) | uchalasi yoqilgan va ilova oldinda |
| `android-lite` | pinning + DND (store) | ikkalasi yoqilgan va ilova oldinda |
| `android-l0` | ilova bor, himoya yoqilmagan | ilova oldinda |
| `web` | brauzer | sahifa ko'rinib turibdi |

Server `ios-l1/l2` ni faqat `features.iosL1/iosL2` yoqilgan bo'lsa qabul qiladi (aks holda `ios-l0`). `GET /api/lock/capabilities` shu bayroqlarni qaytaradi.

## Qo'shilish (`student-join`)
```json
{ "sessionId": "123456", "studentName": "…", "device": "Pixel 7",
  "deviceKey": "<16–128 belgi, qurilmada saqlanadigan tasodifiy kalit>",
  "rosterStudentId": "…", "exemptionToken": "…",
  "client": { "type": "app", "platform": "android", "level": "android-full", "flavor": "direct", "appVersion": "4.0.0", "brand": "samsung" },
  "protection": { "active": true, "reasons": [], "checks": { "pinned": true, "accessibility": true, "dnd": true, "foreground": true } },
  "attestation": { "nonce": "…", "token": "…", "keyId": "…(iOS)" } }
```
Attestatsiya uchun avval `GET /api/lock/attest/challenge?sessionId=…` → `{nonce}` (bir martalik, 5 daqiqa).
iOS: `token` = App Attest attestatsiya obyekti (base64), clientDataHash = `SHA256(utf8(nonce))`.
Android: `token` = Play Integrity token, nonce = shu `nonce` (base64url).

Rad etish kodlari (`join-error.code`): `not_found`, `name_required`, `app_required`, `protection_required`, `protection_inactive`, `attestation_failed`, `roster_required`, `roster_not_bound`.
`protection_required` bo'lsa talaba "himoyasiz kirish so'rovi" yuborishi mumkin (`POST /api/sessions/:id/exemption-requests`).

`join-success` / `rejoin-success` ga qo'shildi: `locked` (talaba uchun samarali holat), `protection`:
`{ protection, level, demo, heartbeatIntervalSec, offlineAfterSec, releaseOfflineMinutes, remainingSeconds, serverTime, features }`.

## Qayta ulanish (`student-rejoin`)
`{ sessionId, studentId, deviceKey, client?, protection?, offlineReleased? }`. Qurilma kaliti mos kelmasa `rejoin-error.reason = device_mismatch`.
`offlineReleased: true` — mijoz 15 daqiqalik uzilishda o'zini qulfdan chiqargan (hodisa `released_offline` yoziladi).

## Heartbeat (har `heartbeatIntervalSec`, standart 10 s)
`student-heartbeat` → `{ sessionId, studentId, seq, fg, level?, protection:{active, reasons[], checks{}} }`
Javob: `heartbeat-ack` → `{ serverTime, remainingSeconds, totalSeconds, locked, seq }`.
`checks` kalitlari: `pinned, accessibility, dnd, devOptions, a11yShortcut, assessment, shield, authorized, foreground`.
`reasons`: `background, not_pinned, no_accessibility, no_dnd, dev_options, a11y_shortcut, no_assessment, no_shield, no_authorization, permission_revoked, screen_off, unknown`.
Bypass hodisalari checks'ning `true→false` (devOptions/a11yShortcut uchun `false→true`) o'zgarishidan avtomatik chiqadi.

## Boshqa talaba hodisalari
- `student-protection-event` `{sessionId, studentId, type}`: `permission_revoked | app_terminated | assessment_ended | pinning_removed | accessibility_disabled | dnd_disabled | developer_mode | a11y_shortcut | sos`. `sos` jazosiz.
- `student-emergency-exit-request` `{reason}` → ustoz bir bosishda tasdiqlaydi → `emergency-exit-decision` + `session-unlocked {individual:true}`.
- Serverdan: `session-unlocked {reason: teacher|timer|emergency|demo, individual?}`, `session-locked`, `lock-rule {rule: focus_zero|absent}`, `emergency-exit-pending`.

## Qulf ochilish qoidalari
1. Ustoz: hammasi (`POST /api/lock/sessions/:id/release {}`) yoki tanlanganlar (`{studentIds}`); qayta qulflash `/relock`.
2. Dars taymeri tugaganda server o'zi ochadi (`reason: "timer"`). `POST …/extend {minutes}` qayta qulflaydi.
3. Aloqa `releaseOfflineMinutes` (15) uzilsa **mijoz** o'zini ochadi (server vaqtini lokal monotonik soat bilan sanaydi).
4. Favqulodda chiqish: ustoz tasdiqlaganda.
SOS va favqulodda qo'ng'iroqlar hech qachon bloklanmaydi.

## Ball (admin sozlaydi)
`bal = davomat·30% + testlar·50% + fokus·20%`. Fokus = himoyada o'tgan vaqt ulushi; jami himoyasiz > 180 s → fokus 0; > 600 s → davomat ham 0 (qatnashmagan). Test bo'lmasa vazn qolganlarga taqsimlanadi. iOS L2'da heartbeat to'xtasa vaqt "taxminan himoyada" hisoblanadi (`ios.l2OfflineAs`).

## Ustoz API
`GET /api/lock/sessions/:id/{overview,events,report?format=csv}`, `POST …/release|relock|extend`, `POST /api/lock/requests/:id/decision {approve}`.
Soket: `lock-subscribe {sessionId}` → `lock-overview` (har 5 s), `lock-event`, `access-request`, `access-request-decided`, `lock-final`.
Ustoz soketi `io({auth:{token}})` bilan ulanadi; tokensiz soket ustoz hodisalarini ishlata olmaydi.

## Guruh ro'yxati
`POST /api/rosters {name, csv}` (F.I.Sh; HEMIS ID ixtiyoriy). Dars: `POST /api/sessions {rosterGroupId}`.
Talaba: `GET /api/sessions/:id/roster?deviceKey=` → `POST /api/sessions/:id/roster/bind {rosterStudentId, deviceKey, platform}` (bir marta; keyin `student-join` da `rosterStudentId`+`deviceKey`).

## Admin
`/api/admin/{settings,faculties,users,telemetry,reports/weekly,deletion-requests}` — faqat `role=admin`.
Ma'lumotni o'chirish: `POST /api/student-data/delete {deviceKey, items:[{sessionId, studentId}]}` va brauzer uchun `POST /api/data-deletion-requests`.
DEMO dars: kod `DEMO_SESSION_CODE` (standart 123456), attestatsiyasiz, ustozsiz ssenariy (40 s dan keyin ochiladi, 90 s da yana qulflanadi).

## Konfiguratsiya
`config/.env` (namuna: `config/.env.example`). Production'da `JWT_SECRET` majburiy, `ENABLE_DEMO_TEACHER=true` taqiqlangan.
