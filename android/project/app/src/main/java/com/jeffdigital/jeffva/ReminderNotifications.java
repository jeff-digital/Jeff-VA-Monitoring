package com.jeffdigital.jeffva;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.Build;
import org.json.JSONObject;
import java.util.Calendar;

/** Opt-in daily summaries from the last synced snapshot; no background network access. */
public final class ReminderNotifications extends BroadcastReceiver {
    private static final String CHANNEL = "workspace_reminders";
    static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Tasks and renewals", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("Daily reminders from your last synced Jeff VA workspace");
            context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }
    static boolean allowed(Context context) {
        return (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
            && context.getSystemService(NotificationManager.class).areNotificationsEnabled();
    }
    static void update(Context context, JSONObject data) {
        if (context.getSharedPreferences("appearance", Context.MODE_PRIVATE).getBoolean("notifications", false))
            try {
                JSONObject snapshot = new JSONObject();
                for (String collection : new String[]{"dailyTasks", "clientTasks", "subscriptions"}) {
                    org.json.JSONArray items = new org.json.JSONArray();
                    for (JSONObject item : WorkspaceModel.records(data, collection)) {
                        JSONObject reminder = new JSONObject();
                        for (String key : new String[]{"taskDate", "dueDate", "completedAt", "status", "expiryDate"}) if (item.has(key)) reminder.put(key, item.opt(key));
                        items.put(reminder);
                    }
                    snapshot.put(collection, items);
                }
                new SessionVault(context).put("reminderSnapshot", snapshot.toString());
            } catch (Exception ignored) { }
        schedule(context);
    }
    private static PendingIntent alarm(Context context) {
        return PendingIntent.getBroadcast(context, 410, new Intent(context, ReminderNotifications.class).setAction("com.jeffdigital.jeffva.REMIND"), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    static void schedule(Context context) {
        SharedPreferences settings = context.getSharedPreferences("appearance", Context.MODE_PRIVATE);
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        alarms.cancel(alarm(context));
        if (!settings.getBoolean("notifications", false)) return;
        Calendar next = Calendar.getInstance(); next.set(Calendar.HOUR_OF_DAY, 9); next.set(Calendar.MINUTE, 0); next.set(Calendar.SECOND, 0);
        if (next.getTimeInMillis() <= System.currentTimeMillis()) next.add(Calendar.DAY_OF_YEAR, 1);
        alarms.setInexactRepeating(AlarmManager.RTC_WAKEUP, next.getTimeInMillis(), AlarmManager.INTERVAL_DAY, alarm(context));
    }
    static void clear(Context context) {
        context.getSystemService(AlarmManager.class).cancel(alarm(context));
        context.getSystemService(NotificationManager.class).cancel(411);
        try { new SessionVault(context).put("reminderSnapshot", ""); } catch (Exception ignored) { }
    }
    static void notifyNow(Context context, boolean test) {
        SharedPreferences settings = context.getSharedPreferences("appearance", Context.MODE_PRIVATE);
        if (!settings.getBoolean("notifications", false) || !allowed(context)) return;
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        createChannel(context);
        int tasks = 0, renewals = 0;
        try {
            JSONObject data = new JSONObject(new SessionVault(context).get("reminderSnapshot"));
            Calendar next = Calendar.getInstance(); next.add(Calendar.DAY_OF_YEAR, 7);
            String today = WorkspaceModel.today(), soon = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(next.getTime());
            int[] counts = WorkspaceModel.reminderCounts(data, today, soon, settings.getBoolean("notifyTasks", true), settings.getBoolean("notifyRenewals", true));
            tasks = counts[0]; renewals = counts[1];
        } catch (Exception ignored) { if (!test) return; }
        if (!test && tasks + renewals == 0) return;
        Intent open = new Intent(context, MainActivity.class).putExtra("notificationPage", tasks > 0 ? "Daily tasks" : "Subscriptions");
        PendingIntent pending = PendingIntent.getActivity(context, 411, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(context, CHANNEL) : new Notification.Builder(context);
        String message = test ? "Notifications are ready. Daily reminders arrive around 9 AM." : tasks + " tasks due · " + renewals + " renewals in the next 7 days";
        builder.setSmallIcon(R.drawable.ic_notification).setContentTitle(test ? "Jeff VA reminders enabled" : "Your workspace today")
            .setContentText(message).setStyle(new Notification.BigTextStyle().bigText(message)).setContentIntent(pending)
            .setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE).setColor(0xFF4F46E5);
        context.getSystemService(NotificationManager.class).notify(411, builder.build());
    }
    @Override public void onReceive(Context context, Intent intent) {
        if ("com.jeffdigital.jeffva.REMIND".equals(intent.getAction())) notifyNow(context, false);
        else schedule(context);
    }
}
