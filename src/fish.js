import * as THREE from 'three';
import { FEATURES, PARAMS, WORLD } from './config.js';

const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpAcc = new THREE.Vector3();
const tmpSep = new THREE.Vector3();
const tmpAlign = new THREE.Vector3();
const tmpCoh = new THREE.Vector3();
const tmpDelta = new THREE.Vector3();
const tmpForward = new THREE.Vector3();
const tmpUp = new THREE.Vector3();
const tmpAxis = new THREE.Vector3();
const tmpQ2 = new THREE.Quaternion();
const tmpM = new THREE.Matrix4();
const Z_AXIS = new THREE.Vector3(0, 0, 1);

// ---- 骨骼结构常量（非可调）----
const BONE_COUNT = 6;        // 骨骼段数：头骨 + 5 段身体/尾骨
const SEG_LEN = 0.3;         // 相邻骨骼的恒定距离（跟随约束半径）
const SWAY_PHASE = 0.9;      // 相邻骨骼摆动的相位差（沿身体传播，形成波动）
const VISUAL_RAYS = [-55, -27, 0, 27, 55]; // 视野锥采样偏角（度，相对前方向）

// Boids/边界/摆尾参数全部由 config.js 的 PARAMS 提供（updateFish 内解构，实时可调）

// 诊断开关：定位边界处偏转角跳变（排查后可改为 false）
const DEBUG_AVOID = false;
let debugFrame = 0;

/**
 * 鱼身轮廓半径（t: 0=头 … 1=尾），分段线性插值出流线型
 */
function bodyRadius(t) {
  const cp = [
    [0.00, 0.36],
    [0.18, 0.50],
    [0.55, 0.52],
    [0.80, 0.28],
    [0.95, 0.10],
    [1.00, 0.05],
  ];
  for (let i = 1; i < cp.length; i++) {
    if (t <= cp[i][0]) {
      const [t0, r0] = cp[i - 1];
      const [t1, r1] = cp[i];
      return r0 + (r1 - r0) * (t - t0) / (t1 - t0);
    }
  }
  return cp[cp.length - 1][1];
}

/**
 * 创建一条鱼：骨骼链 + （STL 蒙皮模型 或 程序化鱼身兜底）
 * - bones[i]：骨骼节点（THREE.Bone），决定每段朝向与位置
 * - modelGeo：提供则 STL 模型蒙皮到骨骼（随骨骼弯曲摆动）
 * - 未提供 modelGeo 时回退为程序化鱼身（椭球身段 + 各鳍 + 眼睛）
 */
export function createFish({ color, size = 1, speed = 1, bounds, modelGeo = null, showBones = false, predator = false }) {
  const group = new THREE.Group();
  // STL 不含颜色：模型模式统一银灰；程序化兜底模式用传入 color
  const bodyMat = new THREE.MeshStandardMaterial({
    color: modelGeo ? 0xffffff : color, // 模型模式用顶点色（材质色×顶点色会双重变暗）
    roughness: 0.35,
    metalness: 0.15,
    vertexColors: !!modelGeo, // STL 模型用顶点色表达部位配色（背深腹浅/鳍色）
  });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0b0f12 });

  // 骨骼链（Bone）
  const bones = [];
  for (let i = 0; i < BONE_COUNT; i++) {
    const bone = new THREE.Bone();
    bone.position.set(0, 0, -i * SEG_LEN * size);
    bones.push(bone);
    group.add(bone);
    // 调试 marker：小球挂在骨骼上，直观显示骨骼姿态
    if (showBones) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 8, 6),
        new THREE.MeshBasicMaterial({ color: i === 0 ? 0x00ff66 : 0xff3377 })
      );
      bone.add(marker);
    }
  }

  const ud = {
    bounds,
    speed,
    cruise: speed, // 当前巡航速度（速率匹配用）
    radius: 0.45 * size, // 碰撞半径（仍按头部球处理）
    isPredator: !!predator, // 掠食者：跳过群游感知/随机游走，由外部追逐逻辑驱动
    phase: Math.random() * Math.PI * 2,
    vel: new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() - 0.5,
      Math.random() - 0.5
    ),
    bones,
    segLen: SEG_LEN * size,
    // 每段骨骼上一帧 prev->cur 的方向（惯性记忆，保证距离恒定的同时柔软跟随）
    dirs: Array.from({ length: BONE_COUNT }, () => new THREE.Vector3(0, 0, -1)),
    effort: 0, // 发力强度 0~1（加速度/转向合成，驱动摆尾幅度，纯视觉）
    lastDir: new THREE.Vector3(0, 0, 1), // 上一帧速度方向（用于计算转向强度）
    avoidYaw: 0, // 视觉回避目标偏转角（低通平滑，防止边界前朝向抖动/旋转）
    swayPhase: Math.random() * Math.PI * 2, // 摆尾相位（相位积分，避免时变频率的抖动尖峰）
    index: -1, // 调试编号
    prevYawTarget: 0, // 上一帧目标偏转角（跳变检测）
    prevAvoidYaw: 0, // 上一帧平滑偏转角（跳变检测）
    lastLogTime: -9, // 诊断日志节流时间戳
  };

  if (modelGeo) {
    // ---- STL 模型蒙皮到骨骼链 ----
    setupSkin(modelGeo, bones, ud.segLen);
    // 每条鱼克隆几何并按其主色生成部位顶点色（背深腹浅、尾鳍/背鳍深、头略深）
    const geo = modelGeo.clone();
    applyFishColors(geo, new THREE.Color(color));
    const skinned = new THREE.SkinnedMesh(geo, bodyMat);
    // 关键：bind 前先更新骨骼矩阵。否则骨骼 matrixWorld 仍是单位矩阵，
    // inverseBindMatrix 全为 identity，蒙皮双重平移导致模型沿体长拉伸、比例失真
    group.updateMatrixWorld(true);
    skinned.bind(new THREE.Skeleton(bones));
    group.add(skinned);
    ud.skinned = skinned;
  } else {
    // ---- 程序化鱼身兜底 ----
    for (let i = 0; i < BONE_COUNT; i++) {
      const t = i / (BONE_COUNT - 1);
      const bone = bones[i];
      const r = bodyRadius(t) * size;
      // 鱼身段：拉长的椭球，侧扁
      const seg = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), bodyMat);
      seg.scale.set(r * 1.3, r * 0.75, SEG_LEN * size * 0.62);
      bone.add(seg);

      // 背鳍
      if (i >= 1 && i <= 3) {
        const dh = 0.4 * size * (i === 1 ? 1 : 1 - (i - 1) * 0.28);
        const dorsal = new THREE.Mesh(
          new THREE.ConeGeometry(0.14 * size, dh, 3),
          bodyMat
        );
        dorsal.position.set(0, r * 0.75 * size + dh * 0.45, 0);
        dorsal.rotation.x = -0.9;
        bone.add(dorsal);
      }
      // 臀鳍
      if (i >= 3 && i <= 4) {
        const anal = new THREE.Mesh(
          new THREE.ConeGeometry(0.1 * size, 0.3 * size, 3),
          bodyMat
        );
        anal.position.set(0, -r * 0.75 * size - 0.12 * size, 0);
        anal.rotation.x = 0.9;
        bone.add(anal);
      }
    }

    // 头骨：眼睛 + 胸鳍
    const head = bones[0];
    const eyeGeo = new THREE.SphereGeometry(0.055 * size, 8, 6);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(0.27 * size, 0.09 * size, 0.4 * size);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeR.position.set(-0.27 * size, 0.09 * size, 0.4 * size);
    head.add(eyeL, eyeR);

    const finGeo = new THREE.SphereGeometry(1, 6, 4);
    const finL = new THREE.Mesh(finGeo, bodyMat);
    finL.scale.set(0.05, 0.15, 0.26);
    finL.position.set(0.34 * size, -0.04 * size, 0.08 * size);
    const finR = finL.clone();
    finR.position.x = -finL.position.x;
    head.add(finL, finR);

    // 尾鳍
    const finGeo2 = new THREE.CircleGeometry(0.5 * size, 10, -0.475 * Math.PI, 0.95 * Math.PI);
    const fin = new THREE.Mesh(finGeo2, bodyMat);
    fin.position.set(0, 0, -(BONE_COUNT - 1) * SEG_LEN * size - SEG_LEN * size * 0.5);
    group.add(fin);
    ud.fin = fin;
    ud.finL = finL;
    ud.finR = finR;
  }

  group.userData = ud;
  return group;
}

export function randomPoint(bounds) {
  return new THREE.Vector3(
    THREE.MathUtils.randFloat(bounds.x[0], bounds.x[1]),
    THREE.MathUtils.randFloat(bounds.y[0], bounds.y[1]),
    THREE.MathUtils.randFloat(bounds.z[0], bounds.z[1])
  );
}

/**
 * 解析二进制 STL 为 BufferGeometry（无外部依赖）
 * 格式：80 字节头 + uint32 三角形数 + 每三角形 50 字节（法线12 + 顶点36 + 属性2）
 */
function parseBinarySTL(buffer) {
  const dv = new DataView(buffer);
  const triCount = dv.getUint32(80, true);
  const positions = new Float32Array(triCount * 9);
  let o = 0;
  for (let i = 0; i < triCount; i++) {
    const base = 84 + i * 50 + 12; // 跳过法线，直接读 3 个顶点
    for (let j = 0; j < 9; j++) {
      positions[o++] = dv.getFloat32(base + j * 4, true);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * 合并位置相同的顶点并重建索引，使相邻面共享顶点，平滑法线（消除 STL 硬边）
 */
function mergeVertices(geo, tolerance = 1e-5) {
  const pos = geo.attributes.position;
  const inv = 1 / tolerance;
  const keyOf = (x, y, z) =>
    `${Math.round(x * inv)},${Math.round(y * inv)},${Math.round(z * inv)}`;
  const map = new Map();
  const verts = [];
  const index = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = keyOf(x, y, z);
    let idx = map.get(key);
    if (idx === undefined) {
      idx = verts.length / 3;
      map.set(key, idx);
      verts.push(x, y, z);
    }
    index.push(idx);
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  merged.setIndex(index);
  merged.computeVertexNormals();
  return merged;
}

/**
 * 加载并预处理 STL 鱼模型
 * - 体长轴 X → 体轴 +Z（头朝 +Z，与骨骼链一致）
 * - 缩放使体长对齐骨骼链总长，中心对齐骨骼链中点
 * @param {string} url 模型资源 URL
 * @returns {Promise<THREE.BufferGeometry>}
 */
/**
 * 依据模型几何（体长 Z、背 +Y、头 +Z，缩放到 1.5 体长）给每个顶点计算"部位着色系数"，
 * 存为 partShade 属性。真实鱼类配色部位差异：
 * 尾鳍（z<-1.32）深色、头部（z>-0.3）略深、背鳍顶部（y>0.3）深色；
 * 反荫蔽（背深腹浅）在应用主色时用 y 坐标计算
 */
function computePartShade(geo) {
  const pos = geo.attributes.position.array;
  const n = pos.length / 3;
  const shade = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    let s = 1;
    if (z < -1.32) s = 0.55; // 尾鳍：深色
    else if (z > -0.3) s = 0.9; // 头部：略深
    else if (y > 0.3 && z > -1.1 && z < -0.5) s = 0.82; // 背鳍顶部：深色
    shade[i] = s;
  }
  geo.setAttribute('partShade', new THREE.BufferAttribute(shade, 1));
}

// 由主色生成每顶点颜色：反荫蔽（背深腹浅）+ 部位系数。
// 现实鱼类：背部深（伪装）、腹部浅（从下看融入水面光）、尾鳍/背鳍深
function applyFishColors(geo, baseColor) {
  const pos = geo.attributes.position.array;
  const normal = geo.attributes.normal.array;
  const shade = geo.attributes.partShade.array;
  const n = shade.length;
  const colors = new Float32Array(n * 3);
  const hy = 0.377; // 背腹半高（模型缩放到 1.5 体长后的实测值）
  const col = new THREE.Color();
  const WHITE = new THREE.Color(0xffffff);
  const EYE_BLACK = new THREE.Color(0x07090c); // 黑眼珠
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    col.copy(baseColor);
    const yn = y / hy; // -1（腹）… +1（背）
    if (yn > 0.15) col.multiplyScalar(1 - Math.min((yn - 0.15) / 0.85, 1) * 0.4); // 背暗
    else if (yn < -0.15) col.lerp(WHITE, Math.min((-yn - 0.15) / 0.85, 1) * 0.65); // 腹浅（向白）
    // 腹鳍（头后下侧球状凸起+环）：半透明感浅色
    if (z > -0.66 && z < -0.42 && Math.abs(x) > 0.19 && Math.abs(y + 0.14) < 0.13) {
      col.lerp(WHITE, 0.5);
    }
    // 眼睛 + 环形眼睑：眼珠为圆形（纯半径判定，法线条件会在圆边缘切出棱角）。
    // 眼睛中心（实测）z≈-0.273、y≈-0.056；眼珠半径 0.07，眼睑环 0.07~0.11
    if (Math.abs(x) > 0.1) {
      const dz = z + 0.273, dy = y + 0.056;
      const rEye = Math.sqrt(dz * dz + dy * dy);
      if (rEye < 0.07) col.copy(EYE_BLACK); // 眼珠：正圆
      else if (rEye < 0.11) {
        const nz = Math.abs(normal[i * 3 + 2]);
        const ny = Math.abs(normal[i * 3 + 1]);
        if (nz > 0.25 || ny > 0.25) col.lerp(WHITE, 0.55); // 眼睑环带（凸起环）
      }
    }
    col.multiplyScalar(shade[i]);
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

export async function loadFishModel(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`加载鱼模型失败: HTTP ${res.status}`);
  const geo = parseBinarySTL(await res.arrayBuffer());

  geo.rotateY(Math.PI / 2);   // 头（原 -X 端）→ +Z，与骨骼链一致
  geo.computeBoundingBox();
  const bodyLen = geo.boundingBox.max.z - geo.boundingBox.min.z;
  const targetLen = (BONE_COUNT - 1) * SEG_LEN; // 骨骼链总长
  const s = targetLen / bodyLen;
  geo.scale(s, s, s);
  geo.computeBoundingBox();
  const c = geo.boundingBox.getCenter(new THREE.Vector3());
  // x/y 居中；z 平移使模型中心落在骨骼链中点（头端对齐骨骼 0，尾端对齐末段骨骼）
  geo.translate(-c.x, -c.y, -c.z - targetLen / 2);
  geo.rotateZ(Math.PI / 2); // 背（原 Z 方向）→ +Y，使鱼正立游动
  // 合并顶点并平滑法线（STL 面硬边 → 平滑鱼身，便于光照反射）
  const merged = mergeVertices(geo);
  computePartShade(merged); // 预计算部位着色系数（每条鱼上色时复用）
  return merged;
}

/**
 * 为 STL 模型生成蒙皮权重：每个顶点按 z 位置分配最近两段骨骼的权重，
 * 使身体随骨骼链平滑弯曲（S 形摆尾）
 */
function setupSkin(geo, bones, segLen) {
  const pos = geo.attributes.position;
  const count = pos.count;
  const skinIndex = new Float32Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = THREE.MathUtils.clamp(-v.z / segLen, 0, BONE_COUNT - 1);
    const i0 = Math.min(BONE_COUNT - 1, Math.floor(t));
    const i1 = Math.min(BONE_COUNT - 1, i0 + 1);
    const w1 = t - i0;
    skinIndex[i * 4] = i0;
    skinWeight[i * 4] = 1 - w1;
    skinIndex[i * 4 + 1] = i1;
    skinWeight[i * 4 + 1] = w1;
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
}

/**
 * Boids 群体行为 + 碰撞 + 软边界
 * @param {THREE.Group} fish 当前鱼
 * @param {number} time 全局时间
 * @param {number} dt 帧间隔
 * @param {THREE.Group[]} fishes 全部鱼（含自己）
 */
export function updateFish(fish, time, dt, fishes) {
  const ud = fish.userData;
  const b = ud.bounds;
  const pos = fish.position;
  const vel = ud.vel;
  debugFrame++;

  // 每帧读取可调参数（实时参数面板修改即时生效）
  const {
    W_SEP, W_ALIGN, W_COH, WANDER, CRUISE_KEEP,
    PERCEPTION, NEAREST_N, SEPARATION_R, MAX_STEER,
    RATE_MATCH, RATE_BIAS,
    BOUNDARY_MARGIN, BOUNDARY_FORCE, VISUAL_SIGHT, VISUAL_GAIN,
    FOLLOW_RATE, SWAY_FREQ, MAX_SWAY_FREQ, SWAY_AMP, TAIL_AMP,
  } = PARAMS;
  const FOV_COS = Math.cos(PARAMS.FOV_DEG / 2 * Math.PI / 180);
  const MAX_PITCH = PARAMS.MAX_PITCH_DEG * Math.PI / 180;
  const MAX_BEND = PARAMS.MAX_BEND_DEG * Math.PI / 180;

  // ---- 感知邻居：视野锥过滤 + 最近邻排序 ----
  tmpSep.set(0, 0, 0);
  tmpAlign.set(0, 0, 0);
  tmpCoh.set(0, 0, 0);
  let count = 0;
  let sumSpeed = 0;

  // 视野中心：当前速度方向（后方为盲区）
  tmpForward.copy(vel).normalize();
  const neighbors = [];
  // 掠食者不参与群游感知（无邻居/无群游力）
  if (!ud.isPredator) {
    for (const other of fishes) {
      if (other === fish) continue;
      tmpV.subVectors(other.position, pos);
      const dist = tmpV.length();
      if (dist > PERCEPTION || dist === 0) continue;
      // 视野锥：正后方盲区内的邻居不感知
      tmpV.divideScalar(dist);
      if (tmpV.dot(tmpForward) < FOV_COS) continue;
      neighbors.push({ d: dist, dir: tmpV.clone(), other });
    }
    neighbors.sort((a, b) => a.d - b.d);

    // 只取最近的 NEAREST_N 个邻居
    for (let i = 0; i < Math.min(neighbors.length, NEAREST_N); i++) {
      const nb = neighbors[i];
      count++;
      // 分离：越近越强（线性衰减），方向远离邻居（nb.dir 指向邻居，故取反）
      if (nb.d < SEPARATION_R) {
        tmpSep.addScaledVector(nb.dir, -(1 - nb.d / SEPARATION_R));
      }
      // 对齐
      tmpAlign.add(nb.other.userData.vel);
      // 凝聚
      tmpCoh.add(nb.other.position);
      sumSpeed += nb.other.userData.vel.length();
    }
  }

  // 边界回避系数（0=带外，1=贴壁）：鱼越贴壁，群游/随机游走越弱。
  // 否则凝聚/对齐会把刚转向离开的鱼又拉回去"面对边界"反复振荡，
  // 随机游走也会与视觉回避打架导致边界前打转
  let avoid = 0;
  for (const axis of ['x', 'y', 'z']) {
    const mn = b[axis][0], mx = b[axis][1];
    const pp = pos[axis];
    const dm = Math.max(mn + BOUNDARY_MARGIN - pp, pp - (mx - BOUNDARY_MARGIN), 0);
    if (dm > 0) avoid = Math.max(avoid, dm / BOUNDARY_MARGIN);
  }

  tmpAcc.set(0, 0, 0);
  if (count > 0) {
    const groupScale = 1 - 0.95 * avoid;

    // 分离：保留距离衰减强度（上限 1），不抹平
    const sepLen = tmpSep.length();
    if (sepLen > 1) tmpSep.multiplyScalar(1 / sepLen);
    tmpSep.multiplyScalar(W_SEP * groupScale);
    tmpAlign.normalize().multiplyScalar(W_ALIGN * groupScale);
    tmpCoh.divideScalar(count).sub(pos).normalize().multiplyScalar(W_COH * groupScale);
    tmpAcc.add(tmpSep).add(tmpAlign).add(tmpCoh);

    // 速率匹配：巡航速度向邻居平均速率靠拢，同时受自身偏好约束
    const avgSpd = sumSpeed / count;
    const kRate = 1 - Math.pow(1 - RATE_MATCH, dt * 60);
    ud.cruise += (avgSpd - ud.cruise) * kRate;
    const kBias = 1 - Math.pow(1 - RATE_BIAS, dt * 60);
    ud.cruise += (ud.speed - ud.cruise) * kBias;
  }

  // ---- 随机游走（避免群聚后完全静止，垂直分量减弱；边界带内减弱，避免与视觉回避打架）----
  if (!ud.isPredator) {
    const randScale = 1 - avoid;
    tmpAcc.x += Math.sin(time * 0.5 + ud.phase) * WANDER * randScale;
    tmpAcc.y += Math.sin(time * 0.7 + ud.phase * 2) * WANDER * 0.2 * randScale;
    tmpAcc.z += Math.cos(time * 0.6 + ud.phase) * WANDER * randScale;
  }

  // ---- 巡航保持：把速度拉回巡航速度 ----
  // 防止单条鱼（无群游力）或边界转向时减速到静止，导致 head 朝向失稳原地打转
  const keep = 1 - Math.pow(1 - CRUISE_KEEP, dt * 60);
  tmpV.copy(vel);
  if (tmpV.lengthSq() < 1e-8) tmpV.set(0, 0, 1).applyQuaternion(ud.bones[0].quaternion); // vel≈0 时用头部朝向
  tmpV.normalize().multiplyScalar(ud.cruise).sub(vel).multiplyScalar(keep);
  tmpAcc.add(tmpV);

  // ---- 软边界：把鱼拉回范围内 ----
  pushBack(tmpAcc, pos, b, 'x');
  pushBack(tmpAcc, pos, b, 'y');
  pushBack(tmpAcc, pos, b, 'z');

  // ---- 视觉回避：探测缸壁得到目标偏转角，低通平滑后缓慢施加 ----
  // 平滑防止射线命中状态逐帧跳变导致朝向抖动/旋转
  const debugRays = DEBUG_AVOID ? [] : null;
  const yawTarget = visualAvoid(pos, tmpForward, b, debugRays);
  ud.avoidYaw += (yawTarget - ud.avoidYaw) * (1 - Math.pow(1 - 0.5, dt * 60));
  if (DEBUG_AVOID) {
    // 偏转角跳变检测：目标或平滑值突变时打印该帧完整上下文
    const dT = yawTarget - ud.prevYawTarget;
    const dA = ud.avoidYaw - ud.prevAvoidYaw;
    if (Math.abs(dT) > 0.5 || Math.abs(dA) > 0.35) {
      if (time - ud.lastLogTime > 0.5) { // 同鱼节流，避免刷屏
        console.log(
          `[avoid#${ud.index}] frame=${debugFrame} t=${+time.toFixed(2)} ` +
          `pos=(${+pos.x.toFixed(2)},${+pos.y.toFixed(2)},${+pos.z.toFixed(2)}) ` +
          `fwd=(${+tmpForward.x.toFixed(2)},${+tmpForward.y.toFixed(2)},${+tmpForward.z.toFixed(2)}) ` +
          `vel=(${+vel.x.toFixed(2)},${+vel.y.toFixed(2)},${+vel.z.toFixed(2)}) ` +
          `yawT=${+yawTarget.toFixed(3)}(Δ${+dT.toFixed(3)}) yawS=${+ud.avoidYaw.toFixed(3)}(Δ${+dA.toFixed(3)}) ` +
          `rays=[${debugRays.map(r => `${r.deg}°:${r.t}m,s${r.s}`).join(' ')}]`
        );
        ud.lastLogTime = time;
      }
    }
    ud.prevYawTarget = yawTarget;
    ud.prevAvoidYaw = ud.avoidYaw;
  }
  if (Math.abs(ud.avoidYaw) > 1e-4) {
    const maxTurn = 0.4; // 单帧最大偏转角（rad ≈ 23°），防止过冲/反转
    const turn = THREE.MathUtils.clamp(ud.avoidYaw, -maxTurn, maxTurn);
    tmpV.copy(tmpForward).applyAxisAngle(tmpUp.set(0, 1, 0), turn);
    tmpV.sub(tmpForward).multiplyScalar(VISUAL_GAIN);
    tmpAcc.add(tmpV);
  }

  // ---- 食物吸引（可选特性：点击喂食；掠食者不受食物吸引）----
  if (!ud.isPredator && FEATURES.feeding && WORLD.foods.length > 0) {
    let best = null, bestD = Infinity;
    for (const food of WORLD.foods) {
      tmpV.subVectors(food.pos, pos);
      const d = tmpV.length();
      if (d < bestD) { bestD = d; best = food; }
    }
    if (best && bestD < PARAMS.FOOD_SIGHT) {
      tmpV.subVectors(best.pos, pos);
      if (bestD > 0.2) {
        tmpV.normalize().multiplyScalar(PARAMS.FOOD_ATTRACT);
        tmpAcc.add(tmpV);
      }
    }
  }

  // ---- 掠食者逃避（可选特性；掠食者自身不逃避）----
  if (!ud.isPredator && FEATURES.predator && WORLD.predator) {
    const pr = WORLD.predator;
    tmpV.subVectors(pos, pr.pos);
    const d = tmpV.length();
    if (d < pr.radius * 3.2) {
      tmpV.normalize().multiplyScalar(PARAMS.PRED_FLEE * (1 - d / (pr.radius * 3.2)));
      tmpAcc.add(tmpV);
    }
  }

  // ---- 障碍回避（可选特性：水草/石头等装饰物）----
  if (FEATURES.decor && WORLD.obstacles.length > 0) {
    for (const ob of WORLD.obstacles) {
      tmpV.subVectors(pos, ob.pos);
      const d = tmpV.length();
      const reach = ob.radius + 0.6;
      if (d < reach && d > 1e-6) {
        tmpV.normalize().multiplyScalar(3.2 * (1 - d / reach));
        tmpAcc.add(tmpV);
      }
    }
  }

  // 转向加速度限幅
  const maxSteer = ud.cruise * MAX_STEER;
  const steerLen = tmpAcc.length();
  if (steerLen > maxSteer) tmpAcc.multiplyScalar(maxSteer / steerLen);

  // ---- 积分 ----
  vel.addScaledVector(tmpAcc, dt);
  const spd = vel.length();
  if (spd > ud.cruise) vel.multiplyScalar(ud.cruise / spd);

  // 钳制俯仰角：限制速度垂直分量与水平分量的比值，避免鱼剧烈上下翻飞
  const h2 = vel.x * vel.x + vel.z * vel.z;
  const maxY = Math.sqrt(h2) * Math.tan(MAX_PITCH);
  if (vel.y > maxY) vel.y = maxY;
  else if (vel.y < -maxY) vel.y = -maxY;

  pos.addScaledVector(vel, dt);

  // ---- 位置级碰撞解析（防止鱼互相穿透）----
  for (const other of fishes) {
    if (other === fish) continue;
    const minDist = ud.radius + other.userData.radius;
    const dx = pos.x - other.position.x;
    const dy = pos.y - other.position.y;
    const dz = pos.z - other.position.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist >= minDist || dist === 0) continue;
    const push = (minDist - dist) / minDist * 0.5;
    const inv = 1 / dist;
    pos.x += dx * inv * push;
    pos.y += dy * inv * push;
    pos.z += dz * inv * push;
    other.position.x -= dx * inv * push;
    other.position.y -= dy * inv * push;
    other.position.z -= dz * inv * push;
  }

  // ---- 硬边界兜底 ----
  if (pos.x < b.x[0]) { pos.x = b.x[0]; vel.x = Math.abs(vel.x); }
  else if (pos.x > b.x[1]) { pos.x = b.x[1]; vel.x = -Math.abs(vel.x); }
  if (pos.y < b.y[0]) { pos.y = b.y[0]; vel.y = Math.abs(vel.y); }
  else if (pos.y > b.y[1]) { pos.y = b.y[1]; vel.y = -Math.abs(vel.y); }
  if (pos.z < b.z[0]) { pos.z = b.z[0]; vel.z = Math.abs(vel.z); }
  else if (pos.z > b.z[1]) { pos.z = b.z[1]; vel.z = -Math.abs(vel.z); }

  // ---- 骨骼跟随动画 ----
  // group 自身不旋转；每段骨骼在 group 局部空间内独立驱动
  const bones = ud.bones;
  const segLen = ud.segLen;
  const dirs = ud.dirs;

  // 跟随弹性：按时间归一（60fps 下约等于 FOLLOW_RATE/帧）
  const k = 1 - Math.pow(1 - FOLLOW_RATE, dt * 60);

  // 摆尾频率随游速：游得越快摆得越快（真实鱼 Strouhal 数稳定），发力时频率略升；
  // 上限钳制防止高速（被鱼群带快）时高频"颤抖"
  const freq = Math.min(
    SWAY_FREQ * (vel.length() / ud.speed) * (1 + 0.35 * ud.effort),
    MAX_SWAY_FREQ
  );
  // 摆尾相位积分：phase += freq*dt（模 2π 防精度漂移）。
  // 若直接用 sin(time*freq)，频率变化时瞬时频率 = freq + time*dfreq/dt，
  // 会在慢摆后产生频率尖峰（快速小幅抖动）
  ud.swayPhase = (ud.swayPhase + freq * dt) % (Math.PI * 2);

  // ---- 发力强度：加速度与转向强度合成（驱动摆尾幅度，纯视觉、不改速度）----
  // 加速/急转时鱼猛摆尾表达发力；匀速巡航时摆动平缓
  tmpV.copy(vel).normalize();
  const cosT = THREE.MathUtils.clamp(ud.lastDir.dot(tmpV), -1, 1);
  const turnRate = Math.acos(cosT) / dt; // 速度方向变化率 rad/s
  const turnNorm = THREE.MathUtils.clamp(turnRate / 2.0, 0, 1); // 2rad/s≈115°/s 视为全发力
  const accelNorm = THREE.MathUtils.clamp(tmpAcc.length() / (ud.cruise * MAX_STEER), 0, 1);
  ud.effort += (Math.max(accelNorm, turnNorm) - ud.effort) * (1 - Math.pow(1 - 0.3, dt * 60));
  ud.lastDir.copy(tmpV);
  // 摆幅 = 发力缩放 × 速度比缩放：游速高于基准时摆幅增大（真实鱼高速摆尾更有力），
  // 配合频率上限避免"高频小角度"的颤抖观感
  const spdRatio = THREE.MathUtils.clamp(vel.length() / Math.max(ud.speed, 0.1), 0.6, 1.4);
  const ampScale = (0.6 + 0.7 * ud.effort) * (0.75 + 0.25 * spdRatio); // 巡航 0.6×，全发力 1.3×

  // 头骨：领航者，位于 group 原点，朝向速度方向（slerp 平滑，roll 锁定背朝上）
  const head = bones[0];
  head.position.set(0, 0, 0);
  if (vel.lengthSq() > 1e-8) {
    tmpForward.copy(vel).normalize();
    tmpUp.set(0, 1, 0);
    tmpV.crossVectors(tmpUp, tmpForward); // x = up × fwd（背朝上，右手系）
    if (tmpV.lengthSq() < 1e-6) tmpV.set(1, 0, 0);
    tmpV.normalize();
    // y = z × x = fwd × x，保证 y 朝上且 x×y=z（右手系），
    // 避免 setFromRotationMatrix 对镜像矩阵退化
    tmpUp.crossVectors(tmpForward, tmpV).normalize();
    tmpM.makeBasis(tmpV, tmpUp, tmpForward);
    tmpQ.setFromRotationMatrix(tmpM);
    // 头骨转向速率（25%/帧）：快速追踪速度方向，避免"倒游"
    head.quaternion.slerp(tmpQ, 1 - Math.pow(1 - 0.25, dt * 60));
  }
  // 亚鲹式游泳：头部基本稳定，仅轻微摆头（随发力增强）
  tmpQ.setFromAxisAngle(tmpUp.set(0, 1, 0), Math.sin(ud.swayPhase) * SWAY_AMP * 0.06 * ampScale);
  head.quaternion.multiply(tmpQ);

  // 后续骨骼：距离圆跟随 + 弹性转向 + 正弦摆尾（头小尾大振幅）
  // dirs[i] 记忆上一帧 prev->cur 方向（惯性）；每帧再向"prev 朝向 + 摆动"的目标方向偏转
  // 于是头部转向/摆动会逐段传播到尾部，距离始终恒定为 segLen，形成 S 形摆尾
  for (let i = 1; i < bones.length; i++) {
    const prev = bones[i - 1];
    const cur = bones[i];
    const t = i / (bones.length - 1); // 0=头 … 1=尾

    // 目标方向：prev 的 forward 取反（cur 在 prev 后方），叠加正弦摆动
    tmpForward.set(0, 0, 1).applyQuaternion(prev.quaternion);
    const amp = SWAY_AMP * (0.3 + TAIL_AMP * t) * ampScale; // 头段小尾段大，发力时整体增强
    const sway = Math.sin(ud.swayPhase - i * SWAY_PHASE) * amp;
    tmpUp.set(0, 1, 0).applyQuaternion(prev.quaternion);
    tmpQ.setFromAxisAngle(tmpUp, sway);
    tmpForward.applyQuaternion(tmpQ).multiplyScalar(-1); // 此时为 prev->cur 的目标方向

    // 融合：球面插值方向（避免急转反向时插值经过零向量导致 NaN 扭曲）
    const cosA = THREE.MathUtils.clamp(dirs[i].dot(tmpForward), -1, 1);
    if (cosA > 0.99999 || cosA < -0.99999) {
      // 同向（已收敛）或完全反向（无唯一球面路径）：保守保持原方向，下一帧再转
      tmpDelta.copy(dirs[i]);
    } else {
      const angle = Math.acos(cosA);
      const sinA = Math.sin(angle);
      const kc = Math.min(1, k);
      const w0 = Math.sin((1 - kc) * angle) / sinA;
      const w1 = Math.sin(kc * angle) / sinA;
      tmpDelta.copy(dirs[i]).multiplyScalar(w0).addScaledVector(tmpForward, w1).normalize();
    }

    // 弯曲角限制：本段相对上一段不能过度弯曲（真实鱼转弯半径有限，
    // 防止急转时身体折叠/交叉导致蒙皮拧麻花）。超限则把方向拉回限制角内
    if (i > 0) {
      let prevDir;
      if (i === 1) {
        tmpAxis.set(0, 0, 1).applyQuaternion(head.quaternion).negate(); // 头骨 prev->cur 方向
        prevDir = tmpAxis;
      } else {
        prevDir = dirs[i - 1];
      }
      const dot = THREE.MathUtils.clamp(tmpDelta.dot(prevDir), -1, 1);
      const bend = Math.acos(dot);
      if (bend > MAX_BEND) {
        tmpAxis.crossVectors(prevDir, tmpDelta);
        if (tmpAxis.lengthSq() > 1e-10) {
          tmpAxis.normalize();
          tmpQ2.setFromAxisAngle(tmpAxis, -(bend - MAX_BEND));
          tmpDelta.applyQuaternion(tmpQ2).normalize();
        }
      }
    }

    // 距离圆约束：cur 位于 prev 周围半径 segLen 处
    cur.position.copy(prev.position).addScaledVector(tmpDelta, segLen);
    dirs[i].copy(tmpDelta);

    // 骨骼朝向：从上一段朝向出发，沿最短旋转转向本段 forward。
    // roll 自然延续，竖直俯仰（头朝上/下）时 up 与 forward 平行也不退化扭曲
    tmpForward.copy(prev.position).sub(cur.position).normalize();
    tmpV.set(0, 0, 1).applyQuaternion(prev.quaternion); // 上一段 forward
    tmpQ.setFromUnitVectors(tmpV, tmpForward);           // 最短旋转：prevFwd → curFwd
    cur.quaternion.copy(prev.quaternion).premultiply(tmpQ);
  }

  // 尾鳍（仅程序化模式）：位置略向尾后；法线朝前，平面保持竖直
  if (ud.fin) {
    const last = bones[bones.length - 1];
    tmpForward.set(0, 0, 1).applyQuaternion(last.quaternion); // 前方向（朝头）
    ud.fin.position.copy(last.position).addScaledVector(tmpForward, -segLen * 0.5);
    // 用正交基构造朝向：z=前方向，x=up×f，y=z×x（背朝上、右手系）
    tmpUp.set(0, 1, 0);
    tmpV.crossVectors(tmpUp, tmpForward); // x = up × fwd
    if (tmpV.lengthSq() < 1e-8) tmpV.set(0, 0, -1);
    tmpV.normalize();
    tmpUp.crossVectors(tmpForward, tmpV).normalize(); // 右手系 y = z × x（朝上）
    tmpM.makeBasis(tmpV, tmpUp, tmpForward);
    ud.fin.quaternion.setFromRotationMatrix(tmpM);

    // 胸鳍扇动：绕局部 x 轴上下轻摆（随摆尾节奏）
    const flap = Math.sin(time * freq * 0.8) * 0.3;
    ud.finL.rotation.x = flap;
    ud.finR.rotation.x = flap;
  }

  // 蒙皮模式：先刷新骨骼矩阵（基于本帧新的 position/quaternion），再驱动蒙皮。
  // 否则 skeleton.update() 会用到上一帧的 matrixWorld，蒙皮滞后一帧，急转时撕裂扭曲
  if (ud.skinned) {
    fish.updateMatrixWorld(true);
    ud.skinned.skeleton.update();
  }
}

// 软边界：靠近边界时施加向内推力
function pushBack(acc, pos, bounds, axis) {
  const min = bounds[axis][0];
  const max = bounds[axis][1];
  const p = pos[axis];
  const margin = PARAMS.BOUNDARY_MARGIN;
  const force = PARAMS.BOUNDARY_FORCE;
  if (p < min + margin) {
    const t = 1 - (p - min) / margin;
    acc[axis] += t * force;
  } else if (p > max - margin) {
    const t = 1 - (max - p) / margin;
    acc[axis] -= t * force;
  }
}

// 射线与 AABB（缸内壁）求交（slab 法），返回最近命中距离 t；未命中返回 null。
// 注意：起点在盒内时进入时刻 tMin<0，命中时刻应为"离开盒子"的 tMax；
// 起点在盒外时返回进入时刻 tMin
function rayAABB(origin, dir, bounds) {
  let tMin = -Infinity, tMax = Infinity;
  for (const axis of ['x', 'y', 'z']) {
    const mn = bounds[axis][0], mx = bounds[axis][1];
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
  const hit = tMin > 0 ? tMin : tMax;
  if (hit < 0 || !isFinite(hit)) return null;
  return hit;
}

// 视觉回避：鱼头前方扇形采样射线探测缸壁（视野锥）。
// 命中边界时生成目标偏转 yaw（rad）：右侧命中→左转（负）、左侧命中→右转（正）、
// 正前方命中→偏向空间更大一侧；命中越近 yaw 越大。
// 只返回目标偏转角，由调用方平滑后施加，避免射线命中状态跳变导致朝向抖动
function visualAvoid(pos, fwd, bounds, outRays) {
  let yaw = 0;
  let leftS = 0, rightS = 0, frontS = 0;
  for (const deg of VISUAL_RAYS) {
    const rad = deg * Math.PI / 180;
    // 采样射线方向：前方向绕竖直轴偏转 deg
    tmpV.copy(fwd).applyAxisAngle(tmpUp.set(0, 1, 0), rad);
    const t = rayAABB(pos, tmpV, bounds);
    if (t === null || t > PARAMS.VISUAL_SIGHT) continue;
    const s = 1 - t / PARAMS.VISUAL_SIGHT; // 0~1 越近越强
    if (outRays) outRays.push({ deg, t: +t.toFixed(2), s: +s.toFixed(2) });
    if (deg < 0) leftS = Math.max(leftS, s);
    else if (deg > 0) rightS = Math.max(rightS, s);
    else frontS = s;
    // 右侧命中→左转（负），左侧命中→右转（正）；偏角越小贡献越小
    yaw += -Math.sin(rad) * s;
  }
  // 正前方命中：偏向"空间更大"一侧（哪侧射线更近就远离哪侧），增益更果断
  if (frontS > 0) {
    yaw += (leftS - rightS) * frontS * 1.2;
    // 左右对称（正对壁）时用位置符号打破对称，避免朝固定方向抖动
    if (Math.abs(yaw) < 1e-3) yaw += (pos.x + pos.z > 0 ? 1 : -1) * frontS * 0.8;
  }
  return yaw;
}
