# 环境适配经验（DSH Harness 接管本仓库）

> 本文件是**我方（DeepSeek Harness 侧）的经验落点**：记录"项目从 Trae 迁入本环境后如何跑、
> 如何承接已有约定、本会话新增的可复用知识"。
> **边界**：Trae 时代的原文档（`.trae/rules/project_rules.md`、`memory/debug_experience.md`、
> `memory/development_status.md`、`CHANGELOG.md`）是原始资料，**默认只读不改写**；
> 本项目本环境的一切经验/约束/事实以本文件及 `memory/agent_constraints.md`、`memory/github_experience.md` 为准。

## 一、仓库位置与文档边界

- 项目原家：`d:\Workspaces\Trae_workspace\Fishes`（Trae IDE）；现由 DeepSeek Harness 管理：`D:\Workspaces\deepseek_harness\Fishes`。
- `CHANGELOG.md` 历史条目内的 `file:///d:/Workspaces/Trae_workspace/...` 链接是 Trae 时代原样，**未改动**（阅读时按新位置理解）。
- 会话开始时若需项目上下文：读 Trae 四文档 + 我方三文档（本文件的索引见文末）。

## 二、运行与构建（本环境已验证）

- **dev**：`npm run dev`（Vite 8.2.1，`http://localhost:5173/`）。agent 侧以后台任务运行；
  验证用 `Invoke-WebRequest` 检查 `/`、`/src/main.js` 及模型资源均 200。
- **build**：`npm run build` ✓（~370ms；产物 `dist/`）。现存两个无害警告：动态导入提示、chunk >500kB。
- **3D 资源管线（rolldown-vite 8 关键差异）**：
  - `.glb/.gltf` 不属 Vite 默认 asset 列表 → `vite.config.js` 已加 `assetsInclude: ['**/*.glb','**/*.gltf']`。
  - `.glb?url` 在 Vite 8 下**不触发 asset emit** → scene.js 用 `new URL('...glb', import.meta.url).href`（dev/build 均验证可用）。
  - STL 鱼模型仍走 `?url` import。
- **Android**：`npm run build → npx cap sync android → android\gradlew.bat assembleDebug → adb install`；
  SDK `D:/Software/Android_SDK`、gradle 腾讯镜像、AndroidManifest 补 `landscape` —— 详见 Trae 原文档 `debug_experience.md` 三。

## 三、v0.3.0 代码归属事实（本环境核验，Trae 文档未同步此节）

- `src/main.js`：**薄入口**——只做 `?scene=` 场景分发、移动端横屏提示（`screen.orientation.lock`）。
- `src/scenes/fish-tank/scene.js`：**鱼缸全部逻辑**——rebuildFish（鱼群重建/设置弹窗确定）、
  壁纸 URL 参数（zoom/pitch/yaw/count/rng + `WP_DEFAULT`）、实时参数面板、设置弹窗、喂食/惊散 `pointerdown` 交互。
- `src/scenes/fish-tank/config.js`：鱼缸专属 `FEATURES/PARAMS/SETTINGS/WORLD`（原根目录 `config.js` 已删）。
- `src/core/config.js`：通用 `APP_FEATURES`/`isMobile`；`core/app.js`：壁纸检测（`?wallpaper`→body 类）、时钟、HUD、主循环。
- 注意：Trae 原 `debug_experience.md` 五/六/七节仍写"main.js 做 X"，按上文归属理解即可（原文档已还原未改）。

## 四、GLB 水草摆动（本次会话新增：证据 + 标定）

- **模型解剖**（解析 `models/underwater_plant_pack.glb` 的 accessor AABB + 节点矩阵所得）：
  - plant_3：叶片（本地 z 长轴 17.16）+ 顶部小花 reed；容器把【本地 z】转到朝上。
  - plant_1：单 mesh 整株灌木，AABB 近各向同性（14.6/13.3/12.0）；容器把【本地 -x】转到朝上。
  - plant_2：单 mesh 大片，本地 x 长轴 80.9；容器把【本地 +x】转到朝上。
  - **结论：不能假设"本地 z 是高度"**——三株生长轴朝向不同。
- **算法**（`src/scenes/fish-tank/scene.js`，`placePlant` 内）：
  - 用容器内建旋转 `q` 反求"世界朝上"的局部方向 `upLocal`；高度 = 顶点向 `upLocal` 投影。
  - 摆动轴 b/c：`b = upLocal × ref`（ref 避开与 upLocal 平行的轴）、`c = b × upLocal`（局部水平面两轴）。
  - 叶尖摆幅 = 叶片长度 × `TIP_SWAY_FRAC`(0.06) → 株间缩放差异下视觉一致。
  - 悬臂权重 `h^1.8`（根稳尖活，加载时预计算 `wArr`）；行波相位 `st = s*0.35`（摆动从根部传向叶尖）。
  - 频率 = `SWAY_FREQ_BASE`(1.05) × (0.75 + 0.5×(1 − 该mesh长/株内最长)) → 长慢短快。
  - 茎干整体微倾：`holder.rotation.z = sin(t*0.55+seed)×0.030`、`rotation.x = sin(t*0.46+seed*1.3+1.3)×0.022`。
- **调参**：更活泼 ↑`TIP_SWAY_FRAC`(→0.08~0.1)；更柔 ↓`TIP_SWAY_FRAC` 或 ↓`SWAY_FREQ_BASE`；倾角改上述两行常量。
- **程序化回退水草**（GLB 加载失败时）：整体 rotation，`swayAmp` 0.12/0.08。

### 鱼↔水草互动（同批新增，A~E 全部已实现）

- **A 植物碰撞**（`scene.js` placePlant）：每株 GLB 挂 2 个球形碰撞（基座 y=by0+0.6 + 中上 y=by0+0.35+0.55h），半径=clamp(旋转后水平跨度×0.5×0.55, 0.5, 1.5)，入 `WORLD.obstacles` 复用鱼群障碍回避 → 鱼绕草游。全端（FEATURES.plantCollide）。
- **B 拨叶冲量**（`scene.js` update）：鱼近株基（proxR=clamp(colliderR×2.2, 2, 4.6)）→ `impulse` 逼近近度，5/s 衰减弹回；叠加到顶点弯曲（摆幅 ×1+imp×1.1、相位 +imp×0.9）与茎倾（×1+imp×1.6）→ 鱼钻草叶子让路又弹回。移动端关（FEATURES.plantImpulse）。
- **C 惊散避难**（`fish.js`）：受惊鱼在 REFUGE_RANGE=26 内找最近草/石，逃逸=0.6 冲避难所+0.4 背离惊源（REFUGE_BIAS）；慌乱型重采样 0.4 偏向避难所；下潜型水平冲避难所；受惊冲刺时障碍推力×0.15（让路冲进冠层，配合 B 的叶子被拨开）。全端（FEATURES.panicRefuge）。
- **D 结构区偏好**（`fish.js`）：软吸引最近草/石柱体（水平、越近越弱 0.12×(1−d/16)），每 0.4~0.7s 重采样目标防逐帧抖动；内部排斥由 A 障碍环负责 → "外吸内斥"势阱，鱼在结构边沿逗留不扎堆；受惊时关闭。桌面（FEATURES.coverAttract）。COVER_RANGE=16 / COVER_STR=0.12（≤wander≈0.3 的一半，不与 boids 抢权重）。
- **E 蹭叶轻啄**（`fish.js`）：单鱼 10~25s 冷却；到点找 NIBBLE_SIGHT=9 内最近 GLB 草（`WORLD.plantRefs`），啄 0.6s：该鱼 wander/cohesion ×0.3 + 贴向叶尖（近 0.4 停）+ 触发 B 冲量 0.55（叶被啄开又弹回）；只动单鱼瞬时参数，不动全局 boids 权重。桌面（FEATURES.plantNibble）。

### 与 boids 不冲突的通用设计原则（A~E 落地时遵循，后续新增照此）

1. **叠加不覆盖**：环境类力（D 吸引/E 贴叶）加在 boids 合成之后，量级 ≤ 同级权重一半。
2. **低频重采样**：目标点 0.5s 级重采样，杜绝逐帧目标切换抖动。
3. **外吸内斥**：吸引到达碰撞半径边界即由障碍排斥接管，不产生"扎堆中心"。
4. **瞬态只动单鱼**：E 类状态只改单鱼瞬时权重并自动恢复，不碰全局 boids 参数。

## 五、待入 CHANGELOG 的变更条目（本会话代码改动）

> 按项目"改代码→记 CHANGELOG→build"绑定规则，本会话代码改动应记对外变更。
> 因 `CHANGELOG.md` 为 Trae 原文档（只读），条目暂存我方；**是否并入原 CHANGELOG 由用户决策**（通常在提交时）。

- **GLB 真实水草 + 沙床**（`src/scenes/fish-tank/scene.js`）：加载 sketchfab underwater plant pack（plant_1/2/3，PBR 材质）替换程序化细条水草；新增缸底沙床（加厚基底 + 细分起伏沙面）；模型加载失败自动回退程序化水草。
- **水草摆动升级 + 造景布局**（`src/scenes/fish-tank/scene.js`）：GLB 株改为逐叶片顶点悬臂弯曲——按各株容器内建旋转定位真实生长轴（plant_3 本地 z、plant_1/2 本地 x），沿生长轴投影算高度，根部锚定、叶尖摆幅按叶片长度等比（株间视觉一致），椭圆二次分量 + 行波相位（摆动从根部向叶尖传递）+ 长慢短快频率差，叠加茎干整体微倾（绕根部枢轴）；程序化回退水草仍为整体旋转。**布局按真实水族造景**：前/中/后景分层 + 绕石成丛 + 同种成丛 + 不对称三角构图 + 中央留白游泳道 + 时钟后景草墙；桌面 27 株（高草10/大叶8/灌木9，株高 ≈1.3x 放大）+ 杂草 40 簇，移动端 12 株 + 16 簇（模型每株仅 1.5~2k 顶点，性能无压力）。
- **水草/石头数量进设置弹窗**（`index.html` + `scene.js` + `scenes/fish-tank/config.js`）：新增"水草数量/石头数量"滑杆（桌面默认 27/19、移动 12/12），确定时重建；重建 = 标记装饰碰撞（`decor:'plant'/'rock'`）+ `subsetIndices` 均匀抽稀（数量减少仍品种混合）+ 植物几何独立可安全 dispose、石头卸下不清几何（共享模板几何）+ `WORLD.rockSpheres/plantRefs/obstacles` 同步清理；GLB 加载失败回退的程序化装饰不参与数量调节（rebuild 入口为空自动跳过）。
- **鱼↔水草互动**（`src/fish.js`、`src/scenes/fish-tank/scene.js`、`src/scenes/fish-tank/config.js`）：A 植物碰撞体（每株 2 球、半径按 AABB 水平跨度估算，鱼绕草游，全端）；B 拨叶冲量（鱼近株基→叶片摆幅冲量放大+相位推离，5/s 衰减弹回，移动端关）；C 惊散避难（受惊鱼 0.6 冲最近草/石+0.4 背离惊源、慌乱/下潜分型同步偏向、受惊冲刺碰撞让路 ×0.15）；D 结构区偏好（软吸引草/石边沿逗留，COVER_RANGE=16/STR=0.12 ≤wander×0.5、0.5s 重采样、外吸内斥、受惊关闭，桌面）；E 蹭叶轻啄（10~25s 冷却、啄 0.6s 降游走/凝聚×0.3 + 贴叶 + 拨叶冲量 0.55，桌面）。
- **真实石头替换程序化球体**（`src/scenes/fish-tank/scene.js`、`models/stone_pack.glb` 12MB 未跟踪）：不切割，运行时按容器名识别 Big/Mid/Small 三种常规石（Runic/p1/p2 不接），19 块布局替换 5 个球体石；`placeRock` 复用 placePlant 思路（Box3 贴沙 + 等比缩放），**按原模型方位摆放不随机旋转**，尺寸 ≈4x（Big 8.5~12 / Mid 7.6~8.8 / Small 4.2~5.4，明显大于鱼）；碰撞用**叠层球体**（高石 3 层 0.28/0.6/0.88、矮石 2 层，底层按足迹、上层收窄，钳 0.7~6.0）覆盖整块石；`fish.js` 障碍回避新增**位置级穿透解析**（钻进石体推出 + 径向速度反弹，防高速穿石）；另加**射线式前瞻回避**（visualAvoid 视野锥射线打石头叠层球 `WORLD.rockSpheres`，增益 0.55 软于缸壁、提前绕行；受惊期跳过以便冲入避难所）；加载失败回退程序化球体。
- 同步改动：`vite.config.js` 加 `assetsInclude`（.glb/.gltf）；新增模型 `models/underwater_plant_pack.glb`（2.9MB）、`models/stone_pack.glb`（12MB，未跟踪）。

## 六、承接的强约束（细则见 memory/agent_constraints.md）

1. 证据优先：改 bug 前先有日志/数据支撑假设（例：`ud.cruise` 钳制、`MAX_SWAY_FREQ` 顶死）。
2. 完成单元 = 改代码 → CHANGELOG（Unreleased）→ `npm run build`，顺序不可颠倒。
3. 每轮收尾前把经验追加进本方 memory 文档（技术原因写不了才跳过且须告知）。
4. git：提交由用户手动触发；推送走代理且先确认代理已开启。
5. 调试临时开关默认 `false`。

## 七、石板：真实石头模型替换程序化石头（✅ 已完成，不切割直接识别）

- **结论**：不需要把 stone_pack.glb 切成多个文件。运行时一次性 GLTFLoader 加载（12MB，`.glb` 已在 assetsInclude），
  按容器节点名前缀识别品种：`/^Big_\d+$/i`、`/^Mid_\d+$/i`、`/^Small_\d+$/i`（严格带数字后缀，避免误吞
  `Big_2_BiG_0` 这类 mesh 节点；容器节点 isMesh=false）。Runic（发光符文）/p1/p2（卵石）按用户要求不接入。
- **摆放**：`placeRock`（scene.js）复用 placePlant 思路——保留容器内建旋转、clone 归零、Box3 底部中心贴沙、
  等比缩放到目标尺寸、**容器姿态 + 随机竖直 yaw 组合**（three 坑：不能用 rotation.y 整体替换 quaternion，
  须 `quaternion.copy(q).premultiply(yawQuat)`，否则丢容器朝向）；碰撞用**叠层球体**（石高>5.5 三层层高 0.28/0.6/0.88，
  否则两层 0.3/0.75，底层半径=足迹×0.425、上层收窄，钳 0.7~6.0）覆盖整块石，入 WORLD.obstacles
  （鱼群回避/惊散避难/结构区偏好自动生效），`fish.js` 有位置级穿透解析兜底不穿石。布局 19 块：
  Big×5（沿用原程序化石位当主锚，8.5~12）+ Mid×6（7.6~8.8）+ Small×8（4.2~5.4），避开中央游泳道。
- **回退**：石头 GLB 加载失败时回退原程序化球体石（代码路径保留）。
- **射线式前瞻回避**（`fish.js` visualAvoid，石头专属）：鱼前方视野锥 5 条射线同时打缸壁 AABB 和石头叠层球集合
  （`WORLD.rockSpheres`，与 obstacles 共享对象），取最近命中；石头增益 `ROCK_AVOID_GAIN=0.55`（软于缸壁，
  可绕开的软障碍），正前方偏转逻辑复用（哪侧空间大转哪侧）；**受惊冲刺时跳过石头射线**（配合 C 冲进避难所），
  缸壁回避保留；位置级穿透解析照常兜底。成本：60 鱼×5 射线×~50 球 ≈ 1.5 万次球求交/帧，可忽略。
- **遗留**：`models/stone_pack.glb`（12MB，未跟踪 git）；如需给 APK 瘦身可再议（拆分脚本方案已弃用，但思路在 git 历史/本文件）。

## 八、可复用资产：android-project-creator Skill（从旧 Trae 工作区提取）

> 来源：`d:\Workspaces\Trae_workspace\.trae\skills\android-project-creator\`（Trae 技能库，原文件未动）。
> 该 Skill 用模板生成了本仓库 android/ 原生工程（`com.example.template` → 重构为 `com.fishtank.app`）。
> 若日后需从零重建 Android 原生工程（`npx cap add android` 之外的另一条路），可复用此流程。

- **模板位置**：`<skill>/template/`（settings.gradle.kts、build.gradle.kts、gradle wrapper、libs.versions.toml、local.properties、
  app/src/main/{AndroidManifest.xml, java/com/example/template/MainActivity.java, res/{layout,values,mipmap}}）。
  注意模板内有 `.gradle/9.5.0` 构建缓存垃圾，提取时应排除。
- **流程**（SKILL.md 摘要）：
  1. 项目名用 PascalCase，包名派生 snake_case（如 WeatherApp → weather_app）。
  2. 复制 template 目录到新项目。
  3. 重命名包目录 `com\example\template` → `com\example\<package_name>`（MainActivity.java 随迁）。
  4. 全局替换占位符：`androidTemplate`→小写项目名、`AndroidTemplate`→PascalCase、`com.example.template`→真实包名、
     `template`→snake_case 包名、`Theme.AndroidTemplate`→`Theme.<ProjectName>`。
  5. 构建装机：`.\gradlew.bat clean assembleDebug` → `adb install -r app\build\outputs\apk\debug\app-debug.apk` →
     `adb shell am start -n <包名>/.MainActivity`。
- **经验**：与本仓库实际做法一致（gradlew assembleDebug + adb install + am start），且本仓库 README 级细节
  （AndroidManifest 补 `screenOrientation=landscape`、local.properties `sdk.dir`、gradle 腾讯镜像）已在 `debug_experience.md` 三。

## 九、文档索引

| 文档 | 归属 | 内容 |
|---|---|---|
| `.trae/rules/project_rules.md` | Trae 原（只读） | 项目规则 / 强约束（给 AI） |
| `memory/debug_experience.md` | Trae 原（只读） | 踩坑经验 / 根因 / 方法论 |
| `memory/development_status.md` | Trae 原（只读） | 进度 / 现状 / 待办 |
| `CHANGELOG.md` | Trae 原（只读，Unreleased 按绑定规则追加） | 对外变更记录 |
| `memory/github_experience.md` | 我方 | git 身份 / 提交 / 代理推送 + 本机环境事实 / 认证 / filter-branch 重写作者（吸收用户级全局经验 `~/.trae-cn/memory/github_experience.md`，原文件只读） |
| `memory/harness_notes.md` | 我方（本文件） | 环境适配 / 运行构建 / 新增经验 |
| `memory/agent_constraints.md` | 我方 | 本环境工作流约束（继承 Trae 规则并适配） |