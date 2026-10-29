package com.jeffdigital.jeffva;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DatePickerDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.res.ColorStateList;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.text.Editable;
import android.text.Html;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.inputmethod.InputMethodManager;
import android.widget.*;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.math.BigDecimal;
import java.text.NumberFormat;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** The workspace is rendered exclusively with Android Views. */
public final class MainActivity extends Activity {
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private WorkspaceRepository repository;
    private JSONObject data = new JSONObject();
    private SharedPreferences preferences;
    private LinearLayout root, body, toolbar, navigation;
    private androidx.swiperefreshlayout.widget.SwipeRefreshLayout pullRefresh;
    private String page = "Dashboard", query = "", filter = "All";
    private boolean dark = false, busy, offline, preview;
    private boolean clientDashboard;
    private String taskSection = "To do", taskOrder = "Due date", clientTaskSection = "To do", listOrder = "Newest";
    private int accountGeneration;
    private String mailFolder = "Inbox", newsCategory = "all";
    private final ExecutorService images = Executors.newFixedThreadPool(3);
    private final okhttp3.OkHttpClient imageClient = new okhttp3.OkHttpClient.Builder().callTimeout(15, java.util.concurrent.TimeUnit.SECONDS).build();
    private final android.util.LruCache<String, Bitmap> imageCache = new android.util.LruCache<String, Bitmap>(12 * 1024) {
        @Override protected int sizeOf(String key, Bitmap value) { return value.getByteCount() / 1024; }
    };
    private int background, surface, foreground, line, accent;
    private JSONArray news = new JSONArray(), chat = new JSONArray();
    private String newsError = "", assistantMode = "research", usageLabel = "";
    private boolean newsLoaded;
    private final Set<AlertDialog> dialogs = new HashSet<>();
    private final android.os.Handler liveHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private WorkspaceLiveUpdates liveUpdates;
    private boolean foregroundActive, liveLoading, liveDirty;
    private final ReminderUpdateGate reminderGate = new ReminderUpdateGate();
    private int mailVisibleLimit = 30;
    private final Runnable livePulse = new Runnable() {
        @Override public void run() { reloadLiveWorkspace(); if (foregroundActive) liveHandler.postDelayed(this, 30000); }
    };
    private final Runnable liveChanged = this::reloadLiveWorkspace;
    private interface Job<T> { T run() throws Exception; }
    private interface Done<T> { void accept(T result) throws Exception; }
    private static String text(JSONObject item, String field) { return WorkspaceModel.text(item, field); }
    private static JSONObject json(Object... pairs) throws Exception {
        JSONObject result = new JSONObject(); for (int i = 0; i < pairs.length; i += 2) result.put((String) pairs[i], pairs[i + 1]); return result;
    }
    private int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void palette() {
        background = Color.parseColor(dark ? "#0E1015" : "#FFFFFF");
        surface = Color.parseColor(dark ? "#191C25" : "#FFFFFF");
        foreground = Color.parseColor(dark ? "#FFFFFF" : "#172033");
        line = Color.parseColor(dark ? "#343946" : "#E8EBF2");
        accent = Color.parseColor(dark ? "#A9B8FF" : "#4F46E5");
    }
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        preferences = getSharedPreferences("appearance", MODE_PRIVATE);
        if (!preferences.getBoolean("whiteDesignV2", false)) preferences.edit().putBoolean("dark", false).putBoolean("whiteDesignV2", true).apply();
        dark = preferences.getBoolean("dark", false); clientDashboard = preferences.getBoolean("clientDashboard", false); palette();
        ReminderNotifications.createChannel(this);
        repository = new WorkspaceRepository(this);
        if (saved != null) { page = saved.getString("page", "Dashboard"); pendingUploadClient = saved.getString("uploadClient", ""); }
        if (page.equals("Career tools")) page = "Scripts";
        notificationDestination(getIntent());
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::navigateBack);
        preview = BuildConfig.DEBUG && getIntent().getBooleanExtra("preview", false);
        if (preview) {
            try { data = PreviewData.workspace(); } catch (Exception ignored) { }
            showWorkspace(); return;
        }
        if (getIntent().getData() != null) { handleCallback(getIntent().getData()); return; }
        loading("Opening your workspace…");
        async(() -> {
            if (!repository.restore()) return null;
            try { offline = false; return repository.load(); }
            catch (WorkspaceRepository.ApiError error) { throw error; }
            catch (Exception error) { offline = true; return repository.cached(); }
        }, result -> { if (result == null) showLogin(""); else { data = result; showWorkspace(); } }, error -> showLogin(error.getMessage()));
    }
    @Override public void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); if (intent.getData() != null) handleCallback(intent.getData()); else { notificationDestination(intent); if (repository.signedIn()) showWorkspace(); } }
    @Override public void onResume() { super.onResume(); foregroundActive = true; startLiveUpdates(); if (repository != null && !busy && page.equals("Settings") && (preview || repository.signedIn())) showWorkspace(); }
    @Override public void onStop() { foregroundActive = false; stopLiveUpdates(); super.onStop(); }
    private void notificationDestination(Intent intent) { String destination = intent.getStringExtra("notificationPage"); if ("Daily tasks".equals(destination) || "Subscriptions".equals(destination)) page = destination; }
    @Override public void onSaveInstanceState(Bundle state) { super.onSaveInstanceState(state); state.putString("page", page); state.putString("uploadClient", pendingUploadClient); }
    @Override public void onDestroy() {
        stopLiveUpdates();
        for (AlertDialog dialog : new HashSet<>(dialogs)) dialog.dismiss();
        io.shutdownNow(); images.shutdownNow(); imageCache.evictAll(); super.onDestroy();
    }
    private interface Failed { void accept(Exception error); }
    private <T> void async(Job<T> job, Done<T> done, Failed failed) {
        io.execute(() -> {
            try {
                T value = job.run(); runOnUiThread(() -> {
                    if (isDestroyed() || isFinishing()) return;
                    try { done.accept(value); } catch (Exception error) { failed.accept(error); }
                });
            } catch (Exception error) { runOnUiThread(() -> { if (!isDestroyed() && !isFinishing()) failed.accept(error); }); }
        });
    }
    private <T> void async(Job<T> job, Done<T> done) { async(job, done, error -> { busy = false; problem(error.getMessage()); }); }
    private void track(AlertDialog dialog) { dialogs.add(dialog); dialog.setOnDismissListener(d -> { dialogs.remove(dialog); liveHandler.post(this::renderLiveWorkspace); }); dialog.show(); }
    private void startLiveUpdates() {
        if (!foregroundActive || preview || repository == null || !repository.signedIn() || liveUpdates != null) return;
        liveUpdates = new WorkspaceLiveUpdates(() -> { liveHandler.removeCallbacks(liveChanged); liveHandler.postDelayed(liveChanged, 350); }); liveHandler.post(livePulse);
    }
    private void stopLiveUpdates() { liveHandler.removeCallbacksAndMessages(null); if (liveUpdates != null) liveUpdates.close(); liveUpdates = null; }
    private void reloadLiveWorkspace() {
        if (!foregroundActive || preview || repository == null || !repository.signedIn() || busy || liveLoading) return;
        liveLoading = true; int generation = accountGeneration; WorkspaceLiveUpdates connection = liveUpdates; JSONObject baseline = data;
        async(() -> { JSONObject credentials = repository.liveCredentials(), latest = repository.load(); return new Object[]{credentials, latest, !baseline.toString().equals(latest.toString())}; }, result -> {
            liveLoading = false;
            if (!foregroundActive || generation != accountGeneration || connection != liveUpdates || !repository.signedIn()) return;
            if (connection != null) connection.connect((JSONObject) result[0]);
            if (busy) return;
            // A recovered background connection must unlock editing too, even if
            // the saved records are identical to the offline snapshot.
            if (offline) { offline = false; liveDirty = true; }
            if (data == baseline && (Boolean) result[2]) { data = (JSONObject) result[1]; liveDirty = true; queueReminderUpdate(); }
            renderLiveWorkspace();
        }, error -> { liveLoading = false; });
    }
    private void renderLiveWorkspace() {
        if (!liveDirty || !foregroundActive || busy || !dialogs.isEmpty() || repository == null || !repository.signedIn()) return;
        if (getCurrentFocus() instanceof EditText) return;
        // Keep unfinished local drafts/calculations intact; navigation renders fresh data.
        if (page.equals("Cover letter") || page.equals("Salary") || page.equals("Assistant")) return;
        ScrollView scrolling = null; if (pullRefresh != null && pullRefresh.getChildCount() > 0 && pullRefresh.getChildAt(0) instanceof ScrollView) scrolling = (ScrollView) pullRefresh.getChildAt(0);
        int y = scrolling == null ? 0 : scrolling.getScrollY(); liveDirty = false; showWorkspace();
        if (pullRefresh != null && pullRefresh.getChildCount() > 0 && pullRefresh.getChildAt(0) instanceof ScrollView) { ScrollView restored = (ScrollView) pullRefresh.getChildAt(0); restored.post(() -> restored.scrollTo(0, y)); }
    }
    private void queueReminderUpdate() {
        if (preview || repository == null || !repository.signedIn()) return;
        int settings = (preferences.getBoolean("notifications", false) ? 1 : 0) | (preferences.getBoolean("notifyTasks", true) ? 2 : 0) | (preferences.getBoolean("notifyRenewals", true) ? 4 : 0);
        if (!reminderGate.changed(data, settings)) return;
        JSONObject snapshot = data; Context context = getApplicationContext();
        io.execute(() -> ReminderNotifications.update(context, snapshot));
    }
    private WorkspaceDialog.Builder dialogBuilder() { return new WorkspaceDialog.Builder(this, dark); }
    private void problem(String message) { track(dialogBuilder().setTitle("Could not finish").setMessage(message == null ? "Check your connection and try again." : message).setPositiveButton("OK", null).create()); }
    private void toast(String message) { Toast.makeText(this, message, Toast.LENGTH_SHORT).show(); }
    private GradientDrawable shape(int color, int radius, boolean border) {
        GradientDrawable drawable = new GradientDrawable(); drawable.setColor(color); drawable.setCornerRadius(dp(radius));
        if (border) drawable.setStroke(dp(1), line); return drawable;
    }
    private void clickable(View view, Runnable action) {
        view.setClickable(true); view.setFocusable(true);
        view.setForeground(new RippleDrawable(ColorStateList.valueOf(dark ? 0x334F69B7 : 0x22334AB8), null, shape(Color.WHITE, 14, false)));
        view.setOnClickListener(v -> action.run());
    }
    private LinearLayout column() { LinearLayout layout = new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL); return layout; }
    private LinearLayout row() { LinearLayout layout = new LinearLayout(this); layout.setGravity(Gravity.CENTER_VERTICAL); return layout; }
    private int pageIcon(String name) {
        switch (name) {
            case "Dashboard": return R.drawable.ic_ui_home;
            case "Daily tasks": return R.drawable.ic_ui_tasks;
            case "Applications": return R.drawable.ic_ui_apply;
            case "Active clients": return R.drawable.ic_ui_clients;
            case "Email inbox": return R.drawable.ic_ui_inbox;
            case "To apply": return R.drawable.ic_ui_to_apply;
            case "Wallet": return R.drawable.ic_ui_wallet;
            case "Subscriptions": return R.drawable.ic_ui_subscriptions;
            case "Documents": return R.drawable.ic_ui_documents;
            case "Invoices": return R.drawable.ic_ui_invoices;
            case "Industry news": return R.drawable.ic_ui_news;
            case "Assistant": return R.drawable.ic_ui_assistant;
            case "Weekly report": return R.drawable.ic_ui_report;
            case "Scripts": return R.drawable.ic_ui_scripts;
            case "Softcopy links": return R.drawable.ic_ui_links;
            case "Templates": return R.drawable.ic_ui_templates;
            case "Salary": return R.drawable.ic_ui_salary;
            case "Cover letter": return R.drawable.ic_ui_cover_letter;
            case "Settings": return R.drawable.ic_ui_settings;
            case "Account": return R.drawable.ic_ui_account;
            default: return R.drawable.ic_ui_more;
        }
    }
    private ImageView icon(int resource, int size) { ImageView image = new ImageView(this); image.setImageResource(resource); image.setImageTintList(ColorStateList.valueOf(accent)); image.setLayoutParams(new LinearLayout.LayoutParams(dp(size), dp(size))); image.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO); return image; }
    private FrameLayout iconTile(String name, int size) { FrameLayout tile = new FrameLayout(this); tile.setBackground(shape(dark ? 0xFF313B60 : 0xFFF0EFFF, 12, false)); ImageView image = icon(pageIcon(name), 20); FrameLayout.LayoutParams p = new FrameLayout.LayoutParams(dp(20), dp(20), Gravity.CENTER); tile.addView(image, p); tile.setLayoutParams(new LinearLayout.LayoutParams(dp(size), dp(size))); return tile; }
    private void navigationRow(LinearLayout parent, String name, String caption, Runnable action) {
        LinearLayout panel = card(parent), content = row(); panel.addView(content); content.addView(iconTile(name, 40)); LinearLayout copy = column();
        addText(copy, name, 15, true); if (!caption.isEmpty()) addText(copy, caption, 12, false); LinearLayout.LayoutParams textParams = new LinearLayout.LayoutParams(0, -2, 1); textParams.leftMargin = dp(12); content.addView(copy, textParams); content.addView(icon(R.drawable.ic_ui_chevron_right, 16)); clickable(panel, action);
    }
    private void choiceRow(LinearLayout parent, String caption, String selected, String[] options, Choice callback) {
        LinearLayout controls = null;
        if (parent.getChildCount() > 0 && "list-controls".equals(parent.getChildAt(parent.getChildCount() - 1).getTag())) controls = (LinearLayout) parent.getChildAt(parent.getChildCount() - 1);
        if (controls == null) { controls = row(); controls.setTag("list-controls"); LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2); p.bottomMargin = dp(16); parent.addView(controls, p); }
        boolean sort = caption.toLowerCase(Locale.ROOT).startsWith("sort"), active = !sort && !selected.equals("All");
        LinearLayout chip = row(); chip.setPadding(dp(14), 0, dp(12), 0); chip.setMinimumHeight(dp(48));
        chip.setBackground(shape(active ? (dark ? 0xFF313B60 : 0xFFF0EFFF) : surface, 24, true)); chip.addView(icon(sort ? R.drawable.ic_ui_sort : R.drawable.ic_ui_filter, 18));
        TextView value = label(selected.equals("All") ? "All statuses" : selected, 13, true); value.setSingleLine(true); value.setEllipsize(android.text.TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams copy = new LinearLayout.LayoutParams(0, -2, 1); copy.leftMargin = dp(8); copy.rightMargin = dp(8); chip.addView(value, copy); chip.addView(icon(R.drawable.ic_ui_chevron_down, 14));
        chip.setContentDescription(caption + ": " + selected + ". Choose an option"); clickable(chip, () -> { hideKeyboard(); track(dialogBuilder().setTitle(caption).setSingleChoiceItems(options, Math.max(0, Arrays.asList(options).indexOf(selected)), (d, which) -> { d.dismiss(); callback.selected(options[which]); }).setNegativeButton("Cancel", null).create()); });
        LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(0, dp(48), 1); if (controls.getChildCount() > 0) cp.leftMargin = dp(8); controls.addView(chip, cp);
    }
    private TextView label(String value, int size, boolean bold) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(size >= 23 ? 22 : size >= 16 ? size - 1 : size); view.setTextColor(foreground);
        view.setTypeface(Typeface.create(bold ? "sans-serif-medium" : "sans-serif", Typeface.NORMAL));
        view.setLineSpacing(dp(2), 1); return view;
    }
    private void addText(LinearLayout parent, String value, int size, boolean bold) {
        TextView view = label(value, size, bold); LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.bottomMargin = dp(6); parent.addView(view, params);
    }
    private Button button(String title, boolean primary, Runnable action) {
        Button button = new Button(this); button.setText(title); button.setTextSize(13); button.setAllCaps(false);
        button.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL)); button.setTextColor(primary ? Color.WHITE : foreground); button.setMinHeight(dp(48)); button.setMinimumHeight(dp(48));
        button.setPadding(dp(12), dp(6), dp(12), dp(6));
        button.setBackground(new RippleDrawable(ColorStateList.valueOf(0x224F46E5), shape(primary ? Color.parseColor("#4F46E5") : surface, 12, !primary), null));
        button.setOnClickListener(v -> action.run()); return button;
    }
    private void action(LinearLayout parent, String title, boolean primary, Runnable callback) {
        Button button = button(title, primary, callback); LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        android.graphics.drawable.Drawable mark = getDrawable(WorkspaceDialog.actionIcon(title)).mutate(); mark.setTint(primary ? Color.WHITE : accent); mark.setBounds(0, 0, dp(18), dp(18)); button.setCompoundDrawablesRelative(mark, null, null, null); button.setCompoundDrawablePadding(dp(12)); button.setGravity(Gravity.CENTER_VERTICAL | Gravity.START);
        params.bottomMargin = dp(8); parent.addView(button, params);
    }
    private LinearLayout card(LinearLayout parent) {
        LinearLayout card = column(); card.setPadding(dp(14), dp(14), dp(14), dp(10)); card.setBackground(shape(surface, 16, true));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.bottomMargin = dp(10); parent.addView(card, params); return card;
    }
    private void base() {
        pullRefresh = null; palette(); root = column(); root.setBackgroundColor(background);
        getWindow().setStatusBarColor(background); getWindow().setNavigationBarColor(background);
        int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
        if (!dark) { flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR; if (Build.VERSION.SDK_INT >= 26) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR; }
        getWindow().getDecorView().setSystemUiVisibility(flags);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        setContentView(root); root.requestApplyInsets();
    }
    private LinearLayout scroll(LinearLayout parent, boolean weighted) {
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true);
        LinearLayout content = column(); content.setPadding(dp(16), dp(8), dp(16), dp(20)); scroll.setClipToPadding(false); scroll.setVerticalScrollBarEnabled(false); scroll.addView(content);
        parent.addView(scroll, new LinearLayout.LayoutParams(-1, weighted ? 0 : -2, weighted ? 1 : 0)); return content;
    }
    private LinearLayout refreshableWorkspace() {
        pullRefresh = new androidx.swiperefreshlayout.widget.SwipeRefreshLayout(this);
        pullRefresh.setColorSchemeColors(accent); pullRefresh.setProgressBackgroundColorSchemeColor(surface);
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); scroll.setVerticalScrollBarEnabled(false);
        LinearLayout content = column(); content.setPadding(dp(16), dp(8), dp(16), dp(20)); scroll.addView(content);
        pullRefresh.addView(scroll); pullRefresh.setOnChildScrollUpCallback((parent, child) -> scroll.canScrollVertically(-1));
        pullRefresh.setOnRefreshListener(this::refresh); root.addView(pullRefresh, new LinearLayout.LayoutParams(-1, 0, 1)); return content;
    }
    private void loading(String message) {
        base(); LinearLayout content = column(); content.setGravity(Gravity.CENTER); content.setPadding(dp(24), dp(24), dp(24), dp(24));
        content.addView(new ProgressBar(this)); addText(content, "\n" + message, 16, false); root.addView(content, new LinearLayout.LayoutParams(-1, -1));
    }
    private EditText input(LinearLayout parent, String title, String value, int type) {
        addText(parent, title, 13, true); EditText input = new EditText(this); input.setSingleLine(type != (InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE));
        input.setInputType(type); input.setTextColor(foreground); input.setHintTextColor(dark ? 0xFFCBD0DA : 0xFF667085); input.setTextSize(14); input.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
        input.setText(value); input.setPadding(dp(12), dp(12), dp(12), dp(12)); input.setMinHeight(dp(50));
        input.setBackground(shape(surface, 10, true)); LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.bottomMargin = dp(16); parent.addView(input, params); return input;
    }
    private void showLogin(String error) {
        busy = false; base(); LinearLayout content = scroll(root, true); content.setPadding(dp(24), dp(54), dp(24), dp(24));
        ImageView logo = new ImageView(this); logo.setImageResource(R.mipmap.ic_launcher); LinearLayout.LayoutParams logoParams = new LinearLayout.LayoutParams(dp(54), dp(54)); logoParams.bottomMargin = dp(22); content.addView(logo, logoParams);
        addText(content, "Welcome back", 30, true); addText(content, "Sign in to your Jeff VA workspace", 16, false);
        if (!error.isEmpty()) addText(card(content), error, 14, false);
        EditText email = input(content, "Email", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        EditText password = input(content, "Password", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        action(content, "Sign in", true, () -> {
            if (busy) return;
            if (!android.util.Patterns.EMAIL_ADDRESS.matcher(email.getText().toString().trim()).matches()) { email.setError("Enter your email"); return; }
            if (password.length() == 0) { password.setError("Enter your password"); return; }
            busy = true; hideKeyboard(); loading("Signing in…");
            String address = email.getText().toString().trim(), secret = password.getText().toString(); password.setText("");
            async(() -> { repository.login(address, secret); return repository.load(); }, result -> { busy = false; offline = false; resetAccountViews(); data = result; showWorkspace(); }, e -> showLogin(e.getMessage()));
        });
        action(content, "Continue with Google", false, () -> {
            if (busy) return; busy = true;
            async(repository::startGoogleLogin, url -> { busy = false; openExternal(url); }, e -> { busy = false; problem(e.getMessage()); });
        });
        action(content, "Forgot password?", false, () -> {
            String address = email.getText().toString().trim();
            if (!android.util.Patterns.EMAIL_ADDRESS.matcher(address).matches()) { email.setError("Enter your email first"); return; }
            async(() -> { repository.recover(address); return true; }, result -> toast("Check your email for the password reset link."));
        });
        addText(content, "Google opens your browser for sign-in, then returns to this app.", 13, false);
    }
    private void handleCallback(Uri uri) {
        if (busy) return; busy = true; loading("Finishing Google sign-in…");
        async(() -> { repository.finishGoogleLogin(uri); return repository.load(); }, result -> { busy = false; offline = false; resetAccountViews(); data = result; page = "Dashboard"; showWorkspace(); }, error -> showLogin(error.getMessage()));
    }
    private void resetAccountViews() { stopLiveUpdates(); accountGeneration++; liveDirty = false; reminderGate.reset(); mailVisibleLimit = 30; imageCache.evictAll(); chat = new JSONArray(); news = new JSONArray(); newsLoaded = false; newsError = ""; usageLabel = ""; query = ""; closeDialogs(); }
    private void hideKeyboard() { View focused = getCurrentFocus(); if (focused != null) ((InputMethodManager) getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(focused.getWindowToken(), 0); }
    private void openExternal(String url) {
        try {
            Uri uri = Uri.parse(url); String scheme = uri.getScheme();
            if (!"https".equalsIgnoreCase(scheme) && !"http".equalsIgnoreCase(scheme) && !"mailto".equalsIgnoreCase(scheme)) throw new Exception("Unsupported link.");
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception error) { problem("No app is available to open this link."); }
    }
    private void navigate(String destination) { hideKeyboard(); page = destination; query = ""; filter = "All"; listOrder = destination.equals("To apply") ? "Due date" : "Newest"; if (destination.equals("Daily tasks")) taskSection = "To do"; showWorkspace(); }
    private void showWorkspace() {
        liveDirty = false; startLiveUpdates();
        queueReminderUpdate();
        base(); toolbar = row(); toolbar.setPadding(dp(16), dp(12), dp(16), dp(6));
        LinearLayout.LayoutParams pageIconParams = new LinearLayout.LayoutParams(dp(40), dp(40)); pageIconParams.rightMargin = dp(10); toolbar.addView(iconTile(page, 40), pageIconParams);
        LinearLayout titles = column(); TextView brand = label("JEFF VA  /  WORKSPACE", 10, true); brand.setTextColor(accent); brand.setLetterSpacing(.12f); titles.addView(brand); addText(titles, page, 25, true);
        toolbar.addView(titles, new LinearLayout.LayoutParams(0, -2, 1));
        String addLabel = addActionLabel();
        if (!addLabel.isEmpty()) { Button add = button("+", true, this::addFromHeader); add.setTextSize(26); add.setContentDescription(addLabel); toolbar.addView(add, new LinearLayout.LayoutParams(dp(48), dp(48))); }
        root.addView(toolbar); body = refreshableWorkspace();
        if (offline) addText(card(body), "Offline snapshot · Connect to refresh or save changes", 13, true);
        try {
            switch (page) {
                case "Dashboard": dashboard(); break;
                case "Daily tasks": tasks(); break;
                case "Applications": applications(false); break;
                case "Active clients": applications(true); break;
                case "To apply": toApply(); break;
                case "Email inbox": inbox(); break;
                case "Wallet": wallet(); break;
                case "Subscriptions": subscriptions(); break;
                case "Documents": documents(); break;
                case "Invoices": invoices(); break;
                case "Industry news": news(); break;
                case "Assistant": assistant(); break;
                case "Weekly report": weekly(); break;
                case "Scripts": tools("scripts"); break;
                case "Softcopy links": tools("workLinks"); break;
                case "Templates": tools("emailTemplates"); break;
                case "Cover letter": coverLetter(); break;
                case "Salary": salaryCalculator(); break;
                case "Account": account(); break;
                case "Settings": settings(); break;
                default: more();
            }
        } catch (Exception error) { problem(error.getMessage()); }
        navigation = row(); navigation.setPadding(dp(8), dp(8), dp(8), dp(10)); navigation.setBackgroundColor(surface);
        String[] names = {"Dashboard", "Daily tasks", "Applications", "Active clients", "Email inbox", "More"}; String[] labels = {"Home", "Tasks", "Apply", "Clients", "Inbox", "More"};
        int[] icons = {R.drawable.ic_ui_home, R.drawable.ic_ui_tasks, R.drawable.ic_ui_apply, R.drawable.ic_ui_clients, R.drawable.ic_ui_inbox, R.drawable.ic_ui_more};
        for (int i = 0; i < names.length; i++) {
            final String name = names[i]; LinearLayout item = column(); item.setGravity(Gravity.CENTER); item.setPadding(dp(3), dp(7), dp(3), dp(7));
            ImageView icon = new ImageView(this); icon.setImageResource(icons[i]); icon.setImageTintList(ColorStateList.valueOf(foreground)); item.addView(icon, new LinearLayout.LayoutParams(dp(22), dp(22)));
            TextView title = label(labels[i], 11, true); title.setGravity(Gravity.CENTER); title.setMaxLines(1); title.setEllipsize(android.text.TextUtils.TruncateAt.END); item.setContentDescription(name); item.addView(title);
            if (name.equals(page) || (i == names.length - 1 && !Arrays.asList(names).contains(page))) { item.setBackground(shape(dark ? Color.parseColor("#313B60") : Color.parseColor("#EEEDFF"), 12, false)); icon.setImageTintList(ColorStateList.valueOf(accent)); title.setTextColor(accent); }
            clickable(item, () -> navigate(name)); navigation.addView(item, new LinearLayout.LayoutParams(0, -2, 1));
        }
        root.addView(navigation);
    }
    private void refresh() {
        if (busy) { if (pullRefresh != null) pullRefresh.setRefreshing(false); return; }
        if (pullRefresh != null) pullRefresh.setRefreshing(true);
        if (preview) { body.postDelayed(this::showWorkspace, 650); return; }
        busy = true; final boolean gmail = page.equals("Email inbox");
        async(() -> gmail ? repository.syncGmail() : repository.load(), result -> { busy = false; offline = false; data = result; if (page.equals("Industry news")) newsLoaded = false; showWorkspace(); }, error -> { busy = false; if (pullRefresh != null) pullRefresh.setRefreshing(false); problem(error.getMessage()); });
    }
    private String addActionLabel() {
        // Match the website's page actions (06a-view-router.js and index.html).
        // Client creation and email composition belong to their contextual workflows.
        switch (page) {
            case "Applications": return "Add application";
            case "Daily tasks": return "Add daily task";
            case "To apply": return "Add application reminder";
            case "Wallet": return "Add transaction";
            case "Subscriptions": return "Add subscription";
            case "Scripts": return "Add script";
            case "Softcopy links": return "Add softcopy link";
            case "Documents": return records("personalDocuments").isEmpty() ? "" : "Upload document";
            default: return "";
        }
    }
    private void addFromHeader() {
        if (addActionLabel().isEmpty()) return;
        switch (page) {
            case "Applications": applicationEditor(null, false); break;
            case "Daily tasks": dailyTaskEditor(null); break;
            case "To apply": toApplyEditor(null); break;
            case "Wallet": walletEditor(null); break;
            case "Subscriptions": subscriptionEditor(null); break;
            case "Scripts": toolEditor("scripts", null); break;
            case "Softcopy links": toolEditor("workLinks", null); break;
            case "Documents": pickDocument(""); break;
        }
    }
    private boolean mayEdit() {
        if (preview) { toast("Preview data is separate from your cloud account."); return false; }
        if (offline) { problem("Connect and refresh your workspace before saving changes."); return false; }
        if (busy) { toast("Please wait for the current operation."); return false; } return true;
    }
    private void save(String collection, JSONObject original, JSONObject patch, Runnable after) {
        if (!mayEdit()) return; busy = true;
        async(() -> repository.saveRecord(collection, original, patch), result -> { busy = false; data = result; if (after != null) after.run(); showWorkspace(); toast("Saved to your account"); }, error -> { busy = false; if (after == null) showWorkspace(); problem(error.getMessage()); if (after instanceof SaveCompletion) ((SaveCompletion) after).failed(); });
    }
    private interface SaveCompletion extends Runnable { void failed(); }
    private String display(JSONObject item) {
        for (String key : new String[]{"clientName", "title", "name", "description", "subject"}) if (!text(item, key).isEmpty()) return text(item, key);
        return "Untitled";
    }
    private void empty(String title, String message) { LinearLayout card = card(body); addText(card, title, 18, true); addText(card, message, 14, false); }
    private void heading(String title) { TextView view = label(title, 18, true); LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.topMargin = dp(10); params.bottomMargin = dp(12); body.addView(view, params); }
    private void recordCard(LinearLayout parent, JSONObject item, String detail, Runnable open) {
        LinearLayout card = card(parent), content = row(); card.addView(content); content.addView(iconTile(page, 36)); LinearLayout copy = column(); addText(copy, display(item), 16, true); if (!detail.isEmpty()) addText(copy, detail, 13, false);
        LinearLayout.LayoutParams copyParams = new LinearLayout.LayoutParams(0, -2, 1); copyParams.leftMargin = dp(12); copyParams.rightMargin = dp(8); content.addView(copy, copyParams);
        if (open != null) { content.addView(icon(R.drawable.ic_ui_chevron_right, 16)); clickable(card, open); card.setContentDescription(display(item) + ". Open details"); }
    }
    private FrameLayout profileAvatar(JSONObject item, int size) {
        FrameLayout avatar = new FrameLayout(this); avatar.setBackground(shape(dark ? 0xFF313B60 : 0xFFEEEDFF, size / 2, false)); avatar.setClipToOutline(true);
        String name = display(item); String[] parts = name.trim().split("\\s+");
        String initials = parts.length > 1 ? parts[0].substring(0, 1) + parts[parts.length - 1].substring(0, 1) : name.substring(0, Math.min(2, name.length()));
        TextView fallback = label(initials.toUpperCase(Locale.getDefault()), size > 48 ? 22 : 15, true); fallback.setTextColor(accent); fallback.setGravity(Gravity.CENTER); avatar.addView(fallback, new FrameLayout.LayoutParams(-1, -1));
        ImageView photo = new ImageView(this); photo.setScaleType(ImageView.ScaleType.CENTER_CROP); photo.setContentDescription(name + " profile photo"); avatar.addView(photo, new FrameLayout.LayoutParams(-1, -1));
        JSONObject profile = item.optJSONObject("profileImage");
        if (profile != null && !preview && !text(profile, "storagePath").isEmpty()) {
            String key = "profile:" + text(profile, "storagePath") + ":" + text(profile, "updatedAt"); photo.setTag(key);
            Bitmap cached = imageCache.get(key);
            if (cached != null) photo.setImageBitmap(cached);
            else try {
                final int generation = accountGeneration; java.util.concurrent.Callable<byte[]> request = repository.profilePhoto(profile);
                images.execute(() -> {
                    try {
                        byte[] bytes = request.call(); android.graphics.BitmapFactory.Options options = new android.graphics.BitmapFactory.Options(); options.inJustDecodeBounds = true;
                        android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options); options.inSampleSize = 1;
                        while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > 256) options.inSampleSize *= 2;
                        options.inJustDecodeBounds = false; Bitmap bitmap = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
                        if (bitmap != null) runOnUiThread(() -> { if (!isDestroyed() && generation == accountGeneration && key.equals(photo.getTag())) { imageCache.put(key, bitmap); photo.setImageBitmap(bitmap); } });
                    } catch (Exception ignored) { /* Initials stay visible if the stored photo cannot be downloaded. */ }
                });
            } catch (Exception ignored) { }
        }
        return avatar;
    }
    private void clientRecordCard(LinearLayout parent, JSONObject item, String detail, Runnable open) {
        LinearLayout card = card(parent), content = row(); card.addView(content);
        LinearLayout.LayoutParams avatarParams = new LinearLayout.LayoutParams(dp(48), dp(48)); avatarParams.rightMargin = dp(12); content.addView(profileAvatar(item, 48), avatarParams);
        LinearLayout copy = column(); addText(copy, display(item), 16, true); if (!detail.isEmpty()) addText(copy, detail, 13, false); content.addView(copy, new LinearLayout.LayoutParams(0, -2, 1));
        clickable(card, open); card.setContentDescription(display(item) + ". Open client profile");
    }
    private List<JSONObject> records(String collection) { return WorkspaceModel.records(data, collection); }
    private List<JSONObject> orderedRecords(String collection, String dateField) {
        List<JSONObject> items = records(collection); items.sort((a, b) -> listOrder.equals("Name") ? display(a).compareToIgnoreCase(display(b)) : listOrder.equals("Oldest") || listOrder.equals("Due date") ? (text(a, dateField).isEmpty() ? "9999-12-31" : text(a, dateField)).compareTo(text(b, dateField).isEmpty() ? "9999-12-31" : text(b, dateField)) : text(b, dateField).compareTo(text(a, dateField))); return items;
    }
    private String joined(JSONObject item, String... fields) {
        List<String> parts = new ArrayList<>(); for (String field : fields) if (!text(item, field).isEmpty()) parts.add(text(item, field)); return android.text.TextUtils.join(" · ", parts);
    }
    private void dashboard() throws Exception {
        segments(body, new String[]{"Application", "Client"}, clientDashboard ? "Client" : "Application", choice -> {
            clientDashboard = choice.equals("Client"); preferences.edit().putBoolean("clientDashboard", clientDashboard).apply(); showWorkspace();
        });
        addText(body, new java.text.SimpleDateFormat("EEEE, MMMM d", Locale.getDefault()).format(new Date()), 12, false);
        heading(clientDashboard ? "Client dashboard" : "Application dashboard");
        List<JSONObject> applications = records("applications"); String today = WorkspaceModel.today();
        if (!clientDashboard) {
            long pipeline = 0, interviews = 0, followups = 0, appliedToday = 0;
            String[] stages = {"Applied", "Ongoing", "To Proceed", "Interview", "Not selected"}; double[] counts = new double[stages.length + 1];
            for (JSONObject item : applications) {
                if ("Active client".equals(text(item, "status"))) continue;
                pipeline++; boolean known = false; for (int i = 0; i < stages.length; i++) if (stages[i].equals(text(item, "status"))) { counts[i]++; known = true; } if (!known) counts[stages.length]++;
                if ("Interview".equals(text(item, "status"))) interviews++;
                if (text(item, "appliedDate").startsWith(today)) appliedToday++;
                String due = text(item, "followUpDate"); if (!due.isEmpty() && due.compareTo(today) <= 0 && !"Not selected".equals(text(item, "status"))) followups++;
            }
            LinearLayout top = row(); body.addView(top); stat(top, "Applications", pipeline, "Applications"); stat(top, "Applied today", appliedToday, "Applications");
            LinearLayout bottom = row(); body.addView(bottom); stat(bottom, "Interviews", interviews, "Applications"); stat(bottom, "Follow-ups due", followups, "Applications");
            chart("Application pipeline", "Your current application stages", new String[]{"Applied", "Ongoing", "To proceed", "Interview", "Not selected", "Other"}, counts, true);
            chart("Application activity", "Applications submitted · last 7 days", dayLabels(), applicationTrend(), false);
            heading("Recent applications"); applications.sort((a, b) -> text(b, "appliedDate").compareTo(text(a, "appliedDate"))); int shown = 0;
            for (JSONObject item : applications) if (!"Active client".equals(text(item, "status"))) {
                recordCard(body, item, joined(item, "role", "status"), () -> applicationDetails(item)); if (++shown == 4) break;
            }
            if (shown == 0) empty("Start your next opportunity", "Add an application to see your progress here.");
        } else {
            long active = 0, ending = 0, ended = 0, open = 0;
            Calendar next = Calendar.getInstance(); next.add(Calendar.DAY_OF_YEAR, 30); String soon = new java.text.SimpleDateFormat("yyyy-MM-dd", Locale.US).format(next.getTime());
            for (JSONObject client : applications) if ("Active client".equals(text(client, "status"))) {
                if (WorkspaceModel.active(client)) active++; else ended++;
                String end = text(client, "contractEndDate"); if (WorkspaceModel.active(client) && !end.isEmpty() && end.compareTo(today) >= 0 && end.compareTo(soon) <= 0) ending++;
            }
            for (JSONObject task : records("clientTasks")) if (!"done".equals(text(task, "status")) && text(task, "completedAt").isEmpty()) open++;
            LinearLayout top = row(); body.addView(top); stat(top, "Active clients", active, "Active clients"); stat(top, "Ending in 30 days", ending, "Active clients");
            LinearLayout bottom = row(); body.addView(bottom); stat(bottom, "Contracts ended", ended, "Active clients"); stat(bottom, "Open client tasks", open, "Daily tasks");
            chart("Logged hours", "Client work · last 7 days", dayLabels(), clientHoursTrend(), false);
            heading("Client tasks"); int shown = 0;
            for (JSONObject task : records("clientTasks")) if (!"done".equals(text(task, "status")) && text(task, "completedAt").isEmpty()) {
                recordCard(body, task, joined(task, "dueDate", "priority"), () -> clientTaskDetails(task)); if (++shown == 3) break;
            }
            if (shown == 0) empty("All caught up", "No open client tasks.");
            heading("Your clients"); shown = 0;
            for (JSONObject client : applications) if (WorkspaceModel.active(client)) { clientRecordCard(body, client, joined(client, "role", "contact"), () -> clientDetails(client)); if (++shown == 4) break; }
            if (shown == 0) empty("No active clients yet", "Your saved clients will appear here.");
        }
        action(body, "View weekly report →", false, () -> navigate("Weekly report"));
    }
    private interface Choice { void selected(String value); }
    private void segments(LinearLayout parent, String[] options, String selected, Choice callback) {
        HorizontalScrollView scroll = new HorizontalScrollView(this); scroll.setHorizontalScrollBarEnabled(false);
        LinearLayout bar = row(); bar.setPadding(dp(4), dp(4), dp(4), dp(4)); bar.setBackground(shape(surface, 14, false));
        for (String option : options) {
            String caption = option.equals("all") ? "All news" : option.equals("ai-tools") ? "AI tools" : option.equals("virtual-assistants") ? "Virtual assistants" : option.equals("automation") ? "Automation" : option.equals("web") ? "Web" : option;
            TextView tab = label(caption, 13, true); tab.setGravity(Gravity.CENTER); tab.setMinHeight(dp(48)); tab.setPadding(dp(16), dp(8), dp(16), dp(8));
            if (option.equals(selected)) { tab.setBackground(shape(dark ? 0xFF313B60 : Color.WHITE, 10, true)); tab.setTextColor(accent); }
            clickable(tab, () -> callback.selected(option)); bar.addView(tab);
        }
        scroll.addView(bar); LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.bottomMargin = dp(12); parent.addView(scroll, params);
    }
    private String[] recentDays() {
        String[] result = new String[7]; Calendar day = Calendar.getInstance(); day.add(Calendar.DAY_OF_YEAR, -6);
        for (int i = 0; i < 7; i++) { result[i] = new java.text.SimpleDateFormat("yyyy-MM-dd", Locale.US).format(day.getTime()); day.add(Calendar.DAY_OF_YEAR, 1); } return result;
    }
    private String[] dayLabels() {
        String[] result = new String[7]; Calendar day = Calendar.getInstance(); day.add(Calendar.DAY_OF_YEAR, -6);
        for (int i = 0; i < 7; i++) { result[i] = new java.text.SimpleDateFormat("EEE", Locale.getDefault()).format(day.getTime()); day.add(Calendar.DAY_OF_YEAR, 1); } return result;
    }
    private double[] applicationTrend() {
        double[] result = new double[7]; String[] days = recentDays();
        for (JSONObject item : records("applications")) for (int i = 0; i < 7; i++) if (text(item, "appliedDate").startsWith(days[i])) result[i]++; return result;
    }
    private double[] clientHoursTrend() {
        double[] result = new double[7]; String[] days = recentDays();
        for (JSONObject task : records("clientTasks")) { JSONArray entries = WorkspaceModel.array(task, "timeEntries");
            for (int n = 0; n < entries.length(); n++) { JSONObject entry = entries.optJSONObject(n); if (entry == null) continue;
                for (int i = 0; i < 7; i++) if (text(entry, "start").startsWith(days[i])) result[i] += Math.max(0, entry.optLong("durationMs")) / 3600000.0;
            }
        } return result;
    }
    private void chart(String title, String subtitle, String[] labels, double[] values, boolean donut) {
        LinearLayout panel = card(body); addText(panel, title, 16, true); addText(panel, subtitle, 12, false);
        panel.addView(new WorkspaceChart(this, labels, values, donut, dark), new LinearLayout.LayoutParams(-1, dp(donut ? 176 : 180)));
    }
    private void stat(LinearLayout parent, String title, long number, String destination) {
        LinearLayout card = column(); card.setPadding(dp(14), dp(14), dp(14), dp(14)); card.setBackground(shape(surface, 16, true));
        TextView caption = label(title, 12, false); caption.setMinHeight(dp(32)); card.addView(caption); TextView value = label(String.valueOf(number), 30, true); value.setTextSize(25); value.setTextColor(accent); card.addView(value); LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, -2, 1); params.setMargins(dp(3), 0, dp(3), dp(10)); parent.addView(card, params); clickable(card, () -> navigate(destination));
    }
    private void more() {
        accountSummary(body, true);
        String[][] groups = {{"Workspace", "To apply", "Industry news", "Assistant", "Weekly report"}, {"Finance", "Wallet", "Subscriptions", "Invoices", "Salary"}, {"Documents & writing", "Cover letter", "Scripts", "Softcopy links", "Documents", "Templates"}, {"Your account", "Account", "Settings"}};
        for (String[] group : groups) { heading(group[0]); for (int i = 1; i < group.length; i++) { final String name = group[i]; navigationRow(body, name, pageDescription(name), () -> navigate(name)); } }
    }
    private String pageDescription(String name) {
        switch(name) {
            case "To apply": return "Upcoming opportunities and reminders";
            case "Industry news": return "Latest stories and industry updates";
            case "Assistant": return "Research and practical answers";
            case "Weekly report": return "Applications, completed work and hours";
            case "Wallet": return "Balances and transactions";
            case "Subscriptions": return "Paid accounts and renewal dates";
            case "Invoices": return "Invoices and payment records";
            case "Salary": return "Calculate your monthly equivalent";
            case "Cover letter": return "Write and share a local letter draft";
            case "Scripts": return "Reusable text for your work";
            case "Softcopy links": return "Google Docs, Sheets and work links";
            case "Documents": return "Your personal and client files";
            case "Templates": return "Saved email templates";
            case "Account": return "Profile, sign-in and connections";
            default: return "Appearance, notifications and app settings";
        }
    }
    private static final class Field {
        final String key, title, kind; final boolean required; final String[] choices;
        Field(String key, String title, String kind, boolean required, String... choices) {
            this.key = key; this.title = title; this.kind = kind; this.required = required; this.choices = choices;
        }
    }
    private Field field(String key, String title, String kind, boolean required, String... choices) { return new Field(key, title, kind, required, choices); }
    private Spinner select(LinearLayout parent, String title, String value, String[] options) {
        addText(parent, title, 13, true); List<String> values = new ArrayList<>(Arrays.asList(options));
        if (!value.isEmpty() && !values.contains(value)) values.add(value);
        Spinner spinner = new Spinner(this) {
            @Override public boolean performClick() {
                String[] labels = new String[values.size()]; for (int i = 0; i < values.size(); i++) labels[i] = choiceLabel(values.get(i));
                track(dialogBuilder().setTitle(title).setSingleChoiceItems(labels, getSelectedItemPosition(), (d, which) -> setSelection(which)).setNegativeButton("Cancel", null).create()); return true;
            }
        };
        ArrayAdapter<String> adapter = new ArrayAdapter<String>(this, android.R.layout.simple_spinner_item, values) {
            @Override public View getView(int position, View convert, android.view.ViewGroup group) { TextView v = (TextView) super.getView(position, convert, group); v.setText(choiceLabel(getItem(position))); v.setTextColor(foreground); v.setTextSize(14); v.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL)); v.setPadding(dp(12), dp(10), dp(12), dp(10)); v.setCompoundDrawablesRelativeWithIntrinsicBounds(0, 0, R.drawable.ic_ui_chevron_right, 0); for (android.graphics.drawable.Drawable d : v.getCompoundDrawablesRelative()) if (d != null) d.setTint(accent); return v; }
            @Override public View getDropDownView(int position, View convert, android.view.ViewGroup group) { TextView v = (TextView) super.getDropDownView(position, convert, group); v.setText(choiceLabel(getItem(position))); v.setTextColor(foreground); v.setBackgroundColor(surface); v.setPadding(dp(18), dp(15), dp(18), dp(15)); return v; }
        };
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item); spinner.setAdapter(adapter); spinner.setBackground(shape(surface, 10, true)); spinner.setSelection(Math.max(0, values.indexOf(value)));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(52)); params.bottomMargin = dp(16); parent.addView(spinner, params); return spinner;
    }
    private String choiceLabel(String value) {
        if (value == null || value.isEmpty()) return "Not set";
        switch (value) {
            case "Not selected": return "Rejected";
            case "maribank": return "MariBank"; case "gcash": return "GCash"; case "wise": return "Wise";
            case "payable": return "To be paid"; case "opening": return "Opening balance";
            case "research": return "Research with web sources"; case "reasoning": return "Reasoning";
            case "task": return "General task"; case "client": return "Client work";
            case "application": return "Job application"; case "apply": return "Apply somewhere";
            default: return value.substring(0, 1).toUpperCase(Locale.ROOT) + value.substring(1);
        }
    }
    private void datePicker(EditText input) {
        Calendar date = Calendar.getInstance();
        try { String[] pieces = input.getText().toString().split("-"); if (pieces.length == 3) date.set(Integer.parseInt(pieces[0]), Integer.parseInt(pieces[1]) - 1, Integer.parseInt(pieces[2])); } catch (Exception ignored) { }
        DatePickerDialog picker = new DatePickerDialog(this, dark ? R.style.WorkspaceDialogDark : R.style.WorkspaceDialogLight,
            (view, year, month, day) -> input.setText(String.format(Locale.US, "%04d-%02d-%02d", year, month + 1, day)), date.get(Calendar.YEAR), date.get(Calendar.MONTH), date.get(Calendar.DAY_OF_MONTH));
        picker.setButton(AlertDialog.BUTTON_NEUTRAL, "Clear", (d, which) -> input.setText("")); picker.show();
    }
    private void editor(String title, String collection, JSONObject original, JSONObject defaults, Field... fields) {
        if (!mayEdit()) return;
        JSONObject initial;
        try {
            initial = original == null ? (defaults == null ? new JSONObject() : WorkspaceModel.copy(defaults)) : WorkspaceModel.copy(original);
            if (original != null && defaults != null) { Iterator<String> keys = defaults.keys(); while (keys.hasNext()) { String key = keys.next(); if (text(initial, key).isEmpty()) initial.put(key, defaults.opt(key)); } }
        } catch (Exception error) { problem(error.getMessage()); return; }
        LinearLayout content = column(); content.setPadding(0, dp(4), 0, dp(8)); ScrollView scroll = new ScrollView(this); scroll.addView(content);
        Map<String, View> controls = new LinkedHashMap<>();
        for (Field field : fields) {
            String value = text(initial, field.key);
            if (field.kind.equals("choice")) controls.put(field.key, select(content, field.title, value, field.choices));
            else {
                int type = field.kind.equals("email") ? InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
                    : field.kind.equals("number") || field.kind.equals("money") ? InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL
                    : field.kind.equals("multiline") ? InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE : InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES;
                EditText input = input(content, field.title + (field.required ? " *" : ""), value, type);
                if (field.kind.equals("multiline")) { input.setMinLines(3); input.setGravity(Gravity.TOP); }
                if (field.kind.equals("date")) { input.setFocusable(false); input.setOnClickListener(v -> datePicker(input)); input.setContentDescription(field.title + ". Choose date"); }
                controls.put(field.key, input);
            }
        }
        AlertDialog dialog = dialogBuilder().setTitle(title).setView(scroll).setNegativeButton("Cancel", null).setPositiveButton("Save", null).create();
        track(dialog); dialog.getWindow().setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            try {
                JSONObject patch = original == null && defaults != null ? WorkspaceModel.copy(defaults) : new JSONObject();
                for (Field field : fields) {
                    View control = controls.get(field.key); String value = control instanceof Spinner ? String.valueOf(((Spinner) control).getSelectedItem()) : ((EditText) control).getText().toString().trim();
                    if (field.required && value.isEmpty()) throw new Exception(field.title + " is required.");
                    if (field.kind.equals("email") && !value.isEmpty() && !android.util.Patterns.EMAIL_ADDRESS.matcher(value).matches()) throw new Exception("Enter a valid email address.");
                    if (field.kind.equals("date") && !WorkspaceModel.validDate(value)) throw new Exception("Choose a valid " + field.title.toLowerCase(Locale.US) + ".");
                    if ((field.key.equals("website") || field.key.equals("link") || field.key.equals("url")) && !value.isEmpty()) {
                        Uri address = Uri.parse(value); if (!"https".equalsIgnoreCase(address.getScheme()) && !"http".equalsIgnoreCase(address.getScheme())) throw new Exception("Use a complete https:// or http:// link.");
                    }
                    if (field.kind.equals("number") && !value.isEmpty()) {
                        BigDecimal number = new BigDecimal(value); if (number.signum() < 0) throw new Exception(field.title + " cannot be negative."); patch.put(field.key, number.doubleValue());
                    } else patch.put(field.key, value);
                }
                if (collection.equals("walletEntries")) {
                    patch.put("cents", WorkspaceModel.cents(patch.optString("amount"))); patch.remove("amount");
                    if (patch.optString("type").equals("payable")) { patch.put("account", "unassigned"); if (patch.optString("payee").trim().isEmpty()) throw new Exception("Enter who this payment is for."); }
                }
                if (collection.equals("applications") && original != null && !text(original, "status").equals(patch.optString("status", text(original, "status")))) patch.put("manualStatusChangedAt", WorkspaceModel.now());
                if (collection.equals("invoices")) patch.put("paymentStatus", "paid");
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false); dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setEnabled(false); dialog.setCancelable(false);
                save(collection, original, patch, new SaveCompletion() {
                    public void run() { dialog.dismiss(); }
                    public void failed() { if (dialog.isShowing()) { dialog.setCancelable(true); dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true); dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setEnabled(true); } }
                });
            } catch (Exception error) { problem(error.getMessage()); }
        });
    }
    private void applicationEditor(JSONObject original, boolean client) {
        try {
            JSONObject defaults = client ? json("status", "Active client", "contractStatus", "Active", "activePendingDocument", true, "activePendingEmail", true, "activeAt", WorkspaceModel.now(), "salaryCurrency", "USD") : json("status", "Applied", "appliedDate", WorkspaceModel.today());
            List<Field> fields = new ArrayList<>(Arrays.asList(
                field("clientName", client ? "Client name" : "Company / client", "text", true), field("contact", "Contact name", "text", false),
                field("role", "Role", "text", false), field("email", "Email", "email", false), field("phone", "Phone", "text", false),
                field("location", "Location", "text", false), field("website", "Website", "text", false), field("platform", "Platform", "text", false)));
            if (!client) {
                fields.add(field("status", "Status", "choice", true, "Ongoing", "Applied", "To Proceed", "Interview", "Not selected"));
                fields.add(field("appliedDate", "Applied date", "date", false)); fields.add(field("followUpDate", "Follow-up date", "date", false));
            } else {
                fields.add(field("salaryAmount", "Rate amount", "number", false)); fields.add(field("salaryCurrency", "Currency", "choice", true, "USD", "PHP", "AUD", "CAD", "EUR", "GBP"));
                fields.add(field("salaryType", "Rate period", "choice", false, "", "monthly", "hourly"));
                fields.add(field("hoursPerWeek", "Hours per week", "number", false)); fields.add(field("contractEndDate", "Contract end date", "date", false));
                fields.add(field("contractStatus", "Contract status", "choice", true, "Active", "Contract Ended"));
            }
            fields.add(field("notes", "Notes", "multiline", false));
            editor(original == null ? (client ? "Add client" : "Add application") : "Edit " + (client ? "client" : "application"), "applications", original, defaults, fields.toArray(new Field[0]));
        } catch (Exception error) { problem(error.getMessage()); }
    }
    private interface RenderRecords { void render(LinearLayout target, String query); }
    private void searchable(String hint, RenderRecords render) {
        LinearLayout searchBar = row(); searchBar.setPadding(dp(16), 0, 0, 0); searchBar.setMinimumHeight(dp(52)); searchBar.setBackground(shape(dark ? 0xFF222632 : 0xFFF5F6FA, 26, false)); searchBar.addView(icon(R.drawable.ic_ui_search, 20));
        EditText search = new EditText(this); search.setSingleLine(true); search.setTextSize(14); search.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL)); search.setTextColor(foreground); search.setHintTextColor(dark ? 0xFFCBD0DA : 0xFF667085); search.setHint(hint); search.setContentDescription("Search " + page.toLowerCase(Locale.ROOT)); search.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS); search.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH); search.setBackgroundColor(Color.TRANSPARENT); search.setPadding(dp(12), dp(10), dp(8), dp(10)); search.setText(query); searchBar.addView(search, new LinearLayout.LayoutParams(0, -2, 1));
        ImageButton clear = new ImageButton(this); clear.setImageResource(R.drawable.ic_ui_close); clear.setImageTintList(ColorStateList.valueOf(dark ? Color.WHITE : 0xFF667085)); clear.setContentDescription("Clear search"); clear.setPadding(dp(14), dp(14), dp(14), dp(14)); clear.setBackground(new RippleDrawable(ColorStateList.valueOf(0x224F46E5), shape(Color.TRANSPARENT, 24, false), null)); clear.setVisibility(query.isEmpty() ? View.GONE : View.VISIBLE); clear.setOnClickListener(v -> { search.setText(""); search.requestFocus(); }); searchBar.addView(clear, new LinearLayout.LayoutParams(dp(48), dp(48)));
        search.setOnFocusChangeListener((v, focused) -> { GradientDrawable fill = shape(dark ? 0xFF222632 : 0xFFF5F6FA, 26, false); if (focused) fill.setStroke(dp(2), accent); searchBar.setBackground(fill); if (!focused) liveHandler.post(this::renderLiveWorkspace); });
        search.setOnEditorActionListener((v, action, event) -> { if (action == android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH) { hideKeyboard(); search.clearFocus(); return true; } return false; });
        int searchIndex = body.getChildCount(); if (searchIndex > 0 && "list-controls".equals(body.getChildAt(searchIndex - 1).getTag())) searchIndex--;
        LinearLayout.LayoutParams searchParams = new LinearLayout.LayoutParams(-1, -2); searchParams.bottomMargin = dp(10); body.addView(searchBar, searchIndex, searchParams);
        LinearLayout results = column(); body.addView(results);
        render.render(results, query.toLowerCase(Locale.ROOT));
        search.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
            public void onTextChanged(CharSequence s, int start, int before, int count) { query = s.toString(); if (page.equals("Email inbox")) mailVisibleLimit = 30; clear.setVisibility(query.isEmpty() ? View.GONE : View.VISIBLE); results.removeAllViews(); render.render(results, query.toLowerCase(Locale.ROOT)); }
            public void afterTextChanged(Editable e) { }
        });
    }
    private void applications(boolean clients) {
        choiceRow(body, clients ? "Client status" : "Application stage", filter, clients ? new String[]{"All", "Active", "Contract ended"} : new String[]{"All", "Applied", "Ongoing", "To Proceed", "Interview", "Not selected"}, selected -> { filter = selected; showWorkspace(); });
        choiceRow(body, "Sort", listOrder, new String[]{"Newest", "Oldest", "Name"}, selected -> { listOrder = selected; showWorkspace(); });
        searchable(clients ? "Find a client" : "Company, role or status", (target, term) -> {
            int shown = 0;
            List<JSONObject> items = records("applications"); items.sort((a, b) -> listOrder.equals("Name") ? display(a).compareToIgnoreCase(display(b)) : listOrder.equals("Oldest") ? text(a, "createdAt").compareTo(text(b, "createdAt")) : text(b, "createdAt").compareTo(text(a, "createdAt")));
            for (JSONObject item : items) {
                if (clients != "Active client".equals(text(item, "status"))) continue;
                if (!joined(item, "clientName", "role", "email", "status").toLowerCase(Locale.ROOT).contains(term)) continue;
                String status = clients ? (WorkspaceModel.ended(item) ? "Contract ended" : "Active") : text(item, "status");
                if (!filter.equals("All") && !filter.equals(status)) continue;
                if (clients) clientRecordCard(target, item, joined(item, "role", "email") + "\n" + status, () -> clientDetails(item));
                else recordCard(target, item, joined(item, "role", "email") + "\n" + status, () -> applicationDetails(item)); shown++;
            }
            if (shown == 0) addText(card(target), "No matching " + (clients ? "clients" : "applications") + ".", 15, false);
        });
    }
    private LinearLayout detailsContent(JSONObject item, String... fields) {
        LinearLayout content = column(); content.setPadding(0, 0, 0, dp(8));
        for (String field : fields) if (!text(item, field).isEmpty()) {
            LinearLayout fieldRow = column(); fieldRow.setPadding(dp(14), dp(10), dp(14), dp(10)); fieldRow.setBackground(shape(dark ? 0xFF222632 : 0xFFF7F8FB, 12, false));
            String title = field.replaceAll("([A-Z])", " $1"); TextView caption = label(title.substring(0, 1).toUpperCase(Locale.US) + title.substring(1), 12, true); caption.setTextColor(dark ? Color.WHITE : 0xFF667085); fieldRow.addView(caption);
            TextView value = label(text(item, field), 14, false); value.setTextIsSelectable(true); value.setPadding(0, dp(4), 0, 0); fieldRow.addView(value);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.bottomMargin = dp(8); content.addView(fieldRow, params);
        }
        return content;
    }
    private AlertDialog detailDialog(String title, LinearLayout content, Runnable edit) {
        ScrollView scroll = new ScrollView(this); scroll.addView(content);
        WorkspaceDialog.Builder builder = dialogBuilder().setTitle(title).setIcon(pageIcon(page)).setView(scroll).setNegativeButton("Close", null);
        if (edit != null) builder.setPositiveButton("Edit", (d, which) -> edit.run());
        AlertDialog dialog = builder.create(); track(dialog); return dialog;
    }
    private void applicationDetails(JSONObject item) {
        LinearLayout content = detailsContent(item, "role", "status", "contact", "email", "location", "platform", "appliedDate", "followUpDate", "notes");
        if (!text(item, "website").isEmpty()) action(content, "Open company website", false, () -> openExternal(text(item, "website")));
        detailDialog(display(item), content, () -> applicationEditor(item, false));
    }
    private void clientDetails(JSONObject client) {
        LinearLayout content = detailsContent(client, "role", "contact", "email", "phone", "location", "contractStatus", "contractEndDate", "salaryAmount", "salaryCurrency", "salaryType", "notes");
        LinearLayout.LayoutParams avatarParams = new LinearLayout.LayoutParams(dp(72), dp(72)); avatarParams.bottomMargin = dp(16); content.addView(profileAvatar(client, 72), 0, avatarParams);
        addText(content, "Client tasks", 18, true);
        segments(content, new String[]{"To do", "Completed"}, clientTaskSection, selected -> { clientTaskSection = selected; closeDialogs(); clientDetails(client); });
        int taskCount = 0;
        for (JSONObject task : WorkspaceModel.taskList(data, "clientTasks", clientTaskSection.equals("Completed"), "Due date", "")) if (text(task, "clientId").equals(text(client, "id"))) {
            recordCard(content, task, joined(task, "dueDate", "priority", "status"), () -> clientTaskDetails(task)); taskCount++;
        }
        if (taskCount == 0) addText(content, "No " + clientTaskSection.toLowerCase(Locale.ROOT) + " client tasks.", 13, false);
        action(content, "+ Add client task", false, () -> clientTaskEditor(null, client));
        addText(content, "Documents", 18, true);
        JSONArray documents = WorkspaceModel.array(client, "documents");
        for (int i = 0; i < documents.length(); i++) { JSONObject document = documents.optJSONObject(i); if (document != null) action(content, text(document, "name"), false, () -> openDocument(document)); }
        action(content, "Upload PDF or Word document", false, () -> pickDocument(text(client, "id")));
        detailDialog(display(client), content, () -> applicationEditor(client, true));
    }
    private void tasks() {
        int complete = 0; for (JSONObject task : records("dailyTasks")) if (WorkspaceModel.taskComplete(task)) complete++;
        addText(body, (records("dailyTasks").size() - complete) + " to do  ·  " + complete + " completed", 13, false);
        segments(body, new String[]{"To do", "Completed"}, taskSection, selected -> { taskSection = selected; taskOrder = selected.equals("Completed") ? "Newest" : "Due date"; showWorkspace(); });
        choiceRow(body, "Sort tasks", taskOrder, new String[]{"Due date", "Newest", "Title"}, selected -> { taskOrder = selected; showWorkspace(); });
        searchable("Title, date or linked record", (target, term) -> {
            List<JSONObject> items = WorkspaceModel.taskList(data, "dailyTasks", taskSection.equals("Completed"), taskOrder, term);
            for (JSONObject task : items) {
                boolean completed = WorkspaceModel.taskComplete(task); LinearLayout card = card(target), header = row(); card.addView(header);
                CheckBox checkbox = new CheckBox(this); checkbox.setContentDescription((completed ? "Mark to do: " : "Complete task: ") + display(task)); checkbox.setChecked(completed); checkbox.setButtonTintList(ColorStateList.valueOf(accent)); header.addView(checkbox, new LinearLayout.LayoutParams(dp(48), dp(48)));
                TextView title = label(display(task), 16, true); if (completed) title.setPaintFlags(title.getPaintFlags() | android.graphics.Paint.STRIKE_THRU_TEXT_FLAG); header.addView(title, new LinearLayout.LayoutParams(0, -2, 1)); clickable(title, () -> taskDetails(task));
                ImageButton menu = new ImageButton(this); menu.setImageResource(R.drawable.ic_ui_more); menu.setImageTintList(ColorStateList.valueOf(foreground)); menu.setBackground(shape(surface, 10, false)); menu.setContentDescription("Task actions for " + display(task)); header.addView(menu, new LinearLayout.LayoutParams(dp(48), dp(48))); menu.setOnClickListener(v -> taskActions(task));
                if (!text(task, "relatedName").isEmpty()) { TextView related = label(text(task, "relatedName"), 12, false); LinearLayout.LayoutParams relatedParams = new LinearLayout.LayoutParams(-1, -2); relatedParams.leftMargin = dp(48); relatedParams.bottomMargin = dp(8); card.addView(related, relatedParams); }
                String due = text(task, "taskDate"), chip = completed ? "Completed" : due.isEmpty() ? "No due date" : due.equals(WorkspaceModel.today()) ? "Due today" : due.compareTo(WorkspaceModel.today()) < 0 ? "Overdue · " + due : "Due " + due;
                TextView badge = label(chip, 11, true); badge.setPadding(dp(9), dp(5), dp(9), dp(5)); badge.setBackground(shape(dark ? 0xFF313B60 : completed ? 0xFFEAF8F0 : due.isEmpty() || due.compareTo(WorkspaceModel.today()) >= 0 ? 0xFFF0EFFF : 0xFFFFF3E4, 8, false)); LinearLayout.LayoutParams badgeParams = new LinearLayout.LayoutParams(-2, -2); badgeParams.leftMargin = dp(48); card.addView(badge, badgeParams);
                checkbox.setOnCheckedChangeListener((view, checked) -> { if (!mayEdit()) { view.setOnCheckedChangeListener(null); view.setChecked(completed); return; } setTaskComplete(task, checked); });
            }
            if (items.isEmpty()) { addText(card(target), taskSection.equals("Completed") ? "No completed tasks yet" : "You're all caught up", 16, true); addText(target, "Try another filter or search.", 13, false); }
        });
    }
    private void setTaskComplete(JSONObject task, boolean complete) {
        try { JSONObject patch = json("completedAt", complete ? WorkspaceModel.now() : ""); if (task.has("status")) patch.put("status", complete ? "done" : "todo"); save("dailyTasks", task, patch, null); }
        catch (Exception error) { problem(error.getMessage()); }
    }
    private void taskActions(JSONObject task) {
        track(dialogBuilder().setTitle(display(task)).setItems(new String[]{"View details", "Edit task", WorkspaceModel.taskComplete(task) ? "Move to To do" : "Mark complete"}, (dialog, which) -> {
            if (which == 0) taskDetails(task); else if (which == 1) dailyTaskEditor(task); else setTaskComplete(task, !WorkspaceModel.taskComplete(task));
        }).setNegativeButton("Cancel", null).create());
    }
    private void dailyTaskEditor(JSONObject task) {
        try { editor(task == null ? "Add daily task" : "Edit daily task", "dailyTasks", task,
            json("type", "task", "taskDate", WorkspaceModel.today(), "completedAt", "", "checklist", new JSONArray(), "relatedId", "", "relatedType", "", "relatedName", ""),
            field("title", "Task title", "text", true), field("taskDate", "Date", "date", true),
            field("type", "Type", "choice", true, "task", "client", "application", "apply", "content"),
            field("destination", "Destination / job link", "text", false), field("notes", "Notes", "multiline", false));
        } catch (Exception error) { problem(error.getMessage()); }
    }
    private void taskDetails(JSONObject task) {
        LinearLayout content = detailsContent(task, "taskDate", "type", "relatedName", "destination", "notes", "completedAt");
        JSONArray checklist = WorkspaceModel.array(task, "checklist");
        for (int i = 0; i < checklist.length(); i++) {
            final int index = i; JSONObject entry = checklist.optJSONObject(i); if (entry == null) continue;
            CheckBox checkbox = new CheckBox(this); checkbox.setText(text(entry, "text").isEmpty() ? text(entry, "title") : text(entry, "text")); checkbox.setTextColor(foreground); checkbox.setButtonTintList(ColorStateList.valueOf(foreground)); checkbox.setChecked(entry.optBoolean("done", entry.optBoolean("completed", false))); content.addView(checkbox);
            checkbox.setOnCheckedChangeListener((view, checked) -> {
                try {
                    JSONArray changed = new JSONArray(WorkspaceModel.array(task, "checklist").toString()); JSONObject row = changed.getJSONObject(index);
                    row.put(row.has("completed") ? "completed" : "done", checked);
                    save("dailyTasks", task, json("checklist", changed), () -> { try { task.put("checklist", changed); } catch (Exception ignored) { } });
                } catch (Exception error) { problem(error.getMessage()); }
            });
        }
        action(content, "Delete task", false, () -> confirmDelete("dailyTasks", task));
        detailDialog(display(task), content, () -> dailyTaskEditor(task));
    }
    private void clientTaskEditor(JSONObject task, JSONObject client) {
        try {
            JSONObject defaults = json("clientId", text(client, "id"), "status", "todo", "priority", "Medium", "dueDate", WorkspaceModel.today(), "completedAt", "", "timeEntries", new JSONArray(), "repeat", json("frequency", "none"));
            editor(task == null ? "Add client task" : "Edit client task", "clientTasks", task, defaults,
                field("title", "Task title", "text", true), field("dueDate", "Due date", "date", false), field("category", "Category", "text", false),
                field("priority", "Priority", "choice", true, "Low", "Medium", "High", "Urgent"), field("notes", "Notes", "multiline", false));
        } catch (Exception error) { problem(error.getMessage()); }
    }
    private void clientTaskDetails(JSONObject task) {
        LinearLayout content = detailsContent(task, "dueDate", "status", "priority", "category", "notes");
        boolean done = "done".equals(text(task, "status")) || !text(task, "completedAt").isEmpty();
        action(content, done ? "Mark as to do" : "Mark complete", true, () -> {
            if (!mayEdit()) return; busy = true;
            async(() -> repository.completeClientTask(task, !done), state -> { busy = false; data = state; closeDialogs(); showWorkspace(); toast("Task saved"); });
        });
        long duration = 0; JSONArray entries = WorkspaceModel.array(task, "timeEntries");
        for (int i = 0; i < entries.length(); i++) if (entries.optJSONObject(i) != null) duration += Math.max(0, entries.optJSONObject(i).optLong("durationMs"));
        addText(content, String.format(Locale.US, "Time logged: %.1f hours", duration / 3600000.0), 14, true);
        action(content, text(task, "timerStartedAt").isEmpty() ? "Start timer" : "Stop timer", false, () -> {
            if (!mayEdit()) return; busy = true;
            async(() -> repository.toggleTimer(task), state -> { busy = false; data = state; closeDialogs(); showWorkspace(); toast("Timer updated"); });
        });
        JSONObject client = null; for (JSONObject item : records("applications")) if (text(item, "id").equals(text(task, "clientId"))) client = item;
        final JSONObject owner = client;
        detailDialog(display(task), content, owner == null ? null : () -> clientTaskEditor(task, owner));
    }
    private void closeDialogs() { for (AlertDialog dialog : new HashSet<>(dialogs)) dialog.dismiss(); }
    private void confirmDelete(String collection, JSONObject item) {
        if (!mayEdit()) return;
        track(dialogBuilder().setTitle("Delete " + display(item) + "?").setMessage("This removes the record from your shared workspace.")
            .setNegativeButton("Cancel", null).setPositiveButton("Delete", (dialog, which) -> {
                if (busy) return; busy = true; async(() -> repository.deleteRecord(collection, item), state -> { busy = false; data = state; closeDialogs(); showWorkspace(); toast("Deleted"); });
            }).create());
    }
    private void toApply() {
        choiceRow(body, "Sort reminders", listOrder, new String[]{"Due date", "Newest", "Name"}, selected -> { listOrder = selected; showWorkspace(); });
        searchable("Company, date or notes", (target, term) -> {
            int shown = 0;
            for (JSONObject reminder : orderedRecords("toApply", "dueDate")) if (joined(reminder, "title", "link", "notes").toLowerCase(Locale.ROOT).contains(term)) {
                recordCard(target, reminder, joined(reminder, "dueDate", "link"), () -> {
                    LinearLayout content = detailsContent(reminder, "dueDate", "link", "notes");
                    if (!text(reminder, "link").isEmpty()) action(content, "Open job link", true, () -> openExternal(text(reminder, "link")));
                    action(content, "Delete reminder", false, () -> confirmDelete("toApply", reminder)); detailDialog(display(reminder), content, () -> toApplyEditor(reminder));
                }); shown++;
            }
            if (shown == 0) addText(card(target), "No application reminders found.", 15, false);
        });
    }
    private void toApplyEditor(JSONObject record) {
        try { editor(record == null ? "Add reminder" : "Edit reminder", "toApply", record, json("dueDate", WorkspaceModel.today()),
            field("title", "Company / opportunity", "text", true), field("link", "Job link", "text", false), field("dueDate", "Apply date", "date", true), field("notes", "Notes", "multiline", false)); }
        catch (Exception error) { problem(error.getMessage()); }
    }
    private String money(long cents) {
        NumberFormat format = NumberFormat.getCurrencyInstance(new Locale("en", "PH")); format.setCurrency(Currency.getInstance("PHP")); return format.format(BigDecimal.valueOf(cents, 2));
    }
    private void wallet() throws Exception {
        JSONObject totals = WorkspaceModel.walletTotals(data);
        LinearLayout summary = card(body); addText(summary, "Total balance", 14, true); addText(summary, money(totals.getLong("balance")), 32, true);
        addText(summary, "After payments: " + money(totals.getLong("available")), 14, false);
        addText(summary, "Income " + money(totals.getLong("income")) + "\nSalary " + money(totals.getLong("salary")) + "\nExpenses " + money(totals.getLong("expense")) + "\nTo be paid " + money(totals.getLong("payable")), 14, false);
        Set<String> missingPhp = new HashSet<>();
        for (JSONObject invoice : records("invoices")) if (!text(invoice, "paidAt").isEmpty() && text(invoice, "amountReceivedPhp").isEmpty()
            && !(text(invoice, "paymentCurrency").equalsIgnoreCase("PHP") && !text(invoice, "amountReceived").isEmpty())) missingPhp.add(text(invoice, "id"));
        if (!missingPhp.isEmpty()) addText(card(body), missingPhp.size() + " paid invoice(s) need an amount received in PHP before they can be included in these totals. Update their payment details in Invoices.", 14, false);
        JSONObject accounts = totals.getJSONObject("accounts");
        for (String account : new String[]{"maribank", "gcash", "wise", "unassigned"}) if (!account.equals("unassigned") || accounts.optLong(account) != 0) {
            LinearLayout card = card(body); addText(card, account.equals("maribank") ? "MariBank" : account.equals("gcash") ? "GCash" : account.equals("wise") ? "Wise" : "Unassigned", 14, true); addText(card, money(accounts.getLong(account)), 22, true);
        }
        heading("Transactions");
        choiceRow(body, "Show transactions", filter, new String[]{"All", "Income", "Expense", "Payable", "Salary", "Opening"}, selected -> { filter = selected; showWorkspace(); });
        choiceRow(body, "Sort transactions", listOrder, new String[]{"Newest", "Oldest", "Name"}, selected -> { listOrder = selected; showWorkspace(); });
        searchable("Search transactions", (target, term) -> {
        int shown = 0;
        for (JSONObject entry : orderedRecords("walletEntries", "date")) { if (!filter.equals("All") && !filter.equalsIgnoreCase(text(entry, "type"))) continue; if (!joined(entry, "description", "account", "payee").toLowerCase(Locale.ROOT).contains(term)) continue;
        recordCard(target, entry, money(entry.optLong("cents")) + " · " + joined(entry, "type", "account", "date"), () -> {
            LinearLayout content = detailsContent(entry, "description", "type", "account", "date", "payee"); addText(content, money(entry.optLong("cents")), 24, true);
            action(content, "Delete transaction", false, () -> confirmDelete("walletEntries", entry)); detailDialog("Transaction", content, () -> walletEditor(entry));
        }); shown++; }
        if (shown == 0) addText(card(target), "No matching transactions.", 14, false);
        });
        action(body, "View invoices and payments", false, () -> navigate("Invoices"));
    }
    private void walletEditor(JSONObject original) {
        try {
            JSONObject initial = original == null ? null : WorkspaceModel.copy(original).put("amount", BigDecimal.valueOf(original.optLong("cents"), 2).toPlainString());
            editor(original == null ? "Add transaction" : "Edit transaction", "walletEntries", initial, json("date", WorkspaceModel.today(), "type", "income", "account", "maribank"),
                field("description", "Description", "text", true), field("amount", "Amount in PHP", "money", true), field("type", "Type", "choice", true, "income", "expense", "payable", "salary", "opening"),
                field("account", "Account", "choice", true, "maribank", "gcash", "wise", "unassigned"), field("payee", "Pay to (for payments due)", "text", false), field("date", "Date / payment deadline", "date", true));
        } catch (Exception error) { problem(error.getMessage()); }
    }
    private void subscriptions() {
        choiceRow(body, "Show subscriptions", filter, new String[]{"All", "Active", "Expired", "Cancelled"}, selected -> { filter = selected; showWorkspace(); });
        searchable("Subscription or account", (target, term) -> {
            int shown = 0;
            List<JSONObject> sorted = records("subscriptions"); sorted.sort(Comparator.comparing(item -> text(item, "expiryDate").isEmpty() ? "9999-12-31" : text(item, "expiryDate")));
            for (JSONObject subscription : sorted) if (joined(subscription, "name", "account").toLowerCase(Locale.ROOT).contains(term)) {
                String expires = text(subscription, "expiryDate"), status = "cancelled".equals(text(subscription, "tracking")) ? "Cancelled" : expires.isEmpty() ? "No end date" : expires.compareTo(WorkspaceModel.today()) < 0 ? "Expired" : "Active";
                if (!filter.equals("All") && !filter.equals(status)) continue;
                recordCard(target, subscription, status + "\n" + joined(subscription, "account", "expiryDate"), () -> subscriptionEditor(subscription)); shown++;
            }
            if (shown == 0) addText(card(target), "No matching subscriptions.", 15, false);
        });
    }
    private void subscriptionEditor(JSONObject item) {
        try { editor(item == null ? "Add subscription" : "Manage subscription", "subscriptions", item, json("tracking", "active"),
            field("name", "Service name", "text", true), field("account", "Account / email", "text", true), field("expiryDate", "Subscription end date", "date", true),
            field("tracking", "Tracking", "choice", true, "active", "cancelled")); }
        catch (Exception error) { problem(error.getMessage()); }
    }
    private void invoices() {
        choiceRow(body, "Payment status", filter, new String[]{"All", "Unpaid", "Paid"}, selected -> { filter = selected; showWorkspace(); });
        List<JSONObject> invoices = records("invoices"); Collections.reverse(invoices);
        int shown = 0; for (JSONObject invoice : invoices) {
            String name = "Invoice " + text(invoice, "invoiceNumber"), status = text(invoice, "paidAt").isEmpty() ? "Unpaid" : "Paid";
            if (!filter.equals("All") && !filter.equals(status)) continue;
            shown++;
            LinearLayout card = card(body); addText(card, name, 17, true); addText(card, status + " · " + joined(invoice, "clientName", "sentAt"), 13, false);
            clickable(card, () -> {
                LinearLayout content = detailsContent(invoice, "invoiceNumber", "clientName", "sentAt", "dueDate", "paidAt", "amountInvoiced", "amountReceived", "paymentCurrency", "amountReceivedPhp", "paymentMethod", "paymentNote");
                action(content, text(invoice, "paidAt").isEmpty() ? "Record payment" : "Edit payment", true, () -> invoicePayment(invoice));
                detailDialog(name, content, null);
            });
        }
        if (shown == 0) empty("No matching invoices", "Try another payment status or check your saved invoices.");
    }
    private void invoicePayment(JSONObject invoice) {
        try {
            editor("Record invoice payment", "invoices", invoice, json("paidAt", WorkspaceModel.today(), "paymentCurrency", "USD"),
                field("paidAt", "Payment date", "date", true), field("amountInvoiced", "Amount invoiced", "number", false), field("amountReceived", "Amount received", "number", true),
                field("paymentCurrency", "Currency", "choice", true, "USD", "PHP", "AUD", "CAD", "EUR", "GBP"), field("amountReceivedPhp", "Amount received in PHP", "number", false),
                field("paymentFee", "Fee", "number", false), field("paymentMethod", "Payment method", "text", false), field("walletAccount", "Wallet account", "choice", true, "unassigned", "maribank", "gcash", "wise"),
                field("paymentNote", "Payment note", "multiline", false));
        } catch (Exception error) { problem(error.getMessage()); }
    }
    private void tools(String collection) {
        addText(body, pageDescription(page), 13, false);
        choiceRow(body, "Sort", listOrder, new String[]{"Newest", "Oldest", "Name"}, selected -> { listOrder = selected; showWorkspace(); });
        if (collection.equals("emailTemplates")) addText(body, "Saved email templates. Document template testing remains available on the website.", 12, false);
        searchable("Search " + page.toLowerCase(Locale.ROOT), (target, term) -> {
            int shown = 0;
            for (JSONObject item : orderedRecords(collection, "updatedAt")) {
                if (!joined(item, "name", "title", "subject", "content", "url").toLowerCase(Locale.ROOT).contains(term)) continue;
                recordCard(target, item, joined(item, "subject", "category", "url"), () -> {
                    LinearLayout content = detailsContent(item, "subject", "body", "content", "url", "notes");
                    if (collection.equals("workLinks")) action(content, "Open link", true, () -> openExternal(text(item, "url")));
                    else action(content, "Copy text", true, () -> {
                        String value = text(item, "body").isEmpty() ? text(item, "content") : text(item, "body");
                        ((ClipboardManager) getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText(display(item), value)); toast("Copied");
                    });
                    detailDialog(display(item), content, () -> toolEditor(collection, item));
                }); shown++;
            }
            if (shown == 0) addText(card(target), "No saved items match this search.", 14, false);
        });
    }
    private void toolEditor(String collection, JSONObject item) {
        Field[] fields = collection.equals("workLinks") ? new Field[]{field("name", "Name", "text", true), field("url", "Link", "text", true), field("notes", "Notes", "multiline", false)}
            : collection.equals("emailTemplates") ? new Field[]{field("name", "Name", "text", true), field("subject", "Subject", "text", false), field("body", "Email text", "multiline", true)}
            : new Field[]{field("title", "Title", "text", true), field("category", "Category", "text", false), field("content", "Script text", "multiline", true)};
        editor(item == null ? "Add item" : "Edit item", collection, item, null, fields);
    }
    private void weekly() {
        Calendar start = Calendar.getInstance(); start.setFirstDayOfWeek(Calendar.MONDAY); start.set(Calendar.DAY_OF_WEEK, Calendar.MONDAY);
        String first = new java.text.SimpleDateFormat("yyyy-MM-dd", Locale.US).format(start.getTime());
        int applications = 0, completed = 0; double hours = 0;
        for (JSONObject item : records("applications")) if (text(item, "appliedDate").compareTo(first) >= 0 && text(item, "appliedDate").compareTo(WorkspaceModel.today()) <= 0) applications++;
        for (JSONObject task : records("dailyTasks")) if (text(task, "completedAt").compareTo(first) >= 0) completed++;
        for (JSONObject task : records("clientTasks")) {
            if (text(task, "completedAt").compareTo(first) >= 0) completed++;
            JSONArray entries = WorkspaceModel.array(task, "timeEntries");
            for (int i = 0; i < entries.length(); i++) { JSONObject entry = entries.optJSONObject(i); if (entry != null && text(entry, "start").compareTo(first) >= 0) hours += Math.max(0, entry.optLong("durationMs")) / 3600000.0; }
        }
        LinearLayout card = card(body); addText(card, "This week", 20, true); addText(card, first + " – " + WorkspaceModel.today(), 14, false);
        addText(card, applications + " applications\n" + completed + " tasks completed\n" + String.format(Locale.US, "%.1f hours logged", hours), 22, true);
        final String report = "Jeff VA · Weekly report\n" + first + " – " + WorkspaceModel.today() + "\nApplications: " + applications + "\nTasks completed: " + completed + "\nHours logged: " + String.format(Locale.US, "%.1f", hours);
        action(body, "Share weekly report", true, () -> { Intent share = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, report); startActivity(Intent.createChooser(share, "Share report")); });
    }
    private JSONObject accountUser() {
        if (!preview) return repository.accountProfile();
        try { return json("email", "jeff@example.com", "user_metadata", json("full_name", "Jeff VA", "name", "Jeff VA"), "app_metadata", json("provider", "google")); } catch (Exception ignored) { return new JSONObject(); }
    }
    private void accountSummary(LinearLayout parent, boolean navigable) {
        JSONObject user = accountUser(), meta = user.optJSONObject("user_metadata"); if (meta == null) meta = new JSONObject();
        String name = text(meta, "full_name"); if (name.isEmpty()) name = text(meta, "name"); if (name.isEmpty()) name = text(meta, "display_name"); if (name.isEmpty()) name = text(user, "email").split("@")[0]; if (name.isEmpty()) name = "Your account";
        LinearLayout panel = card(parent), content = row(); panel.addView(content);
        try {
            FrameLayout avatar = profileAvatar(json("clientName", name), 56); String photo = text(meta, "avatar_url"); if (photo.isEmpty()) photo = text(meta, "picture");
            if (!photo.isEmpty() && !preview) loadNewsImage((ImageView) avatar.getChildAt(1), photo);
            LinearLayout.LayoutParams avatarParams = new LinearLayout.LayoutParams(dp(56), dp(56)); avatarParams.rightMargin = dp(12); content.addView(avatar, avatarParams);
        } catch (Exception ignored) { content.addView(iconTile("Account", 40)); }
        LinearLayout copy = column(); addText(copy, name, 18, true); addText(copy, text(user, "email"), 12, false); content.addView(copy, new LinearLayout.LayoutParams(0, -2, 1));
        if (navigable) { content.addView(icon(R.drawable.ic_ui_chevron_right, 16)); clickable(panel, () -> navigate("Account")); }
    }
    private void account() {
        accountSummary(body, false); JSONObject user = accountUser(), metadata = user.optJSONObject("app_metadata");
        LinearLayout details = card(body); addText(details, "Account details", 18, true); addText(details, "Email", 12, true); addText(details, text(user, "email"), 14, false);
        addText(details, "Sign-in provider", 12, true); addText(details, metadata == null ? "Supabase Auth" : text(metadata, "provider"), 14, false);
        if (!text(user, "created_at").isEmpty()) { addText(details, "Member since", 12, true); addText(details, text(user, "created_at").split("T")[0], 14, false); }
        heading("Connections"); navigationRow(body, "Email inbox", "Reconnect Google / Gmail", () -> { if (mayEdit()) async(repository::startGoogleLogin, this::openExternal); });
        navigationRow(body, "Settings", "Appearance and mobile notifications", () -> navigate("Settings"));
        LinearLayout connection = card(body); addText(connection, offline ? "Offline snapshot" : "Connected to your workspace", 15, true); addText(connection, "Your account uses the same saved data as the website.", 13, false);
        action(body, "Send password reset email", false, () -> track(dialogBuilder().setTitle("Reset your password?").setMessage("Send a password reset link to " + text(user, "email") + "?").setNegativeButton("Cancel", null).setPositiveButton("Send link", (d, w) -> { if (mayEdit()) async(() -> { repository.recover(text(user, "email")); return true; }, result -> toast("Check your email for the reset link.")); }).create()));
        addText(body, "Jeff VA " + BuildConfig.VERSION_NAME + " · Android", 12, false);
    }
    private void salaryCalculator() {
        addText(body, "Estimate your monthly pay from the same 52-week calculation used on the website.", 13, false);
        LinearLayout panel = card(body); Spinner type = select(panel, "Pay type", "Hourly", new String[]{"Hourly", "Monthly"}); Spinner currency = select(panel, "Currency", "USD", new String[]{"USD", "PHP", "AUD", "CAD", "EUR", "GBP"});
        EditText rate = input(panel, "Rate / monthly salary", "10", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL), hours = input(panel, "Hours per week", "40", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        LinearLayout result = card(body); TextView total = label("", 25, true), hourly = label("", 14, false); result.addView(total); result.addView(hourly);
        Runnable calculate = () -> { try { BigDecimal amount = new BigDecimal(rate.getText().toString()), week = new BigDecimal(hours.getText().toString()); BigDecimal monthly = WorkspaceModel.monthlySalary(amount, week, type.getSelectedItem().toString().equals("Monthly")); total.setText(currency.getSelectedItem() + " " + monthly.toPlainString() + " / month"); hourly.setText("Hourly equivalent: " + monthly.multiply(new BigDecimal("12")).divide(week.multiply(new BigDecimal("52")), 2, java.math.RoundingMode.HALF_UP).toPlainString()); } catch (Exception error) { total.setText("Enter a valid rate and work week"); hourly.setText("Hours must be greater than 0 and at most 168 per week."); } };
        TextWatcher watcher = new TextWatcher() { public void beforeTextChanged(CharSequence s, int st, int c, int a) {} public void onTextChanged(CharSequence s, int st, int b, int c) { calculate.run(); } public void afterTextChanged(Editable e) {} }; rate.addTextChangedListener(watcher); hours.addTextChangedListener(watcher);
        AdapterView.OnItemSelectedListener selection = new AdapterView.OnItemSelectedListener() { public void onItemSelected(AdapterView<?> p, View v, int position, long id) { calculate.run(); } public void onNothingSelected(AdapterView<?> p) {} }; type.setOnItemSelectedListener(selection); currency.setOnItemSelectedListener(selection); calculate.run();
        addText(body, "Estimate before fees and taxes. Currency conversion is not applied.", 12, false);
    }
    private void coverLetter() {
        addText(body, "Write a letter draft, then copy or share it. Drafts stay on this device until sign-out.", 13, false);
        JSONObject draft; try { draft = preview ? new JSONObject() : repository.coverLetterDraft(); } catch (Exception ignored) { draft = new JSONObject(); }
        LinearLayout form = card(body); EditText recipient = input(form, "Hiring manager", text(draft, "recipient"), InputType.TYPE_CLASS_TEXT), company = input(form, "Company", text(draft, "company"), InputType.TYPE_CLASS_TEXT), role = input(form, "Position", text(draft, "role"), InputType.TYPE_CLASS_TEXT), copy = input(form, "Letter body", text(draft, "body"), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE); copy.setMinLines(7); copy.setGravity(Gravity.TOP);
        action(body, "Save local draft", true, () -> {
            if (preview) { toast("Preview draft"); return; } if (busy) { toast("Please wait."); return; }
            try { final JSONObject changed = json("recipient", recipient.getText().toString(), "company", company.getText().toString(), "role", role.getText().toString(), "body", copy.getText().toString()); busy = true;
                async(() -> { repository.saveCoverLetterDraft(changed); return true; }, saved -> { busy = false; toast("Draft saved on this device"); });
            } catch (Exception error) { busy = false; problem(error.getMessage()); }
        });
        action(body, "Share letter text", false, () -> { String letter = "Dear " + recipient.getText() + ",\n\n" + copy.getText() + "\n\n" + company.getText() + " · " + role.getText(); startActivity(Intent.createChooser(new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, letter), "Share cover letter")); });
    }
    private void settings() {
        accountSummary(body, true);
        LinearLayout appearance = card(body); addText(appearance, "Appearance", 18, true);
        Switch control = new Switch(this); control.setText("Dark mode"); control.setTextColor(foreground); control.setTextSize(16); control.setChecked(dark); control.setMinHeight(dp(48)); appearance.addView(control);
        control.setOnCheckedChangeListener((view, checked) -> { dark = checked; preferences.edit().putBoolean("dark", dark).apply(); showWorkspace(); });
        LinearLayout sync = card(body); addText(sync, "Live workspace updates", 18, true); addText(sync, "Saved workspace changes sync automatically while this app is open. Reconnecting and a periodic check recover missed updates.", 13, false);
        addText(sync, "Background push: setup required", 13, true); addText(sync, "Notifications while the app is closed are not connected yet. The daily reminders below use your last synced data. New Gmail delivery also needs a server connection.", 12, false);
        LinearLayout notifications = card(body); addText(notifications, "Notifications", 18, true);
        addText(notifications, "Daily reminders around 9 AM, based on your last synced tasks and renewals. Android may delay delivery to save battery.", 13, false);
        Switch enabled = new Switch(this); enabled.setText("Mobile reminders"); enabled.setTextColor(foreground); enabled.setMinHeight(dp(48)); enabled.setChecked(preferences.getBoolean("notifications", false)); notifications.addView(enabled);
        enabled.setOnCheckedChangeListener((view, checked) -> {
            if (preview) { toast("Notifications are unavailable in preview."); return; }
            preferences.edit().putBoolean("notifications", checked).apply();
            if (checked && Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 710); return;
            }
            queueReminderUpdate(); showWorkspace();
        });
        notificationOption(notifications, "Tasks due and overdue", "notifyTasks");
        notificationOption(notifications, "Renewals in the next 7 days", "notifyRenewals");
        addText(notifications, ReminderNotifications.allowed(this) ? "Android notifications are allowed" : "Notifications are blocked in Android settings", 12, true);
        action(notifications, "Open phone notification settings", false, () -> {
            Intent intent = Build.VERSION.SDK_INT >= 26 ? new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, getPackageName())
                : new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()));
            startActivity(intent);
        });
        action(notifications, "Send a test notification", false, () -> {
            if (preview || !preferences.getBoolean("notifications", false) || !ReminderNotifications.allowed(this)) { toast("Enable mobile reminders and allow notifications first."); return; }
            async(() -> { ReminderNotifications.notifyNow(getApplicationContext(), true); return true; }, sent -> toast("Test notification sent"));
        });
        navigationRow(body, "Account", "Profile, sign-in and connections", () -> navigate("Account"));
        addText(body, "Jeff VA " + BuildConfig.VERSION_NAME + " · Android", 12, false);
        action(body, "Sign out", false, () -> track(dialogBuilder().setTitle("Sign out of Jeff VA?").setMessage("Your online data stays in your account. This removes this device's saved session.")
            .setNegativeButton("Cancel", null).setPositiveButton("Sign out", (d, which) -> {
                if (busy || liveLoading) { toast("Wait for the current operation to finish."); return; }
                busy = true; stopLiveUpdates();
                async(() -> { ReminderNotifications.clear(getApplicationContext()); repository.logout(); File directory = new File(getCacheDir(), "documents"); File[] files = directory.listFiles(); if (files != null) for (File file : files) if (file.isFile()) file.delete(); return true; }, signedOut -> { busy = false; resetAccountViews(); data = new JSONObject(); preview = false; closeDialogs(); showLogin(""); });
            }).create()));
    }
    private void notificationOption(LinearLayout parent, String title, String key) {
        Switch option = new Switch(this); option.setText(title); option.setTextColor(foreground); option.setTextSize(13); option.setMinHeight(dp(48)); option.setChecked(preferences.getBoolean(key, true)); parent.addView(option);
        option.setOnCheckedChangeListener((view, checked) -> preferences.edit().putBoolean(key, checked).apply());
    }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request == 710) { boolean granted = results.length > 0 && results[0] == android.content.pm.PackageManager.PERMISSION_GRANTED;
            preferences.edit().putBoolean("notifications", granted).apply(); queueReminderUpdate(); showWorkspace();
            if (!granted) toast("You can allow reminders later in phone settings.");
        }
    }
    private String pendingUploadClient = "";
    private void documents() {
        if (records("personalDocuments").isEmpty()) action(body, "Upload personal document", true, () -> pickDocument(""));
        choiceRow(body, "Sort documents", listOrder, new String[]{"Newest", "Oldest", "Name"}, selected -> { listOrder = selected; showWorkspace(); });
        searchable("Find a document", (target, term) -> {
            int shown = 0;
            for (JSONObject doc : orderedRecords("personalDocuments", "addedAt")) if (text(doc, "name").toLowerCase(Locale.ROOT).contains(term)) { recordCard(target, doc, text(doc, "addedAt").split("T")[0], () -> openDocument(doc)); shown++; }
            if (shown == 0) addText(card(target), "No matching personal documents.", 15, false);
        });
        heading("Client documents");
        for (JSONObject client : records("applications")) {
            JSONArray documents = WorkspaceModel.array(client, "documents");
            for (int i = 0; i < documents.length(); i++) { JSONObject doc = documents.optJSONObject(i); if (doc != null) recordCard(body, doc, text(client, "clientName"), () -> openDocument(doc)); }
        }
    }
    private void pickDocument(String clientId) {
        if (!mayEdit()) return; pendingUploadClient = clientId;
        Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE)
            .putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
        try { startActivityForResult(picker, 41); } catch (Exception error) { problem("No document picker is installed on this device."); }
    }
    @Override protected void onActivityResult(int request, int result, Intent intent) {
        super.onActivityResult(request, result, intent);
        if (request != 41 || result != RESULT_OK || intent == null || intent.getData() == null) return;
        if (!mayEdit()) return;
        Uri uri = intent.getData(); String clientId = pendingUploadClient; pendingUploadClient = ""; busy = true; toast("Uploading document…");
        async(() -> {
            String name = "document";
            try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) { if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0); }
            String lower = name.toLowerCase(Locale.ROOT), mime;
            if (lower.endsWith(".pdf")) mime = "application/pdf";
            else if (lower.endsWith(".docx")) mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            else if (lower.endsWith(".doc")) mime = "application/msword";
            else throw new Exception("Choose a PDF or Word document.");
            try (InputStream in = getContentResolver().openInputStream(uri); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                if (in == null) throw new Exception("Could not read the selected document.");
                byte[] buffer = new byte[8192]; int length;
                while ((length = in.read(buffer)) != -1) { if (output.size() + length > 25 * 1024 * 1024) throw new Exception("Documents must be 25 MB or smaller."); output.write(buffer, 0, length); }
                return repository.addDocument(clientId, name, mime, output.toByteArray());
            }
        }, state -> { busy = false; data = state; closeDialogs(); showWorkspace(); toast("Document uploaded"); });
    }
    private void openDocument(JSONObject document) {
        if (preview) { toast("This preview document has no uploaded file."); return; }
        if (busy) return; busy = true; toast("Opening document…");
        async(() -> {
            byte[] contents = repository.document(document);
            String name = text(document, "name").replaceAll("[^a-zA-Z0-9._-]", "_"); if (name.isEmpty()) name = "document";
            File directory = new File(getCacheDir(), "documents"); if (!directory.isDirectory() && !directory.mkdirs()) throw new Exception("Could not create the document cache.");
            File file = new File(directory, UUID.randomUUID() + "_" + name);
            try (FileOutputStream out = new FileOutputStream(file)) { out.write(contents); }
            return file;
        }, file -> {
            busy = false;
            if (file.getName().toLowerCase(Locale.ROOT).endsWith(".pdf") || text(document, "type").equals("application/pdf")) showPdf(file, text(document, "name"));
            else {
                Uri uri = new Uri.Builder().scheme("content").authority(getPackageName() + ".documents").appendPath(file.getName()).build();
                Intent viewer = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, text(document, "type").isEmpty() ? "application/msword" : text(document, "type"))
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                viewer.setClipData(ClipData.newRawUri("Document", uri));
                try { startActivity(Intent.createChooser(viewer, "Open document")); } catch (Exception error) { problem("Install a Word document viewer to open this file."); }
            }
        });
    }
    private void showPdf(File file, String title) throws Exception {
        ParcelFileDescriptor descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
        PdfRenderer renderer;
        try { renderer = new PdfRenderer(descriptor); } catch (Exception error) { descriptor.close(); throw error; }
        LinearLayout content = column(); content.setPadding(dp(12), dp(12), dp(12), dp(12));
        TextView count = label("", 14, true); content.addView(count);
        ImageView image = new ImageView(this); image.setAdjustViewBounds(true);
        ScrollView scroller = new ScrollView(this); scroller.addView(image); content.addView(scroller, new LinearLayout.LayoutParams(-1, dp(360)));
        LinearLayout controls = row(); content.addView(controls); final int[] current = {0}; final Bitmap[] bitmap = {null};
        Runnable render = () -> {
            try (PdfRenderer.Page page = renderer.openPage(current[0])) {
                int width = Math.min(1600, Math.max(600, getResources().getDisplayMetrics().widthPixels));
                int height = Math.max(1, Math.min(4000, Math.round(width * (page.getHeight() / (float) page.getWidth()))));
                Bitmap next = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888); next.eraseColor(Color.WHITE); page.render(next, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                image.setImageBitmap(next); if (bitmap[0] != null) bitmap[0].recycle(); bitmap[0] = next;
                count.setText("Page " + (current[0] + 1) + " of " + renderer.getPageCount());
            } catch (Exception error) { problem("Could not render this PDF page."); }
        };
        controls.addView(button("Previous", false, () -> { if (current[0] > 0) { current[0]--; render.run(); } }), new LinearLayout.LayoutParams(0, -2, 1));
        controls.addView(button("Next", false, () -> { if (current[0] + 1 < renderer.getPageCount()) { current[0]++; render.run(); } }), new LinearLayout.LayoutParams(0, -2, 1));
        AlertDialog dialog = dialogBuilder().setTitle(title).setView(content).setNegativeButton("Close", null).create(); track(dialog);
        dialog.setOnDismissListener(d -> { dialogs.remove(dialog); renderer.close(); try { descriptor.close(); } catch (Exception ignored) { } if (bitmap[0] != null) bitmap[0].recycle(); }); render.run();
    }
    private void inbox() {
        segments(body, new String[]{"Inbox", "Sent", "Starred", "Archived"}, mailFolder, choice -> { mailFolder = choice; mailVisibleLimit = 30; showWorkspace(); });
        TextView delivery = label("Check last email delivery →", 12, true); delivery.setTextColor(accent); delivery.setMinHeight(dp(48)); clickable(delivery, () -> {
            if (!mayEdit()) return; busy = true;
            async(repository::recoverPendingEmail, state -> { busy = false; data = state; showWorkspace(); toast("Delivery check finished"); }, error -> {
                busy = false; track(dialogBuilder().setTitle("Email delivery").setMessage(error.getMessage())
                    .setNegativeButton("Keep checking", null).setPositiveButton("I checked Sent mail", (d, w) -> track(dialogBuilder().setTitle("Clear the pending send?")
                        .setMessage("Only clear this after checking Gmail Sent mail. Clearing does not cancel or recall a delivered email.").setNegativeButton("Cancel", null)
                        .setPositiveButton("Clear pending status", (d2, w2) -> async(() -> { repository.clearPendingEmail(); return true; }, cleared -> toast("Pending status cleared"))).create())).create());
            });
        });
        searchable("Sender, recipient or subject", (target, term) -> {
            LinearLayout heading = row(); TextView section = label(mailFolder, 14, true), count = label("", 12, false); count.setTextColor(dark ? 0xFFCBD0DA : 0xFF667085); heading.addView(section, new LinearLayout.LayoutParams(0, -2, 1)); heading.addView(count); heading.setPadding(0, dp(4), 0, dp(12)); target.addView(heading);
            List<JSONObject> emails = records("emails"); emails.sort((a, b) -> text(b, "date").compareTo(text(a, "date")));
            Set<String> deleted = new HashSet<>(); JSONArray ids = WorkspaceModel.array(data, "deletedGmailIds"); for (int i = 0; i < ids.length(); i++) deleted.add(ids.optString(i));
            int shown = 0;
            for (JSONObject email : emails) {
                if (deleted.contains(text(email, "gmailId")) || !joined(email, "from", "to", "subject").toLowerCase(Locale.ROOT).contains(term)) continue;
                boolean sent = "sent".equals(text(email, "direction")), archived = email.optBoolean("mobileArchived");
                if (mailFolder.equals("Inbox") && (sent || archived) || mailFolder.equals("Sent") && (!sent || archived)
                    || mailFolder.equals("Starred") && !email.optBoolean("mobileStarred") || mailFolder.equals("Archived") && !archived) continue;
                if (shown >= mailVisibleLimit) { action(target, "Show more messages", false, this::showMoreEmails); break; }
                emailListRow(target, email, sent); shown++;
            }
            count.setText(shown + (shown == 1 ? " message" : " messages"));
            if (shown == 0) { LinearLayout empty = card(target); addText(empty, term.isEmpty() ? "No messages here" : "No matching emails", 16, true); addText(empty, term.isEmpty() ? "Pull down to sync Gmail or choose another folder." : "Try another sender, recipient or subject.", 13, false); }
        });
        body.addView(delivery); addText(body, "Stars, read status and archives organize your Jeff VA workspace.", 11, false);
    }
    private String emailDisplayName(String address) {
        String name = address.replaceFirst("\\s*<[^>]*>.*$", "").replace("\"", "").trim();
        if (name.isEmpty()) name = address.replace("<", "").replace(">", "").trim();
        return name.isEmpty() ? "Unknown sender" : name;
    }
    private void showMoreEmails() {
        int y = pullRefresh != null && pullRefresh.getChildCount() > 0 && pullRefresh.getChildAt(0) instanceof ScrollView ? ((ScrollView) pullRefresh.getChildAt(0)).getScrollY() : 0;
        mailVisibleLimit += 30; showWorkspace();
        if (pullRefresh != null && pullRefresh.getChildCount() > 0 && pullRefresh.getChildAt(0) instanceof ScrollView) { ScrollView restored = (ScrollView) pullRefresh.getChildAt(0); restored.post(() -> restored.scrollTo(0, y)); }
    }
    private String emailListDate(String value) {
        if (value.length() < 10) return value;
        try {
            // List dates are deliberately compact; the detail sheet keeps the full timestamp.
            java.text.SimpleDateFormat source = new java.text.SimpleDateFormat("yyyy-MM-dd", Locale.US); source.setLenient(false);
            Date date = source.parse(value.substring(0, 10)); Calendar year = Calendar.getInstance(); year.setTime(date);
            return new java.text.SimpleDateFormat(year.get(Calendar.YEAR) == Calendar.getInstance().get(Calendar.YEAR) ? "MMM d" : "MMM d, yy", Locale.getDefault()).format(date);
        } catch (Exception ignored) { return ""; }
    }
    private void emailListRow(LinearLayout parent, JSONObject email, boolean sent) {
        boolean unread = !sent && !email.optBoolean("mobileRead"); String name = emailDisplayName(text(email, sent ? "to" : "from")), subject = text(email, "subject"); if (subject.isEmpty()) subject = "(No subject)";
        LinearLayout panel = row(); panel.setMinimumHeight(dp(104)); panel.setPadding(dp(10), dp(10), dp(2), dp(10)); panel.setBackgroundColor(unread ? (dark ? 0xFF22283B : 0xFFF6F5FF) : surface);
        String[] words = name.split("\\s+"); String initials = name.substring(0, 1); if (words.length > 1 && !words[words.length - 1].isEmpty()) initials += words[words.length - 1].substring(0, 1);
        int[] tones = dark ? new int[]{0xFF313B60, 0xFF244741, 0xFF4C3547, 0xFF4A4029} : new int[]{0xFFE7E4FF, 0xFFDDF3ED, 0xFFF8E3ED, 0xFFFFEFCF};
        TextView avatar = label(initials.toUpperCase(Locale.ROOT), 16, true); avatar.setTextColor(dark ? Color.WHITE : 0xFF403C69); avatar.setGravity(Gravity.CENTER); avatar.setBackground(shape(tones[Math.floorMod(name.hashCode(), tones.length)], 22, false)); avatar.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO); panel.addView(avatar, new LinearLayout.LayoutParams(dp(44), dp(44)));
        LinearLayout copy = column(); LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(0, -2, 1); cp.leftMargin = dp(12); cp.rightMargin = dp(4); panel.addView(copy, cp);
        TextView sender = label(name, 14, unread); sender.setSingleLine(true); sender.setEllipsize(android.text.TextUtils.TruncateAt.END); copy.addView(sender);
        LinearLayout subjectRow = row(); TextView title = label(subject, 14, unread); title.setSingleLine(true); title.setEllipsize(android.text.TextUtils.TruncateAt.END); subjectRow.addView(title, new LinearLayout.LayoutParams(0, -2, 1));
        if (email.optBoolean("mobileStarred")) { ImageView star = icon(R.drawable.ic_ui_star, 14); star.setImageTintList(ColorStateList.valueOf(dark ? 0xFFFFD773 : 0xFF976900)); star.setContentDescription("Starred"); star.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES); subjectRow.addView(star); } copy.addView(subjectRow);
        String snippet = text(email, "snippet"); if (snippet.isEmpty()) snippet = text(email, "body");
        TextView preview = label(Html.fromHtml(snippet, Html.FROM_HTML_MODE_LEGACY).toString().replaceAll("\\s+", " ").trim(), 13, false); preview.setSingleLine(true); preview.setEllipsize(android.text.TextUtils.TruncateAt.END); preview.setTextColor(dark ? 0xFFCBD0DA : 0xFF667085); copy.addView(preview);
        LinearLayout trailing = column(); trailing.setGravity(Gravity.CENTER_HORIZONTAL); TextView date = label(emailListDate(text(email, "date")), 11, unread); date.setTextColor(unread ? accent : (dark ? 0xFFCBD0DA : 0xFF667085)); date.setSingleLine(true); trailing.addView(date);
        ImageButton menu = new ImageButton(this); menu.setImageResource(R.drawable.ic_ui_more); menu.setImageTintList(ColorStateList.valueOf(dark ? Color.WHITE : 0xFF667085)); menu.setPadding(dp(14), dp(14), dp(14), dp(14)); menu.setBackground(new RippleDrawable(ColorStateList.valueOf(0x224F46E5), shape(Color.TRANSPARENT, 24, false), null)); menu.setContentDescription("Actions for " + subject); menu.setOnClickListener(v -> emailActions(email)); trailing.addView(menu, new LinearLayout.LayoutParams(dp(48), dp(48))); panel.addView(trailing, new LinearLayout.LayoutParams(dp(60), -2));
        clickable(panel, () -> emailDetails(email)); parent.addView(panel, new LinearLayout.LayoutParams(-1, -2)); View divider = new View(this); divider.setBackgroundColor(line); parent.addView(divider, new LinearLayout.LayoutParams(-1, dp(1)));
    }
    private void emailDetails(JSONObject email) {
        LinearLayout content = detailsContent(email, "from", "to", "date");
        String body = text(email, "body"); if (body.isEmpty()) body = text(email, "snippet");
        TextView text = label(body.contains("<") ? Html.fromHtml(body, Html.FROM_HTML_MODE_LEGACY).toString() : body, 15, false); text.setTextIsSelectable(true); content.addView(text);
        action(content, "Reply", true, () -> {
            String sender = text(email, "from"); java.util.regex.Matcher match = java.util.regex.Pattern.compile("<([^>]+)>").matcher(sender); if (match.find()) sender = match.group(1);
            compose(sender, "Re: " + text(email, "subject").replaceFirst("(?i)^re:\\s*", ""));
        });
        action(content, "Forward", false, () -> compose("", "Fwd: " + text(email, "subject"), "\n\n---------- Forwarded message ----------\nFrom: " + text(email, "from") + "\n" + text(email, "body")));
        action(content, "More email actions", false, () -> emailActions(email));
        detailDialog(text(email, "subject"), content, null);
    }
    private void emailActions(JSONObject email) {
        String[] options = {"Reply", "Forward", email.optBoolean("mobileStarred") ? "Remove star" : "Star message", email.optBoolean("mobileRead") ? "Mark unread" : "Mark read", email.optBoolean("mobileArchived") ? "Move to inbox" : "Archive in app", "Copy sender address"};
        track(dialogBuilder().setTitle("Email actions").setItems(options, (dialog, which) -> {
            String sender = text(email, "from"); java.util.regex.Matcher match = java.util.regex.Pattern.compile("<([^>]+)>").matcher(sender); if (match.find()) sender = match.group(1);
            if (which == 0) compose(sender, "Re: " + text(email, "subject").replaceFirst("(?i)^re:\\s*", ""));
            else if (which == 1) compose("", "Fwd: " + text(email, "subject"), "\n\n---------- Forwarded message ----------\nFrom: " + text(email, "from") + "\n" + text(email, "body"));
            else if (which == 5) { ((ClipboardManager) getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("Email address", sender)); toast("Address copied"); }
            else try { String key = which == 2 ? "mobileStarred" : which == 3 ? "mobileRead" : "mobileArchived"; save("emails", email, json(key, !email.optBoolean(key)), this::closeDialogs); } catch (Exception error) { problem(error.getMessage()); }
        }).setNegativeButton("Cancel", null).create());
    }
    private void compose(String recipient, String subject) {
        compose(recipient, subject, "");
    }
    private void compose(String recipient, String subject, String initialBody) {
        if (!mayEdit()) return;
        LinearLayout content = column(); content.setPadding(0, dp(4), 0, dp(8));
        EditText to = input(content, "To", recipient, InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        EditText title = input(content, "Subject", subject, InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        EditText message = input(content, "Message", initialBody, InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE); message.setMinLines(5); message.setGravity(Gravity.TOP);
        ScrollView scroll = new ScrollView(this); scroll.addView(content);
        AlertDialog dialog = dialogBuilder().setTitle("Compose email").setView(scroll).setNegativeButton("Cancel", null).setPositiveButton("Send", null).create(); track(dialog);
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String address = to.getText().toString().trim(), topic = title.getText().toString().trim(), copy = message.getText().toString();
            if (!android.util.Patterns.EMAIL_ADDRESS.matcher(address).matches() || address.contains("\r") || address.contains("\n")) { to.setError("Enter a valid email address"); return; }
            if (topic.isEmpty()) { title.setError("Enter a subject"); return; }
            if (copy.trim().isEmpty()) { message.setError("Enter your message"); return; }
            if (busy) return;
            track(dialogBuilder().setTitle("Send this email?").setMessage("To: " + address + "\nSubject: " + topic).setNegativeButton("Review", null).setPositiveButton("Send email", (d, which) -> {
                if (!mayEdit()) return; busy = true; dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
                async(() -> repository.sendEmail(address, topic, copy), state -> { busy = false; data = state; dialog.dismiss(); showWorkspace(); toast("Email sent"); }, error -> { busy = false; dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true); problem(error.getMessage()); });
            }).create());
        });
    }
    private void news() {
        segments(body, new String[]{"all", "ai-tools", "automation", "virtual-assistants", "web"}, newsCategory, category -> { newsCategory = category; newsLoaded = false; news = new JSONArray(); showWorkspace(); });
        if (!newsLoaded && !busy && !preview) {
            busy = true; addText(body, "Loading industry news…", 15, false);
            final String category = newsCategory;
            async(() -> repository.api("GET", "/api/news?category=" + category + "&pageSize=10", null), result -> {
                if (!category.equals(newsCategory)) { busy = false; if (page.equals("Industry news")) showWorkspace(); return; }
                busy = false; newsLoaded = true; newsError = result.optString("error"); news = result.optJSONArray("articles"); if (news == null) news = new JSONArray(); if (page.equals("Industry news")) showWorkspace();
            }, error -> { busy = false; if (category.equals(newsCategory)) { newsLoaded = true; newsError = error.getMessage(); } if (page.equals("Industry news")) showWorkspace(); }); return;
        }
        if (!newsError.isEmpty()) addText(card(body), newsError, 14, false);
        for (int i = 0; i < news.length(); i++) { JSONObject article = news.optJSONObject(i); if (article == null) continue;
            LinearLayout card = card(body);
            android.widget.FrameLayout media = new android.widget.FrameLayout(this); media.setBackground(shape(dark ? 0xFF28304A : 0xFFEBEEFF, 12, false)); media.setClipToOutline(true);
            TextView fallback = label("NEWS  /  " + text(article, "source"), 14, true); fallback.setGravity(Gravity.CENTER); fallback.setTextColor(accent); media.addView(fallback, new android.widget.FrameLayout.LayoutParams(-1, -1));
            ImageView image = new ImageView(this); image.setScaleType(ImageView.ScaleType.CENTER_CROP); image.setContentDescription("Article image"); media.addView(image, new android.widget.FrameLayout.LayoutParams(-1, -1));
            LinearLayout.LayoutParams mediaParams = new LinearLayout.LayoutParams(-1, dp(164)); mediaParams.bottomMargin = dp(12); card.addView(media, mediaParams);
            loadNewsImage(image, text(article, "image"));
            String date = text(article, "publishedAt"); try { Date published = new java.text.SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(date); date = new java.text.SimpleDateFormat("MMM d, yyyy", Locale.getDefault()).format(published); } catch (Exception ignored) { date = ""; }
            TextView source = label(text(article, "source") + (date.isEmpty() ? "" : " · " + date), 11, true); source.setTextColor(accent); card.addView(source);
            addText(card, text(article, "title"), 18, true); TextView description = label(text(article, "description"), 13, false); description.setMaxLines(3); description.setEllipsize(android.text.TextUtils.TruncateAt.END); card.addView(description);
            action(card, "Read article ↗", false, () -> openExternal(text(article, "url")));
        }
        if (newsLoaded && news.length() == 0 && newsError.isEmpty()) empty("No articles available", "Use refresh to check again.");
    }
    private void loadNewsImage(ImageView view, String url) {
        view.setTag(url); if (!url.startsWith("https://")) return;
        Bitmap cached = imageCache.get(url); if (cached != null) { view.setImageBitmap(cached); return; }
        images.execute(() -> {
            try {
                try (okhttp3.Response response = imageClient.newCall(new okhttp3.Request.Builder().url(url).build()).execute()) {
                    if (!response.isSuccessful() || response.body() == null || response.body().contentLength() > 5 * 1024 * 1024) return;
                    InputStream stream = response.body().byteStream(); ByteArrayOutputStream bytes = new ByteArrayOutputStream(); byte[] chunk = new byte[8192]; int count;
                    while ((count = stream.read(chunk)) != -1) { if (bytes.size() + count > 5 * 1024 * 1024) return; bytes.write(chunk, 0, count); }
                    byte[] encoded = bytes.toByteArray(); android.graphics.BitmapFactory.Options options = new android.graphics.BitmapFactory.Options(); options.inJustDecodeBounds = true;
                    android.graphics.BitmapFactory.decodeByteArray(encoded, 0, encoded.length, options);
                    options.inSampleSize = 1; while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > 1200) options.inSampleSize *= 2;
                    options.inJustDecodeBounds = false; Bitmap bitmap = android.graphics.BitmapFactory.decodeByteArray(encoded, 0, encoded.length, options);
                    if (bitmap == null) return; imageCache.put(url, bitmap);
                    runOnUiThread(() -> { if (!isDestroyed() && url.equals(view.getTag())) view.setImageBitmap(bitmap); });
                }
            } catch (Exception ignored) { /* Keep the source placeholder when a publisher blocks images. */ }
        });
    }
    private void assistant() {
        if (!usageLabel.isEmpty()) addText(body, usageLabel, 13, true);
        Spinner mode = select(body, "Assistant mode", assistantMode, new String[]{"research", "reasoning"});
        mode.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            public void onNothingSelected(AdapterView<?> parent) { }
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) { assistantMode = String.valueOf(parent.getItemAtPosition(position)); }
        });
        if (chat.length() == 0) empty("What can I help with?", "Research a topic or work through a question. Research uses live web sources when available.");
        for (int i = 0; i < chat.length(); i++) {
            JSONObject entry = chat.optJSONObject(i); if (entry == null) continue; LinearLayout card = card(body);
            addText(card, "user".equals(text(entry, "role")) ? "You" : "Assistant", 12, true); TextView text = label(text(entry, "content"), 15, false); text.setTextIsSelectable(true); card.addView(text);
            JSONArray sources = WorkspaceModel.array(entry, "sources");
            for (int j = 0; j < sources.length(); j++) { JSONObject source = sources.optJSONObject(j); if (source != null) action(card, source.optString("title", "Source " + (j + 1)), false, () -> openExternal(text(source, "url"))); }
        }
        if (busy) { addText(body, "Preparing your answer…", 15, false); return; }
        EditText question = input(body, "Your question", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE); question.setMinLines(3); question.setGravity(Gravity.TOP);
        action(body, "Send question", true, () -> {
            if (!mayEdit()) return; String prompt = question.getText().toString().trim();
            if (prompt.isEmpty() || prompt.length() > 4000) { question.setError("Enter a question up to 4,000 characters"); return; }
            try {
                JSONArray history = new JSONArray(); int total = prompt.length();
                List<JSONObject> messages = new ArrayList<>();
                for (int i = chat.length() - 1; i >= 0 && messages.size() < 10; i--) {
                    JSONObject entry = chat.getJSONObject(i); String value = text(entry, "content"); if (value.length() > 4000) value = value.substring(0, 4000);
                    if (total + value.length() > 19000) break; total += value.length(); messages.add(0, json("role", text(entry, "role"), "content", value));
                }
                for (JSONObject entry : messages) history.put(entry); history.put(json("role", "user", "content", prompt));
                JSONObject payload = json("mode", assistantMode, "effort", "medium", "messages", history);
                chat.put(json("role", "user", "content", prompt)); busy = true; hideKeyboard(); showWorkspace();
                async(() -> { repository.api("GET", "/api/research/usage", null); return repository.api("POST", "/api/research", payload); }, result -> {
                    busy = false; chat.put(json("role", "assistant", "content", result.getString("answer"), "sources", result.optJSONArray("sources") == null ? new JSONArray() : result.optJSONArray("sources")));
                    JSONObject usage = result.optJSONObject("usage"); if (usage != null) usageLabel = usage.optInt("used") + " / " + usage.optInt("limit") + " daily requests";
                    if (page.equals("Assistant")) showWorkspace();
                }, error -> { busy = false; if (chat.length() > 0 && "user".equals(text(chat.optJSONObject(chat.length() - 1), "role"))) chat.remove(chat.length() - 1); if (page.equals("Assistant")) showWorkspace(); problem(error.getMessage()); });
            } catch (Exception error) { busy = false; problem(error.getMessage()); }
        });
        action(body, "Clear conversation", false, () -> { if (!busy) { chat = new JSONArray(); showWorkspace(); } });
    }
    private void navigateBack() {
        if (preview || repository.signedIn()) { if (!page.equals("Dashboard")) navigate("Dashboard"); else moveTaskToBack(true); }
        else finish();
    }
    @Override public void onBackPressed() { navigateBack(); }
}
