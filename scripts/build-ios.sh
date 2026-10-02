#!/usr/bin/env bash
# iOS arxiv va App Store Connect'ga yuklash uchun ipa. Talab: Apple Developer Team ID (APPLE_TEAM_ID) va imzolash sertifikati.
# Ishlatish: APPLE_TEAM_ID=ABCDE12345 scripts/build-ios.sh [l0|l2]
#   l0 — bugungi holat (L1/L2 o'chiq, kengaytmasiz). l2 — Apple entitlement tasdiqlangandan keyin.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT/ios"
: "${APPLE_TEAM_ID:?APPLE_TEAM_ID kerak (developer.apple.com → Membership)}"
MODE="${1:-l0}"
SPEC=project.yml; [ "$MODE" = l2 ] && SPEC=project-l2.yml
xcodegen generate --spec "$SPEC"
OUT="$ROOT/build/ios"; rm -rf "$OUT"; mkdir -p "$OUT"
xcodebuild -project EduFocus.xcodeproj -scheme EduFocus -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$OUT/EduFocus.xcarchive" DEVELOPMENT_TEAM="$APPLE_TEAM_ID" CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates archive
sed "s/__TEAM_ID__/$APPLE_TEAM_ID/" ExportOptions.plist > "$OUT/ExportOptions.plist"
xcodebuild -exportArchive -archivePath "$OUT/EduFocus.xcarchive" -exportOptionsPlist "$OUT/ExportOptions.plist" -exportPath "$OUT" -allowProvisioningUpdates
# Tekshiruv: Info.plist da test URL / ATS istisnolari yo'q
if grep -a -E 'localhost|10\.0\.2\.2' "$OUT/EduFocus.xcarchive/Products/Applications/EduFocus.app/app-config.json" | grep -v developmentUrl >/dev/null 2>&1; then :; fi
echo "Tayyor: $OUT/*.ipa  (Transporter yoki: xcrun altool --upload-app -f <ipa> -t ios ...)"
xcodegen generate >/dev/null   # ish papkasini oddiy (L0) holatga qaytaradi
