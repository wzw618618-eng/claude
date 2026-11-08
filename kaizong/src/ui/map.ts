// 宗门地图：一座山，七个殿堂加巡山队，弟子们站在自己干活的地方。点人看人物卡，点殿堂去安排人。
// 先用 SVG 画占位的山和殿；动漫插画画好后换成背景图。

import { HALLS } from '../game/data/world';
import type { JobId, Person, World } from '../game/types';
import { members, me } from '../game/world';
import { avatar } from './avatar';
import { esc } from './util';

const SPOT: Partial<Record<JobId, [number, number]>> = { seclude: [0.13, 0.33], none: [0.5, 0.64] };
const SKY = [
  ['#2b3f6b', '#8fb6d9', '#f3d3d9'], // 春
  ['#1e4b78', '#7cc0e8', '#ffe7b0'], // 夏
  ['#3b2f55', '#c7836a', '#f2c178'], // 秋
  ['#24304d', '#7d93b8', '#dfe7f2'], // 冬
];

/** 空地：一圈虚线和木桩；在建：再搭上脚手架 */
function plotSvg(x: number, y: number, name: string, building: boolean) {
  const X = x * 1000, Y = y * 620;
  const scaffold = building ? `<path d="M-24 22 V-6 M24 22 V-6 M-24 -6 H24 M-24 8 H24 M-24 22 L0 -6 L24 22" stroke="#c9a36b" stroke-width="2.4" fill="none"/><rect x="-20" y="10" width="40" height="12" fill="#efe2c8" opacity=".55"/>` : '';
  return `<g transform="translate(${X},${Y}) scale(0.85)" class="hall plot${building ? ' building' : ''}">
    <ellipse cx="0" cy="22" rx="40" ry="9" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="2" stroke-dasharray="6 5"/>
    <path d="M-30 22 v-8 M30 22 v-8 M0 31 v-8" stroke="rgba(239,226,200,.55)" stroke-width="3" stroke-linecap="round"/>
    ${scaffold}
    <rect x="-42" y="31" width="84" height="22" rx="11" fill="rgba(15,18,32,.62)" stroke="rgba(232,195,114,.3)"/>
    <text x="0" y="47.5" text-anchor="middle" class="hall-name dim">${esc(name)}${building ? '·在建' : '·空地'}</text>
  </g>`;
}

function hallSvg(x: number, y: number, name: string, lv: number, hot: boolean) {
  const s = 0.85 + (lv - 1) * 0.12;
  const X = x * 1000, Y = y * 620;
  const lanterns = Array.from({ length: lv - 1 }, (_, i) => `<circle cx="${-18 + i * 18}" cy="2" r="3" fill="#ffb347" class="lantern"/>`).join('');
  return `<g transform="translate(${X},${Y}) scale(${s})" class="hall${hot ? ' hot' : ''}">
    <ellipse cx="0" cy="26" rx="46" ry="8" fill="#000" opacity=".18"/>
    <rect x="-28" y="-2" width="56" height="26" rx="2" fill="#efe2c8"/>
    <rect x="-8" y="8" width="16" height="16" fill="#7a3b2e"/>
    <path d="M-40 -2 Q-20 -8 0 -22 Q20 -8 40 -2 Q44 -1 46 -5 L40 6 Q20 -2 0 -10 Q-20 -2 -40 6 L-46 -5 Q-44 -1 -40 -2z" fill="#2f3f5c"/>
    ${lanterns}
    <rect x="-38" y="29" width="76" height="22" rx="11" fill="rgba(15,18,32,.8)" stroke="rgba(232,195,114,.5)"/>
    <text x="0" y="45.5" text-anchor="middle" class="hall-name">${esc(name)}</text>
  </g>`;
}

export function mapView(w: World): string {
  const [top, mid, low] = SKY[w.t % 4];
  const snow = w.t % 4 === 3;
  const halls = HALLS.map((h) => {
    const lv = w.sect.halls[h.id];
    const building = w.sect.works.some((x) => x.hall === h.id);
    return lv > 0 ? hallSvg(h.x, h.y, h.name, lv, building) : plotSvg(h.x, h.y, h.name, building);
  }).join('');
  const svg = `<svg class="map-svg" viewBox="0 0 1000 620" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset=".55" stop-color="${mid}"/><stop offset="1" stop-color="${low}"/></linearGradient>
      <linearGradient id="mt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${snow ? '#eef2f8' : '#4c7a6a'}"/><stop offset="1" stop-color="${snow ? '#9fb0c6' : '#2d4f47'}"/></linearGradient>
      <linearGradient id="mt2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${snow ? '#c9d4e4' : '#6f8fa8'}"/><stop offset="1" stop-color="${snow ? '#8796ad' : '#3e5870'}"/></linearGradient>
    </defs>
    <rect width="1000" height="620" fill="url(#sky)"/>
    <circle cx="820" cy="90" r="38" fill="#fff6dc" opacity=".85"/>
    <path d="M0 330 L120 210 L210 280 L330 150 L460 260 L560 180 L700 270 L820 170 L1000 300 V620 H0z" fill="url(#mt2)" opacity=".7"/>
    <path d="M0 420 Q150 300 280 330 Q420 160 500 120 Q600 170 700 300 Q850 300 1000 400 V620 H0z" fill="url(#mt)"/>
    <path d="M500 120 Q480 260 520 400 Q560 520 500 620" stroke="rgba(255,255,255,.18)" stroke-width="10" fill="none"/>
    <g class="clouds"><ellipse cx="180" cy="190" rx="90" ry="16" fill="#fff" opacity=".35"/><ellipse cx="760" cy="230" rx="110" ry="18" fill="#fff" opacity=".3"/></g>
    <g transform="translate(500,95) scale(1.15)" class="hall"><ellipse cx="0" cy="26" rx="50" ry="8" fill="#000" opacity=".2"/><rect x="-34" y="-4" width="68" height="30" rx="2" fill="#f4e7cc"/><rect x="-9" y="8" width="18" height="18" fill="#7a3b2e"/><path d="M-48 -4 Q-24 -12 0 -30 Q24 -12 48 -4 L54 -9 L46 6 Q24 -4 0 -14 Q-24 -4 -46 6 L-54 -9z" fill="#7a2e2e"/><text x="0" y="-36" text-anchor="middle" class="hall-name main">${esc(w.sect.name)}</text></g>
    <g transform="translate(130,205)"><path d="M-40 26 Q-30 -20 0 -24 Q30 -20 40 26z" fill="#2a2f3a"/><path d="M-16 26 Q-10 0 0 -2 Q10 0 16 26z" fill="#0d1018"/><text x="0" y="46" text-anchor="middle" class="hall-name">闭关洞府</text></g>
    ${halls}
    ${snow ? '<g class="snow"></g>' : ''}
  </svg>`;
  const placed = new Map<string, number>();
  const people = [me(w), ...members(w).filter((p) => p.job !== 'travel')].map((p) => {
    const key = p.id === w.me ? 'master' : p.job;
    const n = placed.get(key) ?? 0;
    placed.set(key, n + 1);
    const base = p.id === w.me ? [0.5, 0.25] : SPOT[p.job] ?? (() => { const h = HALLS.find((x) => x.id === p.job)!; return [h.x, h.y]; })();
    const dx = ((n % 4) - 1.5) * 0.034;
    const dy = -0.07 - Math.floor(n / 4) * 0.075;
    return personPin(p, base[0] + dx, base[1] + dy, n);
  }).join('');
  const away = members(w).filter((p) => p.job === 'travel');
  return `<div class="map">${svg}
    ${HALLS.map((h) => `<button class="hall-hit" style="left:${h.x * 100}%;top:${h.y * 100}%" data-act="hall" data-id="${h.id}" aria-label="${esc(h.name)}"></button>`).join('')}
    <div class="pins">${people}</div>
    ${away.length ? `<div class="away">在外历练：${away.map((p) => `<button class="link" data-act="person" data-id="${p.id}">${esc(p.name)}</button>`).join('、')}</div>` : ''}
  </div>`;
}

function personPin(p: Person, x: number, y: number, n: number) {
  const flags = `${p.starred ? '<i class="star">★</i>' : ''}${p.grudge >= 50 ? '<i class="flag bad">怨</i>' : p.wish && p.mood >= 70 ? '' : ''}`;
  return `<button class="pin${p.rank === 'master' ? ' master' : ''}" style="left:${(x * 100).toFixed(2)}%;top:${(y * 100).toFixed(2)}%;animation-delay:${(n * 0.37) % 2}s" data-act="person" data-id="${p.id}" title="${esc(p.name)}">${avatar(p, 34)}${flags}<span class="pin-name">${esc(p.name)}</span></button>`;
}
