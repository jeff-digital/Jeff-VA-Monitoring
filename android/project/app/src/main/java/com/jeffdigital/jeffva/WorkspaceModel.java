package com.jeffdigital.jeffva;

import org.json.JSONArray;
import org.json.JSONObject;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Objects;

final class WorkspaceModel {
    static boolean taskComplete(JSONObject task) { return !text(task, "completedAt").isEmpty() || "done".equals(text(task, "status")); }
    static List<JSONObject> taskList(JSONObject data, String collection, boolean completed, String order, String query) {
        List<JSONObject> result = new ArrayList<>(); String term = query.toLowerCase(Locale.ROOT).trim();
        for (JSONObject task : records(data, collection)) {
            String searchable = text(task, "title") + " " + text(task, "relatedName") + " " + text(task, "notes") + " " + text(task, "taskDate") + " " + text(task, "dueDate");
            if (taskComplete(task) == completed && searchable.toLowerCase(Locale.ROOT).contains(term)) result.add(task);
        }
        result.sort((a, b) -> {
            if ("Title".equals(order)) return text(a, "title").compareToIgnoreCase(text(b, "title"));
            if ("Newest".equals(order)) {
                String left = text(a, completed ? "completedAt" : "createdAt"), right = text(b, completed ? "completedAt" : "createdAt");
                return right.compareTo(left);
            }
            String field = collection.equals("dailyTasks") ? "taskDate" : "dueDate", left = text(a, field), right = text(b, field);
            return (left.isEmpty() ? "9999-12-31" : left).compareTo(right.isEmpty() ? "9999-12-31" : right);
        });
        return result;
    }
    static BigDecimal monthlySalary(BigDecimal rate, BigDecimal hours, boolean monthly) {
        if (rate.signum() < 0 || hours.signum() <= 0 || hours.compareTo(new BigDecimal("168")) > 0) throw new IllegalArgumentException("Enter a positive work week up to 168 hours and a nonnegative rate.");
        return (monthly ? rate : rate.multiply(hours).multiply(new BigDecimal("52")).divide(new BigDecimal("12"), 8, RoundingMode.HALF_UP)).setScale(2, RoundingMode.HALF_UP);
    }
    static int[] reminderCounts(JSONObject data, String today, String soon, boolean tasksEnabled, boolean renewalsEnabled) {
        int tasks = 0, renewals = 0;
        if (tasksEnabled) for (String collection : new String[]{"dailyTasks", "clientTasks"}) for (JSONObject task : records(data, collection)) {
            String due = text(task, collection.equals("dailyTasks") ? "taskDate" : "dueDate");
            if (!due.isEmpty() && validDate(due) && due.compareTo(today) <= 0 && text(task, "completedAt").isEmpty() && !"done".equals(text(task, "status"))) tasks++;
        }
        if (renewalsEnabled) for (JSONObject sub : records(data, "subscriptions")) {
            String due = text(sub, "expiryDate"); if (!due.isEmpty() && validDate(due) && due.compareTo(today) >= 0 && due.compareTo(soon) <= 0) renewals++;
        }
        return new int[]{tasks, renewals};
    }
    static String now() {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
        return format.format(new Date());
    }
    static String today() { return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date()); }
    static String text(JSONObject item, String field) { return item == null || item.isNull(field) ? "" : item.optString(field, ""); }
    static JSONArray array(JSONObject data, String key) { JSONArray items = data.optJSONArray(key); return items == null ? new JSONArray() : items; }
    static List<JSONObject> records(JSONObject data, String key) {
        List<JSONObject> result = new ArrayList<>();
        JSONArray items = array(data, key);
        for (int i = 0; i < items.length(); i++) if (items.optJSONObject(i) != null) result.add(items.optJSONObject(i));
        return result;
    }
    static JSONObject copy(JSONObject item) throws Exception { return new JSONObject(item.toString()); }
    static boolean equal(Object a, Object b) {
        if (a == JSONObject.NULL) a = null;
        if (b == JSONObject.NULL) b = null;
        if (a instanceof JSONObject && b instanceof JSONObject) {
            JSONObject left = (JSONObject) a, right = (JSONObject) b;
            if (left.length() != right.length()) return false;
            Iterator<String> keys = left.keys();
            while (keys.hasNext()) { String key = keys.next(); if (!right.has(key) || !equal(left.opt(key), right.opt(key))) return false; }
            return true;
        }
        if (a instanceof JSONArray && b instanceof JSONArray) {
            JSONArray left = (JSONArray) a, right = (JSONArray) b;
            if (left.length() != right.length()) return false;
            for (int i = 0; i < left.length(); i++) if (!equal(left.opt(i), right.opt(i))) return false;
            return true;
        }
        if (a instanceof Number && b instanceof Number) {
            try { return new BigDecimal(a.toString()).compareTo(new BigDecimal(b.toString())) == 0; } catch (Exception ignored) { }
        }
        return Objects.equals(a, b);
    }
    /** Merge only edited fields, rejecting changes to the same fields made on another device. */
    static JSONObject mergeRecord(JSONObject current, JSONObject original, JSONObject patch) throws Exception {
        JSONObject merged = copy(current);
        Iterator<String> keys = patch.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            if ("id".equals(key) || "createdAt".equals(key)) continue;
            Object before = original.opt(key), desired = patch.opt(key), latest = current.opt(key);
            if (equal(before, desired)) continue;
            if (!equal(before, latest) && !equal(desired, latest)) throw new Exception("This record changed on another device. Refresh it before saving again.");
            merged.put(key, desired);
        }
        merged.put("updatedAt", now());
        return merged;
    }
    static long cents(String amount) throws Exception {
        try {
            BigDecimal decimal = new BigDecimal(amount.trim());
            if (decimal.signum() <= 0 || decimal.scale() > 2) throw new Exception();
            long value = decimal.movePointRight(2).setScale(0, RoundingMode.UNNECESSARY).longValueExact();
            if (value > 9007199254740991L) throw new Exception();
            return value;
        } catch (Exception error) { throw new Exception("Enter a positive amount with at most two decimal places."); }
    }
    static boolean ended(JSONObject client) {
        String end = text(client, "contractEndDate");
        return "Contract Ended".equals(text(client, "contractStatus")) || (!end.isEmpty() && end.compareTo(today()) < 0);
    }
    static boolean active(JSONObject client) { return "Active client".equals(text(client, "status")) && !ended(client); }
    static boolean validDate(String value) {
        if (value.isEmpty()) return true;
        if (!value.matches("\\d{4}-\\d{2}-\\d{2}")) return false;
        try { SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.US); f.setLenient(false); return f.format(f.parse(value)).equals(value); }
        catch (Exception e) { return false; }
    }
    static long timestamp(String value) {
        try { SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSX", Locale.US); return format.parse(value).getTime(); }
        catch (Exception error) { return 0; }
    }
    static String nextDueDate(JSONObject task) throws Exception {
        String due = text(task, "dueDate"); if (due.isEmpty() || !validDate(due)) return "";
        JSONObject repeat = task.optJSONObject("repeat"); if (repeat == null) return "";
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd", Locale.US); format.setLenient(false);
        java.util.Calendar calendar = java.util.Calendar.getInstance(); calendar.setTime(format.parse(due)); calendar.set(java.util.Calendar.HOUR_OF_DAY, 12);
        switch (repeat.optString("frequency")) {
            case "daily": calendar.add(java.util.Calendar.DATE, 1); return format.format(calendar.getTime());
            case "weekly":
                JSONArray days = repeat.optJSONArray("weekdays"); int current = calendar.get(java.util.Calendar.DAY_OF_WEEK) - 1;
                for (int offset = 1; offset <= 7; offset++) {
                    calendar.add(java.util.Calendar.DATE, 1); int day = calendar.get(java.util.Calendar.DAY_OF_WEEK) - 1; boolean matches = days == null || days.length() == 0 ? day == current : false;
                    if (days != null) for (int i = 0; i < days.length(); i++) if (days.optInt(i, -1) == day) matches = true;
                    if (matches) { String next = format.format(calendar.getTime()); String end = text(task, "scheduleEndDate"); return !end.isEmpty() && next.compareTo(end) > 0 ? "" : next; }
                }
                return "";
            case "monthly":
                int originalDay = calendar.get(java.util.Calendar.DAY_OF_MONTH);
                calendar.set(java.util.Calendar.DAY_OF_MONTH, 1); calendar.add(java.util.Calendar.MONTH, 1);
                calendar.set(java.util.Calendar.DAY_OF_MONTH, Math.min(calendar.getActualMaximum(java.util.Calendar.DAY_OF_MONTH), Math.max(1, Math.min(31, repeat.optInt("dayOfMonth", originalDay)))));
                return format.format(calendar.getTime());
            default: return "";
        }
    }
    static JSONObject walletTotals(JSONObject data) throws Exception {
        JSONObject totals = new JSONObject().put("balance", 0L).put("income", 0L).put("expense", 0L).put("salary", 0L).put("payable", 0L);
        JSONObject accounts = new JSONObject().put("maribank", 0L).put("gcash", 0L).put("wise", 0L).put("unassigned", 0L);
        for (JSONObject entry : records(data, "walletEntries")) {
            String type = text(entry, "type"), account = text(entry, "account");
            double raw = entry.optDouble("cents", Double.NaN); long value = entry.optLong("cents");
            if (!accounts.has(account) || !java.util.Arrays.asList("income", "expense", "salary", "payable", "opening").contains(type)
                || !Double.isFinite(raw) || raw != value || value <= 0 || value > 9007199254740991L) continue;
            if (type.equals("payable")) { totals.put("payable", Math.addExact(totals.getLong("payable"), value)); continue; }
            long signed = type.equals("expense") ? -value : value;
            accounts.put(account, Math.addExact(accounts.getLong(account), signed));
            totals.put("balance", Math.addExact(totals.getLong("balance"), signed));
            if (!type.equals("opening")) totals.put(type, Math.addExact(totals.getLong(type), value));
        }
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (JSONObject invoice : records(data, "invoices")) {
            String id = text(invoice, "id"); if (id.isEmpty() || seen.contains(id) || text(invoice, "paidAt").isEmpty()) continue;
            seen.add(id); String received = text(invoice, "amountReceivedPhp");
            if (received.isEmpty() && text(invoice, "paymentCurrency").equalsIgnoreCase("PHP")) received = text(invoice, "amountReceived");
            if (received.isEmpty()) continue;
            long value;
            try { value = new BigDecimal(received).movePointRight(2).setScale(0, RoundingMode.HALF_UP).longValueExact(); } catch (Exception ignored) { continue; }
            if (value < 0 || value > 9007199254740991L) continue;
            String account = text(invoice, "walletAccount");
            if (!accounts.has(account)) { account = text(invoice, "paymentMethod").toLowerCase(Locale.ROOT); if (!accounts.has(account)) account = "unassigned"; }
            accounts.put(account, Math.addExact(accounts.getLong(account), value));
            totals.put("balance", Math.addExact(totals.getLong("balance"), value)); totals.put("salary", Math.addExact(totals.getLong("salary"), value));
        }
        totals.put("available", Math.subtractExact(totals.getLong("balance"), totals.getLong("payable"))).put("accounts", accounts); return totals;
    }
}
