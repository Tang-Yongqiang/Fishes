// 鱼缸场景（scenes/fish-tank）：生态时钟的第一个场景。
// 本模块承载鱼缸专属逻辑：URL 鱼参数解析、相机初始位、灯光、鱼群、缸体、
// 微小生物、喂食交互、掠食者、气泡、水草、水面光斑、实时参数面板、设置弹窗、
// 第一视角/WASD 相机，以及每帧的鱼群与外设更新。
// 通用框架（渲染器/场景/相机/控制/HUD/时钟/截图/PWA/UI切换）由 core/app.js 提供。

import modelUrl from '../../../models/XH378sJqtgOHKGAXMdeNF.stl?url';
import { FEATURES, PARAMS, SETTINGS, WORLD } from './config.js';
import { createCreatures, updateCreatures } from '../../creatures.js';
import { createFish, loadFishModel, randomPoint, resetShoalState, updateFish } from '../../fish.js';
import { buildTank, TANK } from '../../tank.js';

// 壁纸模式默认参数（URL 显式传参可覆盖）：zoom=40, pitch=0, yaw=0, count=80, rng=0.3:2.0
const WP_DEFAULT = {
  dist: 40,      // 默认镜头距离
  pitch: 0,      // 默认俯仰角（°）
  yaw: 0,        // 默认方位角（°）
  count: 80,     // 默认鱼数量
  rngMin: 0.3,   // 默认随机大小下限
  rngMax: 2.0,   // 默认随机大小上限
};

/**
 * 创建鱼缸场景。
 * @param {import('../../core/app.js').Ctx} ctx 核心注入的场景上下文
 * @returns {Promise<{ update: (dt:number, t:number) => void }>}
 */
export async function createFishTankScene(ctx) {
  const { THREE, renderer, scene, camera, controls, isMobile, isWallpaper, urlParams, hud } = ctx;

  // ---- URL 参数（壁纸模式/URL 传入；不传则沿用默认，普通模式不受影响）----
  // ?count=N：鱼数量（壁纸默认 80，桌面普通默认 60）
  const countArg = parseInt(urlParams.get('count') || '', 10);
  if (Number.isInteger(countArg) && countArg >= 1) SETTINGS.fishCount = countArg;
  // 鱼大小随机：壁纸模式默认开启（范围 0.3~2.0），?rng=min:max 可自定义范围。
  const rngArg = urlParams.get('rng') || '';
  const rngMatch = rngArg.match(/^\s*([\d.]+)\s*:\s*([\d.]+)\s*$/);
  if (isWallpaper) {
    SETTINGS.fishCount = WP_DEFAULT.count;
    SETTINGS.randomSize = true;
    SETTINGS.sizeMin = WP_DEFAULT.rngMin;
    SETTINGS.sizeMax = WP_DEFAULT.rngMax;
  }
  if (rngMatch && rngMatch[0].includes(':')) {
    const rMin = parseFloat(rngMatch[1]), rMax = parseFloat(rngMatch[2]);
    if (Number.isFinite(rMin) && Number.isFinite(rMax) && rMin > 0 && rMax >= rMin) {
      SETTINGS.randomSize = true;
      SETTINGS.sizeMin = Math.max(0.1, rMin);
      SETTINGS.sizeMax = rMax;
    }
  }

  // 相机初始缩放距离（URL ?zoom=<距离>）
  const camDist = parseFloat(urlParams.get('zoom') || '');
  const HAS_CAM_DIST = Number.isFinite(camDist) && camDist > 0;
  // 初始朝向角度（URL ?pitch=<俯仰角°>&yaw=<方位角°>）
  const pitchArg = parseFloat(urlParams.get('pitch') || '');
  const yawArg = parseFloat(urlParams.get('yaw') || '');
  const HAS_PITCH = Number.isFinite(pitchArg) && pitchArg >= 0 && pitchArg <= 90;
  const HAS_YAW = Number.isFinite(yawArg) && yawArg >= -720 && yawArg <= 720;
  // 只要传了 zoom/pitch/yaw 任一，就以球坐标统一重设相机初始位（target 恒为 (0,10,0)）
  const HAS_CAM_ANGLE = HAS_CAM_DIST || HAS_PITCH || HAS_YAW;

  // ---- 相机初始位：默认鱼缸视角；URL/壁纸模式以球坐标重设 ----
  camera.position.set(0, isMobile ? 20 : 22, isMobile ? 60 : 110);
  camera.lookAt(0, 10, 0);
  controls.target.set(0, 10, 0);

  if (HAS_CAM_ANGLE || isWallpaper) {
    const baseDist = isWallpaper ? WP_DEFAULT.dist : (isMobile ? 60 : 110);
    const basePitch = isWallpaper ? WP_DEFAULT.pitch : 6.37; // 默认俯仰角（°），维持原视角
    const baseYaw = isWallpaper ? WP_DEFAULT.yaw : 0;        // 默认方位角（°）
    const dist = HAS_CAM_DIST ? camDist : baseDist;
    const pitch = HAS_PITCH ? pitchArg : basePitch;
    const yaw = HAS_YAW ? yawArg : baseYaw;
    const polar = (90 - pitch) * Math.PI / 180; // polarAngle：0=正上方，90°=水平
    const azimuth = yaw * Math.PI / 180;        // azimuthAngle 弧度
    camera.position.set(
      0 + dist * Math.sin(polar) * Math.sin(azimuth),
      10 + dist * Math.cos(polar),
      0 + dist * Math.sin(polar) * Math.cos(azimuth)
    );
    camera.lookAt(0, 10, 0);
  }

  // ---- 鱼缸 ----
  const tank = buildTank(scene);

  // ---- 微小生物（可选特性）：缸底小虾爬行 + 扬沙 ----
  const creatures = createCreatures(scene, tank);

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

  // ---- 移动端视觉增强 ----
  // 鱼放大：SETTINGS.fishSize 默认移动端 1.9 / 桌面 1.0（骨骼/蒙皮/碰撞半径等比放大）
  // 鱼放大后更占空间：移动端降低凝聚、增大分离/随机游走，让鱼群散开游动不聚成一团
  if (isMobile) {
    PARAMS.W_COH = 0.25;   // 凝聚 0.4 → 0.25
    PARAMS.W_SEP = 3.6;    // 分离 3.2 → 3.6
    PARAMS.WANDER = 0.4;   // 随机游走 0.3 → 0.4
  }

  // ---- 鱼群：按 SETTINGS 生成（体型/数量可经设置弹窗重建）----
  // 各颜色群的相对权重（决定总数在各色之间的分配比例）
  const fishes = [];
  const fishSpecs = [
    { color: 0xff7043, speed: 2.9, weight: 12 },
    { color: 0x26c6da, speed: 3.4, weight: 15 },
    { color: 0xffca28, speed: 3.1, weight: 12 },
    { color: 0xec407a, speed: 3.1, weight: 9 },
    { color: 0x8e24aa, speed: 3.8, weight: 9 },
    { color: 0xff8a65, speed: 2.0, weight: 3 },
  ];
  const totalWeight = fishSpecs.reduce((s, x) => s + x.weight, 0);

  // 逐条计算本应生成的大小：固定模式用 SETTINGS.fishSize；随机模式在 [sizeMin,sizeMax]×fishSize 内取
  function fishSizeFor() {
    if (!SETTINGS.randomSize) return SETTINGS.fishSize;
    return THREE.MathUtils.randFloat(
      SETTINGS.sizeMin * SETTINGS.fishSize,
      SETTINGS.sizeMax * SETTINGS.fishSize
    );
  }

  // 重建鱼群：清空旧鱼 → 按 SETTINGS.fishCount 分配各色数量 → 重新生成。
  function rebuildFish() {
    for (const f of fishes) {
      scene.remove(f);
      f.traverse((o) => { if (o.isMesh) { o.geometry?.dispose(); o.material?.dispose?.(); } });
    }
    fishes.length = 0;
    resetShoalState();
    let assigned = 0;
    for (let si = 0; si < fishSpecs.length; si++) {
      const spec = fishSpecs[si];
      // 最后一群吸收取整误差，保证总数精确等于 SETTINGS.fishCount
      const count = (si === fishSpecs.length - 1)
        ? Math.max(0, SETTINGS.fishCount - assigned)
        : Math.round(SETTINGS.fishCount * spec.weight / totalWeight);
      for (let i = 0; i < count; i++) {
        const fish = createFish({
          color: spec.color,
          speed: spec.speed,   // 同群巡航速度一致（群内协调游动）
          size: fishSizeFor(), // 固定 or 随机大小
          bounds: tank.bounds,
          modelGeo: fishModel,
        });
        fish.position.copy(randomPoint(tank.bounds));
        fish.userData.index = fishes.length; // 调试编号（视觉回避诊断用）
        scene.add(fish);
        fishes.push(fish);
      }
      assigned += count;
    }
  }
  rebuildFish();

  // 场景级运行时状态（供事件回调与每帧 update 共享）
  let globalT = 0; // 全局时间（惊散等临时状态用）

  // ---- 点击交互（可选特性：桌面鼠标 + 移动端触屏）----
  // 按命中面分派语义：点水面→投食聚拢；点侧壁/缸内→惊散散开。
  let updateRipples = null; // 由下方 feeding 块注入的波纹逐帧更新函数
  if (FEATURES.feeding) {
    // 射线与缸体 AABB（slab 法）求交，返回进入距离 t 与命中的面法线轴。
    const rayAABB2 = (origin, dir) => {
      let tMin = -Infinity, tMax = Infinity;
      let axis = null, sign = 0;
      for (const a of ['x', 'y', 'z']) {
        const mn = tank.bounds[a][0], mx = tank.bounds[a][1];
        const o = origin[a], d = dir[a];
        if (Math.abs(d) < 1e-8) {
          if (o < mn || o > mx) return null;
          continue;
        }
        let t1 = (mn - o) / d, t2 = (mx - o) / d;
        let s1 = -1, s2 = 1;
        if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s1 = 1; s2 = -1; }
        if (t1 > tMin) { tMin = t1; axis = a; sign = s1; }
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) return null;
      }
      if (tMin < 0 || !isFinite(tMin)) return null;
      return { t: tMin, axis, sign };
    };
    const foodRay = new THREE.Raycaster();
    const foodPtr = new THREE.Vector2();
    const foodGeo = new THREE.SphereGeometry(0.06, 8, 6);
    const foodMat = new THREE.MeshBasicMaterial({ color: 0xffd166 });
    const waterY = TANK.BOTTOM + TANK.H - 0.6;
    // 敲缸壁的扩散冲击波纹（视觉反馈）
    const ripples = [];
    const rippleGeo = new THREE.RingGeometry(0.15, 0.22, 24);
    const updateRipple = (r, dt) => {
      r.t += dt;
      const life = 0.45; // 波纹持续时长
      const k = Math.min(r.t / life, 1);          // 0→1 进度
      const r0 = 0.3, r1 = 3.2;                   // 扩散半径范围
      r.mesh.scale.setScalar(r0 + (r1 - r0) * k);
      r.mesh.material.opacity = 0.65 * (1 - k);   // 淡出
      return r.t < life;
    };
    updateRipples = (dt) => {
      for (let i = ripples.length - 1; i >= 0; i--) {
        const alive = updateRipple(ripples[i], dt);
        if (!alive) {
          scene.remove(ripples[i].mesh);
          ripples[i].mesh.geometry.dispose();
          ripples.splice(i, 1);
        }
      }
    };
    const spawnRipple = (pos, hitAxis) => {
      const m = new THREE.Mesh(rippleGeo, new THREE.MeshBasicMaterial({
        color: 0x9fe8ff, transparent: true, opacity: 0.65, depthWrite: false,
        side: THREE.DoubleSide,
      }));
      m.position.copy(pos);
      if (hitAxis === 'x') m.rotation.y = Math.PI / 2;
      else if (hitAxis === 'y') m.rotation.x = Math.PI / 2;
      scene.add(m);
      ripples.push({ mesh: m, t: 0 });
    };
    renderer.domElement.addEventListener('pointerdown', (e) => {
      // 只响应用主键点击（左键/触摸）；右键/中键保留给 OrbitControls 旋转平移
      if (e.button !== 0) return;
      foodPtr.x = (e.clientX / window.innerWidth) * 2 - 1;
      foodPtr.y = -(e.clientY / window.innerHeight) * 2 + 1;
      foodRay.setFromCamera(foodPtr, camera);
      const hit = rayAABB2(foodRay.ray.origin, foodRay.ray.direction);
      if (hit === null) return;
      const isWaterSurface = hit.axis === 'y' && hit.sign === 1;
      const p = foodRay.ray.origin.clone().addScaledVector(foodRay.ray.direction, hit.t);
      const bx = Math.max(tank.bounds.x[0], Math.min(tank.bounds.x[1], p.x));
      const bz = Math.max(tank.bounds.z[0], Math.min(tank.bounds.z[1], p.z));

      if (isWaterSurface) {
        // ---- 水面：投食 → 附近鱼聚拢抢食 ----
        if (WORLD.foods.length >= 40) {
          const old = WORLD.foods.shift();
          scene.remove(old.mesh);
          old.mesh.geometry.dispose();
        }
        const mesh = new THREE.Mesh(foodGeo, foodMat);
        mesh.position.set(bx, waterY + 0.8, bz);
        scene.add(mesh);
        WORLD.foods.push({ pos: mesh.position, t: 0, phase: Math.random() * Math.PI * 2, vy: 0, falling: true, mesh });
        if (FEATURES.fishPlay) {
          WORLD.scatterSource = new THREE.Vector3(bx, waterY + 1, bz);
          WORLD.scatterUntil = globalT + PARAMS.SCATTER_TIME;
        }
      } else {
        // ---- 侧壁/缸内：敲缸 → 缸壁冲击波纹 + 附近鱼惊散 ----
        spawnRipple(p, hit.axis);
        WORLD.scatterSource = new THREE.Vector3(bx, p.y, bz);
        WORLD.scatterUntil = globalT + PARAMS.SCATTER_TIME;
      }
    });
  }

  // ---- 掠食者（可选特性：一条大鱼追逐鱼群）----
  if (FEATURES.predator) {
    const predator = createFish({
      color: 0x546e7a,
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
    const cctx = canvas.getContext('2d');
    const grad = cctx.createRadialGradient(16, 16, 2, 16, 16, 15);
    grad.addColorStop(0, 'rgba(255,255,255,0.85)');
    grad.addColorStop(0.55, 'rgba(200,230,255,0.4)');
    grad.addColorStop(1, 'rgba(200,230,255,0)');
    cctx.fillStyle = grad;
    cctx.fillRect(0, 0, 32, 32);
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
    // 石头（障碍物）——位置适配深度 72 的 z 范围（±35.2），前后排布拉开纵深
    const rockGeo = new THREE.SphereGeometry(0.7, 10, 8);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x6b7a52, roughness: 0.9 });
    const rockSpots = [[-26, -20], [26, 18], [18, -25], [-20, 22], [0, 20]];
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
    const defaults = {};
    const inputs = [];
    for (const [label, key, min, max, step] of sliders) {
      defaults[key] = PARAMS[key];
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
      inputs.push({ key, inp, v });
    }
    const resetBtn = document.createElement('button');
    resetBtn.className = 'preset-btn';
    resetBtn.textContent = '恢复默认';
    resetBtn.addEventListener('click', () => {
      for (const { key, inp, v } of inputs) {
        PARAMS[key] = defaults[key];
        inp.value = defaults[key];
        v.textContent = (+defaults[key]).toFixed(2);
      }
    });
    panel.appendChild(resetBtn);
    document.body.appendChild(panel);
  }

  // ---- 设置面板（全端）：齿轮按钮弹出 modal，开关/参数点"确定"才生效 ----
  (function initSettings() {
    const btn = document.getElementById('settings-btn');
    const modal = document.getElementById('settings-modal');
    const scatterChk = document.getElementById('setting-scatter');
    const okBtn = document.getElementById('settings-ok');
    const cancelBtn = document.getElementById('settings-cancel');
    const backdrop = modal?.querySelector('.settings-backdrop');
    const countInput = document.getElementById('setting-count');
    const countVal = document.getElementById('setting-count-val');
    const sizeInput = document.getElementById('setting-size');
    const sizeVal = document.getElementById('setting-size-val');
    const randomChk = document.getElementById('setting-randomsize');
    const rangeRow = document.getElementById('setting-size-range');
    const minInput = document.getElementById('setting-size-min');
    const minVal = document.getElementById('setting-size-min-val');
    const maxInput = document.getElementById('setting-size-max');
    const maxVal = document.getElementById('setting-size-max-val');
    if (!btn || !modal || !scatterChk) return;

    function openSettings() {
      scatterChk.checked = !!FEATURES.scatterPanic;
      countInput.value = SETTINGS.fishCount;
      countVal.textContent = SETTINGS.fishCount;
      sizeInput.value = SETTINGS.fishSize;
      sizeVal.textContent = (+SETTINGS.fishSize).toFixed(1);
      randomChk.checked = !!SETTINGS.randomSize;
      minInput.value = SETTINGS.sizeMin;
      minVal.textContent = (+SETTINGS.sizeMin).toFixed(2);
      maxInput.value = SETTINGS.sizeMax;
      maxVal.textContent = (+SETTINGS.sizeMax).toFixed(2);
      rangeRow.style.display = SETTINGS.randomSize ? '' : 'none';
      modal.classList.remove('hidden');
    }
    function closeSettings() {
      modal.classList.add('hidden');
    }
    countInput?.addEventListener('input', () => { countVal.textContent = countInput.value; });
    sizeInput?.addEventListener('input', () => { sizeVal.textContent = (+sizeInput.value).toFixed(1); });
    minInput?.addEventListener('input', () => { minVal.textContent = (+minInput.value).toFixed(2); });
    maxInput?.addEventListener('input', () => { maxVal.textContent = (+maxInput.value).toFixed(2); });
    randomChk?.addEventListener('change', () => {
      rangeRow.style.display = randomChk.checked ? '' : 'none';
    });
    btn.addEventListener('click', openSettings);
    okBtn?.addEventListener('click', () => {
      const sizeChanged =
        SETTINGS.fishCount !== +countInput.value ||
        SETTINGS.fishSize !== +sizeInput.value ||
        SETTINGS.randomSize !== randomChk.checked ||
        SETTINGS.sizeMin !== +minInput.value ||
        SETTINGS.sizeMax !== +maxInput.value;
      FEATURES.scatterPanic = scatterChk.checked;
      SETTINGS.fishCount = +countInput.value;
      SETTINGS.fishSize = +sizeInput.value;
      SETTINGS.randomSize = randomChk.checked;
      SETTINGS.sizeMin = +minInput.value;
      SETTINGS.sizeMax = +maxInput.value;
      closeSettings();
      if (sizeChanged) {
        rebuildFish();
        if (cameraMode === 'first' && camFishIndex >= fishes.length) {
          camFishIndex = Math.max(0, fishes.length - 1);
        }
      }
    });
    cancelBtn?.addEventListener('click', closeSettings);
    backdrop?.addEventListener('click', closeSettings);
  })();

  // ---- 视角模式：环绕 / 鱼眼第一视角 ----
  let cameraMode = 'orbit'; // 'orbit' | 'first'
  let camFishIndex = 0;
  let paused = false; // 空格暂停
  const keys = {}; // WASD 按键状态
  const fpDir = new THREE.Vector3();
  const fpEye = new THREE.Vector3();
  const fpLook = new THREE.Vector3();
  const fpQ = new THREE.Quaternion();
  const mvFwd = new THREE.Vector3();
  const mvRight = new THREE.Vector3();
  const mvDelta = new THREE.Vector3();

  function setCameraMode(mode) {
    cameraMode = mode;
    const isFirst = mode === 'first';
    controls.enabled = !isFirst;
    camera.fov = isFirst ? 65 : 55;
    camera.updateProjectionMatrix();
    hud.modeEl.textContent = isFirst ? `追尾视角 · 鱼#${camFishIndex}` : '环绕';
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      paused = !paused;
      hud.stateEl.textContent = paused ? '已暂停' : '运行';
    } else if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
      keys[e.code] = true;
    } else if (e.key === 'f' || e.key === 'F') {
      setCameraMode(cameraMode === 'orbit' ? 'first' : 'orbit');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (cameraMode === 'first') {
        camFishIndex = (camFishIndex + 1) % fishes.length;
        hud.modeEl.textContent = `追尾视角 · 鱼#${camFishIndex}`;
      }
    }
  });
  window.addEventListener('keyup', (e) => {
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) keys[e.code] = false;
  });

  // ---- 每帧更新 ----
  function update(dt, t) {
    globalT = t;

    // 敲缸冲击波纹动画（不随 paused 停止，保证视觉反馈能消退）
    if (updateRipples) updateRipples(dt);

    if (!paused) {
      for (const f of fishes) updateFish(f, t, dt, fishes);
      // 微小生物：小虾爬行 + 扬沙
      updateCreatures(creatures, tank, dt);
      // 鱼食：从上方落入水面→漂浮，鱼嘴碰到即被吃，1 分钟后自动消失
      if (FEATURES.feeding && WORLD.foods.length) {
        const waterY = TANK.BOTTOM + TANK.H - 0.6;
        const EAT_R2 = 0.45 * 0.45;
        for (let i = WORLD.foods.length - 1; i >= 0; i--) {
          const f = WORLD.foods[i];
          f.t += dt;
          if (f.falling) {
            f.vy -= 9 * dt;
            f.pos.y += f.vy * dt;
            if (f.pos.y <= waterY) { f.pos.y = waterY; f.falling = false; }
          } else {
            f.pos.y = waterY + Math.sin(t * 1.5 + f.phase) * 0.04;
          }
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
      // 掠食者：骨骼/边界/巡航由 updateFish 处理，追逐力叠加
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
        for (const axis of ['x', 'y', 'z']) {
          const mn = tank.bounds[axis][0], mx = tank.bounds[axis][1];
          if (pr.pos[axis] < mn) { pr.pos[axis] = mn; pr.vel[axis] = Math.abs(pr.vel[axis]); }
          else if (pr.pos[axis] > mx) { pr.pos[axis] = mx; pr.vel[axis] = -Math.abs(pr.vel[axis]); }
        }
      }
      // 气泡上升
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
      // 水草随水流摆动
      if (grassMeshes.length) {
        for (const g of grassMeshes) {
          g.rotation.z = Math.sin(t * 1.2 + g.userData.sway) * 0.12;
          g.rotation.x = Math.sin(t * 0.9 + g.userData.sway * 1.3) * 0.08;
        }
      }
      // 水面光斑动态纹理
      if (caustics) {
        const c = caustics;
        const cctx = c.ctx;
        cctx.clearRect(0, 0, c.w, c.h);
        cctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 9; i++) {
          const px = c.w / 2 + Math.sin(t * 0.5 + i * 1.7) * c.w * 0.3;
          const py = c.h / 2 + Math.cos(t * 0.4 + i * 2.1) * c.h * 0.3;
          cctx.beginPath();
          cctx.ellipse(px, py, 26 + 12 * Math.sin(t + i), 13 + 7 * Math.cos(t * 0.7 + i), i, 0, Math.PI * 2);
          cctx.fillStyle = `rgba(180, 230, 255, ${0.05 + 0.035 * Math.sin(t + i)})`;
          cctx.fill();
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
      // 追尾视角：锚点 = 头骨，偏移方向用速度方向（平滑）
      const fish = fishes[camFishIndex];
      const head = fish.userData.bones[0];
      fish.updateMatrixWorld(true);
      head.getWorldPosition(fpEye);
      fpDir.copy(fish.userData.vel);
      if (fpDir.lengthSq() < 1e-8) {
        head.getWorldQuaternion(fpQ);
        fpDir.set(0, 0, 1).applyQuaternion(fpQ);
      } else {
        fpDir.normalize();
      }
      camera.position.copy(fpEye).addScaledVector(fpDir, -2.2);
      camera.position.y += 0.8;
      camera.position.y += Math.sin(t * 14) * 0.02;
      camera.position.addScaledVector(fpDir, Math.sin(t * 9) * 0.06);
      fpLook.copy(fpEye).addScaledVector(fpDir, 6);
      camera.lookAt(fpLook);
    } else {
      controls.update();
    }
  }

  return { update };
}
