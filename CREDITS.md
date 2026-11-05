# 素材来源

## 画作

全部来自[大都会艺术博物馆开放获取](https://www.metmuseum.org/about-the-met/policies-and-documents/open-access)，属于公有领域，按 CC0 1.0 发布，可以自由使用、修改和商用。`art/paintings/` 里是裁剪、缩小后的原画，裁剪范围记在 `art/credits.json`；游戏里用的是再由 `scripts/pixelate.py` 缩成像素画的版本（`art/pixel-bg/`，长边 160 像素、28 色）。

| 文件 | 用在 | 原题 | 画家 | 年代 | 馆藏页 |
| --- | --- | --- | --- | --- | --- |
| `inn` | 标题、结局、夜里的日头 | Inn and Travelers in Snowy Mountains | 袁耀（Yuan Yao） | 1745 | [65640](https://www.metmuseum.org/art/collection/search/65640) |
| `retreat` | 白天的日头、胖叔、找到吴铁 | Snowy landscape with rustic riverside retreat | 刘松年（Liu Songnian） | ca. late 12th century | [40987](https://www.metmuseum.org/art/collection/search/40987) |
| `moonplum` | 夜里围炉、交心 | Viewing plum blossoms by moonlight | 马远（Ma Yuan） | early 13th century | [44638](https://www.metmuseum.org/art/collection/search/44638) |
| `travelers` | 找到客车、过路猎户 | Travelers in a Wintry Forest | Unidentified artist | early 12th century | [40003](https://www.metmuseum.org/art/collection/search/40003) |
| `ferry` | 林晚要走、有人出走、吴铁 | Waiting for the Ferry | Unidentified artist | early 13th century | [36007](https://www.metmuseum.org/art/collection/search/36007) |
| `snowdark` | 暴风雪、狼群、争吵、偷吃 | Snow Landscape | Unidentified artist | — | [51691](https://www.metmuseum.org/art/collection/search/51691) |
| `purewhite` | 有人离世、苏蔓 | The Pure Whiteness of Winter | Xu Jing | dated 1441 | [45671](https://www.metmuseum.org/art/collection/search/45671) |
| `pine` | 老秦 | Landscape with great pine | 马麟（Ma Lin） | second quarter 13th century | [36055](https://www.metmuseum.org/art/collection/search/36055) |
| `plummoon` | 林晚 | Flowering Plum in Moonlight and Snow | 刘世儒（Liu Shiru） | 16th century | [36084](https://www.metmuseum.org/art/collection/search/36084) |
| `geese` | 阿杰 | Wild Geese in Winter | Unidentified artist | 13th century | [36063](https://www.metmuseum.org/art/collection/search/36063) |
| `plumsnow` | 小满 | Plum in snow | 刘世儒（Liu Shiru） | — | [48942](https://www.metmuseum.org/art/collection/search/48942) |
| `snowpass` | 格桑 | Traveling through Snow-Covered Mountains | 姚彦卿（Yao Yanqing (Tingmei)） | — | [39549](https://www.metmuseum.org/art/collection/search/39549) |

## 人物形象

八个人的像素半身像是这个项目自己画的，没有用第三方素材：脸型、五官、头发、衣服都写在 `scripts/pixel/people.mjs` 里，由 `npm run art` 画成 48×48 的 PNG（`art/portraits/`）。每人三种表情跟着心情换，另有一帧闭眼用来眨眼。

## 图标

二十多个 12×12 的像素图标也是这个项目自己画的，写在 `scripts/pixel/icons.mjs` 里，由 `npm run art` 生成内联 SVG（`tiangong/assets/ui/icons.ts`）。

## 声音

没有音频文件。风雪、柴火、拨弦配乐和按键音都是运行时用 Web Audio 合成的（`tiangong/assets/ui/audio.ts`）。

## 字体

马善政毛笔楷书（Ma Shan Zheng）、思源宋体（Noto Serif SC），经 Google Fonts 加载，均为 SIL Open Font License。
