// 山门的画：远山、主峰、小路、瀑布、松树，和每座殿堂的样子。全是手写的 SVG，没有外部图片。
// 设计尺寸 1280×576（横屏），背景往四周多画出一截，屏幕比例不同时露出来的边也是山和天。

import type { HallId } from '../game/types';

export const VW = 1280;
export const VH = 576;

/** 各处在画面里的位置（脚下那一点） */
export const SPOT: Record<HallId | 'main' | 'cave' | 'gate' | 'idle', [number, number]> = {
  main: [640, 150],
  cave: [250, 200],
  teach: [870, 205],
  law: [450, 245],
  alchemy: [330, 328],
  forge: [975, 318],
  herb: [175, 398],
  diplomacy: [1118, 392],
  recruit: [820, 440],
  guard: [470, 438],
  gate: [640, 515],
  idle: [690, 295],
};

const SKY: [string, string, string][] = [
  ['#3a5a8c', '#9cc3e0', '#f6dbe0'], // 春
  ['#2a6aa0', '#8fd0f0', '#fff1c4'], // 夏
  ['#4a3f6e', '#d39272', '#f6cc86'], // 秋
  ['#33415f', '#8fa4c4', '#e4ebf5'], // 冬
];
const HILL: [string, string][] = [['#6fae7e', '#2f5c4c'], ['#4f9a68', '#24503f'], ['#b39a55', '#5a4a2c'], ['#e9eef5', '#93a3b9']];
const FAR: string[] = ['#7f9fbe', '#6f96bd', '#9a7f9a', '#a7b5ca'];

function pine(x: number, y: number, s: number, snow: boolean) {
  const c = snow ? '#dfe7f1' : '#244a3c';
  return `<g transform="translate(${x},${y}) scale(${s})"><rect x="-2" y="-6" width="4" height="10" fill="#4a3426"/><path d="M0 -44 L14 -18 L6 -18 L18 -4 L-18 -4 L-6 -18 L-14 -18Z" fill="${c}"/><path d="M0 -44 L14 -18 L6 -18 L18 -4 L0 -4Z" fill="#000" opacity=".12"/></g>`;
}

/** 背景：天、远山、主峰、小路、瀑布、树。season 0–3 */
export function backdrop(season: number, sectName: string): string {
  const [top, mid, low] = SKY[season];
  const [h1, h2] = HILL[season];
  const snow = season === 3;
  const trees = [[90, 300, 1.1], [120, 318, 0.9], [1190, 290, 1], [1225, 308, 0.8], [560, 205, 0.7], [730, 205, 0.7], [370, 420, 0.9], [1060, 410, 0.9], [40, 520, 1.2], [1245, 520, 1.2], [760, 395, 0.7], [520, 400, 0.7], [960, 520, 0.8], [300, 525, 0.8]]
    .map(([x, y, s]) => pine(x, y, s, snow)).join('');
  return `<svg class="bg-svg" viewBox="-640 -320 2560 1216" preserveAspectRatio="none" aria-hidden="true">
  <defs>
    <linearGradient id="g-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset=".55" stop-color="${mid}"/><stop offset="1" stop-color="${low}"/></linearGradient>
    <linearGradient id="g-hill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${h1}"/><stop offset="1" stop-color="${h2}"/></linearGradient>
    <linearGradient id="g-mist" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <linearGradient id="g-fall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8f6ff"/><stop offset="1" stop-color="#9fd2ee"/></linearGradient>
  </defs>
  <rect x="-640" y="-320" width="2560" height="1216" fill="url(#g-sky)"/>
  <circle cx="1090" cy="70" r="36" fill="#fff8e2" opacity=".9"/><circle cx="1090" cy="70" r="70" fill="#fff8e2" opacity=".12"/>
  <path d="M-640 330 L-420 210 L-220 270 L0 175 L140 235 L300 120 L460 215 L600 95 L760 195 L900 115 L1060 205 L1200 135 L1400 225 L1600 165 L1920 270 V896 H-640Z" fill="${FAR[season]}" opacity=".55"/>
  <rect x="-640" y="200" width="2560" height="90" fill="url(#g-mist)"/>
  <path d="M-640 400 L-320 310 L-110 350 L90 262 L250 312 L380 240 L520 300 L640 230 L780 300 L930 245 L1080 315 L1240 260 L1500 330 L1920 380 V896 H-640Z" fill="${FAR[season]}" opacity=".85"/>
  <path d="M-640 480 Q40 440 220 340 Q400 210 545 160 Q640 112 735 160 Q880 210 1060 340 Q1240 440 1920 480 V896 H-640Z" fill="url(#g-hill)"/>
  <path d="M-640 540 Q280 455 640 492 Q1000 455 1920 540 V896 H-640Z" fill="${h2}" opacity=".55"/>
  <g class="fall"><path d="M176 196 Q170 260 182 330" stroke="url(#g-fall)" stroke-width="14" fill="none" opacity=".9"/><path class="fall-flow" d="M176 196 Q170 260 182 330" stroke="#fff" stroke-width="5" fill="none" stroke-dasharray="10 16" opacity=".7"/><ellipse cx="184" cy="334" rx="30" ry="7" fill="#bfe6fb" opacity=".8"/></g>
  <path d="M640 600 C600 540 700 500 660 450 S560 380 610 320 S700 230 640 160" stroke="#e9dfc8" stroke-width="16" fill="none" opacity=".75" stroke-linecap="round"/>
  <path d="M640 600 C600 540 700 500 660 450 S560 380 610 320 S700 230 640 160" stroke="#b9ab8c" stroke-width="16" fill="none" opacity=".5" stroke-dasharray="3 9"/>
  <path d="M640 160 Q520 190 440 262 M640 160 Q760 190 868 218 M610 320 Q470 330 318 352 M660 450 Q560 465 450 474 M660 450 Q760 460 835 470 M700 230 Q860 280 985 340 M300 360 Q220 420 150 462 M985 340 Q1080 400 1135 458 M545 230 Q400 220 250 215" stroke="#e9dfc8" stroke-width="7" fill="none" opacity=".45" stroke-linecap="round"/>
  ${trees}
  <text x="640" y="88" text-anchor="middle" class="sect-title">${sectName.replace(/[<&>"]/g, '')}</text>
  </svg>`;
}

/** 前景飘的云 */
export function clouds(): string {
  return `<div class="cloud c1"></div><div class="cloud c2"></div><div class="cloud c3"></div>`;
}

const ROOF = ['#2f3f5c', '#3a4d6e', '#5a3a6e', '#7a2e2e'];

function hut(roof: string, wall = '#efe2c8', snow = false, w = 80, h = 36) {
  const hw = w / 2;
  return `<rect x="${-hw + 4}" y="${-h - 6}" width="${w - 8}" height="${h}" fill="${wall}"/>
    <rect x="${-hw + 6}" y="${-h - 6}" width="4" height="${h}" fill="#8e3b2e"/><rect x="${hw - 10}" y="${-h - 6}" width="4" height="${h}" fill="#8e3b2e"/>
    <rect x="-8" y="-28" width="16" height="22" fill="#5c2c22"/>
    <path d="M${-hw - 14} ${-h - 4} Q${-hw / 2} ${-h - 10} 0 ${-h - 26} Q${hw / 2} ${-h - 10} ${hw + 14} ${-h - 4} L${hw + 20} ${-h - 12} L${hw + 6} ${-h + 2} Q${hw / 2} ${-h - 4} 0 ${-h - 14} Q${-hw / 2} ${-h - 4} ${-hw - 6} ${-h + 2} L${-hw - 20} ${-h - 12}Z" fill="${roof}"/>
    ${snow ? `<path d="M${-hw - 12} ${-h - 6} Q${-hw / 2} ${-h - 12} 0 ${-h - 27} Q${hw / 2} ${-h - 12} ${hw + 12} ${-h - 6}" stroke="#f4f8ff" stroke-width="4" fill="none" stroke-linecap="round"/>` : ''}`;
}

function tier2(roof: string, snow: boolean, y: number, w: number) {
  const hw = w / 2;
  return `<g transform="translate(0,${y})"><rect x="${-hw + 6}" y="-22" width="${w - 12}" height="18" fill="#efe2c8"/>
    <path d="M${-hw - 8} -20 Q${-hw / 2} -25 0 -38 Q${hw / 2} -25 ${hw + 8} -20 L${hw + 13} -27 L${hw + 2} -14 Q${hw / 2} -19 0 -28 Q${-hw / 2} -19 ${-hw - 2} -14 L${-hw - 13} -27Z" fill="${roof}"/>
    ${snow ? `<path d="M${-hw - 6} -21 Q0 -40 ${hw + 6} -21" stroke="#f4f8ff" stroke-width="3" fill="none"/>` : ''}</g>`;
}

const lanterns = (n: number, y: number) => Array.from({ length: n }, (_, i) => `<g class="lantern" style="animation-delay:${i * 0.4}s"><line x1="${-30 + i * 30}" y1="${y - 6}" x2="${-30 + i * 30}" y2="${y}" stroke="#5c2c22" stroke-width="1.5"/><ellipse cx="${-30 + i * 30}" cy="${y + 5}" rx="5" ry="6.5" fill="#ff9f43"/></g>`).join('');

/** 一座殿堂的样子。原点在地基正中，往上画。lv 0 是空地 */
export function hallArt(id: HallId | 'main' | 'cave' | 'gate', lv: number, season: number, sectName = ''): string {
  const snow = season === 3;
  const roof = ROOF[Math.min(3, Math.max(0, lv - 1))];
  const base = `<ellipse cx="0" cy="4" rx="66" ry="11" fill="#000" opacity=".2"/><rect x="-58" y="-7" width="116" height="12" rx="3" fill="#cbbfa7"/><rect x="-58" y="-7" width="116" height="4" rx="2" fill="#e4dac4"/>`;
  const up = lv >= 2 ? tier2(roof, snow, -64, 66) : '';
  const lamps = lv >= 3 ? lanterns(3, -44) : '';
  const gold = lv >= 4 ? `<path d="M-50 -44 Q0 -76 50 -44" stroke="#f3d27a" stroke-width="2.5" fill="none" opacity=".9"/>` : '';
  switch (id) {
    case 'main':
      return `${base}<g transform="scale(1.1)">${hut('#7a2e2e', '#f4e7cc', snow, 92, 40)}${tier2('#7a2e2e', snow, -70, 72)}</g>
        <rect x="-26" y="-52" width="52" height="15" rx="2" fill="#2a1d14" stroke="#e8c372" stroke-width="1.5"/><text x="0" y="-41" text-anchor="middle" class="plaque">${sectName.slice(0, 4).replace(/[<&>"]/g, '')}</text>${lanterns(3, -56)}`;
    case 'cave':
      return `<path d="M-74 6 Q-80 -60 -30 -84 Q10 -100 48 -74 Q84 -50 76 6Z" fill="#59606e"/><path d="M-74 6 Q-80 -60 -30 -84 Q-10 -90 6 -86 Q-30 -60 -40 6Z" fill="#6d7584"/>
        ${snow ? '<path d="M-58 -62 Q-30 -88 10 -88 Q44 -80 62 -58" stroke="#f4f8ff" stroke-width="6" fill="none" stroke-linecap="round"/>' : ''}
        <path class="cave-mouth" d="M-26 6 Q-26 -46 0 -50 Q26 -46 26 6Z" fill="#121521"/>
        <rect x="-4" y="-48" width="8" height="20" fill="#e8c372" opacity=".85"/><path d="M-2 -44 h4 M-2 -38 h4 M-2 -32 h4" stroke="#7a2e2e" stroke-width="1"/>`;
    case 'gate':
      return `<rect x="-62" y="-70" width="10" height="72" fill="#8e3b2e"/><rect x="52" y="-70" width="10" height="72" fill="#8e3b2e"/>
        <rect x="-74" y="-80" width="148" height="10" fill="#5c2c22"/><path d="M-86 -80 Q-40 -88 0 -98 Q40 -88 86 -80 L90 -86 L80 -74 Q40 -82 0 -90 Q-40 -82 -80 -74 L-90 -86Z" fill="#2f3f5c"/>
        ${snow ? '<path d="M-84 -82 Q0 -100 84 -82" stroke="#f4f8ff" stroke-width="4" fill="none"/>' : ''}
        <rect x="-32" y="-72" width="64" height="16" rx="2" fill="#2a1d14" stroke="#e8c372" stroke-width="1.2"/><text x="0" y="-60" text-anchor="middle" class="plaque">${sectName.slice(0, 4).replace(/[<&>"]/g, '')}</text>
        <ellipse cx="-57" cy="4" rx="12" ry="4" fill="#000" opacity=".25"/><ellipse cx="57" cy="4" rx="12" ry="4" fill="#000" opacity=".25"/>`;
    case 'herb': {
      const field = snow ? '#e7eef7' : season === 2 ? '#d9b45a' : season === 1 ? '#3f9a54' : '#7cc56f';
      const rows = [0, 1, 2].map((i) => `<ellipse cx="${-20 + i * 6}" cy="${-4 + i * 12}" rx="${56 - i * 4}" ry="6" fill="${field}"/><path d="M${-70 + i * 6} ${-4 + i * 12} h${100}" stroke="#2c5a2e" stroke-width="2" stroke-dasharray="2 6" opacity=".6"/>`).join('');
      return `<ellipse cx="0" cy="18" rx="80" ry="22" fill="#6b4f2c" opacity=".55"/>${rows}<g transform="translate(46,-8) scale(.55)">${hut(roof, '#efe2c8', snow)}</g>${lv >= 2 ? `<g transform="translate(-58,-6) scale(.4)">${hut(roof, '#efe2c8', snow)}</g>` : ''}${lv >= 3 ? lanterns(2, -30) : ''}`;
    }
    case 'alchemy':
      return `${base}${hut(roof, '#efe2c8', snow)}${up}${lamps}${gold}
        <g transform="translate(-44,-2)"><path d="M-12 -18 h24 l-3 16 h-18z" fill="#6d4a2a"/><path d="M-9 -2 l-3 6 M9 -2 l3 6" stroke="#4a3426" stroke-width="2"/><ellipse cx="0" cy="-18" rx="13" ry="3" fill="#8a6038"/>
        <g class="smoke"><circle cx="0" cy="-26" r="5"/><circle cx="3" cy="-34" r="6"/><circle cx="-2" cy="-44" r="7"/></g></g>`;
    case 'forge':
      return `${base}${hut(roof, '#e8dcc6', snow)}${up}${lamps}${gold}
        <rect x="30" y="-80" width="12" height="42" fill="#5a4a44"/><g class="sparks"><circle cx="36" cy="-86" r="2"/><circle cx="40" cy="-92" r="1.6"/><circle cx="33" cy="-98" r="1.4"/></g>
        <g transform="translate(-48,-4)"><rect x="-10" y="-10" width="20" height="10" fill="#3d3d44"/><rect x="-14" y="-14" width="28" height="5" fill="#55555e"/></g>`;
    case 'teach':
      return `${base}${hut(roof, '#efe2c8', snow, 76, 34)}${tier2(roof, snow, -60, 60)}${tier2(roof, snow, lv >= 2 ? -86 : -86, 40)}${lamps}${gold}`;
    case 'law':
      return `${base}${hut(roof, '#e6dcc8', snow)}${up}${lamps}${gold}
        <g transform="translate(-50,-4)"><path d="M-8 0 L-4 -20 M8 0 L4 -20" stroke="#4a3426" stroke-width="2.5"/><ellipse cx="0" cy="-26" rx="11" ry="11" fill="#9a3b2e"/><ellipse cx="0" cy="-26" rx="7" ry="7" fill="#c8a06a"/></g>`;
    case 'diplomacy':
      return `${base}${hut(roof, '#efe2c8', snow)}${up}${lamps}${gold}
        <g class="flag"><line x1="-52" y1="0" x2="-52" y2="-70" stroke="#4a3426" stroke-width="2.5"/><path d="M-52 -70 h22 l-6 8 l6 8 h-22z" fill="#c0473f"/></g>
        <g class="flag f2"><line x1="54" y1="0" x2="54" y2="-62" stroke="#4a3426" stroke-width="2.5"/><path d="M54 -62 h-20 l6 7 l-6 7 h20z" fill="#3f7fc0"/></g>`;
    case 'recruit':
      return `${base}<rect x="-44" y="-44" width="5" height="40" fill="#8e3b2e"/><rect x="39" y="-44" width="5" height="40" fill="#8e3b2e"/><rect x="-20" y="-44" width="4" height="40" fill="#8e3b2e" opacity=".8"/><rect x="16" y="-44" width="4" height="40" fill="#8e3b2e" opacity=".8"/>
        <path d="M-66 -42 Q-30 -50 0 -70 Q30 -50 66 -42 L72 -50 L58 -36 Q30 -42 0 -58 Q-30 -42 -58 -36 L-72 -50Z" fill="${roof}"/>${snow ? '<path d="M-64 -44 Q0 -72 64 -44" stroke="#f4f8ff" stroke-width="4" fill="none"/>' : ''}
        ${lanterns(2, -36)}${up}${gold}`;
    case 'guard':
      return `<ellipse cx="0" cy="4" rx="34" ry="8" fill="#000" opacity=".2"/><path d="M-22 4 L-16 -70 L16 -70 L22 4Z" fill="#8a7a66"/><path d="M-22 4 L-16 -70 L-6 -70 L-10 4Z" fill="#9c8c76"/>
        <rect x="-26" y="-82" width="52" height="14" fill="#efe2c8"/><path d="M-36 -80 Q0 -96 36 -80 L40 -86 L30 -76 Q0 -88 -30 -76 L-40 -86Z" fill="${roof}"/>${snow ? '<path d="M-34 -82 Q0 -98 34 -82" stroke="#f4f8ff" stroke-width="3" fill="none"/>' : ''}
        <g class="flag"><line x1="0" y1="-92" x2="0" y2="-118" stroke="#4a3426" stroke-width="2"/><path d="M0 -118 h18 l-5 6 l5 6 h-18z" fill="#c0473f"/></g>${lv >= 2 ? `<g transform="translate(48,0) scale(.45)">${hut(roof, '#efe2c8', snow)}</g>` : ''}${lv >= 3 ? lanterns(2, -60) : ''}`;
  }
}

/** 空地：一圈虚线和木桩 */
export function plotArt(): string {
  return `<ellipse cx="0" cy="0" rx="56" ry="13" fill="rgba(0,0,0,.12)" stroke="rgba(255,255,255,.6)" stroke-width="2" stroke-dasharray="7 6"/>
    <path d="M-42 0 v-12 M42 0 v-12 M0 12 v-12 M0 -13 v-10" stroke="#e9dfc8" stroke-width="4" stroke-linecap="round" opacity=".8"/>`;
}

/** 脚手架（盖到一半时罩在外面） */
export function scaffoldArt(): string {
  return `<g class="scaffold"><path d="M-54 2 V-62 M54 2 V-62 M-18 2 V-62 M18 2 V-62 M-58 -60 H58 M-58 -40 H58 M-58 -20 H58 M-54 2 L-18 -60 M18 -60 L54 2" stroke="#c9a36b" stroke-width="3" fill="none"/></g>`;
}
