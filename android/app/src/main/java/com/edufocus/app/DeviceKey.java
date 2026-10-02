package com.edufocus.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.security.KeyStore;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Qurilma kaliti: tasodifiy 24 bayt, Android Keystore'dagi AES-GCM kalit bilan shifrlanib saqlanadi.
 * Server faqat uning SHA-256 hash'ini ko'radi. Zaxira nusxaga kirmaydi (data_extraction_rules).
 */
final class DeviceKey {
    private static final String ALIAS = "edufocus_device_key_wrap";
    private static final String PREFS = "ef_secure";
    private static final String KEY = "dk";

    private DeviceKey() { }

    static synchronized String get(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String stored = sp.getString(KEY, null);
        if (stored != null) {
            try {
                String v = decrypt(stored);
                if (v != null && v.length() >= 16) return v;
            } catch (Exception ignored) { /* kalit buzilgan — yangisini yaratamiz */ }
        }
        byte[] raw = new byte[24];
        new SecureRandom().nextBytes(raw);
        StringBuilder sb = new StringBuilder("dk-");
        for (byte b : raw) sb.append(String.format("%02x", b));
        String key = sb.toString();
        try {
            sp.edit().putString(KEY, encrypt(key)).apply();
        } catch (Exception ignored) { /* Keystore ishlamasa ham kalit shu sessiya uchun ishlaydi */ }
        return key;
    }

    private static SecretKey wrapKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (!ks.containsAlias(ALIAS)) {
            KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            kg.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256).build());
            return kg.generateKey();
        }
        return (SecretKey) ks.getKey(ALIAS, null);
    }

    private static String encrypt(String plain) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, wrapKey());
        byte[] iv = c.getIV();
        byte[] ct = c.doFinal(plain.getBytes("UTF-8"));
        return Base64.encodeToString(iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP);
    }

    private static String decrypt(String stored) throws Exception {
        String[] p = stored.split(":");
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, wrapKey(), new GCMParameterSpec(128, Base64.decode(p[0], Base64.NO_WRAP)));
        return new String(c.doFinal(Base64.decode(p[1], Base64.NO_WRAP)), "UTF-8");
    }
}
