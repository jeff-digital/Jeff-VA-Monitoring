package com.jeffdigital.jeffva;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class WorkspaceModelTest {
    @Test public void taskTabsSeparateCompletionAndPreserveRecords() throws Exception {
        JSONObject data = new JSONObject("{\"dailyTasks\":[{\"title\":\"Write report\",\"taskDate\":\"2026-10-30\"},{\"title\":\"Send report\",\"completedAt\":\"2026-10-29\"},{\"title\":\"Archived work\",\"status\":\"done\"}]}");
        assertEquals(1, WorkspaceModel.taskList(data, "dailyTasks", false, "Due date", "").size());
        assertEquals(2, WorkspaceModel.taskList(data, "dailyTasks", true, "Newest", "").size());
        assertEquals(1, WorkspaceModel.taskList(data, "dailyTasks", true, "Title", "send").size());
        assertEquals(3, data.getJSONArray("dailyTasks").length());
    }
    @Test public void taskSortPutsUndatedLastAndHandlesClientTasks() throws Exception {
        JSONObject data = new JSONObject("{\"clientTasks\":[{\"title\":\"Zeta\"},{\"title\":\"Alpha\",\"dueDate\":\"2026-10-30\"},{\"title\":\"Beta\",\"dueDate\":\"2026-10-29\"}]}");
        assertEquals("Beta", WorkspaceModel.taskList(data, "clientTasks", false, "Due date", "").get(0).getString("title"));
        assertEquals("Zeta", WorkspaceModel.taskList(data, "clientTasks", false, "Due date", "").get(2).getString("title"));
        assertEquals("Alpha", WorkspaceModel.taskList(data, "clientTasks", false, "Title", "").get(0).getString("title"));
    }
    @Test public void salaryUsesAnnualizedWeeksAndRejectsInvalidInputs() {
        assertEquals(new java.math.BigDecimal("1733.33"), WorkspaceModel.monthlySalary(new java.math.BigDecimal("10"), new java.math.BigDecimal("40"), false));
        assertEquals(new java.math.BigDecimal("1200.00"), WorkspaceModel.monthlySalary(new java.math.BigDecimal("1200"), new java.math.BigDecimal("40"), true));
        try { WorkspaceModel.monthlySalary(new java.math.BigDecimal("10"), java.math.BigDecimal.ZERO, false); fail("Zero hours must fail"); } catch (IllegalArgumentException expected) { }
    }
    @Test public void editsPreserveNewFieldsFromOtherDevice() throws Exception {
        JSONObject original = new JSONObject("{\"id\":\"a\",\"title\":\"Before\",\"notes\":\"original\"}");
        JSONObject current = new JSONObject("{\"id\":\"a\",\"title\":\"Before\",\"notes\":\"new on web\",\"documents\":[{\"id\":\"file\"}],\"futureField\":true}");
        JSONObject merged = WorkspaceModel.mergeRecord(current, original, new JSONObject().put("title", "After"));
        assertEquals("After", merged.getString("title")); assertEquals("new on web", merged.getString("notes"));
        assertTrue(merged.getBoolean("futureField")); assertEquals("file", merged.getJSONArray("documents").getJSONObject(0).getString("id"));
    }
    @Test public void concurrentEditsToSameFieldAreRejected() throws Exception {
        JSONObject original = new JSONObject().put("title", "Before");
        try { WorkspaceModel.mergeRecord(new JSONObject().put("title", "Changed on web"), original, new JSONObject().put("title", "Changed on phone")); fail("Must reject a stale edit"); }
        catch (Exception expected) { assertTrue(expected.getMessage().contains("another device")); }
    }
    @Test public void uneditedFormValuesNeverUndoServerChanges() throws Exception {
        JSONObject original = new JSONObject().put("title", "Before");
        JSONObject merged = WorkspaceModel.mergeRecord(new JSONObject().put("title", "Changed on web"), original, new JSONObject().put("title", "Before"));
        assertEquals("Changed on web", merged.getString("title"));
    }
    @Test public void numbersCompareSemanticallyAcrossJsonSerializers() {
        assertTrue(WorkspaceModel.equal(1000, 1000.0)); assertTrue(WorkspaceModel.equal(JSONObject.NULL, null));
        assertFalse(WorkspaceModel.equal(1000, "1000"));
    }
    @Test public void identifiersCannotBeChangedByEditing() throws Exception {
        JSONObject original = new JSONObject().put("id", "original").put("createdAt", "yesterday");
        JSONObject merged = WorkspaceModel.mergeRecord(original, original, new JSONObject().put("id", "other").put("createdAt", "today"));
        assertEquals("original", merged.getString("id")); assertEquals("yesterday", merged.getString("createdAt"));
    }
    @Test public void moneyUsesExactCents() throws Exception {
        assertEquals(12345, WorkspaceModel.cents("123.45")); assertEquals(1, WorkspaceModel.cents("0.01"));
        for (String bad : new String[]{"0", "-1", "0.001", "NaN", "Infinity", "", "90071992547409.92"}) {
            try { WorkspaceModel.cents(bad); fail("Must reject " + bad); } catch (Exception expected) { }
        }
    }
    @Test public void walletHandlesPayablesExpensesAndDeduplicatedInvoiceSalary() throws Exception {
        JSONObject data = new JSONObject("{\"walletEntries\":[{\"type\":\"opening\",\"account\":\"gcash\",\"cents\":10000},{\"type\":\"income\",\"account\":\"wise\",\"cents\":20000},{\"type\":\"expense\",\"account\":\"gcash\",\"cents\":2500},{\"type\":\"payable\",\"account\":\"unassigned\",\"cents\":3000}],\"invoices\":[{\"id\":\"invoice\",\"paidAt\":\"2026-10-29\",\"amountReceivedPhp\":\"500.00\",\"walletAccount\":\"wise\"},{\"id\":\"invoice\",\"paidAt\":\"2026-10-29\",\"amountReceivedPhp\":\"500.00\"},{\"id\":\"usd-only\",\"paidAt\":\"2026-10-29\",\"amountReceived\":100,\"paymentCurrency\":\"USD\"}]}");
        JSONObject totals = WorkspaceModel.walletTotals(data);
        assertEquals(77500, totals.getLong("balance")); assertEquals(74500, totals.getLong("available"));
        assertEquals(20000, totals.getLong("income")); assertEquals(50000, totals.getLong("salary"));
        assertEquals(7500, totals.getJSONObject("accounts").getLong("gcash")); assertEquals(70000, totals.getJSONObject("accounts").getLong("wise"));
    }
    @Test public void walletExcludesInvalidEntriesAndUnpaidInvoices() throws Exception {
        JSONObject data = new JSONObject("{\"walletEntries\":[{\"type\":\"income\",\"account\":\"wise\",\"cents\":1.2},{\"type\":\"income\",\"account\":\"other\",\"cents\":100},{\"type\":\"income\",\"account\":\"gcash\",\"cents\":-100}],\"invoices\":[{\"id\":\"unpaid\",\"amountReceivedPhp\":500}]}");
        assertEquals(0, WorkspaceModel.walletTotals(data).getLong("balance"));
    }
    @Test public void monthlyRecurrenceClampsToTheLastDay() throws Exception {
        JSONObject task = new JSONObject().put("dueDate", "2027-01-31").put("repeat", new JSONObject().put("frequency", "monthly").put("dayOfMonth", 31));
        assertEquals("2027-02-28", WorkspaceModel.nextDueDate(task));
        task.put("dueDate", "2028-01-31"); assertEquals("2028-02-29", WorkspaceModel.nextDueDate(task));
    }
    @Test public void weeklyRecurrenceHonorsScheduleEnd() throws Exception {
        JSONObject task = new JSONObject().put("dueDate", "2026-10-29").put("repeat", new JSONObject().put("frequency", "weekly").put("weekdays", new JSONArray().put(1).put(5)));
        assertEquals("2026-10-30", WorkspaceModel.nextDueDate(task));
        task.put("scheduleEndDate", "2026-10-29"); assertEquals("", WorkspaceModel.nextDueDate(task));
    }
    @Test public void dateValidationRejectsImpossibleDates() {
        assertTrue(WorkspaceModel.validDate("2028-02-29")); assertTrue(WorkspaceModel.validDate(""));
        assertFalse(WorkspaceModel.validDate("2027-02-29")); assertFalse(WorkspaceModel.validDate("2026-2-1"));
    }
    @Test public void remindersExcludeCompletedTasksAndOutOfRangeRenewals() throws Exception {
        JSONObject data = new JSONObject("{\"dailyTasks\":[{\"taskDate\":\"2026-10-28\"},{\"taskDate\":\"2026-10-29\"},{\"taskDate\":\"2026-10-30\"},{\"taskDate\":\"2026-10-28\",\"completedAt\":\"done\"},{\"taskDate\":\"\"}],\"clientTasks\":[{\"dueDate\":\"2026-10-29\",\"status\":\"todo\"},{\"dueDate\":\"2026-10-28\",\"status\":\"done\"},{\"dueDate\":\"2026-10-28\",\"completedAt\":\"done\"}],\"subscriptions\":[{\"expiryDate\":\"2026-10-29\"},{\"expiryDate\":\"2026-11-05\"},{\"expiryDate\":\"2026-11-06\"},{\"expiryDate\":\"2026-10-28\"},{\"expiryDate\":\"invalid\"}]}");
        assertArrayEquals(new int[]{3, 2}, WorkspaceModel.reminderCounts(data, "2026-10-29", "2026-11-05", true, true));
        assertArrayEquals(new int[]{0, 2}, WorkspaceModel.reminderCounts(data, "2026-10-29", "2026-11-05", false, true));
        assertArrayEquals(new int[]{3, 0}, WorkspaceModel.reminderCounts(data, "2026-10-29", "2026-11-05", true, false));
        assertArrayEquals(new int[]{0, 0}, WorkspaceModel.reminderCounts(new JSONObject(), "2026-10-29", "2026-11-05", true, true));
    }
}
