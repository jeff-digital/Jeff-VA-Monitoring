package com.jeffdigital.jeffva;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.View;
import java.util.Locale;

/** Small native charts with the same values exposed to accessibility services. */
final class WorkspaceChart extends View {
    private final String[] labels;
    private final double[] values;
    private final boolean donut, dark;
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final int[] colors = {0xFF6366F1, 0xFF22B8A8, 0xFFF4B860, 0xFFEF7992, 0xFF94A3B8, 0xFF8B5CF6};
    WorkspaceChart(Context context, String[] labels, double[] values, boolean donut, boolean dark) {
        super(context); this.labels = labels; this.values = values; this.donut = donut; this.dark = dark;
        StringBuilder description = new StringBuilder();
        for (int i = 0; i < labels.length; i++) description.append(labels[i]).append(": ").append(format(values[i])).append(". ");
        setContentDescription(description); setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_YES);
    }
    private float dp(float value) { return value * getResources().getDisplayMetrics().density; }
    private String format(double value) { return value == (long) value ? String.valueOf((long) value) : String.format(Locale.US, "%.1f", value); }
    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas); float w = getWidth(), h = getHeight();
        int ink = dark ? Color.WHITE : 0xFF475569, grid = dark ? 0xFF343946 : 0xFFE5E9F2;
        paint.setTextSize(dp(10)); paint.setStrokeWidth(dp(1));
        double total = 0, max = 1; for (double value : values) { total += value; max = Math.max(max, value); }
        if (donut) {
            float radius = Math.min(w * .23f, dp(62)), cx = radius + dp(8), cy = h / 2;
            RectF oval = new RectF(cx - radius, cy - radius, cx + radius, cy + radius);
            paint.setStyle(Paint.Style.STROKE); paint.setStrokeWidth(dp(17)); paint.setColor(grid); canvas.drawOval(oval, paint);
            float start = -90;
            for (int i = 0; i < values.length; i++) {
                float sweep = total == 0 ? 0 : (float) (values[i] / total * 360);
                paint.setColor(colors[i % colors.length]); canvas.drawArc(oval, start, Math.max(0, sweep - 3), false, paint); start += sweep;
            }
            paint.setStyle(Paint.Style.FILL); paint.setColor(ink); paint.setTextSize(dp(24)); paint.setTextAlign(Paint.Align.CENTER);
            canvas.drawText(format(total), cx, cy + dp(5), paint); paint.setTextSize(dp(10)); canvas.drawText("applications", cx, cy + dp(23), paint);
            paint.setTextAlign(Paint.Align.LEFT); float x = radius * 2 + dp(28), y = cy - (labels.length - 1) * dp(12);
            for (int i = 0; i < labels.length; i++) {
                paint.setColor(colors[i % colors.length]); canvas.drawCircle(x, y - dp(3), dp(3), paint);
                paint.setColor(ink); canvas.drawText(labels[i] + "  " + format(values[i]), x + dp(10), y, paint); y += dp(24);
            }
        } else {
            float top = dp(20), bottom = h - dp(25), left = dp(25), right = w - dp(8), step = (right - left) / Math.max(1, values.length);
            paint.setColor(grid);
            for (int i = 0; i <= 3; i++) { float y = top + (bottom - top) * i / 3; canvas.drawLine(left, y, right, y, paint); }
            for (int i = 0; i < values.length; i++) {
                float x = left + step * i + step * .2f, bar = (float) (values[i] / max) * (bottom - top - dp(14));
                paint.setColor(colors[0]); canvas.drawRoundRect(x, bottom - Math.max(dp(2), bar), x + step * .6f, bottom, dp(5), dp(5), paint);
                paint.setColor(ink); paint.setTextAlign(Paint.Align.CENTER);
                canvas.drawText(labels[i], x + step * .3f, h - dp(7), paint);
                canvas.drawText(format(values[i]), x + step * .3f, bottom - bar - dp(7), paint);
            }
            paint.setTextAlign(Paint.Align.LEFT);
        }
    }
}
