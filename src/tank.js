import * as THREE from 'three';

// 活动范围尺寸常量（调试模式仅用线框标出）
export const TANK = { W: 72, H: 32, D: 40, BOTTOM: -3 };

/**
 * 调试模式：只画一个长方体线框，标出鱼的活动范围
 */
export function buildTank(scene) {
  const tank = {};

  // 长方体线框
  const edges = new THREE.EdgesGeometry(
    new THREE.BoxGeometry(TANK.W, TANK.H, TANK.D)
  );
  const line = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({
      color: 0x7fd7ff,
      transparent: true,
      opacity: 0.7,
    })
  );
  line.position.y = TANK.BOTTOM + TANK.H / 2;
  scene.add(line);

  // 鱼的活动范围（在线框内侧留一点余量）
  tank.bounds = {
    x: [-TANK.W / 2 + 0.8, TANK.W / 2 - 0.8],
    y: [TANK.BOTTOM + 0.8, TANK.BOTTOM + TANK.H - 0.8],
    z: [-TANK.D / 2 + 0.8, TANK.D / 2 - 0.8],
  };
  return tank;
}
