# Release qadamlari (qisqa)
Batafsil: `docs/RELEASE-LOCK-MODE.md` §4.
1. `config/.env` (production) + `config/app-config.json → productionUrl`.
2. Versiya: `version.properties` (`VERSION_NAME`); build raqami avtomatik (git commit soni).
3. Android: `scripts/create-upload-keystore.sh` (bir marta) → `scripts/build-android.sh both` → `build/android/`.
4. iOS: `APPLE_TEAM_ID=… scripts/build-ios.sh l0` → `build/ios/*.ipa`.
5. Listing, skrinshotlar, maxfiylik javoblari, review notes: `docs/store/`.
6. Real qurilma sinovi: `docs/testing/real-device-checklist.md`.
