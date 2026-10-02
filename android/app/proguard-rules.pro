# WebView JS ko'prigi: @JavascriptInterface metodlari nomi o'zgarmasligi kerak
-keepclassmembers class com.edufocus.app.MainActivity$WebAppInterface {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
