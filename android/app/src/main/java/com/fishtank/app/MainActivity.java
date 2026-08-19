package com.fishtank.app;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        enterImmersiveFullscreen();
    }

    /**
     * 沉浸式全屏（类似游戏）：隐藏状态栏与导航栏，用户从屏幕边缘滑动可临时唤出。
     * API 30+ 用 WindowInsetsController；旧版本用 SYSTEM_UI_FLAG（IMMERSIVE_STICKY）。
     */
    private void enterImmersiveFullscreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                // 边缘滑动仅临时显示，超时自动隐藏，保持沉浸
                controller.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            final int flags = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
            getWindow().getDecorView().setSystemUiVisibility(flags);
            // 焦点恢复时重新隐藏（旧 API 下系统栏可能被重新显示）
            getWindow().getDecorView().setOnSystemUiVisibilityChangeListener(
                    visibility -> {
                        if ((visibility & View.SYSTEM_UI_FLAG_FULLSCREEN) == 0) {
                            getWindow().getDecorView().setSystemUiVisibility(flags);
                        }
                    });
        }
    }
}