package com.edufocus.app;

import android.Manifest;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
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

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.graphics.Insets;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.util.Locale;

/**
 * EduFocus talaba ilovasi — WebView o'rami + native himoya.
 * Server manzili: ../config/app-config.json → BuildConfig.SERVER_URL. Ko'prik: NativeBridge.
 */
public class MainActivity extends ComponentActivity {
    private static final String OFFLINE_URL = "file:///android_asset/offline.html";
    private static WeakReference<MainActivity> instance = new WeakReference<>(null);

    private final String startUrl = BuildConfig.SERVER_URL + BuildConfig.START_PATH;
    private final String serverHost = Uri.parse(BuildConfig.SERVER_URL).getHost();

    private WebView webView;
    private FrameLayout root;
    private long startedAt;
    private volatile boolean pageReady = false;
    private int insT, insR, insB, insL;

    private ProtectionController protection;
    private OnBackPressedCallback backCallback;
    private boolean webHandlesBack = false;
    private boolean externalUntil = false;
    private long lastBackToast = 0;

    // WebView (getUserMedia) kamera ruxsati va fayl tanlash
    private PermissionRequest pendingWebPermission;
    private ValueCallback<Uri[]> fileCallback;
    private ActivityResultLauncher<Intent> fileLauncher;
    // Native ruxsatlar va QR skaner
    private ActivityResultLauncher<String> permLauncher;
    private ActivityResultLauncher<Intent> qrLauncher;
    private PermCallback permCallback;
    private QrCallback qrCallback;

    interface PermCallback { void done(boolean granted); }
    interface QrCallback { void done(JSONObject result); }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen splash = SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
        instance = new WeakReference<>(this);
        startedAt = SystemClock.uptimeMillis();
        splash.setKeepOnScreenCondition(() -> !pageReady && SystemClock.uptimeMillis() - startedAt < 4000);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        protection = new ProtectionController(this);
        protection.recoverStaleState();

        fileLauncher = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), r -> {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r.getResultCode(), r.getData()));
                fileCallback = null;
            }
        });
        permLauncher = registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> {
            PermCallback cb = permCallback; permCallback = null;
            if (cb != null) cb.done(Boolean.TRUE.equals(granted));
            emit("permissionChanged", "{}");
        });
        qrLauncher = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), r -> {
            QrCallback cb = qrCallback; qrCallback = null;
            if (cb == null) return;
            try {
                Intent d = r.getData();
                if (r.getResultCode() == RESULT_OK && d != null && d.hasExtra(QrScannerActivity.EXTRA_TEXT)) cb.done(new JSONObject().put("text", d.getStringExtra(QrScannerActivity.EXTRA_TEXT)));
                else {
                    String err = d != null ? d.getStringExtra(QrScannerActivity.EXTRA_ERROR) : null;
                    if ("permission_denied".equals(err)) cb.done(new JSONObject().put("error", "permission_denied"));
                    else if (err != null && !"cancelled".equals(err)) cb.done(new JSONObject().put("error", err));
                    else cb.done(new JSONObject().put("cancelled", true));
                }
            } catch (Exception e) { /* ignore */ }
        });

        // Orqaga tugmasi: web hal qila olsa shunga yuboriladi; dars paytida doim shunga (qulf xabari)
        backCallback = new OnBackPressedCallback(false) {
            @Override public void handleOnBackPressed() { emit("backPressed", "{}"); }
        };
        getOnBackPressedDispatcher().addCallback(this, backCallback);

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

    // ---------------------------------------------------------------- tashqi chaqiruvlar (xizmat/ko'prik)
    ProtectionController protection() { return protection; }
    void markExternal() { externalUntil = true; }

    void emit(String event, String json) {
        evalJs("window.__efNative&&window.__efNative.emit(" + JSONObject.quote(event) + "," + JSONObject.quote(json) + ")");
    }

    void evalJs(String js) {
        runOnUiThread(() -> { if (webView != null) webView.evaluateJavascript(js, null); });
    }

    void reloadStart() { if (webView != null) webView.loadUrl(startUrl); }

    void setBackHandled(boolean v) { webHandlesBack = v; updateBackCallback(); }
    private void updateBackCallback() { if (backCallback != null) backCallback.setEnabled(webHandlesBack || (protection != null && protection.isActive())); }

    void askRuntimePermission(String permission, PermCallback cb) {
        if (checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) { cb.done(true); return; }
        permCallback = cb;
        permLauncher.launch(permission);
    }

    void scanQr(QrCallback cb) {
        askRuntimePermission(Manifest.permission.CAMERA, granted -> {
            try {
                if (!granted) { cb.done(new JSONObject().put("error", "permission_denied")); return; }
            } catch (Exception ignored) { }
            qrCallback = cb;
            qrLauncher.launch(new Intent(this, QrScannerActivity.class));
        });
    }

    static void notifyForeign() {
        MainActivity a = instance.get();
        if (a != null) a.runOnUiThread(() -> a.emit("protectionChanged", "{}"));
    }
    static void notifyPermissionsChanged() {
        MainActivity a = instance.get();
        if (a != null) a.runOnUiThread(() -> a.emit("permissionChanged", "{}"));
    }

    // ---------------------------------------------------------------- WebView
    private void setupWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
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

        webView.addJavascriptInterface(new NativeBridge(this), "AndroidBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return handleNavigation(request.getUrl()); }
            @Override public void onPageFinished(WebView view, String url) { pageReady = true; pushInsets(); }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) { if (request.isForMainFrame()) showOffline(); }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                if (request.isForMainFrame() && errorResponse.getStatusCode() >= 500) showOffline();   // tunnel/proxy xatolari
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
                    askRuntimePermission(Manifest.permission.CAMERA, granted -> {
                        if (granted) request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE}); else request.deny();
                    });
                });
            }

            @Override
            public boolean onShowFileChooser(WebView w, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try { fileLauncher.launch(params.createIntent()); } catch (Exception e) { fileCallback = null; return false; }
                return true;
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, final JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("OK", (d, w) -> result.confirm()).setOnCancelListener(d -> result.cancel()).show();
                return true;
            }
            @Override
            public boolean onJsConfirm(WebView view, String url, String message, final JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("OK", (d, w) -> result.confirm()).setNegativeButton("✕", (d, w) -> result.cancel()).setOnCancelListener(d -> result.cancel()).show();
                return true;
            }
            @Override
            public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, final JsPromptResult result) {
                final EditText input = new EditText(MainActivity.this);
                input.setText(defaultValue);
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setView(input).setPositiveButton("OK", (d, w) -> result.confirm(input.getText().toString())).setNegativeButton("✕", (d, w) -> result.cancel()).setOnCancelListener(d -> result.cancel()).show();
                return true;
            }
        });
    }

    /** Faqat o'z serveri WebView ichida; tashqi havolalar Custom Tabs'da (dars paytida bloklanadi). */
    private boolean handleNavigation(Uri uri) {
        if (uri == null) return true;
        String scheme = uri.getScheme();
        if ("file".equals(scheme) && OFFLINE_URL.equals(uri.toString())) return false;
        boolean web = "http".equals(scheme) || "https".equals(scheme);
        if (web && serverHost != null && serverHost.equals(uri.getHost())) return false;
        if (web && !protection.isActive()) {
            try { markExternal(); new androidx.browser.customtabs.CustomTabsIntent.Builder().build().launchUrl(this, uri); } catch (Exception ignored) { }
        } else {
            Toast.makeText(this, R.string.locked_toast, Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private void showOffline() {
        pageReady = true;
        String cur = webView.getUrl();
        if (cur != null && cur.startsWith("file:///android_asset/offline")) return;
        webView.loadUrl(OFFLINE_URL);
    }

    // ---------------------------------------------------------------- xavfsiz hudud va tizim panellari
    private void pushInsets() {
        if (webView == null) return;
        float d = getResources().getDisplayMetrics().density;
        webView.evaluateJavascript(String.format(Locale.US, "window.setNativeInsets&&window.setNativeInsets(%.1f,%.1f,%.1f,%.1f)", insT / d, insR / d, insB / d, insL / d), null);
    }

    void setBarsDark(boolean dark) {
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), root);
        c.setAppearanceLightStatusBars(!dark);
        c.setAppearanceLightNavigationBars(!dark);
    }

    // ---------------------------------------------------------------- hayot sikli
    @Override
    protected void onResume() {
        super.onResume();
        externalUntil = false;
        protection.onResume();
        updateBackCallback();
        emit("permissionChanged", "{}");        // sozlamalardan qaytganda holat yangilanadi
    }

    @Override
    protected void onPause() {
        super.onPause();
        protection.onPause();
    }

    @Override
    public void onMultiWindowModeChanged(boolean isInMultiWindowMode, Configuration newConfig) {
        super.onMultiWindowModeChanged(isInMultiWindowMode, newConfig);
        emit("protectionChanged", "{}");
    }

    @Override
    protected void onDestroy() {
        if (protection != null) protection.onDestroy();
        if (webView != null) { root.removeView(webView); webView.destroy(); webView = null; }
        super.onDestroy();
    }

    @Override
    public boolean dispatchKeyEvent(android.view.KeyEvent event) { return super.dispatchKeyEvent(event); }
}
