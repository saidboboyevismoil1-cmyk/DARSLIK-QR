package com.edufocus.app;

import android.Manifest;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.webkit.JavascriptInterface;

import androidx.browser.customtabs.CustomTabsIntent;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Veb ↔ native ko'prik (window.AndroidBridge). Protokol: docs/lock-mode/native-bridge.md
 * Har chaqiruv aynan bitta javob qaytaradi: window.__efNative.resolve(id, json).
 */
public class NativeBridge {
    private final MainActivity act;

    NativeBridge(MainActivity act) { this.act = act; }

    @JavascriptInterface
    public void invoke(final int id, final String method, final String argsJson) {
        act.runOnUiThread(() -> {
            try {
                JSONObject args = new JSONObject(argsJson == null || argsJson.isEmpty() ? "{}" : argsJson);
                dispatch(id, method, args);
            } catch (Exception e) {
                reply(id, false, "error:" + e.getClass().getSimpleName());
            }
        });
    }

    @JavascriptInterface
    public void retry() { act.runOnUiThread(act::reloadStart); }

    @JavascriptInterface
    public String getServerUrl() { return BuildConfig.SERVER_URL; }

    // ---------------------------------------------------------------- javob
    void reply(int id, boolean ok, Object dataOrError) {
        try {
            JSONObject r = new JSONObject().put("ok", ok);
            if (ok) r.put("data", dataOrError == null ? JSONObject.NULL : dataOrError); else r.put("error", String.valueOf(dataOrError));
            act.evalJs("window.__efNative&&window.__efNative.resolve(" + id + "," + JSONObject.quote(r.toString()) + ")");
        } catch (Exception ignored) { }
    }

    private void dispatch(int id, String method, JSONObject a) throws Exception {
        switch (method) {
            case "info": reply(id, true, info()); break;
            case "permissions": reply(id, true, PermissionHelper.list(act)); break;
            case "requestPermission": requestPermission(id, a.optString("id")); break;
            case "openSettings": openSettings(a.optString("id")); reply(id, true, new JSONObject().put("ok", true)); break;
            case "deviceKey": reply(id, true, new JSONObject().put("key", DeviceKey.get(act))); break;
            case "attest": attest(id, a.optString("nonce")); break;
            case "protection.dryRun": dryRun(id, a); break;
            case "protection.start": act.protection().start(a, d -> reply(id, true, d)); break;
            case "protection.update": act.protection().update(a); reply(id, true, new JSONObject().put("ok", true)); break;
            case "protection.state": reply(id, true, act.protection().state()); break;
            case "protection.stop": act.protection().stop(a.optString("reason", "teacher")); reply(id, true, new JSONObject().put("ok", true)); break;
            case "serverContact": act.protection().serverContact(a.optLong("remainingSeconds", 0)); reply(id, true, new JSONObject().put("ok", true)); break;
            case "sos": act.protection().sos(a.optString("number", ""), d -> reply(id, true, d)); break;
            case "scanQR": act.scanQr(r -> { if (r.has("error")) reply(id, true, r); else reply(id, true, r); }); break;
            case "openExternal": reply(id, true, new JSONObject().put("ok", openExternal(a.optString("url")))); break;
            case "openCalculator": reply(id, true, new JSONObject().put("ok", openCalculator())); break;
            case "setBackHandled": act.setBackHandled(a.optBoolean("value", false)); reply(id, true, new JSONObject().put("ok", true)); break;
            case "setSystemBarsDark": act.setBarsDark(a.optBoolean("dark", false)); reply(id, true, new JSONObject().put("ok", true)); break;
            case "setPullToRefresh": reply(id, true, new JSONObject().put("ok", true)); break;
            case "exitApp": act.protection().stop("exit"); reply(id, true, new JSONObject().put("ok", true)); act.finishAndRemoveTask(); break;
            default: reply(id, false, "unsupported");
        }
    }

    private JSONObject info() throws Exception {
        boolean direct = BuildConfig.ACCESSIBILITY;
        JSONArray cand = new JSONArray();
        if (direct) cand.put("android-full");
        cand.put("android-lite").put("android-l0");
        JSONObject req = new JSONObject();
        if (direct) req.put("android-full", new JSONArray().put("accessibility").put("dnd"));
        req.put("android-lite", new JSONArray().put("dnd")).put("android-l0", new JSONArray());
        return new JSONObject().put("platform", "android").put("flavor", BuildConfig.FLAVOR).put("appVersion", BuildConfig.VERSION_NAME)
                .put("osVersion", String.valueOf(Build.VERSION.RELEASE)).put("brand", PermissionHelper.brand()).put("model", Build.MODEL)
                .put("candidates", cand).put("requires", req)
                .put("features", new JSONObject().put("iosL1", false).put("iosL2", false).put("nativeScan", true));
    }

    // ---------------------------------------------------------------- ruxsatlar
    private void requestPermission(int id, String perm) throws Exception {
        switch (perm) {
            case "camera":
                act.askRuntimePermission(Manifest.permission.CAMERA, g -> reply(id, true, status("camera")));
                break;
            case "notifications":
                if (Build.VERSION.SDK_INT >= 33) act.askRuntimePermission(Manifest.permission.POST_NOTIFICATIONS, g -> reply(id, true, status("notifications")));
                else { openSettings("notifications"); reply(id, true, status("notifications")); }
                break;
            case "accessibility":
                if (!BuildConfig.ACCESSIBILITY) { reply(id, true, status("accessibility")); break; }
                // Google Play "prominent disclosure": sozlamalarga yo'llashdan oldin aniq tushuntirish
                new AlertDialog.Builder(act).setTitle(R.string.a11y_title).setMessage(R.string.a11y_disclosure).setCancelable(true)
                        .setPositiveButton(R.string.a11y_allow, (d, w) -> { openSettings("accessibility"); safe(id, status("accessibility")); })
                        .setNegativeButton(R.string.a11y_cancel, (d, w) -> safe(id, status("accessibility")))
                        .setOnCancelListener(d -> safe(id, status("accessibility"))).show();
                break;
            default:
                openSettings(perm);
                reply(id, true, status(perm));
        }
    }

    private JSONObject status(String perm) { try { return new JSONObject().put("status", PermissionHelper.status(act, perm)); } catch (Exception e) { return new JSONObject(); } }
    private void safe(int id, JSONObject o) { reply(id, true, o); }

    private void openSettings(String perm) {
        try { act.startActivity(PermissionHelper.settingsIntent(act, perm)); }
        catch (Exception e) {
            try { act.startActivity(new Intent(android.provider.Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (Exception ignored) { }
        }
    }

    // ---------------------------------------------------------------- attestatsiya
    private void attest(int id, String nonce) {
        Attestor.request(act, nonce, (token, err) -> {
            try {
                if (token != null) reply(id, true, new JSONObject().put("token", token));
                else reply(id, true, new JSONObject().put("error", err));
            } catch (Exception e) { reply(id, false, "error"); }
        });
    }

    // ---------------------------------------------------------------- himoya sinovi: yoqadi → tekshiradi → o'chiradi
    private void dryRun(int id, JSONObject a) {
        if (act.protection().isActive()) { reply(id, true, okJson()); return; }
        try {
            JSONObject args = new JSONObject().put("level", a.optString("level", "android-lite")).put("endsInSec", 20).put("offlineReleaseSec", 120);
            act.protection().start(args, d -> {
                boolean ok = d.optBoolean("ok", false);
                if (ok) act.protection().stop("dryRun");
                reply(id, true, d);
            });
        } catch (Exception e) { reply(id, true, fail("error")); }
    }
    private static JSONObject okJson() { try { return new JSONObject().put("ok", true); } catch (Exception e) { return new JSONObject(); } }
    private static JSONObject fail(String r) { try { return new JSONObject().put("ok", false).put("reason", r); } catch (Exception e) { return new JSONObject(); } }

    // ---------------------------------------------------------------- tashqi havola va kalkulyator
    private boolean openExternal(String url) {
        try {
            Uri u = Uri.parse(url);
            String sc = u.getScheme();
            if (!"http".equals(sc) && !"https".equals(sc)) return false;
            act.markExternal();
            new CustomTabsIntent.Builder().build().launchUrl(act, u);   // Custom Tabs
            return true;
        } catch (ActivityNotFoundException e) {
            try { act.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return true; } catch (Exception ignored) { return false; }
        } catch (Exception e) { return false; }
    }

    private boolean openCalculator() {
        try {
            act.markExternal();
            Intent i = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_CALCULATOR).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            act.startActivity(i);
            return true;
        } catch (Exception e) { return false; }
    }
}
