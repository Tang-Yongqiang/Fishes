# Changelog

格式说明：版本号遵循语义化版本（主版本.次版本.修订）。顶部为 `Unreleased` 待发布区（小修改累积，达到发版门槛后整理为正式版本条目，见 `.trae/rules/project_rules.md` 的版本规则）。
条目分类：`Added`（新增）/ `Changed`（修改）/ `Fixed`（修复）/ `Removed`（移除）。

## Unreleased（待发布区）

> 小修改在此累积，达到发版门槛（≥2 项或紧急修复）后整理为正式版本条目。

---

## v0.3.0

### Added

- **应用骨架分层（core/scene 架构）**（[src/core/](file:///d:/Workspaces/Trae_workspace/Fishes/src/core)、[src/scenes/](file:///d:/Workspaces/Trae_workspace/Fishes/src/scenes)）：把原来职责混杂的单文件 `main.js` 拆分为可插拔的多场景架构，为未来扩展更多生态时钟场景（动物园、蚁穴等）打基础。
  - `core/`（通用框架，跨场景共享）：[app.js](file:///d:/Workspaces/Trae_workspace/Fishes/src/core/app.js)（环境检测/渲染器/场景/相机/控制/主循环/通用HUD/截图/PWA/UI隐藏/壁纸）+ [renderer.js](file:///d:/Workspaces/Trae_workspace/Fishes/src/core/renderer.js)（WebGPU→WebGL2 回退）+ [clock.js](file:///d:/Workspaces/Trae_workspace/Fishes/src/core/clock.js)（通用数字时钟）+ [config.js](file:///d:/Workspaces/Trae_workspace/Fishes/src/core/config.js)（通用 `APP_FEATURES`/`isMobile`）。
  - `scenes/fish-tank/`（鱼缸场景）：[scene.js](file:///d:/Workspaces/Trae_workspace/Fishes/src/scenes/fish-tank/scene.js) 承载全部鱼缸逻辑，导出 `createFishTankScene(ctx)`。
- **`?scene=` 多场景入口**（[src/main.js](file:///d:/Workspaces/Trae_workspace/Fishes/src/main.js)）：`main.js` 改为薄入口，按 `?scene=fish-tank` 加载场景模块；未来新增场景只需在注册表登记一行。
- **config 按场景拆分**：鱼缸专属全局状态（`FEATURES/SETTINGS/BASE_SIZE/PARAMS/WORLD`）移入 [scenes/fish-tank/config.js](file:///d:/Workspaces/Trae_workspace/Fishes/src/scenes/fish-tank/config.js)，通用应用级开关移入 [core/config.js](file:///d:/Workspaces/Trae_workspace/Fishes/src/core/config.js)；原根目录 `config.js` 删除。

### Changed

- **设置/UI 按钮移至右上角**（[index.html](file:///d:/Workspaces/Trae_workspace/Fishes/index.html)）：设置齿轮 + UI 隐藏按钮由右下角改到右上角，并置于实时参数面板上方（面板下移让位），布局自上而下：设置 → UI → 实时参数。

---

## v0.2.0

### Added

- **鱼群惊散动力学升级**（[src/fish.js](file:///d:/Workspaces/Trae_workspace/Fishes/src/fish.js)、[src/config.js](file:///d:/Workspaces/Trae_workspace/Fishes/src/config.js)）：敲缸/扰动时附近鱼群以「冲量 + 逃逸朝向 + 增速」方式惊慌散开，替代原先的瞬时位移。
  - 速度冲量 + 受惊期 `ud.cruise` 提速（`STARTLE_SPEED`），由限速/速率匹配自然衰减过渡
  - 逃逸朝向经 `avoidYaw` 低通平滑，保留 30% visualAvoid 防撞缸
  - 慌乱分型：基础 / 慌乱（方向时变重采样 0.12~0.3s）/ 下潜，比例由 `PANIC_RATIO`/`DIVE_RATIO` 控制
  - 受惊期弱化 boids 对齐/凝聚（`alignCohScale=0.2`），分离保留 + 受惊对间 `SCATTER_SEP_BOOST` 放大
  - 受惊期摆尾频率上限放大（`STARTLE_SWAY_FREQ`），快甩尾强化慌乱感
  - 个体延迟波纹（`STARTLE_DELAY_R`）：近源先反应、远源后反应
- **惊散独立开关**：`FEATURES.scatterPanic`（总开关）+ `FEATURES.scatterPanicFancy`（慌乱分型子开关），全端默认开启，便于手机端降功耗或简化表现。
- **项目管理体系**：新增 `CHANGELOG.md`、记忆文档分工（`debug_experience.md` 踩坑 / `development_status.md` 进度）、语义化版本规则、改动必须构建验证的强约束。
- **移动端 UI 隐藏按钮改版**（[index.html](file:///d:/Workspaces/Trae_workspace/Fishes/index.html)）：改为 40px 圆形与设置齿轮对齐、UI 图标移到最右、**PC 端也显示**（不再仅移动端），点击一键隐藏/显示 UI。
- **实时参数面板"恢复默认"按钮**（[src/main.js](file:///d:/Workspaces/Trae_workspace/Fishes/src/main.js)）：一键把所有 boids 滑块/参数复位为 config.js 初始值。
- **鱼大小 + 鱼数量设置**（[src/config.js](file:///d:/Workspaces/Trae_workspace/Fishes/src/config.js)、[src/main.js](file:///d:/Workspaces/Trae_workspace/Fishes/src/main.js)）：设置弹窗新增鱼数量滑块、鱼大小（固定 or 范围内随机）滑块，点"确定"重建鱼群即时生效。
  - **距离类参数随体型缩放**（[src/fish.js](file:///d:/Workspaces/Trae_workspace/Fishes/src/fish.js)）：`PERCEPTION/SEPARATION_R/VISUAL_SIGHT/FOOD_SIGHT` 按 `ud.size/BASE_SIZE` 缩放，大小混合时"大看远、小看近"，统一尺寸不破坏原有手感。

### Changed

- 移动端行为与桌面端对齐：惊散反应由 `!_isMobile` 改为全端开启。
- 重新生成完整 Android 原生工程（原 `android/` 残缺，源文件被 .gitignore 忽略后丢失）。
- Git 分支统一为单 `master` → `origin/main`（`mobile-showcase` 归档为 tag `archive/mobile-showcase` 并删除）。

### Fixed

- 惊散冲量被 `vel.multiplyScalar(ud.cruise/spd)` 钳回原速导致速度/摆尾无感——受惊期同步抬 `ud.cruise` 本体。
- 右键/中键点击竟触发撒食/惊散——`pointerdown` 交互未过滤鼠标按键，现仅主键（`e.button !== 0` 时跳过）。

---

## v0.1.0

初始版本。
