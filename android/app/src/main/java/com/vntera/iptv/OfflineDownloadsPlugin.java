package com.vntera.iptv;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.util.List;

/**
 * JS bridge for the offline downloader.
 *
 * The transfer itself belongs to {@link DownloadForegroundService}; this plugin
 * only reads and edits the shared queue, reports progress to the WebView, asks
 * for the notification permission on Android 13+, and hands the player a local
 * file path for a finished title.
 */
@CapacitorPlugin(
        name = "OfflineDownloads",
        permissions = {
                @Permission(
                        alias = "notifications",
                        strings = { Manifest.permission.POST_NOTIFICATIONS })
        })
public class OfflineDownloadsPlugin extends Plugin {

    private DownloadStore.Listener listener;
    private MainActivity.RouteListener routeListener;

    @Override
    public void load() {
        DownloadForegroundService.createChannels(getContext());
        listener = new DownloadStore.Listener() {
            @Override
            public void onJobsChanged(List<JSONObject> jobs) {
                JSObject payload = new JSObject();
                payload.put("jobs", toArray(jobs));
                notifyListeners("progress", payload);
            }

            @Override
            public void onFinished(String title, boolean ok) {
                JSObject payload = new JSObject();
                payload.put("title", title);
                payload.put("ok", ok);
                notifyListeners("finished", payload);
            }
        };
        DownloadStore.addListener(listener);
        routeListener = new MainActivity.RouteListener() {
            @Override
            public void onRoute(String route) {
                JSObject payload = new JSObject();
                payload.put("route", route);
                notifyListeners("openRoute", payload);
            }
        };
        MainActivity.addRouteListener(routeListener);
    }

    @Override
    protected void handleOnDestroy() {
        if (listener != null) DownloadStore.removeListener(listener);
        if (routeListener != null) MainActivity.removeRouteListener(routeListener);
        super.handleOnDestroy();
    }

    // ------------------------------------------------------------- queue

    @PluginMethod
    public void list(PluginCall call) {
        JSObject result = new JSObject();
        result.put("jobs", toArray(DownloadStore.list(getContext())));
        call.resolve(result);
    }

    @PluginMethod
    public void enqueue(PluginCall call) {
        JSObject job = call.getObject("job");
        if (job == null) {
            call.reject("A download needs a job");
            return;
        }
        try {
            JSONObject record = DownloadStore.fromJs(new JSONObject(job.toString()), getContext());
            if (record == null) {
                call.resolve(respondWith(DownloadStore.find(getContext(), job.getString("id"))));
                return;
            }
            DownloadStore.upsert(getContext(), record);
            DownloadForegroundService.kick(getContext(), record.optString("id"));
            call.resolve(respondWith(record));
        } catch (JSONException error) {
            call.reject("Could not add the download", error);
        }
    }

    @PluginMethod
    public void pause(PluginCall call) {
        final String id = call.getString("id");
        if (id == null) {
            call.reject("Missing download id");
            return;
        }
        DownloadStore.update(getContext(), id, new DownloadStore.JobWriter() {
            @Override
            public void apply(JSONObject row) throws JSONException {
                row.put("state", DownloadStore.STATE_PAUSED);
            }
        });
        DownloadForegroundService.park(getContext());
        call.resolve();
    }

    @PluginMethod
    public void resume(PluginCall call) {
        final String id = call.getString("id");
        if (id == null) {
            call.reject("Missing download id");
            return;
        }
        DownloadStore.update(getContext(), id, new DownloadStore.JobWriter() {
            @Override
            public void apply(JSONObject row) throws JSONException {
                row.put("state", DownloadStore.STATE_QUEUED);
                row.put("error", "");
                row.put("attempts", 0);
                row.put("nextAttemptAt", 0);
            }
        });
        DownloadForegroundService.kick(getContext(), id);
        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        removeJob(call, true);
    }

    @PluginMethod
    public void remove(PluginCall call) {
        removeJob(call, true);
    }

    private void removeJob(PluginCall call, boolean deleteFiles) {
        String id = call.getString("id");
        if (id == null) {
            call.reject("Missing download id");
            return;
        }
        JSONObject job = DownloadStore.find(getContext(), id);
        DownloadForegroundService.park(getContext());
        DownloadStore.remove(getContext(), id);
        if (deleteFiles && job != null) {
            try {
                File target = DownloadForegroundService.fileFor(getContext(), id, job.optString("url"));
                deleteQuietly(target);
                deleteQuietly(new File(target.getAbsolutePath() + ".part"));
                deleteQuietly(new File(target.getAbsolutePath() + ".buffer"));
                String path = job.optString("localPath", "");
                if (!path.isEmpty()) deleteQuietly(new File(path));
            } catch (RuntimeException ignored) {
                // The row is gone either way.
            }
        }
        call.resolve();
    }

    private static void deleteQuietly(File file) {
        try {
            if (file.exists() && !file.delete()) {
                // Best effort: the OS reclaims it with the app.
            }
        } catch (SecurityException ignored) {
            // Nothing else we can do.
        }
    }

    // ---------------------------------------------------------- playback

    @PluginMethod
    public void setPlayback(PluginCall call) {
        boolean active = Boolean.TRUE.equals(call.getBoolean("active", false));
        DownloadForegroundService.setPlayback(getContext(), active);
        if (!active) DownloadForegroundService.resumeQueue(getContext());
        call.resolve();
    }

    @PluginMethod
    public void play(PluginCall call) {
        String id = call.getString("id");
        JSONObject job = id == null ? null : DownloadStore.find(getContext(), id);
        if (job == null) {
            call.reject("That download is not on this device");
            return;
        }
        String path = job.optString("localPath", "");
        if (path.isEmpty() || !DownloadStore.STATE_COMPLETED.equals(job.optString("state"))) {
            call.reject("The download is not finished");
            return;
        }
        JSObject result = new JSObject();
        result.put("url", path);
        call.resolve(result);
    }

    // ------------------------------------------------------- permissions

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            resolveGranted(call);
            return;
        }
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) {
            resolveGranted(call);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsCallback");
    }

    @PermissionCallback
    private void notificationsCallback(PluginCall call) {
        // Denied is not an error: transfers still run, only the shade stays quiet.
        boolean granted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
        JSObject result = new JSObject();
        result.put("granted", granted);
        call.resolve(result);
    }

    private void resolveGranted(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", true);
        call.resolve(result);
    }

    @PluginMethod
    public void initialRoute(PluginCall call) {
        JSObject result = new JSObject();
        result.put("route", MainActivity.consumePendingRoute());
        call.resolve(result);
    }

    // ------------------------------------------------------------- helpers

    private JSObject respondWith(JSONObject job) {
        JSObject result = new JSObject();
        if (job != null) result.put("job", toJs(job));
        return result;
    }

    private static JSArray toArray(List<JSONObject> jobs) {
        JSArray array = new JSArray();
        for (JSONObject job : jobs) array.put(toJs(job));
        return array;
    }

    private static JSObject toJs(JSONObject job) {
        JSObject object = new JSObject();
        try {
            JSONArray names = job.names();
            if (names == null) return object;
            for (int i = 0; i < names.length(); i++) {
                String key = names.getString(i);
                object.put(key, job.get(key));
            }
        } catch (JSONException ignored) {
            // A malformed row should not take the bridge down.
        }
        return object;
    }
}
