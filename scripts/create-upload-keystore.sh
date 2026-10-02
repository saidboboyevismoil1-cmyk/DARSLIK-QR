#!/usr/bin/env bash
# Google Play "upload key" yaratadi va android/keystore.properties ni yozadi.
# Fayllar GITga TUSHMAYDI (.gitignore). Parolni xavfsiz joyda (parol menejer) saqlang va kalitning zaxira nusxasini oling.
set -euo pipefail
cd "$(dirname "$0")/../android"
KS="${1:-$HOME/.edufocus/upload-keystore.jks}"
ALIAS="${2:-upload}"
mkdir -p "$(dirname "$KS")"
if [ -f "$KS" ]; then echo "Allaqachon bor: $KS (qayta yaratilmadi)"; exit 1; fi
read -r -s -p "Keystore paroli (kamida 8 belgi): " PASS; echo
read -r -s -p "Qayta kiriting: " PASS2; echo
[ "$PASS" = "$PASS2" ] || { echo "Parollar mos emas"; exit 1; }
keytool -genkeypair -v -keystore "$KS" -alias "$ALIAS" -keyalg RSA -keysize 4096 -validity 9125 \
  -storepass "$PASS" -keypass "$PASS" -dname "CN=EduFocus, O=EduFocus, C=UZ"
umask 077
cat > keystore.properties <<EOP
storeFile=$KS
storePassword=$PASS
keyAlias=$ALIAS
keyPassword=$PASS
EOP
echo "Tayyor: android/keystore.properties (gitda yo'q). Kalit: $KS"
echo "MUHIM: $KS faylini va parolni zaxiralang — yo'qolsa, Play Console orqali kalitni almashtirish kerak bo'ladi."
