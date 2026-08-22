# GitHub 推送经验（本仓库 git 要点 + 本机通用环境经验）

> 来源：① 项目自身沉淀；② 用户级 Trae 全局记忆
> `c:\Users\Tangyq\.trae-cn\memory\github_experience.md`（跨项目复用，已吸收，原文件只读）。
> 权威提交/推送规则见 Trae 原文档 `.trae/rules/project_rules.md` 的「Git 提交与推送规则」小节。

## 本机环境事实（跨项目适用）

- Windows PowerShell；Git 凭据助手 = `manager`（Git Credential Manager）；**本机无 SSH 密钥 → 一律 HTTPS**。
- 直连 `github.com:443` 不稳定（常 Connection reset）→ 本地代理 **`127.0.0.1:7897`**（Clash 混合端口，Clash 未启动则不监听）。
- 探测本机代理监听端口：`Get-NetTCPConnection -State Listen | Where LocalPort -in 7890,7897,10809,10808,1080,8118,8888`
  （常见端口：Clash 7890/7897、V2rayN 10809、通用 1080）。
- 确认某端口是否监听：`Test-NetConnection -ComputerName 127.0.0.1 -Port 7897 -InformationLevel Quiet`（`False` = 代理未开）。
- HTTPS 认证：首次 `git ls-remote <url>` 触发浏览器 GitHub 登录，授权后凭据由 GCM 保存，之后无交互可用。

## 提交

- **时机**：由用户手动触发，**绝不自动/频繁提交**；日常小改动只在工作区累积。
- **粒度**：一个完整功能/主题归并一次提交，不按小改动拆开。
- **信息风格**：中文，`<类型>: <做什么>（<补充说明>）`。
- **身份**：统一 `Tang-Yongqiang <1771241202@qq.com>`（邮箱需在 GitHub 已验证；曾踩 `qq,com` 笔误坑）；
  本地未配置时用临时参数 `git -c user.name=... -c user.email=... commit ...`（不改全局）。

## 分支

- 单 `master` → `origin/main`；镜像推送：`git push -u origin master:main`（`-u` 设上游跟踪，之后直接 `git push`）。
- `mobile-showcase` 已归档为 tag `archive/mobile-showcase`（远端 tag `9b6832e`）并删除分支。
- 日常改动直接提交主分支，不建临时分支；大而可能反复推翻的功能才考虑 feature 分支。

## 推送（走代理；失败先问用户）

- `git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push ...`
- **代理需用户手动开启**。连接失败（`Failed to connect ... via 127.0.0.1:7897`）= 代理未开 →
  **先询问用户是否已开启代理**，再决定：开启后走代理重试，或用户同意后改试直连（历史直连成功过一次，直连/代理都试、以实际连通为准）。
- 里程碑应 push 一次避免丢失；不强制每次 commit 都 push。

## 远端冲突处理（non-fast-forward 被拒）

- GitHub 新仓库常自带 `main` 分支 + 占位 `README.md`（与本地历史无共同祖先）→ push 报 `rejected (non-fast-forward)`。
- 先 `git show origin/main:README.md` 确认远端内容；确认无价值且**用户同意**后才 `git push -u -f origin master:main`（不擅自强推）。

## 改写历史提交作者（filter-branch，含 PowerShell 坑）

- 目标：把历史提交作者/邮箱改成 GitHub 账户（GitHub 按**提交邮箱是否绑定账户**判定归属）。
- 前置：工作树必须干净（无 untracked/改动），否则报 "unstaged changes"；重写前先建 backup 分支作保险。
- 命令（PowerShell 直接跑，`FILTER_BRANCH_SQUELCH_WARNING=1`）：
  `git filter-branch -f --env-filter 'if [ "$GIT_AUTHOR_EMAIL" = "旧邮箱" ] || [ "$GIT_COMMITTER_EMAIL" = "旧邮箱" ]; then export GIT_AUTHOR_NAME="用户名"; export GIT_AUTHOR_EMAIL="新邮箱"; export GIT_COMMITTER_NAME="用户名"; export GIT_COMMITTER_EMAIL="新邮箱"; fi' -- --all`
- **坑**：
  - 用 PowerShell 直接跑（env-filter 单引号原样传递）；**绝不要**包 `bash -c`——Windows bash 路径转换异常（反斜杠被吞、无 /c 挂载）。
  - `--all` 会重写所有分支（含 backup、远端追踪），先建 backup。
  - 重写后验证：`git log --format="%an %ae" | Sort-Object -Unique`。
  - 清理 `refs/original`：`git for-each-ref refs/original | % { git update-ref -d $_ }`。

## PowerShell 操作坑

- 无 heredoc：`git commit -m "$(cat <<'EOF' ...)"` 报 syntax error → 用单行 `-m`。
- `git push` 的 stderr 会被 PowerShell 当错误显示（`git : To https://...`），但**退出码 0 即成功**——看 `-> main` / `new branch` 判断。
- Windows bash 识别不了 `C:\...` 反斜杠路径（被吞）→ 在 PowerShell 层处理路径，勿嵌 bash。

## 其他

- 仓库：https://github.com/Tang-Yongqiang/Fishes
- `android/` 原生层不入 master 版本库（生成物）；换机/换会话遭遇残缺时重建：
  `npm run build` → 删 `android/` → `npx cap add android` → `npx cap sync android` → gradlew assembleDebug（坑详见 `memory/debug_experience.md` 三）。