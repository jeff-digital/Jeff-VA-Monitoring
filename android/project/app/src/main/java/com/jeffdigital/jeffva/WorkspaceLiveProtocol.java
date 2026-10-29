package com.jeffdigital.jeffva;

import org.json.JSONArray;
import org.json.JSONObject;

final class WorkspaceLiveProtocol {
    static String topic(String user) { return "realtime:android-workspace-" + user; }
    static JSONObject join(String user, String token) throws Exception {
        JSONArray changes = new JSONArray().put(new JSONObject().put("event", "*").put("schema", "public").put("table", "app_state").put("filter", "user_id=eq." + user));
        JSONObject config = new JSONObject().put("broadcast", new JSONObject().put("self", false)).put("presence", new JSONObject().put("enabled", false)).put("postgres_changes", changes);
        return new JSONObject().put("config", config).put("access_token", token);
    }
    static boolean ownChange(JSONObject event, String user) {
        if (!"postgres_changes".equals(event.optString("event")) || !topic(user).equals(event.optString("topic"))) return false;
        JSONObject payload = event.optJSONObject("payload"), data = payload == null ? null : payload.optJSONObject("data");
        if (data == null || !"public".equals(data.optString("schema")) || !"app_state".equals(data.optString("table"))) return false;
        JSONObject record = data.optJSONObject("record"), old = data.optJSONObject("old_record");
        return record != null && user.equals(record.optString("user_id")) || old != null && user.equals(old.optString("user_id"));
    }
}
