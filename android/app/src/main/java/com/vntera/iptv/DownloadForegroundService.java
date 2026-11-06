package com.vntera.iptv;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Real Android download service for offline titles.
 *
 * It runs in the foreground with a progress notification, so transfers continue
 * while the app is backgrounded or the screen is off. The queue is persisted in
 * SharedPreferences, the bytes land in the app's own Movies folder, and playback
 * always wins: while a video plays the loop parks itself and the connection is
 * dropped, then the transfer resumes from the last byte when playback stops.
 */
public class DownloadForegroundService extends Service {

    private static final String TAG = "VnteraDownloadService";
    private static final String CHANNEL_PROGRESS = "vntera-downloads";
    private static final String CHANNEL_EVENTS = "vntera-download-events";
    private static final int NOTIFICATION_PROGRESS = 4101;
    private static final int NOTIFICATION_EVENT_BASE = 4200;
    private static final long RETRY_DELAY_MS = 5_000L;

    private static final String ACTION_KICK = "com.vntera.iptv.DOWNLOAD_KICK";
    private static final String ACTION_PLAYBACK = "com.vntera.iptv.DOWNLOAD_PLAYBACK";
    private static final String EXTRA_ACTIVE = "active";

    private volatile boolean stopped = false;
    private Thread worker;
    private PowerManager.WakeLock wakeLock;
    private final Handler retryHandler = new Handler(Looper.getMainLooper());

    // ------------------------------------------------------------ entry points

    public static void kick(Context context, String jobId) {
        Intent intent = new Intent(context, DownloadForegroundService.class);
        intent.setAction(ACTION_KICK);
        intent.putExtra("jobId", jobId);
        start(context, intent);
    }

    public static void setPlayback(Context context, boolean active) {
        DownloadStore.setPlaybackActive(active);
        Intent intent = new Intent(context, DownloadForegroundService.class);
        intent.setAction(ACTION_PLAYBACK);
        intent.putExtra(EXTRA_ACTIVE, active);
        start(context, intent);
    }

    /** Bring the service back after playback ends, if work is waiting. */
    public static void resumeQueue(Context context) {
        if (DownloadStore.hasUnfinished(context)) kick(context, "");
    }

    /** Stop the transfer on the wire but keep the queue (pause / cancel). */
    public static void park(Context context) {
        try {
            context.stopService(new Intent(context, DownloadForegroundService.class));
        } catch (RuntimeException error) {
            Log.w(TAG, "Could not park the download service", error);
        }
    }

    private static void start(Context context, Intent intent) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (RuntimeException error) {
            Log.w(TAG, "Could not start the download service", error);
        }
    }

    // ------------------------------------------------------------- lifecycle

    @Override
    public void onCreate() {
        super.onCreate();
        createChannels(this);
        PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (power != null) {
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "vntera:downloads");
            wakeLock.setReferenceCounted(false);
        }
        startForegroundSafely(buildProgressNotification(this, "Preparing downloads", 0, 0, true));
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        if (intent != null && ACTION_PLAYBACK.equals(intent.getAction())) {
            boolean active = intent.getBooleanExtra(EXTRA_ACTIVE, false);
            DownloadStore.setPlaybackActive(active);
            if (active) {
                // Drop the connection on the wire right away: playback needs it.
                stopWorker();
                stopForegroundSafely(true);
                stopSelf();
            } else {
                ensureWorker();
            }
            return START_STICKY;
        }
        ensureWorker();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopped = true;
        retryHandler.removeCallbacksAndMessages(null);
        stopWorker();
        releaseWakeLock();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ---------------------------------------------------------------- worker

    private synchronized void ensureWorker() {
        if (worker != null && worker.isAlive()) return;
        stopped = false;
        worker = new Thread(new Runnable() {
            @Override
            public void run() {
                loop();
            }
        }, "vntera-downloads");
        worker.start();
    }

    private void stopWorker() {
        stopped = true;
        Thread current = worker;
        worker = null;
        if (current != null) current.interrupt();
    }

    private void loop() {
        try {
            while (!stopped && !DownloadStore.isPlaybackActive()) {
                JSONObject job = DownloadStore.nextRunnable(this);
                if (job == null) break;
                transfer(job);
            }
        } catch (RuntimeException error) {
            Log.w(TAG, "Download loop stopped", error);
        } finally {
            releaseWakeLock();
            boolean unfinished = DownloadStore.hasUnfinished(this);
            if (unfinished && !DownloadStore.isPlaybackActive()) {
                // Keeps the foreground notification honest while a retry waits.
                retryHandler.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        if (!DownloadStore.isPlaybackActive()) ensureWorker();
                    }
                }, RETRY_DELAY_MS);
            } else {
                stopForegroundSafely(true);
                stopSelf();
            }
        }
    }

    private void transfer(JSONObject job) {
        final String id = job.optString("id");
        final String title = job.optString("title", "Download");
        final String subtitle = job.optString("subtitle", "");
        String url = job.optString("url");
        final long byteLimit = job.optLong("byteLimit", 0);
        File target = fileFor(this, id, url);
        File part = new File(target.getAbsolutePath() + ".part");
        long already = part.exists() ? Math.min(job.optLong("bytesDone", 0), part.length()) : 0;
        long total = job.optLong("bytesTotal", 0);
        final long resumeFrom = already;

        if (already == 0) {
            try {
                File parent = part.getParentFile();
                if (parent != null && !parent.exists()) parent.mkdirs();
                if (part.exists() && !part.delete()) Log.w(TAG, "Could not clear the partial file");
                if (target.exists() && !target.delete()) Log.w(TAG, "Could not clear the old file");
            } catch (RuntimeException error) {
                Log.w(TAG, "Could not prepare the download folder", error);
            }
        }

        DownloadStore.update(this, id, new DownloadStore.JobWriter() {
            @Override
            public void apply(JSONObject row) throws JSONException {
                row.put("state", DownloadStore.STATE_DOWNLOADING);
                row.put("error", "");
                row.put("bytesDone", resumeFrom);
            }
        });
        updateProgressNotification(title, already, total);
        DownloadStore.broadcast(this);

        HttpURLConnection connection = null;
        InputStream input = null;
        FileOutputStream output = null;
        acquireWakeLock();
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(30_000);
            connection.setReadTimeout(30_000);
            connection.setRequestProperty("User-Agent", "Vntera-Android");
            if (already > 0) connection.setRequestProperty("Range", "bytes=" + already + "-");

            int status = connection.getResponseCode();
            if (status >= 400) throw new IOException("Server answered " + status);
            if (status != 206 && already > 0) {
                // The server ignored the Range header: this file starts again.
                already = 0;
                if (part.exists() && !part.delete()) Log.w(TAG, "Could not restart the file");
            }
            long length = connection.getContentLengthLong();
            total = length > 0 ? already + length : 0;
            final long totalBytes = total;
            final long startAt = already;
            DownloadStore.update(this, id, new DownloadStore.JobWriter() {
                @Override
                public void apply(JSONObject row) throws JSONException {
                    row.put("bytesTotal", totalBytes);
                    row.put("bytesDone", startAt);
                }
            });

            input = connection.getInputStream();
            output = new FileOutputStream(part, already > 0);
            byte[] buffer = new byte[64 * 1024];
            long done = already;
            long lastNotify = 0;
            long lastSave = System.currentTimeMillis();
            int read;
            while ((read = input.read(buffer)) > 0) {
                if (stopped || DownloadStore.isPlaybackActive()) {
                    output.flush();
                    saveProgress(id, part.length(), total, DownloadStore.STATE_QUEUED);
                    return;
                }
                output.write(buffer, 0, read);
                done += read;
                if (byteLimit > 0 && done >= byteLimit) break;
                long now = System.currentTimeMillis();
                if (now - lastNotify > 500) {
                    lastNotify = now;
                    updateProgressNotification(title, done, total);
                }
                if (now - lastSave > 2_000) {
                    lastSave = now;
                    saveProgress(id, part.length(), total, DownloadStore.STATE_DOWNLOADING);
                }
            }
            output.flush();
            output.close();
            output = null;

            File destination = byteLimit > 0 && (total <= 0 || part.length() < total)
                    ? new File(target.getAbsolutePath() + ".buffer")
                    : target;
            if (destination.exists() && !destination.delete()) Log.w(TAG, "Could not replace the old file");
            if (!part.renameTo(destination)) throw new IOException("Could not keep the downloaded file");

            final String path = destination.getAbsolutePath();
            final long size = destination.length();
            DownloadStore.update(this, id, new DownloadStore.JobWriter() {
                @Override
                public void apply(JSONObject row) throws JSONException {
                    row.put("state", DownloadStore.STATE_COMPLETED);
                    row.put("bytesDone", size);
                    row.put("bytesTotal", size);
                    row.put("localPath", path);
                    row.put("attempts", 0);
                    row.put("error", "");
                    row.put("nextAttemptAt", 0);
                    row.put("completedAt", System.currentTimeMillis());
                }
            });
            DownloadStore.broadcast(this);
            if (byteLimit <= 0) {
                notifyComplete(this, title, subtitle, id);
                DownloadStore.notifyFinished(title, true);
            }
        } catch (IOException error) {
            Log.w(TAG, "Download failed: " + title, error);
            saveProgress(id, part.length(), total, DownloadStore.STATE_QUEUED);
            final String reason = error.getMessage() == null ? "Download failed" : error.getMessage();
            final boolean[] failed = new boolean[] { false };
            DownloadStore.update(this, id, new DownloadStore.JobWriter() {
                @Override
                public void apply(JSONObject row) throws JSONException {
                    int attempts = row.optInt("attempts", 0) + 1;
                    row.put("attempts", attempts);
                    row.put("error", reason);
                    if (attempts >= 3) {
                        row.put("state", DownloadStore.STATE_FAILED);
                        row.put("nextAttemptAt", 0);
                        failed[0] = true;
                    } else {
                        row.put("state", DownloadStore.STATE_QUEUED);
                        row.put("nextAttemptAt", System.currentTimeMillis() + RETRY_DELAY_MS * attempts);
                    }
                }
            });
            DownloadStore.broadcast(this);
            if (failed[0]) {
                notifyFailed(this, title, reason);
                DownloadStore.notifyFinished(title, false);
            }
        } finally {
            releaseWakeLock();
            if (output != null) {
                try {
                    output.close();
                } catch (IOException ignored) {
                    // The stream is already gone.
                }
            }
            if (input != null) {
                try {
                    input.close();
                } catch (IOException ignored) {
                    // Nothing to do.
                }
            }
            if (connection != null) connection.disconnect();
        }
    }

    private void saveProgress(final String id, final long done, final long total, final String state) {
        DownloadStore.update(this, id, new DownloadStore.JobWriter() {
            @Override
            public void apply(JSONObject row) throws JSONException {
                row.put("bytesDone", done);
                if (total > 0) row.put("bytesTotal", total);
                row.put("state", state);
            }
        });
        DownloadStore.broadcast(this);
    }

    // -------------------------------------------------------------- storage

    /** App-specific external storage: real files, no storage permission. */
    public static File fileFor(Context context, String id, String url) {
        File base = context.getExternalFilesDir(Environment.DIRECTORY_MOVIES);
        if (base == null) base = new File(context.getFilesDir(), "Movies");
        if (!base.exists()) base.mkdirs();
        String extension = "mp4";
        int dot = url.lastIndexOf('.');
        if (dot > 0 && dot > url.lastIndexOf('/')) {
            String candidate = url.substring(dot + 1);
            if (candidate.length() <= 5 && candidate.matches("[A-Za-z0-9]+")) extension = candidate;
        }
        String safe = id.replaceAll("[^A-Za-z0-9._-]", "_");
        return new File(base, safe + "." + extension);
    }

    // --------------------------------------------------------- notifications

    public static void createChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel progress = new NotificationChannel(
                CHANNEL_PROGRESS, "Downloads", NotificationManager.IMPORTANCE_LOW);
        progress.setDescription("Progress of movies and episodes saved for offline");
        progress.setShowBadge(false);
        manager.createNotificationChannel(progress);

        NotificationChannel events = new NotificationChannel(
                CHANNEL_EVENTS, "Download finished", NotificationManager.IMPORTANCE_DEFAULT);
        events.setDescription("Alerts when a download completes or fails");
        manager.createNotificationChannel(events);
    }

    private Notification buildProgressNotification(Context context, String title, long done, long total, boolean indeterminate) {
        int percent = total > 0 ? (int) Math.min(100, (done * 100) / total) : 0;
        return new NotificationCompat.Builder(context, CHANNEL_PROGRESS)
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentTitle(title)
                .setContentText(total > 0 ? percent + "% downloaded" : "Downloading…")
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setProgress(indeterminate ? 0 : 100, percent, indeterminate)
                .setContentIntent(openDownloads(context, "downloads-progress"))
                .build();
    }

    private void startForegroundSafely(Notification notification) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_PROGRESS, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(NOTIFICATION_PROGRESS, notification);
            }
        } catch (RuntimeException error) {
            Log.w(TAG, "Could not enter the foreground", error);
        }
    }

    private void stopForegroundSafely(boolean removeNotification) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(removeNotification ? STOP_FOREGROUND_REMOVE : STOP_FOREGROUND_DETACH);
            } else {
                stopForeground(removeNotification);
            }
        } catch (RuntimeException error) {
            Log.w(TAG, "Could not leave the foreground", error);
        }
    }

    private void updateProgressNotification(String title, long done, long total) {
        try {
            NotificationManagerCompat.from(this).notify(
                    NOTIFICATION_PROGRESS, buildProgressNotification(this, title, done, total, total <= 0));
        } catch (SecurityException error) {
            // Notifications denied: the transfer keeps going regardless.
        }
    }

    public static void notifyComplete(Context context, String title, String subtitle, String id) {
        String line = subtitle == null || subtitle.isEmpty() ? "Saved for offline" : subtitle + " · saved for offline";
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_EVENTS)
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle("Download ready")
                .setSubText(title)
                .setContentText(line)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(title + " · " + line))
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(openDownloads(context, id));
        post(context, builder, id);
    }

    public static void notifyFailed(Context context, String title, String reason) {
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_EVENTS)
                .setSmallIcon(android.R.drawable.stat_notify_error)
                .setContentTitle("Download failed")
                .setSubText(title)
                .setContentText(reason == null || reason.isEmpty() ? "The download could not finish" : reason)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(title + " · " + (reason == null ? "" : reason)))
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(openDownloads(context, title));
        post(context, builder, title);
    }

    private static void post(Context context, NotificationCompat.Builder builder, String tag) {
        int id = NOTIFICATION_EVENT_BASE + Math.abs(tag.hashCode() % 500);
        try {
            NotificationManagerCompat.from(context).notify(id, builder.build());
        } catch (SecurityException error) {
            // The user denied POST_NOTIFICATIONS; the download itself is fine.
        }
    }

    private static PendingIntent openDownloads(Context context, String tag) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction(Intent.ACTION_VIEW);
        intent.setData(Uri.parse("vntera://downloads/" + Math.abs(tag.hashCode())));
        intent.putExtra("route", "/downloads");
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(context, Math.abs(tag.hashCode() % 1000), intent, flags);
    }

    private void acquireWakeLock() {
        try {
            if (wakeLock != null && !wakeLock.isHeld()) wakeLock.acquire(60 * 60 * 1000L);
        } catch (RuntimeException error) {
            Log.w(TAG, "Could not hold the wake lock", error);
        }
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (RuntimeException error) {
            Log.w(TAG, "Could not release the wake lock", error);
        }
    }
}
