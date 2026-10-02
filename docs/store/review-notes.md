# App Review / Play Review notes (English — paste into App Store Connect "Notes" / Play "App access")

**What the app is.** EduFocus is a classroom companion for students of universities/colleges/schools. A teacher starts a class and students join by QR code or a 6-digit code. The app shows the lesson timer, quizzes and materials, and — if the student turns on "Class mode" — limits switching to other apps for the duration of the lesson *as far as the device allows*. It does not block the device 100% and the student can always leave (emergency exit request, teacher release, timer end, 15-minute offline auto-release; emergency calls are never blocked).

**No account is needed to review.** Open the app → accept the notice → choose "Join with code" → enter **123456** (permanent DEMO class, no teacher required). It contains a ready quiz ("Demo test") and a PDF material.

**How to test restrictions (Android):** Class mode uses system screen pinning ("App is pinned") + Do Not Disturb; the system shows its own confirmation. The "direct" APK additionally uses an Accessibility service (not in the Play build).
**iOS:** Class mode is optional; in this release iOS runs in "monitoring only" level unless Apple-approved entitlements are active (Family Controls / Automatic Assessment). App never claims restrictions it cannot enforce.

**Camera:** only to scan the teacher's QR code; nothing is stored or sent.
**Data:** name, device model, class activity, quiz answers. No third-party analytics/ads SDKs; no tracking. Privacy policy: <PUBLIC_BASE_URL>/privacy-policy · Data deletion: in-app (Profile → Delete my data) and <PUBLIC_BASE_URL>/delete-data.
**Login for teachers** is on the web (not part of the mobile app review).
**Contact:** {{OWNER_EMAIL}}
