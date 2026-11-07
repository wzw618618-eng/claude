# 素材来源

本游戏没有使用任何外部图片、模型、字体、音频文件。所有画面和声音都由代码现场生成，版权归作者。

| 素材 | 怎么来的 | 代码 |
| --- | --- | --- |
| 场景、建筑、摆设、地面 | 程序生成的体素模型，转成带顶点颜色的网格 | `assets/scene/models.ts`、`assets/scene/voxel.ts` |
| 8 名弟子和严长老 | 程序生成的体素模型；外观由 `data/characters.json` 的特征决定 | `assets/scene/models.ts` |
| 头像 | 角色体素模型的正面投影，浏览器里画成像素图 | `assets/ui/portrait.ts` |
| 夜空与环境光 | 程序生成的 HDR 等距柱状图 | `assets/scene/scene.pack.ts` |
| 雨丝、闪电 | CSS 渐变与动画 | `assets/ui/style.ts` |
| 雨声、钟声、翻书声、矛盾成立的鼓点、雷声、结局拨弦 | Web Audio 现场合成（噪声加滤波、正弦与三角波） | `assets/ui/audio.ts` |
| 字体 | 使用玩家设备自带的中文字体，不打包字体文件 | `assets/ui/style.ts` |
| 引擎 | 天工引擎 ForgeaX Engine 0.4.8，Apache-2.0 | `package.json` |

AI 生成内容：弟子的对话和结局尾声在运行时由大模型（开发时用 DeepSeek-V4.1-Flash）生成，模型不可用时用 `data/` 里手写的模板台词。案件、规则、线索文字全部由代码和手写数据生成。
