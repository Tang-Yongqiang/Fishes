import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import modelUrl from '../models/XH378sJqtgOHKGAXMdeNF.stl?url';
import { FEATURES, PARAMS, WORLD } from './config.js';
import { createFish, loadFishModel, randomPoint, updateFish } from './fish.js';
import { buildTank, TANK } from './tank.js';

// 移动端检测：手机/平板仅做展示（降低渲染压力、关闭依赖键盘/点击的交互）
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
if (isMobile) document.body.classList.add('mobile'); // 供 CSS 判断（竖屏横屏提示等）

// 移动端横屏处理：首次触摸尝试锁定横屏（Android 全屏可用，iOS 静默失败）；
// 提供"竖屏继续"按钮，避免用户被提示遮罩卡住
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

const appEl = document.getElementById('app');
const apiEl = document.getElementById('api');
const fpsEl = document.getElementById('fps');
const resEl = document.getElementById('res');
const modeEl = document.getElementById('mode');
const stateEl = document.getElementById('state');

// ---- 渲染器：WebGPU 优先，WebGL2 自动回退 ----
let THREE;
let renderer;
let api = 'WebGL2';

try {
  THREE = await import('three/webgpu');
  renderer = new THREE.WebGPURenderer({ antialias: true, preserveDrawingBuffer: FEATURES.screenshot });
  await renderer.init();
  api = 'WebGPU';
} catch (e) {
  console.warn('[鱼缸] WebGPU 不可用，回退到 WebGL2：', e);
  THREE = await import('three');
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: FEATURES.screenshot,
  });
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
appEl.appendChild(renderer.domElement);

// ---- 场景 ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x081018);

// ---- 相机与控制 ----
const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  0.1,
  400
);
camera.position.set(0, 22, 110);
camera.lookAt(0, 10, 0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(0, 10, 0);
controls.minDistance = 15;
controls.maxDistance = 220;
controls.maxPolarAngle = 1.55;
// 按键映射：右键旋转、中键平移、左键无操作、滚轮缩放
controls.mouseButtons = {
  LEFT: null,
  MIDDLE: THREE.MOUSE.PAN,
  RIGHT: THREE.MOUSE.ROTATE,
};

// ---- 鱼缸 ----
const tank = buildTank(scene);

// ---- 光照：环境光 + 主方向光（产生鱼身高光反射）----
scene.add(new THREE.AmbientLight(0xffffff, 0.4));
const sun = new THREE.DirectionalLight(0xffffff, 2.6);
sun.position.set(14, 24, 10);
scene.add(sun);
// 辅光：补暗部，带一点冷色
const fill = new THREE.DirectionalLight(0x9fc6e8, 0.6);
fill.position.set(-10, -4, -14);
scene.add(fill);

// ---- 加载 STL 鱼模型（蒙皮到骨骼链）----
const fishModel = await loadFishModel(modelUrl);

// ---- 鱼群（体型统一，保留颜色与速度差异）----
const fishes = [];
const fishSpecs = [
  { color: 0xff7043, speed: 2.9, count: isMobile ? 6 : 12 },
  { color: 0x26c6da, speed: 3.4, count: isMobile ? 8 : 15 },
  { color: 0xffca28, speed: 3.1, count: isMobile ? 6 : 12 },
  { color: 0xec407a, speed: 3.1, count: isMobile ? 5 : 9 },
  { color: 0x8e24aa, speed: 3.8, count: isMobile ? 5 : 9 },
  { color: 0xff8a65, speed: 2.0, count: isMobile ? 2 : 3 },
];
for (const spec of fishSpecs) {
  for (let i = 0; i < spec.count; i++) {
    const fish = createFish({
      color: spec.color,
      speed: spec.speed, // 同群巡航速度一致（群内协调游动）
      bounds: tank.bounds,
      modelGeo: fishModel,
    });
    fish.position.copy(randomPoint(tank.bounds));
    fish.userData.index = fishes.length; // 调试编号（视觉回避诊断用）
    scene.add(fish);
    fishes.push(fish);
  }
}

// 点击撒食（可选特性：点击水底撒食，鱼群游过去抢食；移动端仅展示，关闭交互）
if (FEATURES.feeding && !isMobile) {
  // 射线与缸体 AABB 求交（slab 法）：点击缸体任意可见位置都能定位到缸内
  const rayAABB2 = (origin, dir) => {
    let tMin = -Infinity, tMax = Infinity;
    for (const axis of ['x', 'y', 'z']) {
      const mn = tank.bounds[axis][0], mx = tank.bounds[axis][1];
      const o = origin[axis], d = dir[axis];
      if (Math.abs(d) < 1e-8) {
        if (o < mn || o > mx) return null;
      } else {
        let t1 = (mn - o) / d, t2 = (mx - o) / d;
        if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) return null;
      }
    }
    return tMin > 0 ? tMin : (tMax > 0 ? tMax : null);
  };
  const foodRay = new THREE.Raycaster();
  const foodPtr = new THREE.Vector2();
  const foodGeo = new THREE.SphereGeometry(0.06, 8, 6);
  const foodMat = new THREE.MeshBasicMaterial({ color: 0xffd166 });
  renderer.domElement.addEventListener('pointerdown', (e) => {
    foodPtr.x = (e.clientX / window.innerWidth) * 2 - 1;
    foodPtr.y = -(e.clientY / window.innerHeight) * 2 + 1;
    foodRay.setFromCamera(foodPtr, camera);
    const tHit = rayAABB2(foodRay.ray.origin, foodRay.ray.direction);
    if (tHit === null) return;
    const p = foodRay.ray.origin.clone().addScaledVector(foodRay.ray.direction, tHit);
    // 取进入缸体的 x/z（钳制到边界内），鱼食从该位置水面落入
    const bx = Math.max(tank.bounds.x[0], Math.min(tank.bounds.x[1], p.x));
    const bz = Math.max(tank.bounds.z[0], Math.min(tank.bounds.z[1], p.z));
    // 食物数量上限，超出移除最早
    if (WORLD.foods.length >= 40) {
      const old = WORLD.foods.shift();
      scene.remove(old.mesh);
      old.mesh.geometry.dispose();
    }
    const mesh = new THREE.Mesh(foodGeo, foodMat);
    const waterY = TANK.BOTTOM + TANK.H - 0.6;
    mesh.position.set(bx, waterY + 0.8, bz); // 从该位置水面稍上方落入
    scene.add(mesh);
    WORLD.foods.push({ pos: mesh.position, t: 0, phase: Math.random() * Math.PI * 2, vy: 0, falling: true, mesh });
  });
}

// ---- 掠食者（可选特性：一条大鱼追逐鱼群，鱼群四散逃避）----
if (FEATURES.predator) {
  const predator = createFish({
    color: 0x546e7a, // 蓝灰，体型 1.5×，比鱼群醒目
    speed: PARAMS.PRED_SPEED,
    size: 1.5,
    bounds: tank.bounds,
    modelGeo: fishModel,
    predator: true,
  });
  predator.position.copy(randomPoint(tank.bounds));
  scene.add(predator);
  WORLD.predator = {
    group: predator,
    pos: predator.position,
    vel: predator.userData.vel,
    radius: PARAMS.PRED_RADIUS,
  };
}

// ---- 气泡（可选特性：随机上升的气泡粒子）----
let bubbleSystem = null;
if (FEATURES.bubbles) {
  const N_BUBBLES = 40;
  const bPos = new Float32Array(N_BUBBLES * 3);
  const bVel = [];
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(16, 16, 2, 16, 16, 15);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.55, 'rgba(200,230,255,0.4)');
  grad.addColorStop(1, 'rgba(200,230,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 32);
  const bGeo = new THREE.BufferGeometry();
  const bMat = new THREE.PointsMaterial({
    size: 0.18,
    map: new THREE.CanvasTexture(canvas),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    color: 0xbfe8ff,
    opacity: 0.45,
  });
  const bx0 = tank.bounds.x[0], bx1 = tank.bounds.x[1];
  const by0 = tank.bounds.y[0], by1 = tank.bounds.y[1];
  const bz0 = tank.bounds.z[0], bz1 = tank.bounds.z[1];
  for (let i = 0; i < N_BUBBLES; i++) {
    bPos[i * 3] = bx0 + Math.random() * (bx1 - bx0);
    bPos[i * 3 + 1] = by0 + Math.random() * (by1 - by0);
    bPos[i * 3 + 2] = bz0 + Math.random() * (bz1 - bz0);
    bVel.push({ vy: 0.4 + Math.random() * 0.5, phase: Math.random() * Math.PI * 2 });
  }
  bGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
  const bubbles = new THREE.Points(bGeo, bMat);
  scene.add(bubbles);
  bubbleSystem = { geo: bGeo, vel: bVel, n: N_BUBBLES, y0: by0, y1: by1, bx0, bx1, bz0, bz1 };
}

// ---- 水草/装饰（可选特性：缸底装饰物，鱼用障碍回避绕行）----
const grassMeshes = [];
if (FEATURES.decor) {
  const by0 = tank.bounds.y[0];
  // 石头（障碍物）
  const rockGeo = new THREE.SphereGeometry(0.7, 10, 8);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x6b7a52, roughness: 0.9 });
  const rockSpots = [[-26, -14], [26, 12], [18, -15], [-20, 15], [0, 17]];
  for (const [x, z] of rockSpots) {
    const rock = new THREE.Mesh(rockGeo, rockMat);
    rock.position.set(x, by0 + 0.25, z);
    rock.scale.set(1, 0.65, 0.9);
    rock.rotation.y = Math.random() * Math.PI;
    scene.add(rock);
    WORLD.obstacles.push({ pos: rock.position, radius: 0.85 });
  }
  // 水草（细条，随水流摆动）
  const grassMat = new THREE.MeshStandardMaterial({
    color: 0x3f8f4a, roughness: 0.7, side: THREE.DoubleSide,
  });
  for (let i = 0; i < 10; i++) {
    const h = 1.1 + Math.random() * 1.3;
    const gx = tank.bounds.x[0] + 2 + Math.random() * (tank.bounds.x[1] - tank.bounds.x[0] - 4);
    const gz = tank.bounds.z[0] + 2 + Math.random() * (tank.bounds.z[1] - tank.bounds.z[0] - 4);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.12, h * 0.4, 0.06),
      new THREE.Vector3(-0.1, h * 0.75, -0.06),
      new THREE.Vector3(0.06, h, 0.03),
    ]);
    const grass = new THREE.Mesh(new THREE.TubeGeometry(curve, 8, 0.045, 6, false), grassMat);
    grass.position.set(gx, by0, gz);
    grass.userData.sway = Math.random() * Math.PI * 2;
    scene.add(grass);
    grassMeshes.push(grass);
  }
}

// ---- 水面光斑（可选特性：缸底动态光斑投影；移动端关闭以省性能）----
let caustics = null;
if (FEATURES.caustics && !isMobile) {
  const cw = 256, ch = 256;
  const cCanvas = document.createElement('canvas');
  cCanvas.width = cw;
  cCanvas.height = ch;
  const cctx = cCanvas.getContext('2d');
  const cTex = new THREE.CanvasTexture(cCanvas);
  const cGeo = new THREE.PlaneGeometry(
    tank.bounds.x[1] - tank.bounds.x[0],
    tank.bounds.z[1] - tank.bounds.z[0]
  );
  const cMat = new THREE.MeshBasicMaterial({
    map: cTex,
    transparent: true,
    opacity: 0.4,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const cPlane = new THREE.Mesh(cGeo, cMat);
  cPlane.rotation.x = -Math.PI / 2;
  cPlane.position.y = tank.bounds.y[0] + 0.05;
  scene.add(cPlane);
  caustics = { canvas: cCanvas, ctx: cctx, tex: cTex, w: cw, h: ch };
}

// ---- 实时参数面板（可选特性：拖动条实时调节；移动端关闭避免遮挡）----
if (FEATURES.panel && !isMobile) {
  const panel = document.createElement('div');
  panel.id = 'panel';
  const title = document.createElement('div');
  title.className = 'ptitle';
  title.textContent = '实时参数';
  panel.appendChild(title);
  const sliders = [
    ['分离权重', 'W_SEP', 0, 8, 0.1],
    ['对齐权重', 'W_ALIGN', 0, 4, 0.1],
    ['凝聚权重', 'W_COH', 0, 3, 0.1],
    ['随机游走', 'WANDER', 0, 2, 0.05],
    ['感知范围', 'PERCEPTION', 1, 16, 0.5],
    ['巡航保持', 'CRUISE_KEEP', 0, 1, 0.05],
    ['边界回避', 'VISUAL_SIGHT', 3, 20, 0.5],
    ['摆尾频率', 'SWAY_FREQ', 2, 12, 0.5],
    ['摆尾幅度', 'SWAY_AMP', 0.02, 0.5, 0.01],
    ['掠食速度', 'PRED_SPEED', 2, 8, 0.2],
  ];
  for (const [label, key, min, max, step] of sliders) {
    const row = document.createElement('div');
    row.className = 'prow';
    const l = document.createElement('span');
    l.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'range';
    inp.min = min;
    inp.max = max;
    inp.step = step;
    inp.value = PARAMS[key];
    const v = document.createElement('span');
    v.className = 'pval';
    v.textContent = (+PARAMS[key]).toFixed(2);
    inp.addEventListener('input', () => {
      PARAMS[key] = parseFloat(inp.value);
      v.textContent = parseFloat(inp.value).toFixed(2);
    });
    row.append(l, inp, v);
    panel.appendChild(row);
  }
  document.body.appendChild(panel);
}

// ---- 截图导出（可选特性：按 P 保存当前画面为 PNG；移动端无键盘关闭）----
if (FEATURES.screenshot && !isMobile) {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
      const url = renderer.domElement.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `fish-tank-${Date.now()}.png`;
      a.click();
    }
  });
}

// ---- 数字时钟（可选特性：全屏大时钟，占满整个屏幕，鱼缸在其后隐约可见）----
const fullclockEl = document.getElementById('fullclock-time');
let lastClockSec = -1;
function drawClock(now) {
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  fullclockEl.textContent = `${hh}:${mm}:${ss}`;
}
if (FEATURES.clock) drawClock(new Date());

// ---- HUD ----
apiEl.textContent = api;
const updateRes = () => { resEl.textContent = `${window.innerWidth}×${window.innerHeight}`; };
updateRes();

let frames = 0;
let lastFpsTime = performance.now();
function updateHud() {
  frames++;
  const now = performance.now();
  if (now - lastFpsTime >= 500) {
    fpsEl.textContent = Math.round((frames * 1000) / (now - lastFpsTime));
    frames = 0;
    lastFpsTime = now;
  }
}

// ---- 窗口自适应 ----
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  updateRes();
});

// ---- 视角模式：环绕 / 鱼眼第一视角 ----
let cameraMode = 'orbit'; // 'orbit' | 'first'
let camFishIndex = 0;
let paused = false; // 空格暂停
const keys = {}; // WASD 按键状态
const fpDir = new THREE.Vector3();   // 头部朝向
const fpEye = new THREE.Vector3();   // 鱼眼位置
const fpLook = new THREE.Vector3();  // 注视点
const fpQ = new THREE.Quaternion();

function setCameraMode(mode) {
  cameraMode = mode;
  const isFirst = mode === 'first';
  controls.enabled = !isFirst;
  camera.fov = isFirst ? 65 : 55; // 追尾视角视野
  camera.updateProjectionMatrix();
  modeEl.textContent = isFirst ? `追尾视角 · 鱼#${camFishIndex}` : '环绕';
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    paused = !paused;
    stateEl.textContent = paused ? '已暂停' : '运行';
  } else if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
    keys[e.code] = true;
  } else if (e.key === 'f' || e.key === 'F') {
    setCameraMode(cameraMode === 'orbit' ? 'first' : 'orbit');
  } else if (e.key === 'Tab') {
    e.preventDefault();
    if (cameraMode === 'first') {
      camFishIndex = (camFishIndex + 1) % fishes.length;
      modeEl.textContent = `追尾视角 · 鱼#${camFishIndex}`;
    }
  }
});
window.addEventListener('keyup', (e) => {
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) keys[e.code] = false;
});

// ---- 主循环 ----
const timer = new THREE.Timer();
const mvFwd = new THREE.Vector3();  // WASD：相机水平前方向
const mvRight = new THREE.Vector3(); // WASD：相机水平右方向
const mvDelta = new THREE.Vector3(); // WASD：移动增量
renderer.setAnimationLoop(() => {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.05);
  const t = timer.getElapsed();

  // ---- 数字时钟（可选特性）：秒数变化时重绘 ----
  if (FEATURES.clock) {
    const now = new Date();
    if (now.getSeconds() !== lastClockSec) {
      lastClockSec = now.getSeconds();
      drawClock(now);
    }
  }

  if (!paused) {
    for (const f of fishes) updateFish(f, t, dt, fishes);
    // 鱼食：从上方落入水面→漂浮，鱼嘴碰到即被吃，1 分钟后自动消失（可选特性）
    if (FEATURES.feeding && WORLD.foods.length) {
      const waterY = TANK.BOTTOM + TANK.H - 0.6;
      const EAT_R2 = 0.45 * 0.45; // 鱼嘴（头部）吃到鱼食的判定距离²
      for (let i = WORLD.foods.length - 1; i >= 0; i--) {
        const f = WORLD.foods[i];
        f.t += dt;
        if (f.falling) {
          f.vy -= 9 * dt; // 重力下落（y 向上为正，重力向下取负；快速落水避免飘空）
          f.pos.y += f.vy * dt;
          if (f.pos.y <= waterY) { f.pos.y = waterY; f.falling = false; } // 落水浮起
        } else {
          f.pos.y = waterY + Math.sin(t * 1.5 + f.phase) * 0.04; // 水面浮动
        }
        // 鱼嘴碰到鱼食才代表吃到
        let eaten = false;
        for (const fish of fishes) {
          if (fish.position.distanceToSquared(f.pos) < EAT_R2) { eaten = true; break; }
        }
        if (eaten || f.t > 60) {
          scene.remove(f.mesh);
          f.mesh.geometry.dispose();
          WORLD.foods.splice(i, 1);
        }
      }
    }
    // 掠食者（可选特性）：骨骼/边界/巡航由 updateFish 处理（空邻居无群游），追逐力叠加
    if (FEATURES.predator && WORLD.predator) {
      const pr = WORLD.predator;
      updateFish(pr.group, t, dt, []);
      let target = null, td = Infinity;
      for (const f of fishes) {
        const d = pr.pos.distanceToSquared(f.position);
        if (d < td) { td = d; target = f; }
      }
      if (target) {
        fpDir.subVectors(target.position, pr.pos).normalize();
        pr.vel.addScaledVector(fpDir, PARAMS.PRED_SPEED * dt * 3);
      }
      // 硬边界反射
      for (const axis of ['x', 'y', 'z']) {
        const mn = tank.bounds[axis][0], mx = tank.bounds[axis][1];
        if (pr.pos[axis] < mn) { pr.pos[axis] = mn; pr.vel[axis] = Math.abs(pr.vel[axis]); }
        else if (pr.pos[axis] > mx) { pr.pos[axis] = mx; pr.vel[axis] = -Math.abs(pr.vel[axis]); }
      }
    }
    // 气泡上升（可选特性）
    if (bubbleSystem) {
      const bs = bubbleSystem;
      const arr = bs.geo.attributes.position.array;
      for (let i = 0; i < bs.n; i++) {
        arr[i * 3 + 1] += bs.vel[i].vy * dt;
        arr[i * 3] += Math.sin(t * 0.8 + bs.vel[i].phase) * 0.12 * dt;
        if (arr[i * 3 + 1] > bs.y1) {
          arr[i * 3 + 1] = bs.y0;
          arr[i * 3] = bs.bx0 + Math.random() * (bs.bx1 - bs.bx0);
          arr[i * 3 + 2] = bs.bz0 + Math.random() * (bs.bz1 - bs.bz0);
        }
      }
      bs.geo.attributes.position.needsUpdate = true;
    }
    // 水草随水流摆动（可选特性）
    if (grassMeshes.length) {
      for (const g of grassMeshes) {
        g.rotation.z = Math.sin(t * 1.2 + g.userData.sway) * 0.12;
        g.rotation.x = Math.sin(t * 0.9 + g.userData.sway * 1.3) * 0.08;
      }
    }
    // 水面光斑动态纹理（可选特性）
    if (caustics) {
      const c = caustics;
      const ctx = c.ctx;
      ctx.clearRect(0, 0, c.w, c.h);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 9; i++) {
        const px = c.w / 2 + Math.sin(t * 0.5 + i * 1.7) * c.w * 0.3;
        const py = c.h / 2 + Math.cos(t * 0.4 + i * 2.1) * c.h * 0.3;
        ctx.beginPath();
        ctx.ellipse(px, py, 26 + 12 * Math.sin(t + i), 13 + 7 * Math.cos(t * 0.7 + i), i, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(180, 230, 255, ${0.05 + 0.035 * Math.sin(t + i)})`;
        ctx.fill();
      }
      c.tex.needsUpdate = true;
    }
  }

  // ---- WASD 移动相机（仅环绕模式；追尾模式由鱼控制相机）----
  if (cameraMode === 'orbit') {
    camera.getWorldDirection(mvFwd);
    mvFwd.y = 0;
    mvFwd.normalize();
    mvRight.crossVectors(mvFwd, camera.up).normalize();
    mvDelta.set(0, 0, 0);
    if (keys.KeyW) mvDelta.add(mvFwd);
    if (keys.KeyS) mvDelta.sub(mvFwd);
    if (keys.KeyA) mvDelta.sub(mvRight);
    if (keys.KeyD) mvDelta.add(mvRight);
    if (mvDelta.lengthSq() > 0) {
      mvDelta.normalize().multiplyScalar(12 * dt);
      camera.position.add(mvDelta);
      controls.target.add(mvDelta);
    }
  }

  if (cameraMode === 'first') {
    // 追尾视角：锚点 = 头骨（鱼身根部，转弯/摆尾时位置最稳定）；
    // 偏移方向用速度方向（平滑），避免 head 瞬时朝向的摆头扰动放大晃动
    const fish = fishes[camFishIndex];
    const head = fish.userData.bones[0];
    fish.updateMatrixWorld(true);
    head.getWorldPosition(fpEye);
    fpDir.copy(fish.userData.vel);
    if (fpDir.lengthSq() < 1e-8) {
      head.getWorldQuaternion(fpQ); // vel≈0 时退回头部朝向
      fpDir.set(0, 0, 1).applyQuaternion(fpQ);
    } else {
      fpDir.normalize();
    }
    // 相机放到鱼头后上方（避开模型网格）
    camera.position.copy(fpEye).addScaledVector(fpDir, -2.2);
    camera.position.y += 0.8;
    // 轻微晃动（跟随游动节奏，幅度调小）
    camera.position.y += Math.sin(t * 14) * 0.02;
    camera.position.addScaledVector(fpDir, Math.sin(t * 9) * 0.06);
    // 看向鱼前方
    fpLook.copy(fpEye).addScaledVector(fpDir, 6);
    camera.lookAt(fpLook);
  } else {
    controls.update();
  }
  renderer.render(scene, camera);
  updateHud();
});
