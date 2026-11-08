// 场景四周的东西：顶栏（日子、快慢、家底）、左边的菜单、右上的待裁决、左下滚动的纪事、右下宗主在做什么、左上的目标。
// 都是小块 HTML，内容变了才换。

import { atBottleneck, need, REALM_NAME, realmText } from '../game/cult';
import { HALLS } from '../game/data/world';
import type { Decision, Person, ReportItem, World } from '../game/types';
import { goalProgress, TIERS } from '../game/goals';
import { MASTER_ACT, masterLeft, masterProgress, planText } from '../game/master';
import { isBuilt } from '../game/build';
import { RES_KEYS } from '../game/season';
import { upkeepCost } from '../game/sect';
import { lacks, me, members, MONTH_DAYS, nowDay, P, SEASON_DAYS, seasonName, year, dayName, daysLeft } from '../game/world';
import { avatar } from './avatar';
import { esc, n0 } from './util';
import type { Tab, Ui } from './views';

const ICON: Record<string, string> = {
  stones: '<svg viewBox="0 0 16 16"><path d="M8 1 14 6 8 15 2 6Z" fill="#7fe0ff"/><path d="M8 1 14 6H2Z" fill="#c4f2ff"/></svg>',
  herbs: '<svg viewBox="0 0 16 16"><path d="M8 15C8 9 4 6 2 4c4 0 6 2 6 5 0-4 2-7 6-8-1 4-3 7-6 8" fill="#6fd38a"/></svg>',
  pills: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="#e0765f"/><circle cx="6.3" cy="6.2" r="1.6" fill="#ffd2c4"/></svg>',
  fpills: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="#f2c94c"/><circle cx="8" cy="8" r="2.4" fill="#fff3c2"/></svg>',
  armory: '<svg viewBox="0 0 16 16"><path d="M13 1 15 3 6 12 4 10Z" fill="#cfd8e6"/><path d="M3 9 7 13 5 14 2 11Z" fill="#c79a45"/></svg>',
  rep: '<svg viewBox="0 0 16 16"><path d="M8 1l2 5h5l-4 3 1.6 5L8 11l-4.6 3L5 9 1 6h5Z" fill="#f3d27a"/></svg>',
  authority: '<svg viewBox="0 0 16 16"><path d="M2 12 3 4l3 3 2-5 2 5 3-3 1 8Z" fill="#e8a25c"/></svg>',
  veins: '<svg viewBox="0 0 16 16"><path d="M1 10q3-6 7 0t7 0" stroke="#6fd3c3" stroke-width="2.2" fill="none"/></svg>',
};
const RES_NAME: Record<(typeof RES_KEYS)[number], string> = { stones: '灵石', herbs: '灵草', pills: '丹药', fpills: '筑基丹', armory: '法器', rep: '名望', authority: '宗主威望', veins: '灵脉' };

export const SPEEDS = [0, 1, 2, 4];

/** 顶栏：宗门名、日子、快慢、家底 */
export function hudView(w: World, ui: Ui, frozen: string | null) {
  const s = w.sect;
  const d = w.day ?? 0;
  const month = '正二三四五六七八九十冬腊'[(w.t % 4) * 3 + Math.floor(d / MONTH_DAYS)];
  const upkeep = upkeepCost(w);
  const lowStones = upkeep > 0 && s.stones < upkeep * 0.7;
  const res = RES_KEYS.map((k) => `<span class="hr ${k}${k === 'stones' && lowStones ? ' low' : ''}" title="${RES_NAME[k]}${k === 'stones' ? `（每季月例 ${n0(upkeep)}）` : ''}">${ICON[k]}<b>${n0(s[k])}</b><em>${RES_NAME[k]}</em></span>`).join('');
  const sp = ui.speed;
  const btn = (v: number, label: string, title: string) => `<button class="sp${sp === v && !frozen ? ' on' : ''}" data-act="speed" data-v="${v}" title="${title}" aria-label="${title}">${label}</button>`;
  return `<button class="hud-brand" data-act="tab" data-id="sect"><b>${esc(s.name)}</b><small>${TIERS[w.tier]}</small></button>
    <div class="hud-date" title="一季九十天"><b>第${year(w.t)}年 · ${seasonName(w.t)}</b><small>${month}月${dayName(d % MONTH_DAYS)}</small><i class="sbar"><i style="width:${((d / SEASON_DAYS) * 100).toFixed(1)}%"></i></i></div>
    <div class="hud-speed${frozen ? ' frozen' : ''}" role="group" aria-label="时间快慢">
      ${btn(0, '<svg viewBox="0 0 16 16"><rect x="3" y="2" width="3.6" height="12" rx="1"/><rect x="9.4" y="2" width="3.6" height="12" rx="1"/></svg>', '暂停')}
      ${btn(1, '<svg viewBox="0 0 16 16"><path d="M4 2 13 8 4 14Z"/></svg>', '正常')}
      ${btn(2, '<svg viewBox="0 0 16 16"><path d="M1 2 8 8 1 14ZM8 2l7 6-7 6Z"/></svg>', '两倍速')}
      ${btn(4, '<svg viewBox="0 0 16 16"><path d="M0 3 5 8 0 13ZM5.5 3l5 5-5 5ZM11 3l5 5-5 5Z"/></svg>', '四倍速')}
      ${frozen ? `<span class="frozen-why">${esc(frozen)}</span>` : ''}
    </div>
    <div class="hud-res">${res}</div>
    <button class="hud-menu" data-act="settings" aria-label="设置">☰</button>`;
}

const RAIL: [Tab, string, string][] = [
  ['people', '弟子', '<svg viewBox="0 0 20 20"><circle cx="10" cy="6" r="3.5"/><path d="M3 18c0-4 3-7 7-7s7 3 7 7Z"/></svg>'],
  ['staff', '殿堂', '<svg viewBox="0 0 20 20"><path d="M1 8 10 2l9 6h-2v9H3V8Z"/><rect x="8" y="11" width="4" height="6" fill="#0d1424"/></svg>'],
  ['mission', '任务', '<svg viewBox="0 0 20 20"><path d="M4 2h9l3 3v13H4Z"/><path d="M7 8h6M7 11h6M7 14h4" stroke="#0d1424" stroke-width="1.6"/></svg>'],
  ['recruit', '招募', '<svg viewBox="0 0 20 20"><circle cx="8" cy="6" r="3.2"/><path d="M2 18c0-4 2.6-6.5 6-6.5s6 2.5 6 6.5Z"/><path d="M15 5v6M12 8h6" stroke="currentColor" stroke-width="2"/></svg>'],
  ['sect', '宗门', '<svg viewBox="0 0 20 20"><path d="M10 1l2.4 5.6L18 7l-4.4 4 1.3 6L10 14l-4.9 3 1.3-6L2 7l5.6-.4Z"/></svg>'],
  ['world', '天下', '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8"/><path d="M2 10h16M10 2c3 3 3 13 0 16M10 2c-3 3-3 13 0 16" stroke="#0d1424" stroke-width="1.4" fill="none"/></svg>'],
  ['report', '纪事', '<svg viewBox="0 0 20 20"><path d="M3 2h11a3 3 0 0 1 3 3v13H6a3 3 0 0 1-3-3Z"/><path d="M6 7h8M6 10h8M6 13h5" stroke="#0d1424" stroke-width="1.6"/></svg>'],
];

/** 左边一列菜单 */
export function railView(w: World, ui: Ui) {
  const idle = members(w).filter((p) => p.job === 'none').length;
  const neck = members(w).filter((p) => atBottleneck(p) && !p.breaking).length;
  const badge: Partial<Record<Tab, [number, string]>> = {
    people: [neck, 'gold'], staff: [idle, 'red'], mission: [w.missions.length, 'soft'], recruit: [w.candidates.length, 'soft'], report: [w.decisions.length, 'red'],
  };
  return RAIL.map(([t, name, icon]) => {
    const b = badge[t];
    return `<button class="rail-btn${ui.drawer === t ? ' on' : ''}" aria-current="${ui.drawer === t ? 'page' : 'false'}" data-act="tab" data-id="${t}" aria-label="${name}">${icon}<span>${name}</span>${b && b[0] ? `<i class="rb ${b[1]}">${b[0]}</i>` : ''}</button>`;
  }).join('');
}

function faces(w: World, ids: string[], size = 34) {
  return ids.map((id) => P(w, id)).filter((p): p is Person => !!p).slice(0, 2).map((p) => `<button class="ava-btn" data-act="person" data-id="${p.id}">${avatar(p, size)}</button>`).join('');
}

/** 右上角：待裁决的事。最急的那件摊开，其余收成小签 */
export function lettersView(w: World, ui: Ui) {
  const ds = [...w.decisions].sort((a, b) => (a.due ?? 0) - (b.due ?? 0));
  if (!ds.length) return '';
  const open = ds.find((d) => d.id === ui.letter) ?? ds[0];
  const rest = ds.filter((d) => d !== open);
  const left = (d: Decision) => daysLeft(w, d.due ?? nowDay(w));
  return `<article class="letter${left(open) <= 10 ? ' urgent' : ''}" aria-live="polite">
      <header>${faces(w, open.about)}<h4>${esc(open.title)}</h4><span class="due" title="到期按默认办">${left(open)}日</span></header>
      <p>${esc(open.text)}</p>
      <div class="l-opts">${open.options.map((o) => { const no = lacks(w, o.cost); return `<button class="btn sm${o.id === open.fallback ? '' : ' primary'}" data-act="decide" data-id="${open.id}" data-v="${o.id}"${no ? ' disabled' : ''}>${esc(o.label)}${no || o.hint ? `<small>${esc(no ?? o.hint)}</small>` : ''}</button>`; }).join('')}</div>
    </article>
    ${rest.length ? `<div class="letter-tabs">${rest.slice(0, 4).map((d) => `<button class="lt${left(d) <= 10 ? ' urgent' : ''}" data-act="letter" data-id="${d.id}">${esc(d.title)}<small>${left(d)}日</small></button>`).join('')}${rest.length > 4 ? `<button class="lt" data-act="tab" data-id="report">还有 ${rest.length - 4} 件</button>` : ''}</div>` : ''}`;
}

/** 左下：最近发生的事，一条条往上冒 */
export function tickerView(w: World) {
  const items: ReportItem[] = [...(w.history[0]?.items ?? []).slice(-4), ...w.report].slice(-4);
  return items.map((it, i) => {
    const who = it.about.map((id) => P(w, id)).find(Boolean);
    return `<button class="tk ${it.tone}${it.big ? ' big' : ''}" data-act="tab" data-id="report" style="--i:${items.length - 1 - i}">${who ? avatar(who, 20) : '<i class="tk-dot"></i>'}<span>${esc(it.text)}${it.quote ? `<q>${esc(it.quote.text)}</q>` : ''}</span></button>`;
  }).join('');
}

/** 右下：宗主在做什么 */
export function masterBar(w: World) {
  const m = me(w);
  const act = w.masterPlan.act;
  const stuck = atBottleneck(m);
  const prog = masterProgress(w);
  return `<button class="mb" data-act="open-master">
    <span class="mb-ava">${avatar(m, 38)}</span>
    <span class="mb-text"><b>宗主 · ${esc(planText(w))}</b><small>${esc(realmText(m))}${stuck ? ' · 圆满' : ''} · 还有 ${masterLeft(w)} 日</small>
      <span class="mb-bar"><i style="width:${(prog * 100).toFixed(1)}%"></i></span></span>
    <span class="mb-cultiv" title="宗主修为">${m.realm < 4 ? `<i style="height:${Math.min(100, (m.exp / need(m)) * 100).toFixed(0)}%"></i>` : ''}</span>
  </button>
  ${act === 'seclude' && stuck ? `<span class="mb-note">这一轮闭关做完就冲击${REALM_NAME[m.realm + 1]}</span>` : ''}
  <span class="sr-only">${esc(MASTER_ACT[act].name)}</span>`;
}

/** 打上门的倒计时 */
export function warBanner(w: World) {
  const pw = w.pendingWar;
  if (!pw || w.war || pw.at === undefined) return '';
  const rv = w.rivals.find((x) => x.id === pw.enemy);
  return `<button class="war-count" data-act="tab" data-id="world">${pw.byPlayer ? `与${esc(rv?.name)}开战` : `${esc(rv?.name)}大军压境`} · 还有 ${daysLeft(w, pw.at)} 日</button>`;
}

interface Step { done: boolean; text: string; act: string; id?: string }

/** 开山头一年：一步一步的小目标；之后显示今年的大计 */
export function questView(w: World) {
  const ms = members(w);
  if (!w.guideOff && w.t < 4) {
    const steps: Step[] = [
      { done: w.alumni.length > 4, text: '收一个弟子', act: 'tab', id: 'recruit' },
      { done: ms.length > 0 && ms.every((p) => p.job !== 'none'), text: '给闲着的人派差事', act: 'tab', id: 'staff' },
      { done: w.sect.works.length > 0 || HALLS.filter((h) => isBuilt(w, h.id)).length > 3, text: '动工盖一座新殿堂', act: 'tab', id: 'sect' },
      { done: w.expeditions.length > 0 || w.stats.missionsDone + w.stats.missionsFailed > 0, text: '派人下山办件差事', act: 'tab', id: 'mission' },
      { done: ms.some((p) => p.talked), text: '召见一个弟子聊聊', act: 'tab', id: 'people' },
      { done: w.t >= 1, text: '看着弟子们过完这一季', act: 'speed', id: '2' },
    ];
    const i = steps.findIndex((x) => !x.done);
    if (i >= 0) {
      const s = steps[i];
      return `<div class="quest"><span class="q-n">${i + 1}/${steps.length}</span><b>${esc(s.text)}</b><button class="btn xs primary" data-act="${s.act}"${s.id ? (s.act === 'speed' ? ` data-v="${s.id}"` : ` data-id="${s.id}"`) : ''}>${s.act === 'speed' ? '2× 快进' : '去'}</button><button class="q-x" data-act="guide-off" aria-label="不再提示">×</button></div>`;
    }
  }
  const g = w.goal;
  if (!g) return '';
  const gp = goalProgress(w, g);
  return `<button class="quest goal${g.done ? ' done' : ''}" data-act="tab" data-id="sect"><span class="q-n">大计</span><b>${esc(g.text)}</b><em>${g.done ? '已成' : `${gp.have}/${g.target}`}</em></button>`;
}
