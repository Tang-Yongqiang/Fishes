# 项目调试经验记忆（跨会话）

> 本文档由 AI 在调试过程中持续沉淀，**换新会话后请优先读取本文件恢复上下文**。
> 归口登记见 `.trae/rules/project_rules.md` 的「项目记忆文档索引」。

---

## 一、鱼群惊散反应（敲缸/干扰 → 鱼群惊慌散开）

### 1. 功能与开关（src/config.js）

- `FEATURES.scatterPanic`：惊散总开关，全端 `true`。关闭则整段惊散逻辑短路。
- `FEATURES.scatterPanicFancy`：慌乱分型子开关，全端 `true`。关闭则退化为"基础散开"（仍加速变向，但无分型/慌乱变向/下潜/群体分离放大）。
- 触发入口：`main.js` 点击缸壁/水面时设 `WORLD.scatterSource` + `WORLD.scatterUntil`。
- 全链路由 `ud.startle*` 系列字段驱动，无模块级共享状态（除 WORLD.scatterSource）。

### 2. 动力学设计（关键思路）

**核心原则：不用"瞬时位移"，用"冲量 + 状态 + 让现有动力学自然过渡"。**

- **速度冲量**：受惊到点一次性 `vel.addScaledVector(escapeDir, SCATTER_FORCE)`，之后交给限速/速率匹配自然衰减。不是 `pos.add()`。
- **受惊期增速**：必须同时抬**局部 `cruiseTarget`** 和 **`ud.cruise` 本体**（见下方坑①）。
- **朝向覆盖**：逃逸方向做目标 yaw，经 `ud.avoidYaw` 低通平滑过渡，**保留 30% visualAvoid 防撞缸**（`startleYaw = dy*0.7 + yawTarget*0.3`）。
- **分型**（fancy 开时）：`startleType` 0 基础 / 1 慌乱 / 2 下潜，比例由 `PANIC_RATIO`、`DIVE_RATIO`；
  - 基础：单次方向抖动 ±`STARTLE_JITTER`
  - 慌乱：每 0.12~0.3s **重采样方向**（`startleNextTurn`）+ 大幅抖动 `PANIC_JITTER` + 增速 `PANIC_SPEED_MULT` → "边跑边扭头"
  - 下潜：`vel.y -= DIVE_VEL` → 往深处钻
- **受惊期弱化 boids**：`alignCohScale = 0.2`（对齐/凝聚乘 0.2，体现"各自逃命"），分离保留且受惊对间 `SCATTER_SEP_BOOST`×1.5。位置在 boids 累加处。
- **受惊期摆尾频率上限放大**：`freqCap = startle ? MAX_SWAY_FREQ*STARTLE_SWAY_FREQ : MAX_SWAY_FREQ`。
- **个体延迟波纹**：`delay = (d/SCATTER_R)*STARTLE_DELAY_R + rand*0.05` → 近源先反应、远源后反应。

### 3. 参数表（src/config.js STARTLE_* / PANIC_* / DIVE_*）

| 参数 | 当前值 | 含义 |
|---|---|---|
| SCATTER_R | 16 | 惊散半径 |
| SCATTER_FORCE | 12 | 速度冲量强度 |
| STARTLE_TIME | 1.4 | 个体受惊持续（s） |
| STARTLE_SPEED | 3.0 | 受惊巡航倍率（基础型） |
| STARTLE_SWAY_FREQ | 1.9 | 受惊摆尾频率上限倍率 |
| STARTLE_TURN | 1.6 | 受惊单帧 maxTurn 倍率 |
| STARTLE_DELAY_R | 0.15 | 距离→延迟系数 |
| STARTLE_JITTER | 0.45 | 基础型方向抖动 rad（±25°） |
| PANIC_RATIO | 0.20 | 慌乱型占比 |
| PANIC_JITTER | 0.70 | 慌乱型抖动 rad（±40°） |
| PANIC_SPEED_MULT | 1.3 | 慌乱型额外增速倍率 |
| DIVE_RATIO | 0.10 | 下潜型占比 |
| DIVE_VEL | 4.0 | 下潜初始 y 负冲量 |
| SCATTER_SEP_BOOST | 1.5 | 受惊对分离放大倍率 |
| alignCohScale | 0.2 | 受惊期对齐/凝聚缩放（硬编码在 boids 累加处） |

### 4. 标定结论 / 调整方向

- 想更快更急：↑`STARTLE_SPEED`、`STARTLE_TURN`、`STARTLE_SWAY_FREQ`、`SCATTER_FORCE`。
- 想让逃命感更强（更"炸开"）：↓`alignCohScale`（0.2→趋于0）；想保留群游连贯感：↑回 0.3~0.4。
- 手机端功耗：`scatterPanic`/`scatterPanicFancy` 均为**事件驱动**，不点击时每帧只是几次布尔短路（`WORLD.scatterSource` 平时为 null），**持续成本≈0**。真正的功耗大头是 `creatures`/`bubbles`/`fishPlay` 这些每帧都在跑的特性。

---

## 二、诊断方法论（"必须基于证据"的实例）

### 坑①：改了 `cruiseTarget` 但速度/摆尾完全没反应

- **现象**：惊散后鱼速、摆尾幅度无明显变化。
- **根因**：`updateFish` 末尾有 `if (spd > ud.cruise) vel.multiplyScalar(ud.cruise / spd)` ——**决定最终速度的是 `ud.cruise` 本体**，而我只改了局部变量 `cruiseTarget`。冲量加进 vel 后同帧被钳回 `ud.cruise`，速度涨不上去；速度不变→`effort`(由 accelNorm/turnNorm 驱动) 不高→摆尾幅度也不变。
- **修法**：受惊期**每帧快速抬 `ud.cruise`**(系数 0.9) 逼近 `ud.speed*mult`，并 `cruiseTarget = ud.cruise`；结束后用 `else if ud.cruise > ud.speed*1.15` 渐回自身速率。
- **教训**：改"目标值"时，要追查**最终钳制/限幅用的是哪个变量**，别只改中间产物。

### 坑②：摆尾"快不起来"——频率被 MAX_SWAY_FREQ 顶死

- **现象**：速度提上去了但摆尾频率看着没快到哪去。
- **根因**：`freq = min(SWAY_FREQ*(vel/ud.speed)*(1+0.35*effort), MAX_SWAY_FREQ)`，受惊时算出来 ~17 rad/s 但被 `MAX_SWAY_FREQ=8` 钳死。
- **修法**：受惊期单独放大上限 `MAX_SWAY_FREQ*STARTLE_SWAY_FREQ`，不影响正常状态。

### 通用套路

1. 先看"最终生效"那一行的钳制/限幅/积分，确认它消费哪个变量。
2. 看 `effort`（驱动摆尾幅度）由哪些量合成：`accelNorm`(加速度) + `turnNorm`(转向速率)。视觉无变化时优先追这两个。
3. 验证用临时 `DEBUG_*` 开关打印曲线（velocity/effort 随时间），确认形态后关闭（默认 false）。

---

## 三、Android / Capacitor 构建

### 关键环境信息

- Android SDK：`D:/Software/Android_SDK`（build-tools 35/36、platform-tools/adb 齐全）。
- 当前连接设备：PKT110（`adb devices` 显示 `DQGQEYNFC6W4SKPN`，product:PKT110 / OP5DCBL1）；此前常连小米 13（`e3d85ef4`, vermeer）。多设备用 `adb -s <serial>` 指定。
- Capacitor CLI 8.5.0；appId `com.fishtank.app`；`webDir: dist`。

### 坑③：android 原生工程会被 .gitignore 整体忽略 → 可能残缺

- **现象**：`android/app/build.gradle`、`AndroidManifest.xml`、`gradlew` 全被 `git check-ignore` 命中；工作区里的 android 目录只有旧 build 产物、缺所有源文件，**无法直接重新构建**。
- **处理**：其实这是**正常设计**（android 平台是生成的），但一旦本地残缺就需重建：
  `npm run build` → 删 `android/` → `npx cap add android` → `npx cap sync android`。
- **教训**：android 目录不在 git 里，别指望从版本库恢复；换机/换会话后如遇残缺，直接走上面的重建流程。

### 坑④：Gradle 发行版下载极慢 → 用国内镜像

- **根因**：`gradle-wrapper.properties` 默认 `distributionUrl=services.gradle.org`，国内网络极慢（十几分钟才见几个点）。
- **修法**：改成腾讯云镜像：
  `distributionUrl=https\://mirrors.cloud.tencent.com/gradle/gradle-8.14.3-all.zip`
  改后整个 APK 构建 **39s 完成**。
- 若依赖（AGP/androidx）也慢，可考虑在 `build.gradle` 仓库区加阿里云 maven 镜像，但本次未需要。

### 坑⑤：新工程缺 local.properties → SDK 找不到

- **现象**：`SDK location not found. Define ... sdk.dir path in local.properties`。
- **修法**：`cap add` 生成的新工程不含 local.properties（旧版删了），需手动建：
  `sdk.dir=D:/Software/Android_SDK`（用正斜杠避免转义问题）。

### 完整构建+安装命令（已跑通）

```bash
npm run build                       # 前端构建 → dist
npx cap add android                 # 首次/重建原生工程（需 android 目录为空或先删除）
npx cap sync android                # 同步 web 资源
cd android
.\gradlew.bat assembleDebug --no-daemon
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.fishtank.app/.MainActivity   # 安装后直接启动
```
- **装机后自动启动**：`adb shell am start -n <appId>/.MainActivity`（本 appId=`com.fishtank.app`）。`-r` 覆盖安装不丢数据。

### 横屏需求

- 手机端默认横屏：在 `android/app/src/main/AndroidManifest.xml` 的 `<activity>` 上加 `android:screenOrientation="landscape"`（`cap add` 默认不含，重建后需补）。
- 另：`src/main.js` 还有运行时 `screen.orientation.lock('landscape')`（iOS 静默失败，Android 首次触摸触发）。

### 本仓库 git 要点（详见 project_rules.md）

- 身份 `Tang-Yongqiang <1771241202@qq.com>`；**分支已统一为单 `master`**（→ origin/main）。
- **mobile-showcase 分支已归档+删除**（2026-08）：
  - 原因：前端已用 `isMobile` 运行时标志双端统一，分支仅剩 android 原生层/历史遗留图，无需双分支并行维护。
  - 归档方式：`git tag archive/mobile-showcase mobile-showcase` → 删本地 `git branch -D mobile-showcase` → 删远端 `git push origin --delete mobile-showcase` → 推 tag `git push origin tag archive/mobile-showcase`。远端 tag `9b6832e`。
- Android 原生层（`android/`）不入 master 版本库；需要时用本项目 `npm run build → npx cap sync android → gradlew assembleDebug → adb install` 重建/装机（生成物）。
- push 走本地代理：`git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push ...`（**代理需用户手动开启**；未开时 `127.0.0.1:7897` 连不上，**先询问用户是否已开启代理**，再决定重试代理或用户同意后改直连——本次直连 push 成功）。
- 提交时机由用户手动触发，不自动提交。该"先询问代理"约定已写入 `.trae/rules/project_rules.md` 推送小节。

---

## 四、移动端 UI 底部按钮布局

- 移动端右下角两个固定按钮（`index.html`，均 `bottom:14px`）：
  - `#settings-btn` 设置齿轮（全端，40px 圆形）。
  - `#ui-toggle-btn`（文字 "UI"，仅 `body.mobile` 显示）一键隐藏/显示 UI。
- 水平位置由 `right` 决定，二者互换即可调整左右顺序：
  - **UI 图标在最右**：`#ui-toggle-btn right:14px`，`#settings-btn right:58px`（当前，UI 更靠右排、设置在其左）。
  - 反之为"UI 在设置左边"：`#ui-toggle-btn right:58px`，`#settings-btn right:14px`。
- `#ui-toggle-btn` 不在 `body.ui-hidden` 隐藏列表里，故点隐藏后自身仍保留可再次呼出。
- UI 隐藏按钮**全端显示**：原只 `body.mobile` 显示，后改为默认 `display:flex`（PC 端也显示，方便点按钮而非按 H）。
- 两按钮均已 `height:40px`（UI 用 flex 行居中文字），`bottom:14px` → 底部一排水平严格对齐。
- UI 按钮也做成圆形：与设置按钮同样 `40x40`、`border-radius:50%`、flex 居中（文字 "UI" 居中在圆内），二者视觉完全一致。
- 改动前端后按规则需 `npm run build` 验证（已通过）。

---

## 五、实时参数面板（桌面 boids 滑块调试）

- `#panel` 由 `main.js` 动态创建（`FEATURES.panel && !isMobile`），滑块直接实时写 `PARAMS` 对象（config.js），标题"实时参数"。
- 滑块列表：分离/对齐/凝聚权重、随机游走、感知范围、巡航保持、边界回避、摆尾频率/幅度、掠食速度。
- **恢复默认**：底部加 `.preset-btn`"恢复默认"按钮；构建 panel 时先把各 key 的 `PARAMS` 初始值快照进 `defaults`，点击时统一把 PARAMS/滑块/数值显示复位为快照值。样式在 `index.html #panel .preset-btn`。
- 注意：默认值来源取**创建时的 PARAMS 快照**（config.js 初始值），不硬编码，避免 config 改动后按钮失效。

---

## 六、鱼大小 / 鱼数量设置（设置弹窗，点确定重建鱼群）

- **入口**：设置在右上角齿轮弹窗（`index.html #settings-modal`），全端可用。控件：鱼数量滑块、固定大小滑块、"随机大小"开关、大小范围 min/max（勾随机时才显示）。
- **配置**：`config.js SETTINGS`：`fishCount`(桌面60/移动28~42)、`fishSize`(桌面1.0/移动1.9)、`randomSize`、`sizeMin/sizeMax`(0.7~1.4，relative)。
- **重建**：`main.js rebuildFish()`——先 `scene.remove`+dispose 旧鱼、清 `fishes` 数组（保持同一引用，update/相机/追逐闭包自动生效）、调 `resetShoalState()`、再按 `SETTINGS.fishCount` 按各色 weight 比例分配重建。初始也调用一次。
- **个体大小**：`createFish` 在 `ud.size` 记录体型；`fishSizeFor()` 固定模式返 `fishSize`、随机在 `[sizeMin,sizeMax]×fishSize` 取。
- **距离类参数随大小缩放**：`updateFish` 里 `SZ = ud.size/BASE_SIZE`（`BASE_SIZE`=平台统一大小 桌面1.0/移动1.9，保证统一尺寸时因子=1不破坏原手感），对 `PERCEPTION/SEPARATION_R/VISUAL_SIGHT/FOOD_SIGHT` 乘 SZ。`visualAvoid` 改为接收 `sight` 参数。
- **坑：`visualAvoid` 改签名后需整套一致**。HMR 部分更新会让浏览器跑"旧定义+新调用"混合版 → `outRays.push is not a function`（old 4参把第4参数 VISUAL_SIGHT 当成 outRays 数字）。磁盘代码正确时刷新浏览器即可。
- **坑：新增 import（BASE_SIZE）改动若浏览器一直跑旧模块**，报 `ReferenceError: BASE_SIZE is not defined`（时间戳 `?t=` 不变、持续报）。排查法：`Invoke-WebRequest localhost:5173/src/fish.js` 看服务器端模块是否已含该 import；服务器端正确 = 浏览器缓存旧版，**强制刷新 Ctrl+F5 / Ctrl+Shift+R** 即可，不必改代码。Vite 重启也会保留浏览器旧缓存。
- **数据/GC**：重建时 `f.traverse(o=>{if(o.isMesh){o.geometry?.dispose();o.material?.dispose?.()}})`；掠食者不在 fishes 数组里，重建不受影响。
- **坑：右键点击也撒食/惊散**。根因：`main.js renderer.domElement` 的 `pointerdown` 监听（feeding 交互）未过滤鼠标按钮，右键(button=2)/中键按下也会触发水面撒食或缸壁惊散。修法：handler 开头 `if (e.button !== 0) return;`，右键/中键保留给 OrbitControls 旋转/平移。

---

*最后更新：新增鱼大小/数量设置 + 修复右键误触发撒食。*
