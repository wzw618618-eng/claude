# 宗门内奸

雨夜，青岚宗藏经阁的镇派秘籍失窃。你是刚接任的掌门，要在天亮前审问 5 名由大模型驱动的弟子，找出魔门安插的内奸。

- 每局案件由代码按种子随机生成，并由求解器保证可解：只凭游戏里拿到的线索，就能推出唯一的内奸。
- 真相和规则全在代码里（谁在哪、谁撒谎、压力、能不能坦白、评级），AI 只负责“演”。
- 模型服务不可用时自动切到模板应答，照样能玩完一局。

参赛：造化首届体素游戏创作大赛（天工引擎 / ForgeaX）。需求、核实结论和进度见 [PROGRESS.md](PROGRESS.md)、[docs/RESEARCH.md](docs/RESEARCH.md)、[docs/DECISIONS.md](docs/DECISIONS.md)。

## 运行

```bash
npm install
npm test                         # 全部自动化测试（含 1000 个种子的可解性）
npm run check                    # 类型检查
npm run cli -- case 20261207     # 打印一个案件和每名弟子的知识卡（剧透！）
npm run cli -- check             # 批量校验 1000 个种子
npm run cli -- play              # 文字版试玩（模板应答）
npm run eval                     # AI 评测（默认模板应答干跑）
npm run data                     # 改了 data/ 或 config/ 后重新打包数据
```

用真实模型（只在本机，密钥放环境变量，绝不进仓库）：

```bash
ZONGMEN_API_KEY=你的密钥 npm run cli -- play --provider openai_compatible
ZONGMEN_API_KEY=你的密钥 npm run eval -- --provider openai_compatible
```

接口地址和模型名在 `config/game.json` 的 `model.providers.openai_compatible`，也可以用 `ZONGMEN_BASE_URL`、`ZONGMEN_MODEL` 覆盖。

## 文字版怎么玩

| 命令 | 作用 |
| --- | --- |
| `查 地点` | 勘察（藏经阁、居所、丹房、膳堂、练武场、竹林、山门），不消耗问话 |
| `问 名字 话` | 审问，消耗 1 次问话；`问 名字 1/2/3` 是三个快捷问题 |
| `示 名字 编号` | 出示线索簿里的证据，消耗 1 次问话 |
| `簿` / `况` | 看线索簿 / 剩余问话和压力 |
| `指认 名字 编号 编号` | 指认内奸，附 2 条证据 |

## 目录

```
src/
  core/rng.ts              带种子的随机数
  case/facts.ts            事实类型、矛盾推导
  case/generator.ts        案件生成器
  case/solver.ts           可解性校验
  case/describe.ts         把案件打印成文字
  game/rules.ts            压力、坦白与失言权限、拒答、评级
  game/state.ts            一局的状态机
  game/quick.ts            快捷问题
  ai/client.ts             统一的模型调用接口（平台 / OpenAI 兼容 / 模板）
  ai/prompt.ts             拼装提示词
  ai/validate.ts           输出校验流水线与兜底
  ai/runner.ts             一轮审问的完整管线、尾声
  ai/templateResponder.ts  模板应答
  data/                    数据类型和打包结果
data/                      角色、特征、地点、秘密、案件模板、台词、提示词
config/game.json           问话额度、压力阈值、模型参数
tools/                     命令行、数据打包、AI 评测
tests/                     自动化测试
docs/                      核实结论、决策记录、评测报告
```

逻辑层（`src/`）不调用任何引擎 API，可以在 Node 里单独运行和测试；体素场景和界面（M3）会放在引擎工程里，只通过 `GameSession` 使用逻辑层。
