package com.jeffdigital.jeffva;

import android.content.Context;
import android.os.Build;
import android.provider.Settings;

/** Small, system-aware transitions. Data reconciliation never replays a page reveal. */
final class WorkspaceMotion {
    private WorkspaceMotion() { }
    static boolean enabled(Context context) {
        if (Build.VERSION.SDK_INT >= 26) return android.animation.ValueAnimator.areAnimatorsEnabled();
        return Settings.Global.getFloat(context.getContentResolver(), Settings.Global.ANIMATOR_DURATION_SCALE, 1f) > 0f;
    }
}
