package com.edufocus.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.activity.ComponentActivity;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScannerOptions;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Native QR skaner: CameraX + ML Kit (bundled model). Natija: EXTRA_TEXT. */
public class QrScannerActivity extends ComponentActivity {
    static final String EXTRA_TEXT = "text";
    static final String EXTRA_ERROR = "error";

    private PreviewView previewView;
    private Camera camera;
    private BarcodeScanner scanner;
    private ExecutorService exec;
    private volatile boolean done = false;
    private boolean torch = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        buildUi();
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            setResult(RESULT_CANCELED, new Intent().putExtra(EXTRA_ERROR, "permission_denied"));
            finish();
            return;
        }
        exec = Executors.newSingleThreadExecutor();
        scanner = BarcodeScanning.getClient(new BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build());
        startCamera();
    }

    private int dp(float v) { return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()); }

    private void buildUi() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        previewView = new PreviewView(this);
        previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);
        root.addView(previewView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(new FrameView(this), new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        TextView close = chip("✕", getString(R.string.scan_close));
        close.setOnClickListener(v -> { setResult(RESULT_CANCELED, new Intent().putExtra(EXTRA_ERROR, "cancelled")); finish(); });
        FrameLayout.LayoutParams lpClose = new FrameLayout.LayoutParams(dp(48), dp(48), Gravity.TOP | Gravity.START);
        lpClose.setMargins(dp(16), dp(12), 0, 0);
        root.addView(close, lpClose);

        TextView flash = chip("⚡", getString(R.string.scan_torch));
        flash.setOnClickListener(v -> {
            if (camera != null && camera.getCameraInfo().hasFlashUnit()) {
                torch = !torch;
                camera.getCameraControl().enableTorch(torch);
                flash.setBackgroundResource(0);
                flash.setAlpha(torch ? 1f : 0.85f);
                flash.setTextColor(torch ? Color.rgb(250, 204, 21) : Color.WHITE);
            }
        });
        FrameLayout.LayoutParams lpFlash = new FrameLayout.LayoutParams(dp(48), dp(48), Gravity.TOP | Gravity.END);
        lpFlash.setMargins(0, dp(12), dp(16), 0);
        root.addView(flash, lpFlash);

        TextView hint = new TextView(this);
        hint.setText(R.string.scan_hint);
        hint.setTextColor(Color.WHITE);
        hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        hint.setGravity(Gravity.CENTER);
        hint.setPadding(dp(20), dp(12), dp(20), dp(12));
        hint.setBackgroundColor(Color.argb(140, 0, 0, 0));
        FrameLayout.LayoutParams lpHint = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        lpHint.setMargins(dp(24), 0, dp(24), dp(48));
        root.addView(hint, lpHint);

        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            lpClose.topMargin = dp(12) + bars.top; lpFlash.topMargin = dp(12) + bars.top; lpHint.bottomMargin = dp(48) + bars.bottom;
            close.setLayoutParams(lpClose); flash.setLayoutParams(lpFlash); hint.setLayoutParams(lpHint);
            return insets;
        });
        setContentView(root);
    }

    private TextView chip(String glyph, String description) {
        TextView t = new TextView(this);
        t.setText(glyph);
        t.setTextColor(Color.WHITE);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        t.setGravity(Gravity.CENTER);
        t.setContentDescription(description);
        android.graphics.drawable.GradientDrawable bg = new android.graphics.drawable.GradientDrawable();
        bg.setColor(Color.argb(110, 0, 0, 0));
        bg.setCornerRadius(dp(16));
        t.setBackground(bg);
        return t;
    }

    private void startCamera() {
        ListenableFuture<ProcessCameraProvider> f = ProcessCameraProvider.getInstance(this);
        f.addListener(() -> {
            try {
                ProcessCameraProvider provider = f.get();
                provider.unbindAll();
                Preview preview = new Preview.Builder().build();
                preview.setSurfaceProvider(previewView.getSurfaceProvider());
                ImageAnalysis analysis = new ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build();
                analysis.setAnalyzer(exec, this::analyze);
                camera = provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis);
            } catch (Exception e) {
                setResult(RESULT_CANCELED, new Intent().putExtra(EXTRA_ERROR, "camera_error"));
                finish();
            }
        }, ContextCompat.getMainExecutor(this));
    }

    @androidx.annotation.OptIn(markerClass = androidx.camera.core.ExperimentalGetImage.class)
    private void analyze(ImageProxy proxy) {
        if (done || proxy.getImage() == null) { proxy.close(); return; }
        InputImage image = InputImage.fromMediaImage(proxy.getImage(), proxy.getImageInfo().getRotationDegrees());
        scanner.process(image)
                .addOnSuccessListener(codes -> {
                    for (Barcode b : codes) {
                        String v = b.getRawValue();
                        if (v != null && !done) {
                            done = true;
                            runOnUiThread(() -> { setResult(RESULT_OK, new Intent().putExtra(EXTRA_TEXT, v)); finish(); });
                            break;
                        }
                    }
                })
                .addOnCompleteListener(t -> proxy.close());
    }

    @Override
    protected void onDestroy() {
        if (scanner != null) scanner.close();
        if (exec != null) exec.shutdown();
        super.onDestroy();
    }

    /** Xira fon va markaziy kvadrat ramka. */
    private final class FrameView extends View {
        private final Paint dim = new Paint();
        private final Paint corner = new Paint(Paint.ANTI_ALIAS_FLAG);
        FrameView(android.content.Context c) {
            super(c);
            dim.setColor(Color.argb(140, 0, 0, 0));
            corner.setColor(Color.WHITE); corner.setStyle(Paint.Style.STROKE); corner.setStrokeWidth(dp(4)); corner.setStrokeCap(Paint.Cap.ROUND);
        }
        @Override protected void onDraw(Canvas canvas) {
            float size = Math.min(getWidth(), getHeight()) * 0.66f;
            float l = (getWidth() - size) / 2f, t = getHeight() * 0.42f - size / 2f, r = l + size, b = t + size;
            Path p = new Path();
            p.addRect(0, 0, getWidth(), getHeight(), Path.Direction.CW);
            p.addRoundRect(new RectF(l, t, r, b), dp(24), dp(24), Path.Direction.CCW);
            canvas.drawPath(p, dim);
            float c = dp(34);
            canvas.drawLine(l, t + c, l, t, corner); canvas.drawLine(l, t, l + c, t, corner);
            canvas.drawLine(r - c, t, r, t, corner); canvas.drawLine(r, t, r, t + c, corner);
            canvas.drawLine(l, b - c, l, b, corner); canvas.drawLine(l, b, l + c, b, corner);
            canvas.drawLine(r - c, b, r, b, corner); canvas.drawLine(r, b, r, b - c, corner);
        }
    }
}
