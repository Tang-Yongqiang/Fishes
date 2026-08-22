// 鱼缸场景配置（scenes/fish-tank）：本场景专属的全局状态。
// - FEATURES：本场景每个功能可用 true/false 开关，false 则该功能完全不初始化/执行，
//   保证最小系统（鱼群游动）不受任何影响。
// - PARAMS：可调参数，实时参数面板直接修改，引擎每帧读取，无需重启。
// - SETTINGS：用户可经设置弹窗调整的偏好（数量/大小）。
// - WORLD：本场景各功能共享的运行时状态（食物、掠食者、障碍物等）。
// 通用应用级开关（时钟/PWA/截图/UI切换/移动端检测）见 src/core/config.js。
import { isMobile } from '../../core/config.js';

export const FEATURES = {
  feeding: true,  // 点击交互（水面聚鱼/缸壁惊散撒食）：桌面鼠标 + 移动端触屏均开启
  // 气泡：移动端关闭（小屏幕存在感极低，省 40 粒子的每帧 sin 计算 + DrawCall）
  bubbles: !isMobile,
  decor: true,          // 水草/装饰：静态，开销极小，保留视觉层次
  caustics: !isMobile, // 水面光斑：移动端已在 scene 关，这里同步开关声明
  predator: false,       // 掠食者：暂关闭
  panel: true,          // 实时参数面板（仅桌面，scene 已按 isMobile 屏蔽 DOM）
  fishPlay: !isMobile,  // 鱼群嬉戏追逐：移动端关闭，省追逐对调度 + 全局队形相位等额外逻辑
  scatterPanic: true,   // 惊散反应（敲缸/扰动的散开+加速+朝向变化）：全端开启
  // 惊散慌乱分型（分型 / 方向时变 / 群体二次扰动）：全端开启；
  // 关闭则退化为"基础散开"（仍加速变向但无慌乱变向/下潜/分离放大），便于降功耗或简化表现
  scatterPanicFancy: true,
  creatures: !isMobile, // 缸底小虾爬动+扬沙：移动端小屏幕几乎注意不到，关闭省 ~8% CPU
  plantCollide: true,   // 鱼↔草碰撞：植物挂球形碰撞体（基座+中上），鱼绕草丛游（全端）
  plantImpulse: !isMobile, // 鱼↔草拨叶：鱼靠近时叶片摆动冲量（拨开又弹回）；移动端关省性能
  panicRefuge: true,    // 鱼↔草惊散避难：受惊鱼逃向最近草/石，冲刺时碰撞让路（全端）
  coverAttract: !isMobile, // 结构区偏好（D）：软吸引鱼群在草/石边沿逗留，中央更空旷（桌面）
  plantNibble: !isMobile,  // 蹭叶轻啄（E）：鱼偶尔停草叶旁轻啄触发叶摆（桌面，10~25s 一次）
};

export const SETTINGS = {
  // 鱼群数量：桌面默认 60 条；移动端走原有分级逻辑（数量分级、size 1.9）
  fishCount: isMobile ? (window.innerWidth < 400 ? 28 : 42) : 60,
  // 鱼体型（相对大小，1.0=原始标定尺寸）。移动端默认 1.9（配合小屏幕更醒目）
  fishSize: isMobile ? 1.9 : 1.0,
  // 是否启用随机大小：true 时每条鱼在 [sizeMin, sizeMax] 内随机取，false 时统一 fishSize
  randomSize: false,
  sizeMin: 0.7,  // 随机范围下限（relative）
  sizeMax: 1.4,  // 随机范围上限（relative）
  // 装饰数量（上限 = 布局表条目数：水草桌面 27/移动 12，石头桌面 19/移动 12）：
  // 可在设置弹窗"确定"后重建生效；均匀抽稀，数量减少时品种仍混合
  plantCount: isMobile ? 12 : 27,  // GLB 水草株数
  rockCount: isMobile ? 12 : 19,   // 真实石头块数
};

// 体型缩放的距离参数基准：取"平台统一大小"，保证统一尺寸时缩放因子=1、不破坏现有手感，
// 仅在有大小差异（随机）时才按个体 size 相对基准缩放距离类参数。
export const BASE_SIZE = isMobile ? 1.9 : 1.0;

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
  SCATTER_R: 16,        // 惊散半径（点击缸壁/水面扰动覆盖范围，缸大故放大）
  SCATTER_FORCE: 12,    // 惊散力（敲缸惊吓的瞬时推离强度，绕开转向限幅后需较大）
  SCATTER_TIME: 1.0,    // 惊散持续时间（秒）
  // ---- 受惊分型（scatterPanic 开启时生效）----
  STARTLE_TIME: 1.4,    // 个体受惊持续（秒，含延迟后）
  STARTLE_SPEED: 3.0,   // 受惊期巡航倍率（基础型）
  STARTLE_SWAY_FREQ: 1.9, // 受惊期摆尾频率上限倍率（快甩尾，营造慌乱感）
  STARTLE_TURN: 1.6,    // 受惊期单帧最大偏转角放大倍率
  STARTLE_DELAY_R: 0.15, // 距离→延迟系数（声波传播感）
  STARTLE_JITTER: 0.45, // 基础型逃逸方向抖动（rad，约 ±25°）
  PANIC_RATIO: 0.20,    // 慌乱分型占比（20%）
  PANIC_JITTER: 0.70,  // 慌乱型抖动（rad，约 ±40°）
  PANIC_SPEED_MULT: 1.3, // 慌乱型额外加速倍率
  DIVE_RATIO: 0.10,    // 下潜分型占比（10%）
  DIVE_VEL: 4.0,       // 下潜型初始 y 负冲量
  SCATTER_SEP_BOOST: 1.5, // 受惊鱼对间分离增强倍率
  FORMATION_STR: 0.8,   // 队形变换强度
  // ---- 鱼↔草互动 ----
  REFUGE_RANGE: 26,     // 惊散避难搜索半径：该范围内找最近草/石当避难所
  REFUGE_BIAS: 0.6,     // 逃逸方向混合权重：0.6 冲避难所 + 0.4 背离惊源
  COVER_RANGE: 16,      // 结构区偏好（D）：软吸引作用距离
  COVER_STR: 0.12,      // 结构区偏好强度（≤ wander≈0.3 的一半，不与 boids 抢权重）
  NIBBLE_SIGHT: 9,      // 蹭叶轻啄（E）：找草的搜索半径
};

// 共享运行时状态（各功能写入/读取）
export const WORLD = {
  foods: [],           // 食物粒子 [{ pos, vy, t }]
  predator: null,      // 掠食者 { group, pos, vel, radius }
  obstacles: [],       // 装饰障碍 [{ pos, radius }]
  rockSpheres: [],     // 石头叠层碰撞球（射线式前瞻回避用，与 obstacles 共享同一对象）
  plantRefs: [],       // GLB 草株引用（蹭叶轻啄 E 用：每项为 holder，含 position/userData）
  scatterSource: null, // 惊散源位置（鱼食落水等触发）
  scatterUntil: -1,    // 惊散结束时间（全局时间秒）
};
