// 应用骨架（通用 core）：所有生态时钟场景共享的运行时框架。
// 职责：环境检测、渲染器/场景/相机/控制、通用 HUD、时钟、主循环调度，
//       以及截图/ PWA / UI 一键隐藏等通用交互。
// 场景通过 createApp(loadScene) 注入 自己的初始化与每帧 update。

import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createRenderer } from './renderer.js';
import { createClock } from './clock.js';
import { APP_FEATURES, isMobile } from './config.js';

/**
 * 启动应用。
 * @param {Function} loadScene 注入场景工厂，签名 (ctx) → Promise<{ update(dt, t) }>
 */
export async function createApp(loadScene) {
  if (isMobile) document.body.classList.add('mobile'); // 供 CSS 判断（竖屏横屏提示等）

  // 壁纸模式：URL 带 ?wallpaper 时（如 Wallpaper Engine / Lively 填 localhost:5173/?wallpaper=1），
  // 启动即隐藏全部 UI（HUD/提示/面板/按钮），只留鱼缸+时钟；交互仍保留。
  const urlParams = new URLSearchParams(location.search);
  const isWallpaper = urlParams.has('wallpaper');
  if (isWallpaper) document.body.classList.add('wallpaper'); // 供 CSS 隐藏界面层

  // ---- HUD 元素引用 ----
  const apiEl = document.getElementById('api');
  const fpsEl = document.getElementById('fps');
  const resEl = document.getElementById('res');
  const modeEl = document.getElementById('mode');
  const stateEl = document.getElementById('state');

  // ---- 渲染器：WebGPU 优先，WebGL2 自动回退 ----
  const { THREE, renderer, api } = await createRenderer({
    preserveDrawingBuffer: APP_FEATURES.screenshot,
  });

  // 移动端像素密度限 1.5：GPU 像素填充量从 4x → 2.25x，省约 44% GPU 负载，
  // 5 英寸屏幕上人眼 1.5 与 2 的锐度差异几乎不可察觉。
  renderer.setPixelRatio(isMobile
    ? Math.min(window.devicePixelRatio, 1.5)
    : Math.min(window.devicePixelRatio, 2)
  );
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.getElementById('app').appendChild(renderer.domElement);

  // ---- 场景与相机（初始位由场景自行设定，见下方 ctx）----
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x081018);

  const camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    400
  );

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 15;
  controls.maxDistance = 220;
  controls.maxPolarAngle = 1.55;
  // 按键映射：右键旋转、中键平移、左键无操作、滚轮缩放
  controls.mouseButtons = {
    LEFT: null,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.ROTATE,
  };

  // ---- 场景上下文：核心把渲染环境交给场景，场景按需定位相机/控制 ----
  const ctx = {
    THREE, renderer, scene, camera, controls,
    isMobile, isWallpaper, urlParams,
    appEl: document.getElementById('app'),
    hud: { apiEl, resEl, fpsEl, modeEl, stateEl },
  };

  // ---- 数字时钟（通用 core）：生态时钟核心，每个场景默认带 ----
  let clockHandle = null;
  if (APP_FEATURES.clock) {
    clockHandle = createClock(scene, { THREE, isMobile, clockFace: APP_FEATURES.clockFace });
  }

  // ---- 加载场景（场景负责鱼缸/交互/自身每帧逻辑，可自行定位相机）----
  const sceneHandle = await loadScene(ctx);

  // ---- HUD 初始化 ----
  apiEl.textContent = api;
  const updateRes = () => { resEl.textContent = `${window.innerWidth}×${window.innerHeight}`; };
  updateRes();

  // ---- UI 一键隐藏（通用）：电脑按 H，手机点虚拟按钮；隐藏全部界面层 ----
  let uiHidden = false;
  function toggleUi() {
    uiHidden = !uiHidden;
    document.body.classList.toggle('ui-hidden', uiHidden);
  }
  if (APP_FEATURES.uiToggle) {
    document.getElementById('ui-toggle-btn')?.addEventListener('click', toggleUi);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'h' || e.key === 'H') toggleUi();
    });
  }

  // ---- 截图导出（通用）：按 P 保存当前画面为 PNG；移动端无键盘关闭 ----
  if (APP_FEATURES.screenshot && !isMobile) {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'p' || e.key === 'P') {
        const url = renderer.domElement.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url;
        a.download = `clock-scene-${Date.now()}.png`;
        a.click();
      }
    });
  }

  // ---- PWA（通用）：注册 Service Worker，首次在线缓存资源，之后离线运行 ----
  if (APP_FEATURES.pwa && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => { });
  }

  // ---- 窗口自适应 ----
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    updateRes();
  });

  // ---- 主循环 ----
  const timer = new THREE.Timer();
  let frames = 0;
  let lastFpsTime = performance.now();
  renderer.setAnimationLoop(() => {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05);
    const t = timer.getElapsed();

    // 数字时钟：秒数变化时重绘
    if (clockHandle) clockHandle.update();

    // 场景每帧逻辑（鱼群/生物/交互/相机等）
    sceneHandle.update(dt, t);

    renderer.render(scene, camera);

    // FPS 统计（500ms 窗口）
    frames++;
    const now = performance.now();
    if (now - lastFpsTime >= 500) {
      fpsEl.textContent = Math.round((frames * 1000) / (now - lastFpsTime));
      frames = 0;
      lastFpsTime = now;
    }
  });
}
