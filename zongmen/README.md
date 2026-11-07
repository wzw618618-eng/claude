# 宗门内奸

雨夜，青岚宗藏经阁的镇派秘籍失窃。你是刚接任的掌门，要在天亮前（30 炷香）审问 5 名由大模型驱动的弟子，找出魔门安插的内奸。

- 每局案件由代码按种子随机生成，并由求解器保证可解：只凭游戏里拿到的线索，就能推出唯一的内奸。
- 真相和规则全在代码里（谁在哪、谁撒谎、压力、能不能坦白、评级），AI 只负责“演”。
- 弟子会撒谎、会紧张；被逼急了，无辜者会坦白自己的小秘密，内奸会说漏嘴。
- 体素风雨夜宗门，跑在天工引擎（ForgeaX Engine 0.4.8）上。弟子的袍色、身高、草鞋和随身物就是推理线索。
- 模型服务不可用时自动切到模板应答，照样能玩完一局。

参赛：造化首届体素游戏创作大赛。进度、核实结论和决策见 [PROGRESS.md](PROGRESS.md)、[docs/RESEARCH.md](docs/RESEARCH.md)、[docs/DECISIONS.md](docs/DECISIONS.md)；引擎相关问题记在 [docs/feedback.md](docs/feedback.md)。

## 怎么玩

| 操作 | 做什么 |
| --- | --- |
| 勘察各处 | 打开宗门全景，点地点前去勘察。不耗香，物证自动记进线索簿 |
| 点下方弟子的头像 | 审问。打字（最多 60 字）或点快捷问题；“问某人的事”问他见没见过谁。每问一句烧一炷香 |
| 出示证据 | 从线索簿挑一条给他看。和他的说法对不上（矛盾成立），压力大涨 |
| 头顶的字、头像上的条 | 情绪（静、慌、怒、惧、悲、安）和压力 |
| 档案 | 弟子的三个特征（袍色、习惯、随身物）和与他相关的线索 |
| 指认内奸 | 选人，附 2 条证据。证据越硬、剩的香越多，评级越高（S 神探 / A 破案 / B 侥幸 / 失败） |

推理思路：藏经阁的痕迹指向窃贼的一个特征，先缩小到 2–3 名嫌疑人；看谁的不在场证明有别人或物证作证；剩下那个说法被戳穿的人就是内奸。

## 运行

需要 Node ≥ 22.13 和 pnpm。

```bash
pnpm install                              # 或用 SDK：node <sdk>/bin/forgeax.mjs project init
pnpm exec forgeax dev start --json        # 本地开发预览（模板应答）
pnpm run test:unit                        # 全部自动化测试（含 1000 个种子的可解性）
pnpm exec tsc --noEmit                    # 类型检查
pnpm exec forgeax project build --json    # 生产构建
node tools/ui-playthrough.mjs             # 真实浏览器从标题玩到结局，每步截图到 artifacts/playthrough/
```

接 DeepSeek（只在本机，密钥放环境变量，绝不进仓库和发布包）：

```bash
ZONGMEN_API_KEY=你的密钥 pnpm run proxy    # 本机代理，监听 127.0.0.1:8787
# 浏览器打开开发预览地址并加上 ?proxy=1，或在设置里选“本地代理（开发）”
```

命令行工具：

```bash
pnpm run cli -- case 20261207     # 打印一个案件和每名弟子的知识卡（剧透！）
pnpm run cli -- check             # 批量校验 1000 个种子
pnpm run cli -- play              # 文字版试玩（模板应答）
ZONGMEN_API_KEY=… pnpm run eval -- --provider openai_compatible        # AI 评测
ZONGMEN_API_KEY=… pnpm run playthrough                                 # 真实模型无头整局回放
pnpm run data                     # 改了 data/ 或 config/ 后重新打包数据
```

## 目录

```
forge.json                 引擎工程：engine 根 = 舞台插件，frontend 根 = 界面插件
assets/
  game/                    逻辑层（不引用引擎 API，Node 里单独测试）
    core/rng.ts            带种子的随机数
    case/                  事实与矛盾推导、案件生成器、求解器、案件打印
    game/                  规则（压力、坦白、失言、评级）、状态机、快捷问题
    ai/                    模型接口、提示词、校验流水线与兜底、模板应答、调用管线
    data/                  数据类型和打包结果（bundle.gen.ts 由 npm run data 生成）
  scene/                   体素场景
    voxel.ts               方块模型 → 带顶点颜色的网格
    models.ts              角色、建筑、摆设、地面的体素美术
    layout.ts              地点坐标、站位、镜头和屏幕投影（引擎和界面共用）
    scene.pack.ts          材质、夜空、网格和场景资产
    stage.pack.ts          引擎根插件：镜头移动、弟子站位与动作
  ui/                      界面（前端根插件）：控制器、渲染、样式、头像、模型选择
data/                      角色、特征、地点、秘密、案件模板、台词、提示词
config/game.json           问话额度、压力阈值、模型参数
tools/                     命令行、数据打包、AI 评测、整局回放、本机模型代理、浏览器回放
tests/                     自动化测试
docs/                      核实结论、决策记录、评测报告、引擎问题记录
skills/                    SDK 自带的引擎技能文档
```
