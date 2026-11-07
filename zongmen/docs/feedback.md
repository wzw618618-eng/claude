# Game Feedback

记录开发期间确认的 Engine、SDK、模板、构建、资产、运行时或浏览器问题。该文件会和根
`README.md` 一起原样进入 Web ZIP；不要写入 token、密码、私有 URL 或其他敏感信息。

```markdown
### YYYY-MM-DD — Short issue title

- Scope: Engine | SDK | template | build | asset | runtime | browser
- Reproduction: exact command or smallest user-visible sequence
- Expected: what should happen
- Actual: what happened
- Evidence: log, screenshot, URL, or commit path
- Status: open | workaround | fixed | blocked
```

### 2026-11-07 — 已有工程运行 `project init` 失败后，package.json 被改动

- Scope: SDK
- Reproduction: 已有工程的 `package.json#scripts.test` 为 `vitest run` → 在工程根目录运行 SDK 的 `node <sdk>/bin/forgeax.mjs project init --json` → 报 `project-script-conflict`；把 test 改成 `forgeax project test` 后再运行 → 报 `ERR_PNPM_OUTDATED_LOCKFILE`
- Expected: 失败时不改动 `package.json`；或第二次运行能按 SDK 的锁文件装好依赖
- Actual: 第二次失败后 `package.json#dependencies` 多出 72 个 `@forgeax/engine-*` 包，和 SDK 自带的 `pnpm-lock.yaml` 对不上
- Evidence: 本工程合并过程（见 git 历史 “改造成天工引擎工程”）
- Status: workaround（依赖恢复成只有 `@forgeax/engine`，沿用新建空白工程装好的 `node_modules`）

### 2026-11-07 — 无显卡沙箱里软件渲染约 1 FPS

- Scope: browser
- Reproduction: `forgeax project capture --backend software` 或持久截图会话打开本游戏
- Expected: 可交互的帧率
- Actual: 引擎帧率约 1 FPS（SwiftShader），镜头过渡要好几秒；画面和交互都正确
- Evidence: `artifacts/playthrough/run.json`（本地，不进仓库）
- Status: workaround（自动化脚本等镜头到位的标记 `data-camera-settled` 再操作）；真机待用户验证
