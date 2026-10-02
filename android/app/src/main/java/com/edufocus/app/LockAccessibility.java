package com.edufocus.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.provider.Settings;
import android.telecom.TelecomManager;
import android.view.inputmethod.InputMethodInfo;
import android.view.inputmethod.InputMethodManager;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Accessibility yordamchisi (ikkala flavor'da mavjud; xizmat sinfi faqat 'direct' da).
 * Paket nomlari faqat qurilmada solishtiriladi — serverga yoki logga yozilmaydi.
 */
final class LockAccessibility {
    /** Xizmat foreground ilovani tekshirishi kerakmi (dars paytida true). */
    static volatile boolean enforcing = false;
    /** Oxirgi "begona oyna" vaqti (elapsedRealtime). */
    static volatile long lastForeignAt = 0;

    private LockAccessibility() { }

    static boolean isServiceEnabled(Context ctx) {
        if (!BuildConfig.ACCESSIBILITY) return false;
        try {
            String enabled = Settings.Secure.getString(ctx.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            if (enabled == null) return false;
            String me = new ComponentName(ctx.getPackageName(), "com.edufocus.app.LockAccessibilityService").flattenToString();
            String meShort = new ComponentName(ctx.getPackageName(), "com.edufocus.app.LockAccessibilityService").flattenToShortString();
            for (String s : enabled.split(":")) if (s.equalsIgnoreCase(me) || s.equalsIgnoreCase(meShort)) return true;
        } catch (Exception ignored) { }
        return false;
    }

    /** Dars paytida ko'rinishiga ruxsat etilgan paketlar: o'zimiz, tizim UI, klaviatura, telefon/favqulodda qo'ng'iroq, ruxsat oynalari. */
    static Set<String> allowed(Context ctx) {
        Set<String> s = new HashSet<>();
        s.add(ctx.getPackageName());
        s.add("android");
        s.add("com.android.systemui");
        s.add("com.android.server.telecom");
        s.add("com.android.phone");
        s.add("com.android.incallui");
        s.add("com.android.dialer");
        s.add("com.google.android.dialer");
        s.add("com.samsung.android.incallui");
        s.add("com.samsung.android.dialer");
        s.add("com.android.emergency");
        s.add("com.google.android.apps.safetyhub");
        s.add("com.android.permissioncontroller");
        s.add("com.google.android.permissioncontroller");
        try {
            TelecomManager tm = (TelecomManager) ctx.getSystemService(Context.TELECOM_SERVICE);
            if (tm != null) { String d = tm.getDefaultDialerPackage(); if (d != null) s.add(d); }
        } catch (Exception ignored) { }
        try {
            InputMethodManager imm = (InputMethodManager) ctx.getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm != null) for (InputMethodInfo i : imm.getEnabledInputMethodList()) s.add(i.getPackageName());
        } catch (Exception ignored) { }
        try {   // ACTION_DIAL ni hal qiladigan ilovalar (telefon)
            PackageManager pm = ctx.getPackageManager();
            List<ResolveInfo> l = pm.queryIntentActivities(new Intent(Intent.ACTION_DIAL), 0);
            for (ResolveInfo r : l) s.add(r.activityInfo.packageName);
        } catch (Exception ignored) { }
        return s;
    }
}
