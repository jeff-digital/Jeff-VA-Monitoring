package com.jeffdigital.jeffva;

import android.content.Context;
import android.net.Uri;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Iterator;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.MediaType;
import okhttp3.Response;

final class WorkspaceRepository {
    private final SessionVault vault;
    private JSONObject session;
    private JSONObject workspace = new JSONObject();
    private JSONObject coverDraft = new JSONObject();
    private String userId = "";
    private final OkHttpClient http = new OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(25, TimeUnit.SECONDS).callTimeout(35, TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).build();
    static final class ApiError extends Exception {
        final int status;
        ApiError(int status, String message) { super(message); this.status = status; }
    }
    WorkspaceRepository(Context context) { vault = new SessionVault(context); }
    static String encode(String value) throws Exception { return URLEncoder.encode(value, "UTF-8"); }
    private static String message(String response, int status) {
        try {
            JSONObject error = new JSONObject(response);
            for (String key : new String[]{"msg", "error_description", "message", "error"}) {
                if (error.opt(key) instanceof String && !error.optString(key).isEmpty()) return error.optString(key);
            }
        } catch (Exception ignored) { }
        return status == 401 ? "Please sign in again." : "Could not complete the request (HTTP " + status + ").";
    }
    private String request(String method, String url, byte[] body, String type, String token, String prefer) throws Exception {
        Request.Builder request = new Request.Builder().url(url).header("Accept", "application/json");
        if (url.startsWith(BuildConfig.SUPABASE_URL + "/")) request.header("apikey", BuildConfig.PUBLISHABLE_KEY);
        if (token != null && !token.isEmpty()) request.header("Authorization", "Bearer " + token);
        if (prefer != null) request.header("Prefer", prefer);
        RequestBody payload = body == null ? null : RequestBody.create(MediaType.parse(type == null ? "application/json" : type), body);
        if (payload == null && (method.equals("POST") || method.equals("PUT") || method.equals("PATCH"))) payload = RequestBody.create(null, new byte[0]);
        request.method(method, payload);
        OkHttpClient client = url.contains("/api/research") ? http.newBuilder().readTimeout(70, TimeUnit.SECONDS).callTimeout(75, TimeUnit.SECONDS).build() : http;
        try (Response response = client.newCall(request.build()).execute()) {
            int status = response.code();
            InputStream input = response.body() == null ? null : response.body().byteStream();
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            if (input != null) try (InputStream stream = input) {
                byte[] buffer = new byte[8192]; int length;
                while ((length = stream.read(buffer)) != -1) {
                    if (output.size() + length > 32 * 1024 * 1024) throw new Exception("The response is too large to open on this device.");
                    output.write(buffer, 0, length);
                }
            }
            String result = new String(output.toByteArray(), StandardCharsets.UTF_8);
            if (status < 200 || status >= 300) throw new ApiError(status, message(result, status));
            return result;
        }
    }
    private String json(String method, String url, JSONObject data, String token, String prefer) throws Exception {
        return request(method, url, data == null ? null : data.toString().getBytes(StandardCharsets.UTF_8), null, token, prefer);
    }
    private void acceptSession(JSONObject value) throws Exception {
        if (value.optString("access_token").isEmpty() || value.optString("refresh_token").isEmpty()) throw new Exception("The sign-in response was incomplete.");
        JSONObject user = value.optJSONObject("user");
        if (user == null || user.optString("id").isEmpty()) throw new Exception("Could not verify the signed-in account.");
        if (!value.has("expires_at")) value.put("expires_at", System.currentTimeMillis() / 1000 + value.optLong("expires_in", 3600));
        if (session != null && session.optJSONObject("user") != null && user.optString("id").equals(session.optJSONObject("user").optString("id"))) {
            for (String key : new String[]{"provider_token", "provider_refresh_token", "provider_expires_at"}) {
                if (value.optString(key).isEmpty() && session.has(key)) value.put(key, session.opt(key));
            }
        }
        if (!value.optString("provider_token").isEmpty() && !value.has("provider_expires_at")) value.put("provider_expires_at", System.currentTimeMillis() / 1000 + 3300);
        vault.put("session", value.toString());
        session = value;
        userId = user.optString("id");
        loadCoverDraft();
    }
    boolean restore() throws Exception {
        String stored = vault.get("session");
        if (stored.isEmpty()) return false;
        session = new JSONObject(stored);
        userId = session.getJSONObject("user").getString("id");
        accessToken();
        JSONObject verified = new JSONObject(json("GET", BuildConfig.SUPABASE_URL + "/auth/v1/user", null, accessToken(), null));
        if (!userId.equals(verified.optString("id"))) { logout(); throw new Exception("Please sign in again."); }
        loadCoverDraft();
        return true;
    }
    void login(String email, String password) throws Exception {
        JSONObject body = new JSONObject().put("email", email).put("password", password);
        JSONObject response = new JSONObject(json("POST", BuildConfig.SUPABASE_URL + "/auth/v1/token?grant_type=password", body, null, null));
        session = null;
        acceptSession(response);
    }
    String startGoogleLogin() throws Exception {
        byte[] random = new byte[48]; new SecureRandom().nextBytes(random);
        String verifier = Base64.encodeToString(random, Base64.NO_WRAP | Base64.URL_SAFE | Base64.NO_PADDING);
        String challenge = Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)), Base64.NO_WRAP | Base64.URL_SAFE | Base64.NO_PADDING);
        vault.put("pkce", new JSONObject().put("verifier", verifier).put("started", System.currentTimeMillis()).toString());
        return BuildConfig.SUPABASE_URL + "/auth/v1/authorize?provider=google&redirect_to=" + encode(BuildConfig.AUTH_REDIRECT)
            + "&code_challenge=" + encode(challenge) + "&code_challenge_method=s256&access_type=offline&prompt=consent&scopes="
            + encode("https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send");
    }
    void finishGoogleLogin(Uri uri) throws Exception {
        Uri expected = Uri.parse(BuildConfig.AUTH_REDIRECT);
        if (!expected.getScheme().equals(uri.getScheme()) || !expected.getHost().equals(uri.getHost()) || !expected.getPath().equals(uri.getPath())) throw new Exception("Invalid sign-in callback.");
        String pending = vault.get("pkce");
        if (pending.isEmpty()) throw new Exception("Start Google sign-in from Jeff VA first.");
        JSONObject pkce = new JSONObject(pending);
        if (System.currentTimeMillis() - pkce.optLong("started") > 10 * 60 * 1000) { vault.remove("pkce"); throw new Exception("Sign-in expired. Please try again."); }
        String code = uri.getQueryParameter("code");
        if (code == null || code.isEmpty()) throw new Exception("Google sign-in was cancelled or could not finish.");
        JSONObject body = new JSONObject().put("auth_code", code).put("code_verifier", pkce.getString("verifier"));
        JSONObject response = new JSONObject(json("POST", BuildConfig.SUPABASE_URL + "/auth/v1/token?grant_type=pkce", body, null, null));
        session = null;
        acceptSession(response);
        vault.remove("pkce");
    }
    private String accessToken() throws Exception {
        if (session == null) throw new Exception("Sign in to open your workspace.");
        if (session.optLong("expires_at") < System.currentTimeMillis() / 1000 + 60) refreshSession();
        return session.getString("access_token");
    }
    private void refreshSession() throws Exception {
        JSONObject result = new JSONObject(json("POST", BuildConfig.SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token",
            new JSONObject().put("refresh_token", session.getString("refresh_token")), null, null));
        acceptSession(result);
    }
    String authenticated(String method, String url, JSONObject body, String prefer) throws Exception {
        try { return json(method, url, body, accessToken(), prefer); }
        catch (ApiError error) {
            if (error.status != 401) throw error;
            refreshSession();
            return json(method, url, body, accessToken(), prefer);
        }
    }
    JSONObject api(String method, String path, JSONObject body) throws Exception {
        if (!path.startsWith("/api/")) throw new Exception("Invalid API path.");
        return new JSONObject(authenticated(method, BuildConfig.API_ORIGIN + path, body, null));
    }
    private JSONArray rows() throws Exception {
        return new JSONArray(authenticated("GET", BuildConfig.SUPABASE_URL + "/rest/v1/app_state?user_id=eq." + encode(userId) + "&select=data,updated_at", null, null));
    }
    JSONObject load() throws Exception {
        String identity = userId;
        JSONArray rows = rows();
        JSONObject saved = rows.length() == 0 ? new JSONObject() : rows.getJSONObject(0).optJSONObject("data");
        if (!identity.equals(userId) || !signedIn()) throw new Exception("The account changed while syncing.");
        workspace = saved == null ? new JSONObject() : saved;
        vault.put("workspace:" + identity, workspace.toString());
        return workspace;
    }
    JSONObject cached() throws Exception {
        if (userId.isEmpty()) throw new Exception("Sign in to open saved data.");
        String saved = vault.get("workspace:" + userId);
        if (saved.isEmpty()) throw new Exception("No saved workspace is available on this device yet.");
        workspace = new JSONObject(saved);
        return workspace;
    }
    String email() { return session == null ? "" : session.optJSONObject("user").optString("email"); }
    JSONObject accountProfile() {
        try { return session == null ? new JSONObject() : new JSONObject(session.getJSONObject("user").toString()); }
        catch (Exception ignored) { return new JSONObject(); }
    }
    private void loadCoverDraft() { try { String saved = vault.get("cover-letter:" + userId); coverDraft = saved.isEmpty() ? new JSONObject() : new JSONObject(saved); } catch (Exception ignored) { coverDraft = new JSONObject(); } }
    JSONObject coverLetterDraft() throws Exception { return new JSONObject(coverDraft.toString()); }
    void saveCoverLetterDraft(JSONObject draft) throws Exception { if (!signedIn()) throw new Exception("Sign in first."); vault.put("cover-letter:" + userId, draft.toString()); coverDraft = new JSONObject(draft.toString()); }
    boolean signedIn() { return session != null && !userId.isEmpty(); }
    // Called on the same serial IO queue as saves/session refreshes.
    JSONObject liveCredentials() throws Exception { return new JSONObject().put("user", userId).put("token", accessToken()); }
    interface Mutation { void apply(JSONObject state) throws Exception; }
    private JSONObject mutate(Mutation mutation) throws Exception {
        for (int attempt = 0; attempt < 3; attempt++) {
            JSONArray rows = rows();
            JSONObject row = rows.length() == 0 ? null : rows.getJSONObject(0);
            JSONObject latest = row == null || row.optJSONObject("data") == null ? new JSONObject() : row.getJSONObject("data");
            mutation.apply(latest);
            JSONObject body = new JSONObject().put("data", latest).put("updated_at", WorkspaceModel.now());
            String result;
            if (row == null) {
                body.put("user_id", userId);
                result = authenticated("POST", BuildConfig.SUPABASE_URL + "/rest/v1/app_state?on_conflict=user_id", body, "resolution=ignore-duplicates,return=representation");
            } else {
                String revision = row.isNull("updated_at") ? "is.null" : "eq." + encode(row.getString("updated_at"));
                result = authenticated("PATCH", BuildConfig.SUPABASE_URL + "/rest/v1/app_state?user_id=eq." + encode(userId) + "&updated_at=" + revision, body, "return=representation");
            }
            if (new JSONArray(result).length() > 0) { workspace = latest; vault.put("workspace:" + userId, latest.toString()); return latest; }
        }
        throw new Exception("The workspace is changing on another device. Refresh and try again.");
    }
    JSONObject saveRecord(String collection, JSONObject original, JSONObject patch) throws Exception {
        final JSONObject edits = WorkspaceModel.copy(patch);
        final String id = original == null ? UUID.randomUUID().toString() : original.getString("id");
        return mutate(latest -> {
            JSONArray records = WorkspaceModel.array(latest, collection);
            int index = -1;
            for (int i = 0; i < records.length(); i++) if (id.equals(records.optJSONObject(i).optString("id"))) { index = i; break; }
            if (original == null) {
                JSONObject created = WorkspaceModel.copy(edits).put("id", id).put("createdAt", WorkspaceModel.now());
                if (index < 0) records.put(created);
            } else {
                if (index < 0) throw new Exception("This record was removed on another device. Refresh your workspace.");
                records.put(index, WorkspaceModel.mergeRecord(records.getJSONObject(index), original, edits));
            }
            latest.put(collection, records);
        });
    }
    JSONObject deleteRecord(String collection, JSONObject original) throws Exception {
        return mutate(latest -> {
            JSONArray records = WorkspaceModel.array(latest, collection), kept = new JSONArray();
            for (int i = 0; i < records.length(); i++) {
                JSONObject record = records.getJSONObject(i);
                if (original.getString("id").equals(record.optString("id"))) {
                    if (!WorkspaceModel.equal(original, record)) throw new Exception("This record changed on another device. Refresh before deleting it.");
                } else kept.put(record);
            }
            latest.put(collection, kept);
        });
    }
    String gmailToken() throws Exception {
        if (session.optLong("provider_expires_at") > System.currentTimeMillis() / 1000 && !session.optString("provider_token").isEmpty()) return session.getString("provider_token");
        String refresh = session.optString("provider_refresh_token");
        if (refresh.isEmpty()) throw new Exception("Sign in with Google to connect Gmail on this device.");
        JSONObject result = api("POST", "/api/gmail/refresh", new JSONObject().put("refreshToken", refresh));
        session.put("provider_token", result.getString("access_token")).put("provider_expires_at", System.currentTimeMillis() / 1000 + result.optLong("expires_in", 3600) - 60);
        vault.put("session", session.toString());
        return session.getString("provider_token");
    }
    JSONObject gmail(String method, String path, JSONObject body) throws Exception {
        if (!path.startsWith("/gmail/v1/users/me/")) throw new Exception("Invalid Gmail path.");
        return new JSONObject(json(method, "https://gmail.googleapis.com" + path, body, gmailToken(), null));
    }
    void recover(String email) throws Exception {
        json("POST", BuildConfig.SUPABASE_URL + "/auth/v1/recover", new JSONObject().put("email", email), null, null);
    }
    JSONObject upload(String name, String mime, byte[] contents) throws Exception {
        String id = UUID.randomUUID().toString();
        String storagePath = userId + "/" + id;
        request("POST", BuildConfig.SUPABASE_URL + "/storage/v1/object/client-documents/" + storagePath, contents, mime, accessToken(), null);
        return new JSONObject().put("id", id).put("name", name).put("type", mime).put("size", contents.length).put("storagePath", storagePath).put("addedAt", WorkspaceModel.now());
    }
    byte[] document(JSONObject doc) throws Exception {
        String storagePath = doc.optString("storagePath", doc.optString("id"));
        if (!storagePath.startsWith(userId + "/")) throw new Exception("The document is not in this account's storage.");
        String response = authenticated("POST", BuildConfig.SUPABASE_URL + "/storage/v1/object/sign/client-documents/" + storagePath,
            new JSONObject().put("expiresIn", 60), null);
        return downloadSignedFile(response, 25 * 1024 * 1024);
    }
    /** Capture read-only credentials now; photo requests never refresh or write a signed-out session. */
    java.util.concurrent.Callable<byte[]> profilePhoto(JSONObject photo) throws Exception {
        String path = photo.optString("storagePath");
        if (userId.isEmpty() || session == null || !path.startsWith(userId + "/") || path.contains("..") || path.contains("?") || path.contains("#")) throw new Exception("Profile photo is unavailable.");
        final String token = session.optString("access_token");
        final String endpoint = BuildConfig.SUPABASE_URL + "/storage/v1/object/sign/client-documents/" + path;
        return () -> downloadSignedFile(json("POST", endpoint, new JSONObject().put("expiresIn", 60), token, null), 5 * 1024 * 1024);
    }
    private byte[] downloadSignedFile(String response, int maximumBytes) throws Exception {
        String signed = new JSONObject(response).getString("signedURL");
        URL url = new URL(BuildConfig.SUPABASE_URL + "/storage/v1" + signed);
        if (!"https".equals(url.getProtocol()) || !url.getHost().equals(new URL(BuildConfig.SUPABASE_URL).getHost())) throw new Exception("Invalid document address.");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(20000); connection.setReadTimeout(25000); connection.setInstanceFollowRedirects(false);
        try {
            if (connection.getResponseCode() != 200) throw new Exception("Could not download the document.");
            try (InputStream in = connection.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192]; int length;
                while ((length = in.read(buffer)) != -1) { if (out.size() + length > maximumBytes) throw new Exception("This file is too large to open here."); out.write(buffer, 0, length); }
                return out.toByteArray();
            }
        } finally { connection.disconnect(); }
    }
    void logout() { vault.clear(); session = null; userId = ""; workspace = new JSONObject(); coverDraft = new JSONObject(); }
    JSONObject addDocument(String clientId, String name, String mime, byte[] bytes) throws Exception {
        JSONObject document = upload(name, mime, bytes);
        try {
            return mutate(latest -> {
                if (clientId.isEmpty()) { JSONArray files = WorkspaceModel.array(latest, "personalDocuments"); files.put(document); latest.put("personalDocuments", files); }
                else {
                    JSONObject client = null;
                    for (JSONObject candidate : WorkspaceModel.records(latest, "applications")) if (clientId.equals(candidate.optString("id"))) client = candidate;
                    if (client == null) throw new Exception("The client was removed on another device.");
                    JSONArray files = WorkspaceModel.array(client, "documents"); boolean exists = false;
                    for (int i = 0; i < files.length(); i++) if (document.getString("id").equals(files.getJSONObject(i).optString("id"))) exists = true;
                    if (!exists) files.put(document); client.put("documents", files);
                }
            });
        } catch (Exception error) {
            // A lost response can follow a committed metadata write. Never remove
            // the uploaded file until a fresh read confirms it was not linked.
            try {
                JSONObject checked = load(); boolean linked = false;
                for (JSONObject file : WorkspaceModel.records(checked, "personalDocuments")) if (document.getString("storagePath").equals(file.optString("storagePath"))) linked = true;
                for (JSONObject client : WorkspaceModel.records(checked, "applications")) for (JSONObject file : WorkspaceModel.records(client, "documents")) if (document.getString("storagePath").equals(file.optString("storagePath"))) linked = true;
                if (linked) return checked;
                authenticated("DELETE", BuildConfig.SUPABASE_URL + "/storage/v1/object/client-documents", new JSONObject().put("prefixes", new JSONArray().put(document.getString("storagePath"))), null);
            } catch (Exception ignored) { }
            throw error;
        }
    }
    JSONObject toggleTimer(JSONObject original) throws Exception {
        JSONObject patch = new JSONObject();
        String started = WorkspaceModel.text(original, "timerStartedAt");
        if (started.isEmpty()) patch.put("timerStartedAt", WorkspaceModel.now());
        else {
            long start = WorkspaceModel.timestamp(started); if (start == 0) throw new Exception("The running timer has an invalid start time.");
            JSONArray entries = new JSONArray(WorkspaceModel.array(original, "timeEntries").toString());
            entries.put(new JSONObject().put("id", UUID.randomUUID().toString()).put("start", started).put("end", WorkspaceModel.now()).put("durationMs", Math.max(0, System.currentTimeMillis() - start)));
            patch.put("timerStartedAt", "").put("timeEntries", entries);
        }
        return saveRecord("clientTasks", original, patch);
    }
    JSONObject completeClientTask(JSONObject original, boolean completed) throws Exception {
        return mutate(latest -> {
            JSONArray tasks = WorkspaceModel.array(latest, "clientTasks"); int index = -1;
            for (int i = 0; i < tasks.length(); i++) if (original.getString("id").equals(tasks.getJSONObject(i).optString("id"))) index = i;
            if (index < 0) throw new Exception("The task was removed on another device.");
            JSONObject current = tasks.getJSONObject(index);
            JSONObject patch = new JSONObject().put("status", completed ? "done" : "todo").put("completedAt", completed ? WorkspaceModel.now() : "");
            String started = WorkspaceModel.text(current, "timerStartedAt");
            if (completed && !started.isEmpty()) {
                long start = WorkspaceModel.timestamp(started); if (start == 0) throw new Exception("The running timer has an invalid start time.");
                JSONArray entries = new JSONArray(WorkspaceModel.array(current, "timeEntries").toString());
                entries.put(new JSONObject().put("id", UUID.randomUUID().toString()).put("start", started).put("end", WorkspaceModel.now()).put("durationMs", Math.max(0, System.currentTimeMillis() - start)));
                patch.put("timerStartedAt", "").put("timeEntries", entries);
            }
            JSONObject merged = WorkspaceModel.mergeRecord(current, original, patch); tasks.put(index, merged);
            if (completed) {
                String nextDue = WorkspaceModel.nextDueDate(merged);
                if (!nextDue.isEmpty()) {
                    String series = merged.optString("recurrenceSeriesId"); if (series.isEmpty()) series = merged.getString("id");
                    String occurrence = series + ":" + nextDue; boolean exists = false;
                    for (int i = 0; i < tasks.length(); i++) if (occurrence.equals(tasks.getJSONObject(i).optString("recurrenceOccurrenceKey"))) exists = true;
                    if (!exists) tasks.put(WorkspaceModel.copy(merged).put("id", UUID.randomUUID().toString()).put("dueDate", nextDue).put("status", "todo").put("completedAt", "")
                        .put("recurrenceSeriesId", series).put("recurrenceOccurrenceKey", occurrence).put("generatedFromTaskId", merged.getString("id")).put("timerStartedAt", "")
                        .put("timeEntries", new JSONArray()).put("createdAt", WorkspaceModel.now()).put("updatedAt", WorkspaceModel.now()));
                }
            }
            latest.put("clientTasks", tasks);
        });
    }
    private static String header(JSONObject message, String name) {
        JSONObject payload = message.optJSONObject("payload"); if (payload == null) return "";
        JSONArray headers = WorkspaceModel.array(payload, "headers");
        for (int i = 0; i < headers.length(); i++) { JSONObject entry = headers.optJSONObject(i); if (entry != null && name.equalsIgnoreCase(entry.optString("name"))) return entry.optString("value"); }
        return "";
    }
    private static String body(JSONObject part, boolean plainOnly) {
        JSONObject content = part.optJSONObject("body"); String mime = part.optString("mimeType");
        if (("text/plain".equals(mime) || (!plainOnly && "text/html".equals(mime))) && content != null && !content.optString("data").isEmpty()) {
            try { return new String(Base64.decode(content.getString("data"), Base64.URL_SAFE | Base64.NO_WRAP), StandardCharsets.UTF_8); } catch (Exception ignored) { }
        }
        JSONArray parts = WorkspaceModel.array(part, "parts"); StringBuilder result = new StringBuilder();
        for (int i = 0; i < parts.length(); i++) if (parts.optJSONObject(i) != null) { String text = body(parts.optJSONObject(i), plainOnly); if (!text.isEmpty()) result.append(text).append('\n'); }
        return result.toString().trim();
    }
    private JSONObject emailRecord(JSONObject message) throws Exception {
        JSONObject payload = message.optJSONObject("payload"); String content = payload == null ? "" : body(payload, true);
        if (content.isEmpty() && payload != null) content = body(payload, false);
        JSONArray labels = WorkspaceModel.array(message, "labelIds"); boolean sent = false;
        for (int i = 0; i < labels.length(); i++) if ("SENT".equals(labels.optString(i))) sent = true;
        long millis = message.optLong("internalDate");
        java.text.SimpleDateFormat date = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US); date.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
        return new JSONObject().put("id", "gmail-" + message.getString("id")).put("gmailId", message.getString("id"))
            .put("from", header(message, "From")).put("to", header(message, "To")).put("subject", header(message, "Subject"))
            .put("body", content).put("snippet", message.optString("snippet")).put("bodyLoaded", true).put("source", "gmail")
            .put("date", date.format(new java.util.Date(millis))).put("importedAt", WorkspaceModel.now()).put("labelIds", labels).put("direction", sent ? "sent" : "received");
    }
    private JSONObject importMessages(JSONArray messages) throws Exception {
        return mutate(latest -> {
            JSONArray existing = WorkspaceModel.array(latest, "emails"), deleted = WorkspaceModel.array(latest, "deletedGmailIds");
            java.util.Set<String> removed = new java.util.HashSet<>(); for (int i = 0; i < deleted.length(); i++) removed.add(deleted.optString(i));
            for (int i = 0; i < messages.length(); i++) {
                JSONObject fresh = messages.getJSONObject(i); if (removed.contains(fresh.optString("gmailId"))) continue;
                int index = -1;
                for (int j = 0; j < existing.length(); j++) if (fresh.getString("gmailId").equals(existing.getJSONObject(j).optString("gmailId"))) { index = j; break; }
                JSONObject merged = index < 0 ? new JSONObject() : WorkspaceModel.copy(existing.getJSONObject(index));
                Iterator<String> keys = fresh.keys(); while (keys.hasNext()) { String key = keys.next(); merged.put(key, fresh.opt(key)); }
                if (index < 0) existing.put(merged); else existing.put(index, merged);
            }
            latest.put("emails", existing);
        });
    }
    JSONObject syncGmail() throws Exception {
        JSONObject list = gmail("GET", "/gmail/v1/users/me/messages?maxResults=20&q=" + encode("-in:trash -in:spam"), null);
        JSONArray ids = WorkspaceModel.array(list, "messages"), messages = new JSONArray();
        for (int i = 0; i < ids.length(); i++) {
            String id = ids.getJSONObject(i).getString("id");
            messages.put(emailRecord(gmail("GET", "/gmail/v1/users/me/messages/" + encode(id) + "?format=full", null)));
        }
        return importMessages(messages);
    }
    JSONObject sendEmail(String to, String subject, String text) throws Exception {
        if (to.contains("\r") || to.contains("\n")) throw new Exception("Invalid recipient.");
        String pending = vault.get("outbox");
        if (!pending.isEmpty()) throw new Exception("The previous email's delivery must be checked before sending another. Use Check last email delivery in the inbox.");
        String id = UUID.randomUUID().toString() + "@jeff-va.android";
        String encodedSubject = Base64.encodeToString(subject.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
        String encodedBody = Base64.encodeToString(text.getBytes(StandardCharsets.UTF_8), Base64.CRLF);
        String raw = "To: " + to + "\r\nSubject: =?UTF-8?B?" + encodedSubject + "?=\r\nMessage-ID: <" + id + ">\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" + encodedBody;
        // Verify Gmail permission before marking a send as in flight.
        gmailToken();
        vault.put("outbox", new JSONObject().put("messageId", id).put("to", to).put("subject", subject).put("started", WorkspaceModel.now()).toString());
        JSONObject sent;
        try {
            sent = gmail("POST", "/gmail/v1/users/me/messages/send", new JSONObject().put("raw", Base64.encodeToString(raw.getBytes(StandardCharsets.UTF_8), Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP)));
        } catch (ApiError error) {
            if (error.status == 400 || error.status == 401 || error.status == 403 || error.status == 404 || error.status == 413) {
                vault.remove("outbox");
                if (error.status == 401) { session.put("provider_expires_at", 0); vault.put("session", session.toString()); }
                throw error;
            }
            throw new Exception("Delivery could not be confirmed. Do not resend yet. Use Check last email delivery in the inbox.");
        } catch (Exception error) { throw new Exception("Delivery could not be confirmed. Do not resend yet. Use Check last email delivery in the inbox."); }
        String gmailId = sent.getString("id");
        vault.put("outbox", new JSONObject(vault.get("outbox")).put("gmailId", gmailId).toString());
        try { return recoverPendingEmail(); }
        catch (Exception error) { throw new Exception("Gmail accepted the email, but the workspace could not update. Use Check last email delivery; do not resend it."); }
    }
    JSONObject recoverPendingEmail() throws Exception {
        String pending = vault.get("outbox"); if (pending.isEmpty()) return load();
        JSONObject outbox = new JSONObject(pending); String id = outbox.optString("gmailId");
        if (id.isEmpty()) {
            JSONObject result = gmail("GET", "/gmail/v1/users/me/messages?maxResults=1&q=" + encode("in:sent rfc822msgid:" + outbox.getString("messageId")), null);
            JSONArray messages = WorkspaceModel.array(result, "messages");
            if (messages.length() == 0) throw new Exception("Gmail has not confirmed this message yet. Check your Sent mail before retrying; delivery can take time to appear.");
            id = messages.getJSONObject(0).getString("id");
        }
        JSONObject message = emailRecord(gmail("GET", "/gmail/v1/users/me/messages/" + encode(id) + "?format=full", null));
        JSONObject result = importMessages(new JSONArray().put(message)); vault.remove("outbox"); return result;
    }
    void clearPendingEmail() { vault.remove("outbox"); }
}
