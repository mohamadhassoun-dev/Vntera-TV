package com.vntera.iptv;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * The offline download queue, shared by the foreground service and the WebView
 * plugin.
 *
 * It lives in SharedPreferences so a download that is running when the app is
 * closed is still there — and still running — when it comes back. Both sides
 * read the same records, which is why the Downloads page never shows stale
 * progress.
 */
public final class DownloadStore {

    private static final String TAG = "VnteraDownloads";
    private static final String PREFS = "vntera-downloads";
    private static final String KEY_JOBS = "jobs";

    public interface Listener {
        void onJobsChanged(List<JSONObject> jobs);
        void onFinished(String title, boolean ok);
    }

    public static final String STATE_QUEUED = "queued";
    public static final String STATE_DOWNLOADING = "downloading";
    public static final String STATE_PAUSED = "paused";
    public static final String STATE_COMPLETED = "completed";
    public static final String STATE_FAILED = "failed";

    private static final CopyOnWriteArrayList<Listener> LISTENERS = new CopyOnWriteArrayList<>();
    private static final Object LOCK = new Object();
    /** Playback has priority: the service parks the transfer while this is true. */
    private static volatile boolean playbackActive = false;

    private DownloadStore() {}

    public static void addListener(Listener listener) {
        if (!LISTENERS.contains(listener)) LISTENERS.add(listener);
    }

    public static void removeListener(Listener listener) {
        LISTENERS.remove(listener);
    }

    public static boolean isPlaybackActive() {
        return playbackActive;
    }

    public static void setPlaybackActive(boolean active) {
        playbackActive = active;
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static List<JSONObject> list(Context context) {
        synchronized (LOCK) {
            return read(context);
        }
    }

    private static List<JSONObject> read(Context context) {
        String raw = prefs(context).getString(KEY_JOBS, "[]");
        List<JSONObject> jobs = new ArrayList<>();
        try {
            JSONArray array = new JSONArray(raw);
            for (int i = 0; i < array.length(); i++) {
                JSONObject job = array.optJSONObject(i);
                if (job != null) jobs.add(job);
            }
        } catch (JSONException error) {
            Log.w(TAG, "Could not read the download queue", error);
        }
        Collections.sort(jobs, new Comparator<JSONObject>() {
            @Override
            public int compare(JSONObject a, JSONObject b) {
                return Long.compare(a.optLong("createdAt"), b.optLong("createdAt"));
            }
        });
        return jobs;
    }

    private static void write(Context context, List<JSONObject> jobs) {
        JSONArray array = new JSONArray();
        for (JSONObject job : jobs) array.put(job);
        prefs(context).edit().putString(KEY_JOBS, array.toString()).apply();
        List<JSONObject> copy = new ArrayList<>();
        for (JSONObject job : jobs) copy.add(copyOf(job));
        for (Listener listener : LISTENERS) {
            try {
                listener.onJobsChanged(copy);
            } catch (RuntimeException error) {
                Log.w(TAG, "Download listener failed", error);
            }
        }
    }

    private static JSONObject copyOf(JSONObject job) {
        try {
            return new JSONObject(job.toString());
        } catch (JSONException error) {
            return job;
        }
    }

    public static JSONObject find(Context context, String id) {
        for (JSONObject job : list(context)) {
            if (id.equals(job.optString("id"))) return job;
        }
        return null;
    }

    /** Same record the web queue uses, so both sides speak the same shape. */
    public static JSONObject fromJs(JSONObject input, Context context) throws JSONException {
        String id = input.getString("id");
        long now = System.currentTimeMillis();
        JSONObject job = new JSONObject();
        job.put("id", id);
        job.put("titleId", input.optLong("titleId"));
        job.put("kind", input.optString("kind", "movie"));
        job.put("streamId", input.optLong("streamId"));
        job.put("title", input.optString("title", "Untitled"));
        job.put("subtitle", input.optString("subtitle", ""));
        job.put("poster", input.optString("poster", ""));
        job.put("season", input.optInt("season", 0));
        job.put("episode", input.optInt("episode", 0));
        job.put("url", input.getString("url"));
        job.put("altUrl", input.optString("altUrl", ""));
        job.put("mime", input.optString("mime", "video/mp4"));
        job.put("state", STATE_QUEUED);
        job.put("bytesDone", 0);
        job.put("bytesTotal", 0);
        job.put("attempts", 0);
        job.put("createdAt", now);
        job.put("updatedAt", now);
        job.put("lookahead", input.optBoolean("lookahead", false));
        job.put("byteLimit", input.optLong("byteLimit", 0));
        job.put("localPath", "");
        if (find(context, id) != null) return null;
        return job;
    }

    public static void upsert(Context context, JSONObject job) {
        synchronized (LOCK) {
            List<JSONObject> jobs = read(context);
            boolean replaced = false;
            for (int i = 0; i < jobs.size(); i++) {
                if (jobs.get(i).optString("id").equals(job.optString("id"))) {
                    jobs.set(i, job);
                    replaced = true;
                    break;
                }
            }
            if (!replaced) jobs.add(job);
            write(context, jobs);
        }
        DownloadForegroundService.kick(context, job.optString("id"));
    }

    public static void update(Context context, String id, JobWriter writer) {
        synchronized (LOCK) {
            List<JSONObject> jobs = read(context);
            for (JSONObject job : jobs) {
                if (id.equals(job.optString("id"))) {
                    try {
                        writer.apply(job);
                        job.put("updatedAt", System.currentTimeMillis());
                    } catch (JSONException error) {
                        Log.w(TAG, "Could not update a download", error);
                    }
                    write(context, jobs);
                    return;
                }
            }
        }
    }

    public static void remove(Context context, String id) {
        synchronized (LOCK) {
            List<JSONObject> jobs = read(context);
            List<JSONObject> kept = new ArrayList<>();
            for (JSONObject job : jobs) {
                if (!id.equals(job.optString("id"))) kept.add(job);
            }
            write(context, kept);
        }
    }

    /** The next transfer the service may run, honouring playback priority. */
    public static JSONObject nextRunnable(Context context) {
        if (playbackActive) return null;
        long now = System.currentTimeMillis();
        for (JSONObject job : list(context)) {
            String state = job.optString("state");
            if (job.optLong("nextAttemptAt", 0) > now) continue;
            if (STATE_QUEUED.equals(state) || STATE_DOWNLOADING.equals(state)) return job;
        }
        return null;
    }

    /** True when work is waiting only because of a retry backoff. */
    public static boolean hasBackoff(Context context) {
        long now = System.currentTimeMillis();
        for (JSONObject job : list(context)) {
            String state = job.optString("state");
            if (STATE_QUEUED.equals(state) && job.optLong("nextAttemptAt", 0) > now) return true;
        }
        return false;
    }

    static void broadcast(Context context) {
        List<JSONObject> jobs = list(context);
        for (Listener listener : LISTENERS) {
            try {
                listener.onJobsChanged(jobs);
            } catch (RuntimeException error) {
                Log.w(TAG, "Download listener failed", error);
            }
        }
    }

    public static boolean hasUnfinished(Context context) {
        for (JSONObject job : list(context)) {
            String state = job.optString("state");
            if (!STATE_COMPLETED.equals(state) && !STATE_FAILED.equals(state)) return true;
        }
        return false;
    }

    public static void notifyFinished(String title, boolean ok) {
        for (Listener listener : LISTENERS) {
            try {
                listener.onFinished(title, ok);
            } catch (RuntimeException error) {
                Log.w(TAG, "Download listener failed", error);
            }
        }
    }

    public interface JobWriter {
        void apply(JSONObject job) throws JSONException;
    }


}
