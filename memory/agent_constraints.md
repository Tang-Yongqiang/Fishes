# 本环境 AI 工作流约束（我方，DSH Harness）

> 本文件是**我方（DeepSeek Harness 侧）自定的工作约束**，继承自 Trae 原文档
> `.trae/rules/project_rules.md` 的既有强约束，并按本环境实际情况适配。
> 冲突时以**用户最新指示**为最高优先级。

## 一、文档边界（最重要的新增约束）

- **Trae 时代的项目文档默认只读**：`.trae/rules/project_rules.md`、`memory/debug_experience.md`、
  `memory/development_status.md`、`CHANGELOG.md` 是原始资料，**不因"迁移/路径变更/表述过时"改写它们**。
- 本环境的经验、约束、迁移事实一律写入我方文件：`memory/harness_notes.md`（经验）、`memory/agent_constraints.md`（本文件）、`memory/github_experience.md`（git）。
- 例外：用户**明确要求**修正某份 Trae 文档（如"文档漂移更正"）时，才可改写，且只改用户指出的内容。
- 代码变更记录**不直接写入 `CHANGELOG.md`**：按绑定规则应记的外变更条目，先存我方 `memory/harness_notes.md`「待入 CHANGELOG 的变更条目」；**是否并入原 CHANGELOG 由用户决策**（通常提交时）。

## 二、工作流强约束（继承）

1. **证据优先**：修改 Bug 前必须先用日志/统计数据验证假设，禁止"猜一个原因就改代码"。
   修复后临时诊断默认关闭或清理。
2. **完成单元 = 改代码 → 记 CHANGELOG（Unreleased）→ `npm run build` 验证**，顺序不可颠倒。
   改 Android 原生层则以 `gradlew assembleDebug` 成功为完成门槛。
3. **记忆沉淀**：一轮调试/功能收尾前，把关键经验追加进本方 memory 文档；
   仅"技术原因无法写入"才可跳过，且必须告知用户。
4. **调试开关默认 `false`**。

## 三、git 约束（继承 + 本环境）

- 提交**由用户手动触发**，绝不自动/频繁提交；一个功能归并一次提交；中文提交信息。
- 推送走本地代理 `127.0.0.1:7897`（Clash，需用户手动开启）；连不上时**先问用户代理是否已开**，
  再决定重试代理或经用户同意改直连。不擅自 `-f` 强推。
- 详情见 `memory/github_experience.md`。

## 四、本环境操作速查

- dev：后台任务跑 `npm run dev`（Vite dev server, localhost:5173），用 HTTP 探测验证；
  停止用 job_kill。详情见 `memory/harness_notes.md` 二。
- build：`npm run build`（验证门槛）。资源管线（`assetsInclude`、`.glb?url` 失效、`new URL()`）见 harness_notes 二。
- Android 装机全套命令/坑：Trae 原文档 `memory/debug_experience.md` 三（只读参考）。

## 五、沟通与用户偏好（来源：用户级 Trae 全局记忆 ~/.trae-cn/memory/user_profile.md，只读参考）

- **交流语言用中文**。
- 用户习惯"改代码后跑验证/测试"：本项目无测试套件，验证门槛即 `npm run build`（+ 浏览器确认效果）。
- 用户 GitHub：Tang-Yongqiang，邮箱 `1771241202@qq.com`（需已在 GitHub 验证）。
- 用户技术背景：Python / Qt / PyInstaller / pynput（其他项目）；本仓库为 three.js 前端。
- 用户级全局经验库（跨项目，只读）：`c:\Users\Tangyq\.trae-cn\memory\github_experience.md`（通用 GitHub/代理）、`user_profile.md`（偏好/档案）。

## 六、优先级

用户直接指示 > 本文件自定约束 > Trae 原文档规则 > 通用惯例。