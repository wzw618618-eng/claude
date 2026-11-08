// 占位头像：按每个人的长相参数画一个 SVG 小人。正式的动漫立绘画好后替换。

import type { Person, Rank } from '../game/types';

const HAIR = ['#1d1b26', '#3a2a22', '#5b3a29', '#c9ccd6', '#1f2a44', '#7a4b2a'];
const ROBE: Record<Rank, [string, string]> = {
  probation: ['#8a8f9c', '#6c7180'], outer: ['#7d93b5', '#5d7395'], inner: ['#4fae95', '#3a8a74'], core: ['#eef1f6', '#c7ccd8'],
  chief: ['#e8c372', '#c79a45'], elder: ['#8b6fc0', '#6a529b'], master: ['#c0473f', '#8e2f2a'],
};

export function avatar(p: Person, size = 48, opts: { mood?: boolean; cls?: string } = {}): string {
  const old = p.age > 90 && p.realm < 2;
  const hair = old ? '#d9dbe2' : HAIR[p.look.hair % HAIR.length];
  const [robe, robe2] = p.sect && p.sect !== 'me' && p.rank !== 'master' ? ['#9a5a5a', '#7a4040'] : ROBE[p.rank];
  const eye = `hsl(${p.look.hue},55%,42%)`;
  const bg1 = `hsl(${p.look.hue},45%,28%)`, bg2 = `hsl(${(p.look.hue + 40) % 360},50%,18%)`;
  const f = p.gender === 'f';
  const mood = opts.mood === false ? 60 : p.mood;
  const angry = opts.mood !== false && p.grudge >= 50;
  const id = `a${p.id}${size}`;
  const style = p.look.face % 3;
  const brows = angry ? '<path d="M23 25 l7 2.5 M41 25 l-7 2.5" stroke="#2a2030" stroke-width="1.6" stroke-linecap="round"/>' : mood < 30 ? '<path d="M23 26 l7 -2 M41 26 l-7 -2" stroke="#2a2030" stroke-width="1.4" stroke-linecap="round"/>' : '';
  const mouth = mood >= 70 ? '<path d="M29 38 q3 3 6 0" stroke="#a34b4b" stroke-width="1.4" fill="none" stroke-linecap="round"/>' : mood < 30 ? '<path d="M29 39.5 q3 -2.4 6 0" stroke="#a34b4b" stroke-width="1.3" fill="none" stroke-linecap="round"/>' : '<path d="M30 38.5 h4" stroke="#a34b4b" stroke-width="1.3" stroke-linecap="round"/>';
  const eyes = style === 2
    ? `<path d="M23.5 30 q3 -3 6 0" stroke="#2a2030" stroke-width="1.6" fill="none"/><path d="M34.5 30 q3 -3 6 0" stroke="#2a2030" stroke-width="1.6" fill="none"/>`
    : `<ellipse cx="26.5" cy="30" rx="2.6" ry="${style ? 3.2 : 3.6}" fill="${eye}"/><ellipse cx="37.5" cy="30" rx="2.6" ry="${style ? 3.2 : 3.6}" fill="${eye}"/><circle cx="27.4" cy="28.8" r="0.9" fill="#fff"/><circle cx="38.4" cy="28.8" r="0.9" fill="#fff"/><path d="M23.4 26.4 q3.1 -1.6 6.2 0 M34.4 26.4 q3.1 -1.6 6.2 0" stroke="#2a2030" stroke-width="1" fill="none"/>`;
  const backHair = f ? `<path d="M15 26 q-2 20 4 30 h26 q6 -10 4 -30 z" fill="${hair}"/>` : '';
  const fringe = [
    `<path d="M17 28 q0 -16 15 -16 q15 0 15 16 q-3 -7 -7 -8 q-2 5 -8 5 q-6 0 -8 -5 q-4 1 -7 8z" fill="${hair}"/>`,
    `<path d="M17 29 q-1 -17 15 -17 q16 0 15 17 l-3 -6 l-3 4 l-3 -6 l-3 5 l-3 -6 l-3 5 l-3 -5 l-3 6 z" fill="${hair}"/>`,
    `<path d="M17 27 q1 -15 15 -15 q14 0 15 15 q-8 -9 -22 -4 q-4 1 -8 4z" fill="${hair}"/>`,
  ][p.look.hair % 3];
  const bun = p.gender === 'm' && p.look.hair % 2 === 0 ? `<circle cx="32" cy="10" r="4.5" fill="${hair}"/><rect x="29" y="9" width="6" height="2" rx="1" fill="#e8c372"/>` : f && p.look.hair % 2 ? `<path d="M41 14 l5 -4" stroke="#e8c372" stroke-width="1.6" stroke-linecap="round"/><circle cx="46.5" cy="9.5" r="1.6" fill="hsl(${p.look.hue},70%,60%)"/>` : '';
  const beard = !f && p.age > 60 ? `<path d="M27 40 q5 9 10 0 q-5 3 -10 0z" fill="${hair}"/>` : '';
  return `<svg class="ava ${opts.cls ?? ''}" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true"><defs><radialGradient id="${id}" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></radialGradient></defs><rect width="64" height="64" rx="14" fill="url(#${id})"/>${backHair}<path d="M10 64 q2 -14 14 -16 l8 6 l8 -6 q12 2 14 16z" fill="${robe}"/><path d="M24 48 l8 10 l8 -10 l-3 -1 l-5 6 l-5 -6z" fill="${robe2}"/><rect x="28.5" y="40" width="7" height="8" rx="3" fill="#f3d2bd"/><ellipse cx="32" cy="30" rx="13.5" ry="14.5" fill="#ffe4d2"/>${eyes}${brows}<ellipse cx="24" cy="35" rx="2.2" ry="1.2" fill="#ffb7b0" opacity=".6"/><ellipse cx="40" cy="35" rx="2.2" ry="1.2" fill="#ffb7b0" opacity=".6"/>${mouth}${beard}${fringe}${bun}</svg>`;
}
