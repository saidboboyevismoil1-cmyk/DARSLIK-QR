#!/usr/bin/env bash
# Android release: store (Google Play, AAB) va direct (to'g'ridan-to'g'ri APK). Maxfiy ma'lumot oqib chiqmaganini tekshiradi.
# Ishlatish: scripts/build-android.sh [store|direct|both]   (standart: both)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT/android"
WHAT="${1:-both}"
[ -f keystore.properties ] || echo "OGOHLANTIRISH: keystore.properties yo'q — debug kalit bilan imzolanadi (do'konga yuklab bo'lmaydi). scripts/create-upload-keystore.sh"
TASKS=()
case "$WHAT" in store) TASKS=(bundleStoreRelease assembleStoreRelease);; direct) TASKS=(assembleDirectRelease);; both) TASKS=(bundleStoreRelease assembleStoreRelease assembleDirectRelease);; *) echo "store|direct|both"; exit 2;; esac
./gradlew "${TASKS[@]}"
OUT="$ROOT/build/android"; mkdir -p "$OUT"
cp app/build/outputs/bundle/storeRelease/*.aab "$OUT/" 2>/dev/null || true
cp app/build/outputs/apk/store/release/*.apk "$OUT/" 2>/dev/null || true
cp app/build/outputs/apk/direct/release/*.apk "$OUT/" 2>/dev/null || true
echo "--- Tekshiruv ---"
FAIL=0
for f in "$OUT"/*.apk; do
  [ -e "$f" ] || continue
  TMP="$(mktemp -d)"; unzip -q -o "$f" 'classes*.dex' -d "$TMP"
  if grep -a -l -E '10\.0\.2\.2|http://localhost' "$TMP"/*.dex >/dev/null 2>&1; then echo "XATO: $f ichida sinov URL (10.0.2.2/localhost) bor"; FAIL=1; else echo "OK  test URL yo'q: $(basename "$f")"; fi
  rm -rf "$TMP"
  if command -v zipalign >/dev/null 2>&1 || [ -x "$ANDROID_HOME/build-tools/$(ls "$ANDROID_HOME/build-tools" | sort -V | tail -1)/zipalign" ]; then
    ZA="${ANDROID_HOME:+$ANDROID_HOME/build-tools/$(ls "$ANDROID_HOME/build-tools" | sort -V | tail -1)/zipalign}"; ZA="${ZA:-zipalign}"
    "$ZA" -c -P 16 4 "$f" && echo "OK  16 KB moslashuv: $(basename "$f")" || { echo "XATO: 16 KB moslashuv"; FAIL=1; }
  fi
done
if git -C "$ROOT" ls-files | grep -E 'keystore.properties|\.jks$|\.keystore$' ; then echo "XATO: kalit fayllari gitga qo'shilgan"; FAIL=1; fi
ls -la "$OUT"; exit $FAIL
