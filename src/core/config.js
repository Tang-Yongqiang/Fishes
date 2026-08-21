// 通用配置（core）：所有生态时钟场景共享的应用级开关与环境检测。
// 场景专属配置见各 scenes/<scene>/config.js（如 scenes/fish-tank/config.js）。

// 移动端检测（与入口 main.js 一致）：手机/平板仅做展示分级。
// 1) Capacitor 打包的 APK 内 window.Capacitor 必然存在 → 强制移动端（避免 WebView UA 差异）；
// 2) UA 匹配兜底。不用触摸点/宽度启发式（避免触摸屏笔记本+窄窗口误判）。
export const isMobile = (typeof window !== 'undefined') && (
    !!window.Capacitor || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator?.userAgent || '')
);

// 应用级特性开关（通用，跨场景一致）：由 core 框架读取，所有场景复用。
export const APP_FEATURES = {
    screenshot: true,    // 截图导出（按 P 保存当前画面为 PNG；移动端无键盘关闭）
    clock: true,         // 数字时钟：生态时钟核心，必须保留
    clockFace: 'fixed',  // 时钟朝向：'camera'(billboard 始终面向镜头) | 'fixed'(立体盒，正反双面钟面)
    pwa: true,           // PWA：离线缓存
    uiToggle: true,      // UI 一键隐藏：电脑按 H，手机点虚拟按钮
};
