package com.edufocus.app;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityEvent;

import java.util.Set;

/**
 * "direct" versiyasi: dars paytida boshqa ilova oldinga chiqsa, EduFocus qaytariladi.
 * Ekran mazmuni o'qilmaydi (canRetrieveWindowContent=false); paket nomi faqat shu yerda solishtiriladi.
 */
public class LockAccessibilityService extends AccessibilityService {
    private Set<String> allowed;
    private long allowedAt = 0;
    private long lastBringBack = 0;

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (!LockAccessibility.enforcing || event == null || event.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
        CharSequence pkgCs = event.getPackageName();
        if (pkgCs == null) return;
        long now = SystemClock.elapsedRealtime();
        if (allowed == null || now - allowedAt > 30000) { allowed = LockAccessibility.allowed(this); allowedAt = now; }
        String pkg = pkgCs.toString();
        if (allowed.contains(pkg)) return;
        LockAccessibility.lastForeignAt = now;
        if (now - lastBringBack > 700) {                 // tez-tez qayta chaqirmaslik uchun
            lastBringBack = now;
            Intent i = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            try { startActivity(i); } catch (Exception ignored) { }
        }
        MainActivity.notifyForeign();
    }

    @Override
    public void onInterrupt() { }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        MainActivity.notifyPermissionsChanged();
    }

    @Override
    public boolean onUnbind(Intent intent) {
        MainActivity.notifyPermissionsChanged();
        return super.onUnbind(intent);
    }
}
