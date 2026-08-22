// 鱼缸场景（scenes/fish-tank）：生态时钟的第一个场景。
// 本模块承载鱼缸专属逻辑：URL 鱼参数解析、相机初始位、灯光、鱼群、缸体、
// 微小生物、喂食交互、掠食者、气泡、水草、水面光斑、实时参数面板、设置弹窗、
// 第一视角/WASD 相机，以及每帧的鱼群与外设更新。
// 通用框架（渲染器/场景/相机/控制/HUD/时钟/截图/PWA/UI切换）由 core/app.js 提供。

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import modelUrl from '../../../models/XH378sJqtgOHKGAXMdeNF.stl?url';
import { createCreatures, updateCreatures } from '../../creatures.js';
import { createFish, loadFishModel, randomPoint, resetShoalState, updateFish } from '../../fish.js';
import { buildTank, TANK } from '../../tank.js';
import { FEATURES, PARAMS, SETTINGS, WORLD } from './config.js';

// GLB 水草：改用 Vite 原生推荐方式动态引用（.glb?url 在 rolldown-vite 8 下不触发 asset emit）
const plantPackUrl = new URL('../../../models/underwater_plant_pack.glb', import.meta.url).href;
// GLB 石头（用户提供 stone_pack.glb：含 Big/Mid/Small/Runic/p1/p2 多品种，运行时按容器名识别，不切割）
const stonePackUrl = new URL('../../../models/stone_pack.glb', import.meta.url).href;

// 水草摆动标定（GLB 株顶点弯曲）：
// - TIP_SWAY_FRAC：叶尖最大摆幅 = 叶片长度的比例（0.06 ≈ ±6%，自然水流感，偏活泼可上调）
// - SWAY_FREQ_BASE：基础摆动角频率（rad/s），长叶自动 0.75×、短叶 1.25×（长慢短快）
const TIP_SWAY_FRAC = 0.06;
const SWAY_FREQ_BASE = 1.05;

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

  // ---- 加载 GLB 水草（sketchfab underwater plant pack，PBR 材质）----
  // 取出 plant_1/2/3 根节点备用；加载失败则回退程序化水草（不阻塞场景）。
  // gltfPlants: [{ name, obj }] 原始节点（从模型场景图摘出后需手动加入本场景）
  let gltfPlants = null;
  try {
    const gltf = await new GLTFLoader().loadAsync(plantPackUrl);
    const root = gltf.scene;
    // 递归查找 named plant_* 容器节点（sketchfab 导出层级深）。
    // 必须精确匹配节点名：submesh 名为 plant_3_plant_3_blade_0 等，若用 startsWith，
    // 遍历到子 mesh 时会覆盖容器节点，导致只摆一个 submesh 而丢其它部件（如只显示梭形果实、丢叶片）。
    const found = { plant_1: null, plant_2: null, plant_3: null };
    root.traverse((o) => {
      if (!o.isObject3D) return;
      for (const k of Object.keys(found)) {
        if (o.name === k && !found[k]) { found[k] = o; break; }
      }
    });
    gltfPlants = Object.entries(found)
      .filter(([, v]) => v)
      .map(([name, obj]) => ({ name, obj }));
    // 先摘除：scene.remove 会连带解绑，确保我们不把整棵模型树加入缸内
    for (const { obj } of gltfPlants) obj.parent?.remove(obj);
    // 材质如有透明需求已内嵌，无需额外处理
  } catch (e) {
    console.warn('[鱼缸] GLB 水草加载失败，回退程序化水草：', e);
    gltfPlants = null;
  }

  // ---- 加载 GLB 石头（stone_pack.glb）：运行时按容器节点名前缀识别品种，不切割原文件。
  // 只接 Big/Mid/Small 三种常规石（Runic 发光符文/p1/p2 卵石不接入）；加载失败回退程序化球体石。----
  let gltfStones = null;
  try {
    const gltf = await new GLTFLoader().loadAsync(stonePackUrl);
    const root = gltf.scene;
    const found = { Big: [], Mid: [], Small: [] };
    root.traverse((o) => {
      if (o.isMesh) return; // 只看容器节点（mesh 命名带 _xx_0 后缀，正则不会误匹配）
      for (const k of Object.keys(found)) {
        if (new RegExp('^' + k + '_\\d+$', 'i').test(o.name || '')) { found[k].push(o); break; }
      }
    });
    for (const k of Object.keys(found)) {
      for (const obj of found[k]) obj.parent?.remove(obj); // 摘除，只保留要摆的实例
    }
    gltfStones = found;
  } catch (e) {
    console.warn('[鱼缸] GLB 石头加载失败，回退程序化球体石：', e);
    gltfStones = null;
  }

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
  const rockGroups = [];   // 已摆放的石头根节点（数量调节重建用）
  let rebuildPlants = null; // 由 decor 块注入：按 SETTINGS.plantCount 重建 GLB 水草
  let rebuildRocks = null;  // 由 decor 块注入：按 SETTINGS.rockCount 重建石头
  if (FEATURES.decor) {
    const by0 = tank.bounds.y[0];
    // 沙床（缸底泥层）：加厚基底 + 细分地形沙面（正弦叠加自然起伏）。
    // 坐标：鱼活动下限 by0(-2.2)、线框缸底(-3)；基底顶面 -2.5、沙面起伏最高约 -1.7，
    // 石头/水草/小虾嵌坐其上；鱼有软边界(下3单位)几乎不贴底，视觉安全。
    const sandMat = new THREE.MeshStandardMaterial({ color: 0xd2b48c, roughness: 1, metalness: 0 });
    const bx0 = tank.bounds.x[0], bx1 = tank.bounds.x[1];
    const bz0 = tank.bounds.z[0], bz1 = tank.bounds.z[1];
    const sx = bx1 - bx0, sz = bz1 - bz0;
    const SAND_TOP = by0 - 0.3; // -2.5：沙面基准高度
    // 基底：加厚扁沙层（顶面 SAND_TOP，向下厚 1.8，底略超线框缸底作为泥层厚度）
    const bed = new THREE.Mesh(
      new THREE.BoxGeometry(sx, 1.8, sz),
      sandMat
    );
    bed.position.y = SAND_TOP - 0.9;
    scene.add(bed);
    // 起伏沙面：细分 PlaneGeometry 做连续自然地形（大尺度缓丘 + 中尺度起伏 + 细沙纹）
    const SEG = 40;
    const sandGeo = new THREE.PlaneGeometry(sx, sz, SEG, SEG);
    sandGeo.rotateX(-Math.PI / 2); // 平面躺平（法线朝上）
    const sPos = sandGeo.attributes.position;
    const sd = sPos.array;
    for (let i = 0; i < sPos.count; i++) {
      const x = sd[i * 3], z = sd[i * 3 + 2];
      const h =
        Math.sin(x * 0.22 + 1.3) * Math.cos(z * 0.30) * 0.90 +          // 大尺度缓丘
        Math.sin(x * 0.55 + z * 0.4) * Math.cos(z * 0.6 - x * 0.3) * 0.40 + // 中尺度起伏
        (Math.sin(x * 1.7 + Math.sin(z * 1.4) * 2.0) * 0.12);           // 细沙纹
      sd[i * 3 + 1] = SAND_TOP + h;
    }
    sandGeo.computeVertexNormals(); // 平滑法线让起伏受光照呈立体
    const sand = new THREE.Mesh(sandGeo, sandMat);
    scene.add(sand);
    // 石头（障碍物）：真实 GLB 石优先（Big 主锚/Mid 环绕/Small 点缀），失败回退程序化球体。
    // 摆放沿用水草思路：保留容器内建旋转、Box3 底部贴沙、等比缩放；碰撞半径按旋转后世界 AABB 估算。
    const placeRock = (srcObj, x, z, targetSize) => {
      const q = srcObj.quaternion.clone();
      const clone = srcObj.clone(true);
      clone.position.set(0, 0, 0); clone.rotation.set(0, 0, 0); clone.scale.set(1, 1, 1);
      const model = new THREE.Group();
      // 容器内建朝向 + 随机竖直(yaw)旋转：同品种多块不至于千篇一律同向。
      // 注意不能用 model.rotation.y（会整体替换 quaternion 丢掉容器朝向），须 premultiply 组合：
      // 最终旋转 = R_yaw ∘ R_container（先容器姿态、后绕世界 Y 随机转）
      model.quaternion
        .copy(q)
        .premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2));
      model.add(clone);
      model.updateMatrixWorld(true);
      let box = new THREE.Box3().setFromObject(model);
      const c = box.getCenter(new THREE.Vector3());
      model.position.set(-c.x, -box.min.y, -c.z); // 底部中心对齐到原点
      model.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(model);
      const sz = box.getSize(new THREE.Vector3());
      model.scale.multiplyScalar(targetSize / Math.max(sz.x, sz.y, sz.z, 1e-4));
      model.position.set(x, by0 + 0.02, z); // 微沉入沙（保留原模型内建方位，不随机旋转）
      model.updateMatrixWorld(true);
      scene.add(model);
      rockGroups.push(model); // 供数量调节时整体卸下
      box = new THREE.Box3().setFromObject(model);
      const fsz = box.getSize(new THREE.Vector3());
      // 叠层碰撞体：单球只覆盖中低部，高石上段会漏（鱼会从石头顶部穿过）→ 按高度叠 2~3 层球。
      // 底层半径按地面足迹、上层依次收窄，覆盖整块石的视觉体积。
      const horiz = Math.max(fsz.x, fsz.z);
      const layers = fsz.y > 5.5 ? 3 : 2;
      const fracs = layers === 3 ? [0.28, 0.6, 0.88] : [0.3, 0.75];
      const radii = layers === 3 ? [1, 0.92, 0.72] : [1, 0.8];
      for (let li = 0; li < layers; li++) {
        const r = THREE.MathUtils.clamp(horiz * 0.5 * 0.85 * radii[li], 0.7, 6.0);
        const col = { pos: new THREE.Vector3(x, by0 + fsz.y * fracs[li], z), radius: r, decor: 'rock' };
        WORLD.obstacles.push(col);   // 径向推力 + 位置级穿透解析
        WORLD.rockSpheres.push(col); // 射线式前瞻回避（fish.js visualAvoid）
      }
      return model;
    };
    const stoneReady = !!(gltfStones && (gltfStones.Big.length || gltfStones.Mid.length || gltfStones.Small.length));
    // 均匀抽稀：数量减少时仍保持品种混合（不取前 N 个导致清一色 Big）
    const subsetIndices = (len, n) => {
      if (n >= len) return Array.from({ length: len }, (_, i) => i);
      if (n <= 0) return [];
      if (n === 1) return [Math.round((len - 1) / 2)];
      const out = [];
      for (let k = 0; k < n; k++) out.push(Math.round((len - 1) * k / (n - 1)));
      return Array.from(new Set(out));
    };
    // 石头布局表（19 块：Big 主锚 5 + Mid 环绕 6 + Small 点缀 8）。
    // 尺寸 ≈4x 初版（用户要求石头明显大于鱼）：Big 8.5~12 / Mid 7.6~8.8 / Small 4.2~5.4。
    // 朝向：容器建模姿态保留，另加随机竖直 yaw（同品种多块朝向各异）。
    const rockSpots = [
      { kind: 'Big', x: -26, z: -20, s: 11 }, { kind: 'Big', x: 26, z: 18, s: 10.5 },
      { kind: 'Big', x: 18, z: -25, s: 12 }, { kind: 'Big', x: -20, z: 22, s: 10 },
      { kind: 'Big', x: 0, z: 20, s: 8.5 },
      { kind: 'Mid', x: -30, z: -6, s: 8.0 }, { kind: 'Mid', x: 14, z: -12, s: 8.5 },
      { kind: 'Mid', x: -8, z: -24, s: 8.8 }, { kind: 'Mid', x: 30, z: 4, s: 8.2 },
      { kind: 'Mid', x: -18, z: 10, s: 7.6 }, { kind: 'Mid', x: 8, z: 28, s: 8.2 },
      { kind: 'Small', x: -28, z: -30, s: 4.8 }, { kind: 'Small', x: 10, z: 8, s: 4.5 },
      { kind: 'Small', x: 28, z: 26, s: 4.8 }, { kind: 'Small', x: -10, z: 15, s: 4.2 },
      { kind: 'Small', x: -24, z: 16, s: 5.4 }, { kind: 'Small', x: 22, z: -8, s: 4.5 },
      { kind: 'Small', x: -14, z: -28, s: 4.8 }, { kind: 'Small', x: 31, z: -24, s: 4.2 },
    ];
    const placeRocks = (count) => {
      // 清旧：卸下石头 + 清碰撞（decor:'rock' 障碍 + rockSpheres 射线球）
      for (const m of rockGroups) scene.remove(m);
      rockGroups.length = 0;
      WORLD.rockSpheres.length = 0;
      WORLD.obstacles = WORLD.obstacles.filter((o) => o.decor !== 'rock');
      if (!stoneReady) return; // 回退程序化球体石（数量固定）不参与调节
      const picks = subsetIndices(rockSpots.length, Math.min(count, rockSpots.length));
      for (const idx of picks) {
        const { kind, x, z, s } = rockSpots[idx];
        const pool = gltfStones[kind];
        const src = pool[(Math.random() * pool.length) | 0];
        if (!src) continue;
        placeRock(src, x, z, s);
      }
    };
    if (stoneReady) {
      placeRocks(SETTINGS.rockCount); // 首次按设置数量摆放；之后由设置弹窗"确定"重建
    } else {
      // 回退：程序化球体石头
      const rockGeo = new THREE.SphereGeometry(0.7, 10, 8);
      const rockMat = new THREE.MeshStandardMaterial({ color: 0x6b7a52, roughness: 0.9 });
      for (const [x, z] of [[-26, -20], [26, 18], [18, -25], [-20, 22], [0, 20]]) {
        const rock = new THREE.Mesh(rockGeo, rockMat);
        rock.position.set(x, by0 + 0.25, z);
        rock.scale.set(1, 0.65, 0.9);
        rock.rotation.y = Math.random() * Math.PI;
        scene.add(rock);
        WORLD.obstacles.push({ pos: rock.position, radius: 0.85 });
      }
    }
    rebuildRocks = placeRocks; // 石头数量重建入口（设置弹窗"确定"调用）
    // 水草：优先摆放 GLB 真实水草（plant_1/2/3，PBR 材质），加载失败则回退程序化细条。
    // 两类都加入 grassMeshes，统一随水流轻微摆动。
    const grassMat = new THREE.MeshStandardMaterial({
      color: 0x3f8f4a, roughness: 0.7, side: THREE.DoubleSide,
    });
    // GLB 株归一化摆放：把模型根部/底部归零到缸底、缩放到目标高度。
    // 关键点：
    // 1) 模型内建旋转（GLB 里 plant 容器带 -90° 旋转把 z 长轴立起）必须保留在 model.quaternion，
    //    清零会躺平；
    // 2) 底部对齐平移放在 model.position（holder 空间），而不是 clone.position——
    //    clone 在 model 旋转子空间内，position.y 会被旋转掉，导致根部埋沙；
    // 3) 对齐与缩放均基于"旋转后几何盒"（setFromObject(model)），保证根部贴沙。
    const placePlant = (srcObj, x, z, targetH, rotY, offY = 0) => {
      const q = srcObj.quaternion.clone(); // 模型内建旋转（立起朝向）
      const clone = srcObj.clone(true);
      clone.position.set(0, 0, 0);
      clone.rotation.set(0, 0, 0);
      clone.scale.set(1, 1, 1);
      // 顶点弯曲准备：clone(true) 共享 geometry，需对每个 mesh 深克隆几何。
      // 生长轴证据（inspect-glb 解析 models/underwater_plant_pack.glb）：
      //   plant_3：叶片/reed，容器把【本地 z】转到世界朝上（叶片 z 长轴 17.16）；
      //   plant_1：单 mesh 整株灌木，AABB 近各向同性（14.6/13.3/12.0），容器把【本地 -x】转到朝上；
      //   plant_2：单 mesh 大片，长轴本地 x（80.9），容器把【本地 +x】转到朝上。
      // 不能假设"本地 z 是高度"。统一做法：由容器内建旋转 q 求出该株"世界朝上"在
      // mesh 局部空间的方向 upLocal；高度 = 顶点向 upLocal 投影，摆动 = ⊥upLocal 平面内的椭圆。
      const qInv = q.clone().invert();
      const upLocal = new THREE.Vector3(0, 1, 0).applyQuaternion(qInv).normalize();
      const bendMeshes = [];
      clone.traverse((o) => {
        if (!o.isMesh || !o.geometry?.attributes?.position) return;
        o.geometry = o.geometry.clone(); // 独立几何，避免多株共享一份被改写
        const pos = o.geometry.attributes.position;
        const arr = pos.array;
        const count = pos.count;
        // 沿 upLocal 的高度范围：AABB 8 角投影取 min/max
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const { min, max } = o.geometry.boundingBox;
        let sMin = Infinity, sMax = -Infinity;
        for (let k = 0; k < 8; k++) {
          const x = (k & 1) ? max.x : min.x;
          const y = (k & 2) ? max.y : min.y;
          const z = (k & 4) ? max.z : min.z;
          const s = upLocal.x * x + upLocal.y * y + upLocal.z * z;
          if (s < sMin) sMin = s;
          if (s > sMax) sMax = s;
        }
        const sSpan = Math.max(sMax - sMin, 1e-4);
        const invSpan = 1 / sSpan;
        // 摆动轴 b/c（⊥upLocal 的局部水平面两轴，椭圆摆）：参考轴避开 upLocal 平行方向
        const ref = Math.abs(upLocal.x) > 0.9
          ? new THREE.Vector3(0, 0, 1)
          : new THREE.Vector3(1, 0, 0);
        const b = new THREE.Vector3().crossVectors(upLocal, ref).normalize();
        const c = new THREE.Vector3().crossVectors(b, upLocal).normalize();
        // 逐顶点预计算（每帧只用 2 个 sin，不重复 dot/pow）：
        //  wArr = 悬臂权重 h^1.8（根稳尖活，h=沿生长轴的归一高度）
        //  stArr = 行波相位（沿高度相位递进 → 摆动从根部向叶尖传递）
        const wArr = new Float32Array(count);
        const stArr = new Float32Array(count);
        for (let v = 0; v < count; v++) {
          const s = upLocal.x * arr[v * 3] + upLocal.y * arr[v * 3 + 1] + upLocal.z * arr[v * 3 + 2];
          const h = Math.min(1, Math.max(0, (s - sMin) * invSpan));
          wArr[v] = Math.pow(h, 1.8);
          stArr[v] = s * 0.35;
        }
        bendMeshes.push({
          pos, arr,
          base: Float32Array.from(arr), // 原始顶点（弯曲基准）
          sSpan,
          // 摆动幅度按叶片长度等比（TIP_SWAY_FRAC×sSpan）：各株缩放后视觉一致，
          // 不再受"局部单位×缩放"的株间差异影响
          amp: sSpan * TIP_SWAY_FRAC,
          wArr, stArr,
          bx: b.x, by: b.y, bz: b.z,
          cx: c.x, cy: c.y, cz: c.z,
        });
      });
      // 长慢短快：按株内最长 mesh 归一，长叶片频率低、短叶片频率高（自然柔度差）
      const maxSpan = bendMeshes.reduce((m, bm) => Math.max(m, bm.sSpan), 0);
      for (const bm of bendMeshes) {
        bm.freq = SWAY_FREQ_BASE * (0.75 + 0.5 * (1 - bm.sSpan / maxSpan));
      }
      // 旋转层 model：承载内建旋转；对齐平移放这里（不受旋转影响）
      const model = new THREE.Group();
      model.quaternion.copy(q);
      model.add(clone);
      // 旋转后几何盒 → 底部中心对齐到 model 局部原点（= 后续 holder 原点）
      model.updateMatrixWorld(true);
      let box = new THREE.Box3().setFromObject(model);
      const c = box.getCenter(new THREE.Vector3());
      model.position.set(-c.x, -box.min.y, -c.z);
      // 摆放层 holder：位置 + 水平旋转 + 等比缩放 + 纵向微调
      const holder = new THREE.Group();
      holder.add(model);
      holder.rotation.y = rotY;
      // 缩放：旋转后高度（等比缩放围绕 holder 原点，底部稳定）
      model.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(model);
      const h = box.getSize(new THREE.Vector3()).y;
      holder.scale.setScalar(targetH / Math.max(h, 1e-4));
      holder.position.set(x, by0 + 0.05 + offY, z);
      holder.userData.sway = Math.random() * Math.PI * 2; // 摆动相位种子
      // GLB 株整株微倾不写死在此（每帧 rotation.z/x 由茎干摆动驱动），swayAmp 仅供程序化细条用
      holder.userData.bendMeshes = bendMeshes; // 顶点弯曲数据
      // 鱼↔草互动：碰撞半径按旋转后水平跨度估算；拨叶感知半径；冲量状态。
      {
        const mSz = box.getSize(new THREE.Vector3());
        const hz = Math.max(mSz.x, mSz.z) * holder.scale.x;
        const r = THREE.MathUtils.clamp(hz * 0.5 * 0.55, 0.5, 1.5);
        holder.userData.colliderR = r;
        holder.userData.proxR = THREE.MathUtils.clamp(r * 2.2, 2.0, 4.6);
        holder.userData.impulse = 0;
        if (FEATURES.plantCollide) {
          WORLD.obstacles.push({ pos: new THREE.Vector3(x, by0 + 0.6, z), radius: r, decor: 'plant' });
          WORLD.obstacles.push({ pos: new THREE.Vector3(x, by0 + 0.35 + targetH * 0.55, z), radius: r * 0.72, decor: 'plant' });
        }
        WORLD.plantRefs.push(holder); // E 蹭叶轻啄：记录 GLB 草株引用
      }
      scene.add(holder);
      grassMeshes.push(holder);
    };
    // ---- 底层小杂草（程序化细条，做地被层填满空地；GLB 株间点缀）----
    const addBlade = (h, radius, seg = 8) => {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0.12, h * 0.4, 0.06),
        new THREE.Vector3(-0.1, h * 0.75, -0.06),
        new THREE.Vector3(0.06, h, 0.03),
      ]);
      const grass = new THREE.Mesh(new THREE.TubeGeometry(curve, seg, radius, 6, false), grassMat);
      grass.userData.sway = Math.random() * Math.PI * 2;
      grass.userData.swayAmp = 0.12; // 细条摇摆幅度大
      scene.add(grass);
      grassMeshes.push(grass);
      return grass;
    };
    // GLB 株布局：[x, z, 目标高度, 水平旋转]；对齐已保证根部贴沙面。
    // 模型顶点量级小（每株 1.5~2k 顶点），桌面 16 株混排无压力；移动端减半省功耗。
    if (gltfPlants && gltfPlants.length) {
      // 桌面：高草 plant_3×5 + 灌木 plant_1×6 + 大叶 plant_2×5，高低错落铺满缸底；
      // 移动端：plant_3×2 + plant_1×3 + plant_2×3（8 株）。
      // 造景布局（按真实水族缸法则）：前/中/后景分层 + 硬景观为骨（绕石成丛）+
      // 同种成丛（丛间留隙）+ 不对称三角构图（左后主丛重、右后次丛轻）+ 中央留白（时钟/鱼群视域）。
      // 后景（-z 远镜头）高草成丛 + 时钟后景草墙（衬托钟面），中景绕石放大叶，
      // 前景（+z 近镜头）仅中矮灌木过渡不遮挡。株型较前版放大≈1.3x（用户要求，钟面仍不被挡）。
      const spots = isMobile ? [
        // 移动端（12 株）：同构图缩略，株高 ≈桌面 0.8
        { kind: 'plant_3', x: -24, z: -20, h: 8.4, ry: 0.4 },
        { kind: 'plant_3', x: 24, z: -18, h: 7.8, ry: -0.5 },
        { kind: 'plant_3', x: -6, z: -30, h: 7.6, ry: 1.6 },
        { kind: 'plant_3', x: 16, z: -29, h: 7.2, ry: 0.1 },
        { kind: 'plant_2', x: -18, z: -8, h: 5.8, ry: 1.2 },
        { kind: 'plant_2', x: 16, z: -10, h: 5.6, ry: -1.0 },
        { kind: 'plant_2', x: 23, z: 15, h: 5.2, ry: 0.7 },
        { kind: 'plant_2', x: -19, z: 20, h: 5.0, ry: 1.4 },
        { kind: 'plant_1', x: -14, z: 20, h: 4.4, ry: 0.6 },
        { kind: 'plant_1', x: 18, z: 18, h: 4.2, ry: -0.8 },
        { kind: 'plant_1', x: 0, z: 26, h: 4.0, ry: 0.0 },
        { kind: 'plant_1', x: 6, z: -14, h: 4.4, ry: 2.0 },
      ] : [
        // 后景高草丛（主景）：左后角三株斜向三角丛，左上黄金分割视觉锚点，株高 9~10.5
        { kind: 'plant_3', x: -31, z: -26, h: 10.5, ry: 0.3 },
        { kind: 'plant_3', x: -24, z: -31, h: 9.8, ry: 1.1 },
        { kind: 'plant_3', x: -32, z: -31, h: 9.0, ry: -0.6 },
        // 后景高草丛（次景）：右后角两株 + 更后一株，左重右轻不对称
        { kind: 'plant_3', x: 31, z: -25, h: 9.5, ry: 0.8 },
        { kind: 'plant_3', x: 25, z: -31, h: 8.6, ry: 1.9 },
        { kind: 'plant_3', x: 27, z: -33, h: 8.4, ry: -1.0 },
        // 时钟后景草墙：钟面正后方两株对称框架，衬托中央焦点（经典背景墙手法）
        { kind: 'plant_3', x: -8, z: -32, h: 9.0, ry: -0.4 },
        { kind: 'plant_3', x: 8, z: -32, h: 9.2, ry: 0.4 },
        // 中后点缀与左翼一株
        { kind: 'plant_3', x: 12, z: -32, h: 9.2, ry: 1.4 },
        { kind: 'plant_3', x: -33, z: -12, h: 8.2, ry: -1.6 },
        // 中景 plant_2 大叶：绕左后石(-26,-20)成丛
        { kind: 'plant_2', x: -23, z: -17, h: 7.4, ry: 0.4 },
        { kind: 'plant_2', x: -29, z: -22, h: 6.8, ry: 1.6 },
        // 中景 plant_2：绕右后石(18,-25)成丛
        { kind: 'plant_2', x: 21, z: -22, h: 7.2, ry: -0.7 },
        { kind: 'plant_2', x: 15, z: -28, h: 6.6, ry: 2.0 },
        // 前右石(26,18)成丛
        { kind: 'plant_2', x: 24, z: 15, h: 6.4, ry: 0.1 },
        { kind: 'plant_2', x: 29, z: 20, h: 6.0, ry: 1.2 },
        // 左前石(-20,22)成丛
        { kind: 'plant_2', x: -17, z: 19, h: 6.2, ry: 1.8 },
        { kind: 'plant_2', x: -23, z: 25, h: 5.6, ry: -0.9 },
        // 前景过渡 plant_1 灌木：前中石(0,20)两侧半围（矮，不挡钟面下缘）
        { kind: 'plant_1', x: 3, z: 24, h: 5.2, ry: 0.5 },
        { kind: 'plant_1', x: -4, z: 24, h: 4.8, ry: -0.5 },
        // 左前丛
        { kind: 'plant_1', x: -14, z: 26, h: 5.0, ry: 0.9 },
        { kind: 'plant_1', x: -24, z: 28, h: 4.6, ry: 1.7 },
        // 右前丛
        { kind: 'plant_1', x: 31, z: 12, h: 4.8, ry: -0.3 },
        { kind: 'plant_1', x: 20, z: 28, h: 4.4, ry: 0.2 },
        // 中景填隙（时钟侧后方，丛顶约 y3 远低于钟面）
        { kind: 'plant_1', x: -8, z: -4, h: 5.2, ry: 1.2 },
        { kind: 'plant_1', x: 10, z: -6, h: 5.4, ry: -0.6 },
        // 左后填隙
        { kind: 'plant_1', x: -31, z: -14, h: 5.6, ry: 2.2 },
      ];
      const placePlants = (count) => {
        // 清旧 GLB 水草：卸下 + 释放几何（株几何在 placePlant 内已深克隆，独立可安全 dispose）+ 清碰撞/引用
        for (let i = grassMeshes.length - 1; i >= 0; i--) {
          const g = grassMeshes[i];
          if (!g.userData.bendMeshes?.length) continue;
          scene.remove(g);
          g.traverse((o) => { if (o.isMesh) o.geometry?.dispose?.(); });
          grassMeshes.splice(i, 1);
        }
        WORLD.plantRefs.length = 0;
        WORLD.obstacles = WORLD.obstacles.filter((o) => o.decor !== 'plant');
        const picks = subsetIndices(spots.length, Math.min(count, spots.length));
        for (const idx of picks) {
          const { kind, x, z, h, ry, offY = 0 } = spots[idx];
          const src = gltfPlants.find((p) => p.name === kind);
          if (!src) continue;
          placePlant(src.obj, x, z, h, ry + (Math.random() - 0.5) * 0.4, offY);
        }
      };
      placePlants(SETTINGS.plantCount); // 首次按设置数量摆放；之后由设置弹窗"确定"重建
      rebuildPlants = placePlants;
    } else {
      // 程序化回退：细条水草（GLB 加载失败时兜底）
      for (let i = 0; i < 14; i++) {
        const h = 1.1 + Math.random() * 1.3;
        const gx = tank.bounds.x[0] + 2 + Math.random() * (tank.bounds.x[1] - tank.bounds.x[0] - 4);
        const gz = tank.bounds.z[0] + 2 + Math.random() * (tank.bounds.z[1] - tank.bounds.z[0] - 4);
        const grass = addBlade(h, 0.045);
        grass.position.set(gx, by0, gz);
      }
    }
    // 空地地被层：小杂草铺满缸底（GLB 株间点缀，让底部不空旷）。
    // 中央留白带（时钟正下方 + 前向视野）：|x|<7 且 z∈(-12,22) 内不种草，留作鱼群游泳道。
    const UG_COUNT = isMobile ? 16 : 40;
    const inSwimLane = (x, z) => Math.abs(x) < 7 && z > -12 && z < 22;
    let ugPlaced = 0, ugTries = 0;
    while (ugPlaced < UG_COUNT && ugTries < UG_COUNT * 8) {
      ugTries++;
      const gx = tank.bounds.x[0] + 1.5 + Math.random() * (tank.bounds.x[1] - tank.bounds.x[0] - 3);
      const gz = tank.bounds.z[0] + 1.5 + Math.random() * (tank.bounds.z[1] - tank.bounds.z[0] - 3);
      if (inSwimLane(gx, gz)) continue;
      const grass = addBlade(0.6 + Math.random() * 0.9, 0.035, 6);
      grass.position.set(gx, by0, gz);
      ugPlaced++;
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
    const plantInput = document.getElementById('setting-plant');
    const plantVal = document.getElementById('setting-plant-val');
    const rockInput = document.getElementById('setting-rock');
    const rockVal = document.getElementById('setting-rock-val');
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
      if (plantInput) { plantInput.value = SETTINGS.plantCount; plantVal.textContent = SETTINGS.plantCount; }
      if (rockInput) { rockInput.value = SETTINGS.rockCount; rockVal.textContent = SETTINGS.rockCount; }
      modal.classList.remove('hidden');
    }
    function closeSettings() {
      modal.classList.add('hidden');
    }
    countInput?.addEventListener('input', () => { countVal.textContent = countInput.value; });
    sizeInput?.addEventListener('input', () => { sizeVal.textContent = (+sizeInput.value).toFixed(1); });
    minInput?.addEventListener('input', () => { minVal.textContent = (+minInput.value).toFixed(2); });
    maxInput?.addEventListener('input', () => { maxVal.textContent = (+maxInput.value).toFixed(2); });
    plantInput?.addEventListener('input', () => { plantVal.textContent = plantInput.value; });
    rockInput?.addEventListener('input', () => { rockVal.textContent = rockInput.value; });
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
      const decorChanged = (plantInput && SETTINGS.plantCount !== +plantInput.value)
        || (rockInput && SETTINGS.rockCount !== +rockInput.value);
      FEATURES.scatterPanic = scatterChk.checked;
      SETTINGS.fishCount = +countInput.value;
      SETTINGS.fishSize = +sizeInput.value;
      SETTINGS.randomSize = randomChk.checked;
      SETTINGS.sizeMin = +minInput.value;
      SETTINGS.sizeMax = +maxInput.value;
      if (plantInput) SETTINGS.plantCount = +plantInput.value;
      if (rockInput) SETTINGS.rockCount = +rockInput.value;
      closeSettings();
      if (sizeChanged) {
        rebuildFish();
        if (cameraMode === 'first' && camFishIndex >= fishes.length) {
          camFishIndex = Math.max(0, fishes.length - 1);
        }
      }
      if (decorChanged) {
        // 水草/石头数量重建（均匀抽稀，品种混合；GLB 缺失时对应入口为 null 自动跳过）
        if (rebuildPlants) rebuildPlants(SETTINGS.plantCount);
        if (rebuildRocks) rebuildRocks(SETTINGS.rockCount);
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
      // 鱼↔草·拨叶冲量（B）：鱼靠近株基（proxR 内）→ 冲量逼近近度；鱼离开后按 5/s 衰减弹回。
      if (FEATURES.plantImpulse) {
        const ik = 1 - Math.exp(-dt * 5);
        for (const g of grassMeshes) {
          if (!g.userData.bendMeshes?.length) continue;
          let near = 0;
          const pr = g.userData.proxR ?? 3, pr2 = pr * pr;
          for (const f of fishes) {
            const dx = f.position.x - g.position.x;
            const dy = f.position.y - g.position.y;
            const dz = f.position.z - g.position.z;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < pr2) {
              const v = 1 - Math.sqrt(d2) / pr;
              if (v > near) near = v;
              if (near > 0.95) break;
            }
          }
          g.userData.impulse += (near - g.userData.impulse) * ik;
        }
      }
      // 水草随水流摆动：
      // - GLB 株：叶片逐顶点悬臂弯曲（根部锚定、沿生长轴投影、摆幅随长度等比）+
      //           茎干整体微倾（绕根部枢轴），两层叠加成"茎摆+叶颤"复合运动；
      // - 程序化细条：整体 rotation（细条本就该整体偏）。
      if (grassMeshes.length) {
        for (const g of grassMeshes) {
          if (g.userData.bendMeshes?.length) {
            const gSeed = g.userData.sway;
            const imp = g.userData.impulse ?? 0; // 鱼拨叶冲量：放大摆幅 + 相位推离
            const impAmp = 1 + imp * 1.1;
            for (const bm of g.userData.bendMeshes) {
              const src = bm.base, dst = bm.arr;
              const wv = bm.wArr, stv = bm.stArr;
              const ph0 = t * bm.freq + gSeed + imp * 0.9;
              const amp = bm.amp * impAmp;
              const { bx, by, bz, cx, cy, cz } = bm;
              for (let i = 0, v = 0; i < src.length; i += 3, v++) {
                // 行波相位：沿高度相位递进，摆动从根部传向叶尖
                const ph = ph0 + stv[v];
                const s1 = Math.sin(ph);
                const s2 = Math.sin(ph * 0.75 + 1.7); // 二次分量 → 椭圆摆动，类真实叶颤
                const w = amp * wv[v];
                dst[i] = src[i] + (bx * s1 + cx * 0.5 * s2) * w;
                dst[i + 1] = src[i + 1] + (by * s1 + cy * 0.5 * s2) * w;
                dst[i + 2] = src[i + 2] + (bz * s1 + cz * 0.5 * s2) * w;
              }
              bm.pos.needsUpdate = true;
            }
            // 茎干整体微倾（holder 原点=根部贴沙点，绕此枢轴整体倾斜，根不动冠动）；
            // 冲量放大倾角 → 鱼冲过时整株明显让路
            const tilt = g.userData.sway;
            const tiltAmp = 1 + imp * 1.6;
            g.rotation.z = Math.sin(t * 0.55 + tilt) * 0.030 * tiltAmp;
            g.rotation.x = Math.sin(t * 0.46 + tilt * 1.3 + 1.3) * 0.022 * tiltAmp;
          } else {
            const amp = g.userData.swayAmp ?? 0.12;
            g.rotation.z = Math.sin(t * 1.2 + g.userData.sway) * amp;
            g.rotation.x = Math.sin(t * 0.9 + g.userData.sway * 1.3) * amp * 0.66;
          }
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
