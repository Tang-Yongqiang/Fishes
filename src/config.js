/**
 * 全局配置：特性开关 + 可调参数 + 共享世界状态。
 * - FEATURES：每个功能可用 true/false 开关，false 则该功能完全不初始化/执行，
 *   保证最小系统（鱼群游动）不受任何影响。
 * - PARAMS：可调参数，实时参数面板直接修改，引擎每帧读取，无需重启。
 * - WORLD：各功能共享的运行时状态（食物、掠食者、障碍物等）。
 */
// 移动端检测（与 main.js 保持一致，避免 Capacitor WebView UA 差异）
const _isMobile = (typeof window !== 'undefined') && (
  !!window.Capacitor || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator?.userAgent || '')
);

export const FEATURES = {
  feeding: !_isMobile,  // 点击喂食：移动端无此交互，关闭省资源
  // 气泡：移动端关闭（小屏幕存在感极低，省 40 粒子的每帧 sin 计算 + DrawCall）
  bubbles: !_isMobile,
  decor: true,          // 水草/装饰：静态，开销极小，保留视觉层次
  caustics: !_isMobile, // 水面光斑：移动端已在 main.js 关，这里同步开关声明
  predator: false,       // 掠食者：暂关闭
  panel: true,          // 实时参数面板（仅桌面，main.js 已按 isMobile 屏蔽 DOM）
  screenshot: true,     // 截图导出（仅桌面）
  clock: true,          // 数字时钟：时钟生态缸核心，必须保留
  clockFace: 'fixed',   // 时钟朝向
  pwa: true,            // PWA：离线缓存
  // 鱼群嬉戏追逐：移动端关闭，省追逐对调度 + 全局队形相位等额外逻辑
  fishPlay: !_isMobile,
  // 缸底小虾爬动+扬沙：移动端小屏幕几乎注意不到，关闭省 ~8% CPU
  creatures: !_isMobile,
  uiToggle: true,       // UI 一键隐藏：移动端核心功能，保留
};

export const PARAMS = {
  // ---- Boids 群游 ----
  W_SEP: 3.2,          // 分离权重（防撞，最重要）
  W_ALIGN: 1.0,        // 对齐权重
  W_COH: 0.4,          // 凝聚权重
  WANDER: 0.3,         // 随机游走强度
  CRUISE_KEEP: 0.5,    // 巡航保持：速度拉回巡航速度
  PERCEPTION: 8.0,     // 感知范围（随大缸放大，保持鱼群聚集）
  NEAREST_N: 8,        // 只关注最近的 N 个邻居
  SEPARATION_R: 3.0,   // 分离作用距离
  MAX_STEER: 1.2,      // 转向加速度上限（× 巡航速度）
  FOV_DEG: 270,        // 视野角（度）
  RATE_MATCH: 0.15,    // 速率匹配强度
  RATE_BIAS: 0.3,      // 速率偏好强度

  // ---- 边界回避 ----
  BOUNDARY_MARGIN: 3.0, // 软边界作用带宽度
  BOUNDARY_FORCE: 9.0,  // 软边界推力强度
  VISUAL_SIGHT: 12.0,   // 视觉探测距离（缸壁）
  VISUAL_GAIN: 2.5,     // 边界偏转加速度增益

  // ---- 骨骼/摆尾 ----
  FOLLOW_RATE: 0.25,    // 身体柔软度（越小越柔软）
  SWAY_FREQ: 6.0,       // 基础摆尾频率 (rad/s)
  MAX_SWAY_FREQ: 8.0,   // 摆尾频率上限
  SWAY_AMP: 0.14,       // 摆尾幅度基准 (rad)
  TAIL_AMP: 1.6,        // 尾端振幅倍率
  MAX_BEND_DEG: 30,     // 骨骼段最大弯曲角（度）
  MAX_PITCH_DEG: 35,    // 俯仰角上限（度）

  // ---- 掠食者 ----
  PRED_SPEED: 4.2,      // 掠食者巡航速度
  PRED_RADIUS: 0.9,     // 掠食者体积半径（碰撞/逃避距离基准）
  PRED_FLEE: 6.0,       // 鱼群逃避掠食者的分离权重

  // ---- 喂食 ----
  FOOD_ATTRACT: 3.0,    // 食物吸引力强度
  FOOD_SIGHT: 7.0,      // 鱼能看到食物的距离

  // ---- 鱼群行为升级 ----
  CHASE_STR: 2.4,       // 追逐/逃逸推动力
  CHASE_SPEED: 1.55,    // 追逐时巡航速度倍率（追者）
  FLED_SPEED: 1.3,      // 追逐时巡航速度倍率（逃者）
  CHASE_DURATION: 5,    // 单次追逐持续时间（秒）
  SCATTER_R: 7.0,       // 惊散半径（鱼食落水/干扰）
  SCATTER_FORCE: 5.5,   // 惊散力
  SCATTER_TIME: 0.7,    // 惊散持续时间（秒）
  FORMATION_STR: 0.8,   // 队形变换强度
};

// 共享运行时状态（各功能写入/读取）
export const WORLD = {
  foods: [],           // 食物粒子 [{ pos, vy, t }]
  predator: null,      // 掠食者 { group, pos, vel, radius }
  obstacles: [],       // 装饰障碍 [{ pos, radius }]
  scatterSource: null, // 惊散源位置（鱼食落水等触发）
  scatterUntil: -1,    // 惊散结束时间（全局时间秒）
};
