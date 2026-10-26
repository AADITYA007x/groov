package com.groov.app;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before the bridge is created.
        registerPlugin(MediaControlsPlugin.class);
        registerPlugin(NativeAudioPlugin.class);
        super.onCreate(savedInstanceState);

        // Back button: let the app go back one step (close Now Playing, leave a
        // playlist, clear a search…). Only at the home screen, minimize the app
        // instead of closing it, so the music keeps playing.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = bridge != null ? bridge.getWebView() : null;
                if (webView == null) {
                    moveTaskToBack(true);
                    return;
                }
                webView.evaluateJavascript(
                    "(window.groovBack && window.groovBack()) ? 'handled' : 'root'",
                    result -> {
                        if (!"\"handled\"".equals(result)) moveTaskToBack(true);
                    }
                );
            }
        });
    }
}
