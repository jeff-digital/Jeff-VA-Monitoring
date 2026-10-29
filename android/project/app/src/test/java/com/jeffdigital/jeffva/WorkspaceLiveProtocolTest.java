package com.jeffdigital.jeffva;

import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class WorkspaceLiveProtocolTest {
    @Test public void subscriptionIsAuthenticatedAndScopedToOneAccount() throws Exception {
        JSONObject join = WorkspaceLiveProtocol.join("user-a", "test-token");
        assertEquals("test-token", join.getString("access_token"));
        JSONObject subscription = join.getJSONObject("config").getJSONArray("postgres_changes").getJSONObject(0);
        assertEquals("app_state", subscription.getString("table"));
        assertEquals("user_id=eq.user-a", subscription.getString("filter"));
    }
    @Test public void rejectsOtherAccountsAndUnrelatedOrMalformedMessages() throws Exception {
        JSONObject event = event("user-a"); assertTrue(WorkspaceLiveProtocol.ownChange(event, "user-a"));
        assertFalse(WorkspaceLiveProtocol.ownChange(event, "user-b"));
        event.getJSONObject("payload").getJSONObject("data").getJSONObject("record").put("user_id", "user-b");
        assertFalse(WorkspaceLiveProtocol.ownChange(event, "user-a"));
        assertFalse(WorkspaceLiveProtocol.ownChange(new JSONObject(), "user-a"));
        event.put("event", "broadcast"); assertFalse(WorkspaceLiveProtocol.ownChange(event, "user-a"));
    }
    @Test public void deletionOnlyInvalidatesForTheMatchingOldOwner() throws Exception {
        JSONObject event = event("user-a"), data = event.getJSONObject("payload").getJSONObject("data");
        data.put("old_record", data.remove("record")); assertTrue(WorkspaceLiveProtocol.ownChange(event, "user-a"));
        data.put("table", "another_table"); assertFalse(WorkspaceLiveProtocol.ownChange(event, "user-a"));
    }
    private JSONObject event(String user) throws Exception {
        return new JSONObject().put("event", "postgres_changes").put("topic", WorkspaceLiveProtocol.topic(user)).put("payload", new JSONObject().put("data", new JSONObject().put("schema", "public").put("table", "app_state").put("record", new JSONObject().put("user_id", user))));
    }
}
