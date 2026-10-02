package com.edufocus.app;

import android.app.ActivityManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Dars himoyasi (Android): ekranni mahkamlash (startLockTask) + DND + (direct) Accessibility.
 * Barcha vaqtlar monotonik soat bilan (telefon soatini o'zgartirish ta'sir qilmaydi).
 * Muhim: ilovalar ro'yxati/paket nomlari hech qayerga yuborilmaydi.
 */
final class ProtectionController {
    interface Result { void done(JSONObject data); }

    private final MainActivity act;
    private final Handler h = new Handler(Looper.getMainLooper());

    private boolean active;
    private String level = "";
    private long endsAt;            // elapsedRealtime; 0 = taymer yo'q
    private long offlineMs = 15 * 60 * 1000L;
    private long lastContact;
    private boolean sos;
    private long sosStart;
    private boolean fgResumed = true;
    private long lastRepin;
    private int prevFilter = -1;
    private NotificationManager.Policy prevPolicy;
    private boolean dndApplied;
    private String lastSig = "";

    private final Runnable ticker = new Runnable() {
        @Override public void run() { tick(); if (active) h.postDelayed(this, 1000); }
    };

    ProtectionController(MainActivity act) { this.act = act; }

    boolean isActive() { return active; }

    // ---------------------------------------------------------------- holat
    private boolean isPinned() {
        ActivityManager am = (ActivityManager) act.getSystemService(Context.ACTIVITY_SERVICE);
        return am != null && am.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE;
    }
    private boolean dndOn() {
        NotificationManager nm = (NotificationManager) act.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return false;
        int f = nm.getCurrentInterruptionFilter();
        return f != NotificationManager.INTERRUPTION_FILTER_ALL && f != NotificationManager.INTERRUPTION_FILTER_UNKNOWN;
    }
    private boolean inCall() {
        AudioManager am = (AudioManager) act.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return false;
        int m = am.getMode();
        return m == AudioManager.MODE_IN_CALL || m == AudioManager.MODE_RINGTONE || m == AudioManager.MODE_IN_COMMUNICATION;
    }
    private boolean devOptions() {
        try { return Settings.Global.getInt(act.getContentResolver(), Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) == 1; } catch (Exception e) { return false; }
    }
    private boolean a11yShortcut() {
        try {
            String s = Settings.Secure.getString(act.getContentResolver(), "accessibility_shortcut_target_service");
            return s != null && !s.isEmpty() && s.contains(act.getPackageName());
        } catch (Exception e) { return false; }
    }

    JSONObject state() {
        JSONObject o = new JSONObject();
        try {
            boolean full = "android-full".equals(level);
            boolean pinned = sos || isPinned();
            boolean dnd = dndOn() && PermissionHelper.dnd(act);   // ruxsat bekor qilinsa DND'ni majburlab bo'lmaydi
            boolean a11y = !full || LockAccessibility.isServiceEnabled(act);
            boolean multi = Build.VERSION.SDK_INT >= 24 && act.isInMultiWindowMode();
            boolean foreign = SystemClock.elapsedRealtime() - LockAccessibility.lastForeignAt < 3000 && full;
            boolean fg = (fgResumed && !multi && !foreign) || sos;
            JSONObject checks = new JSONObject().put("pinned", pinned).put("dnd", dnd).put("foreground", fg)
                    .put("devOptions", devOptions()).put("a11yShortcut", a11yShortcut());
            if (full) checks.put("accessibility", a11y);
            JSONArray reasons = new JSONArray();
            if (active && !sos) {
                if (!pinned) reasons.put("not_pinned");
                if (full && !a11y) reasons.put("no_accessibility");
                if (!dnd) reasons.put("no_dnd");
                if (!fg) reasons.put("background");
            }
            boolean ok = active && reasons.length() == 0;
            o.put("active", ok || (active && sos)).put("reasons", reasons).put("checks", checks).put("fg", fg).put("level", level);
        } catch (Exception ignored) { }
        return o;
    }

    private String signature(JSONObject s) {
        try { return s.getBoolean("active") + "|" + s.getJSONArray("reasons") + "|" + s.getJSONObject("checks"); } catch (Exception e) { return ""; }
    }

    // ---------------------------------------------------------------- boshlash / to'xtatish
    void start(JSONObject args, Result cb) {
        final String lvl = args.optString("level", "android-lite");
        final boolean full = "android-full".equals(lvl);
        if (!full && !"android-lite".equals(lvl)) { cb.done(fail("error")); return; }
        if (active) {                      // "Qayta yoqish": buzilgan qismlarni tiklaymiz
            if (!dndOn()) applyDnd();
            if (!sos && !isPinned()) tryRepin();
            lastContact = SystemClock.elapsedRealtime();
            cb.done(ok(lvl));
            return;
        }
        if (full && !BuildConfig.ACCESSIBILITY) { cb.done(fail("accessibility")); return; }
        if (full && !LockAccessibility.isServiceEnabled(act)) { cb.done(fail("accessibility")); return; }
        if (!PermissionHelper.dnd(act)) { cb.done(fail("dnd")); return; }

        level = lvl;
        long endsIn = args.optLong("endsInSec", 0);
        endsAt = endsIn > 0 ? SystemClock.elapsedRealtime() + endsIn * 1000 : 0;
        offlineMs = Math.max(60, args.optLong("offlineReleaseSec", 900)) * 1000;
        lastContact = SystemClock.elapsedRealtime();

        applyDnd();
        try { act.startLockTask(); } catch (Exception e) { restoreDnd(); cb.done(fail("pinning_failed")); return; }

        // Tizim "Ekranni mahkamlash" tasdiqlash oynasini ko'rsatadi: foydalanuvchi javob berguncha kutamiz
        final long t0 = SystemClock.elapsedRealtime();
        final boolean[] sawFocusLoss = {false};
        Runnable poll = new Runnable() {
            @Override public void run() {
                if (isPinned()) { begin(); cb.done(ok(lvl)); return; }
                if (!act.hasWindowFocus()) sawFocusLoss[0] = true;
                long el = SystemClock.elapsedRealtime() - t0;
                if ((sawFocusLoss[0] && act.hasWindowFocus() && el > 1200) || el > 45000) {
                    restoreDnd();
                    try { act.stopLockTask(); } catch (Exception ignored) { }
                    cb.done(fail("user_declined"));
                    return;
                }
                h.postDelayed(this, 250);
            }
        };
        h.postDelayed(poll, 300);
    }

    private void begin() {
        active = true;
        sos = false;
        lastSig = "";
        LockAccessibility.enforcing = BuildConfig.ACCESSIBILITY && "android-full".equals(level);
        h.removeCallbacks(ticker);
        h.postDelayed(ticker, 1000);
        act.emit("protectionChanged", "{}");
    }

    void stop(String reason) {
        boolean was = active;
        active = false; sos = false;
        LockAccessibility.enforcing = false;
        h.removeCallbacks(ticker);
        try { act.stopLockTask(); } catch (Exception ignored) { }
        restoreDnd();
        if (was) act.emit("protectionChanged", "{}");
    }

    private void autoRelease(String reason) {
        stop(reason);
        try { act.emit("autoRelease", new JSONObject().put("reason", reason).toString()); } catch (Exception ignored) { }
    }

    private void applyDnd() {
        try {
            NotificationManager nm = (NotificationManager) act.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null || !nm.isNotificationPolicyAccessGranted()) return;
            prevFilter = nm.getCurrentInterruptionFilter();
            prevPolicy = nm.getNotificationPolicy();
            // Qo'ng'iroqlar va takroriy qo'ng'iroqlar ruxsat etiladi; qolgan bildirishnomalar jim
            nm.setNotificationPolicy(new NotificationManager.Policy(
                    NotificationManager.Policy.PRIORITY_CATEGORY_CALLS | NotificationManager.Policy.PRIORITY_CATEGORY_REPEAT_CALLERS,
                    NotificationManager.Policy.PRIORITY_SENDERS_ANY, NotificationManager.Policy.PRIORITY_SENDERS_ANY));
            nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY);
            dndApplied = true;
            act.getSharedPreferences("ef_state", Context.MODE_PRIVATE).edit().putBoolean("dnd_applied", true).putInt("dnd_prev", prevFilter).apply();
        } catch (Exception ignored) { }
    }

    private void restoreDnd() {
        if (!dndApplied) return;
        dndApplied = false;
        clearDndFlag();
        applyRestore(prevFilter, prevPolicy);
    }

    private void applyRestore(int filter, NotificationManager.Policy policy) {
        try {
            NotificationManager nm = (NotificationManager) act.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null || !nm.isNotificationPolicyAccessGranted()) return;
            if (policy != null) nm.setNotificationPolicy(policy);
            // Android 15+: setInterruptionFilter ilovaning o'z "implicit rule"ini boshqaradi — uni o'chirish uchun ALL
            int target = Build.VERSION.SDK_INT >= 35 || filter < 0 ? NotificationManager.INTERRUPTION_FILTER_ALL : filter;
            nm.setInterruptionFilter(target);
        } catch (Exception ignored) { }
    }

    private void clearDndFlag() { act.getSharedPreferences("ef_state", Context.MODE_PRIVATE).edit().remove("dnd_applied").remove("dnd_prev").apply(); }

    /** Ilova dars paytida majburan yopilgan bo'lsa, qolib ketgan DND ni ishga tushganda tiklaydi. */
    void recoverStaleState() {
        android.content.SharedPreferences sp = act.getSharedPreferences("ef_state", Context.MODE_PRIVATE);
        if (!active && sp.getBoolean("dnd_applied", false)) {
            int prev = sp.getInt("dnd_prev", -1);
            clearDndFlag();
            applyRestore(prev, null);
        }
    }

    /** Qo'shilgandan keyin dars siyosati ma'lum bo'lganda taymerlarni yangilash. */
    void update(JSONObject args) {
        if (!active) return;
        long endsIn = args.optLong("endsInSec", 0);
        if (endsIn > 0) endsAt = SystemClock.elapsedRealtime() + endsIn * 1000;
        long off = args.optLong("offlineReleaseSec", 0);
        if (off > 0) offlineMs = Math.max(60, off) * 1000;
        lastContact = SystemClock.elapsedRealtime();
    }

    // ---------------------------------------------------------------- server aloqasi va taymerlar
    void serverContact(long remainingSec) {
        lastContact = SystemClock.elapsedRealtime();
        if (remainingSec > 0) endsAt = lastContact + remainingSec * 1000;
    }

    private void tick() {
        if (!active) return;
        long now = SystemClock.elapsedRealtime();
        if (endsAt > 0 && now >= endsAt) { autoRelease("timer"); return; }
        if (now - lastContact >= offlineMs) { autoRelease("offline"); return; }
        if (sos) {
            if (now - sosStart > 2000 && fgResumed && !inCall()) { sos = false; LockAccessibility.enforcing = BuildConfig.ACCESSIBILITY && "android-full".equals(level); tryRepin(); }
        } else if (!isPinned() && fgResumed && now - lastRepin > 10000) {
            tryRepin();                    // pinning olib tashlangan: qayta so'raymiz
        }
        String sig = signature(state());
        if (!sig.equals(lastSig)) { lastSig = sig; act.emit("protectionChanged", "{}"); }
    }

    private void tryRepin() {
        lastRepin = SystemClock.elapsedRealtime();
        try { act.startLockTask(); } catch (Exception ignored) { }
    }

    // ---------------------------------------------------------------- SOS (hech qachon bloklanmaydi)
    void sos(String number, Result cb) {
        try {
            if (active) {
                sos = true; sosStart = SystemClock.elapsedRealtime();
                LockAccessibility.enforcing = false;
                try { act.stopLockTask(); } catch (Exception ignored) { }
            }
            Intent i = new Intent(Intent.ACTION_DIAL, number == null || number.isEmpty() ? null : Uri.fromParts("tel", number, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            act.startActivity(i);
            cb.done(new JSONObject().put("ok", true));
        } catch (Exception e) {
            sos = false;
            cb.done(fail("error"));
        }
    }

    // ---------------------------------------------------------------- Activity hayot sikli
    void onResume() {
        fgResumed = true;
        if (active) { String sig = signature(state()); if (!sig.equals(lastSig)) { lastSig = sig; act.emit("protectionChanged", "{}"); } }
    }
    void onPause() {
        fgResumed = false;
        if (active) { String sig = signature(state()); if (!sig.equals(lastSig)) { lastSig = sig; act.emit("protectionChanged", "{}"); } }
    }
    void onDestroy() { h.removeCallbacksAndMessages(null); if (active) { LockAccessibility.enforcing = false; restoreDnd(); active = false; } }

    private static JSONObject ok(String lvl) { try { return new JSONObject().put("ok", true).put("level", lvl); } catch (Exception e) { return new JSONObject(); } }
    private static JSONObject fail(String reason) { try { return new JSONObject().put("ok", false).put("reason", reason); } catch (Exception e) { return new JSONObject(); } }
}
