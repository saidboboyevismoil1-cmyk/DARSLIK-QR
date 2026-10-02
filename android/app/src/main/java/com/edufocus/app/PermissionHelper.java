package com.edufocus.app;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Locale;

/** Ruxsat holatlari va ularni sozlash ekranlariga yo'llash. Holati tekshirib bo'lmaydiganlar 'unknown' + guide. */
final class PermissionHelper {
    private PermissionHelper() { }

    static boolean dnd(Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        return nm != null && nm.isNotificationPolicyAccessGranted();
    }
    static boolean battery(Context c) {
        PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(c.getPackageName());
    }
    static boolean notifications(Context c) {
        if (Build.VERSION.SDK_INT >= 33) return c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        return NotificationManagerCompat.from(c).areNotificationsEnabled();
    }
    static boolean camera(Context c) { return c.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED; }

    static String brand() { return Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase(Locale.ROOT); }
    static boolean needsAutostart() {
        String b = brand();
        return b.contains("xiaomi") || b.contains("huawei") || b.contains("honor") || b.contains("oppo") || b.contains("realme") || b.contains("oneplus") || b.contains("tecno") || b.contains("infinix") || b.contains("vivo");
    }

    static String status(Context c, String id) {
        switch (id) {
            case "accessibility": return !BuildConfig.ACCESSIBILITY ? "na" : LockAccessibility.isServiceEnabled(c) ? "granted" : "denied";
            case "dnd": return dnd(c) ? "granted" : "denied";
            case "battery": return battery(c) ? "granted" : "denied";
            case "notifications": return notifications(c) ? "granted" : "denied";
            case "camera": return camera(c) ? "granted" : "denied";
            case "autostart": return needsAutostart() ? "unknown" : "na";
            case "pinning": return "unknown";
            default: return "na";
        }
    }

    static JSONArray list(Context c) throws JSONException {
        JSONArray a = new JSONArray();
        String[] ids = {"accessibility", "dnd", "battery", "autostart", "notifications", "camera", "pinning"};
        for (String id : ids) {
            String st = status(c, id);
            if ("na".equals(st)) continue;
            boolean guide = id.equals("battery") || id.equals("autostart") || id.equals("pinning");
            a.put(new JSONObject().put("id", id).put("status", st).put("canRequest", !guide).put("guide", guide));
        }
        return a;
    }

    /** Tegishli tizim sozlamalari ekrani. */
    static Intent settingsIntent(Context c, String id) {
        Intent i;
        switch (id) {
            case "accessibility": i = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS); break;
            case "dnd": i = new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS); break;
            case "battery": i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS); break;
            case "notifications":
                i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, c.getPackageName()); break;
            default:
                i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", c.getPackageName(), null));
        }
        return i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    }
}
