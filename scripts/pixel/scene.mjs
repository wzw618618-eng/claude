// 驿站场景的像素素材：八个人的全身小人（各种动作）、驿站剖面、家具、营建出来的东西、工具和特效。
// 全部手绘（字符画 + 几何图形），由 npm run art 打包成一张图集（scene-atlas.ts），运行时在 canvas 上拼出场景。
//
// 小人 10×16（加上外描边 12×18）：头 8 行、身子 5 行、腿 2 行。只描外轮廓，里面靠颜色区分。

import { Canvas, draw, line, poly } from './draw.mjs';
import { encodePNG } from './png.mjs';

const OUTLINE = '#1c1410';

/** 在画布外圈加一圈深色描边（只描透明和不透明的交界） */
function outline(cv, color = OUTLINE) {
  const add = [];
  for (let y = 0; y < cv.h; y++) {
    for (let x = 0; x < cv.w; x++) {
      if (cv.get(x, y)) continue;
      const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => cv.get(x + dx, y + dy) && cv.m(x + dx, y + dy) !== 'fx');
      if (n) add.push([x, y]);
    }
  }
  for (const [x, y] of add) cv.put(x, y, color, 'ol');
  return cv;
}

const rows = (cv, list, x0, y0, pal, mat = 'x') => draw(cv, list, y0, pal, { x0, mat });

// ───────────────── 人物 ─────────────────
// 每个人：皮肤、头发、衣服、裤子的颜色，以及头发/帽子、身上的标志物。

const SK = { fair: ['#f8d4bc', '#e0a88e'], warm: ['#f2c6a0', '#d8a07a'], tan: ['#dca57a', '#b87e58'], deep: ['#c98a60', '#a46a44'] };

export const CAST = {
  qin: { skin: SK.tan, hair: ['#a8a29a', '#7e7870'], coat: ['#5f7048', '#46552f', '#7a8c5e'], pants: '#3a3a32', boots: '#2a2018' },
  lin: { skin: SK.fair, hair: ['#4b3036', '#33212a'], coat: ['#c07a76', '#9c5558', '#dca29a'], pants: '#4a4250', boots: '#2a2228' },
  jie: { skin: SK.warm, hair: ['#4a3224', '#2e2018'], coat: ['#4f7ea8', '#33587e', '#78a6cc'], pants: '#3a3e4a', boots: '#3a2a20' },
  ma: { skin: SK.tan, hair: ['#3a322c', '#241e1a'], coat: ['#946630', '#6e4a22', '#b88a48'], pants: '#3e3a36', boots: '#2a2018' },
  su: { skin: SK.fair, hair: ['#23243a', '#14141f'], coat: ['#6f5390', '#4f3768', '#9378b4'], pants: '#2a2a34', boots: '#1e1a22' },
  man: { skin: SK.fair, hair: ['#704028', '#4e2c1e'], coat: ['#e3838a', '#c45a64', '#f3aeb0'], pants: '#7a4a52', boots: '#5a3a30', child: true },
  gesang: { skin: SK.deep, hair: ['#2a1e1e', '#150e0e'], coat: ['#b8402f', '#8c2a20', '#d8634a'], pants: '#3a3030', boots: '#2a1a14' },
  wu: { skin: SK.tan, hair: ['#5a5652', '#3a3836'], coat: ['#575f68', '#3e444c', '#737c86'], pants: '#3a3e44', boots: '#22201e' },
};

/** 画一个人的身体（站 / 走 / 干活 / 坐），返回 12×18 的画布 */
function person(id, pose) {
  const c = CAST[id];
  const cv = new Canvas(12, 18);
  const child = !!c.child;
  const dy = child ? 2 : 0; // 孩子矮两格
  const P = {
    s: c.skin[0], S: c.skin[1], h: c.hair[0], H: c.hair[1], c: c.coat[0], C: c.coat[1], l: c.coat[2],
    p: c.pants, b: c.boots, k: '#1a1210', w: '#f4f0ea', g: '#e0b850', r: '#d8383c', t: '#3fb5a8', o: '#f08a3a',
    v: '#e0721c', V: '#b4500e', x: '#eef3f6', u: '#8cc4cf', y: '#f0c040', n: '#8a5a34', m: '#d6c8b2', M: '#a8957e',
  };
  const X = 1; // 外描边留一格
  const by = 1 + dy; // 头顶
  // 腿
  const legs = {
    stand: ['..pp.pp...', '..bb.bb...'],
    walk0: ['.pp...pp..', '.bb...bb..'],
    walk1: ['...pppp...', '...bbbb...'],
    work0: ['..pp.pp...', '..bb.bb...'],
    work1: ['..pp..pp..', '..bb..bb..'],
    sit: ['.pppppp...', '.bb..bb...'],
  }[pose].map((r) => r.padEnd(10, '.'));
  const bodyTop = by + 8;
  const bodyRows = child ? 4 : 5;
  // 身子（衣服），手臂按动作变
  const torso = [];
  for (let i = 0; i < bodyRows; i++) torso.push(i === 0 ? '..lcccC...' : '.lcccccC..');
  rows(cv, torso.map((r) => r.padEnd(10, '.')), X, bodyTop, P, 'cloth');
  // 手
  const handY = bodyTop + bodyRows - 1;
  if (pose === 'work0') {
    rows(cv, ['........s', '........C', '........C'], X, bodyTop - 2, P, 'arm');
    rows(cv, ['s'], X + 1, handY, P, 'arm');
  } else if (pose === 'work1') {
    rows(cv, ['........s'], X, handY - 1, P, 'arm');
    rows(cv, ['s'], X + 1, handY, P, 'arm');
  } else {
    rows(cv, ['s......s'], X + 1, handY, P, 'arm');
  }
  rows(cv, legs, X, bodyTop + bodyRows, P, 'leg');
  // 头
  const head = ['...ssss...', '..ssssss..', '.ssssssss.', '.ssssssss.', '.ssssssss.', '.ssssssss.', '..ssssSS..', '...sssS...'];
  rows(cv, head, X, by, P, 'face');
  // 眼睛
  rows(cv, ['...k..k...'], X, by + 4, P, 'eye');
  if (child || id === 'lin' || id === 'gesang') rows(cv, ['...k..k...'], X, by + 5, P, 'eye');
  // 每个人的头发、帽子和标志物
  const F = FEATURES[id];
  F(cv, P, X, by, bodyTop, pose);
  if (pose === 'sit') {
    // 坐下：整体下移两格（腿折起来）
    const out = new Canvas(12, 18);
    for (let y = 0; y < 18; y++) for (let x = 0; x < 12; x++) {
      const col = cv.get(x, y);
      if (col && y + 2 < 18) out.put(x, y + 2, col, cv.m(x, y));
    }
    return outline(out);
  }
  return outline(cv);
}

const FEATURES = {
  qin(cv, P, X, by) {
    // 雷锋帽：橄榄绿帽顶、毛边、放下来的护耳；灰白山羊胡
    const hat = { g: '#7a8c5e', G: '#5a6b44', f: '#b08c66', F: '#8e6a48' };
    rows(cv, ['..gggggg..', '.gggggggg.', 'FfFfFfFfFf', 'GG......GG', 'GG......GG', 'GF......FG', '.F......F.'], X, by - 1, hat, 'hat');
    rows(cv, ['..hh..', '.hhhh.', '..hh..'], X + 2, by + 6, P, 'beard');
  },
  lin(cv, P, X, by, bodyTop) {
    rows(cv, ['..hhhhhh..', '.hhhhhhhh.', 'hhhhhhhssh', 'hhhs...ssh', 'hh......sh', 'hh.......h', 'h.........'], X, by - 1, P, 'hair');
    // 搭在左肩的马尾
    rows(cv, ['h', 'h', 'H', 'h', 'H'], X, bodyTop, P, 'hair');
    rows(cv, ['u'], X + 1, by + 6, { u: '#8cc4cf' }, 'acc');
    // 大衣里的护士服
    rows(cv, ['....uu....', '....uu....'], X, bodyTop + 1, P, 'cloth');
  },
  jie(cv, P, X, by, bodyTop) {
    rows(cv, ['.h..h.h...', '.hhhhhhhh.', 'hhhhhhhhhh', 'hhhhhhhhhh', 'h.h..h.hhh', 'h.......hh'], X, by - 2, P, 'hair');
    rows(cv, ['y'], X + 9, by + 3, P, 'acc');
    // 斜挎的画板带
    rows(cv, ['.n........', '..n.......', '...n......', '....n.....'], X, bodyTop + 1, P, 'strap');
    rows(cv, ['o'], X + 2, by + 6, P, 'paint');
  },
  ma(cv, P, X, by, bodyTop) {
    rows(cv, ['...HHHH...', '..HhHhHH..', '.H......H.'], X, by - 1, P, 'hair');
    rows(cv, ['..kkkk..'], X + 1, by + 6, P, 'beard');
    // 白毛巾
    rows(cv, ['..xxxxxx..', '..x....x..', '..x....x..', '..u....u..'], X, bodyTop, P, 'towel');
  },
  su(cv, P, X, by) {
    rows(cv, ['..hhhhhh..', '.hhhhhhhh.', 'hhhhhhhhhh', 'hhhh...shh', 'hh......hh', 'hh......hh', 'hh......hh', '.h......h.'], X, by - 1, P, 'hair');
    // 金丝眼镜
    rows(cv, ['..g.gg.g..'], X, by + 4, P, 'glasses');
    rows(cv, ['...k..k...'], X, by + 4, P, 'eye');
    rows(cv, ['....r.....'], X, by + 6, { r: '#b8323e' }, 'lip');
  },
  man(cv, P, X, by, bodyTop) {
    rows(cv, ['HH......HH', 'hHh....hHh', '.hhhhhhhh.', 'hhhhhhhhhh', 'hhhhhhhhhh', 'hh......hh', 'h........h'], X, by - 2, P, 'hair');
    rows(cv, ['.r......r.'], X, by, P, 'acc');
    rows(cv, ['.p......p.'], X, by + 6, { p: '#f4a29a' }, 'blush');
    // 怀里的布兔子
    rows(cv, ['m.m', 'mmm', 'mMm', 'Mmm'], X - 1, bodyTop, P, 'toy');
    // 碎花
    rows(cv, ['...l..l...', '.....l....'], X, bodyTop + 1, P, 'cloth');
  },
  gesang(cv, P, X, by, bodyTop) {
    rows(cv, ['.ttGGGGtt.', '.hhhhhhhh.', 'hhhhhhhhhh', 'hhs....shh', 'hh......hh', 'h........h'], X, by - 1, { ...P, G: '#a8703a' }, 'hair');
    // 两条辫子垂在胸前，缀着绿松石
    rows(cv, ['h........h', 'H........H', 't........t', 'h........h'], X, bodyTop, P, 'braid');
    rows(cv, ['.p......p.'], X, by + 6, { p: '#c0473f' }, 'blush');
  },
  wu(cv, P, X, by, bodyTop) {
    const cap = { a: '#6c7c8c', A: '#4f5d6c', B: '#36424f' };
    rows(cv, ['..aaaaaa..', '.aaaaaaaa.', 'BBBBBBBBBB', '.h......h.'], X, by - 1, { ...cap, h: P.h }, 'hat');
    rows(cv, ['.h.h.h.'], X + 1, by + 7, P, 'stubble');
    // 橘色反光背心
    rows(cv, ['..v...V...', '.vv...VV..', '.vv...VV..', '.xxxxxxx..', '.vv...VV..'], X, bodyTop, P, 'vest');
  },
};

/** 躺着：头在左边枕着，身子盖着被子（被子用这个人衣服的颜色） */
function lying(id, closed = true) {
  const c = CAST[id];
  const cv = new Canvas(17, 9);
  const P = { s: c.skin[0], S: c.skin[1], h: c.hair[0], H: c.hair[1], c: c.coat[0], C: c.coat[1], l: c.coat[2], k: '#1a1210' };
  rows(cv, ['......lllllllll', '.....lccccccccC', '.....lccccccccC', '.....CCCCCCCCCC'], 1, 4, P, 'cloth');
  rows(cv, ['.hhhh.', 'hhhhhh', 'hsssss', 'hsssss', 'hssss.', '.sssS.'], 1, 2, P, 'face');
  if (closed) rows(cv, ['..kk..'], 1, 5, P, 'eye');
  return outline(cv);
}

/** 工具挂在手上的位置（相对小人左上角）：work0 手举起，work1 手放低 */
export const HAND = { work0: [9, 7], work1: [10, 12], stand: [9, 13], sit: [9, 15] };

// ───────────────── 工具和小特效 ─────────────────

const TOOLS = {
  axe0: [['..kk', '.kkk', 'kkn.', '..n.', '..n.', '..n.'], { k: '#9aa2aa', n: '#8a5a34' }],
  axe1: [['......', 'nnnnkk', '....kk'], { k: '#9aa2aa', n: '#8a5a34' }],
  hammer0: [['kkk', '.n.', '.n.', '.n.'], { k: '#6a6e74', n: '#8a5a34' }],
  hammer1: [['nnnk', '...k'], { k: '#6a6e74', n: '#8a5a34' }],
  ladle0: [['n', 'n', 'n', 'kk'], { k: '#8a8c90', n: '#c8a070' }],
  ladle1: [['nnn', '..k'], { k: '#8a8c90', n: '#c8a070' }],
  bow: [['.nn', 'n.k', 'n.k', 'n.k', 'n.k', '.nn'], { n: '#8a5a34', k: '#e8e0d0' }],
  lantern: [['.k.', 'kyk', 'kyk', 'kkk'], { k: '#3a3230', y: '#ffc860' }],
  lanternOff: [['.k.', 'kak', 'kak', 'kkk'], { k: '#3a3230', a: '#6a6458' }],
  pack: [['.nn.', 'nnnn', 'nmmn', 'nnnn'], { n: '#6a4a30', m: '#8a6a48' }],
  bandage: [['ww', 'ww'], { w: '#f4f0ea' }],
  dots: [['wwwwwww', 'w.w.w.w', 'wwwwwww', '..w....'], { w: '#f4efe6' }],
  bang: [['wwwww', 'ww.ww', 'ww.ww', 'wwwww', 'ww.ww', 'wwwww', '.w...'], { w: '#f4efe6' }],
  heart: [['.r.r.', 'rrrrr', '.rrr.', '..r..'], { r: '#f27a8a' }],
  z: [['zzz', '..z', '.z.', 'zzz'], { z: '#cfd8e6' }],
  steam: [['.w', 'w.', '.w'], { w: '#e8eef2' }],
};

// ───────────────── 驿站剖面 ─────────────────
// 70×48。屋顶尖在上面；地板在 y 44（场景里 y 56）。窗户是透明的洞，能看见后面的天。

export const HOUSE_X = 25;
export const HOUSE_Y = 10;

function house() {
  const cv = new Canvas(70, 48);
  const C = {
    log: '#6e4b33', logD: '#573a27', logL: '#80593c', cut: '#3a281b', cutL: '#4e3624',
    floor: '#8a6446', floorD: '#6a4a33', roof: '#4e3222', roofD: '#3a2418', roofL: '#674430', snow: '#eef3f6', snowS: '#c6d3dc',
    stone: '#8a8c90', stoneD: '#5e6066', brick: '#8a5a4a', brickD: '#6a4036', mortar: '#a88070', iron: '#2c2c32', ironL: '#4a4a52',
    wood: '#9a6e48', woodD: '#6e4a30', straw: '#c8b07a', strawD: '#a08850', mat: '#d8c8a0', cloth: '#e8e2d6',
  };
  // 后墙：横着的原木
  for (let y = 14; y <= 44; y++) {
    for (let x = 3; x <= 66; x++) {
      const k = (y - 14) % 4;
      cv.put(x, y, k === 0 ? C.logD : k === 1 ? C.logL : C.log, 'wall');
    }
  }
  // 原木接缝
  for (let y = 16; y <= 44; y += 4) for (const x of [12, 31, 50]) cv.put(x + ((y / 4) % 2 ? 6 : 0), y, C.logD, 'wall');
  // 窗户（透明的洞，加窗框）
  for (let y = 20; y <= 27; y++) for (let x = 13; x <= 22; x++) cv.erase(x, y);
  for (let x = 12; x <= 23; x++) { cv.put(x, 19, C.woodD, 'frame'); cv.put(x, 28, C.woodD, 'frame'); }
  for (let y = 19; y <= 28; y++) { cv.put(12, y, C.woodD, 'frame'); cv.put(23, y, C.woodD, 'frame'); cv.put(17, y, C.woodD, 'frame'); cv.put(18, y, C.wood, 'frame'); }
  for (let x = 12; x <= 23; x++) cv.put(x, 29, C.wood, 'frame');
  // 两侧的墙（剖面）
  for (let y = 12; y <= 45; y++) {
    for (const x of [0, 1, 2]) cv.put(x, y, x === 2 ? C.cutL : C.cut, 'side');
    if (y < 27) for (const x of [67, 68, 69]) cv.put(x, y, x === 67 ? C.cutL : C.cut, 'side');
  }
  // 右边墙上开着门（门洞透明），门框
  for (let y = 27; y <= 44; y++) cv.put(69, y, C.woodD, 'frame');
  for (const x of [67, 68, 69]) cv.put(x, 26, C.woodD, 'frame');
  // 地板
  for (let x = 0; x <= 69; x++) {
    cv.put(x, 44, C.floorD, 'floor');
    cv.put(x, 45, C.floor, 'floor');
    cv.put(x, 46, x % 7 === 0 ? C.floorD : C.floor, 'floor');
    cv.put(x, 47, C.stoneD, 'floor');
  }
  // 屋顶：三角，压着雪，挂着冰溜子
  poly(cv, [[-1, 15], [35, -1], [71, 15]], C.roof, 'roof');
  const roof = new Set();
  for (let y = 0; y <= 15; y++) for (let x = 0; x < 70; x++) if (cv.m(x, y) === 'roof') roof.add(y * 100 + x);
  const isRoof = (x, y) => roof.has(y * 100 + x);
  for (let y = 0; y <= 15; y++) for (let x = 0; x < 70; x++) {
    if (!isRoof(x, y)) continue;
    // 坡面上压着两三格厚的雪，下面露出瓦和屋檐
    const depth = isRoof(x, y - 1) ? (isRoof(x, y - 2) ? (isRoof(x, y - 3) ? 3 : 2) : 1) : 0;
    let col = (x + y * 2) % 6 === 0 ? C.roofD : (x * 3 + y) % 7 === 0 ? C.roofL : C.roof;
    if (depth === 0) col = C.snow;
    else if (depth === 1) col = C.snow;
    else if (depth === 2) col = C.snowS;
    if (y === 15) col = C.roofD;
    else if (y === 14) col = C.roofL;
    cv.put(x, y, col, depth < 3 && y < 14 ? 'snow' : 'roof');
  }
  for (const [x, l] of [[4, 2], [9, 3], [15, 1], [22, 2], [30, 3], [41, 2], [48, 1], [55, 3], [61, 2], [66, 1]]) {
    for (let i = 0; i < l; i++) cv.put(x, 16 + i, i === l - 1 ? C.snow : C.snowS, 'ice');
  }
  // 屋檐下的阴影
  for (let x = 3; x <= 66; x++) cv.put(x, 16, C.cut, 'wall');
  // 灶台（左）：砖砌，上面坐着锅，烟囱管子穿出屋顶
  for (let y = 34; y <= 43; y++) for (let x = 4; x <= 13; x++) {
    const brick = (y % 3 === 0) || ((x + (Math.floor(y / 3) % 2) * 2) % 4 === 0);
    cv.put(x, y, brick ? C.mortar : (x + y) % 5 ? C.brick : C.brickD, 'stove');
  }
  for (let x = 4; x <= 13; x++) cv.put(x, 33, C.stoneD, 'stove');
  for (let y = 38; y <= 41; y++) for (let x = 7; x <= 10; x++) cv.put(x, y, y === 38 ? C.iron : '#e86a2a', 'stovefire');
  rows(cv, ['.kkkkkk.', 'kKKKKKKk', 'kkkkkkkk', '.kkkkkk.'], 5, 29, { k: C.iron, K: C.ironL }, 'pot');
  for (let y = 5; y <= 28; y++) { cv.put(11, y, C.ironL, 'pipe'); cv.put(12, y, C.iron, 'pipe'); }
  for (let y = 3; y <= 5; y++) for (let x = 10; x <= 13; x++) cv.put(x, y, y === 3 ? C.snow : C.iron, 'pipe');
  // 桌子和凳子（窗下）
  for (let x = 15; x <= 23; x++) { cv.put(x, 36, C.wood, 'table'); cv.put(x, 37, C.woodD, 'table'); }
  for (let y = 38; y <= 43; y++) { cv.put(16, y, C.woodD, 'table'); cv.put(22, y, C.woodD, 'table'); }
  // 火塘（中间）：一圈石头
  rows(cv, ['.aaAaaAaaa.', 'aAAaaAAaaAa'], 23, 42, { a: C.stone, A: C.stoneD }, 'pit');
  // 墙上的药架
  for (let x = 42; x <= 49; x++) cv.put(x, 24, C.woodD, 'shelf');
  rows(cv, ['w.r.ww', 'w.r.ww'], 43, 22, { w: '#e8e8e0', r: '#c04040' }, 'shelf');
  // 草垫（伤病员躺的地方）
  for (let x = 39; x <= 51; x++) { cv.put(x, 43, x % 3 ? C.straw : C.strawD, 'mat'); }
  // 上下铺
  for (let y = 22; y <= 43; y++) { cv.put(53, y, C.woodD, 'bunk'); cv.put(66, y, C.woodD, 'bunk'); }
  for (let x = 53; x <= 66; x++) {
    cv.put(x, 40, C.wood, 'bunk'); cv.put(x, 41, C.woodD, 'bunk'); cv.put(x, 39, C.mat, 'bunk');
    cv.put(x, 29, C.wood, 'bunk'); cv.put(x, 30, C.woodD, 'bunk'); cv.put(x, 28, C.mat, 'bunk');
  }
  for (let y = 29; y <= 39; y += 2) cv.put(64, y, C.wood, 'bunk');
  // 门边挂灯的钩子
  return cv;
}

// 营建出来的东西
function boards() { // 封窗堵缝：窗上钉了木板
  const cv = new Canvas(12, 11);
  line(cv, 0, 2, 11, 3, '#9a6e48', 'b'); line(cv, 0, 3, 11, 4, '#6e4a30', 'b');
  line(cv, 0, 7, 11, 6, '#9a6e48', 'b'); line(cv, 0, 8, 11, 7, '#6e4a30', 'b');
  return cv;
}
function hearthStone() { // 砌火塘：更大的石头火塘
  const cv = new Canvas(15, 7);
  rows(cv, ['..aaAaaaAaa..', '.aAAaaAaaAAa.', 'aaaAaaaAaaaAa', 'AaaaAAaaaaAaA'], 1, 3, { a: '#9a9ca0', A: '#6a6c72' });
  return cv;
}
function curtain() { // 医务角：布帘和红十字
  const cv = new Canvas(14, 18);
  for (let x = 0; x < 14; x++) cv.put(x, 0, '#6e4a30', 'rod');
  for (let y = 1; y < 18; y++) for (let x = 0; x < 3; x++) cv.put(x, y, x === 1 ? '#d8d2c6' : '#efeae0', 'cloth');
  rows(cv, ['.rr.', 'rrrr', 'rrrr', '.rr.'], 7, 3, { r: '#d04040' });
  return cv;
}
function tower() { // 瞭望台：屋顶上的木台子和梯子
  const cv = new Canvas(16, 16);
  for (let x = 0; x < 16; x++) { cv.put(x, 4, '#9a6e48', 't'); cv.put(x, 5, '#6e4a30', 't'); }
  for (let y = 0; y < 4; y++) { cv.put(0, y, '#6e4a30', 't'); cv.put(15, y, '#6e4a30', 't'); }
  for (let x = 0; x < 16; x++) cv.put(x, 0, '#9a6e48', 't');
  for (let y = 6; y < 16; y++) { cv.put(2, y, '#6e4a30', 't'); cv.put(13, y, '#6e4a30', 't'); }
  for (let y = 8; y < 16; y += 3) for (let x = 2; x <= 13; x++) if ((x + y) % 2) cv.put(x, y, '#6e4a30', 't');
  for (let x = 0; x < 16; x++) cv.put(x, 3, '#eef3f6', 'snow');
  return cv;
}
function antenna() {
  const cv = new Canvas(9, 14);
  for (let y = 0; y < 14; y++) cv.put(4, y, '#9aa2aa', 'a');
  line(cv, 4, 2, 0, 6, '#6a7078', 'a'); line(cv, 4, 2, 8, 6, '#6a7078', 'a');
  cv.put(4, 0, '#ff5050', 'a');
  return cv;
}
function radio() {
  const cv = new Canvas(7, 5);
  rows(cv, ['.....k.', 'kkkkkkk', 'kgggkwk', 'kgggkwk', 'kkkkkkk'], 0, 0, { k: '#3a3e44', g: '#6aa070', w: '#cfd3dc' });
  return cv;
}
function phone() {
  const cv = new Canvas(7, 5);
  rows(cv, ['.k.....', '.k.....', 'kkk.bbb', 'kgk.byb', 'kkk.bbb'], 0, 0, { k: '#2a2e34', g: '#7ad0e0', b: '#5a4a3a', y: '#e0c040' });
  return cv;
}
function rack() { // 熏肉架
  const cv = new Canvas(14, 16);
  for (let y = 2; y < 16; y++) { cv.put(1, y, '#6e4a30', 'r'); cv.put(12, y, '#6e4a30', 'r'); }
  for (let x = 0; x < 14; x++) { cv.put(x, 2, '#9a6e48', 'r'); cv.put(x, 1, '#eef3f6', 'snow'); }
  return cv;
}
function meat() {
  const cv = new Canvas(2, 5);
  rows(cv, ['k.', 'mm', 'mM', 'mM', 'M.'], 0, 0, { k: '#3a3230', m: '#a0483a', M: '#7a3028' });
  return cv;
}
function scaffold() { // 施工中：一摞木板和工具箱
  const cv = new Canvas(12, 6);
  rows(cv, ['......nnnnnn', 'nnnnnnNNNNNN', 'NNNNNNnnnnnn', 'nnnnnnNNNNNN'], 0, 2, { n: '#b08458', N: '#8a6446' });
  return cv;
}
function chopBlock() {
  const cv = new Canvas(7, 5);
  rows(cv, ['.mmmmm.', 'nnnnnnn', 'nNnnNnn', 'nnnNnnn', 'Nnnnnnn'], 0, 0, { m: '#c8a070', n: '#8a5a34', N: '#6a4024' });
  return cv;
}
function logEnd() {
  const cv = new Canvas(4, 4);
  rows(cv, ['.nn.', 'nmmn', 'nmmn', '.nn.'], 0, 0, { n: '#6a4024', m: '#c8a070' });
  return cv;
}
function sack() {
  const cv = new Canvas(6, 6);
  rows(cv, ['..kk..', '.mmmm.', 'mmmmmm', 'mMmmmm', 'mmmmMm', '.mmmm.'], 0, 0, { k: '#8a6446', m: '#c8b48a', M: '#a8946a' });
  return outline(cv);
}
function pine(h) {
  const cv = new Canvas(15, h);
  const g = ['#1e3a30', '#2a4a3c', '#36584a'];
  const trunk = Math.max(3, Math.round(h * 0.15));
  for (let y = 0; y < h - trunk; y++) {
    const t = y / (h - trunk);
    const band = (y % 5) / 5;
    const w = Math.round(1 + (t * 6.5) * (0.65 + band * 0.45));
    for (let x = 7 - w; x <= 7 + w; x++) {
      if (x < 0 || x > 14) continue;
      const snowy = band < 0.25 && x < 7 + w - 1;
      cv.put(x, y, snowy ? '#e6edf2' : x < 7 ? g[1] : x === 7 ? g[2] : g[0], 'tree');
    }
  }
  for (let y = h - trunk; y < h; y++) { cv.put(7, y, '#4a3022', 'tree'); cv.put(6, y, '#5a3a28', 'tree'); }
  return cv;
}
function car() { // 雪里半埋着的车（搜寻的地方）
  const cv = new Canvas(22, 10);
  rows(cv, [
    '.....bbbbbbbb.........',
    '....bwwbwwwwbb........',
    '...bbwwbwwwwbbb.......',
    'bbbbbbbbbbbbbbbbbbbb..',
    'bRRRRRRRRRRRRRRRRRRRb.',
    'bRrrrrrrrrrrrrrrrrrRb.',
    'bbkkbbbbbbbbbbbbkkbbb.',
  ], 0, 1, { b: '#2a3038', w: '#8aa8c0', R: '#c45a3a', r: '#a04a30', k: '#1a1a1e' });
  for (let x = 0; x < 22; x++) cv.put(x, 0, x > 4 && x < 13 ? '#eef3f6' : null, 'snow');
  return cv;
}
function fire(f) {
  const cv = new Canvas(9, 10);
  const frames = [
    ['....y....', '...yy....', '...yoy...', '..yoooy..', '..yoOoy..', '.yooOooy.', '.yoOOOoy.', '..oOOOo..', '...OOO...', '.........'],
    ['.....y...', '....yy...', '...yoy...', '..yooy...', '..yoOoy..', '.yooOooy.', '.yoOOOoy.', '..oOOOo..', '...OOO...', '.........'],
    ['...y.....', '...yy....', '..yoy....', '..yoooy..', '.yooOoy..', '.yooOooy.', '.yoOOOoy.', '..oOOOo..', '...OOO...', '.........'],
  ];
  rows(cv, frames[f], 0, 0, { y: '#ffd070', o: '#ff9a3a', O: '#e05020' }, 'fx');
  return cv;
}
function embers() {
  const cv = new Canvas(9, 3);
  rows(cv, ['..r.R....', '.RrRrR...', 'RrRRrRr..'], 0, 0, { r: '#c03a20', R: '#7a2418' }, 'fx');
  return cv;
}
function logsInFire() {
  const cv = new Canvas(9, 3);
  rows(cv, ['n......n.', '.nnn.nn..', '..nnnn...'], 0, 0, { n: '#4a3022' });
  return cv;
}

// ───────────────── 打包成图集 ─────────────────

export function buildScene() {
  const sprites = {};
  for (const id of Object.keys(CAST)) {
    for (const pose of ['stand', 'walk0', 'walk1', 'work0', 'work1', 'sit']) sprites[`${id}.${pose}`] = person(id, pose);
    sprites[`${id}.lie`] = lying(id);
  }
  for (const [k, [r, pal]] of Object.entries(TOOLS)) {
    const w = Math.max(...r.map((x) => x.length));
    const cv = new Canvas(w + 2, r.length + 2);
    rows(cv, r, 1, 1, pal);
    sprites[`tool.${k}`] = ['dots', 'bang', 'z', 'steam', 'heart'].includes(k) ? outline(cv, k === 'z' || k === 'steam' ? '#3a4658' : '#2a2420') : outline(cv);
  }
  sprites.house = house();
  sprites.boards = boards();
  sprites.hearth = hearthStone();
  sprites.curtain = curtain();
  sprites.tower = tower();
  sprites.antenna = antenna();
  sprites.radio = radio();
  sprites.phone = phone();
  sprites.rack = rack();
  sprites.meat = meat();
  sprites.scaffold = scaffold();
  sprites.block = chopBlock();
  sprites.log = logEnd();
  sprites.sack = sack();
  sprites.pine = pine(26);
  sprites.pineS = pine(18);
  sprites.car = car();
  for (let i = 0; i < 3; i++) sprites[`fire${i}`] = fire(i);
  sprites.embers = embers();
  sprites.firelogs = logsInFire();

  // 架子式装箱
  const names = Object.keys(sprites);
  names.sort((a, b) => sprites[b].h - sprites[a].h);
  const W = 256;
  let x = 0, y = 0, rowH = 0;
  const frames = {};
  for (const n of names) {
    const s = sprites[n];
    if (x + s.w > W) { x = 0; y += rowH + 1; rowH = 0; }
    frames[n] = [x, y, s.w, s.h];
    x += s.w + 1;
    rowH = Math.max(rowH, s.h);
  }
  const H = y + rowH;
  const atlas = new Canvas(W, H);
  for (const n of names) {
    const [fx, fy] = frames[n];
    const s = sprites[n];
    for (let yy = 0; yy < s.h; yy++) for (let xx = 0; xx < s.w; xx++) {
      const c = s.get(xx, yy);
      if (c) atlas.put(fx + xx, fy + yy, c, 'x');
    }
  }
  return { atlas, frames, png: encodePNG(atlas.w, atlas.h, atlas.rgba()) };
}
