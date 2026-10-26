package com.groov.app;

import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Full-length songs without an API key: finds the song on YouTube Music,
 * downloads the audio (cached), and plays it with ExoPlayer.
 *
 * JS stays in charge of the queue and UI; this is just an engine. Events:
 * "state" {playing}, "progress" {position, duration}, "ended", "error" {message}.
 */
@CapacitorPlugin(name = "NativeAudio")
public class NativeAudioPlugin extends Plugin {

    private static final String TAG = "GroovNativeAudio";

    private final Handler main = new Handler(Looper.getMainLooper());
    /** Current song: one at a time; a newer play() cancels the older one. */
    private final ExecutorService loader = Executors.newSingleThreadExecutor();
    /** Next song in the queue, downloaded in the background. */
    private final ExecutorService prefetcher = Executors.newSingleThreadExecutor();
    private final AtomicInteger playToken = new AtomicInteger();

    private YouTubeAudio youtube;
    private ExoPlayer player; // main thread only

    private final Runnable progressTick = new Runnable() {
        @Override
        public void run() {
            if (player == null) return;
            emitProgress();
            if (player.isPlaying()) main.postDelayed(this, 500);
        }
    };

    @Override
    public void load() {
        youtube = new YouTubeAudio(getContext());
        main.post(this::createPlayer);
    }

    @Override
    protected void handleOnDestroy() {
        loader.shutdownNow();
        prefetcher.shutdownNow();
        main.post(() -> {
            if (player != null) {
                player.release();
                player = null;
            }
        });
    }

    private void createPlayer() {
        player = new ExoPlayer.Builder(getContext())
            .setAudioAttributes(
                new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
                true // ExoPlayer handles audio focus: pauses for calls and other apps
            )
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_LOCAL)
            .build();

        player.addListener(new Player.Listener() {
            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                JSObject data = new JSObject();
                data.put("playing", isPlaying);
                notifyListeners("state", data);
                emitProgress();
                if (isPlaying) {
                    main.removeCallbacks(progressTick);
                    main.post(progressTick);
                }
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_READY) emitProgress();
                if (state == Player.STATE_ENDED) notifyListeners("ended", new JSObject());
            }

            @Override
            public void onPlayerError(@NonNull PlaybackException error) {
                Log.w(TAG, "Playback error", error);
                JSObject data = new JSObject();
                data.put("message", error.getMessage());
                notifyListeners("error", data);
            }
        });
    }

    private void emitProgress() {
        if (player == null) return;
        long duration = player.getDuration();
        JSObject data = new JSObject();
        data.put("position", Math.max(0, player.getCurrentPosition()) / 1000.0);
        data.put("duration", duration == C.TIME_UNSET ? 0 : duration / 1000.0);
        notifyListeners("progress", data);
    }

    private static YouTubeAudio.Track trackFrom(PluginCall call) {
        Double duration = call.getDouble("durationMs", 0.0);
        return new YouTubeAudio.Track(
            call.getString("key", ""),
            call.getString("title", ""),
            call.getString("artist", ""),
            duration == null ? 0 : Math.round(duration)
        );
    }

    // --- JS API --------------------------------------------------------------------

    /** Resolves once the song starts, with {cancelled: true} if a newer play() won. */
    @PluginMethod
    public void play(PluginCall call) {
        YouTubeAudio.Track track = trackFrom(call);
        if (track.key.isEmpty() || track.title.isEmpty()) {
            call.reject("Missing track");
            return;
        }
        int token = playToken.incrementAndGet();
        main.post(() -> {
            if (player != null) player.stop(); // silence the old song right away
        });

        loader.execute(() -> {
            File file;
            try {
                file = youtube.fetch(track);
            } catch (Exception e) {
                Log.w(TAG, "Could not get " + track.title, e);
                if (token == playToken.get()) call.reject(YouTubeAudio.describe(e));
                else resolveCancelled(call);
                return;
            }
            main.post(() -> {
                if (token != playToken.get() || player == null) {
                    resolveCancelled(call);
                    return;
                }
                player.setMediaItem(MediaItem.fromUri(Uri.fromFile(file)));
                player.prepare();
                player.play();
                JSObject result = new JSObject();
                result.put("cancelled", false);
                call.resolve(result);
            });
        });
    }

    private static void resolveCancelled(PluginCall call) {
        JSObject result = new JSObject();
        result.put("cancelled", true);
        call.resolve(result);
    }

    /** Download the next song in the background so it starts instantly. */
    @PluginMethod
    public void prefetch(PluginCall call) {
        YouTubeAudio.Track track = trackFrom(call);
        call.resolve();
        if (track.key.isEmpty() || youtube.isCached(track)) return;
        prefetcher.execute(() -> {
            try {
                youtube.fetch(track);
            } catch (Exception e) {
                Log.i(TAG, "Prefetch failed for " + track.title + ": " + YouTubeAudio.describe(e));
            }
        });
    }

    @PluginMethod
    public void resume(PluginCall call) {
        main.post(() -> {
            if (player != null) player.play();
        });
        call.resolve();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        main.post(() -> {
            if (player != null) player.pause();
        });
        call.resolve();
    }

    @PluginMethod
    public void seek(PluginCall call) {
        Double position = call.getDouble("position", 0.0);
        long ms = Math.max(0, Math.round((position == null ? 0 : position) * 1000));
        main.post(() -> {
            if (player == null) return;
            player.seekTo(ms);
            emitProgress();
        });
        call.resolve();
    }

    /** Stop and forget the current song (switching to another engine). */
    @PluginMethod
    public void stop(PluginCall call) {
        playToken.incrementAndGet();
        main.post(() -> {
            if (player != null) {
                player.stop();
                player.clearMediaItems();
            }
        });
        call.resolve();
    }
}
