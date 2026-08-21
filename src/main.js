// 应用入口（薄）：读取 ?scene= 选择场景模块，交给通用框架 core/app.js 启动。
// 场景注册表：新增生态时钟场景时，在此登记即可通过 ?scene=xxx 访问。
import { createApp } from './core/app.js';
import { createFishTankScene } from './scenes/fish-tank/scene.js';

// 场景注册表：key → 场景工厂（(ctx) => Promise<{ update(dt, t) }>）
const registry = {
  'fish-tank': createFishTankScene,
  // 未来：'zoo': createZooScene, 'anthill': createAnthillScene, ...
};

// 移动端横屏处理：首次触摸尝试锁定横屏（Android 全屏可用，iOS 静默失败）；
// 提供"竖屏继续"按钮，避免用户被提示遮罩卡住。
const isMobile = !!window.Capacitor
  || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
if (isMobile) {
  const tryLockLandscape = () => {
    try {
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => { });
      }
    } catch (e) { /* 不支持则忽略 */ }
  };
  window.addEventListener('pointerdown', tryLockLandscape, { once: true });
  document.getElementById('continue-portrait')?.addEventListener('click', () => {
    document.getElementById('rotate-hint').style.display = 'none';
  });
}

// 选择场景：默认 fish-tank；未知场景回退到 fish-tank。
const urlParams = new URLSearchParams(location.search);
const sceneName = urlParams.get('scene') || 'fish-tank';
const factory = registry[sceneName] || createFishTankScene;

createApp(factory);
