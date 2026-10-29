package com.jeffdigital.jeffva;

/** Navigation must not repeat encrypted storage/alarm work for the same state. */
final class ReminderUpdateGate {
    private Object snapshot;
    private int preferences;
    boolean changed(Object next, int settings) {
        if (snapshot == next && preferences == settings) return false;
        snapshot = next; preferences = settings; return true;
    }
    void reset() { snapshot = null; preferences = 0; }
}
