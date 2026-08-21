import * as THREE from 'three';
import { FEATURES } from './scenes/fish-tank/config.js';

// ---- 微小生物（可选特性）：缸底小虾爬行 + 爬行时扬起细沙 ----

/**
 * 创建实体：小虾 + 沙粒粒子池
 * @param {THREE.Scene} scene
 * @param {{ bounds: {x:[],y:[],z:[]} }} tank 缸体（用 bounds 限制活动区域）
 * @returns {{ shrimp: Object[], sand: Object[] }}
 */
export function createCreatures(scene, tank) {
  const creatures = { shrimp: [], sand: [] };
  if (!FEATURES.creatures) return creatures;

  const b = tank.bounds;
  const floorY = b.y[0];

  // ---- 小虾几何（组合）：身体 + 尾扇 + 头 + 触须 + 细腿 ----
  const shrimpMat = new THREE.MeshStandardMaterial({ color: 0xff7a4d, roughness: 0.55, metalness: 0.1 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0xb23a12, roughness: 0.6 });
  const bodyGeo = new THREE.CapsuleGeometry(0.14, 0.7, 4, 8);
  const tailGeo = new THREE.ConeGeometry(0.18, 0.26, 6);
  const headGeo = new THREE.SphereGeometry(0.15, 10, 8);
  const legGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.34, 4);
  const antGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.4, 4);

  for (let i = 0; i < 2; i++) {
    const group = new THREE.Group();
    // 身体：Capsule 默认沿 Y，旋转到沿 X（细长横躺）
    const body = new THREE.Mesh(bodyGeo, shrimpMat);
    body.rotation.z = Math.PI / 2;
    group.add(body);
    // 尾扇（后端 -X，尖端朝后）
    const tail = new THREE.Mesh(tailGeo, shrimpMat);
    tail.rotation.z = -Math.PI / 2;
    tail.position.set(-0.5, 0.02, 0);
    group.add(tail);
    // 头（前端 +X）
    const head = new THREE.Mesh(headGeo, darkMat);
    head.position.set(0.55, 0.02, 0);
    group.add(head);
    // 一对触须：左右上翘
    for (const side of [-1, 1]) {
      const ant = new THREE.Mesh(antGeo, shrimpMat);
      ant.rotation.z = side * 0.95;
      ant.position.set(0.72, 0.06, side * 0.12);
      group.add(ant);
    }
    // 3 对细腿（下方）
    const legs = [];
    for (let j = 0; j < 3; j++) {
      const along = -0.28 + j * 0.24;
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(legGeo, shrimpMat);
        leg.rotation.x = -Math.PI / 2 + side * 0.35; // 微微下撇
        leg.position.set(along, -0.12, side * 0.16);
        group.add(leg);
        legs.push(leg);
      }
    }
    // 初始随机位置（缸底区域内）
    group.position.set(
      b.x[0] + 1.2 + Math.random() * (b.x[1] - b.x[0] - 2.4),
      floorY + 0.4,
      b.z[0] + 1.2 + Math.random() * (b.z[1] - b.z[0] - 2.4)
    );
    scene.add(group);
    creatures.shrimp.push({
      group,
      dir: Math.random() * Math.PI * 2,
      speed: 0.35 + Math.random() * 0.25,
      t: Math.random() * 10,
      sandTimer: 0.4 + Math.random(),
      legs,
    });
  }

  // ---- 沙粒粒子池（复用少量小球，冒起后下沉）----
  const sandGeo = new THREE.SphereGeometry(0.035, 5, 4);
  for (let i = 0; i < 8; i++) {
    const mesh = new THREE.Mesh(
      sandGeo,
      new THREE.MeshBasicMaterial({ color: 0xcfb78a, transparent: true, opacity: 0.9 })
    );
    mesh.visible = false;
    scene.add(mesh);
    creatures.sand.push({ mesh, t: 0, vx: 0, vz: 0, active: false });
  }
  return creatures;
}

/** 从池中取一粒沙，扬起后下沉 */
function spawnSand(sandPool, pos) {
  const s = sandPool.find((s) => !s.active);
  if (!s) return;
  s.mesh.visible = true;
  s.mesh.position.set(
    pos.x + (Math.random() - 0.5) * 0.3,
    pos.y,
    pos.z + (Math.random() - 0.5) * 0.3
  );
  s.vx = (Math.random() - 0.5) * 0.6;
  s.vz = (Math.random() - 0.5) * 0.6;
  s.t = 0;
  s.active = true;
}

/**
 * 每帧更新：小虾爬行 + 扬沙
 * @param {{shrimp:Object[], sand:Object[]}} creatures
 * @param {{bounds:{x:[],y:[],z:[]}}} tank
 * @param {number} dt 帧间隔
 */
export function updateCreatures(creatures, tank, dt) {
  if (!FEATURES.creatures) return;
  const b = tank.bounds;
  const floorY = b.y[0];

  for (const sh of creatures.shrimp) {
    const g = sh.group;
    sh.t += dt;
    // 随机转向与偶尔折返，时而停顿
    if (Math.random() < dt * 0.22) sh.dir += (Math.random() - 0.5) * 2.2;
    if (Math.random() < dt * 0.03) sh.dir += Math.PI;
    const vx = Math.cos(sh.dir) * sh.speed;
    const vz = Math.sin(sh.dir) * sh.speed;
    let nx = g.position.x + vx * dt;
    let nz = g.position.z + vz * dt;
    // 缸底区域边界（内缩 0.8）：碰壁反向
    const mx0 = b.x[0] + 0.8, mx1 = b.x[1] - 0.8;
    const mz0 = b.z[0] + 0.8, mz1 = b.z[1] - 0.8;
    if (nx < mx0 || nx > mx1) { nx = Math.max(mx0, Math.min(mx1, nx)); sh.dir = Math.atan2(vz, -vx); }
    if (nz < mz0 || nz > mz1) { nz = Math.max(mz0, Math.min(mz1, nz)); sh.dir = Math.atan2(-vz, vx); }
    g.position.x = nx;
    g.position.z = nz;
    // 行走起伏 + 面朝移动方向（虾头朝 +X，绕 Y 旋转）
    g.position.y = floorY + 0.4 + Math.abs(Math.sin(sh.t * 5)) * 0.07;
    g.rotation.y = -sh.dir;
    // 腿交替划动
    for (let k = 0; k < sh.legs.length; k++) {
      const leg = sh.legs[k];
      leg.rotation.x = -Math.PI / 2 + (k % 2 === 0 ? 0.35 : -0.35) + Math.sin(sh.t * 10 + k) * 0.18;
    }
    // 扬沙
    sh.sandTimer -= dt;
    if (sh.sandTimer <= 0) {
      spawnSand(creatures.sand, g.position);
      sh.sandTimer = 0.6 + Math.random() * 0.8;
    }
  }

  // 沙粒：先扬起（上升）后沉落，淡出回收
  for (const s of creatures.sand) {
    if (!s.active) continue;
    s.t += dt;
    s.mesh.position.x += s.vx * dt;
    s.mesh.position.z += s.vz * dt;
    s.mesh.position.y += (s.t < 0.55 ? 1.1 : -0.9) * dt;
    s.mesh.material.opacity = Math.max(0, 0.9 * (1 - s.t / 1.4));
    if (s.t > 1.4) {
      s.active = false;
      s.mesh.visible = false;
    }
  }
}