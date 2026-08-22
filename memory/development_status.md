# 开发进度 / 项目现状（development_status.md）

> 记录"现在做到哪了"。与 `memory/debug_experience.md`（踩坑经验）、`CHANGELOG.md`（变更记录）分工，不混记。
> 更新时机：每个功能点完成时同步更新本文件。

---

## 项目概述

- **名称**：3D 鱼缸数字时钟（three.js + Vite + Capacitor）。
- **平台**：桌面 Web（master 分支）+ Android（Capacitor 打包）。
- **核心**：数字时钟生态缸 —— 数字化显示时间 + 3D 鱼群游动。
- **当前版本**：v0.3.0（见 `package.json`）。

## 技术栈

| 类别 | 技术/版本 |
|------|----------|
| 渲染 | three.js 0.185（WebGPU 优先，WebGL2 回退） |
| 构建 | Vite 8.2 |
| 移动端 | Capacitor 8.5.0（Android） |
| STL 模型 | XH378sJqtgOHKGAXMdeNF.stl（鱼身蒙皮） |

## 功能清单（当前状态）

### 核心
- 数字时钟（桌面 + 移动），透明、立体化。
- Boids 鱼群：分离/对齐/凝聚 + 视野锥感知 + 边界回避 + 摆尾骨骼动画。

### 交互 / 行为
- 点击水面：聚鱼 + 撒食（`FEATURES.feeding`）。
- 点击侧壁/缸内：敲缸 → 波纹 + 附近鱼群**惊散**（`FEATURES.scatterPanic`，全端开启）。
- 惊散分型：基础 / 慌乱（方向时变）/ 下潜，受 `scatterPanicFancy` 开关控制。
- 鱼群嬉戏追逐 / 队形变换（`FEATURES.fishPlay`，桌面端开、移动端关）。

### 性能 / 外观
- 功耗优化：DPR 降级、鱼群分级、按移动端关闭非核心特性（bubbles/creatures/fishPlay）。
- 移动端默认横屏全屏（AndroidManifest `screenOrientation=landscape`）。

## 当前进度与待办

- ✅ core/scene 多场景架构分层（v0.3.0）：`core/` 通用框架（渲染器/时钟/HUD）+ `scenes/` 场景化（fish-tank），`?scene=` 入口，config 按场景拆分（通用开关移入 `core/config.js`，鱼缸状态移入 `scenes/fish-tank/config.js`）。
- ✅ 惊散动力学升级（冲量+朝向+增速+分型+boids 弱化+摆尾加速）落地，已装真机验证。
- ✅ 移动端行为与桌面对齐（scatterPanic 全端开启）。
- ✅ 重新生成完整 Android 原生工程，打通构建+装机流程。
- ✅ UI 隐藏按钮改版（圆形+最右+PC 全端显示）；实时参数面板"恢复默认"按钮。
- ✅ 鱼大小（固定/随机）+ 鱼数量设置，距离类参数随体型缩放。
- ⬜ 惊散参数仍可按真机观感微调（`STARTLE_SPEED`/`alignCohScale` 等，见 debug_experience.md 参数表）。
- ⬜ 桌面参数面板是否加 `scatterPanicFancy` 复选开关（此前仅 config 常量控制）。

## 分支与发布

- 已统一为单 `master`（→ `origin/main`）；`mobile-showcase` 已归档为 tag `archive/mobile-showcase` 并删除分支。
- 推送走本地代理 `127.0.0.1:7897`（需用户手动开启；详见 project_rules.md / 全局 github_experience.md）。
- Android 构建：`npm run build` → `npx cap sync android` → `android\gradlew.bat assembleDebug` → adb install（完整流程见 debug_experience.md）。
