package com.jeffdigital.jeffva;

import org.junit.Test;
import static org.junit.Assert.*;

public class ReminderUpdateGateTest {
    @Test public void navigationDoesNotRepeatStorageButNewDataAndPreferencesDo() {
        ReminderUpdateGate gate = new ReminderUpdateGate(); Object snapshot = new Object();
        assertTrue(gate.changed(snapshot, 3));
        for (int page = 0; page < 20; page++) assertFalse(gate.changed(snapshot, 3));
        assertTrue(gate.changed(snapshot, 7)); assertFalse(gate.changed(snapshot, 7));
        assertTrue(gate.changed(new Object(), 7));
    }
    @Test public void accountResetReschedulesEvenWithTheSamePreferences() {
        ReminderUpdateGate gate = new ReminderUpdateGate(); Object snapshot = new Object();
        assertTrue(gate.changed(snapshot, 1)); gate.reset(); assertTrue(gate.changed(snapshot, 1));
    }
}
