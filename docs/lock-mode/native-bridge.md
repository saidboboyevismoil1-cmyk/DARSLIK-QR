# Native ko'prik protokoli (veb ↔ Android/iOS)

Veb tomoni: `public/js/student/native.js`, `protection.js`. Test uchun mock: `tests/e2e-lock.mjs` (`mockScript`).

## Transport
- **web → native:** `host.invoke(id: number, method: string, argsJson: string)`.
  - Android: `AndroidBridge.invoke(id, method, argsJson)` (`@JavascriptInterface`).
  - iOS: `window.__efNativeHost = { platform: 'ios', invoke(id, method, args) { webkit.messageHandlers.nativeBridge.postMessage({id, method, args}) } }` (WKUserScript, atDocumentStart).
- **native → web:** javob `window.__efNative.resolve(id, '{"ok":true,"data":…}')` yoki `'{"ok":false,"error":"kod"}'`;
  hodisa `window.__efNative.emit(event, jsonString)`.
- Native har chaqiruvga **aynan bitta** javob qaytaradi. Noma'lum method: `{"ok":false,"error":"unsupported"}`.
- Uzoq operatsiyalar (ruxsat so'rash, `protection.start`, `scanQR`) foydalanuvchi javob bergunicha kutadi (veb tomoni 90–120 s kutadi).

## Metodlar
| method | args | data |
|---|---|---|
| `info` | — | `{platform, flavor('store'\|'direct'\|''), appVersion, osVersion, brand, model, candidates:[level…], requires:{level:[permId…]}, features:{iosL1, iosL2, nativeScan}}` |
| `permissions` | — | `[{id, status:'granted'\|'denied'\|'unknown'\|'na', canRequest, guide}]` |
| `requestPermission` | `{id}` | `{status}` (tizim oynasi yoki sozlamalar ochiladi) |
| `openSettings` | `{id}` | `{ok}` |
| `deviceKey` | — | `{key}` (Keychain/Keystore da saqlanadigan tasodifiy ≥16 belgi) |
| `attest` | `{nonce}` | `{token, keyId?}` yoki `{error}` (Play Integrity / App Attest) |
| `protection.dryRun` | `{level}` | `{ok, reason?}` — qisqa sinov: yoqadi, tekshiradi, o'chiradi |
| `protection.start` | `{level, endsInSec, offlineReleaseSec, preJoin}` | `{ok, level, reason?}` |
| `protection.update` | `{endsInSec, offlineReleaseSec}` | `{ok}` — qo'shilgach dars siyosati ma'lum bo'lganda taymerlarni yangilash |
| `protection.state` | — | `{active, reasons[], checks{}, fg, level}` |
| `protection.stop` | `{reason}` | `{ok}` |
| `serverContact` | `{remainingSeconds}` | `{ok}` — har heartbeat-ack da (o'lik odam taymeri uchun) |
| `sos` | `{number}` | `{ok}` — himoyani vaqtincha olib telefonni ochadi, qaytgach qayta yoqadi |
| `scanQR` | — | `{text}` \| `{cancelled:true}` \| `{error:'permission_denied'}` |
| `openExternal` | `{url}` | `{ok}` (Custom Tabs / SFSafariViewController) |
| `openCalculator` | — | `{ok}` (Android) |
| `setBackHandled` | `{value}` | `{ok}` — web orqaga tugmasini o'zi hal qiladimi (predictive back uchun) |
| `setSystemBarsDark` | `{dark}` | `{ok}` |
| `setPullToRefresh` | `{value}` | `{ok}` (iOS) |
| `exitApp` | — | `{ok}` (Android) |

### Daraja kelishuvi
`info.candidates` — afzallik tartibida; `info.requires[level]` — shu daraja uchun kerakli ruxsatlar. Veb tomoni birinchi *bajarilgan* darajani tanlaydi; hech biri bo'lmasa `android-l0` / `ios-l0`.
- Android direct: `['android-full','android-lite','android-l0']`, `requires`: full→[accessibility,dnd], lite→[dnd]. Store flavor: `['android-lite','android-l0']`.
- iOS: `['ios-l1','ios-l2','ios-l0']`; `features.iosL1/iosL2` = entitlement mavjudmi. `requires`: l2→[screentime].
- Ruxsat idlari: `accessibility, dnd, battery, autostart, notifications, camera, screentime, pinning, usage`.
  Holatini tekshirib bo'lmaydigan ruxsatlar (`battery`, `autostart`, `pinning`) `status:'unknown'` + `guide:true`; foydalanuvchi "Sozladim" desa veb ularni `granted` hisoblaydi.

### `protection.state.reasons` / `checks`
`reasons`: `background, not_pinned, no_accessibility, no_dnd, dev_options, a11y_shortcut, no_assessment, no_shield, no_authorization, permission_revoked, screen_off, unknown`.
`checks`: `pinned, accessibility, dnd, devOptions, a11yShortcut, assessment, shield, authorized, foreground`.
`protection.start` xato kodlari: `user_declined, pinning_failed, accessibility, dnd, permission, timeout, error`.

## Native → web hodisalari
| event | data | ma'nosi |
|---|---|---|
| `protectionChanged` | `{}` | himoya holati o'zgardi (veb darhol heartbeat yuboradi) |
| `permissionChanged` | `{id?}` | ruxsat holati o'zgardi |
| `autoRelease` | `{reason:'offline'\|'timer'}` | native qulfni o'zi ochdi (15 daqiqa aloqa yo'q / taymer tugadi) |
| `backPressed` | `{}` | `setBackHandled(true)` bo'lganda orqaga bosildi |

## Native majburiyatlari
1. **O'lik odam taymeri:** `serverContact` oxirgi chaqirilgandan beri `offlineReleaseSec` o'tsa — himoyani o'zi olib tashlab `autoRelease{offline}`.
2. **Dars taymeri:** `endsInSec` monotonik soat bilan; tugasa `autoRelease{timer}`. Telefon soati o'zgarishi ta'sir qilmaydi.
3. **SOS:** hech qachon bloklanmaydi; himoya vaqtincha olinadi, qaytganda qayta yoqiladi.
4. Ilovalar ro'yxati/paket nomlari serverga yoki logga **hech qachon** yuborilmaydi (faqat mantiqiy `active/reasons`).
5. Xato bo'lsa ilova qulamasin: har chaqiruv javob qaytaradi.
