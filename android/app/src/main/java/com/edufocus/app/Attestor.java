package com.edufocus.app;

import android.content.Context;

import com.google.android.play.core.integrity.IntegrityManager;
import com.google.android.play.core.integrity.IntegrityManagerFactory;
import com.google.android.play.core.integrity.IntegrityTokenRequest;

/** Play Integrity tokeni (server nonce bilan). Google Cloud loyiha raqami sozlanmagan bo'lsa — 'not_configured'. */
final class Attestor {
    interface Callback { void done(String token, String error); }

    private Attestor() { }

    static void request(Context ctx, String nonce, Callback cb) {
        if (BuildConfig.GOOGLE_CLOUD_PROJECT_NUMBER <= 0L) { cb.done(null, "not_configured"); return; }
        try {
            IntegrityManager im = IntegrityManagerFactory.create(ctx.getApplicationContext());
            im.requestIntegrityToken(IntegrityTokenRequest.builder()
                            .setNonce(nonce)
                            .setCloudProjectNumber(BuildConfig.GOOGLE_CLOUD_PROJECT_NUMBER)
                            .build())
                    .addOnSuccessListener(r -> cb.done(r.token(), null))
                    .addOnFailureListener(e -> cb.done(null, "integrity_error"));
        } catch (Exception e) {
            cb.done(null, "integrity_error");
        }
    }
}
