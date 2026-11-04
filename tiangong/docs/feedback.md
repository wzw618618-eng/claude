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

### 2026-11-04 — 改源码后，连接器无法替换自己启动的预览

- Scope: SDK
- Reproduction: `forgeax_run_current_game` 成功启动预览 → 修改 `assets/` 下的源码 → 再次调用 `forgeax_run_current_game`，或运行 `npx -y @forgeax/game preview stop --target-dir <game-root>`
- Expected: 重新构建并替换（或停止）这个连接器自己启动的预览
- Actual: 两者都返回 `preview_ownership_unverified: preview_static_digest_mismatch`，旧预览进程继续运行
- Evidence: 本工程开发过程中连续出现两次；手动结束旧预览进程后再调用即可成功
- Status: workaround

### 2026-11-04 — 无显卡环境下，无头浏览器里的软件 WebGPU 设备丢失

- Scope: browser
- Reproduction: 在没有 GPU 的 Linux 上用 Playwright 无头 Chromium 打开预览
- Expected: 用软件 WebGPU 正常运行
- Actual: `app-system-update-failed`，原因 `device-lost`（Device was destroyed）
- Evidence: 改用 Xvfb 有界面模式，并使用 devkit 里的软件渲染参数（`--use-webgpu-adapter=swiftshader` 等）后，空模板和本游戏都能以 40~60 FPS 运行
- Status: workaround

### 2026-11-04 — `@forgeax/npc-client` 尚未发布

- Scope: SDK
- Reproduction: `@forgeax/engine/npc` 的文档要求用 `@forgeax/npc-client` 实现灵魂与 affordance；`npm view @forgeax/npc-client` 返回 404
- Expected: 可安装的官方 NPC 客户端
- Actual: 包不存在
- Evidence: 本工程在 `assets/souls/soul-client.ts` 里自行实现了 `NpcClientPort`
- Status: workaround
