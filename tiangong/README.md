# 寒驿（天工引擎版）

大雪封山，八个陌生人困在半山腰的驿站里，要撑过三十个冬夜。白天派活求生，夜里围着火和每个人说话。

这一版跑在天工引擎（ForgeaX Engine 0.4.8）上，重点是**AI 角色**：每个人都是引擎里的一个 NPC 灵魂，夜谈通过引擎的 Intelligence 接口交给 AI 来演。

## 怎么玩

| 操作 | 做什么 |
| --- | --- |
| 点角色右边的岗位 | 给他派今天的活（砍柴、狩猎、搜寻、探路、营建、掌勺、照料、安抚、守夜、休息） |
| 人像上的气泡「想去……」 | 他自己想干的活和理由。点「照办」或「按大家的意思派活」采纳；每人每天第一次被采纳，信任 +1 |
| 点人物卡上的人像 | 看他的底细、和大家的关系，以及他的「NPC 灵魂」：认知层级、感知到的东西、能做的事 |
| 「营建」页 | 选一个工程开工，再派人去「营建」推进 |
| 右下角：结束今天 → 围炉夜话 → 熄火入睡 | 一天的三段。傍晚会有需要你拿主意的事 |
| 夜里点「说说话」 | 和角色聊天。信任够了，他们会说出心里的事，解锁对应的故事线 |
| 夜里的「有话想说」 | 心情很糟、心里有事、刚失去朋友的人会主动找你，打开对话时他先开口 |
| 底部菜单「日志」页顶部 | 选 AI 由谁来演：离线台词 / DeepSeek / 其他 OpenAI 兼容接口 / Claude（仅 claude.ai 内） |

撑到第三十天路就通了；有的人能让救援提前，前提是你先走进他们心里。

## AI 角色是怎么搭的

```
浏览器主线程（roots.frontend）              游戏世界（roots.engine）
┌──────────────────────────┐   GameHost.port   ┌───────────────────────────────┐
│ 界面：画进 GameHost.uiRoot │ ◀──── 状态 ────── │ CampSession：唯一的游戏状态      │
│                          │ ──── 操作/说话 ──▶ │                               │
│ AI 提供方（密钥只在这里）    │                   │ 每个角色一个 NpcBrain 实体        │
│  离线台词 / DeepSeek / …   │  Intelligence 端口 │  soulId、在场与否、认知 LOD        │
│ IntelligenceRuntime      │ ◀═══ Activity ══▶ │ npcPlugin → 灵魂客户端（感知、能做的事）│
└──────────────────────────┘                   │ 每帧 poll Activity 事件，校验后才改状态 │
                                               └───────────────────────────────┘
```

- **NpcBrain（`@forgeax/engine/npc`）**：每个角色一个实体，`soulId` 是 `hanyi.qin` 这样的名字。认知 LOD 三档：正在和你说话的人是「聚光」（每帧感知），营地里的人是「在场」（每两秒感知一次），离开或去世的人是「离场」（不再感知）。
- **灵魂客户端（`assets/souls/soul-client.ts`）**：实现引擎约定的 `NpcClientPort`（官方的 `@forgeax/npc-client` 还没有发布）。它记住每个灵魂能做的事（能接的活、能聊的话题、心事是否已说出口）和最近一次感知。
- **Intelligence（`@forgeax/engine/intelligence`）**：一句夜谈就是一个 Activity。游戏把提示词和备用台词装进一个「信封」提交，每帧 poll 事件：生成中的文字实时显示，结束后只有格式合规的 JSON 才会被采纳，信任和心情的变化也被夹在规则允许的范围里。
- **自己拿主意（`assets/hanyi/ai/intent.ts`）**：
  - 早上，每个在场的灵魂从自己「能做的事」里挑一件想干的活，并说一句理由；
  - 夜里，心里有事的人主动开口；
  - 围炉时，两个人之间会聊上几句，聊得好坏会改变他们的关系。
  离线时按性子和营地需要来定；接上 AI 后由 AI 按人设来定，但只能从允许的选项里挑，结果不合规就保留规则给的结果。离场的灵魂不参与。
- **AI 提供方（`assets/souls/providers.ts`）**：在浏览器主线程运行，经 `bindIntelligencePort` 桥接给游戏世界。换提供方不需要改游戏代码。

## 目录

| 路径 | 作用 |
| --- | --- |
| `forge.json` | 工程身份和两个根插件：`roots.engine` → 营地，`roots.frontend` → 界面 |
| `assets/camp.pack.ts` | 游戏世界根插件：注册 NpcBrain、装上 npcPlugin、每帧 poll AI |
| `assets/camp/` | 游戏会话（状态、实体对齐、夜谈）和消息协议 |
| `assets/souls/` | 灵魂客户端、请求信封、AI 提供方 |
| `assets/ui.pack.ts`、`assets/ui/` | 界面根插件、界面控制器、渲染和样式 |
| `assets/hanyi/` | 玩法本体：角色、事件、规则和各个玩法插件（与仓库根目录的独立网页版共用） |
| `assets/__tests__/` | 行为测试：灵魂与 LOD、Activity 夜谈流程、心事解锁故事线 |

```bash
pnpm exec forgeax project check --json
pnpm test
pnpm exec forgeax project build --json
pnpm typecheck
```

## 已知限制

- DeepSeek 等接口是在浏览器里直接调用的，需要接口允许跨域访问（CORS）；密钥保存在本机浏览器里，适合自己试玩，不适合公开发布。正式发布应改用引擎的 Host 侧提供方（例如官方的 DeepSeek Harness 适配器）。
- 这个工程在没有显卡的环境里只能用软件 WebGPU 跑；界面是 HTML，不依赖 3D 渲染。
