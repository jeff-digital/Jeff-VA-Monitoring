package com.jeffdigital.jeffva;

import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.RippleDrawable;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.*;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/** App-owned Android bottom sheet shared by every form, detail and action menu.
 * OS permission, calendar and document-picker surfaces remain Android-owned. */
final class WorkspaceDialog extends AlertDialog {
    private final Map<Integer, Button> buttons = new HashMap<>();
    private final Builder spec;
    private Button close;
    private boolean canCancel = true;
    private WorkspaceDialog(Builder builder) {
        super(builder.context, builder.dark ? R.style.WorkspaceDialogDark : R.style.WorkspaceDialogLight);
        spec = builder;
        setView(content(), 0, 0, 0, 0);
        setCanceledOnTouchOutside(true);
    }
    private int dp(float n) { return Math.round(n * getContext().getResources().getDisplayMetrics().density); }
    private int ink() { return spec.dark ? Color.WHITE : 0xFF172033; }
    private int accent() { return spec.dark ? 0xFFB9C3FF : 0xFF4F46E5; }
    private int surface() { return spec.dark ? 0xFF191C25 : Color.WHITE; }
    private int line() { return spec.dark ? 0xFF343946 : 0xFFE8EBF2; }
    private GradientDrawable shape(int fill, int radius, boolean border) {
        GradientDrawable d = new GradientDrawable(); d.setColor(fill); d.setCornerRadius(dp(radius));
        if (border) d.setStroke(dp(1), line()); return d;
    }
    private LinearLayout column() { LinearLayout v = new LinearLayout(getContext()); v.setOrientation(LinearLayout.VERTICAL); return v; }
    private TextView text(CharSequence value, int size, boolean medium) {
        TextView v = new TextView(getContext()); v.setText(value); v.setTextColor(ink()); v.setTextSize(size);
        v.setTypeface(Typeface.create(medium ? "sans-serif-medium" : "sans-serif", Typeface.NORMAL)); v.setLineSpacing(dp(3), 1); return v;
    }
    private ImageView icon(int resource) {
        ImageView v = new ImageView(getContext()); v.setImageResource(resource); v.setImageTintList(ColorStateList.valueOf(accent()));
        v.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO); return v;
    }
    private Button button(CharSequence title, boolean primary) {
        Button v = new Button(getContext()); v.setText(title); v.setTextSize(14); v.setAllCaps(false);
        v.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL)); v.setMinHeight(dp(48)); v.setMinimumHeight(dp(48));
        v.setPadding(dp(16), dp(10), dp(16), dp(10)); v.setTextColor(primary ? Color.WHITE : ink());
        v.setBackground(new RippleDrawable(ColorStateList.valueOf(0x224F46E5), shape(primary ? 0xFF4F46E5 : surface(), 24, !primary), null));
        v.setOnTouchListener((view, event) -> { view.setAlpha(view.isEnabled() ? 1 : .45f); return false; }); return v;
    }
    private View content() {
        LinearLayout shell = new LinearLayout(getContext()) {
            @Override protected void onMeasure(int w, int h) {
                // The window's usable height already excludes the keyboard. Long forms scroll;
                // their title and save/cancel actions remain visible, including in landscape.
                int available = MeasureSpec.getSize(h);
                int screen = getResources().getDisplayMetrics().heightPixels;
                int cap = Math.min(available > 0 ? available : screen, (int) (screen * .88f));
                super.onMeasure(w, MeasureSpec.makeMeasureSpec(cap, MeasureSpec.AT_MOST));
            }
        };
        shell.setOrientation(LinearLayout.VERTICAL); shell.setPadding(dp(20), dp(10), dp(20), dp(20));
        shell.setBackground(shape(surface(), 28, false)); shell.setClipToOutline(true);
        View handle = new View(getContext()); handle.setBackground(shape(spec.dark ? 0xFF626875 : 0xFFD9DDE6, 3, false));
        LinearLayout.LayoutParams handleParams = new LinearLayout.LayoutParams(dp(32), dp(4)); handleParams.gravity = Gravity.CENTER_HORIZONTAL; handleParams.bottomMargin = dp(10); shell.addView(handle, handleParams);
        LinearLayout header = new LinearLayout(getContext()); header.setGravity(Gravity.CENTER_VERTICAL);
        ImageView mark = icon(spec.icon != 0 ? spec.icon : actionIcon(spec.title.toString())); header.addView(mark, new LinearLayout.LayoutParams(dp(22), dp(22)));
        TextView title = text(spec.title, 18, true); if (android.os.Build.VERSION.SDK_INT >= 28) title.setAccessibilityHeading(true);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(0, -2, 1); titleParams.leftMargin = dp(12); header.addView(title, titleParams);
        close = button("×", false); close.setTextSize(24); close.setContentDescription("Close " + spec.title); close.setBackgroundColor(Color.TRANSPARENT);
        close.setOnClickListener(v -> cancel()); header.addView(close, new LinearLayout.LayoutParams(dp(48), dp(48))); shell.addView(header);
        LinearLayout body = column(); body.setPadding(0, dp(12), 0, dp(8));
        if (spec.message != null) { TextView message = text(spec.message, 14, false); message.setPadding(0, 0, 0, dp(12)); body.addView(message); }
        if (spec.items != null) for (int i = 0; i < spec.items.length; i++) {
            final int index = i; String value = spec.items[i].toString();
            LinearLayout row = new LinearLayout(getContext()); row.setGravity(Gravity.CENTER_VERTICAL); row.setMinimumHeight(dp(56)); row.setPadding(dp(12), dp(8), dp(12), dp(8));
            row.setBackground(new RippleDrawable(ColorStateList.valueOf(0x224F46E5), shape(i == spec.selected ? (spec.dark ? 0xFF313B60 : 0xFFF0EFFF) : surface(), 14, false), null));
            row.addView(icon(actionIcon(value)), new LinearLayout.LayoutParams(dp(20), dp(20)));
            LinearLayout copy = column(); TextView label = text(value, 14, i == spec.selected); copy.addView(label);
            if (spec.choice && spec.title.toString().toLowerCase(Locale.ROOT).startsWith("sort")) {
                String hint = value.equals("Due date") ? "Soonest due first" : value.equals("Newest") ? "Most recently added" : value.equals("Oldest") ? "Earliest added first" : "A to Z";
                TextView description = text(hint, 12, false); description.setTextColor(spec.dark ? 0xFFCBD0DA : 0xFF667085); description.setPadding(0, dp(2), 0, 0); copy.addView(description);
            }
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, -2, 1); lp.leftMargin = dp(14); lp.rightMargin = dp(10); row.addView(copy, lp);
            if (spec.choice) { TextView check = text(i == spec.selected ? "●" : "○", 20, false); check.setTextColor(accent()); row.addView(check); }
            row.setContentDescription(value + (i == spec.selected ? ", selected" : "")); row.setFocusable(true);
            row.setOnClickListener(v -> { if (spec.itemClick != null) spec.itemClick.onClick(this, index); dismiss(); });
            LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(-1, -2); rp.bottomMargin = dp(4); body.addView(row, rp);
        }
        if (spec.view != null) {
            View content = spec.view;
            if (content instanceof ScrollView && ((ScrollView) content).getChildCount() == 1) {
                ScrollView original = (ScrollView) content; content = original.getChildAt(0); original.removeView(content);
            }
            body.addView(content, new LinearLayout.LayoutParams(-1, -2));
        }
        ScrollView scroll = new ScrollView(getContext()); scroll.setFillViewport(false); scroll.setClipToPadding(false); scroll.setVerticalScrollBarEnabled(false); scroll.addView(body);
        shell.addView(scroll, new LinearLayout.LayoutParams(-1, -2, 1));
        if (spec.negative != null || spec.positive != null) {
            View divider = new View(getContext()); divider.setBackgroundColor(line()); shell.addView(divider, new LinearLayout.LayoutParams(-1, dp(1)));
            LinearLayout footer = new LinearLayout(getContext()); footer.setPadding(0, dp(14), 0, 0); footer.setGravity(Gravity.CENTER_VERTICAL);
            if (spec.negative != null) addButton(footer, BUTTON_NEGATIVE, spec.negative, spec.negativeClick, false);
            if (spec.positive != null) addButton(footer, BUTTON_POSITIVE, spec.positive, spec.positiveClick, true);
            shell.addView(footer);
        }
        return shell;
    }
    private void addButton(LinearLayout footer, int which, CharSequence label, DialogInterface.OnClickListener listener, boolean primary) {
        Button v = button(label, primary); buttons.put(which, v); v.setOnClickListener(view -> { if (listener != null) listener.onClick(this, which); dismiss(); });
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, -2, 1); if (footer.getChildCount() > 0) p.leftMargin = dp(10); footer.addView(v, p);
    }
    @Override public Button getButton(int which) { return buttons.get(which); }
    @Override public void setCancelable(boolean flag) { canCancel = flag; super.setCancelable(flag); if (close != null) close.setEnabled(flag); }
    @Override public void cancel() { if (canCancel) super.cancel(); }
    @Override protected void onStart() {
        super.onStart(); Window window = getWindow(); if (window == null) return;
        window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT)); window.setDimAmount(.42f);
        window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND); window.setGravity(Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        int width = Math.min(getContext().getResources().getDisplayMetrics().widthPixels - dp(16), dp(600));
        window.setLayout(width, ViewGroup.LayoutParams.WRAP_CONTENT);
        WindowManager.LayoutParams p = window.getAttributes(); p.y = dp(8); window.setAttributes(p);
    }
    static int actionIcon(String title) {
        String s = title.toLowerCase(Locale.ROOT);
        if (s.contains("delete") || s.contains("remove record")) return R.drawable.ic_ui_delete;
        if (s.contains("reply") || s.contains("send")) return R.drawable.ic_ui_reply;
        if (s.contains("forward")) return R.drawable.ic_ui_forward;
        if (s.contains("star")) return R.drawable.ic_ui_star;
        if (s.contains("archive")) return R.drawable.ic_ui_archive;
        if (s.contains("copy")) return R.drawable.ic_ui_copy;
        if (s.contains("sort") || s.contains("filter") || s.contains("newest") || s.contains("oldest")) return R.drawable.ic_ui_sort;
        if (s.contains("email") || s.contains("sender") || s.contains("read") || s.contains("inbox")) return R.drawable.ic_ui_inbox;
        if (s.contains("edit") || s.contains("draft")) return R.drawable.ic_ui_edit;
        if (s.contains("complete") || s.contains("to do") || s.contains("save") || s.contains("star")) return R.drawable.ic_ui_check;
        if (s.contains("date") || s.contains("due") || s.contains("renew")) return R.drawable.ic_ui_calendar;
        if (s.contains("document") || s.contains("upload") || s.contains("copy")) return R.drawable.ic_ui_documents;
        if (s.contains("client") || s.contains("contact")) return R.drawable.ic_ui_clients;
        if (s.contains("task")) return R.drawable.ic_ui_tasks;
        if (s.contains("account") || s.contains("password") || s.contains("sign out")) return R.drawable.ic_ui_account;
        if (s.contains("payment") || s.contains("transaction") || s.contains("salary")) return R.drawable.ic_ui_wallet;
        if (s.contains("link") || s.contains("website")) return R.drawable.ic_ui_links;
        return R.drawable.ic_ui_more;
    }
    static final class Builder {
        final Context context; final boolean dark; CharSequence title = "Jeff VA", message, negative, positive;
        View view; CharSequence[] items; int selected = -1, icon; boolean choice;
        DialogInterface.OnClickListener negativeClick, positiveClick, itemClick;
        Builder(Context context, boolean dark) { this.context = context; this.dark = dark; }
        Builder setTitle(CharSequence value) { title = value; return this; }
        Builder setIcon(int value) { icon = value; return this; }
        Builder setMessage(CharSequence value) { message = value; return this; }
        Builder setView(View value) { view = value; return this; }
        Builder setNegativeButton(CharSequence text, DialogInterface.OnClickListener click) { negative = text; negativeClick = click; return this; }
        Builder setPositiveButton(CharSequence text, DialogInterface.OnClickListener click) { positive = text; positiveClick = click; return this; }
        Builder setItems(CharSequence[] values, DialogInterface.OnClickListener click) { items = values; itemClick = click; return this; }
        Builder setSingleChoiceItems(CharSequence[] values, int checked, DialogInterface.OnClickListener click) { items = values; selected = checked; itemClick = click; choice = true; return this; }
        AlertDialog create() { return new WorkspaceDialog(this); }
    }
}
