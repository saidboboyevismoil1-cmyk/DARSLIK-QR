package com.edufocus.app;

import android.Manifest;
import android.app.Activity;
import android.app.ActivityManager;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.core.graphics.Insets;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import java.util.Locale;

/**
 * EduFocus talaba ilovasi — WebView o'rami.
 * Server manzili: ../config/app-config.json  →  BuildConfig.SERVER_URL (build.gradle).
 */
public class MainActivity extends Activity {
    private static final int REQ_CAMERA = 1001;
    private static final int REQ_FILE = 1002;
    private static final String OFFLINE_URL = "file:///android_asset/offline.html";

    private final String startUrl = BuildConfig.SERVER_URL + BuildConfig.START_PATH;
    private final String serverHost = Uri.parse(BuildConfig.SERVER_URL).getHost();

    private WebView webView;
    private FrameLayout root;
    private Handler mainHandler;
    private long startedAt;
    private volatile boolean pageReady = false;

    private PermissionRequest pendingPermissionRequest;
    private ValueCallback<Uri[]> fileCallback;

    // Kiosk (dars rejimi) holati
    private boolean isKioskActive = false;
    private boolean isExternalToolActive = false;
    private long lastBackPressTime = 0;

    // Xavfsiz hudud (px)
    private int insT, insR, insB, insL;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen splash = SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
        startedAt = SystemClock.uptimeMillis();
        mainHandler = new Handler(Looper.getMainLooper());
        // Splash sahifa yuklanguncha (eng ko'pi bilan 4 soniya) turadi
        splash.setKeepOnScreenCondition(() -> !pageReady && SystemClock.uptimeMillis() - startedAt < 4000);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        root = new FrameLayout(this);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.TRANSPARENT);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        root.addView(webView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            boolean imeVisible = insets.isVisible(WindowInsetsCompat.Type.ime());
            insT = bars.top; insL = bars.left; insR = bars.right;
            insB = imeVisible ? 0 : bars.bottom;
            root.setPadding(0, 0, 0, imeVisible ? ime.bottom : 0);
            pushInsets();
            return insets;
        });

        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        setBarsDark(night);

        setupWebView();
        webView.loadUrl(startUrl);
    }

    private void setupWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);          // assets (file:///android_asset) baribir ochiladi
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setUserAgentString(s.getUserAgentString() + " EduFocusApp/" + BuildConfig.VERSION_NAME);

        webView.addJavascriptInterface(new WebAppInterface(), "AndroidBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleNavigation(request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleNavigation(Uri.parse(url));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                pushInsets();
                applySystemBars();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showOffline();
            }

            @Override
            @SuppressWarnings("deprecation")
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) showOffline();
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                // Tunnel/proxy xatolari (502, 503, 504…) — asosiy sahifada chiroyli xato ko'rsatamiz
                if (request.isForMainFrame() && errorResponse.getStatusCode() >= 500) showOffline();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    String host = request.getOrigin() != null ? request.getOrigin().getHost() : null;
                    boolean trusted = host != null && host.equals(serverHost);
                    boolean wantsCamera = false;
                    for (String r : request.getResources()) if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) wantsCamera = true;
                    if (!trusted || !wantsCamera) { request.deny(); return; }   // mikrofon va boshqalar rad etiladi
                    if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                    } else {
                        pendingPermissionRequest = request;
                        isExternalToolActive = true;   // tizim ruxsat oynasi kiosk'ni buzmasin
                        requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
                    }
                });
            }

            @Override
            public boolean onShowFileChooser(WebView w, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    isExternalToolActive = true;
                    startActivityForResult(params.createIntent(), REQ_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, final JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                        .setPositiveButton("OK", (d, w) -> result.confirm())
                        .setOnCancelListener(d -> result.cancel()).show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, final JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                        .setPositiveButton("Ha", (d, w) -> result.confirm())
                        .setNegativeButton("Yo'q", (d, w) -> result.cancel())
                        .setOnCancelListener(d -> result.cancel()).show();
                return true;
            }

            @Override
            public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, final JsPromptResult result) {
                final EditText input = new EditText(MainActivity.this);
                input.setText(defaultValue);
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setView(input)
                        .setPositiveButton("OK", (d, w) -> result.confirm(input.getText().toString()))
                        .setNegativeButton("Bekor", (d, w) -> result.cancel())
                        .setOnCancelListener(d -> result.cancel()).show();
                return true;
            }
        });
    }

    /** Faqat o'z serverimiz WebView ichida ochiladi; tashqi havolalar bloklanadi (kiosk) yoki brauzerga uzatiladi. */
    private boolean handleNavigation(Uri uri) {
        if (uri == null) return true;
        String scheme = uri.getScheme();
        if ("file".equals(scheme) && OFFLINE_URL.equals(uri.toString())) return false;
        if (("http".equals(scheme) || "https".equals(scheme)) && serverHost != null && serverHost.equals(uri.getHost())) return false;
        if (("http".equals(scheme) || "https".equals(scheme)) && !isKioskActive) {
            try {
                isExternalToolActive = true;
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (Exception ignored) { }
        } else {
            Toast.makeText(this, "🔒 Dars vaqtida tashqi havolalar cheklangan", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private void showOffline() {
        pageReady = true;
        String cur = webView.getUrl();
        if (cur != null && cur.startsWith("file:///android_asset/offline")) return;
        webView.loadUrl(OFFLINE_URL);
    }

    // ---------- Xavfsiz hudud va tizim panellari ----------
    private void pushInsets() {
        if (webView == null) return;
        float d = getResources().getDisplayMetrics().density;
        String js = String.format(Locale.US, "window.setNativeInsets&&window.setNativeInsets(%.1f,%.1f,%.1f,%.1f)", insT / d, insR / d, insB / d, insL / d);
        webView.evaluateJavascript(js, null);
    }

    private void setBarsDark(boolean dark) {
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), root);
        c.setAppearanceLightStatusBars(!dark);
        c.setAppearanceLightNavigationBars(!dark);
    }

    /** Kiosk rejimida panellar yashiriladi, aks holda ko'rsatiladi. */
    private void applySystemBars() {
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), root);
        if (isKioskActive) {
            c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            c.hide(WindowInsetsCompat.Type.systemBars());
        } else {
            c.show(WindowInsetsCompat.Type.systemBars());
        }
    }

    // ---------- Kiosk: dars vaqtida ilovadan chiqishni cheklash ----------
    private boolean isPhoneCallActive() {
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                int mode = am.getMode();
                return mode == AudioManager.MODE_RINGTONE || mode == AudioManager.MODE_IN_CALL || mode == AudioManager.MODE_IN_COMMUNICATION;
            }
        } catch (Exception ignored) { }
        return false;
    }

    private void bringAppToFront() {
        if (isPhoneCallActive()) return;   // qo'ng'iroq paytida xalaqit bermaymiz
        try {
            Intent intent = new Intent(this, MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(intent);
            ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
            if (am != null) am.moveTaskToFront(getTaskId(), ActivityManager.MOVE_TASK_WITH_HOME);
        } catch (Exception ignored) { }
    }

    private void scheduleBringToFront(long delayMs) {
        mainHandler.postDelayed(() -> {
            if (isKioskActive && !isExternalToolActive && !isPhoneCallActive()) bringAppToFront();
        }, delayMs);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applySystemBars();
            isExternalToolActive = false;
        } else if (isKioskActive && !isExternalToolActive) {
            scheduleBringToFront(1000);
        }
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (isKioskActive && !isExternalToolActive && !isPhoneCallActive()) {
            Toast.makeText(this, "⚠️ Dars vaqtida ilovadan chiqish taqiqlangan!", Toast.LENGTH_SHORT).show();
            bringAppToFront();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (isKioskActive && !isExternalToolActive) scheduleBringToFront(1000);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            root.removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    // ---------- Orqaga tugmasi ----------
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (webView == null) { super.onBackPressed(); return; }
        // 1) Web ilova o'zi hal qila oladimi (oyna, test, material ko'rish…)?
        webView.evaluateJavascript(
                "(function(){try{return !!(window.handleAppBackPress&&window.handleAppBackPress())}catch(e){return false}})()",
                value -> {
                    if ("true".equals(value)) return;
                    if (isKioskActive) {
                        Toast.makeText(this, "🔒 Dars rejimi faol! Dars tugagunga qadar ilovadan chiqish taqiqlangan.", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    String cur = webView.getUrl();
                    boolean onOffline = cur != null && cur.startsWith("file:///android_asset/offline");
                    if (!onOffline && webView.canGoBack()) {
                        webView.goBack();
                        return;
                    }
                    long now = SystemClock.uptimeMillis();
                    if (now - lastBackPressTime < 2000) {
                        finish();
                    } else {
                        lastBackPressTime = now;
                        Toast.makeText(this, "Chiqish uchun yana bir marta bosing", Toast.LENGTH_SHORT).show();
                    }
                });
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) { onBackPressed(); return true; }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_CAMERA) return;
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (pendingPermissionRequest != null) {
            if (granted) pendingPermissionRequest.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            else pendingPermissionRequest.deny();
            pendingPermissionRequest = null;
        }
        if (!granted) Toast.makeText(this, "QR kodni skanerlash uchun kamera ruxsati kerak. Kodni qo'lda kiritishingiz mumkin.", Toast.LENGTH_LONG).show();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
        }
    }

    /**
     * JavaScript ko'prigi (window.AndroidBridge). Web tomoni: public/js/student/*.js
     */
    public class WebAppInterface {
        @JavascriptInterface
        public boolean isNativeApp() { return true; }

        @JavascriptInterface
        public String getServerUrl() { return BuildConfig.SERVER_URL; }

        @JavascriptInterface
        public void retry() {
            runOnUiThread(() -> { if (webView != null) webView.loadUrl(startUrl); });
        }

        @JavascriptInterface
        public void setSystemBarsDark(final boolean dark) {
            runOnUiThread(() -> setBarsDark(dark));
        }

        @JavascriptInterface
        public void exitApp() {
            runOnUiThread(() -> {
                isKioskActive = false;
                try { stopLockTask(); } catch (Exception ignored) { }
                finish();
            });
        }

        @JavascriptInterface
        public void startKioskMode() {
            runOnUiThread(() -> {
                if (isKioskActive) return;
                isKioskActive = true;
                try { startLockTask(); } catch (Exception ignored) { }
                applySystemBars();
                Toast.makeText(MainActivity.this, "🔒 Dars rejimi: ilovadan chiqish bloklandi", Toast.LENGTH_SHORT).show();
            });
        }

        @JavascriptInterface
        public void stopKioskMode() {
            runOnUiThread(() -> {
                if (!isKioskActive) return;
                isKioskActive = false;
                try { stopLockTask(); } catch (Exception ignored) { }
                applySystemBars();
                Toast.makeText(MainActivity.this, "🔓 Qulf ochildi", Toast.LENGTH_SHORT).show();
            });
        }

        @JavascriptInterface
        public void openCalculator() {
            runOnUiThread(() -> {
                isExternalToolActive = true;
                try {
                    Intent intent = new Intent(Intent.ACTION_MAIN);
                    intent.addCategory(Intent.CATEGORY_APP_CALCULATOR);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Kalkulyator ilovasi topilmadi", Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public void openBrowser(final String url) {
            runOnUiThread(() -> {
                try {
                    Uri uri = Uri.parse(url == null || url.isEmpty() ? "https://uz.wikipedia.org" : url);
                    String sc = uri.getScheme();
                    if (!"http".equals(sc) && !"https".equals(sc)) return;   // faqat veb havolalar
                    isExternalToolActive = true;
                    startActivity(new Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Brauzerni ochib bo'lmadi", Toast.LENGTH_SHORT).show();
                }
            });
        }
    }
}
