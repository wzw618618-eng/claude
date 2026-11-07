// 青冥州舆图：七个地方画在一张水墨小图上，山、水、路都是几笔墨线。
// 点一个地方打开它的介绍（data-act="place"）。你在哪就盖一枚朱砂点，每处标着有几个人。

import type { PlaceId, World } from '../game/core/types.ts';
import { npcs } from '../game/core/world.ts';
import { art } from './art.ts';
import { PLACES } from '../game/data/world-data.ts';

/** 每个地方在图上的位置（viewBox 360×300） */
export const SPOT: Record<PlaceId, { x: number; y: number }> = {
  qinglan: { x: 92, y: 72 },
  chixiao: { x: 280, y: 64 },
  vein: { x: 58, y: 170 },
  market: { x: 186, y: 152 },
  forest: { x: 302, y: 168 },
  village: { x: 108, y: 252 },
  cave: { x: 268, y: 252 },
};

/** 路：哪些地方之间有路 */
const ROADS: [PlaceId, PlaceId][] = [
  ['qinglan', 'market'], ['chixiao', 'market'], ['vein', 'market'], ['market', 'village'], ['market', 'cave'],
  ['forest', 'market'], ['forest', 'cave'], ['village', 'vein'], ['qinglan', 'vein'], ['chixiao', 'forest'],
];

/** 远山：几道淡墨的山脊线 */
const RIDGES = [
  'M0 96 Q30 70 60 84 Q92 50 124 72 Q156 42 190 66 Q222 38 254 58 Q290 32 320 54 Q342 44 360 50',
  'M0 124 Q28 104 56 114 Q86 92 116 108 Q140 98 168 112',
  'M210 104 Q238 86 264 98 Q296 80 326 94 Q346 88 360 94',
];
/** 一条河：从听泉谷流过柳溪村 */
const RIVER = 'M30 140 Q58 176 54 204 T86 236 T150 274 T214 300';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function mapSvg(w: World, opts: { here?: PlaceId | null; label?: boolean } = {}) {
  const count: Partial<Record<PlaceId, number>> = {};
  for (const n of npcs(w)) count[n.place] = (count[n.place] ?? 0) + 1;
  const here = opts.here === undefined ? w.me.place : opts.here;
  const roads = ROADS.map(([a, b]) => {
    const p = SPOT[a], q = SPOT[b];
    const mx = (p.x + q.x) / 2 + (p.y - q.y) * 0.08, my = (p.y + q.y) / 2 + (q.x - p.x) * 0.08;
    return `<path d="M${p.x} ${p.y} Q${mx.toFixed(1)} ${my.toFixed(1)} ${q.x} ${q.y}"/>`;
  }).join('');
  const spots = (Object.keys(SPOT) as PlaceId[]).map((id) => {
    const { x, y } = SPOT[id];
    const n = count[id] ?? 0;
    const cur = id === here;
    return `<g class="spot${cur ? ' cur' : ''}" data-act="place" data-v="${id}" role="button" tabindex="0" aria-label="${esc(PLACES[id].name)}，${n}人">
      <circle class="hit" cx="${x}" cy="${y}" r="22"/>
      <circle class="dot" cx="${x}" cy="${y}" r="${cur ? 8 : 6}"/>
      <text class="name" x="${x}" y="${y + 24}" text-anchor="middle">${esc(PLACES[id].name)}</text>
      ${n ? `<g class="count"><circle cx="${x + 11}" cy="${y - 10}" r="7.5"/><text x="${x + 11}" y="${y - 6.6}" text-anchor="middle">${n}</text></g>` : ''}
    </g>`;
  }).join('');
  return `<svg class="map" viewBox="0 0 360 300" role="group" aria-label="青冥州舆图">
    <image href="${art('qinglan')}" x="0" y="0" width="360" height="300" preserveAspectRatio="xMidYMid slice" opacity=".16" aria-hidden="true"/>
    <g class="ridges">${RIDGES.map((d) => `<path d="${d}"/>`).join('')}</g>
    <path class="river" d="${RIVER}"/>
    <g class="roads">${roads}</g>
    ${spots}
  </svg>`;
}
