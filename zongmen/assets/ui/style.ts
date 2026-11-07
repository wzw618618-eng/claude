// 界面样式：青灰夜色的面板配暖黄点缀。横屏为主，竖屏手机把头像栏放到底部、对话框全屏。

export const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.root {
  --ink: #0e1622; --ink2: #172234; --ink3: #22314a; --line: #33476a;
  --gold: #f0c35a; --gold2: #ffdf8e; --paper: #efe4c8; --text: #e9e4d6; --muted: #9aa5b8;
  --red: #e2604f; --green: #7fcf8f; --purple: #a98bd9;
  position: absolute; inset: 0; pointer-events: none; overflow: hidden;
  font-family: "Noto Sans SC", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  font-size: 15px; color: var(--text); -webkit-tap-highlight-color: transparent; user-select: none;
}
.root > * { pointer-events: auto; }
.serif { font-family: "Noto Serif SC", "Songti SC", "STSong", "Noto Serif CJK SC", serif; }
button { font: inherit; color: inherit; cursor: pointer; border: 1px solid var(--line); background: var(--ink2);
  border-radius: 10px; min-height: 44px; min-width: 44px; padding: 8px 14px; }
button:hover { border-color: var(--gold); }
button:disabled { opacity: .45; cursor: default; }
button.primary { background: linear-gradient(180deg, #f5cd6a, #d9a33a); color: #2a1a06; border-color: #f5d27a; font-weight: 700; }
button.ghost { background: rgba(14,22,34,.6); }
button.danger { background: #7a2b25; border-color: #b8463a; }
.panel { background: rgba(14,22,34,.92); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 8px 30px rgba(0,0,0,.45); }
.hidden { display: none !important; }

/* 标题 */
.title { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: radial-gradient(ellipse at 50% 40%, rgba(14,22,34,.35), rgba(5,8,14,.85)); gap: 12px; }
.title h1 { margin: 0; font-size: 56px; letter-spacing: 12px; color: var(--gold2); text-shadow: 0 0 24px rgba(255,190,85,.5), 0 2px 0 #000; }
.title .sub { color: var(--muted); font-size: 16px; margin-bottom: 18px; text-align: center; padding: 0 16px; }
.title .menu { display: flex; flex-direction: column; gap: 10px; width: min(300px, 80vw); }

/* 开场字幕 */
.intro { position: absolute; left: 0; right: 0; bottom: 0; padding: 20px 20px 28px; background: linear-gradient(transparent, rgba(5,8,14,.92) 40%); }
.intro .line { max-width: 860px; margin: 0 auto; font-size: 19px; line-height: 1.7; min-height: 3.4em; }
.intro .who { color: var(--gold); font-weight: 700; margin-right: 6px; }
.intro .bar { display: flex; justify-content: center; gap: 10px; margin-top: 10px; }

/* 顶栏 */
.top { position: absolute; top: 10px; left: 10px; right: 10px; display: flex; align-items: center; gap: 10px; pointer-events: none; }
.top > * { pointer-events: auto; }
.censer { display: flex; align-items: center; gap: 8px; padding: 6px 14px 6px 8px; }
.censer .num { font-size: 26px; font-weight: 800; color: var(--gold2); min-width: 1.6em; text-align: center; }
.censer .lbl { font-size: 13px; color: var(--muted); line-height: 1.2; }
.censer.low .num { color: var(--red); }
.case-info { padding: 6px 12px; font-size: 13px; color: var(--muted); }
.spacer { flex: 1; }

/* 严长老的提示 */
.toast { position: absolute; top: 70px; left: 50%; transform: translateX(-50%); max-width: min(680px, 92vw); padding: 10px 16px;
  font-size: 15px; line-height: 1.6; animation: fade 6s forwards; pointer-events: none; }
.toast b { color: var(--gold); }
@keyframes fade { 0%,85% { opacity: 1 } 100% { opacity: 0 } }

/* 底部头像栏 */
.cast { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); display: flex; gap: 8px; padding: 8px; }
.card { width: 104px; padding: 6px 6px 8px; display: flex; flex-direction: column; align-items: center; gap: 4px; position: relative; }
.card canvas, .card img { width: 56px; height: 56px; image-rendering: pixelated; border-radius: 8px; background: #26344c; }
.card .nm { font-size: 14px; font-weight: 700; }
.card .id { font-size: 12px; color: var(--muted); }
.card.refused { opacity: .55; }
.card .tag { position: absolute; top: 4px; right: 4px; font-size: 12px; padding: 1px 5px; border-radius: 6px; background: #3b2a55; }
.stress { width: 100%; height: 6px; border-radius: 3px; background: #2a3550; overflow: hidden; }
.stress i { display: block; height: 100%; background: linear-gradient(90deg, #7fcf8f, #f0c35a 55%, #e2604f); transition: width .4s; }
.mood { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 50%;
  font-size: 14px; font-weight: 800; color: #111; border: 2px solid rgba(0,0,0,.35); }
.mood.calm { background: #9fb6d6 } .mood.nervous { background: #f0c35a } .mood.angry { background: #e2604f; color: #fff }
.mood.scared { background: #a98bd9 } .mood.sad { background: #6f8fd0; color: #fff } .mood.relieved { background: #7fcf8f }
.card .mood { position: absolute; top: 4px; left: 4px; width: 22px; height: 22px; font-size: 12px; }

/* 右下角按钮 */
.actions { position: absolute; right: 10px; bottom: 10px; display: flex; flex-direction: column; gap: 8px; }
.actions button { width: 110px; }

/* 场景里的浮动标签 */
.float { position: absolute; transform: translate(-50%, -100%); pointer-events: auto; white-space: nowrap; }
.loc-label { padding: 6px 12px; border-radius: 999px; background: rgba(14,22,34,.86); border: 1px solid var(--gold); color: var(--gold2);
  font-weight: 700; box-shadow: 0 0 14px rgba(240,195,90,.35); }
.loc-label.visited { border-color: var(--line); color: var(--text); box-shadow: none; }
.head-mood { pointer-events: none; }

/* 地点面板 */
.sheet { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); width: min(720px, 94vw); padding: 14px 16px; }
.sheet h2 { margin: 0 0 6px; font-size: 20px; color: var(--gold2); }
.sheet .desc { color: var(--muted); line-height: 1.6; margin-bottom: 8px; }
.clue { background: var(--paper); color: #2b2216; border-radius: 10px; padding: 10px 12px; margin: 6px 0; line-height: 1.6; position: relative; }
.clue.new::after { content: "新"; position: absolute; top: -8px; right: -6px; background: var(--red); color: #fff; font-size: 12px; padding: 1px 6px; border-radius: 8px; }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }

/* 审问 */
.talk { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); width: min(820px, 96vw); max-height: 58vh;
  display: flex; flex-direction: column; padding: 10px 12px 12px; }
.talk header { display: flex; align-items: center; gap: 10px; }
.talk header button { white-space: nowrap; flex-shrink: 0; }
.talk header .notice { overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.talk header canvas, .talk header img { width: 44px; height: 44px; image-rendering: pixelated; border-radius: 8px; background: #26344c; }
.talk header .who { font-size: 18px; font-weight: 800; color: var(--gold2); }
.talk header .stress { width: 120px; }
.log { flex: 1; overflow-y: auto; margin: 8px 0; padding-right: 4px; min-height: 80px; max-height: 28vh; user-select: text; }
.msg { margin: 6px 0; display: flex; }
.msg span { padding: 8px 12px; border-radius: 12px; line-height: 1.6; max-width: 86%; }
.msg.player { justify-content: flex-end; } .msg.player span { background: #2d4366; }
.msg.disciple span { background: #efe4c8; color: #2b2216; }
.msg.system span { background: transparent; color: var(--muted); font-size: 14px; padding: 2px 4px; }
.msg.verdict span { background: #5a2b25; color: #ffd9c8; font-size: 14px; }
.msg.verdict.ok span { background: #3a3424; color: #e9dcb0; }
.inputrow { display: flex; gap: 8px; }
.inputrow input { flex: 1; min-height: 44px; font: inherit; font-size: 16px; color: var(--text); background: #0b121c; border: 1px solid var(--line);
  border-radius: 10px; padding: 8px 12px; user-select: text; }
.inputrow input:focus { outline: none; border-color: var(--gold); }
.quick { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
.quick button { font-size: 14px; padding: 6px 10px; }
.thinking { color: var(--muted); font-size: 14px; }

/* 全屏浮层：线索簿、档案、指认、设置、结局 */
.modal { position: absolute; inset: 0; background: rgba(4,7,12,.72); display: flex; align-items: center; justify-content: center; padding: 12px; }
.modal .panel { width: min(860px, 100%); max-height: 100%; display: flex; flex-direction: column; padding: 14px 16px; }
.modal h2 { margin: 0; font-size: 22px; color: var(--gold2); }
.modal .scroll { overflow-y: auto; margin: 10px 0; padding-right: 4px; user-select: text; }
.group h3 { margin: 12px 0 4px; font-size: 16px; color: var(--gold); }
.clue .meta { font-size: 12px; color: #7a6a4e; margin-top: 2px; }
.clue .meta b { color: #a23f2f; }
.clue button { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); min-height: 36px; padding: 4px 12px; color: #2a1a06; }
.clue.pickable { padding-right: 84px; }
.clue.picked { outline: 3px solid var(--gold); }
.traits { display: flex; gap: 6px; flex-wrap: wrap; margin: 6px 0; }
.traits span { padding: 3px 10px; border-radius: 999px; background: #22314a; border: 1px solid var(--line); font-size: 14px; }
.traits span.hidden-trait { border-style: dashed; }
.pick { display: flex; gap: 8px; flex-wrap: wrap; }
.pick .card { cursor: pointer; border: 2px solid transparent; }
.pick .card.on { border-color: var(--gold); }

/* 结局 */
.grade { font-size: 64px; font-weight: 900; text-align: center; color: var(--gold2); text-shadow: 0 0 30px rgba(255,190,85,.6); margin: 4px 0; }
.grade.fail { color: #ff8f80; text-shadow: 0 0 30px rgba(226,96,79,.6); }
.epilogue { line-height: 1.9; font-size: 16px; background: rgba(239,228,200,.08); padding: 10px 12px; border-radius: 10px; }
table.truth { width: 100%; border-collapse: collapse; font-size: 14px; margin-top: 8px; }
table.truth th, table.truth td { border-bottom: 1px solid var(--line); padding: 6px 4px; text-align: left; vertical-align: top; }
table.truth tr.culprit td { background: rgba(169,139,217,.16); }
table.truth .flaw { color: #ffcf9e; font-size: 13px; }
.stats { position: absolute; left: 10px; top: 66px; font-size: 12px; color: var(--muted); padding: 4px 8px; pointer-events: none; }
.notice { font-size: 13px; color: var(--muted); }
.mutebtn { min-width: 44px; padding: 6px 10px; }

@media (max-width: 760px), (orientation: portrait) {
  .title h1 { font-size: 40px; letter-spacing: 8px; }
  .cast { left: 0; right: 0; transform: none; bottom: 64px; justify-content: center; gap: 4px; padding: 6px; border-radius: 0; }
  .card { width: 19vw; max-width: 96px; padding: 4px 2px 6px; }
  .card canvas, .card img { width: 44px; height: 44px; }
  .card .id { display: none; }
  .actions { left: 10px; right: 10px; bottom: 8px; flex-direction: row; }
  .actions button { flex: 1; width: auto; }
  .talk { inset: 0; transform: none; width: 100%; max-height: none; border-radius: 0; top: 42vh; left: 0; }
  .log { max-height: none; }
  .sheet { bottom: 0; width: 100%; border-radius: 14px 14px 0 0; }
  .censer .lbl { display: none; }
  .talk header { gap: 6px; }
  .talk header .stress { display: none; }
  .talk header button { padding: 6px 10px; }
  .case-info { display: none; }
}
`;
