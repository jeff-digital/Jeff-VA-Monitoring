package com.jeffdigital.jeffva;

import android.os.Handler;
import android.os.Looper;
import okhttp3.*;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.concurrent.TimeUnit;

/** Foreground database invalidations, never a substitute for background push.
 * Incoming payloads only request an authenticated reload; they aren't trusted as data. */
final class WorkspaceLiveUpdates {
    private static final OkHttpClient CLIENT = new OkHttpClient.Builder().pingInterval(20, TimeUnit.SECONDS).build();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable changed;
    private WebSocket socket;
    private String user = "", token = "";
    private int generation, reference;
    private boolean stopped, heartbeatPending;
    private final Runnable heartbeat = new Runnable() {
        @Override public void run() {
            if (stopped || socket == null) return;
            if (heartbeatPending) { disconnect(); return; }
            heartbeatPending = true;
            send("phoenix", "heartbeat", new JSONObject());
            handler.postDelayed(this, 20000);
        }
    };
    WorkspaceLiveUpdates(Runnable changed) { this.changed = changed; }
    void connect(JSONObject credentials) {
        if (stopped) return;
        String nextUser = credentials.optString("user"), nextToken = credentials.optString("token");
        if (nextUser.isEmpty() || nextToken.isEmpty()) return;
        if (socket != null && nextUser.equals(user)) {
            if (!nextToken.equals(token)) { token = nextToken; try { send(topic(), "access_token", new JSONObject().put("access_token", token)); } catch (Exception ignored) { disconnect(); } }
            return;
        }
        disconnect(); user = nextUser; token = nextToken; reference = 0; int current = ++generation;
        String url = BuildConfig.SUPABASE_URL.replaceFirst("^https://", "wss://") + "/realtime/v1/websocket?apikey=" + BuildConfig.PUBLISHABLE_KEY + "&vsn=1.0.0";
        socket = CLIENT.newWebSocket(new Request.Builder().url(url).build(), new WebSocketListener() {
            @Override public void onOpen(WebSocket ws, Response response) {
                handler.post(() -> {
                    if (stopped || current != generation) { ws.cancel(); return; }
                    try {
                        send(topic(), "phx_join", WorkspaceLiveProtocol.join(user, token));
                        heartbeatPending = false; handler.postDelayed(heartbeat, 20000);
                    } catch (Exception ignored) { disconnect(); }
                });
            }
            @Override public void onMessage(WebSocket ws, String message) {
                handler.post(() -> {
                    if (stopped || current != generation) return;
                    try {
                        JSONObject event = new JSONObject(message); String type = event.optString("event");
                        if ("phx_reply".equals(type) && "phoenix".equals(event.optString("topic"))) heartbeatPending = false;
                        if (WorkspaceLiveProtocol.ownChange(event, user)) changed.run();
                        if ("phx_error".equals(type) || "phx_close".equals(type)) disconnect();
                        if ("phx_reply".equals(type) && "error".equals(event.optJSONObject("payload") == null ? "" : event.getJSONObject("payload").optString("status"))) disconnect();
                    } catch (Exception ignored) { /* Ignore malformed frames. */ }
                });
            }
            @Override public void onFailure(WebSocket ws, Throwable error, Response response) { handler.post(() -> { if (current == generation) disconnect(); }); }
            @Override public void onClosing(WebSocket ws, int code, String reason) { ws.close(code, null); }
            @Override public void onClosed(WebSocket ws, int code, String reason) { handler.post(() -> { if (current == generation) disconnect(); }); }
        });
    }
    private String topic() { return WorkspaceLiveProtocol.topic(user); }
    private void send(String topic, String event, JSONObject payload) {
        try { if (socket != null) socket.send(new JSONObject().put("topic", topic).put("event", event).put("payload", payload).put("ref", String.valueOf(++reference)).put("join_ref", "phoenix".equals(topic) ? JSONObject.NULL : "1").toString()); }
        catch (Exception ignored) { disconnect(); }
    }
    private void disconnect() { generation++; handler.removeCallbacks(heartbeat); WebSocket prior = socket; socket = null; heartbeatPending = false; if (prior != null) prior.cancel(); }
    void close() { stopped = true; disconnect(); user = ""; token = ""; handler.removeCallbacksAndMessages(null); }
}
