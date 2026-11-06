package com.vntera.iptv;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Phone shell behaviour.
 *
 * Handsets come in every shape, and the phone's own status bar and navigation
 * bar used to eat the top and bottom of the picture. The activity therefore
 * runs edge to edge with the system bars hidden — a swipe from either edge
 * brings them back for a moment — so the app owns the whole screen the way a
 * film app should.
 *
 * The system back gesture/button walks the web history one step at a time, and
 * only leaves the app when there is nowhere left to go inside it.
 *
 * A tap on a download notification is also handled here: its `route` extra is
 * handed to the web app, so the shade opens the Downloads page rather than the
 * home screen.
 */
public class MainActivity extends BridgeActivity {

    public interface RouteListener {
        void onRoute(String route);
    }

    private static final CopyOnWriteArrayList<RouteListener> ROUTE_LISTENERS = new CopyOnWriteArrayList<>();
    private static volatile String pendingRoute = null;

    public static void addRouteListener(RouteListener listener) {
        if (!ROUTE_LISTENERS.contains(listener)) ROUTE_LISTENERS.add(listener);
    }

    public static void removeRouteListener(RouteListener listener) {
        ROUTE_LISTENERS.remove(listener);
    }

    /** Read once by the plugin when the web app boots. */
    public static String consumePendingRoute() {
        String route = pendingRoute;
        pendingRoute = null;
        return route;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OfflineDownloadsPlugin.class);
        super.onCreate(savedInstanceState);
        DownloadForegroundService.createChannels(this);
        applyImmersiveMode();
        handleRoute(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleRoute(intent);
    }

    private void handleRoute(Intent intent) {
        if (intent == null) return;
        String route = intent.getStringExtra("route");
        if (route == null || route.isEmpty()) return;
        intent.removeExtra("route");
        pendingRoute = route;
        for (RouteListener listener : ROUTE_LISTENERS) {
            listener.onRoute(route);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Taking a call or opening the keyboard can bring the bars back, so the
        // full-screen state is re-applied whenever the app regains focus.
        if (hasFocus) {
            applyImmersiveMode();
        }
    }

    private void applyImmersiveMode() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }

    @Override
    public void onBackPressed() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }
}
