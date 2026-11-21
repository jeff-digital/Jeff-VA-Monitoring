package com.jeffdigital.jeffva;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;

/** Observes Android's validated internet connection; never polls or rebuilds screens. */
final class WorkspaceConnectivity {
    private final ConnectivityManager manager;
    private final Runnable changed;
    private boolean registered;
    private final ConnectivityManager.NetworkCallback callback = new ConnectivityManager.NetworkCallback() {
        @Override public void onAvailable(Network network) { changed.run(); }
        @Override public void onLost(Network network) { changed.run(); }
        @Override public void onCapabilitiesChanged(Network network, NetworkCapabilities capabilities) { changed.run(); }
    };
    WorkspaceConnectivity(Context context, Runnable changed) {
        manager = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        this.changed = changed;
    }
    boolean available() {
        NetworkCapabilities capabilities = manager == null ? null : manager.getNetworkCapabilities(manager.getActiveNetwork());
        return capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
    }
    void start() {
        if (manager != null && !registered) { manager.registerDefaultNetworkCallback(callback); registered = true; }
    }
    void stop() {
        if (manager != null && registered) { manager.unregisterNetworkCallback(callback); registered = false; }
    }
}
