// 数字时钟（通用 core）：生态时钟的核心视觉 —— 鱼缸中心悬浮时钟。
// 每个场景默认都带上它，保证"生态时钟"产品心智一致。
// 说明：本实现与鱼缸场景解耦，只依赖 scene + 渲染后端 THREE。

// 时钟内部状态（单个闭包共享）
const clockState = {
  ctx: null,          // 正面钟面 2D context
  tex: null,          // 正面钟面 CanvasTexture
  backCtx: null,      // 背面镜像钟面 2D context（立体时钟用）
  backTex: null,      // 背面钟面 CanvasTexture
  lastClockSec: -1,   // 上一帧秒数（秒变化才重绘）
  canvas: null,       // 正面钟面 canvas（背面 drawImage 复用）
};

const CW = 1024; // 钟面纹理宽
const CH = 360;  // 钟面纹理高

/**
 * 重绘钟面（正面 + 背面镜像）。
 * @param {Date} now
 */
function drawClock(now) {
  const c = clockState.ctx;
  if (!c) return;
  c.clearRect(0, 0, CW, CH);
  // 半透明圆角底板（留足内边距，确保数字+发光完全在框内）
  c.fillStyle = 'rgba(4, 14, 24, 0.5)';
  c.beginPath();
  c.roundRect(24, 24, CW - 48, CH - 48, 48);
  c.fill();
  c.strokeStyle = 'rgba(127, 232, 255, 0.3)';
  c.lineWidth = 6;
  c.stroke();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  // 固定每字符位置布局（d0 d1 : d2 d3 : d4 d5），数字等宽(tabular-nums)：
  // 不同数字组合总宽恒定，时钟整体永不偏移
  const chars = [hh[0], hh[1], ':', mm[0], mm[1], ':', ss[0], ss[1]];
  const cellW = [130, 130, 40, 130, 130, 40, 130, 130]; // 数字格 130、冒号格 40
  const totalW = cellW.reduce((a, b) => a + b, 0);       // 860
  c.fillStyle = '#9fe8ff';
  c.font = '900 200px "Roboto", "Droid Sans", "Noto Sans", "Segoe UI", "Arial", sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fontVariantNumeric = 'tabular-nums'; // 数字等宽：窄数字(1)不压缩格宽
  // 细描边 + 弱发光：小屏上数字轮廓锐利可读，泛光不再发虚
  c.shadowColor = 'rgba(120, 225, 255, 0.45)';
  c.shadowBlur = 12;
  c.lineJoin = 'round';
  c.lineWidth = 5;
  c.strokeStyle = 'rgba(4, 18, 30, 0.9)';
  let cx = (CW - totalW) / 2;
  for (let i = 0; i < 8; i++) {
    c.strokeText(chars[i], cx + cellW[i] / 2, CH / 2);
    c.fillText(chars[i], cx + cellW[i] / 2, CH / 2);
    cx += cellW[i];
  }
  c.shadowBlur = 0;
  c.shadowColor = 'transparent';
  clockState.tex.needsUpdate = true;
  // 同步背面镜像：水平翻转绘制，使从背面看数字也为正立可读
  if (clockState.backCtx) {
    const bc = clockState.backCtx;
    bc.clearRect(0, 0, CW, CH);
    bc.save();
    bc.translate(CW, 0);
    bc.scale(-1, 1);
    bc.drawImage(clockState.canvas, 0, 0);
    bc.restore();
    clockState.backTex.needsUpdate = true;
  }
}

/**
 * 创建时钟对象并加入场景。
 * @param {THREE.Scene} scene
 * @param {{ THREE, isMobile: boolean, clockFace: string }} opts
 *   clockFace 'camera'(billboard 始终面向镜头) 或 'fixed'(立体盒，正反双面钟面)
 * @returns {{ update: () => void }} update 每帧调用，秒变化时重绘
 */
export function createClock(scene, { THREE, isMobile = false, clockFace = 'fixed' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = CW; // 高清纹理：放大到屏幕仍锐利
  canvas.height = CH;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8; // 各向异性过滤：任何视角下都保持锐利

  // 时钟大小：移动端放大到接近缸内尺寸（宽 68），整缸即表盘，鱼在其前后穿游
  const CLOCK_W = isMobile ? 68 : 56;
  const CLOCK_H = CLOCK_W * (CH / CW); // 保持纹理宽高比（1024:360）
  const depthMat = { transparent: true, depthWrite: false }; // depthTest 默认开（景深）

  clockState.canvas = canvas;
  clockState.ctx = ctx;
  clockState.tex = tex;
  clockState.backCtx = null;
  clockState.backTex = null;
  clockState.lastClockSec = -1;

  if (clockFace === 'camera') {
    // 始终面对镜头（billboard）
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, ...depthMat }));
    sprite.scale.set(CLOCK_W, CLOCK_H, 1);
    sprite.position.set(0, 13, 0);
    scene.add(sprite);
  } else {
    // 立体时钟：Box 带厚度，任何视角（含从缸顶俯视）都能看到；
    // 前后各贴独立钟面（FrontSide 不背透），背面用镜像纹理——正反两面看数字都是正的，且互不重叠
    const boxGeo = new THREE.BoxGeometry(CLOCK_W, CLOCK_H, 2.0);
    const sideMat = new THREE.MeshStandardMaterial({
      color: 0x0d2233, roughness: 0.5, metalness: 0.1,
      transparent: true, opacity: 0.55,
    });
    // 正面钟面（面向 +Z）
    const faceMat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, side: THREE.FrontSide,
    });
    // 背面钟面（面向 -Z，纹理水平镜像 → 从背面看数字正立）
    const backCanvas = document.createElement('canvas');
    backCanvas.width = CW;
    backCanvas.height = CH;
    clockState.backCtx = backCanvas.getContext('2d');
    clockState.backTex = new THREE.CanvasTexture(backCanvas);
    const faceMatBack = new THREE.MeshBasicMaterial({
      map: clockState.backTex, transparent: true, depthWrite: false, side: THREE.FrontSide,
    });
    const clockBox = new THREE.Mesh(
      boxGeo,
      // 顺序：px nx py ny pz(正面钟面) nz(背面镜像钟面)
      [sideMat, sideMat, sideMat, sideMat, faceMat, faceMatBack]
    );
    clockBox.position.set(0, 13, 0);
    scene.add(clockBox);
  }

  drawClock(new Date());

  return {
    /** 每帧调用，秒数变化时重绘钟面 */
    update() {
      const now = new Date();
      if (now.getSeconds() !== clockState.lastClockSec) {
        clockState.lastClockSec = now.getSeconds();
        drawClock(now);
      }
    },
  };
}
