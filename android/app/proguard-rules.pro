# WebView JS ko'prigi: @JavascriptInterface metodlari nomi o'zgarmasligi kerak
-keepclassmembers class com.edufocus.app.NativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
# AccessibilityService manifest orqali ishga tushiriladi
-keep class com.edufocus.app.LockAccessibilityService { *; }
