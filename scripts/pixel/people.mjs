// 寒驿的八个人：48×48 像素半身像，每人三种表情（心情好 / 平常 / 低落）。
// 全部手绘：脸型、五官是字符画，头发用「帘子」画法（每一列从头顶垂到给定的高度），衣服是多边形 + 字符画。
// 画法顺序：后发 → 脖子 → 衣服 → 耳朵 → 脸 → 五官 → 前发 → 饰品，最后补头发投在脸上的阴影。

import { Canvas, W, draw, line, mirror, poly, shapeRows } from './draw.mjs';

const T = (o, a, b, c, d) => ({ 1: o, 2: a, 3: b, 4: c, 5: d });

// ───── 皮肤 ─────
const SKIN = {
  fair: { o: '#7a4038', d: '#c98a74', S: '#eab298', s: '#fad8c2', l: '#fff1e6', p: '#f4a29a' },
  warm: { o: '#71402f', d: '#c58660', S: '#e3aa82', s: '#f5cba6', l: '#fde3c8', p: '#ef9a86' },
  tan: { o: '#5e3326', d: '#a96a48', S: '#c98b62', s: '#e0a77c', l: '#efc39c', p: '#d9806a' },
  deep: { o: '#4d281d', d: '#94553a', S: '#b4714d', s: '#cd8d62', l: '#e2aa80', p: '#c0473f' },
};

// ───── 脸型：每行的左边界（右边对称），脖子 [x0, x1, y0, y1] ─────
const HEADS = {
  child: { y0: 10, left: [20, 17, 15, 14, 13, 13, ...Array(12).fill(12), 13, 13, 14, 15, 17, 19], neck: [20, 27, 30, 38] },
  female: { y0: 9, left: [19, 17, 15, 14, 13, 13, 12, ...Array(10).fill(12), 13, 13, 14, 15, 16, 17, 18, 20, 22], neck: [20, 27, 31, 39] },
  male: { y0: 9, left: [19, 17, 15, 14, 13, 13, 12, ...Array(11).fill(12), 13, 13, 14, 15, 16, 18, 20], neck: [19, 28, 30, 39] },
  broad: { y0: 9, left: [18, 16, 14, 13, 12, 12, 11, ...Array(13).fill(11), 12, 12, 13, 14, 16, 18], neck: [18, 29, 31, 39] },
};
const EAR = ['.oo', 'oss', 'osS', 'osS', '.os', '..o'];

function neck(cv, kind, skin) {
  const [x0, x1, y0, y1] = HEADS[kind].neck;
  const rows = [];
  for (let y = y0; y <= y1; y++) rows.push('.'.repeat(x0) + (y < y0 + 5 ? 'd' : 'S').repeat(x1 - x0 + 1));
  draw(cv, rows, y0, skin, { mat: 'neck', outline: skin.o });
}

function face(cv, kind, skin, { ears = true } = {}) {
  const h = HEADS[kind];
  if (ears) {
    const l = h.left[13];
    draw(cv, EAR, h.y0 + 12, skin, { mat: 'ear', x0: l - 2 });
    draw(cv, EAR.map((r) => [...r].reverse().join('')), h.y0 + 12, skin, { mat: 'ear', x0: W - l - 1 });
  }
  draw(cv, shapeRows(h.left), h.y0, skin, { mat: 'face', outline: skin.o });
  // 光从左上来：右侧和下巴右半边是暗面
  for (let y = h.y0 + 6; y < cv.h; y++) {
    for (let x = 0; x < W; x++) {
      if (cv.m(x, y) !== 'face') continue;
      if (cv.m(x + 1, y) === 'face!' || (cv.m(x, y + 1) === 'face!' && x >= 24)) cv.put(x, y, skin.S, 'face');
    }
  }
}

/** 头发、帽子投在脸上的阴影 */
function hairShadow(cv, skin) {
  const isHair = (m) => /^(hair|hat)/.test(m ?? '');
  for (let y = 1; y < cv.h; y++) {
    for (let x = 0; x < W; x++) {
      if (cv.m(x, y) !== 'face') continue;
      if (isHair(cv.m(x, y - 1)) || isHair(cv.m(x + 1, y))) cv.put(x, y, skin.S, 'face');
    }
  }
}

// ───── 头发：帘子画法 ─────
// dome：头顶的弧（起始行 + 每行左边界，左右对称）；bottom：[[x, y], …] 控制点，中间线性插值，表示这一列垂到哪一行。
function interp(pts) {
  const out = new Array(W).fill(null);
  for (let i = 0; i < pts.length - 1; i++) {
    const [xa, ya] = pts[i];
    const [xb, yb] = pts[i + 1];
    for (let x = xa; x <= xb; x++) out[x] = Math.round(ya + ((yb - ya) * (x - xa)) / Math.max(1, xb - xa));
  }
  if (pts.length === 1) out[pts[0][0]] = pts[0][1];
  return out;
}

function hair(cv, ramp, { y0, dome, bottom = [], shine = [], strands = [], dark = 99, tipShade = true, mat = 'hair', fill = '3' }) {
  const top = new Array(W).fill(null);
  dome.forEach((l, j) => {
    for (let x = l; x <= W - 1 - l; x++) if (top[x] == null) top[x] = y0 + j;
  });
  const domeEnd = y0 + dome.length - 1;
  const bot = interp(bottom);
  const grid = Array.from({ length: cv.h }, () => new Array(W).fill('.'));
  for (let x = 0; x < W; x++) {
    if (top[x] == null) continue;
    const b = bot[x] ?? domeEnd;
    for (let y = top[x]; y <= b && y < cv.h; y++) grid[y][x] = x >= dark ? '2' : fill;
    if (tipShade && bot[x] != null && b - 1 > top[x]) grid[b - 1][x] = '2';
  }
  for (const [off, x0, x1, ch] of shine) {
    for (let x = x0; x <= x1; x++) if (top[x] != null && grid[top[x] + off]?.[x] !== '.') grid[top[x] + off][x] = ch;
  }
  const rows = grid.map((r) => r.join(''));
  draw(cv, rows, 0, ramp, { mat, outline: ramp[1] });
  for (const [xa, ya, xb, yb, ch = '2'] of strands) line(cv, xa, ya, xb, yb, ramp[ch], mat, { only: [mat] });
}

// ───── 衣服 ─────
const BODY = {
  child: [34, [17, 14, 11, 9, 8, 7, 6, 5, 4, 4, 4, 4, 4, 4]],
  female: [35, [16, 13, 10, 8, 6, 5, 4, 3, 3, 3, 3, 3, 3]],
  male: [35, [15, 11, 8, 6, 4, 3, 2, 2, 1, 1, 1, 1, 1]],
  broad: [35, [14, 9, 6, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0]],
};
function body(cv, kind, ramp, { mat = 'cloth', dark = 31 } = {}) {
  const [y0, left] = BODY[kind];
  draw(cv, shapeRows(left, '3'), y0, ramp, { mat, outline: ramp[1] });
  for (let y = y0; y < cv.h; y++) {
    for (let x = 0; x < W; x++) {
      if (cv.m(x, y) !== mat) continue;
      if (x >= dark) cv.put(x, y, ramp[2], mat);
      else if (cv.m(x, y - 1) === mat + '!' && x < 17) cv.put(x, y, ramp[4], mat);
    }
  }
}

// ───── 五官 ─────
// 眼睛只写左半边（x 14..23，从 y17 开始），右眼镜像。
// K 眼线 / I 瞳孔深 / i 瞳孔浅 / g 高光 / w 眼白 / S 下眼睑 / d 皱纹 / b 眉毛
const EYES = {
  child: {
    good: ['..bbbb', '', '', '.KKKKK', 'KKggIK', '.IggII', '.IIIII', '.IIiiI', '.iiiii', '..SSS'],
    mid: ['', '..bbbb', '', '.KKKKK', 'KKggIK', '.IggII', '.IIIII', '.IIiiI', '.iiiii', '..SSS'],
    low: ['', '....bb', '..bb', '', '.KKKKK', 'KKKKKK', '.IggII', '.IIiiI', '.iiiii', '..SSS'],
  },
  female: {
    good: ['..bbbb', '', '', '', '.KKKKK', 'KKggIK', '.IggII', '.IIiiI', '.iiiii', '..SSS'],
    mid: ['', '..bbbb', '', '', '.KKKKK', 'KKggIK', '.IggII', '.IIiiI', '.iiiii', '..SSS'],
    low: ['', '....bb', '..bb', '', '', 'KKKKKK', '.KKKKK', '.IggII', '.iiiii', '..SSS'],
  },
  bold: {
    good: ['.bbbbb', '', '', '', '.KKKKK', 'KKggIK', '.IggII', '.IIiiI', '.iiiii', '..SSS'],
    mid: ['', '.bbbbb', '', '', '.KKKKK', 'KKggIK', '.IggII', '.IIiiI', '.iiiii', '..SSS'],
    low: ['', '...bbb', '.bb', '', '', 'KKKKKK', '.KKKKK', '.IggII', '.iiiii', '..SSS'],
  },
  sharp: {
    good: ['..bbbb', '.b', '', 'K', '.KKKKKK', '..IgIIw', '..iiiw', '...SS'],
    mid: ['', '..bbbb', '.b', 'K', '.KKKKKK', '..IgIIw', '..iiiw', '...SS'],
    low: ['', '....bb', '.bbb', '', 'K', '.KKKKKK', '..iiiw', '...SS'],
  },
  boy: {
    good: ['.bbbbb', '', '', '', '', '..KKK', '.K...K', '', '', ''],
    mid: ['', '.bbbbb', '', '', '.KKKKK', '.KggIK', '.IggII', '.iiiii', '..SSS'],
    low: ['', '....bb', '.bbb', '', '', '.KKKKK', '.KKKKK', '.IggII', '.iiiii', '..SSS'],
  },
  old: {
    good: ['', '.bbbbb', '..bbbb', '', '.KKKKK', 'dKIgIK', '..ddd'],
    mid: ['', '.bbb', '...bbbb', '', '.KKKKK', 'dKIgIK', '..ddd'],
    low: ['', '....bbb', '.bbb', '', '', 'dKKKKK', '..IgI', '..ddd'],
  },
  beady: {
    good: ['', '.bbbbb', '..bbb', '', '', '..KKK', '.K...K'],
    mid: ['', '.bbbbb', '..bbb', '', '..KKK', '..IIg', '...I'],
    low: ['', '...bbb', '.bbb', '', '', '.KKKK', '..IgI'],
  },
};

// 眨眼帧：portrait(id, mood, { blink: true }) 时，睁着的眼睛换成一条闭眼线（眉毛不动）
let BLINK = false;

function eyes(cv, style, mood, pal, y0 = 17) {
  let rows = EYES[style][mood];
  const lid = rows.findIndex((r) => r.includes('K'));
  const open = rows.some((r) => /[Iig]/.test(r));
  if (BLINK && open && lid >= 0) {
    const body = rows.slice(lid);
    const at = body.length >= 5 ? 2 : 1;
    const cols = [...body[0]].map((c) => c === 'K');
    rows = [
      ...rows.slice(0, lid),
      ...body.map((r, k) => [...r.padEnd(cols.length, '.')].map((c, i) => (k === at && (cols[i] || c === 'K') ? 'K' : '.bdS'.includes(c) ? c : 's')).join('')),
    ];
    pal = { ...pal, s: pal.skin };
  }
  const half = rows.map((r) => ('.'.repeat(14) + r).padEnd(24, '.'));
  draw(cv, mirror(half), y0, pal, { mat: 'eye', only: ['face'] });
}

const MOUTH = {
  smile: ['......m..m', '.......mm'],
  soft: ['.......mm'],
  grin: ['......mmmm', '.......nn'],
  laugh: ['.....mmmmmm', '......mnnm', '.......mm'],
  flat: ['......mmmm'],
  frown: ['.......mm', '......m..m'],
  smirk: ['.........m', '......mmm'],
  pout: ['.......mm', '.......mm'],
};
function mouth(cv, kind, pal, y) {
  draw(cv, MOUTH[kind].map((r) => '.'.repeat(16) + r), y, pal, { mat: 'mouth', only: ['face'] });
}
function blush(cv, pal, y, x = 15, w = 2, h = 1) {
  const row = mirror([('.'.repeat(x) + 'p'.repeat(w)).padEnd(24, '.')])[0];
  draw(cv, Array(h).fill(row), y, pal, { mat: 'blush', only: ['face'] });
}
const pick = (mood, good, mid, low) => (mood === 'good' ? good : mood === 'mid' ? mid : low);

// ───── 人物 ─────
export const PEOPLE = {};

// 小满：九岁，丸子头，碎花棉袄，抱着一只脏兮兮的布兔子
PEOPLE.man = {
  bg: '#e8b4b4',
  draw(cv, mood) {
    const skin = SKIN.fair;
    const hr = T('#2e1a14', '#4e2c1e', '#704028', '#93603b', '#b98656');
    const cloth = T('#7a2f3a', '#c45a64', '#e3838a', '#f3aeb0', '#fde3e0');
    const bun = ['...222...', '.2333332.', '233444332', '234443332', '233433322', '233333322', '.2233322.', '...222...'];
    draw(cv, bun, 2, hr, { mat: 'hairb', outline: hr[1], x0: 7 });
    draw(cv, bun.map((r) => [...r].reverse().join('')), 2, hr, { mat: 'hairb', outline: hr[1], x0: 32 });
    hair(cv, hr, { y0: 7, dome: [17, 14, 12, 11, 10, 9], bottom: [[9, 30], [38, 30]], fill: '2', tipShade: false, mat: 'hairb' });
    neck(cv, 'child', skin);
    body(cv, 'child', cloth);
    for (let y = 36; y < 48; y++) for (let x = 5; x < 43; x++) {
      if (cv.m(x, y) === 'cloth' && (x + (y % 6 < 3 ? 0 : 3)) % 6 === 0 && y % 3 === 0) cv.put(x, y, cloth[5], 'cloth');
    }
    draw(cv, ['..................111111111111', '.................12222222222221', '.................122........221'], 33, cloth, { mat: 'collar' });
    for (const y of [38, 42, 46]) draw(cv, ['.......................55'], y, cloth, { mat: 'btn' });
    face(cv, 'child', skin, { ears: false });
    const fp = { skin: skin.s, K: '#2a1714', w: '#fffaf4', I: '#4a2418', i: '#a35a34', g: '#ffffff', S: skin.S, b: '#5a3424', m: '#9a3c3a', n: '#e57d7d', p: skin.p, t: '#9fd3f0' };
    eyes(cv, 'child', mood, fp);
    draw(cv, ['........................d'], 27, skin, { mat: 'nose', only: ['face'] });
    mouth(cv, pick(mood, 'grin', 'soft', 'frown'), fp, 29);
    blush(cv, fp, 27, 14, 3);
    if (mood === 'low') draw(cv, ['..............t', '..............t'], 26, fp, { mat: 'tear' });
    hair(cv, hr, {
      y0: 6,
      dome: [18, 15, 13, 12, 11, 10, 9],
      bottom: [[9, 27], [10, 28], [12, 28], [13, 26], [14, 17], [15, 17], [16, 18], [17, 17], [19, 17], [20, 16], [21, 17], [23, 17], [24, 18], [25, 17], [27, 17], [28, 16], [29, 17], [31, 17], [32, 18], [33, 17], [34, 26], [35, 28], [37, 28], [38, 27]],
      shine: [[3, 14, 21, '4'], [4, 13, 20, '4'], [3, 16, 18, '5'], [3, 26, 31, '4'], [4, 27, 32, '4']],
      strands: [[18, 12, 17, 16], [23, 11, 23, 16], [29, 12, 30, 16]],
      dark: 35,
    });
    draw(cv, ['..........................11', '.........................1331', '.........................13'], 3, hr, { mat: 'hair' });
    draw(cv, ['.............rr..................rr', '............rRr..................rRr'], 9, { r: '#d8383c', R: '#8e1f2a' }, { mat: 'acc' });
    hairShadow(cv, skin);
    // 布兔子
    draw(cv, [
      '..1111..1111',
      '..1331..1331',
      '..1p31..1p31',
      '..1p31..1p31',
      '..1331..1331',
      '.1133311333311',
      '1334443333333321',
      '1344433333333321',
      '134k333333k33321',
      '1333333pp3333321',
      '13333x3333x33321',
      '1333333xx3333221',
      '1233333333332221',
      '1223333333322221',
    ], 34, { 1: '#5c4a3c', 2: '#a8957e', 3: '#d6c8b2', 4: '#efe5d4', k: '#2a201c', p: '#e3a0a0', x: '#8a6f5a' }, { mat: 'toy', x0: 3 });
  },
};

// 林晚：急诊科护士，长发低马尾搭在肩上，大衣里是护士服
PEOPLE.lin = {
  bg: '#e3c2bc',
  draw(cv, mood) {
    const skin = SKIN.fair;
    const hr = T('#1f1418', '#38242a', '#553539', '#7a4f4f', '#a77a72');
    const coat = T('#5e2f33', '#9c5558', '#c07a76', '#dca29a', '#f0c8bc');
    const scrub = { u: '#7fbcc8', U: '#4f8e9c', v: '#b4dde3' };
    hair(cv, hr, { y0: 5, dome: [18, 15, 13, 12, 11, 10], bottom: [[10, 28], [37, 28]], fill: '2', tipShade: false, mat: 'hairb' });
    neck(cv, 'female', skin);
    body(cv, 'female', coat);
    poly(cv, [[17, 35], [31, 35], [25, 48], [23, 48]], scrub.u, 'scrub', { only: ['cloth', 'cloth!'] });
    poly(cv, [[19, 34], [29, 34], [24, 41]], skin.S, 'neck');
    line(cv, 19, 35, 23, 40, scrub.U, 'scrub');
    line(cv, 28, 35, 24, 40, scrub.U, 'scrub');
    line(cv, 17, 36, 22, 47, coat[4], 'cloth');
    line(cv, 30, 36, 25, 47, coat[2], 'cloth');
    draw(cv, ['..........U', '.........UvU'], 43, scrub, { mat: 'pen', x0: 9 });
    // 搭在左肩上的马尾
    draw(cv, [
      '....3333',
      '...33333',
      '...rrrrr',
      '..3rRRr3',
      '..333332',
      '..33332',
      '.333332',
      '.33332',
      '.33432',
      '333432',
      '334332',
      '33432',
      '33432',
      '34332',
      '3332',
      '3432',
      '3332',
      '332',
      '332',
      '.32',
      '..2',
    ], 26, { ...hr, r: '#8cc4cf', R: '#5f9cab' }, { mat: 'hair', outline: hr[1], x0: 6, keep: 'rR' });
    face(cv, 'female', skin, { ears: false });
    const fp = { skin: skin.s, K: '#24161a', w: '#fffaf6', I: '#3e2428', i: '#8a5a58', g: '#ffffff', S: skin.S, b: '#4a3034', m: '#b05a5a', n: '#e88a88', p: skin.p };
    eyes(cv, 'female', mood, fp);
    draw(cv, ['........................d'], 27, skin, { mat: 'nose', only: ['face'] });
    mouth(cv, pick(mood, 'smile', 'soft', 'frown'), fp, 30);
    if (mood === 'good') blush(cv, fp, 27, 14, 3);
    hair(cv, hr, {
      y0: 5,
      dome: [18, 15, 13, 12, 11, 10],
      bottom: [[10, 28], [11, 30], [13, 30], [14, 27], [15, 20], [16, 19], [17, 19], [28, 13], [29, 12], [30, 13], [32, 15], [33, 18], [34, 24], [35, 25], [36, 25], [37, 24]],
      shine: [[3, 13, 26, '4'], [4, 14, 22, '4'], [3, 15, 18, '5'], [3, 31, 35, '4']],
      strands: [[26, 7, 19, 17], [22, 8, 16, 16], [31, 8, 34, 17], [12, 16, 12, 27]],
      dark: 34,
    });
    draw(cv, ['.ccc', 'cCCc'], 12, { c: '#9ad0da', C: '#5f9cab' }, { mat: 'acc', x0: 30 });
    hairShadow(cv, skin);
  },
};

// 苏蔓：投资公司合伙人，利落的不对称短发，金丝眼镜，名牌冲锋衣
PEOPLE.su = {
  bg: '#cfc4dc',
  draw(cv, mood) {
    const skin = SKIN.fair;
    const hr = T('#0f0f18', '#1c1d2b', '#2b2d42', '#454a68', '#6f769a');
    const coat = T('#2a1b38', '#4f3768', '#6f5390', '#9378b4', '#bca6d8');
    hair(cv, hr, { y0: 5, dome: [18, 15, 13, 12, 11, 10], bottom: [[10, 32], [14, 33], [33, 33], [37, 24]], fill: '2', tipShade: false, mat: 'hairb' });
    neck(cv, 'female', skin);
    body(cv, 'female', coat);
    // 立领拉到下巴，中间是拉链
    draw(cv, Array(5).fill('................3333333333333333'), 33, coat, { mat: 'collar', outline: coat[1] });
    for (let y = 34; y < 48; y++) draw(cv, ['.......................' + (y === 39 ? 'xx' : 'zz')], y, { z: '#cfd3dc', x: '#8a90a0' }, { mat: 'zip' });
    draw(cv, ['55', '4'], 41, coat, { mat: 'logo', x0: 11 });
    face(cv, 'female', skin, { ears: true });
    const fp = { skin: skin.s, K: '#1a1420', w: '#fdfaff', I: '#2e2238', i: '#6a5478', g: '#ffffff', S: skin.S, b: '#1f1e2c', m: '#b8323e', n: '#e06470', p: skin.p, d: skin.d };
    eyes(cv, 'sharp', mood, fp);
    draw(cv, ['........................d'], 27, skin, { mat: 'nose', only: ['face'] });
    mouth(cv, pick(mood, 'smirk', 'flat', 'frown'), fp, 30);
    // 金丝眼镜
    const gl = { f: '#c9a24c', F: '#8a6a28' };
    draw(cv, mirror(['..............fffffff...', '.............f.......fff', '..............f.....f...', '..............f.....f...', '...............FFFFF....'].map((r) => r.padEnd(24, '.'))), 20, gl, { mat: 'glasses' });
    hair(cv, hr, {
      y0: 5,
      dome: [18, 15, 13, 12, 11, 10],
      bottom: [[10, 31], [11, 33], [14, 33], [15, 16], [16, 14], [17, 13], [18, 12], [19, 13], [31, 18], [32, 19], [33, 20], [34, 19], [35, 18], [37, 16]],
      shine: [[3, 12, 17, '4'], [3, 20, 30, '4'], [4, 22, 29, '4'], [3, 23, 26, '5']],
      strands: [[20, 8, 30, 17], [24, 8, 33, 18], [13, 16, 13, 31]],
      dark: 35,
    });
    draw(cv, ['w', 'W'], 27, { w: '#ffffff', W: '#d8d4e0' }, { mat: 'acc', x0: 36 });
    draw(cv, ['k'], 25, { k: '#6a3a3a' }, { mat: 'mole', x0: 32, only: ['face'] });
    hairShadow(cv, skin);
  },
};

// 格桑卓玛：登山向导，两条长辫子缀着绿松石和珊瑚，头顶架着雪镜，红色冲锋衣
PEOPLE.gesang = {
  bg: '#e6c7a8',
  draw(cv, mood) {
    const skin = SKIN.deep;
    const hr = T('#120c0c', '#22171a', '#36262a', '#523a3a', '#7a5a56');
    const coat = T('#4a1712', '#8c2a20', '#b8402f', '#d8634a', '#f08b6c');
    hair(cv, hr, { y0: 5, dome: [18, 15, 13, 12, 11, 10], bottom: [[10, 27], [37, 27]], fill: '2', tipShade: false, mat: 'hairb' });
    neck(cv, 'female', skin);
    body(cv, 'female', coat);
    draw(cv, Array(4).fill('.................11111111111111'), 33, coat, { mat: 'collar', outline: coat[1] });
    draw(cv, Array(3).fill('..................333333333333'), 34, coat, { mat: 'collar' });
    for (let y = 37; y < 48; y++) draw(cv, ['.......................22'], y, coat, { mat: 'zip' });
    face(cv, 'female', skin, { ears: false });
    const fp = { skin: skin.s, K: '#1c100c', w: '#fff6ee', I: '#3a2214', i: '#94602e', g: '#ffffff', S: skin.S, b: '#1c1210', m: '#8e3a30', n: '#d86a5a', p: skin.p };
    eyes(cv, 'bold', mood, fp);
    draw(cv, ['........................d', '.......................dd'], 26, skin, { mat: 'nose', only: ['face'] });
    mouth(cv, pick(mood, 'smile', 'flat', 'frown'), fp, 30);
    blush(cv, fp, 27, 14, 3, 2);
    hair(cv, hr, {
      y0: 5,
      dome: [18, 15, 13, 12, 11, 10],
      bottom: [[10, 26], [11, 27], [13, 26], [14, 21], [15, 16], [16, 14], [18, 12], [22, 11], [23, 10], [24, 10], [25, 11], [29, 12], [31, 14], [32, 16], [33, 21], [34, 26], [36, 27], [37, 26]],
      shine: [[3, 13, 21, '4'], [4, 14, 20, '4'], [3, 15, 17, '5'], [3, 27, 33, '4']],
      strands: [[22, 7, 15, 15], [25, 7, 32, 15]],
      dark: 34,
      tipShade: false,
    });
    // 辫子
    const braid = ['.3332.', '333322', '233322', '.2222.'];
    const beads = { 1: '#3fb5a8', 3: '#d8553f', 5: '#3fb5a8' };
    for (const side of [0, 1]) {
      for (let k = 0; k < 6; k++) {
        const y = 24 + k * 4;
        const rows = braid.map((r) => (side ? [...r].reverse().join('') : r));
        draw(cv, rows, y, hr, { mat: 'hair', outline: hr[1], x0: side ? 34 : 8 });
        if (beads[k]) draw(cv, ['bb'], y + 3, { b: beads[k] }, { mat: 'acc', x0: side ? 36 : 10 });
      }
    }
    // 雪镜架在头顶
    draw(cv, mirror(['...............555555555', '..............5kkkk5....', '..............5kKKk5....', '...............5555.....'].map((r) => r.padEnd(24, '.'))), 5, { 5: '#a8703a', k: '#1a2430', K: '#5a7a96' }, { mat: 'acc' });
    hairShadow(cv, skin);
  },
};

// 阿杰：美院大一，乱糟糟的头发，耳朵上夹着铅笔，鼻梁贴着创可贴，蓝色羽绒服斜挎画板带
PEOPLE.jie = {
  bg: '#bcd0e0',
  draw(cv, mood) {
    const skin = SKIN.warm;
    const hr = T('#1a1210', '#2e2018', '#463024', '#634634', '#8a6a52');
    const coat = T('#1d3550', '#33587e', '#4f7ea8', '#78a6cc', '#a8cbe6');
    hair(cv, hr, { y0: 4, dome: [19, 16, 14, 12, 11, 10, 10], bottom: [[10, 20], [37, 20]], fill: '2', tipShade: false, mat: 'hairb' });
    neck(cv, 'male', skin);
    body(cv, 'male', coat);
    for (const y of [40, 44]) for (let x = 0; x < W; x++) if (cv.m(x, y) === 'cloth') cv.put(x, y, coat[2], 'cloth');
    draw(cv, Array(4).fill('................1111111111111111'), 33, coat, { mat: 'collar', outline: coat[1] });
    draw(cv, Array(3).fill('.................33333333333333'), 33, coat, { mat: 'collar' });
    for (let y = 36; y < 48; y++) draw(cv, ['.......................55'], y, coat, { mat: 'zip' });
    for (let k = 0; k < 2; k++) line(cv, 10, 37 + k, 32, 47 + k, k ? '#5a3a22' : '#8a5a34', 'strap');
    face(cv, 'male', skin, { ears: true });
    const fp = { skin: skin.s, K: '#20140e', w: '#fffaf2', I: '#33241a', i: '#7a5a40', g: '#ffffff', S: skin.S, b: '#2a1a12', m: '#9a4636', n: '#e07a6a', p: skin.p };
    eyes(cv, 'boy', mood, fp);
    mouth(cv, pick(mood, 'laugh', 'smirk', 'frown'), fp, 29);
    // 创可贴、脸上的颜料
    draw(cv, ['aaa', 'aAa'], 26, { a: '#f4dcb0', A: '#c89a68' }, { mat: 'acc', x0: 29 });
    draw(cv, ['...............oo', '..............o'], 27, { o: '#f08a3a' }, { mat: 'paint', only: ['face'] });
    hair(cv, hr, {
      y0: 4,
      dome: [19, 16, 14, 12, 11, 10, 10],
      bottom: [[10, 18], [11, 20], [12, 21], [13, 19], [14, 17], [15, 15], [16, 17], [17, 16], [18, 14], [19, 16], [20, 17], [21, 15], [22, 13], [23, 15], [24, 16], [25, 14], [26, 13], [27, 15], [28, 16], [29, 14], [30, 13], [31, 15], [32, 14], [33, 16], [34, 18], [35, 19], [36, 18], [37, 17]],
      shine: [[3, 13, 20, '4'], [4, 14, 19, '4'], [3, 15, 17, '5'], [3, 26, 32, '4']],
      strands: [[18, 8, 18, 13], [25, 7, 25, 12], [31, 8, 30, 12]],
      dark: 34,
    });
    // 翘起来的几撮
    draw(cv, ['................1.....11......1', '...............131...1331....131', '..............1331..13331...1331'], 2, hr, { mat: 'hair' });
    // 耳朵上的铅笔
    draw(cv, ['....k', '...yk', '..yy', '.yY', 'yY', 'p'], 17, { y: '#f0c040', Y: '#c8962a', k: '#3a3030', p: '#f0a0a0' }, { mat: 'acc', x0: 35 });
    hairShadow(cv, skin);
  },
};

// 老秦：退休护林员，雷锋帽放下护耳，灰白的山羊胡，军大衣毛领，脖子上挂着驿站的钥匙
PEOPLE.qin = {
  bg: '#c2ccb4',
  draw(cv, mood) {
    const skin = SKIN.tan;
    const hat = T('#26301e', '#3f4d30', '#5a6b44', '#7a8c5e', '#9aac7c');
    const fur = T('#3a2618', '#6a4a30', '#8e6a48', '#b08c66', '#d0b08a');
    const coat = T('#232b1c', '#3c4a2e', '#55663f', '#73855a', '#93a578');
    const grey = { g: '#b8b2aa', G: '#8a847c', h: '#dcd6ce' };
    neck(cv, 'male', skin);
    body(cv, 'male', coat);
    line(cv, 22, 40, 22, 47, coat[1], 'cloth');
    line(cv, 25, 40, 25, 47, coat[1], 'cloth');
    // 毛领
    poly(cv, [[20, 36], [28, 36], [24, 42]], coat[1], 'cloth');
    const furRows = mirror([
      '.................2333333',
      '...............234343434',
      '.............23434343433',
      '............234343434333',
      '............23434343',
      '.............234343',
      '..............23432',
      '...............222',
    ].map((r) => r.padEnd(24, '.')));
    draw(cv, furRows, 32, fur, { mat: 'fur', outline: fur[1] });
    // 钥匙绳和钥匙
    line(cv, 21, 36, 23, 42, '#a83a32', 'cord');
    line(cv, 26, 36, 24, 42, '#a83a32', 'cord');
    draw(cv, ['.qq', 'qQq', '.q', '.q', '.qq', '.q'], 42, { q: '#e0b84a', Q: '#8a6a20' }, { mat: 'key', x0: 22 });
    face(cv, 'male', skin, { ears: false });
    const fp = { skin: skin.s, K: '#22140e', w: '#f8f0e6', I: '#2e2018', i: '#6a4a30', g: '#f0e8d8', S: skin.S, b: grey.G, d: skin.d, m: '#7a3a2a', n: '#c06050', p: skin.p };
    eyes(cv, 'old', mood, fp);
    draw(cv, ['.......................dd', '......................d..d'], 26, skin, { mat: 'nose', only: ['face'] });
    draw(cv, ['....................d......d', '...................d........d'], 28, skin, { mat: 'wrinkle', only: ['face'] });
    // 胡茬和山羊胡
    for (let y = 27; y < 35; y++) for (let x = 13; x < 35; x++) {
      if (cv.m(x, y) === 'face' && (x * 7 + y * 3) % 4 === 0 && (y > 29 || x < 17 || x > 30)) cv.put(x, y, grey.G, 'stub');
    }
    draw(cv, ['.....................gggggg', '....................gg....gg'], 28, grey, { mat: 'beard', only: ['face', 'stub', 'wrinkle'] });
    mouth(cv, pick(mood, 'smile', 'flat', 'frown'), fp, 30);
    draw(cv, ['.....................gGGGGg', '.....................gGggGg', '......................gGGg', '.......................gg'], 31, grey, { mat: 'beard' });
    // 雷锋帽：帽顶、毛边、放下来的护耳
    hair(cv, hat, { y0: 2, dome: [18, 15, 13, 12, 11, 11, 11], shine: [[2, 15, 22, '4'], [3, 14, 18, '4']], dark: 33, mat: 'hat' });
    line(cv, 24, 3, 24, 8, hat[2], 'hat');
    draw(cv, ['rr', 'RR'], 6, { r: '#e0b850', R: '#9a7428' }, { mat: 'hat', x0: 23 });
    const brim = [];
    for (let y = 9; y <= 14; y++) {
      let r = '';
      for (let x = 0; x < W; x++) r += x >= 10 && x <= 37 && (y < 14 || x < 15 || x > 32) ? '2345'[(x * 3 + y * 5 + (x >> 1)) % 4] : '.';
      brim.push(r);
    }
    draw(cv, brim, 9, fur, { mat: 'hat', outline: fur[1] });
    const flap = [...Array(11)].map((_, k) => (k % 2 ? 'OoofF' : 'OooFf'));
    flap.push('.OOo.');
    const fp2 = { O: hat[2], o: hat[3], f: fur[3], F: fur[4] };
    draw(cv, flap, 14, fp2, { mat: 'hat', outline: hat[1], x0: 9 });
    draw(cv, flap.map((r) => [...r].reverse().join('')), 14, fp2, { mat: 'hat', outline: hat[1], x0: 34 });
    draw(cv, ['g', 'G', 'g', 'G'], 15, grey, { mat: 'hair', x0: 14, only: ['face', 'face!'] });
    hairShadow(cv, skin);
  },
};

// 胖叔：开了二十年客车的老司机，圆脸寸头，浓胡子，脖子上搭着白毛巾，皮夹克
PEOPLE.ma = {
  bg: '#e0cfa8',
  draw(cv, mood) {
    const skin = SKIN.tan;
    const hr = T('#1c1816', '#332c28', '#4a403a', '#625750', '#7d726a');
    const coat = T('#3e2a14', '#6e4a22', '#946630', '#b88a48', '#d6ad6c');
    const towel = { 1: '#8a8a8a', 2: '#c8ccd0', 3: '#eef0f2', 4: '#ffffff', b: '#5a86c0' };
    neck(cv, 'broad', skin);
    body(cv, 'broad', coat);
    line(cv, 23, 39, 23, 47, coat[1], 'cloth');
    draw(cv, mirror([
      '.............233332',
      '............2343332',
      '............23433322',
      '.............2343332',
      '..............234332',
      '..............234332',
      '..............234332',
      '..............bbbbbb',
      '..............234332',
      '..............bbbbbb',
      '..............234332',
      '..............1.1.1',
    ].map((r) => r.padEnd(24, '.'))), 34, towel, { mat: 'towel', outline: towel[1], keep: 'b1' });
    face(cv, 'broad', skin, { ears: true });
    const fp = { skin: skin.s, K: '#22140e', w: '#f8f0e6', I: '#2a1a12', i: '#5a3a28', g: '#f4ece0', S: skin.S, b: '#1e1a18', d: skin.d, m: '#6a2a22', n: '#d06a5a', p: skin.p, t: '#fffaf0' };
    eyes(cv, 'beady', mood, fp);
    blush(cv, fp, 25, 13, 3, 2);
    draw(cv, ['.......................dd', '......................dddd'], 25, skin, { mat: 'nose', only: ['face'] });
    // 胡子
    const mus = { k: '#1e1a18', K: '#3a3230' };
    draw(cv, ['....................kKKKKKKk', '...................kkKkkkkKkk', '...................k........k'], 27, mus, { mat: 'beard' });
    if (mood === 'good') draw(cv, ['.....................mttttm', '......................mnnm'], 30, { ...fp, t: '#fffaf0' }, { mat: 'mouth' });
    else mouth(cv, pick(mood, 'grin', 'soft', 'frown'), fp, 30);
    draw(cv, ['..................dd........dd', '....................dddddddd'], 32, skin, { mat: 'chin', only: ['face'] });
    // 寸头
    hair(cv, hr, { y0: 7, dome: [18, 15, 13, 12, 11, 11], bottom: [[11, 19], [12, 18], [13, 14], [14, 12], [16, 11], [31, 11], [33, 12], [34, 14], [35, 18], [36, 19]], dark: 33, tipShade: false });
    for (let y = 7; y < 20; y++) for (let x = 0; x < W; x++) if (cv.m(x, y) === 'hair' && (x + y) % 2 === 0) cv.put(x, y, hr[2], 'hair');
    draw(cv, ['.................444', '...............44'], 9, hr, { mat: 'hair', only: ['hair'] });
    hairShadow(cv, skin);
  },
};

// 吴铁：道班养路工，戴工作帽，寸头花白，胡茬，眉骨上一道疤，橘色反光背心
PEOPLE.wu = {
  bg: '#c4cad2',
  draw(cv, mood) {
    const skin = SKIN.tan;
    const cap = T('#1e2630', '#36424f', '#4f5d6c', '#6c7c8c', '#8e9eae');
    const jacket = T('#262a30', '#3e444c', '#575f68', '#737c86', '#939ca6');
    const vest = T('#6a2a08', '#b4500e', '#e0721c', '#f39a3e', '#ffc070');
    neck(cv, 'male', skin);
    body(cv, 'male', jacket);
    poly(cv, [[3, 40], [12, 37], [21, 48], [1, 48]], vest[3], 'vest');
    poly(cv, [[45, 40], [36, 37], [27, 48], [47, 48]], vest[2], 'vest');
    for (const y of [43, 44]) for (let x = 0; x < W; x++) if (cv.m(x, y) === 'vest') cv.put(x, y, y === 43 ? '#eef3f6' : '#b6c2ca', 'vest');
    line(cv, 12, 37, 21, 47, vest[1], 'vest');
    line(cv, 36, 37, 27, 47, vest[1], 'vest');
    draw(cv, Array(3).fill('.................3333333333333'), 34, jacket, { mat: 'collar', outline: jacket[1] });
    face(cv, 'male', skin, { ears: true });
    const fp = { skin: skin.s, K: '#1c120c', w: '#f6efe4', I: '#2a1c14', i: '#5a4030', g: '#ece2d2', S: skin.S, b: '#2a2624', d: skin.d, m: '#6e3426', n: '#c06050', p: skin.p };
    eyes(cv, 'old', mood, fp);
    draw(cv, ['.......................dd', '......................d..d'], 26, skin, { mat: 'nose', only: ['face'] });
    for (let y = 28; y < 34; y++) for (let x = 13; x < 35; x++) {
      if (cv.m(x, y) === 'face' && (x * 5 + y * 3) % 3 === 0 && (y > 29 || x < 17 || x > 30)) cv.put(x, y, '#7a5e4c', 'stub');
    }
    mouth(cv, pick(mood, 'soft', 'flat', 'frown'), fp, 29);
    // 疤
    line(cv, 17, 16, 19, 22, '#f2c8a8', 'scar', { only: ['face', 'eye'] });
    // 工作帽：帽顶 + 帽檐
    hair(cv, cap, { y0: 4, dome: [18, 15, 13, 12, 11, 11, 11, 11], shine: [[2, 15, 22, '4'], [3, 14, 19, '4']], dark: 33, mat: 'hat' });
    line(cv, 24, 5, 24, 10, cap[2], 'hat');
    draw(cv, ['..........' + '1'.repeat(28), '.........1' + '2'.repeat(28) + '1', '..........' + '1'.repeat(28)], 11, cap, { mat: 'hat' });
    draw(cv, ['g', 'G', 'g', 'G', 'g'], 14, { g: '#9a948c', G: '#5a5652' }, { mat: 'hair', x0: 13, only: ['face', 'face!'] });
    draw(cv, ['g', 'G', 'g', 'G', 'g'], 14, { g: '#9a948c', G: '#5a5652' }, { mat: 'hair', x0: 34, only: ['face', 'face!'] });
    hairShadow(cv, skin);
  },
};

// 还没遇见的人：剪影
PEOPLE.unknown = {
  bg: '#3a4450',
  moods: 1,
  draw(cv) {
    const sil = { s: '#2a323c', o: '#56626e' };
    draw(cv, shapeRows([16, 13, 10, 8, 6, 5, 4, 3, 3, 3, 3, 3, 3], 's'), 35, sil, { mat: 'cloth', outline: sil.o });
    draw(cv, shapeRows(HEADS.male.left), 9, { s: sil.s }, { mat: 'face', outline: sil.o });
    draw(cv, ['....oooo', '...oo..oo', '.......oo', '......oo', '.....oo', '.....oo', '', '.....oo'].map((r) => '.'.repeat(15) + r), 16, sil, { mat: 'q' });
  },
};

export const MOODS = ['good', 'mid', 'low'];

export function portrait(id, moodIndex, { blink = false } = {}) {
  const cv = new Canvas();
  BLINK = blink;
  try {
    PEOPLE[id].draw(cv, MOODS[moodIndex]);
  } finally {
    BLINK = false;
  }
  return cv;
}

/** 眨眼叠层：只保留和睁眼图不一样的像素，其余透明；眼睛本来就闭着时返回 null */
export function blinkLayer(id, moodIndex) {
  const a = portrait(id, moodIndex);
  const b = portrait(id, moodIndex, { blink: true });
  const out = new Canvas(a.w, a.h);
  let n = 0;
  for (let i = 0; i < a.col.length; i++) {
    if (a.col[i] !== b.col[i] && b.col[i]) {
      out.col[i] = b.col[i];
      n++;
    }
  }
  return n ? out : null;
}
